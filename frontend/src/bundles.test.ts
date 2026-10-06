// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { aggregateBooks, versus } from './book';
import { bundleId, bundlesWithData, resolveBundles } from './bundles';
import { combine } from './combine';
import { effective } from './viewChoice';
import { bookSummary, index, stats } from './test/fixtures';

describe('bundles', () => {
  it('fills in one default bundle per kind and drops what the backend would drop', () => {
    const list = resolveBundles({ bundles: [
      { id: 'main', kind: 'podcast', name: 'Episode' },
      { id: '../evil', kind: 'podcast' },
      { id: 'video', kind: 'video' as never },
      { id: 'main', kind: 'podcast', name: 'duplicate' },
    ] });
    expect(list.map((b) => b.id)).toEqual(['main', 'book']);
    expect(resolveBundles(null).map((b) => b.id)).toEqual(['podcast', 'book']);
  });

  it('makes ids from names', () => {
    expect(bundleId('Spoiler-Folge!', [])).toBe('spoiler-folge');
    expect(bundleId('Spoiler', ['spoiler'])).toBe('spoiler-2');
    expect(bundleId('', [])).toBe('bundle');
  });

  it('lists only bundles with data in the scope', () => {
    const all = resolveBundles({ bundles: [
      { id: 'main', kind: 'podcast' }, { id: 'spoiler', kind: 'podcast', spoiler: true }, { id: 'book', kind: 'book' },
    ] });
    const idx = index({}, { bundles: { e1: { main: stats() } }, books: { e2: { book: bookSummary([{ heading: 'Prolog', words: 5000 }]) } } });
    expect(bundlesWithData(all, idx, ['e1']).map((b) => b.id)).toEqual(['main']);
    expect(bundlesWithData(all, idx, ['e1', 'e2']).map((b) => b.id)).toEqual(['main', 'book']);
  });
});

describe('view choice', () => {
  const available = resolveBundles({ bundles: [
    { id: 'main', kind: 'podcast' }, { id: 'spoiler', kind: 'podcast', spoiler: true },
  ] }).filter((b) => b.kind === 'podcast');

  it('leaves spoilers out by default', () => {
    expect([...effective({ bundles: null, spoilers: false }, available)]).toEqual(['main']);
  });

  it('a spoiler bundle only counts with spoilers on, even if it was ticked', () => {
    expect([...effective({ bundles: ['main', 'spoiler'], spoilers: false }, available)]).toEqual(['main']);
    expect([...effective({ bundles: ['main', 'spoiler'], spoilers: true }, available)]).toEqual(['main', 'spoiler']);
    expect([...effective({ bundles: [], spoilers: true }, available)]).toEqual([]);
  });
});

describe('combine', () => {
  it('adds two recordings of one episode', () => {
    const c = combine([stats({ alex: 600, max: 400 }), stats({ alex: 100, max: 900, laughs: 2 })])!;
    expect(c.durationSeconds).toBe(2400);
    const alex = c.speakers.find((s) => s.key === 'alex-1')!;
    expect(alex.speakingSeconds).toBe(700);
    expect(alex.share).toBeCloseTo(700 / 2000);
    expect(c.speakers[0].key).toBe('max-1');
    expect(c.timeline).toBeNull();
    expect(c.events.find((e) => e.label === 'laughter')?.count).toBe(2);
  });

  it('passes a single one through untouched', () => {
    const s = stats();
    expect(combine([s])).toBe(s);
    expect(combine([])).toBeNull();
  });
});

describe('books', () => {
  it('puts podcast time next to book length and compares', () => {
    const books = {
      a: bookSummary([{ heading: 'Prolog', words: 6000, sentences: 500 }], ['Sam']),
      b: bookSummary([{ heading: 'Jaime I', words: 3000, sentences: 250 }], ['Jaime']),
      c: bookSummary([{ heading: 'Arya I', words: 4000 }]),
    };
    const podcasts = { a: stats({ durationSeconds: 3600 }), b: stats({ durationSeconds: 3600 }) };
    const agg = aggregateBooks(books, podcasts, ['a', 'b', 'c']);
    expect(agg.chapters).toBe(3);
    expect(agg.words).toBe(13000);
    expect(agg.minutesPerKWords).toBeCloseTo(120 / 9, 5); // c has no podcast stats, so it doesn't count
    const [a, b] = agg.rows;
    expect(a.minutesPerKWords).toBeCloseTo(10);
    expect(b.minutesPerKWords).toBeCloseTo(20);
    expect(versus(b.minutesPerKWords, agg.minutesPerKWords)).toBeCloseTo(0.5);
    expect(agg.sentences).toBeNull();
  });
});
