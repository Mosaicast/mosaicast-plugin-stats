// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { ReactNode } from 'react';
import { aggregate, LAUGHTER, type SpeakerTotal } from '../aggregate';
import {
  bookOf,
  chapterGroups,
  chapterPoints,
  chapterRankings,
  mergeEntities,
  mergeNames,
  sentenceTotals,
  aggregateBooks,
  type ChapterGroupRow,
  type ChapterPoint,
} from '../book';
import { ENTITY_LABELS, shortLabel, titleOf, type Basics } from '../components/common';
import { groupRecords } from '../components/ChapterGroups';
import { chapterValue, EXTRA, VALUE } from '../components/recordValues';
import * as fmt from '../format';
import { podcastRankings, type Entry, type Ranking } from '../records';
import { bySeason, type SeasonLookup } from '../seasons';
import type { BookSummary, EpisodeStats } from '../types';
import {
  BarList,
  Chips,
  Columns,
  Donut,
  isWide,
  Legend,
  niceTicks,
  Panel,
  pad,
  inset,
  RankList,
  ShareBar,
  split,
  StatGrid,
  fmtShare,
  type BarRow,
  type Box,
  type Kit,
  type Part,
  type RankRow,
  type Tile,
} from './kit';

/**
 * What can be exported. Each item turns the stats in view into a small model (`build`) and draws that
 * model into whatever box the frame leaves (`draw`). A new export is one more entry in `ITEMS` plus its
 * texts in `locales/*.json`; the dialog, the formats and the design apply to it without changes.
 */

/** Where an export button sits: the podcast stats of a scope, the books of a scope, or one episode. */
export type ExportArea = 'podcast' | 'book' | 'episode';

/** The stats an item can draw from, with the bundle choice already applied. */
export interface ExportData {
  area: ExportArea;
  /** Episodes in view, newest first (as the host lists them). */
  slugs: string[];
  /** Per episode, the chosen podcast bundles combined. */
  podcasts: Record<string, EpisodeStats>;
  /** Per episode, the chosen book bundles. */
  books: Record<string, BookSummary>;
  labels?: Record<string, string>;
  /** For the whole show: which season each episode belongs to. */
  seasonOf?: SeasonLookup;
  /** Books page of one book: its URL name. */
  only?: string | null;
  /** Episode page: the episode. */
  slug?: string | null;
  /** In the image's language, with speaker colours for the image's background. */
  b: Basics;
  /** Where these stats are, said the way the subline says it ("Season 5", "All seasons", a book). */
  scopeLabel: string;
}

/** One value of an option. The label is shown in the dialog, in the page's language. */
export interface Choice {
  value: string;
  /** Translation key… */
  key?: string;
  params?: Record<string, string | number>;
  /** …or a literal text (a chapter group's name). */
  text?: string;
}

export interface ExportOption {
  id: string;
  /** Translation key. */
  label: string;
  choices: Choice[];
}

export type Opts = Record<string, string>;

export interface ExportItem<M = unknown> {
  id: string;
  area: ExportArea;
  /** Translation key for the dialog's list. */
  label: string;
  /** Choices the item offers for the stats in view; the first choice of each is the default. */
  options?: (data: ExportData) => ExportOption[];
  /** The model to draw, or null when the stats in view have nothing for this item. */
  build: (data: ExportData, opts: Opts) => M | null;
  headline: (model: M, data: ExportData, opts: Opts) => string;
  /** Defaults to the scope. */
  subline?: (model: M, data: ExportData, opts: Opts) => string;
  draw: (model: M, box: Box, k: Kit, opts: Opts) => ReactNode;
}

const define = <M,>(item: ExportItem<M>) => item as unknown as ExportItem<unknown>;

/** The options' values: what was picked where it's still valid, else each option's first choice. */
export function optionValues(item: ExportItem, data: ExportData, picked: Opts): Opts {
  const out: Opts = {};
  for (const o of item.options?.(data) ?? []) {
    out[o.id] = o.choices.some((c) => c.value === picked[o.id]) ? picked[o.id] : o.choices[0]?.value ?? '';
  }
  return out;
}

// ---- shared bits ---------------------------------------------------------------------------------------

/** Speakers beyond this many are drawn together as "others". */
const MAX_PEOPLE = 6;

interface Speaker {
  key: string;
  name: string;
  share: number;
  seconds: number;
}

/** Below this share someone joins "others": a stray label that spoke for seconds isn't worth a legend row. */
const MIN_SHARE = 0.01;

function speakers(list: { key: string; label?: string; name?: string | null; share: number; seconds: number }[], b: Basics): Speaker[] {
  const sorted = list.filter((s) => s.share > 0).sort((x, y) => y.share - x.share);
  const main = sorted.filter((s) => s.share >= MIN_SHARE).slice(0, MAX_PEOPLE);
  const out = main.map((s) => ({ key: s.key, name: b.who(s.key, s).name, share: s.share, seconds: s.seconds }));
  const rest = sorted.filter((s) => !main.includes(s));
  if (rest.reduce((a, s) => a + s.share, 0) >= 0.005) {
    out.push({ key: '', name: b.t('export.others'), share: rest.reduce((a, s) => a + s.share, 0), seconds: rest.reduce((a, s) => a + s.seconds, 0) });
  }
  return out;
}

const parts = (list: Speaker[], k: Kit, detail?: (s: Speaker) => string): Part[] =>
  list.map((s, i) => ({ key: s.key || `others-${i}`, name: s.name, share: s.share, color: s.key ? k.color(i, s.key) : k.d.muted, detail: detail?.(s) }));

