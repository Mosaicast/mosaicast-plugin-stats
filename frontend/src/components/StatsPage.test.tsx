// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { makeMockCtx, makeMockDocs, makeMockFeeds } from '@mosaicast/plugin-sdk/testing';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetShared } from '../data';
import { flush, index, mount, stats } from '../test/fixtures';
import { StatsPage } from './StatsPage';

const episodes = ['s5e2', 's5e1', 'pro', 's4e1'];
const labels = { s5e2: 'S05E02 · Catelyn I', s5e1: 'S05E01 · Jaime I', pro: 'S05 · Prolog', s4e1: 'S04E01 · Tyrion I' };

function ctxAt(path: string, opts: { role?: 'podcaster'; docs?: ReturnType<typeof makeMockDocs> } = {}) {
  const docs = opts.docs ?? makeMockDocs({
    'data/site/main/index': index({ s5e2: stats({ laughs: 2 }), s5e1: stats({ alex: 300, max: 700 }), s4e1: stats() }),
  });
  const feeds = makeMockFeeds()
    .withDisplay('s5e2', { title: 'Catelyn I', description: '', feed: 'gop', season: 5, episodeNo: 2 })
    .withDisplay('s5e1', { title: 'Jaime I', description: '', feed: 'gop', season: 5, episodeNo: 1 })
    .withDisplay('pro', { title: 'Prolog', description: '', feed: 'gop', season: 5 })
    .withDisplay('s4e1', { title: 'Tyrion I', description: '', feed: 'gop', season: 4, episodeNo: 1 });
  return makeMockCtx({
    route: { path },
    episodes,
    episodeLabels: labels,
    docs,
    feeds,
    user: opts.role ? { id: 'u1', role: opts.role, displayName: 'Pod', avatarUrl: '/api/users/u1/avatar' } : null,
  });
}

describe('StatsPage', () => {
  beforeEach(() => forgetShared());

  it('shows the whole show with a tab per season and a season table', async () => {
    const view = await mount(<StatsPage ctx={ctxAt('')} />);
    await flush();
    const tabs = [...view.host.querySelectorAll('nav a')].map((a) => a.textContent);
    expect(tabs).toEqual(['All', 'Season 5', 'Season 4']);
    expect(view.text()).toContain('of 4');
    expect(view.text()).toContain('Records');
    expect(view.text()).toContain('Seasons');
  });

  it('counts a season-only episode in its season', async () => {
    const view = await mount(<StatsPage ctx={ctxAt('season/5')} />);
    await flush();
    expect(view.text()).toContain('Season 5');
    expect(view.text()).toContain('of 3');
  });

  it('moves between its pages without a reload', async () => {
    const ctx = ctxAt('');
    const view = await mount(<StatsPage ctx={ctx} />);
    await flush();
    const tab = [...view.host.querySelectorAll('nav a')].find((a) => a.textContent === 'Season 4') as HTMLAnchorElement;
    expect(tab.getAttribute('href')).toBe('/p/stats/season/4');
    await act(async () => tab.click());
    expect(ctx.navigations).toEqual([{ subpath: 'season/4', replace: false }]);
  });

  it('keeps the manage page to podcasters', async () => {
    const visitor = await mount(<StatsPage ctx={ctxAt('manage')} />);
    expect(visitor.text()).toContain('Only podcasters can manage stats.');
    expect([...visitor.host.querySelectorAll('nav a')].map((a) => a.textContent)).not.toContain(' Manage');
  });

  it('says so for an unknown subpath and when nothing is analysed yet', async () => {
    const lost = await mount(<StatsPage ctx={ctxAt('nope/really')} />);
    expect(lost.text()).toContain("There's nothing here.");
    forgetShared();
    const empty = await mount(<StatsPage ctx={ctxAt('', { docs: makeMockDocs() })} />);
    await flush();
    expect(empty.text()).toContain('No stats yet.');
  });
});
