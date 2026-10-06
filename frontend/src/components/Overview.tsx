// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import type { FilterState } from '@mosaicast/plugin-sdk';
import { useEffect, useMemo, useState } from 'react';
import { aggregate, LAUGHTER } from '../aggregate';
import { canManage } from '../data';
import * as fmt from '../format';
import { bySeason, useSeasons } from '../seasons';
import { hasStats, Icon, LoadingBar, Root, ShareBar, useEpisodesReady, useSelection, useSiteData } from './common';
import { aggregateBooks } from '../book';

/**
 * The compact aggregate in a feed or site panel. Sums the stats of the episodes the host resolved for this
 * scope. When the visitor filters the feed by season, it follows that filter; otherwise it offers its own
 * season switch.
 */
export function Overview({ ctx }: { ctx: PluginContext }) {
  const { index, failed, basics: b } = useSiteData(ctx);
  const ready = useEpisodesReady(ctx);
  const [picked, setPicked] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterState>(() => ctx.filter.current());
  useEffect(() => {
    setFilter(ctx.filter.current());
    return ctx.filter.onChange(setFilter);
  }, [ctx.filter]);
  // The shell's season filter wins; on hosts before core 0.7.6 it is always empty.
  const shellSeason = typeof filter.season === 'number' ? filter.season : null;
  const season = shellSeason ?? picked;
  const seasonOf = useSeasons(ctx, ctx.episodes);
  const groups = useMemo(() => bySeason(ctx.episodes, seasonOf), [ctx.episodes, seasonOf]);
  const withStats = useMemo(
    () => [...groups.entries()].filter(([n, list]) => n !== null && list.some((s) => hasStats(index, s))).map(([n]) => n!),
    [groups, index],
  );
  const slugs = season !== null ? groups.get(season) ?? [] : ctx.episodes;
  const sel = useSelection(ctx, b, index, ctx.episodes);
  const agg = useMemo(() => (index ? aggregate(sel.podcasts, slugs) : null), [index, sel.podcasts, slugs]);
  const book = useMemo(() => aggregateBooks(sel.books, sel.podcasts, slugs), [sel.books, sel.podcasts, slugs]);

  if (failed) return null;
  if (index === undefined || !ready) {
    return (
      <Root>
        <section className="panel">
          <h2 className="small" style={{ marginBottom: 10 }}>{b.t('overview.title')}</h2>
          <LoadingBar label={b.t('loading')} />
        </section>
      </Root>
    );
  }
  const anyStats = ctx.episodes.some((s) => hasStats(index, s));
  if (!anyStats) {
    if (!canManage(ctx)) return null;
    return (
      <Root>
        <p className="note small">
          <Icon name="info" />
          <span>
            {b.t('overview.none')}{' '}
            <a href="/p/stats/manage" onClick={(e) => { e.preventDefault(); ctx.route.navigate('manage'); }}>
              {b.t('episode.upload')}
            </a>
          </span>
        </p>
      </Root>
    );
  }
  // Filtered to a season nobody analysed: nothing to tell a visitor, so stay out of the panel.
  if (shellSeason !== null && !slugs.some((s) => hasStats(index, s)) && !canManage(ctx)) return null;
  const more = season !== null ? `season/${season}` : '';
  const laughs = agg?.events[LAUGHTER]?.count ?? 0;
  return (
    <Root>
      <section className="panel" aria-labelledby="overview-title">
        <div className="head" style={{ marginBottom: 10 }}>
          <h2 id="overview-title" style={{ fontSize: '1.05rem' }}>{b.t('overview.title')}</h2>
          <span className="tiny muted">{b.t('tile.analysedOf', { n: slugs.filter((x) => hasStats(index, x)).length, total: slugs.length })}</span>
        </div>
        {shellSeason !== null && <p className="small muted" style={{ margin: '0 0 12px' }}>{b.t('seasons.label', { n: shellSeason })}</p>}
        {shellSeason === null && withStats.length > 0 && (
          <div className="chips" role="group" aria-label={b.t('seasons.title')} style={{ marginBottom: 12 }}>
            <button type="button" className="chip" aria-pressed={season === null} onClick={() => setPicked(null)}>
              {b.t('seasons.all')}
            </button>
            {withStats.map((n) => (
              <button type="button" key={n} className="chip" aria-pressed={season === n} onClick={() => setPicked(n)}>
                {b.t('seasons.short', { n })}
              </button>
            ))}
          </div>
        )}
        {sel.picker}
        {(agg && agg.analysed > 0) || book.episodes > 0 ? (
          <>
            {agg && agg.analysed > 0 && <ShareBar parts={agg.speakers} b={b} />}
            <dl className="facts">
              {agg && agg.durationSeconds > 0 && (
                <div><dt>{b.t('tile.average')}</dt><dd>{fmt.clock(agg.durationSeconds / agg.analysed)}</dd></div>
              )}
              {agg && agg.words > 0 && <div><dt>{b.t('tile.words')}</dt><dd>{fmt.compact(agg.words, b.locale)}</dd></div>}
              {laughs > 0 && <div><dt>{b.t('tile.laughs')}</dt><dd>{fmt.count(laughs, b.locale)}</dd></div>}
              {book.chapters > 0 && <div><dt>{b.t('book.chapters')}</dt><dd>{fmt.count(book.chapters, b.locale)}</dd></div>}
              {book.minutesPerKWords != null && (
                <div><dt>{b.t('book.pace')}</dt><dd>{b.t('book.paceValue', { n: fmt.decimal(book.minutesPerKWords, b.locale) })}</dd></div>
              )}
            </dl>
          </>
        ) : (
          <p className="small muted">{b.t('bundle.nothingSelected')}</p>
        )}
        <p className="small" style={{ margin: '14px 0 0' }}>
          <a href={`/p/stats/${more}`} onClick={(e) => { e.preventDefault(); ctx.route.navigate(more); }}>
            {b.t('overview.more')} <Icon name="arrow-right" />
          </a>
        </p>
      </section>
    </Root>
  );
}