const fromTotals = (list: SpeakerTotal[]) => list.map((s) => ({ key: s.key, label: s.label, name: s.name, share: s.share, seconds: s.seconds }));
const fromEpisode = (s: EpisodeStats) => s.speakers.map((x) => ({ key: x.key, label: x.label, name: x.name, share: x.share, seconds: x.speakingSeconds }));

/** Content on a card (when the design has cards), inset by the card's padding. */
function onCard(k: Kit, box: Box, inner: (box: Box) => ReactNode): ReactNode {
  return (
    <>
      <Panel k={k} box={box} />
      {inner(inset(box, pad(k)))}
    </>
  );
}

/** Numbers and a share bar: side by side when wide, stacked otherwise. */
function tilesAndShares(k: Kit, box: Box, tiles: Tile[], people: Speaker[], detail?: (s: Speaker) => string): ReactNode {
  if (people.length === 0) return <StatGrid k={k} box={box} tiles={tiles} />;
  const gap = 32 * k.g;
  // Stacked, the share card takes what its bar and legend need and the numbers get the rest.
  const shareH = Math.min(box.h * 0.4, 100 * k.g + people.length * 80 * k.u + 2 * pad(k));
  const [a, c] = isWide(box) ? split(box, [1.25, 1], gap, 'cols') : split(box, [box.h - shareH - gap, shareH], gap, 'rows');
  return (
    <>
      <StatGrid k={k} box={a} tiles={tiles} maxCols={3} />
      {onCard(k, c, (inner) => <ShareBar k={k} box={inner} parts={parts(people, k, detail)} />)}
    </>
  );
}

/** A ring with the legend beside or below it. */
function donutAndLegend(k: Kit, box: Box, people: Speaker[], center: { value: string; label: string }, detail: (s: Speaker) => string): ReactNode {
  const ps = parts(people, k, detail);
  const wide = box.w > box.h * 1.2;
  const gap = 40 * k.g;
  // The legend's card as tall as its rows: beside the ring centred on it, below it the ring gets the rest.
  const needed = ps.length * 96 * k.u + 2 * pad(k);
  const below = Math.min(needed, box.h * 0.45);
  const [ring, legend] = wide ? split(box, [1, 1.2], gap, 'cols') : split(box, [box.h - below - gap, below], gap, 'rows');
  const r = Math.min(ring.w, ring.h) / 2;
  const card = wide && needed < legend.h ? { ...legend, y: legend.y + (legend.h - needed) / 2, h: needed } : legend;
  return (
    <>
      <Donut k={k} cx={ring.x + ring.w / 2} cy={ring.y + ring.h / 2} r={r} parts={ps} center={center} />
      {onCard(k, card, (inner) => (
        <Legend k={k} box={inner} cols={1} rows={ps.map((p) => ({ color: p.color, name: p.name, value: fmtShare(p.share, k), detail: p.detail }))} />
      ))}
    </>
  );
}

function bars(k: Kit, box: Box, rows: BarRow[]): ReactNode {
  return onCard(k, box, (inner) => <BarList k={k} box={inner} rows={rows} />);
}

function ranks(k: Kit, box: Box, rows: RankRow[]): ReactNode {
  return onCard(k, box, (inner) => <RankList k={k} box={inner} rows={rows} />);
}

const COUNT = (values: number[]): ExportOption => ({ id: 'count', label: 'export.opt.count', choices: values.map((n) => ({ value: String(n), text: String(n) })) });
const STYLE_NAMES: ExportOption = { id: 'style', label: 'export.opt.style', choices: [{ value: 'cloud', key: 'export.style.cloud' }, { value: 'bars', key: 'export.style.bars' }] };
const STYLE_PEOPLE: ExportOption = { id: 'style', label: 'export.opt.style', choices: [{ value: 'donut', key: 'export.style.donut' }, { value: 'bars', key: 'export.style.bars' }] };

/** Names worth showing: a name mentioned once is mostly noise, unless that's all there is. */
function worth<T extends { count: number }>(list: T[] = []): T[] {
  const more = list.filter((e) => e.count > 1);
  return more.length >= 3 ? more : list;
}

function names(k: Kit, box: Box, list: { text: string; count: number }[], style: string): ReactNode {
  if (style === 'bars') {
    return bars(k, box, list.map((e) => ({ label: e.text, value: e.count, display: fmt.count(e.count, k.b.locale) })));
  }
  return onCard(k, box, (inner) => <Chips k={k} box={inner} items={list} />);
}

const minutes = (b: Basics) => (v: number) => new Intl.NumberFormat(b.locale, { style: 'unit', unit: 'minute', unitDisplay: 'short', maximumFractionDigits: 0 }).format(v);

function plural(b: Basics, key: string, n: number): string {
  return b.plural(key, n);
}

function podcastSubline(data: ExportData, analysed: number): string {
  return `${data.scopeLabel} · ${plural(data.b, 'export.episodes', analysed)}`;
}

function holder(e: Entry, r: Ranking, data: ExportData): string {
  const name = e.key ? data.b.who(e.key).name : '';
  const episode = e.slug ? titleOf(e.slug, data.labels) : '';
  if (r.of === 'turn') return [name, episode].filter(Boolean).join(' · ');
  return r.of === 'speaker' ? name : episode;
}

