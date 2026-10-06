// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregate';
import { stats } from './test/fixtures';

describe('aggregate', () => {
  const byEpisode = {
    e1: stats({ alex: 600, max: 400, laughs: 2, durationSeconds: 1200 }),
    e2: stats({ alex: 300, max: 700, laughs: 5, durationSeconds: 3000 }),
  };

  it('sums the episodes it is given and skips the ones without stats', () => {
    const a = aggregate(byEpisode, ['e1', 'e2', 'e3']);
    expect(a.analysed).toBe(2);
    expect(a.total).toBe(3);
    expect(a.durationSeconds).toBe(4200);
    expect(a.words).toBe(6000);
    const [first, second] = a.speakers;
    expect(first.key).toBe('max-1');
    expect(first.seconds).toBe(1100);
    expect(first.share).toBeCloseTo(1100 / 2000);
    expect(second.share).toBeCloseTo(900 / 2000);
    expect(first.episodes).toBe(2);
  });

  it('finds the records', () => {
    const a = aggregate(byEpisode, ['e1', 'e2']);
    expect(a.longestEpisode).toEqual({ slug: 'e2', value: 3000 });
    expect(a.shortestEpisode).toEqual({ slug: 'e1', value: 1200 });
    expect(a.mostLaughs).toEqual({ slug: 'e2', value: 5 });
    expect(a.longestTurn).toMatchObject({ value: 61, key: 'alex-1' });
    expect(a.events.laughter.count).toBe(7);
  });

  it('adds up mentions case-insensitively', () => {
    const a = aggregate({
      e1: stats({ entities: [{ label: 'PERSON', top: [{ text: 'Jon', count: 3 }] }] }),
      e2: stats({ entities: [{ label: 'PERSON', top: [{ text: 'jon', count: 1 }, { text: 'Arya', count: 2 }] }] }),
    }, ['e1', 'e2']);
    expect(a.entities.PERSON[0]).toEqual({ text: 'Jon', count: 4, episodes: 2 });
  });

  it('works for an empty set', () => {
    const a = aggregate(byEpisode, []);
    expect(a.analysed).toBe(0);
    expect(a.speakers).toEqual([]);
    expect(a.longestEpisode).toBeNull();
  });

  it('keeps pace honest when some episodes have no word counts', () => {
    const noWords = stats();
    noWords.speakers = noWords.speakers.map((s) => ({ ...s, words: null }));
    const a = aggregate({ e1: stats(), e2: noWords }, ['e1', 'e2']);
    const alex = a.speakers.find((s) => s.key === 'alex-1')!;
    expect(alex.wpm).toBeCloseTo(1800 / 10);
  });
});
