// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { makeMockCtx, makeMockDocs, makeMockEpisode } from '@mosaicast/plugin-sdk/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetShared } from '../data';
import { index, mount, stats } from '../test/fixtures';
import { CardLine } from './CardLine';
import { EpisodeView } from './EpisodeView';

describe('EpisodeView', () => {
  beforeEach(() => forgetShared());

  it('shows shares, tiles, the speaker table and the names', async () => {
    const docs = makeMockDocs({
      'data/episode/ep-1/stats:podcast': stats({ laughs: 3 }),
      'data/site/main/index': index({ 'ep-1': stats({ laughs: 3 }) }),
    });
    const ctx = makeMockCtx({ scope: { type: 'episode', id: 'ep-1' }, episodes: ['ep-1'], docs });
    const view = await mount(<EpisodeView ctx={ctx} />);
    const text = view.text();
    expect(text).toContain('Episode stats');
    expect(text).toContain('Alex');
    expect(text).toContain('60%');
    expect(text).toContain('20:00');
    expect(text).toContain('Laughs');
    expect(text).toContain('Jon');
    expect(view.host.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(view.host.querySelector('.lanes')).not.toBeNull();
    const longest = view.host.querySelector('tbody a') as HTMLAnchorElement;
    expect(longest.getAttribute('href')).toBe(ctx.links.episode('ep-1', { t: 120 }));
  });

  it('renders nothing for a visitor when the episode has no stats', async () => {
    const ctx = makeMockCtx({ scope: { type: 'episode', id: 'ep-1' }, episodes: ['ep-1'] });
    const view = await mount(<EpisodeView ctx={ctx} />);
    expect(view.text()).toBe('');
  });

  it('tells podcasters that stats wait for a planned episode', async () => {
    const ctx = makeMockCtx({
      scope: { type: 'episode', id: 'ep-9' },
      episode: makeMockEpisode('planned'),
      user: { id: 'u1', role: 'podcaster', displayName: 'Pod', avatarUrl: '/api/users/u1/avatar' },
    });
    const view = await mount(<EpisodeView ctx={ctx} />);
    expect(view.text()).toContain("show up once it's released");
  });

  it('uses the names the podcaster set', async () => {
    const docs = makeMockDocs({
      'data/episode/ep-1/stats:podcast': stats(),
      'data/site/main/index': index({ 'ep-1': stats() }),
      'data/site/main/speakers': { people: { 'max-1': { name: 'Maximilian' } } },
    });
    const view = await mount(<EpisodeView ctx={makeMockCtx({ scope: { type: 'episode', id: 'ep-1' }, docs })} />);
    expect(view.text()).toContain('Maximilian');
  });
});

describe('CardLine', () => {
  beforeEach(() => forgetShared());

  it('shares one index read between many cards', async () => {
    const docs = makeMockDocs({ 'data/site/main/index': index({ a: stats(), b: stats({ alex: 100, max: 300 }) }) });
    const views = await Promise.all(['a', 'b', 'c'].map((slug) =>
      mount(<CardLine ctx={makeMockCtx({ scope: { type: 'episode', id: slug }, docs })} />)));
    expect(views[0].text()).toContain('Alex 60% · Max 40%');
    expect(views[1].text()).toContain('Max 75%');
    expect(views[2].text()).toBe('');
    expect(docs.calls.filter((c) => c.keys.includes('index'))).toHaveLength(1);
  });
});