function recordValue(e: Entry, r: Ranking, b: Basics): string {
  return e.split ? `${fmt.percent(e.split[0], b.locale)} : ${fmt.percent(e.split[1], b.locale)}` : VALUE[r.id](e.value, b);
}

// ---- podcast scope -------------------------------------------------------------------------------------

const podcastSummary = define({
  id: 'podcast.summary',
  area: 'podcast',
  label: 'export.item.summary',
  build: (data) => {
    const agg = aggregate(data.podcasts, data.slugs);
    if (agg.analysed === 0) return null;
    const b = data.b;
    const laughs = agg.events[LAUGHTER]?.count ?? 0;
    const tiles: Tile[] = [
      { label: b.t('tile.analysed'), value: fmt.count(agg.analysed, b.locale), sub: b.t('tile.ofTotal', { total: fmt.count(agg.total, b.locale) }) },
      agg.durationSeconds > 0 && { label: b.t('tile.total'), value: fmt.span(agg.durationSeconds, b.locale) },
      agg.durationSeconds > 0 && { label: b.t('tile.average'), value: fmt.clock(agg.durationSeconds / agg.analysed) },
      agg.words > 0 && { label: b.t('tile.words'), value: fmt.compact(agg.words, b.locale) },
      laughs > 0 && { label: b.t('tile.laughs'), value: fmt.count(laughs, b.locale), sub: agg.durationSeconds > 0 ? b.t('tile.perHour', { n: fmt.decimal(laughs / (agg.durationSeconds / 3600), b.locale) }) : undefined },
      agg.questions > 0 && { label: b.t('tile.questions'), value: fmt.compact(agg.questions, b.locale) },
    ].filter((t): t is Tile => !!t);
    return { tiles, people: speakers(fromTotals(agg.speakers), b), analysed: agg.analysed };
  },
  headline: (_m, data) => data.b.t('export.title.summary'),
  subline: (m, data) => podcastSubline(data, m.analysed),
  draw: (m, box, k) => tilesAndShares(k, box, m.tiles, m.people),
});

const podcastSpeakers = define({
  id: 'podcast.speakers',
  area: 'podcast',
  label: 'export.item.speakers',
  options: () => [STYLE_PEOPLE],
  build: (data) => {
    const agg = aggregate(data.podcasts, data.slugs);
    const people = speakers(fromTotals(agg.speakers), data.b);
    return people.length ? { people, seconds: agg.speakers.reduce((a, s) => a + s.seconds, 0), analysed: agg.analysed } : null;
  },
  headline: (_m, data) => data.b.t('export.title.speakers'),
  subline: (m, data) => podcastSubline(data, m.analysed),
  draw: (m, box, k, opts) => {
    const detail = (s: Speaker) => fmt.span(s.seconds, k.b.locale);
    if (opts.style === 'bars') {
      return bars(k, box, parts(m.people, k).map((p, i) => ({ label: p.name, value: p.share, display: fmtShare(p.share, k), color: p.color, sub: detail(m.people[i]) })));
    }
    return donutAndLegend(k, box, m.people, { value: fmt.span(m.seconds, k.b.locale), label: k.b.t('speakers.title') }, detail);
  },
});

const podcastTrend = define({
  id: 'podcast.trend',
  area: 'podcast',
  label: 'export.item.trend',
  options: () => [{
    id: 'metric',
    label: 'export.opt.metric',
    choices: [{ value: 'shares', key: 'chart.shares' }, { value: 'lengths', key: 'chart.lengths' }, { value: 'laughs', key: 'export.metric.laughs' }],
  }],
  build: (data) => {
    const agg = aggregate(data.podcasts, data.slugs);
    if (agg.points.length < 2) return null;
    return { agg, points: [...agg.points].reverse(), people: speakers(fromTotals(agg.speakers), data.b), labels: data.labels };
  },
  headline: (_m, data, opts) => data.b.t(opts.metric === 'lengths' ? 'chart.lengths' : opts.metric === 'laughs' ? 'export.metric.laughs' : 'chart.shares'),
  subline: (m, data) => podcastSubline(data, m.agg.analysed),
  draw: (m, box, k, opts) => {
    const label = (slug: string) => shortLabel(slug, m.labels);
    if (opts.metric === 'lengths' || opts.metric === 'laughs') {
      const value = (p: (typeof m.points)[number]) => (opts.metric === 'lengths' ? (p.durationSeconds ?? 0) / 60 : p.laughs);
      const ticks = niceTicks(Math.max(...m.points.map(value), 1));
      const tick = opts.metric === 'lengths' ? minutes(k.b) : (v: number) => fmt.count(v, k.b.locale);
      return onCard(k, box, (inner) => (
        <Columns k={k} box={inner} columns={m.points.map((p) => ({ label: label(p.slug), parts: [{ value: value(p), color: k.d.accent }] }))}
          max={ticks[ticks.length - 1]} ticks={ticks} tickLabel={tick} />
      ));
    }
    const keys = m.people.map((s) => s.key);
    const colors = parts(m.people, k);
    const legendRows = Math.ceil(m.people.length / (isWide(box) ? 3 : 2));
    const [legend, chart] = split(box, [legendRows * 64 * k.u, Math.max(box.h - legendRows * 64 * k.u, 1)], 24 * k.g, 'rows');
    return (
      <>
        <Legend k={k} box={legend} cols={isWide(box) ? 3 : 2} rows={colors.map((p) => ({ color: p.color, name: p.name, value: fmtShare(p.share, k) }))} />
        {onCard(k, chart, (inner) => (
          <Columns k={k} box={inner} max={1} ticks={[0, 0.5, 1]} tickLabel={(v) => fmtShare(v, k)}
            columns={m.points.map((p) => {
              const known = keys.filter(Boolean).reduce((a, key) => a + (p.shares[key] ?? 0), 0);
              return {
                label: label(p.slug),
                parts: colors.map((c, i) => ({ value: keys[i] ? p.shares[keys[i]] ?? 0 : Math.max(0, 1 - known), color: c.color })),
              };
            })} />
        ))}
      </>
    );
  },
});

