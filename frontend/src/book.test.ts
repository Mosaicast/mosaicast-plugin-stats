// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { bookSlug, chapterPoints, chapterRankings, pace, sentenceTotals } from './book';
import { stats } from './test/fixtures';
import type { BookSummary } from './types';

function part(book: string, chapters: [number, string, number, number?, number?][]): BookSummary {
  return {
    book,
    title: book.toUpperCase(),
    chapters: chapters.map(([index, heading, words, sentences, dialogue]) => ({
      id: `c${index}`, index, heading, words, sentences: sentences ?? null, paragraphs: 5, dialogue: dialogue ?? null,
      longestSentence: sentences ? 40 + index : null, questions: sentences ? index : null,
    })),
    words: chapters.reduce((a, c) => a + c[2], 0),
    paragraphs: 5,
    characters: [],
    newCharacters: [],
  };
}

describe('book stats chapter by chapter', () => {
  // Newest episode first, as the host lists them.
  const slugs = ['e4', 'e3', 'e2', 'e1'];
  const books = {
    e1: part('b5', [[0, 'Prolog', 3000, 200, 60]]),
    e2: part('b5', [[2, 'Catelyn I', 5000, 400, 200], [1, 'Jaime I', 6000, 500, 100]]),
    e3: part('b6', [[0, 'Arya I', 4000, 300, 150]]),
    e4: part('b5', [[1, 'Jaime I', 6000, 500, 100]]), // the same chapter again, e.g. a spoiler episode
  };

  it('orders books as the show reaches them and chapters as the book has them, each chapter once', () => {
    const points = chapterPoints(books, slugs);
    expect(points.map((p) => p.key)).toEqual(['b5/c0', 'b5/c1', 'b5/c2', 'b6/c0']);
    expect(points[1].slug).toBe('e2');
    expect(points[1].avgSentence).toBe(12);
    expect(points[1].dialogueShare).toBe(0.2);
    expect(chapterPoints(books, slugs, 'b6').map((p) => p.heading)).toEqual(['Arya I']);
  });

  it('adds sentences up only when every chapter knows them', () => {
    const t = sentenceTotals(chapterPoints(books, slugs));
    expect(t.chapters).toBe(4);
    expect(t.sentences).toBe(1400);
    expect(t.avgSentence).toBeCloseTo(18000 / 1400);
    expect(t.dialogueShare).toBeCloseTo(510 / 1400);
    expect(t.longestSentence).toBe(42);
    const unknown = sentenceTotals(chapterPoints({ x: part('b', [[0, 'A', 100]]) }, ['x']));
    expect(unknown.sentences).toBeNull();
    expect(unknown.dialogueShare).toBeNull();
  });

  it('finds records, but ratios only for chapters long enough to mean something', () => {
    const tiny = { ...books, e5: part('b6', [[1, 'Epigraph', 30, 3, 3]]) };
    const r = Object.fromEntries(chapterRankings(chapterPoints(tiny, ['e5', ...slugs])).map((x) => [x.id, x.entries]));
    expect(r.longest[0].point.heading).toBe('Jaime I');
    expect(r.longest.map((e) => e.point.heading)).toEqual(['Jaime I', 'Catelyn I', 'Arya I', 'Prolog', 'Epigraph']);
    expect(r.shortest[0].point.heading).toBe('Epigraph');
    expect(r.mostDialogue[0].point.heading).toBe('Catelyn I'); // not the epigraph's 100 %
    expect(r.mostDialogue).toHaveLength(4);
    expect(r.leastDialogue[0].point.heading).toBe('Jaime I');
  });

  it('counts podcast time only for episodes whose chapters are all in the set', () => {
    const podcasts = { e2: { ...stats(), durationSeconds: 3300 }, e1: { ...stats(), durationSeconds: 900 } };
    const all = chapterPoints(books, slugs);
    expect(pace(all, books, podcasts)).toBeCloseTo((4200 / 60) / 14);
    // Only Catelyn I: episode e2 also covers Jaime I, so its time can't be split off.
    expect(pace(all.filter((p) => p.heading === 'Catelyn I'), books, podcasts)).toBeNull();
  });

  it('makes the same URL names as the backend', () => {
    expect(bookSlug('Das Lied von Eis und Feuer 05')).toBe('das-lied-von-eis-und-feuer-05');
    expect(bookSlug('Schöne Grüße')).toBe('schone-grusse');
    expect(bookSlug('!!!')).toBe('book');
    expect(bookSlug(null)).toBe('book');
  });
});
