// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import { useMemo, useState } from 'react';
import { mergeEntities, versus, type BookAggregate } from '../book';
import * as fmt from '../format';
import type { BookStats } from '../types';
import { Tiles, titleOf, type Basics } from './common';

function Names({ title, list, b }: { title: string; list: { text: string; count: number }[]; b: Basics }) {
  if (list.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="small muted" style={{ marginBottom: 6 }}>{title}</div>
      <ul className="chips" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {list.map((e) => (
          <li className="chip" key={e.text}>
            {e.text}
            <span className="n">{fmt.count(e.count, b.locale)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Row = BookAggregate['rows'][number];

interface Column {
  id: string;
  label: string;
  /** Shown as the header's tooltip. */
  hint?: string;
  /** What the column sorts by; columns without one don't sort. */
  sort?: (r: Row, i: number) => number | string | null;
  cell: (r: Row) => React.ReactNode;
  foot?: React.ReactNode;
  left?: boolean;
  wrap?: boolean;
}

/**
 * Podcast against book, episode by episode: how much of the book each episode covers, how much time and
 * talk it spent on it (and whether that's more or less than average), how often they laughed, and whom
 * they talked about most. Every number column sorts; a total row closes it.
 */
export function PaceTable({ ctx, agg, b }: { ctx: PluginContext; agg: BookAggregate; b: Basics }) {
  const labels = ctx.episodeLabels;
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [names, setNames] = useState(1);
  // Book order (oldest episode first), and only episodes with podcast stats: the rest have no time to show.
  const rows = agg.rows.filter((r) => r.seconds != null).reverse();
  const spokenAvg = average(rows, (r) => r.spokenPerWord, (r) => r.words);
  const words = rows.reduce((a, r) => a + r.words, 0);
  const seconds = rows.reduce((a, r) => a + (r.seconds ?? 0), 0);
  const dash = '–';

  const columns: Column[] = [
    {
      id: 'episode', label: b.t('book.episode'), left: true, sort: (_r, i) => i,
      cell: (r) => <a href={ctx.links.episode(r.slug)}>{titleOf(r.slug, labels)}</a>,
      foot: b.t('pace.total'),
    },
    {
      id: 'chapters', label: b.t('book.chapters'), left: true, sort: (r) => r.headings.join(', '),
      cell: (r) => r.headings.join(', '),
      foot: b.plural('book.chapterCount', rows.reduce((a, r) => a + r.headings.length, 0)),
    },
    { id: 'words', label: b.t('pace.bookWords'), wrap: true, sort: (r) => r.words, cell: (r) => fmt.count(r.words, b.locale), foot: fmt.count(words, b.locale) },
    { id: 'length', label: b.t('tile.length'), sort: (r) => r.seconds, cell: (r) => (r.seconds != null ? fmt.clock(r.seconds) : dash), foot: fmt.span(seconds, b.locale) },
    {
      id: 'perK', label: b.t('pace.perK'), hint: b.t('pace.perKHint'), wrap: true, sort: (r) => r.minutesPerKWords,
      cell: (r) => (
        <>
          {r.minutesPerKWords != null ? fmt.decimal(r.minutesPerKWords, b.locale) : dash}
          <div className="small"><DeltaPill value={versus(r.minutesPerKWords, agg.minutesPerKWords)} b={b} /></div>
        </>
      ),
      foot: agg.minutesPerKWords != null ? fmt.decimal(agg.minutesPerKWords, b.locale) : dash,
    },
  ];
  if (agg.secondsPerSentence != null) {
    columns.push({
      id: 'perSentence', label: b.t('pace.perSentence'), hint: b.t('pace.perSentenceHint'), wrap: true, sort: (r) => r.secondsPerSentence,
      cell: (r) => (r.secondsPerSentence != null ? fmt.decimal(r.secondsPerSentence, b.locale) : dash),
      foot: fmt.decimal(agg.secondsPerSentence, b.locale),
    });
  }
  if (spokenAvg != null) {
    columns.push({
      id: 'spoken', label: b.t('pace.spoken'), hint: b.t('pace.spokenHint'), wrap: true, sort: (r) => r.spokenPerWord,
      cell: (r) => (r.spokenPerWord != null ? fmt.decimal(r.spokenPerWord, b.locale) : dash),
      foot: fmt.decimal(spokenAvg, b.locale),
    });
  }
  if (rows.some((r) => r.laughs)) {
    columns.push({
      id: 'laughs', label: b.t('tile.laughs'), sort: (r) => r.laughs,
      cell: (r) => (r.laughs != null ? fmt.count(r.laughs, b.locale) : dash),
      foot: fmt.count(rows.reduce((a, r) => a + (r.laughs ?? 0), 0), b.locale),
    });
  }
  if (rows.some((r) => r.topNames.length > 0)) {
    columns.push({
      id: 'names', label: b.t('pace.topName'), left: true, wrap: true,
      cell: (r) => (r.topNames.length === 0 ? dash : (
        <ol className="names-list">
          {r.topNames.slice(0, names).map((e) => <li key={e.text}>{e.text} <span className="muted">{fmt.count(e.count, b.locale)}</span></li>)}
        </ol>
      )),
    });
  }

  const order = rows.map((r, i) => ({ r, i }));
  const active = sort && columns.find((c) => c.id === sort.id);
  if (sort && active?.sort) {
    const key = active.sort;
    order.sort((x, y) => {
      const a = key(x.r, x.i);
      const c = key(y.r, y.i);
      if (a == null || c == null) return a == null ? (c == null ? 0 : 1) : -1; // empty cells last
      return (typeof a === 'string' ? a.localeCompare(String(c)) : a - (c as number)) * sort.dir;
    });
  }
  const toggle = (c: Column) => setSort((now) => {
    if (now?.id === c.id) return { id: c.id, dir: now.dir === 1 ? -1 : 1 };
    // Numbers start with the biggest, text and the episode order with the first.
    return { id: c.id, dir: c.id === 'episode' || c.id === 'chapters' ? 1 : -1 };
  });

  return (
    <section className="section">
      <div className="chart-head">
        <h3>{b.t('books.paceTitle')}</h3>
        {columns.some((c) => c.id === 'names') && (
          <div className="chips" role="group" aria-label={b.t('pace.topName')}>
            {[1, 3, 5].map((n) => (
              <button key={n} type="button" className="chip" aria-pressed={names === n} onClick={() => setNames(n)}>
                {b.t('books.topN', { n })}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="table-wrap">
        <table className="pace">
          <thead>
            <tr>
              {columns.map((c) => {
                const dir = sort?.id === c.id ? sort.dir : 0;
                return (
                  <th key={c.id} scope="col" title={c.hint} className={c.wrap ? 'wrap' : undefined}
                    style={c.left ? { textAlign: 'left' } : undefined}
                    aria-sort={dir === 1 ? 'ascending' : dir === -1 ? 'descending' : undefined}>
                    {c.sort ? (
                      <button type="button" className="sort" onClick={() => toggle(c)}>
                        {c.label}<span className="arrow" aria-hidden="true">{dir === 1 ? '▲' : dir === -1 ? '▼' : '↕'}</span>
                      </button>
                    ) : c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {order.map(({ r }) => (
              <tr key={r.slug}>
                {columns.map((c, i) => i === 0
                  ? <th key={c.id} scope="row" style={{ fontWeight: 400, fontSize: '0.9rem', textAlign: 'left' }}>{c.cell(r)}</th>
                  : <td key={c.id} style={c.left ? { textAlign: 'left', whiteSpace: 'normal' } : undefined}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr>
                {columns.map((c, i) => i === 0
                  ? <th key={c.id} scope="row" style={{ fontWeight: 600, textAlign: 'left' }}>{c.foot}</th>
                  : <td key={c.id} style={c.left ? { textAlign: 'left' } : undefined}>{c.foot}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="heat-legend small muted" style={{ marginTop: 8 }}>
        <span>{b.t('pace.lessTime')}</span>
        {[-4, -3, -2, -1].map((l) => <span key={l} className={`swatch delta-${l < 0 ? 'less' : 'more'}-${Math.abs(l)}`} />)}
        <span className="swatch" style={{ background: 'var(--mc-border)' }} />
        {[1, 2, 3, 4].map((l) => <span key={l} className={`swatch delta-more-${l}`} />)}
        <span>{b.t('pace.moreTime')}</span>
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        {b.t('pace.perKHint')} {agg.secondsPerSentence != null && b.t('pace.perSentenceHint')} {spokenAvg != null && b.t('pace.spokenHint')}
      </p>
    </section>
  );
}

/**
 * "+12 %" against the average with an arrow, on a diverging tint: blue for less podcast time per word,
 * orange for more, stronger the further off. The arrow and sign carry it too, so it doesn't rely on colour.
 */
function DeltaPill({ value, b }: { value: number | null; b: Basics }) {
  if (value == null || !Number.isFinite(value)) return null;
  if (Math.abs(value) < 0.03) return <span className="delta">{b.t('book.even')}</span>;
  const level = Math.min(4, Math.ceil(Math.abs(value) / 0.1));
  const pct = fmt.percent(Math.abs(value), b.locale);
  return (
    <span className={`delta delta-${value > 0 ? 'more' : 'less'}-${level}`} title={b.t(value > 0 ? 'book.moreHint' : 'book.lessHint')}>
      {value > 0 ? `▲ +${pct}` : `▼ −${pct}`}
    </span>
  );
}

/** A weighted average of a per-row ratio, e.g. spoken words per book word over all rows. */
function average<T>(rows: T[], value: (r: T) => number | null, weight: (r: T) => number): number | null {
  let sum = 0;
  let total = 0;
  for (const r of rows) {
    const v = value(r);
    if (v == null) continue;
    sum += v * weight(r);
    total += weight(r);
  }
  return total > 0 ? sum / total : null;
}

/**
 * The chapters an episode covers. With several chapters a picker narrows the numbers down; the pace (podcast
 * time per word) only makes sense for all of them together, since the recording isn't split by chapter.
 */
export function BookEpisode({
  book,
  seconds,
  season,
  b,
}: {
  book: BookStats;
  /** Podcast length of the episode (selected podcast bundles), if known. */
  seconds: number | null;
  /** The season's pace, for the comparison. */
  season: { minutesPerKWords: number | null; secondsPerSentence: number | null; n: number | null };
  b: Basics;
}) {
  const [only, setOnly] = useState<string | null>(null);
  const chapters = only ? book.chapters.filter((c) => c.id === only) : book.chapters;
  const sum = useMemo(() => {
    const merge = (pick: (c: (typeof chapters)[number]) => { text: string; count: number }[]) => {
      const m = new Map<string, number>();
      chapters.forEach((c) => pick(c).forEach((e) => m.set(e.text, (m.get(e.text) ?? 0) + e.count)));
      return [...m.entries()].map(([text, count]) => ({ text, count })).sort((a, x) => x.count - a.count).slice(0, 12);
    };
    const sentences = chapters.every((c) => c.sentences != null) ? chapters.reduce((a, c) => a + (c.sentences ?? 0), 0) : null;
    const words = chapters.reduce((a, c) => a + c.words, 0);
    const speech = sentences && chapters.every((c) => c.dialogue != null)
      ? chapters.reduce((a, c) => a + (c.dialogue ?? 0), 0) / sentences : null;
    const entities = mergeEntities(chapters.map((c) => c.entities), 12);
    return {
      words,
      sentences,
      paragraphs: chapters.reduce((a, c) => a + c.paragraphs, 0),
      avgSentence: sentences ? words / sentences : null,
      dialogueShare: speech,
      characters: merge((c) => c.characters),
      newCharacters: merge((c) => c.newCharacters),
      places: repeated(entities.LOCATION),
      groups: repeated(entities.ORGANIZATION),
    };
  }, [chapters]);
  const whole = only === null;
  const perK = whole && seconds != null && sum.words > 0 ? seconds / 60 / (sum.words / 1000) : null;
  const perSentence = whole && seconds != null && sum.sentences ? seconds / sum.sentences : null;
  return (
    <div>
      {book.chapters.length > 1 && (
        <div className="chips" role="group" aria-label={b.t('book.chapters')} style={{ marginBottom: 12 }}>
          <button type="button" className="chip" aria-pressed={whole} onClick={() => setOnly(null)}>
            {b.t('book.allChapters')}
          </button>
          {book.chapters.map((c) => (
            <button type="button" key={c.id} className="chip" aria-pressed={only === c.id} onClick={() => setOnly(c.id)}>
              {c.heading}
            </button>
          ))}
        </div>
      )}
      <Tiles
        tiles={[
          book.chapters.length === 1 && { label: b.t('book.chapter'), value: book.chapters[0].heading },
          { label: b.t('book.words'), value: fmt.count(sum.words, b.locale) },
          sum.sentences != null && { label: b.t('book.sentences'), value: fmt.count(sum.sentences, b.locale) },
          { label: b.t('book.paragraphs'), value: fmt.count(sum.paragraphs, b.locale) },
          sum.avgSentence != null && { label: b.t('book.avgSentence'), value: fmt.decimal(sum.avgSentence, b.locale), sub: b.t('book.avgSentenceSub') },
          sum.dialogueShare != null && { label: b.t('book.dialogue'), value: fmt.percent(sum.dialogueShare, b.locale), sub: b.t('book.dialogueSub') },
          perK != null && {
            label: b.t('book.pace'),
            value: b.t('book.paceValue', { n: fmt.decimal(perK, b.locale) }),
            sub: deltaText(versus(perK, season.minutesPerKWords), season.n, b),
          },
          perSentence != null && {
            label: b.t('book.perSentence'),
            value: fmt.pause(perSentence, b.locale),
            sub: deltaText(versus(perSentence, season.secondsPerSentence), season.n, b),
          },
        ]}
      />
      <Names title={b.t('book.characters')} list={sum.characters} b={b} />
      <Names title={b.t('book.newCharacters')} list={sum.newCharacters} b={b} />
      <Names title={b.t('names.places')} list={sum.places} b={b} />
      <Names title={b.t('names.groups')} list={sum.groups} b={b} />
    </div>
  );
}

/** Names mentioned more than once, unless that leaves fewer than three: a place named once is mostly noise. */
function repeated(list: { text: string; count: number }[] = []) {
  const more = list.filter((e) => e.count > 1);
  return more.length >= 3 ? more : list;
}

function deltaText(value: number | null, season: number | null, b: Basics): string | undefined {
  if (value == null || season == null) return undefined;
  if (Math.abs(value) < 0.005) return b.t('book.evenSeason', { n: season });
  const pct = fmt.percent(Math.abs(value), b.locale);
  return b.t(value > 0 ? 'book.moreThanSeason' : 'book.lessThanSeason', { pct, n: season });
}
