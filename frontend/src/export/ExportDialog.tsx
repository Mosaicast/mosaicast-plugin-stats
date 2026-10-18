// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { createPluginI18n, type PluginContext } from '@mosaicast/plugin-sdk';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { bookOf } from '../book';
import { bundleName, bundlesWithData, resolveBundles } from '../bundles';
import { booksByEpisode, podcastByEpisode } from '../combine';
import { Icon, shortLabel, titleOf, type Basics } from '../components/common';
import { CATALOGS } from '../i18n';
import { people } from '../people';
import type { BundleSettings, SpeakerSettings, StatsIndex } from '../types';
import {
  BACKGROUNDS,
  contrast,
  DENSITIES,
  FONT_IDS,
  isDark,
  pageDesign,
  PRESET_IDS,
  presetColors,
  sanitizeDesign,
  SERIES_MODES,
  type Design,
} from './design';
import type { ExportScope } from './ExportContext';
import { FILE_TYPES, fileTypeById, FORMATS, formatById } from './formats';
import { Frame } from './frame';
import { ITEMS, optionValues, type Choice, type ExportData, type Opts } from './items';
import { makeKit } from './kit';
import { dataUrl, loadLogo, loadPreset, LOGO_MAX_BYTES, LOGO_TYPES, savePreset, sniffImage, type ExportPreset } from './preset';
import { canShareFiles, download, exportFile, fileName, share } from './render';

type Status = { kind: 'ok' | 'bad' | 'busy'; text: string } | null;

/**
 * The export dialog: what to export and from which bundles, the image's size, language, texts and look,
 * a live preview that is the image itself, and Download / Share. The look can be saved as the site's
 * default (`export` doc), which is where the dialog starts next time, for every podcaster.
 */