const podcastRecords = define({
  id: 'podcast.records',
  area: 'podcast',
  label: 'export.item.records',
  options: () => [COUNT([6, 4, 8])],
  build: (data) => {
    const agg = aggregate(data.podcasts, data.slugs);
    if (agg.analysed < 2) return null;
    const rankings = podcastRankings(data.podcasts, data.slugs, agg.speakers);
    if (rankings.length === 0) return null;
    const tiles = rankings.map((r): Tile => ({ label: data.b.t(`records.${r.id}`), value: recordValue(r.entries[0], r, data.b), sub: holder(r.entries[0], r, data) }));
    return { tiles, analysed: agg.analysed };
  },
  headline: (_m, data) => data.b.t('records.title'),
  subline: (m, data) => podcastSubline(data, m.analysed),
  draw: (m, box, k, opts) => <StatGrid k={k} box={box} tiles={m.tiles.slice(0, Number(opts.count) || 6)} maxCols={isWide(box) ? 4 : 2} />,
});

const podcastRanking = define({
  id: 'podcast.ranking',
  area: 'podcast',
  label: 'export.item.ranking',
  options: (data) => {
    const agg = aggregate(data.podcasts, data.slugs);
    const rankings = agg.analysed < 2 ? [] : podcastRankings(data.podcasts, data.slugs, agg.speakers);
    return [{ id: 'record', label: 'export.opt.record', choices: rankings.map((r) => ({ value: r.id, key: `records.${r.id}` })) }, COUNT([5, 3, 10])];
  },
  build: (data, opts) => {
    const agg = aggregate(data.podcasts, data.slugs);
    if (agg.analysed < 2) return null;
    const r = podcastRankings(data.podcasts, data.slugs, agg.speakers).find((x) => x.id === opts.record);
    if (!r) return null;
    const rows = r.entries.map((e) => {
      const extra = e.extra != null ? EXTRA[r.id]?.(e.extra, data.b) : undefined;
      const title = r.of === 'episode' ? titleOf(e.slug!, data.labels) : data.b.who(e.key!).name;
      const sub = [r.of === 'turn' ? titleOf(e.slug!, data.labels) : null, extra].filter(Boolean).join(' · ');
      return { title, value: recordValue(e, r, data.b), sub: sub || undefined, key: r.of === 'episode' ? undefined : e.key };
    });
    return { id: r.id, rows, analysed: agg.analysed };
  },
  headline: (m, data) => data.b.t(`records.${m.id}`),
  subline: (m, data) => podcastSubline(data, m.analysed),
  draw: (m, box, k, opts) => {
    const people = new Map<string, number>();
    return ranks(k, box, m.rows.slice(0, Number(opts.count) || 5).map((r) => {
      if (r.key && !people.has(r.key)) people.set(r.key, people.size);
      return { title: r.title, value: r.value, sub: r.sub, color: r.key ? k.color(people.get(r.key)!, r.key) : undefined };
    }));
  },
});

function entityOptions(present: string[], extra: Choice[] = []): ExportOption {
  return {
    id: 'kind',
    label: 'export.opt.kind',
    choices: [...extra, ...ENTITY_LABELS.filter(([label]) => present.includes(label)).map(([value, key]) => ({ value, key }))],
  };
}

const podcastNames = define({
  id: 'podcast.names',
  area: 'podcast',
  label: 'export.item.names',
  options: (data) => {
    const agg = aggregate(data.podcasts, data.slugs);
    return [entityOptions(Object.keys(agg.entities).filter((l) => agg.entities[l].length > 0)), STYLE_NAMES, COUNT([12, 8, 20])];
  },
  build: (data, opts) => {
    const agg = aggregate(data.podcasts, data.slugs, 30);
    const list = worth(agg.entities[opts.kind]);
    return list.length ? { list, kind: opts.kind, analysed: agg.analysed } : null;
  },
  headline: (_m, data) => data.b.t('names.title'),
  subline: (m, data) => `${data.scopeLabel} · ${data.b.t(ENTITY_LABELS.find(([l]) => l === m.kind)?.[1] ?? 'names.people')}`,
  draw: (m, box, k, opts) => names(k, box, m.list.slice(0, Number(opts.count) || 12), opts.style),
});

