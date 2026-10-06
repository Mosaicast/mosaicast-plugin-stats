// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregate';
import { podcastRankings } from './records';
import { stats } from './test/fixtures';

describe('podcast records', () => {
  const byEpisode = {
    a: stats({ alex: 900, max: 100, laughs: 4, durationSeconds: 3600 }),
    b: stats({ alex: 500, max: 500, laughs: 1, durationSeconds: 1800, overlapSeconds: 30 }),
    c: stats({ alex: 300, max: 700, durationSeconds: 2400 }),
  };
  const slugs = ['c', 'b', 'a'];
  const ranks = Object.fromEntries(podcastRankings(byEpisode, slugs, aggregate(byEpisode, slugs).speakers).map((r) => [r.id, r]));

  it('ranks every episode, best first', () => {
    expect(ranks.longest.entries.map((e) => e.slug)).toEqual(['a', 'c', 'b']);
    expect(ranks.shortest.entries.map((e) => e.slug)).toEqual(['b', 'c', 'a']);
    expect(ranks.laughs.entries.map((e) => [e.slug, e.value])).toEqual([['a', 4], ['b', 1], ['c', 0]]);
    expect(ranks.laughs.entries[0].extra).toBe(4); // per hour
    expect(ranks.crosstalk.entries[0].slug).toBe('b');
  });

  it('knows who dominated and which episode was the most even', () => {
    expect(ranks.oneSided.entries[0]).toMatchObject({ slug: 'a', key: 'alex-1', value: 0.9 });
    expect(ranks.balanced.entries[0]).toMatchObject({ slug: 'b', value: 0, split: [0.5, 0.5] });
  });

  it('ranks people over the whole scope, and every long turn', () => {
    expect(ranks.fastest.of).toBe('speaker');
    expect(ranks.fastest.entries.map((e) => e.key)).toHaveLength(2);
    expect(ranks.asks.entries[0].key).toBe('alex-1');
    expect(ranks.monologue.entries).toHaveLength(6); // two people × three episodes
    expect(ranks.monologue.entries[0]).toMatchObject({ key: 'alex-1', value: 61 });
  });
});
