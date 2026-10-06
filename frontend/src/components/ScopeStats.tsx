// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import { useMemo } from 'react';
import { aggregate, LAUGHTER, type Aggregate } from '../aggregate';
import { podcastRankings, type RecordId, type Ranking } from '../records';
import { RecordGroups, type RankRow, type RecordSpec } from './Records';
import * as fmt from '../format';
import { bySeason, type SeasonLookup } from '../seasons';
import type { BookSummary, EpisodeStats } from '../types';
import { chapterPoints, sentenceTotals } from '../book';
import { EpisodeCharts } from './EpisodeCharts';
import { ShareBar, Tiles, TopNames, titleOf, type Basics } from './common';
import { SpeakerTable } from './SpeakerTable';

/**
 * Everything the stats page shows for a set of episodes: totals, who talks how much, per-episode charts,
 * records, most mentioned names, and (for the whole show) a season comparison.
 */
export function ScopeStats({
  ctx,
  podcasts,
  books,
  slugs,
  b,
  seasonOf,
  onSeason,
  booksHref,
  onBooks,
}: {
  ctx: PluginContext;
  /** Per episode, the selected podcast bundles combined. */
  podcasts: Record<string, EpisodeStats>;
  /** Per episode, the selected book bundles. */
  books: Record<string, BookSummary>;
  slugs: string[];
  b: Basics;
  /** Given for the whole show: adds the season comparison. */
  seasonOf?: SeasonLookup;
  onSeason?: (n: number) => void;
  /** Where the books view of this scope is. */
  booksHref: string;
  onBooks: () => void;
}) {
  const agg = useMemo(() => aggregate(podcasts, slugs), [podcasts, slugs]);
  const chapters = useMemo(() => chapterPoints(books, slugs), [books, slugs]);
  // Charts read left to right in time; the host lists newest first.
  const points = useMemo(() => [...agg.points].reverse(), [agg]);
  const labels = ctx.episodeLabels;
  if (agg.analysed === 0 && chapters.length === 0) return <p className="muted">{b.t('page.emptyScope')}</p>;
  if (agg.analysed === 0) return <BookTeaser chapters={chapters} href={booksHref} onOpen={onBooks} b={b} />;

  const laughs = agg.events[LAUGHTER]?.count ?? 0;
  return (
    <>
      <Tiles
        tiles={[
          { label: b.t('tile.analysed'), value: fmt.count(agg.analysed, b.locale), sub: b.t('tile.ofTotal', { total: fmt.count(agg.total, b.locale) }) },
          agg.durationSeconds > 0 && { label: b.t('tile.total'), value: fmt.span(agg.durationSeconds, b.locale) },
          agg.durationSeconds > 0 && { label: b.t('tile.average'), value: fmt.clock(agg.durationSeconds / agg.analysed) },
          agg.words > 0 && { label: b.t('tile.words'), value: fmt.compact(agg.words, b.locale) },
          laughs > 0 && {
            label: b.t('tile.laughs'),
            value: fmt.count(laughs, b.locale),
            sub: agg.durationSeconds > 0 ? b.t('tile.perHour', { n: fmt.decimal(laughs / (agg.durationSeconds / 3600), b.locale) }) : undefined,
          },
          agg.questions > 0 && { label: b.t('tile.questions'), value: fmt.compact(agg.questions, b.locale) },
        ]}
      />

      <section className="section">
        <h3>{b.t('speakers.title')}</h3>
        <ShareBar parts={agg.speakers} b={b} />
        <div style={{ marginTop: 12 }}>
          <SpeakerTable
            rows={agg.speakers.map((s) => ({ ...s, longest: s.longestTurn, turns: null }))}
            ctx={ctx}
            b={b}
            showEpisodes={agg.analysed > 1}
          />
        </div>
      </section>

      {points.length > 1 && (
        <section className="section">
          <EpisodeCharts points={points} people={agg.speakers.map((s) => s.key)} labels={labels} b={b} />
        </section>
      )}

      <Records agg={agg} podcasts={podcasts} slugs={slugs} ctx={ctx} b={b} />

      {Object.keys(agg.entities).length > 0 && (
        <section className="section">
          <h3>{b.t('names.title')}</h3>
          <TopNames groups={agg.entities} b={b} limit={15} />
        </section>
      )}

      {chapters.length > 0 && <BookTeaser chapters={chapters} href={booksHref} onOpen={onBooks} b={b} />}

      {seasonOf && <SeasonTable podcasts={podcasts} slugs={slugs} b={b} seasonOf={seasonOf} onSeason={onSeason} />}
    </>
  );
}

/** A few book numbers and the way to the books view, where the chapter-by-chapter stats are. */
function BookTeaser({ chapters, href, onOpen, b }: { chapters: ReturnType<typeof chapterPoints>; href: string; onOpen: () => void; b: Basics }) {
  const t = sentenceTotals(chapters);
  const titles = [...new Set(chapters.map((c) => c.title))];
  return (
    <section className="section">
      <h3>{b.t('book.title')}</h3>
      <p className="small muted" style={{ margin: '0 0 8px' }}>{titles.join(', ')}</p>
      <Tiles
        compact
        tiles={[
          { label: b.t('book.chapters'), value: fmt.count(t.chapters, b.locale) },
          { label: b.t('book.words'), value: fmt.compact(t.words, b.locale) },
          t.avgSentence != null && { label: b.t('book.avgSentence'), value: fmt.decimal(t.avgSentence, b.locale) },
          t.dialogueShare != null && { label: b.t('book.dialogue'), value: fmt.percent(t.dialogueShare, b.locale) },
        ]}
      />
      <p style={{ margin: '10px 0 0' }}>
        <a href={href} onClick={(e) => { e.preventDefault(); onOpen(); }}>
          {b.t('books.open')} <span aria-hidden="true">→</span>
        </a>
      </p>
    </section>
  );
}