const podcastSeasons = define({
  id: 'podcast.seasons',
  area: 'podcast',
  label: 'export.item.seasons',
  options: () => [{
    id: 'metric',
    label: 'export.opt.metric',
    choices: [{ value: 'average', key: 'tile.average' }, { value: 'shares', key: 'speakers.title' }, { value: 'laughs', key: 'export.metric.laughsPerHour' }, { value: 'episodes', key: 'tile.analysed' }],
  }],
  build: (data) => {
    if (!data.seasonOf) return null;
    const rows = [...bySeason(data.slugs, data.seasonOf).entries()]
      .filter(([n]) => n !== null)
      .map(([n, list]) => ({ n: n!, agg: aggregate(data.podcasts, list) }))
      .filter((r) => r.agg.analysed > 0)
      .sort((x, y) => x.n - y.n);
    if (rows.length < 2) return null;
    const all = aggregate(data.podcasts, data.slugs);
    return { rows, people: speakers(fromTotals(all.speakers), data.b), analysed: all.analysed };
  },
  headline: (_m, data) => data.b.t('export.title.seasons'),
  subline: (m, data, opts) => `${data.b.t(opts.metric === 'shares' ? 'speakers.title' : opts.metric === 'laughs' ? 'export.metric.laughsPerHour' : opts.metric === 'episodes' ? 'tile.analysed' : 'tile.average')} · ${plural(data.b, 'export.episodes', m.analysed)}`,
  draw: (m, box, k, opts) => {
    const label = (n: number) => k.b.t('seasons.short', { n });
    if (opts.metric === 'shares') {
      const colors = parts(m.people, k);
      const legendRows = Math.ceil(m.people.length / (isWide(box) ? 3 : 2));
      const [legend, chart] = split(box, [legendRows * 64 * k.u, Math.max(box.h - legendRows * 64 * k.u, 1)], 24 * k.g, 'rows');
      return (
        <>
          <Legend k={k} box={legend} cols={isWide(box) ? 3 : 2} rows={colors.map((p) => ({ color: p.color, name: p.name, value: fmtShare(p.share, k) }))} />
          {onCard(k, chart, (inner) => (
            <Columns k={k} box={inner} max={1} ticks={[0, 0.5, 1]} tickLabel={(v) => fmtShare(v, k)}
              columns={m.rows.map((r) => {
                const share = new Map(r.agg.speakers.map((s) => [s.key, s.share]));
                const known = m.people.reduce((a, s) => a + (s.key ? share.get(s.key) ?? 0 : 0), 0);
                return { label: label(r.n), parts: colors.map((c, i) => ({ value: m.people[i].key ? share.get(m.people[i].key) ?? 0 : Math.max(0, 1 - known), color: c.color })) };
              })} />
          ))}
        </>
      );
    }
    const value = (a: (typeof m.rows)[number]['agg']) => {
      if (opts.metric === 'episodes') return a.analysed;
      if (opts.metric === 'laughs') return a.durationSeconds > 0 ? (a.events[LAUGHTER]?.count ?? 0) / (a.durationSeconds / 3600) : 0;
      return a.durationSeconds / a.analysed / 60;
    };
    const ticks = niceTicks(Math.max(...m.rows.map((r) => value(r.agg)), 1));
    const tick = opts.metric === 'average' || !opts.metric ? minutes(k.b) : (v: number) => fmt.decimal(v, k.b.locale);
    return onCard(k, box, (inner) => (
      <Columns k={k} box={inner} max={ticks[ticks.length - 1]} ticks={ticks} tickLabel={tick}
        columns={m.rows.map((r) => ({ label: label(r.n), parts: [{ value: value(r.agg), color: k.d.accent }] }))} />
    ));
  },
});

// ---- books ---------------------------------------------------------------------------------------------

interface BookScope {
  scoped: Record<string, BookSummary>;
  points: ChapterPoint[];
  groups: ChapterGroupRow[];
  group: ChapterGroupRow | null;
}

function bookScope(data: ExportData, opts: Opts): BookScope {
  const scoped = data.only ? Object.fromEntries(Object.entries(data.books).filter(([, s]) => bookOf(s) === data.only)) : data.books;
  const all = chapterPoints(scoped, data.slugs);
  const groups = chapterGroups(all, scoped, data.podcasts);
  const group = groups.find((g) => g.id === opts.group) ?? null;
  return { scoped, points: group ? group.points : all, groups, group };
}

function groupOption(data: ExportData): ExportOption[] {
  const { groups } = bookScope(data, {});
  if (groups.length === 0) return [];
  return [{ id: 'group', label: 'groups.pick', choices: [{ value: '', key: 'book.allChapters' }, ...groups.map((g) => ({ value: g.id, text: `${g.title} (${g.chapters})` }))] }];
}

function bookSubline(scope: BookScope, data: ExportData): string {
  const parts = [data.scopeLabel];
  if (scope.group) parts.push(data.b.t('groups.tile', { group: scope.group.title }));
  parts.push(data.b.plural('book.chapterCount', scope.points.length));
  return parts.join(' · ');
}

