// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext, PluginI18n } from '@mosaicast/plugin-sdk';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadBundleSettings, loadIndex, loadSpeakers } from '../data';
import { bundleName, bundlesWithData, resolveBundles } from '../bundles';
import { booksByEpisode, podcastByEpisode } from '../combine';
import { useViewChoice } from '../viewChoice';
import { useI18n } from '../i18n';
import { isDark } from '../palette';
import { people, type People } from '../people';
import { CSS, type ICONS } from '../styles';
import type { Bundle, BundleSettings, SpeakerSettings, StatsIndex } from '../types';
import * as fmt from '../format';

export type IconName = (typeof ICONS)[number];

export function Icon({ name }: { name: IconName }) {
  return <span className={`ic ic-${name}`} aria-hidden="true" />;
}

/** Every element's root: the shared stylesheet plus its content. */
export function Root({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{CSS}</style>
      {children}
    </>
  );
}

export function LoadingBar({ label }: { label: string }) {
  return <div className="loading" role="progressbar" aria-label={label} aria-busy="true" />;
}

/** What most views need: translator, locale and the speaker lookup. */
export interface Basics {
  t: PluginI18n['t'];
  plural: PluginI18n['plural'];
  locale: string;
  who: People;
  /** The site's bundles (saved settings plus implicit defaults). */
  bundles: Bundle[];
  bundleName: (b: Bundle) => string;
}

/**
 * Loads the index and the speaker settings and builds the shared helpers. `index` is undefined while
 * loading and null when there are no stats yet.
 */
