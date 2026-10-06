// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { matchRoute, type PluginContext } from '@mosaicast/plugin-sdk';
import { useMemo } from 'react';
import { canManage } from '../data';
import { bookOf } from '../book';
import { bySeason, useSeasons } from '../seasons';
import { BookOverview } from './BookOverview';
import { hasStats, Icon, LoadingBar, Root, useEpisodesReady, useSelection, useSiteData } from './common';
import { Manage } from './Manage';
import { ScopeStats } from './ScopeStats';

/**
 * Everything under /p/stats/: the show's podcast stats (all seasons or one), the books behind it (all, one
 * season, or one book), and the manage page.
 */
export function StatsPage({ ctx }: { ctx: PluginContext }) {
  const { index, failed, basics: b } = useSiteData(ctx);
  const ready = useEpisodesReady(ctx);
  const match = matchRoute(ctx.route.path, ['', 'season/:n', 'manage', 'books', 'books/season/:n', 'books/:book']);
  const seasonOf = useSeasons(ctx, ctx.episodes);
  const groups = useMemo(() => bySeason(ctx.episodes, seasonOf), [ctx.episodes, seasonOf]);
  const sel = useSelection(ctx, b, index, ctx.episodes);

  const hasPodcasts = Object.keys(index?.episodes ?? {}).length > 0;
  const hasBooks = Object.keys(index?.books ?? {}).length > 0;
  const pattern = match?.pattern;
  const booksMode = pattern?.startsWith('books') || (!hasPodcasts && hasBooks && pattern !== 'manage');
  const seasons = [...groups.entries()]
    .filter(([n, list]) => n !== null && list.some((s) => (booksMode ? !!index?.books?.[s] : hasStats(index, s))))
    .map(([n]) => n!);
  const bookList = useMemo(() => {
    const seen = new Map<string, string>();
    for (const slug of [...ctx.episodes].reverse()) {
      for (const summary of Object.values(index?.books?.[slug] ?? {})) {
        if (!seen.has(bookOf(summary))) seen.set(bookOf(summary), summary.title || bookOf(summary));
      }
    }
    return [...seen.entries()].map(([id, title]) => ({ id, title }));
  }, [index, ctx.episodes]);

  const go = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    ctx.route.navigate(path);
  };
  const current = match ? ctx.route.path.replace(/^\/+|\/+$/g, '') : null;
  const prefix = booksMode ? 'books' : '';
  const at = (path: string) => (current === path ? 'page' : undefined);
  const chip = (path: string, label: React.ReactNode) => (
    <a key={path} className="chip" href={`/p/stats${path ? `/${path}` : ''}`} onClick={go(path)} aria-current={at(path)}>{label}</a>
  );
  const join = (...parts: string[]) => parts.filter(Boolean).join('/');

  const tabs = (
    <>
      {(hasPodcasts && hasBooks) || canManage(ctx) ? (
        <nav className="chips tabs" aria-label={b.t('page.sections')} style={pattern !== 'manage' ? { marginBottom: 8 } : undefined}>
          {hasPodcasts && hasBooks && (
            <>
              <a className="chip" href="/p/stats" onClick={go('')} aria-current={!booksMode && pattern !== 'manage' ? 'page' : undefined}>{b.t('page.podcast')}</a>
              <a className="chip" href="/p/stats/books" onClick={go('books')} aria-current={booksMode ? 'page' : undefined}>{b.t('books.tab')}</a>
            </>
          )}
          {canManage(ctx) && chip('manage', <><Icon name="upload" /> {b.t('manage.title')}</>)}
        </nav>
      ) : null}
      {pattern !== 'manage' && (
        <nav className="chips tabs" aria-label={b.t('page.scope')}>
          {chip(prefix, b.t('seasons.all'))}
          {seasons.map((n) => chip(join(prefix, `season/${n}`), b.t('seasons.label', { n })))}
          {booksMode && bookList.length > 0 && bookList.map((x) => chip(`books/${x.id}`, <><Icon name="book" /> {x.title}</>))}
        </nav>
      )}
    </>
  );

  let body: React.ReactNode;
  const books = (slugs: string[], extra: { only?: string; seasonOf?: typeof seasonOf } = {}) => (
    <>
      {sel.picker}
      <BookOverview ctx={ctx} index={index} selected={sel.selected} books={sel.books} podcasts={sel.podcasts} slugs={slugs} b={b}
        only={extra.only} seasonOf={extra.seasonOf} onSeason={(n) => ctx.route.navigate(`books/season/${n}`)}
        onBook={(id) => ctx.route.navigate(`books/${id}`)} />
    </>
  );
  if (!match) {
    body = <p>{b.t('page.notFound')} <a href="/p/stats" onClick={go('')}>{b.t('page.back')}</a></p>;
  } else if (pattern === 'manage') {
    body = canManage(ctx) ? <Manage ctx={ctx} /> : <p className="muted">{b.t('manage.forbidden')}</p>;
  } else if (failed) {
    body = <p className="note bad"><Icon name="warning" /> {b.t('error.load')}</p>;
  } else if (index === undefined || !ready) {
    body = <LoadingBar label={b.t('loading')} />;
  } else if (!index || (!hasPodcasts && !hasBooks)) {
    body = (
      <p className="muted">
        {b.t('page.empty')}{' '}
        {canManage(ctx) && <a href="/p/stats/manage" onClick={go('manage')}>{b.t('episode.upload')}</a>}
      </p>
    );
  } else if (pattern === 'books/:book') {
    body = books(ctx.episodes, { only: match.params.book, seasonOf });
  } else if (pattern === 'books/season/:n' || (booksMode && pattern === 'season/:n')) {
    body = books(groups.get(Number(match.params.n)) ?? []);
  } else if (booksMode) {
    body = books(ctx.episodes, { seasonOf });
  } else if (pattern === 'season/:n') {
    const n = Number(match.params.n);
    body = (
      <>
        {sel.picker}
        <ScopeStats ctx={ctx} podcasts={sel.podcasts} books={sel.books} slugs={groups.get(n) ?? []} b={b}
          booksHref={`/p/stats/books/season/${n}`} onBooks={() => ctx.route.navigate(`books/season/${n}`)} />
      </>
    );
  } else {
    body = (
      <>
        {sel.picker}
        <ScopeStats ctx={ctx} podcasts={sel.podcasts} books={sel.books} slugs={ctx.episodes} b={b} seasonOf={seasonOf}
          onSeason={(n) => ctx.route.navigate(`season/${n}`)} booksHref="/p/stats/books" onBooks={() => ctx.route.navigate('books')} />
      </>
    );
  }

  const bookTitle = pattern === 'books/:book' ? bookList.find((x) => x.id === match?.params.book)?.title : undefined;
  const heading = pattern === 'manage' ? b.t('manage.title')
    : pattern === 'books/:book' ? bookTitle ?? b.t('books.title')
    : match?.params.n ? (booksMode ? b.t('books.seasonTitle', { n: match.params.n }) : b.t('seasons.label', { n: match.params.n }))
    : booksMode ? b.t('books.title') : b.t('page.title');

  return (
    <Root>
      <style>{`.tabs a.chip[aria-current='page'] { background: var(--mc-accent); color: var(--mc-accent-contrast); border-color: var(--mc-accent); text-decoration: none; }
.tabs a.chip { color: var(--mc-text); min-height: 32px; align-items: center; }`}</style>
      <div className="page">
        <h1 style={{ fontSize: '1.6rem', margin: '0 0 6px' }}>{heading}</h1>
        {pattern !== 'manage' && <p className="muted small" style={{ margin: '0 0 16px' }}>{b.t(booksMode ? 'books.lead' : 'page.lead')}</p>}
        {tabs}
        <section className="panel">{body}</section>
      </div>
    </Root>
  );
}
