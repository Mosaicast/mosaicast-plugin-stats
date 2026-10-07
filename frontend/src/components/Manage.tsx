// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { BlobQuota, PluginContext } from '@mosaicast/plugin-sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { forgetShared } from '../data';
import * as fmt from '../format';
import { bookSuggestions, confidentMatch, listAll, normalizeImport, now, pendingCount, queue, sortImports, takenByOthers, uploadArchive, type UploadState } from '../manage';
import type { ImportRecord, ReaderInfo, SpeakerSettings } from '../types';
import { Icon, LoadingBar, useSiteData, type Basics } from './common';
import { BundleEditor } from './BundleEditor';
import { SpeakerEditor } from './SpeakerEditor';

const POLL_MS = 2500;
const NONE_TAKEN = new Map<string, Set<string>>();
/** An upload the backend hasn't picked up after this long stops counting as "in progress". */
const GIVE_UP_MS = 120_000;

/** Whether the backend has read an upload: some import holds its archive (or came out of it). */
function picked(ref: string, list: ImportRecord[]): boolean {
  return list.some((r) => r.archive === ref || r.id === ref || r.id.startsWith(`${ref}-`));
}

/** /p/stats/manage: upload results, check what the backend made of them, assign them to episodes. */
export function Manage({ ctx }: { ctx: PluginContext }) {
  const [reload, setReload] = useState(0);
  const { index, settings, bundleSettings, basics: b } = useSiteData(ctx, reload);
  const [imports, setImports] = useState<ImportRecord[] | null>(null);
  // Work the backend still owes us: queued commands, plus uploads it hasn't read yet.
  const [commands, setCommands] = useState(0);
  const uploads = useRef(new Map<string, number>());
  const [unread, setUnread] = useState(0);
  const pending = commands + unread;
  const busy = useRef(false);
  const [readers, setReaders] = useState<ReaderInfo[]>([]);
  const [quota, setQuota] = useState<BlobQuota | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'assigned' | 'all'>('open');

  const refresh = useCallback(async () => {
    try {
      const [raw, waiting] = await Promise.all([listAll<ImportRecord>(ctx, 'import:'), pendingCount(ctx)]);
      const list = raw.map(normalizeImport);
      setImports(sortImports(list));
      for (const [ref, since] of uploads.current) {
        if (picked(ref, list) || Date.now() - since > GIVE_UP_MS) uploads.current.delete(ref);
      }
      const left = waiting + uploads.current.size;
      if (busy.current && left === 0) {
        // Everything landed: let the other views (names, index) catch up.
        forgetShared();
        setReload((r) => r + 1);
      }
      busy.current = left > 0;
      setCommands(waiting);
      setUnread(uploads.current.size);
      setError(null);
    } catch (e) {
      ctx.log('warn', `stats: could not list imports (${String(e)})`);
      setError('error.load');
    }
  }, [ctx]);

  useEffect(() => {
    void refresh();
    ctx.docs.get<ReaderInfo[]>('site', 'readers').then((r) => setReaders(r ?? []), () => setReaders([]));
    ctx.blobs?.quota().then(setQuota, () => setQuota(null));
  }, [ctx.docs, ctx.blobs, refresh]);

  // Poll while the backend has work queued.
  useEffect(() => {
    if (pending === 0) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  const send = async (cmd: Parameters<typeof queue>[1]) => {
    try {
      await queue(ctx, cmd);
      busy.current = true;
      setCommands((p) => p + 1);
    } catch (e) {
      ctx.log('warn', `stats: could not queue ${cmd.type} (${String(e)})`);
      setError('error.save');
    }
  };

  const shown = (imports ?? []).filter((r) =>
    filter === 'all' ? true : filter === 'assigned' ? r.status === 'assigned' : r.status !== 'assigned');
  const confident = (imports ?? []).filter((r) => r.status === 'ready' && !r.book && confidentMatch(r));
  const bookPlans = (imports ?? [])
    .filter((r) => r.status === 'ready' && r.book)
    .map((r) => {
      const bundle = r.suggestedBundle ?? 'book';
      return { r, bundle, plan: bookSuggestions(r, bundle, takenByOthers(imports ?? [], r.id)) };
    })
    .filter((p) => Object.keys(p.plan).length > 0);
  const assignAll = () => {
    confident.forEach((r) => void send({ type: 'assign', at: now(), importId: r.id, target: { type: 'episode', id: confidentMatch(r)! },
      bundle: r.suggestedBundle ?? undefined, merge: r.merge }));
    for (const { r, bundle, plan } of bookPlans) {
      const byEpisode = new Map<string, string[]>();
      for (const [chapter, slug] of Object.entries(plan)) byEpisode.set(slug, [...(byEpisode.get(slug) ?? []), chapter]);
      for (const [slug, parts] of byEpisode) {
        void send({ type: 'assign', at: now(), importId: r.id, target: { type: 'episode', id: slug }, bundle, parts });
      }
    }
  };
  const clearCount = confident.length + bookPlans.length;
  const taken = useMemo(() => new Map((imports ?? []).map((r) => [r.id, takenByOthers(imports ?? [], r.id)])), [imports]);
  const rereadable = (imports ?? []).filter((r) => r.archive);
  const counts = {
    open: (imports ?? []).filter((r) => r.status !== 'assigned').length,
    assigned: (imports ?? []).filter((r) => r.status === 'assigned').length,
    all: imports?.length ?? 0,
  };

  return (
    <div>
      <Upload ctx={ctx} b={b} readers={readers} quota={quota} pending={pending} onQueued={(ref) => {
        uploads.current.set(ref, Date.now());
        busy.current = true;
        setUnread(uploads.current.size);
        void refresh();
      }} />

      {error && <p className="note bad section"><Icon name="warning" /> {b.t(error)}</p>}

      <section className="section">
        <div className="head">
          <h2>{b.t('imports.title')}</h2>
          {pending > 0 && <span className="small muted" role="status">{b.plural('imports.pending', pending)}</span>}
        </div>
        {pending > 0 && <div style={{ marginBottom: 12 }}><LoadingBar label={b.t('imports.working')} /></div>}
        {imports === null ? (
          <LoadingBar label={b.t('loading')} />
        ) : imports.length === 0 ? (
          <p className="muted">{b.t('imports.none')}</p>
        ) : (
          <>
            <div className="controls" style={{ marginTop: 0, marginBottom: 6 }}>
              {(['open', 'assigned', 'all'] as const).map((f) => (
                <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {b.t(`imports.filter.${f}`)} <span className="n">{counts[f]}</span>
                </button>
              ))}
              {clearCount > 0 && (
                <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={assignAll}>
                  <Icon name="check" /> {b.plural('imports.assignAll', clearCount)}
                </button>
              )}
              {rereadable.length > 0 && (
                <button
                  type="button"
                  className="btn"
                  style={clearCount > 0 ? undefined : { marginLeft: 'auto' }}
                  title={b.t('imports.rereadAllHint')}
                  onClick={() => rereadable.forEach((r) => void send({ type: 'reread', at: now(), importId: r.id }))}
                >
                  <Icon name="refresh" /> {b.t('imports.rereadAll')}
                </button>
              )}
            </div>
            <ul className="list">
              {shown.map((r) => (
                <ImportItem key={r.id} ctx={ctx} r={r} b={b} send={send} knownKeys={knownKeys(index, settings, imports)}
                  takenBooks={taken.get(r.id) ?? NONE_TAKEN} />
              ))}
            </ul>
            {shown.length === 0 && <p className="muted small">{b.t('imports.nothingHere')}</p>}
          </>
        )}
      </section>

      <section className="section">
        <h2 style={{ marginBottom: 6 }}>{b.t('bundle.title')}</h2>
        <p className="small muted" style={{ marginTop: 0 }}>{b.t('bundle.lead')}</p>
        <BundleEditor ctx={ctx} b={b} canEdit={ctx.user?.role === 'admin'} settings={bundleSettings} imports={imports ?? []} onSaved={() => { forgetShared(); setReload((r) => r + 1); }} />
      </section>

      <section className="section">
        <h2 style={{ marginBottom: 6 }}>{b.t('people.title')}</h2>
        <p className="small muted" style={{ marginTop: 0 }}>{b.t('people.lead')}</p>
        <SpeakerEditor ctx={ctx} b={b} settings={settings} keys={knownKeys(index, settings, imports ?? [])} onSaved={() => { forgetShared(); setReload((r) => r + 1); }} />
      </section>
    </div>
  );
}

/** Every speaker key the site has seen, with a raw label for each. */
function knownKeys(index: ReturnType<typeof useSiteData>['index'], settings: SpeakerSettings | null, imports: ImportRecord[]) {
  const keys = new Map<string, string>();
  for (const byBundle of Object.values(index?.episodes ?? {})) for (const s of Object.values(byBundle)) for (const sp of s.speakers) keys.set(sp.key, sp.label);
  for (const r of imports) for (const sp of r.summary?.speakers ?? []) if (!keys.has(sp.key)) keys.set(sp.key, sp.label);
  for (const k of Object.keys(settings?.people ?? {})) if (!keys.has(k)) keys.set(k, k);
  return keys;
}

function Upload({ ctx, b, readers, quota, pending, onQueued }: { ctx: PluginContext; b: Basics; readers: ReaderInfo[]; quota: BlobQuota | null; pending: number; onQueued: (ref: string) => void }) {
  const [files, setFiles] = useState<{ id: string; file: File; status: UploadState }[]>([]);
  const [reader, setReader] = useState('');
  const [over, setOver] = useState(false);
  const busy = files.some((f) => f.status.state === 'uploading' || f.status.state === 'waiting' || f.status.state === 'paused');
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  // Once the backend has read everything, the rows move to "Uploaded results" below.
  useEffect(() => {
    if (pending === 0) setFiles((prev) => (prev.some((f) => f.status.state === 'queued') ? prev.filter((f) => f.status.state !== 'queued') : prev));
  }, [pending]);

  const start = async (picked: File[]) => {
    if (picked.length === 0) return;
    const batch = picked.map((file) => ({ id: `u${seq.current++}`, file }));
    setFiles((prev) => [
      ...prev.filter((f) => f.status.state !== 'queued'),
      ...batch.map((x) => ({ ...x, status: { state: 'waiting' } as UploadState })),
    ]);
    // One at a time: a batch of 40 archives shouldn't open 40 uploads at once.
    for (const { id, file } of batch) {
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: { state: 'uploading' } } : f)));
      const status = await uploadArchive(ctx, file, quota?.maxFileBytes ?? null, reader, b.bytes, (seconds) =>
        setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: { state: 'paused', seconds } } : f))));
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status } : f)));
      if (status.state === 'queued') onQueued(status.ref);
    }
  };

  if (!ctx.blobs) return <p className="note bad"><Icon name="warning" /> {b.t('upload.noStorage')}</p>;
  return (
    <section>
      <h2 style={{ marginBottom: 6 }}>{b.t('upload.title')}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>{b.t('upload.lead')}</p>
      <div
        className={over ? 'drop over' : 'drop'}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void start([...e.dataTransfer.files]); }}
      >
        <p style={{ margin: '0 0 10px' }}><Icon name="upload" /> {b.t('upload.drop')}</p>
        <input ref={input} id="stats-files" type="file" accept=".zip,application/zip" multiple className="sr"
          onChange={(e) => { void start([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <button type="button" className="btn primary" disabled={busy} onClick={() => input.current?.click()}>
          {b.t('upload.pick')}
        </button>
        <div className="controls" style={{ justifyContent: 'center' }}>
          <label className="small muted" htmlFor="stats-reader">{b.t('upload.reader')}</label>
          <select id="stats-reader" value={reader} onChange={(e) => setReader(e.target.value)}>
            <option value="">{b.t('upload.detect')}</option>
            {readers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        {quota && (
          <p className="tiny muted" style={{ margin: '10px 0 0' }}>
            {b.t('upload.limit', { max: b.bytes(quota.maxFileBytes) })}
          </p>
        )}
      </div>
      {files.length > 0 && (
        <ul className="list small" aria-live="polite" style={{ marginTop: 8 }}>
          {files.map(({ id, file, status }) => (
            <li key={id} style={{ padding: '6px 0' }} className="row-head">
              <span>{file.name}</span>
              <span className={status.state === 'failed' ? 'status failed' : 'status'}>
                {status.state === 'failed' ? b.t(status.reason, status.params)
                  : status.state === 'paused' ? b.t('upload.state.paused', { n: status.seconds })
                  : b.t(`upload.state.${status.state}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Send = (cmd: Parameters<typeof queue>[1]) => Promise<void>;

/** Where an import is shown, one line per assignment, with "waits for release" where that applies. */
function Assignments({ ctx, r, b, label }: { ctx: PluginContext; r: ImportRecord; b: Basics; label: (slug: string) => string }) {
  if (r.assignments.length === 0) return null;
  const bundleOf = (id: string) => b.bundles.find((x) => x.id === id);
  if (r.book && r.assignments.length > 3) {
    // A book on dozens of episodes: one line here, the chapter table below has the details.
    const waiting = r.assignments.filter((a) => a.live === false && !a.unavailable).length;
    const names = [...new Set(r.assignments.map((a) => a.bundle))].map((id) => { const x = bundleOf(id); return x ? b.bundleName(x) : id; });
    return (
      <p className="small" style={{ margin: '4px 0 0' }}>
        <Icon name="check" /> {b.plural('book.shownOn', r.assignments.length)}
        <span className="muted"> · {names.join(', ')}{waiting > 0 ? ` · ${b.plural('book.waitingCount', waiting)}` : ''}</span>
      </p>
    );
  }
  return (
    <ul className="small" style={{ margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
      {r.assignments.map((a) => {
        const waiting = a.live === false && !a.unavailable;
        const bundle = bundleOf(a.bundle);
        const parts = a.parts && r.book ? r.book.chapters.filter((c) => a.parts!.includes(c.id)).map((c) => c.heading) : null;
        return (
          <li key={`${a.target.type}:${a.target.id}:${a.bundle}`}>
            <Icon name={a.unavailable ? 'warning' : waiting ? 'clock' : 'check'} />{' '}
            {b.t(waiting ? 'imports.waitingFor' : 'imports.assignedTo')}{' '}
            {a.target.type === 'episode' ? <a href={ctx.links.episode(a.target.id)}>{label(a.target.id)}</a> : `${a.target.type} ${a.target.id}`}
            <span className="muted">
              {' · '}{bundle ? b.bundleName(bundle) : a.bundle}
              {parts && parts.length > 0 ? ` · ${parts.join(', ')}` : ''}
              {waiting ? ` · ${b.t('imports.waitingHint')}` : ''}
              {a.unavailable ? ` · ${b.t('error.target-unavailable')}` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ImportItem({
  ctx, r, b, send, knownKeys, takenBooks,
}: {
  ctx: PluginContext;
  r: ImportRecord;
  b: Basics;
  send: Send;
  knownKeys: Map<string, string>;
  /** Episode slug → bundle ids that already show book stats from another import. */
  takenBooks: Map<string, Set<string>>;
}) {
  const labels = ctx.episodeLabels ?? {};
  const s = r.summary;
  const label = (slug: string) => labels[slug] ?? r.candidates.find((c) => c.slug === slug)?.title
    ?? Object.values(r.chapterCandidates ?? {}).flat().find((c) => c.slug === slug)?.title ?? slug;
  const waiting = r.assignments.some((a) => a.live === false && !a.unavailable);
  const isBook = (r.kind ?? (r.book ? 'book' : 'podcast')) === 'book';

  return (
    <li>
      <div className="row-head">
        <strong style={{ overflowWrap: 'anywhere' }}>{r.fileName}</strong>
        {waiting
          ? <span className="status">{b.t('imports.status.waiting')}</span>
          : <span className={`status ${r.status}`}>{b.t(`imports.status.${r.status}`)}</span>}
      </div>
      {s && (
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          {[
            r.hint,
            s.durationSeconds != null ? fmt.clock(s.durationSeconds) : null,
            s.speakers.map((sp) => `${b.who(sp.key, sp).name} ${fmt.percent(sp.share, b.locale)}`).join(', '),
            s.source?.tool,
          ].filter(Boolean).join(' · ')}
        </p>
      )}
      {r.book && (
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          {[r.book.title ?? r.hint, b.plural('book.chapterCount', r.book.chapters.length),
            b.t('book.wordCount', { n: fmt.compact(r.book.chapters.reduce((a, c) => a + c.words, 0), b.locale) })].filter(Boolean).join(' · ')}
        </p>
      )}
      <Assignments ctx={ctx} r={r} b={b} label={label} />
      {r.error && (
        <p className="note bad small" style={{ marginTop: 8 }}>
          <Icon name="warning" /> <span>{errorText(r.error.code, b)}</span>
        </p>
      )}
      {(s?.warnings ?? []).map((w, i) => (
        <p key={i} className="note warn small" style={{ marginTop: 8 }}>
          <Icon name="warning" /> <span>{warningText(w.code, speakerNamed(w.params, s, b), b)}</span>
        </p>
      ))}
      {s && (r.level ?? 'episode') === 'episode' && !isBook && (
        <PodcastAssign ctx={ctx} r={r} b={b} send={send} knownKeys={knownKeys} label={label} />
      )}
      {r.book && isBook && <BookAssign ctx={ctx} r={r} b={b} send={send} label={label} taken={takenBooks} />}
      {!s && !r.book && (
        <div className="controls">
          <RemoveButton b={b} onConfirm={() => void send({ type: 'discard', at: now(), importId: r.id })} />
          <ArchiveActions ctx={ctx} r={r} b={b} send={send} />
        </div>
      )}
    </li>
  );
}

/** A select over the bundles of one kind. Hidden when the kind has only one bundle. */
function BundleSelect({ id, kind, value, onChange, b }: { id: string; kind: 'podcast' | 'book'; value: string; onChange: (v: string) => void; b: Basics }) {
  const options = b.bundles.filter((x) => x.kind === kind);
  if (options.length < 2) return null;
  return (
    <>
      <label className="sr" htmlFor={id}>{b.t('bundle.label')}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((x) => <option key={x.id} value={x.id}>{b.bundleName(x)}{x.spoiler ? ` (${b.t('bundle.spoilerShort')})` : ''}</option>)}
      </select>
    </>
  );
}

function defaultBundle(r: ImportRecord, kind: 'podcast' | 'book', b: Basics): string {
  const current = r.assignments[0]?.bundle;
  const pick = current ?? r.suggestedBundle;
  if (pick && b.bundles.some((x) => x.id === pick && x.kind === kind)) return pick;
  return (b.bundles.find((x) => x.kind === kind && !x.spoiler) ?? b.bundles.find((x) => x.kind === kind))?.id ?? kind;
}

function PodcastAssign({ ctx, r, b, send, knownKeys, label }: { ctx: PluginContext; r: ImportRecord; b: Basics; send: Send; knownKeys: Map<string, string>; label: (slug: string) => string }) {
  const s = r.summary!;
  const current = r.assignments[0];
  const initial = current?.target.type === 'episode' ? current.target.id : confidentMatch(r) ?? r.candidates[0]?.slug ?? '';
  const [target, setTarget] = useState(initial);
  const [bundle, setBundle] = useState(defaultBundle(r, 'podcast', b));
  const [merge, setMerge] = useState<Record<string, string>>(r.merge ?? {});
  useEffect(() => setTarget(initial), [current?.target.id, r.candidates[0]?.slug]);
  useEffect(() => setBundle(defaultBundle(r, 'podcast', b)), [current?.bundle, r.suggestedBundle, b.bundles]);
  useEffect(() => setMerge(r.merge ?? {}), [r.merge]);
  const others = useMemo(() => ctx.episodes.filter((x) => !r.candidates.some((c) => c.slug === x)), [ctx.episodes, r.candidates]);
  const changed = !current || target !== current.target.id || bundle !== current.bundle
    || JSON.stringify(merge) !== JSON.stringify(r.merge ?? {});
  return (
    <>
      <div className="controls">
        <label className="sr" htmlFor={`t-${r.id}`}>{b.t('imports.episode')}</label>
        <select id={`t-${r.id}`} value={target} onChange={(e) => setTarget(e.target.value)} style={{ flex: '1 1 260px' }}>
          <option value="">{b.t('imports.pick')}</option>
          {r.candidates.length > 0 && (
            <optgroup label={b.t('imports.suggested')}>
              {r.candidates.map((c) => (
                <option key={c.slug} value={c.slug}>{label(c.slug)} ({fmt.percent(c.score, b.locale)})</option>
              ))}
            </optgroup>
          )}
          <optgroup label={b.t('imports.allEpisodes')}>
            {others.map((slug) => <option key={slug} value={slug}>{label(slug)}</option>)}
          </optgroup>
        </select>
        <BundleSelect id={`b-${r.id}`} kind="podcast" value={bundle} onChange={setBundle} b={b} />
        <button type="button" className="btn primary" disabled={!target || !changed}
          onClick={() => void send({ type: 'assign', at: now(), importId: r.id, target: { type: 'episode', id: target }, bundle, merge })}>
          {current ? b.t('imports.save') : b.t('imports.assign')}
        </button>
        {current && (
          <button type="button" className="btn" onClick={() => void send({ type: 'unassign', at: now(), importId: r.id })}>
            {b.t('imports.unassign')}
          </button>
        )}
        <RemoveButton b={b} onConfirm={() => void send({ type: 'discard', at: now(), importId: r.id })} />
        <ArchiveActions ctx={ctx} r={r} b={b} send={send} />
      </div>
      {s.speakers.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="small">{b.t('imports.speakers')}</summary>
          <div className="controls" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            {s.speakers.map((sp) => (
              <label key={sp.key} className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ minWidth: 120 }}>{sp.label}</span>
                <select value={merge[sp.key] ?? ''} onChange={(e) => setMerge((m) => {
                  const next = { ...m };
                  if (e.target.value) next[sp.key] = e.target.value; else delete next[sp.key];
                  return next;
                })}>
                  <option value="">{b.t('imports.asIs', { name: b.who(sp.key, sp).name })}</option>
                  {[...knownKeys.entries()].filter(([k]) => k !== sp.key).map(([k, raw]) => (
                    <option key={k} value={k}>{b.t('imports.samePerson', { name: b.who(k, { label: raw }).name })}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

/**
 * Chapters to episodes: one row per chapter, prefilled from the current assignments or the clear
 * suggestions. Several chapters may go to one episode (a book podcast that covers a whole book in one go
 * puts them all on the same one). Saving sends one assignment per episode and removes the ones dropped.
 */
function BookAssign({ ctx, r, b, send, label, taken }: { ctx: PluginContext; r: ImportRecord; b: Basics; send: Send; label: (slug: string) => string; taken: Map<string, Set<string>> }) {
  const book = r.book!;
  const [bundle, setBundle] = useState(defaultBundle(r, 'book', b));
  const current = useMemo(() => currentPlan(r), [r.processedAt]);
  const [plan, setPlan] = useState<Record<string, string>>(() => ({ ...bookSuggestions(r, bundle, taken), ...current }));
  // Reset only when the backend touched the import, not on every poll, or edits in progress would vanish.
  useEffect(() => setPlan({ ...bookSuggestions(r, bundle, taken), ...currentPlan(r) }), [r.processedAt, bundle]);
  useEffect(() => setBundle(defaultBundle(r, 'book', b)), [r.assignments[0]?.bundle, r.suggestedBundle, b.bundles]);
  const [all, setAll] = useState('');
  const changed = JSON.stringify(plan) !== JSON.stringify(current) || (r.assignments[0] && r.assignments[0].bundle !== bundle);
  const options = useMemo(() => {
    const suggested = new Set(Object.values(r.chapterCandidates ?? {}).flat().map((c) => c.slug));
    return [...suggested, ...ctx.episodes.filter((x) => !suggested.has(x))];
  }, [ctx.episodes, r.chapterCandidates]);
  const assigned = Object.values(plan).filter(Boolean).length;

  const save = () => {
    const byEpisode = new Map<string, string[]>();
    for (const c of book.chapters) {
      const slug = plan[c.id];
      if (slug) byEpisode.set(slug, [...(byEpisode.get(slug) ?? []), c.id]);
    }
    for (const a of r.assignments) {
      if (a.target.type === 'episode' && !byEpisode.has(a.target.id)) {
        void send({ type: 'unassign', at: now(), importId: r.id, target: a.target });
      }
    }
    for (const [slug, parts] of byEpisode) {
      void send({ type: 'assign', at: now(), importId: r.id, target: { type: 'episode', id: slug }, bundle,
        parts: parts.length === book.chapters.length ? null : parts });
    }
  };

  return (
    <details open={r.assignments.length === 0} style={{ marginTop: 10 }}>
      <summary className="small">{b.t('book.mapTitle', { n: assigned, total: book.chapters.length })}</summary>
      <div className="controls">
        <label className="small" htmlFor={`all-${r.id}`}>{b.t('book.allOn')}</label>
        <select id={`all-${r.id}`} value={all} onChange={(e) => {
          setAll(e.target.value);
          if (e.target.value) setPlan(Object.fromEntries(book.chapters.map((c) => [c.id, e.target.value])));
        }}>
          <option value="">{b.t('imports.pick')}</option>
          {options.map((slug) => <option key={slug} value={slug}>{label(slug)}</option>)}
        </select>
        <BundleSelect id={`bb-${r.id}`} kind="book" value={bundle} onChange={setBundle} b={b} />
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table>
          <thead>
            <tr>
              <th scope="col">{b.t('book.chapter')}</th>
              <th scope="col">{b.t('book.words')}</th>
              <th scope="col" style={{ textAlign: 'left' }}>{b.t('book.episode')}</th>
            </tr>
          </thead>
          <tbody>
            {book.chapters.map((c) => (
              <tr key={c.id}>
                <th scope="row" style={{ fontWeight: 400, fontSize: '0.9rem' }}>{c.heading}</th>
                <td>{fmt.count(c.words, b.locale)}</td>
                <td style={{ textAlign: 'left' }}>
                  <select aria-label={b.t('book.episodeFor', { chapter: c.heading })} value={plan[c.id] ?? ''}
                    onChange={(e) => setPlan((p) => ({ ...p, [c.id]: e.target.value }))} style={{ maxWidth: 320 }}>
                    <option value="">{b.t('book.notShown')}</option>
                    {(r.chapterCandidates?.[c.id] ?? []).length > 0 && (
                      <optgroup label={b.t('imports.suggested')}>
                        {(r.chapterCandidates?.[c.id] ?? []).map((x) => (
                          <option key={x.slug} value={x.slug}>{label(x.slug)} ({fmt.percent(x.score, b.locale)})</option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label={b.t('imports.allEpisodes')}>
                      {options.map((slug) => <option key={slug} value={slug}>{label(slug)}</option>)}
                    </optgroup>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="controls">
        <button type="button" className="btn primary" disabled={!changed} onClick={save}>{b.t('book.save')}</button>
        <RemoveButton b={b} onConfirm={() => void send({ type: 'discard', at: now(), importId: r.id })} />
        <ArchiveActions ctx={ctx} r={r} b={b} send={send} />
      </div>
    </details>
  );
}

/** Chapter id → episode slug, as currently assigned. */
function currentPlan(r: ImportRecord): Record<string, string> {
  const plan: Record<string, string> = {};
  for (const a of r.assignments) {
    if (a.target.type !== 'episode') continue;
    for (const c of r.book?.chapters ?? []) {
      if (!a.parts || a.parts.includes(c.id)) plan[c.id] = a.target.id;
    }
  }
  return plan;
}

/** Read the kept archive again, or download it. Only for imports whose archive was kept. */
function ArchiveActions({ ctx, r, b, send }: { ctx: PluginContext; r: ImportRecord; b: Basics; send: (cmd: Parameters<typeof queue>[1]) => Promise<void> }) {
  if (!r.archive) return null;
  return (
    <>
      <button type="button" className="btn" onClick={() => void send({ type: 'reread', at: now(), importId: r.id })}>
        <Icon name="refresh" /> {b.t('imports.reread')}
      </button>
      {ctx.blobs && (
        <a className="small" href={ctx.blobs.urlFor(r.archive)} download={r.fileName}>
          {b.t('imports.download')}
        </a>
      )}
    </>
  );
}

function RemoveButton({ b, onConfirm }: { b: Basics; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="btn" onClick={() => setAsking(true)}>
        <Icon name="delete" /> {b.t('imports.remove')}
      </button>
    );
  }
  return (
    <span className="small" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      {b.t('imports.removeSure')}
      <button type="button" className="btn" onClick={() => { setAsking(false); onConfirm(); }}>{b.t('imports.removeYes')}</button>
      <button type="button" className="link" onClick={() => setAsking(false)}>{b.t('imports.removeNo')}</button>
    </span>
  );
}

function errorText(code: string, b: Basics): string {
  const key = `error.${code}`;
  const text = b.t(key);
  return text === key ? b.t('error.other', { code }) : text;
}

/** Warnings name speakers by their raw label; show the name people know instead. */
function speakerNamed(params: Record<string, string>, s: ImportRecord['summary'], b: Basics): Record<string, string> {
  const sp = s?.speakers.find((x) => x.label === params.speaker);
  return sp ? { ...params, speaker: b.who(sp.key, sp).name } : params;
}

function warningText(code: string, params: Record<string, string>, b: Basics): string {
  const key = `warning.${code}`;
  const text = b.t(key, params);
  return text === key ? code : text;
}
