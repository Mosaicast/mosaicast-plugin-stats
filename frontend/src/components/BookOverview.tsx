// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import { useMemo, useRef, useState } from 'react';
import {
  aggregateBooks,
  bookOf,
  byBook,
  chapterGroups,
  chapterPoints,
  chapterRankings,
  mergeEntities,
  mergeNames,
  pace,
  sentenceTotals,
  type ChapterGroupRow,
  type ChapterPoint,
  type ChapterRecordId,
  type GroupRow,
} from '../book';
import { useChapterDetails } from '../data';
import * as fmt from '../format';
import { bySeason, type SeasonLookup } from '../seasons';
import type { BookSummary, Chapter, EpisodeStats, StatsIndex } from '../types';
import { PaceTable } from './BookViews';
import { RecordGroups, type RecordSpec } from './Records';
import { ChapterCharts } from './ChapterCharts';
import { ChapterGroupTable, groupRecords } from './ChapterGroups';
import { LoadingBar, Tiles, tipBeside, titleOf, TopNames, useWidth, type Basics } from './common';

type Entry = { text: string; count: number };

/** Which names a chapter row or heat map row shows. */
const NAME_KINDS = [
  { id: 'characters', label: 'books.characters', pick: (c: Chapter) => c.characters },
  { id: 'LOCATION', label: 'names.places', pick: (c: Chapter) => group(c, 'LOCATION') },
  { id: 'ORGANIZATION', label: 'names.groups', pick: (c: Chapter) => group(c, 'ORGANIZATION') },
] as const;

function group(c: Chapter, label: string): Entry[] {
  return c.entities?.find((g) => g.label === label)?.top ?? [];
}

/**
 * The books side of a scope (the whole show, a season, or one book), laid out like the podcast stats: totals,
 * charts chapter by chapter, records, most mentioned names, and who and where shows up in which chapter.
 * Only chapters of released episodes are in the index, so nothing here is ahead of the show.
 *
 * Where chapters share a heading ("Jaime I", "Jaime II", …) they also add up per chapter group: a table and
 * records compare the groups, and picking one narrows everything on the page down to its chapters.
 */
