// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { makeMockCtx, makeMockFeeds } from '@mosaicast/plugin-sdk/testing';
import { describe, expect, it } from 'vitest';
import { bySeason, seasonFromLabel, useSeasons, type SeasonLookup } from './seasons';
import { flush, mount } from './test/fixtures';

describe('seasons', () => {
  const labels = {
    a: 'S05E02 · Catelyn I',
    b: 'S05E01 · Jaime I',
    c: 'S05 · 5.00 Prolog',
    d: 'S04E41 · Finale',
    e: 'Bonus: live show',
  };

  it('falls back to the host label, with or without an episode number', () => {
    expect(seasonFromLabel('a', labels)).toBe(5);
    expect(seasonFromLabel('c', labels)).toBe(5);
    expect(seasonFromLabel('d', labels)).toBe(4);
    expect(seasonFromLabel('e', labels)).toBeNull();
    expect(seasonFromLabel('zzz', labels)).toBeNull();
  });

  it('groups newest season first, unnumbered last, order kept inside', () => {
    const groups = bySeason(['e', 'c', 'a', 'd', 'b'], (s) => seasonFromLabel(s, labels));
    expect([...groups.keys()]).toEqual([5, 4, null]);
    expect(groups.get(5)).toEqual(['c', 'a', 'b']);
  });

  it('prefers the season the snapshot carries', async () => {
    const feeds = makeMockFeeds()
      .withDisplay('a', { title: 'Catelyn I', description: '', feed: 'gop', season: 6 })
      .withDisplay('e', { title: 'Bonus', description: '', feed: 'gop' });
    const ctx = makeMockCtx({ feeds, episodes: ['a', 'e', 'd'], episodeLabels: labels });
    let lookup: SeasonLookup = () => null;
    function Probe() {
      lookup = useSeasons(ctx, ctx.episodes);
      return null;
    }
    await mount(<Probe />);
    await flush();
    expect(lookup('a')).toBe(6);
    expect(lookup('e')).toBeNull();
    expect(lookup('d')).toBe(4); // not in the answer: the label still counts
  });
});