export function useSiteData(ctx: PluginContext, reload = 0) {
  const i18n = useI18n(ctx);
  const [index, setIndex] = useState<StatsIndex | null | undefined>(undefined);
  const [settings, setSettings] = useState<SpeakerSettings | null>(null);
  const [bundleSettings, setBundleSettings] = useState<BundleSettings | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([loadIndex(ctx), loadSpeakers(ctx), loadBundleSettings(ctx)])
      .then(([i, s, bs]) => {
        if (!live) return;
        setIndex(i);
        setSettings(s);
        setBundleSettings(bs);
      })
      .catch((e: unknown) => {
        if (!live) return;
        ctx.log('warn', `stats: could not load the index (${String(e)})`);
        setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [ctx.docs, reload]);
  const dark = isDark(ctx.theme);
  const basics: Basics = useMemo(() => {
    const t = i18n.t.bind(i18n);
    return {
      t,
      plural: i18n.plural.bind(i18n),
      locale: i18n.locale,
      who: people(settings, index ?? null, dark),
      bundles: resolveBundles(bundleSettings),
      bundleName: (b: Bundle) => bundleName(b, t),
    };
  }, [i18n, settings, index, dark, bundleSettings]);
  return { index, settings, bundleSettings, failed, basics };
}

/**
 * The visitor's bundle choice for a set of episodes, and the stats it selects: per episode, the chosen
 * podcast bundles combined, and the chosen book bundles. `picker` is ready to render (null when there is
 * nothing to choose).
 */
export function useSelection(ctx: PluginContext, b: Basics, index: StatsIndex | null | undefined, slugs: string[]) {
  const available = useMemo(() => bundlesWithData(b.bundles, index, slugs), [b.bundles, index, slugs]);
  const view = useViewChoice(ctx, available);
  const podcasts = useMemo(() => podcastByEpisode(index, view.selected), [index, view.selected]);
  const books = useMemo(() => booksByEpisode(index, view.selected), [index, view.selected]);
  const picker = (
    <BundlePicker
      available={available}
      selected={view.selected}
      spoilers={view.choice.spoilers}
      onToggle={view.toggle}
      onSpoilers={view.setSpoilers}
      b={b}
    />
  );
  return { available, selected: view.selected, spoilers: view.choice.spoilers, podcasts, books, picker };
}

/** Whether an episode has any published stats, in any bundle. */
export function hasStats(index: StatsIndex | null | undefined, slug: string): boolean {
  return !!(index?.episodes?.[slug] || index?.books?.[slug]);
}

/**
 * Which bundles to show, and whether spoilers are on. Only drawn when there is a choice to make: more than
 * one bundle with data here, or a spoiler bundle (whose box only appears once spoilers are on).
 */
export function BundlePicker({
  available,
  selected,
  spoilers,
  onToggle,
  onSpoilers,
  b,
}: {
  available: Bundle[];
  selected: Set<string>;
  spoilers: boolean;
  onToggle: (id: string) => void;
  onSpoilers: (on: boolean) => void;
  b: Basics;
}) {
  const hasSpoilers = available.some((x) => x.spoiler);
  const visible = available.filter((x) => spoilers || !x.spoiler);
  if (visible.length < 2 && !hasSpoilers) return null;
  return (
    <div className="picker" role="group" aria-label={b.t('bundle.pick')}>
      {visible.length > 1 && visible.map((x) => (
        <label key={x.id} className="check">
          <input type="checkbox" checked={selected.has(x.id)} onChange={() => onToggle(x.id)} />
          {b.bundleName(x)}
        </label>
      ))}
      {hasSpoilers && (
        <label className="check spoiler">
          <input type="checkbox" checked={spoilers} onChange={(e) => onSpoilers(e.target.checked)} />
          {b.t('bundle.showSpoilers')}
        </label>
      )}
    </div>
  );
}

/** Horizontal 100 % bar, one segment per person, plus a legend that always names them. */
export function ShareBar({
  parts,
  b,
  thin,
  legend = true,
  detail,
}: {
  parts: { key: string; share: number; label?: string; name?: string | null; seconds?: number }[];
  b: Basics;
  thin?: boolean;
  legend?: boolean;
  detail?: (key: string) => string | null;
}) {
  const shown = parts.filter((p) => p.share > 0);
  const summary = shown.map((p) => `${b.who(p.key, p).name} ${fmt.percent(p.share, b.locale)}`).join(', ');
  return (
    <div>
      <div className={thin ? 'share thin' : 'share'} role="img" aria-label={summary}>
        {shown.map((p) => (
          <span key={p.key} style={{ flex: `${p.share} 1 0`, background: b.who(p.key, p).color }} />
        ))}
      </div>
      {legend && (
        <div className="legend">
          {shown.map((p) => {
            const person = b.who(p.key, p);
            const extra = detail?.(p.key);
            return (
              <span className="item" key={p.key}>
                <span className="swatch" style={{ background: person.color }} />
                <span>{person.name}</span>
                <span className="value">
                  {fmt.percent(p.share, b.locale)}
                  {extra ? ` · ${extra}` : ''}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Widest a tooltip gets (`.tip` max-width), for deciding which side it fits on. */
const TIP_WIDTH = 260;

/**
 * Where a tooltip goes so it never covers what it describes: right of the hovered mark, or left of it
 * when there's no room on the right. `left`/`right` are the mark's edges, `width` the box it lives in.
 */
export function tipBeside(left: number, right: number, width: number, top: number): React.CSSProperties {
  return right + 10 + TIP_WIDTH <= width || left - 10 - TIP_WIDTH < 0
    ? { left: right + 10, top }
    : { left: left - 10, top, transform: 'translateX(-100%)' };
}

export interface TileSpec {
  label: string;
  value: string;
  sub?: string;
}

export function Tiles({ tiles, compact }: { tiles: (TileSpec | null | false | 0 | undefined)[]; compact?: boolean }) {
  return (
    <div className={compact ? 'tiles compact' : 'tiles'}>
      {tiles.filter((t): t is TileSpec => !!t).map((t) => (
        <div className="tile" key={t.label}>
          <div className="label">{t.label}</div>
          <div className="value">{t.value}</div>
          {t.sub && <div className="sub">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** Entity labels worth showing, in this order, with their heading key. */
export const ENTITY_LABELS: [string, string][] = [
  ['PERSON', 'names.people'],
  ['LOCATION', 'names.places'],
  ['ORGANIZATION', 'names.groups'],
];

export function TopNames({
  groups,
  b,
  limit = 12,
}: {
  groups: Record<string, { text: string; count: number }[]>;
  b: Basics;
  limit?: number;
}) {
  // A name mentioned once is mostly noise, unless that's all there is.
  const worth = <T extends { count: number }>(list: T[] = []): T[] => (list.filter((e) => e.count > 1).length >= 3 ? list.filter((e) => e.count > 1) : list);
  const present = ENTITY_LABELS.filter(([label]) => worth(groups[label]).length > 0);
  if (present.length === 0) return null;
  return (
    <div className="names">
      {present.map(([label, heading]) => (
        <div key={label} className="section" style={{ marginTop: 12 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>{b.t(heading)}</div>
          <ul className="chips" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {worth(groups[label]).slice(0, limit).map((e) => (
              <li className="chip" key={e.text}>
                {e.text}
                <span className="n">{fmt.count(e.count, b.locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The width of an element, following resizes. Falls back to `fallback` where nothing can be measured. */
export function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Whether the host has handed over the scope's episodes yet. A slot is mounted before the host has
 * resolved them, so the first `ctx` has an empty list; treat that as loading for a moment instead of
 * flashing "no stats".
 */
export function useEpisodesReady(ctx: PluginContext, graceMs = 2500): boolean {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), graceMs);
    return () => clearTimeout(timer);
  }, [graceMs]);
  return ctx.episodes.length > 0 || waited;
}

/** A short label for an episode: the host's "S05E01" (or "S05") part if there is one, else the label itself. */
export function shortLabel(slug: string, labels?: Record<string, string>): string {
  const label = labels?.[slug];
  if (!label) return slug;
  const m = /^(S\d+(?:E\d+)?|E\d+)\s·/.exec(label);
  return m ? m[1] : label;
}

/** The label without the "S05E01 · " part. */
export function titleOf(slug: string, labels?: Record<string, string>): string {
  const label = labels?.[slug];
  return label ? label.replace(/^(S\d+(?:E\d+)?|E\d+)\s·\s/, '') : slug;
}
