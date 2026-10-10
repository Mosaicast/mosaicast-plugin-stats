// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import { useEffect, useMemo, useState } from 'react';
import { LAUGHTER } from '../aggregate';
import { aggregateBooks, chapterPoints, groupPlaces } from '../book';
import { combine } from '../combine';
import { canManage, loadEpisodeStats } from '../data';
import { useSeasons } from '../seasons';
import * as fmt from '../format';
import type { BookStats, EpisodeStats } from '../types';
import { BookEpisode } from './BookViews';
import { hasStats, Icon, LoadingBar, Root, ShareBar, Tiles, TopNames, useSelection, useSiteData, type Basics } from './common';
import { SpeakerTable } from './SpeakerTable';
import { Timeline } from './Timeline';

/**
 * Full stats on the episode page (episode / main): the selected podcast bundles (combined when several are
 * ticked) and the book chapters the episode covers. Visitors see nothing for an episode without stats;
 * podcasters get a pointer to the upload page instead.
 */
export function EpisodeView({ ctx }: { ctx: PluginContext }) {
  const slug = ctx.scope.id;
  const { index, basics: b } = useSiteData(ctx);
  const slugs = useMemo(() => [slug], [slug]);
  const sel = useSelection(ctx, b, index, slugs);
  const [docs, setDocs] = useState<Record<string, EpisodeStats | BookStats | null> | undefined>(undefined);
  const wanted = useMemo(() => sel.available.filter((x) => sel.selected.has(x.id)), [sel.available, sel.selected]);

  // The full documents of every selected bundle; the index only has summaries.
  useEffect(() => {
    if (index === undefined) return;
    let live = true;
    Promise.all(wanted.map((x) => loadEpisodeStats<EpisodeStats | BookStats>(ctx, slug, x.id).then((d) => [x.id, d] as const)))
      .then((pairs) => live && setDocs(Object.fromEntries(pairs)))
      .catch((e: unknown) => {
        if (!live) return;
        ctx.log('warn', `stats: could not load stats for ${slug} (${String(e)})`);
        setDocs({});
      });
    return () => {
      live = false;
    };
  }, [ctx.docs, slug, index, wanted]);

  // Season mates with book stats, for "more or less time per word than the season".
  const bookSlugs = useMemo(() => Object.keys(index?.books ?? {}), [index]);
  const seasonOf = useSeasons(ctx, bookSlugs.includes(slug) ? bookSlugs : []);
  const season = useMemo(() => {
    const n = seasonOf(slug);
    if (n == null) return { minutesPerKWords: null, secondsPerSentence: null, n: null };
    const mates = bookSlugs.filter((x) => seasonOf(x) === n);
    const agg = aggregateBooks(sel.books, sel.podcasts, mates);
    return { minutesPerKWords: agg.minutesPerKWords, secondsPerSentence: agg.secondsPerSentence, n };
  }, [seasonOf, bookSlugs, slug, sel.books, sel.podcasts]);
  // Where this episode's chapters stand in their chapter groups, over everything released. Newest season
  // first, as the host lists episodes, so the books come in the order the show reaches them.
  const places = useMemo(() => {
    const order = [...bookSlugs].sort((x, y) => (seasonOf(y) ?? -1) - (seasonOf(x) ?? -1));
    return groupPlaces(chapterPoints(sel.books, order));
  }, [bookSlugs, seasonOf, sel.books]);

  if (index === undefined || (docs === undefined && hasStats(index, slug))) {
    return (
      <Root>
        <LoadingBar label={b.t('loading')} />
      </Root>
    );
  }
  if (!hasStats(index, slug)) {
    if (!canManage(ctx)) return null;
    return (
      <Root>
        <p className="note small">
          <Icon name="info" />
          <span>
            {b.t(ctx.episode && ctx.episode.phase !== 'released' ? 'episode.notYet' : 'episode.none')}{' '}
            <a href="/p/stats/manage" onClick={(e) => { e.preventDefault(); ctx.route.navigate('manage'); }}>
              {b.t('episode.upload')}
            </a>
          </span>
        </p>
      </Root>
    );
  }

  const podcastBundles = wanted.filter((x) => x.kind === 'podcast' && docs?.[x.id]);
  const bookBundles = wanted.filter((x) => x.kind === 'book' && docs?.[x.id]);
  const podcastDocs = podcastBundles.map((x) => docs![x.id] as EpisodeStats);
  const stats = combine(podcastDocs);
  return (
    <Root>
      <section className="panel" aria-labelledby="stats-title" style={{ marginTop: 16 }}>
        <div className="head">
          <h2 id="stats-title">{b.t('episode.title')}</h2>
        </div>
        {sel.picker}
        {!stats && bookBundles.length === 0 && <p className="small muted">{b.t('bundle.nothingSelected')}</p>}
        {stats && stats.speakers.length > 0 && (
          <>
            <ShareBar
              parts={stats.speakers.map((s) => ({ ...s, seconds: s.speakingSeconds }))}
              b={b}
              detail={(key) => {
                const s = stats.speakers.find((x) => x.key === key);
                return s ? fmt.clock(s.speakingSeconds) : null;
              }}
            />
            <div className="section">
              <Tiles tiles={episodeTiles(stats, b)} />
            </div>
            {podcastBundles.some((x) => (docs![x.id] as EpisodeStats).timeline) && (
              <div className="section">
                <h3>{b.t('episode.timeline')}</h3>
                {podcastBundles.map((x) => (
                  <div key={x.id} style={{ marginBottom: 10 }}>
                    {podcastBundles.length > 1 && <div className="small muted" style={{ marginBottom: 4 }}>{b.bundleName(x)}</div>}
                    <Timeline ctx={ctx} slug={slug} stats={docs![x.id] as EpisodeStats} b={b} />
                  </div>
                ))}
              </div>
            )}
            <div className="section">
              <h3>{b.t('speakers.title')}</h3>
              <SpeakerTable
                rows={stats.speakers.map((s) => ({
                  key: s.key, label: s.label, name: s.name, seconds: s.speakingSeconds, share: s.share,
                  words: s.words ?? null, wpm: s.wpm ?? null, questions: s.questions ?? null, turns: s.turns ?? null,
                  longest: s.longestTurn ? { seconds: s.longestTurn.seconds, at: s.longestTurn.at, slug } : null,
                }))}
                ctx={ctx}
                b={b}
              />
            </div>
            {stats.entities.length > 0 && (
              <div className="section">
                <h3>{b.t('names.title')}</h3>
                <TopNames groups={Object.fromEntries(stats.entities.map((g) => [g.label, g.top]))} b={b} />
              </div>
            )}
          </>
        )}
        {bookBundles.map((x) => (
          <div className="section" key={x.id}>
            <h3>{bookBundles.length > 1 ? b.bundleName(x) : b.t('book.title')}</h3>
            <BookEpisode book={docs![x.id] as BookStats} seconds={stats?.durationSeconds ?? null} season={season} places={places} b={b} />
          </div>
        ))}
        {podcastDocs[0] && <p className="tiny muted section">{sourceLine(podcastDocs[0], b)}</p>}
      </section>
    </Root>
  );
}