export function BookOverview({
  ctx,
  index,
  selected,
  books,
  podcasts,
  slugs,
  b,
  only,
  seasonOf,
  onSeason,
  onBook,
}: {
  ctx: PluginContext;
  index: StatsIndex | null | undefined;
  /** The ticked bundles, to load chapter names for. */
  selected: Set<string>;
  /** Per episode, the selected book bundles. */
  books: Record<string, BookSummary>;
  /** Per episode, the selected podcast bundles combined (for the time spent on each chapter). */
  podcasts: Record<string, EpisodeStats>;
  slugs: string[];
  b: Basics;
  /** Just this book (its URL name). */
  only?: string;
  /** Given for the whole show or a book: adds the per-season table. */
  seasonOf?: SeasonLookup;
  onSeason?: (n: number) => void;
  onBook?: (book: string) => void;
}) {
  const labels = ctx.episodeLabels;
  const scoped = useMemo(
    () => (only ? Object.fromEntries(Object.entries(books).filter(([, s]) => bookOf(s) === only)) : books),
    [books, only],
  );
  const all = useMemo(() => chapterPoints(scoped, slugs), [scoped, slugs]);
  const groups = useMemo(() => chapterGroups(all, scoped, podcasts), [all, scoped, podcasts]);
  // Kept while switching scopes, as long as the new one has that group too.
  const [picked, setPicked] = useState<string | null>(null);
  const group = groups.find((g) => g.id === picked) ?? null;
  const points = group ? group.points : all;
  const keys = useMemo(() => (group ? new Set(group.points.map((p) => p.key)) : null), [group]);
  // With a group picked, the episodes that are only about its chapters.
  const episodes = useMemo(() => (keys ? slugs.filter((slug) => {
    const s = scoped[slug];
    return !!s && s.chapters.length > 0 && s.chapters.every((c) => keys.has(`${bookOf(s)}/${c.id}`));
  }) : slugs), [keys, slugs, scoped]);
  const totals = useMemo(() => sentenceTotals(points), [points]);
  const agg = useMemo(() => aggregateBooks(scoped, podcasts, episodes), [scoped, podcasts, episodes]);
  const covering = useMemo(() => [...new Set(all.map((p) => p.slug))], [all]);
  const details = useChapterDetails(ctx, index, selected, covering);
  const names = useMemo(() => {
    if (group) {
      // Episode summaries mix in other chapters; the group's own chapters have their names.
      const chapters = group.points.map((p) => details?.get(p.key)).filter((c): c is Chapter => !!c);
      return { PERSON: mergeNames(chapters.map((c) => c.characters)), ...mergeEntities(chapters.map((c) => c.entities)) };
    }
    const summaries = Object.entries(scoped).filter(([slug]) => slugs.includes(slug)).map(([, s]) => s);
    const entities = mergeEntities(summaries.map((s) => s.entities));
    return { PERSON: mergeNames(summaries.map((s) => s.characters)), ...entities };
  }, [group, details, scoped, slugs]);
  const bookRows = useMemo(() => byBook(points, scoped, podcasts), [points, scoped, podcasts]);
  const seasonRows = useMemo(() => {
    if (!seasonOf) return [];
    return [...bySeason(slugs, seasonOf).entries()]
      .filter(([n]) => n !== null)
      .map(([n, list]): GroupRow | null => {
        const mine = chapterPoints(scoped, list).filter((p) => !keys || keys.has(p.key));
        if (mine.length === 0) return null;
        return { id: String(n), title: b.t('seasons.label', { n: n! }), ...sentenceTotals(mine), minutesPerKWords: pace(mine, scoped, podcasts) };
      })
      .filter((r): r is GroupRow => r !== null)
      .sort((x, y) => Number(x.id) - Number(y.id));
  }, [seasonOf, slugs, scoped, podcasts, b, keys]);

  if (points.length === 0) return <p className="muted">{b.t('books.empty')}</p>;
  const link = (p: ChapterPoint) => <a href={ctx.links.episode(p.slug)}>{titleOf(p.slug, labels)}</a>;

  return (
    <>
      {groups.length > 0 && (
        <div className="group-pick">
          <label>
            {b.t('groups.pick')}
            <select value={group?.id ?? ''} onChange={(e) => setPicked(e.target.value || null)}>
              <option value="">{b.t('book.allChapters')}</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{b.t('groups.option', { group: g.title, n: g.chapters })}</option>)}
            </select>
          </label>
          {group && <button type="button" className="link small" onClick={() => setPicked(null)}>{b.t('groups.clear')}</button>}
        </div>
      )}
      <Tiles
        tiles={[
          { label: b.t('book.chapters'), value: fmt.count(totals.chapters, b.locale), sub: bookRows.length > 1 ? b.t('books.inBooks', { n: bookRows.length }) : undefined },
          group && { label: b.t('groups.avgWords'), value: fmt.count(group.avgWords, b.locale) },
          { label: b.t('book.words'), value: fmt.compact(totals.words, b.locale) },
          totals.sentences != null && { label: b.t('book.sentences'), value: fmt.compact(totals.sentences, b.locale) },
          totals.avgSentence != null && { label: b.t('book.avgSentence'), value: fmt.decimal(totals.avgSentence, b.locale), sub: b.t('book.avgSentenceSub') },
          totals.dialogueShare != null && { label: b.t('book.dialogue'), value: fmt.percent(totals.dialogueShare, b.locale), sub: b.t('book.dialogueSub') },
          agg.minutesPerKWords != null && {
            label: b.t('book.pace'),
            value: b.t('book.paceValue', { n: fmt.decimal(agg.minutesPerKWords, b.locale) }),
          },
        ]}
      />

      {points.length > 1 && (
        <section className="section">
          <ChapterCharts points={points} labels={labels} b={b} />
        </section>
      )}

      {points.length > 1 && (
        <Records points={points} groups={group ? [] : groups} link={(p) => ({ href: ctx.links.episode(p.slug), text: titleOf(p.slug, labels) })} b={b} />
      )}

      {groups.length > 0 && <ChapterGroupTable rows={groups} details={details} active={group?.id ?? null} onPick={setPicked} b={b} />}

      {Object.values(names).some((l) => l.length > 0) && (
        <section className="section">
          <h3>{b.t('names.title')}</h3>
          <TopNames groups={names} b={b} limit={15} />
        </section>
      )}

      <section className="section">
        <h3>{b.t('books.byChapter')}</h3>
        {details === undefined ? <LoadingBar label={b.t('loading')} /> : <ByChapter points={points} details={details} link={link} b={b} />}
      </section>

      {bookRows.length > 1 && (
        <GroupTable title={b.t('books.byBook')} head={b.t('books.book')} rows={bookRows} b={b}
          href={(r) => `/p/stats/books/${r.id}`} onOpen={onBook && ((r) => onBook(r.id))} />
      )}
      {seasonRows.length > 1 && (
        <GroupTable title={b.t('books.bySeason')} head={b.t('seasons.season')} rows={seasonRows} b={b}
          href={(r) => `/p/stats/books/season/${r.id}`} onOpen={onSeason && ((r) => onSeason(Number(r.id)))} />
      )}

      {agg.rows.some((r) => r.minutesPerKWords != null) && <PaceTable ctx={ctx} agg={agg} b={b} />}
    </>
  );
}