/** Records about episodes, then about people, each with its full ranking. */
function Records({ agg, podcasts, slugs, ctx, b }: { agg: Aggregate; podcasts: Record<string, EpisodeStats>; slugs: string[]; ctx: PluginContext; b: Basics }) {
  const rankings = useMemo(() => podcastRankings(podcasts, slugs, agg.speakers), [podcasts, slugs, agg]);
  if (agg.analysed < 2) return null;
  const labels = ctx.episodeLabels;
  const speakers = new Map(agg.speakers.map((p) => [p.key, p]));
  const person = (key: string) => {
    const p = b.who(key, speakers.get(key));
    return { name: p.name, color: p.color };
  };
  const rows = (r: Ranking): RankRow[] => r.entries.map((e, i) => ({
    id: `${e.slug ?? ''}:${e.key ?? ''}:${i}`,
    value: e.split ? `${fmt.percent(e.split[0], b.locale)} : ${fmt.percent(e.split[1], b.locale)}` : VALUE[r.id](e.value, b),
    who: e.key ? person(e.key) : undefined,
    link: e.slug ? { href: ctx.links.episode(e.slug, e.at != null ? { t: Math.floor(e.at) } : undefined), text: titleOf(e.slug, labels) } : undefined,
    extra: e.extra != null ? EXTRA[r.id]?.(e.extra, b) : undefined,
  }));
  const spec = (r: Ranking): RecordSpec => ({ id: r.id, label: b.t(`records.${r.id}`), rows: rows(r) });
  return (
    <RecordGroups
      b={b}
      groups={[
        { title: b.t('records.episodes'), records: rankings.filter((r) => r.of === 'episode').map(spec) },
        { title: b.t('records.people'), records: rankings.filter((r) => r.of !== 'episode').map(spec) },
      ]}
    />
  );
}

const length = (v: number, b: Basics) => (v < 60 ? fmt.pause(v, b.locale) : fmt.clock(v));
const share = (v: number, b: Basics) => fmt.percent(v, b.locale);
const wpm = (v: number, b: Basics) => b.t('unit.wpm', { n: fmt.count(v, b.locale) });

/** How each record's value reads. */
const VALUE: Record<RecordId, (v: number, b: Basics) => string> = {
  longest: length,
  shortest: length,
  words: (v, b) => b.t('unit.words', { n: fmt.count(v, b.locale) }),
  pace: wpm,
  laughs: (v, b) => fmt.count(v, b.locale),
  questions: (v, b) => fmt.count(v, b.locale),
  backAndForth: (v, b) => b.t('unit.perMinute', { n: fmt.decimal(v, b.locale) }),
  crosstalk: length,
  pause: (v, b) => fmt.pause(v, b.locale),
  oneSided: share,
  balanced: share,
  fastest: wpm,
  slowest: wpm,
  asks: (v, b) => fmt.count(v, b.locale),
  monologue: length,
};

/** And the second number, where there is one. */
const EXTRA: Partial<Record<RecordId, (v: number, b: Basics) => string>> = {
  laughs: (v, b) => b.t('tile.perHour', { n: fmt.decimal(v, b.locale) }),
  backAndForth: (v, b) => b.t('unit.turns', { n: fmt.count(v, b.locale) }),
  fastest: (v, b) => b.t('unit.words', { n: fmt.count(v, b.locale) }),
  slowest: (v, b) => b.t('unit.words', { n: fmt.count(v, b.locale) }),
  asks: (v, b) => b.t('unit.perSpeakingHour', { n: fmt.decimal(v, b.locale) }),
};

function SeasonTable({ podcasts, slugs, b, seasonOf, onSeason }: { podcasts: Record<string, EpisodeStats>; slugs: string[]; b: Basics; seasonOf: SeasonLookup; onSeason?: (n: number) => void }) {
  const rows = [...bySeason(slugs, seasonOf).entries()]
    .filter(([n]) => n !== null)
    .map(([n, list]) => ({ n: n!, agg: aggregate(podcasts, list) }))
    .filter((r) => r.agg.analysed > 0);
  if (rows.length < 2) return null;
  return (
    <section className="section">
      <h3>{b.t('seasons.title')}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{b.t('seasons.season')}</th>
              <th scope="col">{b.t('tile.analysed')}</th>
              <th scope="col">{b.t('tile.average')}</th>
              <th scope="col" style={{ minWidth: 140 }}>{b.t('speakers.share')}</th>
              <th scope="col">{b.t('tile.laughs')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ n, agg }) => (
              <tr key={n}>
                <th scope="row" style={{ fontWeight: 400, fontSize: '0.9rem' }}>
                  <a href={`/p/stats/season/${n}`} onClick={(e) => { e.preventDefault(); onSeason?.(n); }}>
                    {b.t('seasons.label', { n })}
                  </a>
                </th>
                <td>{b.t('tile.analysedOf', { n: agg.analysed, total: agg.total })}</td>
                <td>{agg.durationSeconds ? fmt.clock(agg.durationSeconds / agg.analysed) : '–'}</td>
                <td><ShareBar parts={agg.speakers} b={b} thin legend={false} /></td>
                <td>{fmt.count(agg.events[LAUGHTER]?.count ?? 0, b.locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