export function ExportDialog({ ctx, index, settings, bundleSettings, selected: pageSelected, scope, item: firstItem, ui, onClose }: {
  ctx: PluginContext;
  index: StatsIndex;
  settings: SpeakerSettings | null;
  bundleSettings: BundleSettings | null;
  selected: Set<string>;
  scope: ExportScope;
  item: string;
  /** The page's translator: the dialog speaks the page's language, the image its own. */
  ui: Basics;
  onClose: () => void;
}) {
  const t = ui.t;
  const dialog = useRef<HTMLDialogElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const host = typeof location !== 'undefined' ? location.host : '';
  const pageLook = useMemo(() => pageDesign(ctx.theme, host), [ctx.theme, host]);

  const [preset, setPreset] = useState<ExportPreset | null | undefined>(undefined);
  const [design, setDesign] = useState<Design>(pageLook);
  const [formatId, setFormatId] = useState('story');
  const [fileTypeId, setFileTypeId] = useState('png');
  const [lang, setLang] = useState(() => pickLang(ctx.locale.current()));
  const [itemId, setItemId] = useState(firstItem);
  const [opts, setOpts] = useState<Record<string, Opts>>({});
  const [texts, setTexts] = useState<{ headline: string | null; subline: string | null }>({ headline: null, subline: null });
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(pageSelected));
  const [spoilers, setSpoilers] = useState(false);
  const [logo, setLogo] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);

  // Open as a modal; Escape and the close button both end up in onClose.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (typeof el.showModal === 'function' && !el.open) el.showModal();
    else el.setAttribute('open', '');
    return () => {
      if (typeof el.close === 'function' && el.open) el.close();
    };
  }, []);

  // The site's saved default, and its logo.
  useEffect(() => {
    let live = true;
    void loadPreset(ctx).then((p) => {
      if (!live) return;
      setPreset(p);
      if (p?.design) setDesign(sanitizeDesign(p.design, pageLook));
      if (p?.format) setFormatId(formatById(p.format).id);
      if (p?.fileType) setFileTypeId(fileTypeById(p.fileType).id);
      if (p?.logo?.ref) void loadLogo(ctx, p.logo.ref).then((url) => live && setLogo(url));
    });
    return () => {
      live = false;
    };
    // Once per opening.
  }, []);

  // Bundles: the dialog's own choice, starting from the page's.
  const all = useMemo(() => bundlesWithData(resolveBundles(bundleSettings), index, scope.slugs), [bundleSettings, index, scope.slugs]);
  useEffect(() => {
    if (all.some((x) => x.spoiler && pageSelected.has(x.id))) setSpoilers(true);
  }, [all, pageSelected]);
  const visible = all.filter((x) => spoilers || !x.spoiler);
  const effective = useMemo(() => new Set(visible.filter((x) => chosen.has(x.id)).map((x) => x.id)), [visible, chosen]);
  const signature = [...effective].sort().join(',');
  const podcasts = useMemo(() => podcastByEpisode(index, effective), [index, signature]);
  const books = useMemo(() => booksByEpisode(index, effective), [index, signature]);

  // The image's own translator and speaker colours (for its background, not the page's).
  const ground = design.cards ? design.surface : design.bg;
  const imgB = useMemo<Basics>(() => {
    const i18n = createPluginI18n(CATALOGS, { current: () => lang, onChange: () => () => {} });
    const tr = i18n.t.bind(i18n);
    return {
      t: tr,
      plural: i18n.plural.bind(i18n),
      bytes: i18n.bytes.bind(i18n),
      locale: i18n.locale,
      who: people(settings, index, isDark(ground)),
      bundles: resolveBundles(bundleSettings),
      bundleName: (x) => bundleName(x, tr),
    };
  }, [lang, settings, index, ground, bundleSettings]);

  const data = useMemo<ExportData>(() => ({
    area: scope.area,
    slugs: scope.slugs,
    podcasts,
    books,
    labels: ctx.episodeLabels,
    seasonOf: scope.seasonOf,
    only: scope.only,
    slug: scope.slug,
    b: imgB,
    scopeLabel: scopeLabel(scope, imgB, index, ctx.episodeLabels),
  }), [scope, podcasts, books, ctx.episodeLabels, imgB, index]);

  // Every item of this area that has something to show, with its options settled.
  const items = useMemo(() => ITEMS.filter((x) => x.area === scope.area).flatMap((x) => {
    const o = optionValues(x, data, opts[x.id] ?? {});
    const model = x.build(data, o);
    return model == null ? [] : [{ item: x, opts: o, model }];
  }), [scope.area, data, opts]);
  const current = items.find((x) => x.item.id === itemId) ?? items[0];

  const format = formatById(formatId);
  const fileType = fileTypeById(fileTypeId);
  const k = useMemo(() => makeKit(design, Math.min(format.width, format.height), imgB), [design, format, imgB]);
  const url = `${typeof location !== 'undefined' ? location.origin : ''}${scope.path}`;
  const defaults = current
    ? { headline: current.item.headline(current.model, data, current.opts), subline: current.item.subline?.(current.model, data, current.opts) ?? data.scopeLabel }
    : { headline: '', subline: '' };
  const headline = texts.headline ?? defaults.headline;
  const subline = texts.subline ?? defaults.subline;
  const badge = all.some((x) => x.spoiler && effective.has(x.id)) ? imgB.t('export.spoilerBadge') : null;

  const set = <K extends keyof Design>(key: K, value: Design[K]) => setDesign((d) => ({ ...d, [key]: value }));
  const pick = (id: string) => {
    setItemId(id);
    setTexts({ headline: null, subline: null });
  };

  const save = async (how: 'download' | 'share') => {
    if (!svg.current || !current) return;
    setStatus({ kind: 'busy', text: t('export.working') });
    try {
      const name = fileName('stats', current.item.id.replace('.', '-'), data.scopeLabel, format.id);
      const file = await exportFile(svg.current, format.width, format.height, fileType, name);
      if (how === 'share') {
        await share(file, headline);
        setStatus(null);
      } else {
        download(file, dialog.current ?? document.body);
        setStatus({ kind: 'ok', text: t('export.downloaded', { name: file.name }) });
      }
    } catch (e) {
      ctx.log('warn', `stats: export failed (${String(e)})`);
      setStatus({ kind: 'bad', text: t('export.failed') });
    }
  };

  const saveDefault = async () => {
    const next: ExportPreset = { ...(preset ?? {}), design, format: format.id, fileType: fileType.id };
    try {
      await savePreset(ctx, next);
      setPreset(next);
      setStatus({ kind: 'ok', text: t('export.savedDefault') });
    } catch (e) {
      ctx.log('warn', `stats: could not save the export default (${String(e)})`);
      setStatus({ kind: 'bad', text: t('error.save') });
    }
  };

  const uploadLogo = async (file: File) => {
    if (!ctx.blobs) return;
    const type = sniffImage(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
    if (!type) return setStatus({ kind: 'bad', text: t('export.logo.badType') });
    if (file.size > LOGO_MAX_BYTES) return setStatus({ kind: 'bad', text: t('export.logo.tooBig', { max: ui.bytes(LOGO_MAX_BYTES) }) });
    setStatus({ kind: 'busy', text: t('export.logo.uploading') });
    try {
      const stored = await ctx.blobs.upload(file);
      const old = preset?.logo?.ref;
      const next: ExportPreset = { ...(preset ?? {}), logo: { ref: stored.ref, mime: stored.mime } };
      await savePreset(ctx, next);
      setPreset(next);
      setLogo(await dataUrl(new Blob([await file.arrayBuffer()], { type })));
      set('showLogo', true);
      if (old && old !== stored.ref) await ctx.blobs.remove(old).catch(() => undefined);
      setStatus({ kind: 'ok', text: t('export.logo.saved') });
    } catch (e) {
      ctx.log('warn', `stats: logo upload failed (${String(e)})`);
      setStatus({ kind: 'bad', text: t('export.logo.failed') });
    }
  };

  const removeLogo = async () => {
    const old = preset?.logo?.ref;
    const next: ExportPreset = { ...(preset ?? {}), logo: null };
    try {
      await savePreset(ctx, next);
      setPreset(next);
      setLogo(null);
      if (old) await ctx.blobs?.remove(old).catch(() => undefined);
    } catch {
      setStatus({ kind: 'bad', text: t('error.save') });
    }
  };

  const ratio = contrast(design.text, ground);
  const label = (c: Choice) => c.text ?? t(c.key ?? '', c.params);
  const shareable = useMemo(() => canShareFiles(new File([''], `x.${fileType.ext}`, { type: fileType.mime })), [fileType]);

  return (
    <dialog ref={dialog} className="export" aria-labelledby="export-title" onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="export-layout">
        <div className="export-side">
          <div className="row-head" style={{ marginBottom: 12 }}>
            <h2 id="export-title" style={{ fontSize: '1.1rem' }}>{t('export.dialogTitle')}</h2>
            <button type="button" className="btn" onClick={onClose} aria-label={t('export.close')}><Icon name="close" /></button>
          </div>

          <fieldset>
            <legend>{t('export.what')}</legend>
            <Field label={t('export.stat')}>
              <select value={current?.item.id ?? ''} onChange={(e) => pick(e.target.value)} disabled={items.length === 0}>
                {items.map((x) => <option key={x.item.id} value={x.item.id}>{t(x.item.label)}</option>)}
              </select>
            </Field>
            {current && (current.item.options?.(data) ?? []).filter((o) => o.choices.length > 1).map((o) => (
              <Field key={o.id} label={t(o.label)}>
                <select value={current.opts[o.id]} onChange={(e) => {
                  setOpts((all) => ({ ...all, [current.item.id]: { ...current.opts, [o.id]: e.target.value } }));
                  setTexts({ headline: null, subline: null });
                }}>
                  {o.choices.map((c) => <option key={c.value} value={c.value}>{label(c)}</option>)}
                </select>
              </Field>
            ))}
            {(visible.length > 1 || all.some((x) => x.spoiler)) && (
              <div className="toggles" role="group" aria-label={t('bundle.pick')}>
                <div className="small muted">{t('bundle.pick')}</div>
                {visible.length > 1 && visible.map((x) => (
                  <label key={x.id}>
                    <input type="checkbox" checked={chosen.has(x.id)} onChange={() => setChosen((s) => toggled(s, x.id))} />
                    {ui.bundleName(x)}
                  </label>
                ))}
                {all.some((x) => x.spoiler) && (
                  <label>
                    <input type="checkbox" checked={spoilers} onChange={(e) => {
                      const on = e.target.checked;
                      setSpoilers(on);
                      setChosen((s) => {
                        const next = new Set(s);
                        for (const x of all) if (x.spoiler) on ? next.add(x.id) : next.delete(x.id);
                        return next;
                      });
                    }} />
                    {t('bundle.showSpoilers')}
                  </label>
                )}
              </div>
            )}
            <Field label={t('export.language')}>
              <select value={lang} onChange={(e) => { setLang(e.target.value); setTexts({ headline: null, subline: null }); }}>
                {Object.keys(CATALOGS).map((l) => <option key={l} value={l}>{languageName(l, ui.locale)}</option>)}
              </select>
            </Field>
          </fieldset>

          <fieldset>
            <legend>{t('export.format')}</legend>
            <div className="chips" role="group" aria-label={t('export.format')}>
              {FORMATS.map((f) => (
                <button key={f.id} type="button" className="chip" aria-pressed={f.id === format.id} onClick={() => setFormatId(f.id)}>
                  {t(`export.format.${f.id}`)} <span className="n">{f.width}×{f.height}</span>
                </button>
              ))}
            </div>
            {format.safe.top > 0 && <p className="tiny muted" style={{ margin: '6px 0 0' }}>{t('export.safeHint')}</p>}
            <div className="chips" role="group" aria-label={t('export.fileType')} style={{ marginTop: 10 }}>
              {FILE_TYPES.map((f) => (
                <button key={f.id} type="button" className="chip" aria-pressed={f.id === fileType.id} onClick={() => setFileTypeId(f.id)}>
                  {f.ext.toUpperCase()}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>{t('export.texts')}</legend>
            <Field label={t('export.headline')}>
              <input type="text" value={headline} maxLength={140} onChange={(e) => setTexts((x) => ({ ...x, headline: e.target.value }))} />
            </Field>
            <Field label={t('export.subline')}>
              <input type="text" value={subline} maxLength={200} onChange={(e) => setTexts((x) => ({ ...x, subline: e.target.value }))} />
            </Field>
            <Field label={t('export.brand')}>
              <input type="text" value={design.brand} maxLength={80} onChange={(e) => set('brand', e.target.value)} />
            </Field>
            <div className="toggles">
              <Check on={design.showBrand} set={(v) => set('showBrand', v)}>{t('export.show.brand')}</Check>
              {logo && <Check on={design.showLogo} set={(v) => set('showLogo', v)}>{t('export.show.logo')}</Check>}
              <Check on={design.showLink} set={(v) => set('showLink', v)}>{t('export.show.link')}</Check>
              <Check on={design.showQr} set={(v) => set('showQr', v)}>{t('export.show.qr')}</Check>
            </div>
          </fieldset>

          <fieldset>
            <legend>{t('export.colors')}</legend>
            <div className="chips" role="group" aria-label={t('export.colors')}>
              {PRESET_IDS.map((id) => (
                <button key={id} type="button" className="chip" onClick={() => setDesign((d) => ({ ...d, ...presetColors(id, ctx.theme) }))}>
                  {t(`export.preset.${id}`)}
                </button>
              ))}
            </div>
            <div className="swatches">
              {(['bg', ...(design.background === 'gradient' || design.background === 'glow' ? ['bg2'] : []), ...(design.cards ? ['surface'] : []), 'text', 'muted', 'accent', 'accentContrast'] as const).map((key) => (
                <label key={key} className="swatch-field">
                  <input type="color" value={design[key as keyof Design] as string} onChange={(e) => set(key as 'bg', e.target.value)} />
                  {t(`export.color.${key}`)}
                </label>
              ))}
            </div>
            {ratio < 4.5 && <p className="note warn small" style={{ marginTop: 8 }}><Icon name="warning" /> {t('export.contrastLow', { ratio: ratio.toFixed(1) })}</p>}
          </fieldset>

          <fieldset>
            <legend>{t('export.layout')}</legend>
            <Field label={t('export.background')}>
              <select value={design.background} onChange={(e) => set('background', e.target.value as Design['background'])}>
                {BACKGROUNDS.map((x) => <option key={x} value={x}>{t(`export.bg.${x}`)}</option>)}
              </select>
            </Field>
            {design.background === 'gradient' && (
              <Field label={`${t('export.angle')} (${design.angle}°)`}>
                <input type="range" min={0} max={360} step={5} value={design.angle} onChange={(e) => set('angle', Number(e.target.value))} />
              </Field>
            )}
            <Field label={t('export.font')}>
              <select value={design.font} onChange={(e) => set('font', e.target.value as Design['font'])}>
                {FONT_IDS.map((x) => <option key={x} value={x}>{t(`export.font.${x}`)}</option>)}
              </select>
            </Field>
            <Field label={`${t('export.scale')} (${Math.round(design.scale * 100)} %)`}>
              <input type="range" min={0.75} max={1.35} step={0.05} value={design.scale} onChange={(e) => set('scale', Number(e.target.value))} />
            </Field>
            <Field label={`${t('export.radius')} (${design.radius})`}>
              <input type="range" min={0} max={60} step={2} value={design.radius} onChange={(e) => set('radius', Number(e.target.value))} />
            </Field>
            <Field label={t('export.density')}>
              <select value={design.density} onChange={(e) => set('density', e.target.value as Design['density'])}>
                {DENSITIES.map((x) => <option key={x} value={x}>{t(`export.density.${x}`)}</option>)}
              </select>
            </Field>
            <Field label={t('export.series')}>
              <select value={design.series} onChange={(e) => set('series', e.target.value as Design['series'])}>
                {SERIES_MODES.map((x) => <option key={x} value={x}>{t(`export.series.${x}`)}</option>)}
              </select>
            </Field>
            <div className="toggles">
              <Check on={design.cards} set={(v) => set('cards', v)}>{t('export.show.cards')}</Check>
            </div>
          </fieldset>

          {ctx.blobs && (
            <fieldset>
              <legend>{t('export.logo')}</legend>
              <div className="controls" style={{ marginTop: 0 }}>
                {logo && <img src={logo} alt="" className="logo-thumb" />}
                <label className="btn">
                  <Icon name="upload" /> {t(logo ? 'export.logo.replace' : 'export.logo.upload')}
                  <input type="file" accept={LOGO_TYPES.join(',')} className="sr" onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void uploadLogo(f);
                  }} />
                </label>
                {logo && <button type="button" className="btn" onClick={() => void removeLogo()}><Icon name="delete" /> {t('export.logo.remove')}</button>}
              </div>
              <p className="tiny muted" style={{ margin: '6px 0 0' }}>{t('export.logo.hint', { max: ui.bytes(LOGO_MAX_BYTES) })}</p>
            </fieldset>
          )}

          <div className="controls">
            <button type="button" className="btn" onClick={() => void saveDefault()}><Icon name="save" /> {t('export.saveDefault')}</button>
            <button type="button" className="btn" onClick={() => setDesign({ ...pageLook, brand: design.brand })}><Icon name="undo" /> {t('export.reset')}</button>
          </div>
        </div>

        <div className="export-main">
          <Stage>
            {(fit) => current ? (
              <div style={{ width: format.width * fit(format.width, format.height), height: format.height * fit(format.width, format.height) }} className="export-canvas">
                <Frame ref={svg} format={format} k={k} logo={logo} url={url} label={headline}
                  texts={{ headline, subline, linkLabel: imgB.t('export.link'), badge }}>
                  {(box) => current.item.draw(current.model, box, k, current.opts)}
                </Frame>
              </div>
            ) : (
              <p className="muted">{t('export.nothing')}</p>
            )}
          </Stage>
          <div className="export-actions">
            <span className={`export-status small ${status?.kind === 'bad' ? 'bad' : ''}`} role="status">{status?.text ?? ''}</span>
            {shareable && (
              <button type="button" className="btn" disabled={!current || status?.kind === 'busy'} onClick={() => void save('share')}>
                <Icon name="share-native" /> {t('export.share')}
              </button>
            )}
            <button type="button" className="btn primary" disabled={!current || status?.kind === 'busy'} onClick={() => void save('download')}>
              <Icon name="download" /> {t('export.download')}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Check({ on, set, children }: { on: boolean; set: (v: boolean) => void; children: ReactNode }) {
  return (
    <label>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      {children}
    </label>
  );
}

/**
 * The preview area: measures itself and hands the content a scale that fits a given size into it, so the
 * whole image is always visible, whatever the format.
 */
function Stage({ children }: { children: (fit: (w: number, h: number) => number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 480 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = (w: number, h: number) => Math.max(0.05, Math.min((size.w - 32) / w, (size.h - 32) / h));
  return <div ref={ref} className="export-stage">{children(fit)}</div>;
}

function toggled(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The page's language if the plugin speaks it, else English. */
function pickLang(current: string): string {
  const base = current.toLowerCase().split(/[-_]/)[0];
  return base in CATALOGS ? base : 'en';
}

function languageName(code: string, locale: string): string {
  try {
    const own = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    const here = new Intl.DisplayNames([locale], { type: 'language' }).of(code);
    return own && here && own !== here ? `${own} (${here})` : own ?? code;
  } catch {
    return code;
  }
}

/** Where the stats are, in the image's language: the subline's default. */
function scopeLabel(scope: ExportScope, b: Basics, index: StatsIndex, labels?: Record<string, string>): string {
  if (scope.area === 'episode') return scope.slug ? shortLabel(scope.slug, labels) || titleOf(scope.slug, labels) : '';
  if (scope.area === 'book') {
    if (scope.only) {
      for (const byBundle of Object.values(index.books ?? {})) {
        for (const s of Object.values(byBundle)) if (bookOf(s) === scope.only && s.title) return s.title;
      }
      return scope.only;
    }
    return scope.season != null ? `${b.t('seasons.label', { n: scope.season })} · ${b.t('books.tab')}` : b.t('books.tab');
  }
  return scope.season != null ? b.t('seasons.label', { n: scope.season }) : b.t('export.scope.all');
}