function Records({ points, groups, link, b }: {
  points: ChapterPoint[];
  groups: ChapterGroupRow[];
  link: (p: ChapterPoint) => { href: string; text: string };
  b: Basics;
}) {
  const rankings = useMemo(() => chapterRankings(points), [points]);
  const words = (v: number) => b.t('book.wordCount', { n: fmt.count(v, b.locale) });
  const value: Record<ChapterRecordId, (v: number) => string> = {
    longest: words,
    shortest: words,
    longestSentence: words,
    wordiest: (v) => b.t('books.perSentence', { n: fmt.decimal(v, b.locale) }),
    mostDialogue: (v) => fmt.percent(v, b.locale),
    leastDialogue: (v) => fmt.percent(v, b.locale),
    mostQuestions: (v) => fmt.count(v, b.locale),
  };
  const specs: RecordSpec[] = rankings.map((r) => ({
    id: r.id,
    label: b.t(`books.${r.id}`),
    rows: r.entries.map((e) => ({ id: e.point.key, value: value[r.id](e.value), what: e.point.heading, link: link(e.point) })),
  }));
  return (
    <RecordGroups
      groups={[{ title: b.t('book.chapters'), records: specs }, { title: b.t('groups.title'), records: groups.length > 1 ? groupRecords(groups, b) : [] }]}
      b={b}
    />
  );
}

/**
 * Names chapter by chapter, two ways: a list (the top few per chapter) and a heat map (the most mentioned
 * across the scope, one row each, darker where a chapter mentions them more).
 */