function episodeTiles(s: EpisodeStats, b: Basics) {
  const laughs = s.events.find((e) => e.label === LAUGHTER);
  const wpm = s.speakers.some((x) => x.words != null) && s.speechSeconds
    ? (s.words ?? 0) / (s.speakers.reduce((a, x) => a + x.speakingSeconds, 0) / 60)
    : null;
  return [
    s.durationSeconds != null && { label: b.t('tile.length'), value: fmt.clock(s.durationSeconds) },
    s.speechSeconds != null && !!s.durationSeconds && {
      label: b.t('tile.talking'),
      value: fmt.percent(s.speechSeconds / s.durationSeconds, b.locale),
      sub: b.t('tile.talkingSub', { time: fmt.clock(s.speechSeconds) }),
    },
    s.words != null && { label: b.t('tile.words'), value: fmt.compact(s.words, b.locale) },
    wpm != null && { label: b.t('tile.pace'), value: b.t('unit.wpm', { n: fmt.count(wpm, b.locale) }) },
    s.longestSilence && {
      label: b.t('tile.pause'),
      value: fmt.pause(s.longestSilence.seconds, b.locale),
      sub: b.t('tile.at', { time: fmt.clock(s.longestSilence.at) }),
    },
    laughs && { label: b.t('tile.laughs'), value: fmt.count(laughs.count, b.locale) },
    s.questions != null && { label: b.t('tile.questions'), value: fmt.count(s.questions, b.locale) },
  ];
}

function sourceLine(s: EpisodeStats, b: Basics): string {
  const parts: string[] = [];
  if (s.source?.tool) parts.push(b.t('source.by', { tool: s.source.tool }));
  const models = (s.extra?.models ?? {}) as Record<string, string>;
  if (models.transcriber) parts.push(models.transcriber);
  parts.push(b.t('source.note'));
  return parts.join(' · ');
}