const bookSummary = define({
  id: 'book.summary',
  area: 'book',
  label: 'export.item.bookSummary',
  options: (data) => groupOption(data),
  build: (data, opts) => {
    const scope = bookScope(data, opts);
    if (scope.points.length === 0) return null;
    const b = data.b;
    const t = sentenceTotals(scope.points);
    const books = new Set(scope.points.map((p) => p.book)).size;
    const keys = new Set(scope.points.map((p) => p.key));
    const episodes = scope.group
      ? data.slugs.filter((slug) => {
        const s = scope.scoped[slug];
        return !!s && s.chapters.length > 0 && s.chapters.every((c) => keys.has(`${bookOf(s)}/${c.id}`));
      })
      : data.slugs;
    const agg = aggregateBooks(scope.scoped, data.podcasts, episodes);
    const tiles: Tile[] = [
      { label: b.t('book.chapters'), value: fmt.count(t.chapters, b.locale), sub: books > 1 ? b.t('books.inBooks', { n: books }) : undefined },
      scope.group && { label: b.t('groups.avgWords'), value: fmt.count(scope.group.avgWords, b.locale) },
      { label: b.t('book.words'), value: fmt.compact(t.words, b.locale) },
      t.sentences != null && { label: b.t('book.sentences'), value: fmt.compact(t.sentences, b.locale) },
      t.avgSentence != null && { label: b.t('book.avgSentence'), value: fmt.decimal(t.avgSentence, b.locale), sub: b.t('book.avgSentenceSub') },
      t.dialogueShare != null && { label: b.t('book.dialogue'), value: fmt.percent(t.dialogueShare, b.locale), sub: b.t('book.dialogueSub') },
      agg.minutesPerKWords != null && { label: b.t('book.pace'), value: b.t('book.paceValue', { n: fmt.decimal(agg.minutesPerKWords, b.locale) }) },
    ].filter((x): x is Tile => !!x);
    return { scope, tiles };
  },
  headline: (m, data) => (m.scope.group ? data.b.t('groups.tile', { group: m.scope.group.title }) : data.b.t('export.title.books')),
  subline: (m, data) => bookSubline(m.scope, data),
  draw: (m, box, k) => <StatGrid k={k} box={box} tiles={m.tiles} maxCols={isWide(box) ? 4 : 2} />,
});

const BOOK_METRICS = [
  { value: 'words', key: 'bookChart.length' },
  { value: 'avgSentence', key: 'bookChart.sentenceLength' },
  { value: 'dialogue', key: 'bookChart.dialogue' },
];

const bookChapters = define({
  id: 'book.chapters',
  area: 'book',
  label: 'export.item.chapters',
  options: (data) => {
    const { points } = bookScope(data, {});
    const metrics = BOOK_METRICS.filter((m) => m.value === 'words'
      || (m.value === 'avgSentence' && points.some((p) => p.avgSentence != null))
      || (m.value === 'dialogue' && points.some((p) => p.dialogueShare != null)));
    return [{ id: 'metric', label: 'export.opt.metric', choices: metrics }, ...groupOption(data)];
  },
  build: (data, opts) => {
    const scope = bookScope(data, opts);
    return scope.points.length > 1 ? { scope } : null;
  },
  headline: (_m, data, opts) => data.b.t(BOOK_METRICS.find((x) => x.value === opts.metric)?.key ?? 'bookChart.length'),
  subline: (m, data) => bookSubline(m.scope, data),
  draw: (m, box, k, opts) => {
    const value = (p: ChapterPoint) => (opts.metric === 'avgSentence' ? p.avgSentence : opts.metric === 'dialogue' ? p.dialogueShare : p.words) ?? 0;
    const books = [...new Set(m.scope.points.map((p) => p.book))];
    const highest = Math.max(...m.scope.points.map(value));
    const ticks = opts.metric === 'dialogue'
      ? [0, 0.25, 0.5, 0.75, 1].filter((v) => v <= Math.min(1, Math.ceil(highest * 4) / 4 || 0.25) + 1e-9)
      : niceTicks(Math.max(highest, 1));
    const tick = opts.metric === 'dialogue' ? (v: number) => fmt.percent(v, k.b.locale) : (v: number) => fmt.compact(v, k.b.locale);
    return onCard(k, box, (inner) => (
      <Columns k={k} box={inner} max={ticks[ticks.length - 1]} ticks={ticks} tickLabel={tick}
        columns={m.scope.points.map((p) => ({ label: p.heading, parts: [{ value: value(p), color: k.color(books.indexOf(p.book)) }] }))} />
    ));
  },
});

const bookRecords = define({
  id: 'book.records',
  area: 'book',
  label: 'export.item.bookRecords',
  options: (data) => {
    const { groups } = bookScope(data, {});
    const of: ExportOption = { id: 'of', label: 'export.opt.of', choices: [{ value: 'chapters', key: 'book.chapters' }, ...(groups.length > 1 ? [{ value: 'groups', key: 'groups.title' }] : [])] };
    return [of, COUNT([6, 4, 8]), ...groupOption(data)];
  },
  build: (data, opts) => {
    const scope = bookScope(data, opts);
    const many = new Set(scope.points.map((p) => p.book)).size > 1;
    if (opts.of === 'groups') {
      if (scope.groups.length < 2) return null;
      const tiles = groupRecords(scope.groups, data.b).map((r): Tile => ({ label: r.label, value: r.rows[0].value, sub: r.rows[0].what }));
      return tiles.length ? { scope, tiles } : null;
    }
    const tiles = chapterRankings(scope.points).map((r): Tile => {
      const p = r.entries[0].point;
      return { label: data.b.t(`books.${r.id}`), value: chapterValue(r.id, r.entries[0].value, data.b), sub: many ? `${p.heading} · ${p.title}` : p.heading };
    });
    return tiles.length ? { scope, tiles } : null;
  },
  headline: (_m, data, opts) => data.b.t(opts.of === 'groups' ? 'export.title.groupRecords' : 'export.title.bookRecords'),
  subline: (m, data) => bookSubline(m.scope, data),
  draw: (m, box, k, opts) => <StatGrid k={k} box={box} tiles={m.tiles.slice(0, Number(opts.count) || 6)} maxCols={isWide(box) ? 4 : 2} />,
});

const GROUP_METRICS = [
  { value: 'chapters', key: 'book.chapters' },
  { value: 'avgWords', key: 'groups.avgWords' },
  { value: 'dialogue', key: 'book.dialogue' },
  { value: 'pace', key: 'book.pace' },
];