function ByChapter({ points, details, link, b }: { points: ChapterPoint[]; details: Map<string, Chapter>; link: (p: ChapterPoint) => React.ReactNode; b: Basics }) {
  const [mode, setMode] = useState<'list' | 'map'>('list');
  const [top, setTop] = useState(3);
  const [kind, setKind] = useState<(typeof NAME_KINDS)[number]['id']>('characters');
  const kinds = NAME_KINDS.filter((k) => points.some((p) => {
    const c = details.get(p.key);
    return c && k.pick(c).length > 0;
  }));
  if (kinds.length === 0) return <p className="muted small">{b.t('books.noNames')}</p>;
  const active = kinds.find((k) => k.id === kind) ?? kinds[0];
  const firsts = points.some((p) => (details.get(p.key)?.newCharacters.length ?? 0) > 0);

  return (
    <>
      <div className="chart-head" style={{ marginBottom: 10 }}>
        <div className="chips" role="group" aria-label={b.t('books.byChapter')}>
          <button type="button" className="chip" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>{b.t('books.list')}</button>
          <button type="button" className="chip" aria-pressed={mode === 'map'} onClick={() => setMode('map')}>{b.t('books.map')}</button>
        </div>
        {mode === 'list' ? (
          <div className="chips" role="group" aria-label={b.t('books.top')}>
            {[3, 5].map((n) => (
              <button key={n} type="button" className="chip" aria-pressed={top === n} onClick={() => setTop(n)}>{b.t('books.topN', { n })}</button>
            ))}
          </div>
        ) : kinds.length > 1 && (
          <div className="chips" role="group" aria-label={b.t('names.title')}>
            {kinds.map((k) => (
              <button key={k.id} type="button" className="chip" aria-pressed={active.id === k.id} onClick={() => setKind(k.id)}>{b.t(k.label)}</button>
            ))}
          </div>
        )}
      </div>
      {mode === 'list' ? (
        <div className="table-wrap">
          <table className="by-chapter">
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: 'left' }}>{b.t('book.chapter')}</th>
                {kinds.map((k) => <th key={k.id} scope="col" style={{ textAlign: 'left' }}>{b.t(k.label)}</th>)}
                {firsts && <th scope="col" style={{ textAlign: 'left' }} title={b.t('books.newHint')}>{b.t('book.newCharacters')}</th>}
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => {
                const c = details.get(p.key);
                const newBook = i > 0 && points[i - 1].book !== p.book;
                return (
                  <tr key={p.key} className={newBook ? 'book-start' : undefined}>
                    <th scope="row" style={{ textAlign: 'left', fontWeight: 400 }}>
                      <div>{p.heading}</div>
                      <div className="small">{link(p)}</div>
                    </th>
                    {kinds.map((k) => <td key={k.id}><NameList list={c ? k.pick(c) : []} n={top} b={b} /></td>)}
                    {firsts && <td><NameList list={c?.newCharacters ?? []} n={top} b={b} /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <HeatMap points={points} details={details} pick={active.pick} b={b} />
      )}
      {mode === 'list' && firsts && <p className="small muted" style={{ margin: '8px 0 0' }}>{b.t('books.newHint')}</p>}
    </>
  );
}

/** One name per line, so long names wrap inside their column instead of running into the next one. */
function NameList({ list, n, b }: { list: Entry[]; n: number; b: Basics }) {
  if (list.length === 0) return <span className="muted">–</span>;
  return (
    <ol className="names-list">
      {list.slice(0, n).map((e) => (
        <li key={e.text}>
          {e.text} <span className="muted">{fmt.count(e.count, b.locale)}</span>
        </li>
      ))}
    </ol>
  );
}

const ROWS = 12;
const NAME_W = 132;

/**
 * The most mentioned names of the scope against its chapters. Each row has its own scale (darkest = that
 * name's busiest chapter), so a side character's arc shows as clearly as the lead's. Counts come from each
 * chapter's top 15, so an empty cell means "not among the chapter's most mentioned", not "never".
 */
function HeatMap({ points, details, pick, b }: { points: ChapterPoint[]; details: Map<string, Chapter>; pick: (c: Chapter) => Entry[]; b: Basics }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ style: React.CSSProperties; name: string; point: ChapterPoint; count: number } | null>(null);
  const counts = points.map((p) => {
    const c = details.get(p.key);
    return new Map((c ? pick(c) : []).map((e) => [e.text, e.count]));
  });
  const rows = mergeNames(counts.map((m) => [...m.entries()].map(([text, count]) => ({ text, count }))), ROWS).map((e) => e.text);
  const cell = Math.max(10, Math.min(22, Math.floor((width - NAME_W) / points.length)));
  const labelEvery = Math.max(1, Math.ceil(24 / cell));

  const show = (e: React.SyntheticEvent<HTMLElement>, name: string, point: ChapterPoint, count: number) => {
    const host = box.current?.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    if (!host) return;
    setTip({ style: tipBeside(r.left - host.left, r.right - host.left, host.width, r.top - host.top - 8), name, point, count });
  };

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <div ref={ref} className="table-wrap">
        <table className="heat" aria-label={b.t('books.map')}>
          <thead>
            <tr>
              <th scope="col" className="name-col"><span className="sr">{b.t('names.title')}</span></th>
              {points.map((p, i) => (
                <th key={p.key} scope="col" className={i > 0 && points[i - 1].book !== p.book ? 'start' : undefined} style={{ width: cell }}>
                  {i % labelEvery === 0 ? p.index + 1 : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((name) => {
              const max = Math.max(...counts.map((m) => m.get(name) ?? 0), 1);
              return (
                <tr key={name}>
                  <th scope="row" className="name-col" title={name}>{name}</th>
                  {points.map((p, i) => {
                    const n = counts[i].get(name) ?? 0;
                    const level = n === 0 ? 0 : Math.max(1, Math.ceil((n / max) * 4));
                    return (
                      <td
                        key={p.key}
                        className={`l${level}${i > 0 && points[i - 1].book !== p.book ? ' start' : ''}`}
                        style={{ width: cell, height: 18 }}
                        tabIndex={n > 0 ? 0 : -1}
                        aria-label={`${name}, ${p.heading}: ${n}`}
                        onMouseEnter={(e) => show(e, name, p, n)}
                        onFocus={(e) => show(e, name, p, n)}
                        onMouseLeave={() => setTip(null)}
                        onBlur={() => setTip(null)}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="heat-legend small muted">
        <span>{b.t('books.mapFew')}</span>
        {[1, 2, 3, 4].map((l) => <span key={l} className={`swatch l${l}`} />)}
        <span>{b.t('books.mapMany')}</span>
        <span>· {b.t('books.mapHint')}</span>
      </div>
      {tip && (
        <div className="tip" style={tip.style}>
          <div className="t">{tip.name}</div>
          <div className="row"><span>{tip.point.heading}</span><span>{tip.count > 0 ? fmt.count(tip.count, b.locale) : '–'}</span></div>
        </div>
      )}
    </div>
  );
}

/** Books or seasons side by side: how long, how wordy, how much dialogue, how much podcast per word. */
function GroupTable({ title, head, rows, b, href, onOpen }: {
  title: string;
  head: string;
  rows: GroupRow[];
  b: Basics;
  href: (r: GroupRow) => string;
  onOpen?: (r: GroupRow) => void;
}) {
  const paced = rows.some((r) => r.minutesPerKWords != null);
  const dash = (v: string | null) => v ?? '–';
  return (
    <section className="section">
      <h3>{title}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: 'left' }}>{head}</th>
              <th scope="col">{b.t('book.chapters')}</th>
              <th scope="col">{b.t('book.words')}</th>
              <th scope="col">{b.t('book.avgSentence')}</th>
              <th scope="col">{b.t('book.dialogue')}</th>
              {paced && <th scope="col">{b.t('book.pace')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row" style={{ textAlign: 'left', fontWeight: 400, whiteSpace: 'normal' }}>
                  <a href={href(r)} onClick={onOpen && ((e) => { e.preventDefault(); onOpen(r); })}>{r.title}</a>
                </th>
                <td>{fmt.count(r.chapters, b.locale)}</td>
                <td>{fmt.compact(r.words, b.locale)}</td>
                <td>{dash(r.avgSentence != null ? fmt.decimal(r.avgSentence, b.locale) : null)}</td>
                <td>{dash(r.dialogueShare != null ? fmt.percent(r.dialogueShare, b.locale) : null)}</td>
                {paced && <td>{dash(r.minutesPerKWords != null ? b.t('book.paceValue', { n: fmt.decimal(r.minutesPerKWords, b.locale) }) : null)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
