// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { makeMockCtx, makeMockDocs } from '@mosaicast/plugin-sdk/testing';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetShared } from '../data';
import { flush, index, mount, stats } from '../test/fixtures';
import { Overview } from './Overview';

const labels = { s5e2: 'S05E02 · Catelyn I', s5e1: 'S05E01 · Jaime I', s4e1: 'S04E01 · Tyrion I', s4e2: 'S04E02 · Arya I' };

function ctxWith(docs: ReturnType<typeof makeMockDocs>, role: 'podcaster' | null = null) {
  return makeMockCtx({
    scope: { type: 'feed', id: 'gop' },
    episodes: ['s5e2', 's5e1', 's4e2', 's4e1'],
    episodeLabels: labels,
    docs,
    user: role ? { id: 'u1', role, displayName: 'Pod', avatarUrl: '/api/users/u1/avatar' } : null,
  });
}

describe('Overview', () => {
  beforeEach(() => forgetShared());

  it('shows a loading bar until the index arrives, then the aggregate', async () => {
    const waiting: (() => void)[] = [];
    const release = () => waiting.splice(0).forEach((go) => go());
    const docs = makeMockDocs({
      'data/site/main/index': index({ s5e2: stats({ alex: 600, max: 400 }), s5e1: stats({ alex: 500, max: 500 }), s4e1: stats({ alex: 100, max: 900 }) }),
    });
    const slow = { ...docs, get: <T,>(...args: Parameters<typeof docs.get>) => new Promise<T | null>((r) => { waiting.push(() => r(docs.get<T>(...args) as never)); }) };
    const ctx = ctxWith(docs);
    const view = await mount(<Overview ctx={{ ...ctx, docs: slow }} />);
    expect(view.host.querySelector('[role="progressbar"]')).not.toBeNull();
    await act(async () => release());
    await flush();
    expect(view.host.querySelector('[role="progressbar"]')).toBeNull();
    expect(view.text()).toContain('3 of 4');
    expect(view.text()).toContain('Alex');
  });

  it('switches to one season and back', async () => {
    const docs = makeMockDocs({
      'data/site/main/index': index({ s5e2: stats({ alex: 600, max: 400 }), s5e1: stats({ alex: 500, max: 500 }), s4e1: stats({ alex: 100, max: 900 }) }),
    });
    const view = await mount(<Overview ctx={ctxWith(docs)} />);
    const chip = (name: string) => [...view.host.querySelectorAll('button.chip')].find((b) => b.textContent === name) as HTMLButtonElement;
    expect(chip('S5')).toBeTruthy();
    await act(async () => chip('S4').click());
    expect(view.text()).toContain('1 of 2');
    expect(chip('S4').getAttribute('aria-pressed')).toBe('true');
    await act(async () => chip('All').click());
    expect(view.text()).toContain('3 of 4');
  });

  it("follows the shell's season filter", async () => {
    const docs = makeMockDocs({
      'data/site/main/index': index({ s5e2: stats({ alex: 600, max: 400 }), s5e1: stats({ alex: 500, max: 500 }), s4e1: stats({ alex: 100, max: 900 }) }),
    });
    const listeners: ((f: { season?: number }) => void)[] = [];
    let current: { season?: number } = { season: 4 };
    const ctx = { ...ctxWith(docs), filter: { current: () => current, onChange: (cb: (f: { season?: number }) => void) => { listeners.push(cb); return () => undefined; } } };
    const view = await mount(<Overview ctx={ctx} />);
    expect(view.text()).toContain('Season 4');
    expect(view.text()).toContain('1 of 2');
    expect(view.host.querySelectorAll('button.chip')).toHaveLength(0);
    current = {};
    await act(async () => listeners.forEach((l) => l(current)));
    expect(view.text()).toContain('3 of 4');
    expect(view.host.querySelectorAll('button.chip').length).toBeGreaterThan(0);
  });

  it('hides for visitors when the filtered season has no stats', async () => {
    const docs = makeMockDocs({ 'data/site/main/index': index({ s5e2: stats() }) });
    const ctx = { ...ctxWith(docs), filter: { current: () => ({ season: 4 }), onChange: () => () => undefined } };
    const view = await mount(<Overview ctx={ctx} />);
    expect(view.text()).toBe('');
  });

  it('stays out of the way for visitors when nothing has stats', async () => {
    const view = await mount(<Overview ctx={ctxWith(makeMockDocs())} />);
    expect(view.text()).toBe('');
  });

  it('points podcasters at the upload page when nothing has stats', async () => {
    const ctx = ctxWith(makeMockDocs(), 'podcaster');
    const view = await mount(<Overview ctx={ctx} />);
    const link = view.host.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/p/stats/manage');
    await act(async () => link.click());
    expect(ctx.navigations).toEqual([{ subpath: 'manage', replace: false }]);
  });
});