const bookGroups = define({
  id: 'book.groups',
  area: 'book',
  label: 'export.item.groups',
  options: (data) => {
    const { groups } = bookScope(data, {});
    const metrics = GROUP_METRICS.filter((m) => m.value === 'chapters' || m.value === 'avgWords'
      || (m.value === 'dialogue' && groups.some((g) => g.dialogueShare != null))
      || (m.value === 'pace' && groups.some((g) => g.minutesPerKWords != null)));
    return [{ id: 'metric', label: 'export.opt.metric', choices: metrics }, COUNT([8, 5, 12])];
  },
  build: (data, opts) => {
    const scope = bookScope(data, {});
    if (scope.groups.length < 2) return null;
    const b = data.b;
    const value = (g: ChapterGroupRow) => (opts.metric === 'avgWords' ? g.avgWords : opts.metric === 'dialogue' ? g.dialogueShare : opts.metric === 'pace' ? g.minutesPerKWords : g.chapters);
    const display = (v: number) => (opts.metric === 'dialogue' ? fmt.percent(v, b.locale)
      : opts.metric === 'pace' ? b.t('book.paceValue', { n: fmt.decimal(v, b.locale) })
      : fmt.count(v, b.locale));
    const rows = scope.groups
      .map((g) => ({ g, v: value(g) }))
      .filter((x): x is { g: ChapterGroupRow; v: number } => x.v != null)
      .sort((x, y) => y.v - x.v)
      .map(({ g, v }): BarRow => ({ label: g.title, value: v, display: display(v), sub: opts.metric === 'chapters' ? undefined : b.plural('book.chapterCount', g.chapters) }));
    return rows.length ? { scope, rows } : null;
  },
  headline: (_m, data) => data.b.t('groups.title'),
  subline: (_m, data, opts) => `${data.scopeLabel} · ${data.b.t(GROUP_METRICS.find((x) => x.value === opts.metric)?.key ?? 'book.chapters')}`,
  draw: (m, box, k, opts) => bars(k, box, m.rows.slice(0, Number(opts.count) || 8)),
});

const bookNames = define({
  id: 'book.names',
  area: 'book',
  label: 'export.item.bookNames',
  options: (data) => {
    const { scoped } = bookScope(data, {});
    const present = Object.entries(mergeEntities(Object.values(scoped).map((s) => s.entities))).filter(([, l]) => l.length > 0).map(([label]) => label);
    return [entityOptions(present.filter((l) => l !== 'PERSON'), [{ value: 'characters', key: 'books.characters' }, { value: 'newCharacters', key: 'book.newCharacters' }]), STYLE_NAMES, COUNT([12, 8, 20])];
  },
  build: (data, opts) => {
    const { scoped } = bookScope(data, {});
    const summaries = data.slugs.map((s) => scoped[s]).filter((s): s is BookSummary => !!s);
    const list = opts.kind === 'characters' ? mergeNames(summaries.map((s) => s.characters), 30)
      : opts.kind === 'newCharacters' ? mergeNames(summaries.map((s) => s.newCharacters), 30)
      : mergeEntities(summaries.map((s) => s.entities), 30)[opts.kind] ?? [];
    return list.length ? { list: worth(list), kind: opts.kind } : null;
  },
  headline: (_m, data, opts) => data.b.t(opts.kind === 'newCharacters' ? 'book.newCharacters' : 'export.title.bookNames'),
  subline: (m, data) => {
    const key = m.kind === 'characters' || m.kind === 'newCharacters' ? 'books.characters' : ENTITY_LABELS.find(([l]) => l === m.kind)?.[1] ?? 'names.people';
    return `${data.scopeLabel} · ${data.b.t(key)}`;
  },
  draw: (m, box, k, opts) => names(k, box, m.list.slice(0, Number(opts.count) || 12), opts.style),
});

// ---- one episode ---------------------------------------------------------------------------------------

function episodeOf(data: ExportData): { slug: string; s: EpisodeStats | null; book: BookSummary | null } | null {
  if (!data.slug) return null;
  return { slug: data.slug, s: data.podcasts[data.slug] ?? null, book: data.books[data.slug] ?? null };
}

const episodeHeadline = (data: ExportData) => titleOf(data.slug ?? '', data.labels);

function episodeSubline(data: ExportData, what: string): string {
  const short = shortLabel(data.slug ?? '', data.labels);
  return short && short !== data.slug && short !== episodeHeadline(data) ? `${short} · ${what}` : what;
}

const episodeSummary = define({
  id: 'episode.summary',
  area: 'episode',
  label: 'export.item.episode',
  build: (data) => {
    const e = episodeOf(data);
    if (!e?.s) return null;
    const s = e.s;
    const b = data.b;
    const laughs = s.events.find((x) => x.label === LAUGHTER);
    const spoken = s.speakers.reduce((a, x) => a + x.speakingSeconds, 0);
    const wpm = s.words != null && spoken > 0 ? s.words / (spoken / 60) : null;
    const tiles: Tile[] = [
      s.durationSeconds != null && { label: b.t('tile.length'), value: fmt.clock(s.durationSeconds) },
      s.speechSeconds != null && !!s.durationSeconds && { label: b.t('tile.talking'), value: fmt.percent(s.speechSeconds / s.durationSeconds, b.locale) },
      s.words != null && { label: b.t('tile.words'), value: fmt.compact(s.words, b.locale) },
      wpm != null && { label: b.t('tile.pace'), value: b.t('unit.wpm', { n: fmt.count(wpm, b.locale) }) },
      s.longestSilence && { label: b.t('tile.pause'), value: fmt.pause(s.longestSilence.seconds, b.locale) },
      laughs && { label: b.t('tile.laughs'), value: fmt.count(laughs.count, b.locale) },
      s.questions != null && { label: b.t('tile.questions'), value: fmt.count(s.questions, b.locale) },
    ].filter((x): x is Tile => !!x);
    return { tiles, people: speakers(fromEpisode(s), b) };
  },
  headline: (_m, data) => episodeHeadline(data),
  subline: (_m, data) => episodeSubline(data, data.b.t('episode.title')),
  draw: (m, box, k) => tilesAndShares(k, box, m.tiles, m.people, (s) => fmt.clock(s.seconds)),
});

const episodeSpeakers = define({
  id: 'episode.speakers',
  area: 'episode',
  label: 'export.item.speakers',
  options: () => [STYLE_PEOPLE],
  build: (data) => {
    const e = episodeOf(data);
    if (!e?.s) return null;
    const people = speakers(fromEpisode(e.s), data.b);
    return people.length ? { people, seconds: e.s.speakers.reduce((a, x) => a + x.speakingSeconds, 0) } : null;
  },
  headline: (_m, data) => data.b.t('export.title.speakers'),
  subline: (_m, data) => episodeSubline(data, episodeHeadline(data)),
  draw: (m, box, k, opts) => {
    const detail = (s: Speaker) => fmt.clock(s.seconds);
    if (opts.style === 'bars') {
      return bars(k, box, parts(m.people, k).map((p, i) => ({ label: p.name, value: p.share, display: fmtShare(p.share, k), color: p.color, sub: detail(m.people[i]) })));
    }
    return donutAndLegend(k, box, m.people, { value: fmt.clock(m.seconds), label: k.b.t('speakers.title') }, detail);
  },
});

const episodeNames = define({
  id: 'episode.names',
  area: 'episode',
  label: 'export.item.names',
  options: (data) => {
    const e = episodeOf(data);
    return [entityOptions((e?.s?.entities ?? []).filter((g) => g.top.length > 0).map((g) => g.label)), STYLE_NAMES, COUNT([12, 8, 15])];
  },
  build: (data, opts) => {
    const e = episodeOf(data);
    const list = worth(e?.s?.entities.find((g) => g.label === opts.kind)?.top ?? []);
    return list.length ? { list, kind: opts.kind } : null;
  },
  headline: (_m, data) => data.b.t('export.title.episodeNames'),
  subline: (m, data) => episodeSubline(data, `${episodeHeadline(data)} · ${data.b.t(ENTITY_LABELS.find(([l]) => l === m.kind)?.[1] ?? 'names.people')}`),
  draw: (m, box, k, opts) => names(k, box, m.list.slice(0, Number(opts.count) || 12), opts.style),
});

const episodeBook = define({
  id: 'episode.book',
  area: 'episode',
  label: 'export.item.episodeBook',
  build: (data) => {
    const e = episodeOf(data);
    if (!e?.book || e.book.chapters.length === 0) return null;
    const b = data.b;
    const points = chapterPoints({ [e.slug]: e.book }, [e.slug]);
    const t = sentenceTotals(points);
    const tiles: Tile[] = [
      { label: b.t('book.chapters'), value: fmt.count(t.chapters, b.locale) },
      { label: b.t('book.words'), value: fmt.compact(t.words, b.locale) },
      t.avgSentence != null && { label: b.t('book.avgSentence'), value: fmt.decimal(t.avgSentence, b.locale) },
      t.dialogueShare != null && { label: b.t('book.dialogue'), value: fmt.percent(t.dialogueShare, b.locale) },
    ].filter((x): x is Tile => !!x);
    const rows: BarRow[] = points.map((p) => ({ label: p.heading, value: p.words, display: b.t('book.wordCount', { n: fmt.count(p.words, b.locale) }) }));
    const characters = e.book.characters.slice(0, 12);
    return { title: e.book.title || b.t('book.title'), tiles, rows, characters };
  },
  headline: (m) => m.title,
  subline: (_m, data) => episodeSubline(data, episodeHeadline(data)),
  draw: (m, box, k) => {
    const many = m.rows.length > 1;
    const gap = 32 * k.g;
    const sections = [m.tiles.length ? 1 : 0, many ? 1.3 : 0, m.characters.length ? 1 : 0];
    const boxes = isWide(box) ? split(box, sections.filter(Boolean), gap, 'cols') : split(box, sections.filter(Boolean), gap, 'rows');
    let i = 0;
    return (
      <>
        {m.tiles.length > 0 && <StatGrid k={k} box={boxes[i++]} tiles={m.tiles} maxCols={2} />}
        {many && bars(k, boxes[i++], m.rows.slice(0, 8))}
        {m.characters.length > 0 && onCard(k, boxes[i++], (inner) => <Chips k={k} box={inner} items={m.characters} />)}
      </>
    );
  },
});

/** Everything exportable, in the order the dialog lists it. */
export const ITEMS: ExportItem[] = [
  podcastSummary, podcastSpeakers, podcastTrend, podcastRecords, podcastRanking, podcastNames, podcastSeasons,
  bookSummary, bookChapters, bookRecords, bookGroups, bookNames,
  episodeSummary, episodeSpeakers, episodeNames, episodeBook,
];

export function itemById(id: string | null | undefined): ExportItem | undefined {
  return ITEMS.find((i) => i.id === id);
}
