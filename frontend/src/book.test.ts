// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { bookSlug, chapterGroups, chapterPoints, chapterRankings, groupPlaces, groupRankings, pace, sentenceTotals } from './book';
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

describe('chapter groups', () => {
  /** One chapter per episode: [episode, book, index, heading, group, words, sentences, dialogue]. */
  type Row = [string, string, number, string, string | null, number, number, number];
  function show(rows: Row[]): Record<string, BookSummary> {
    return Object.fromEntries(rows.map(([slug, book, index, heading, group, words, sentences, dialogue]) => [slug, {
      book, title: book.toUpperCase(),
      chapters: [{ id: `c${index}`, index, heading, group, words, sentences, paragraphs: 5, dialogue }],
      words, sentences, paragraphs: 5, characters: [], newCharacters: [],
    }]));
  }
  const books = show([
    ['e1', 'b4', 0, 'Prolog', null, 3000, 200, 50],
    ['e2', 'b4', 1, 'Jaime I', 'Jaime', 6000, 400, 100],
    ['e3', 'b4', 2, 'Arya', null, 4000, 300, 150], // b4's only Arya chapter
    ['e4', 'b4', 3, 'Jaime II', 'Jaime', 4000, 400, 200],
    ['e5', 'b4', 4, 'Epilog', null, 2000, 100, 10],
    ['e6', 'b5', 0, 'Prolog', null, 3000, 200, 50],
    ['e7', 'b5', 1, 'Arya I', 'Arya', 5000, 500, 100],
    ['e8', 'b5', 2, 'Arya II', 'ARYA', 3000, 300, 60],
    ['e9', 'b5', 3, 'jaime', null, 5000, 500, 100], // b5's only Jaime chapter
  ]);
  const slugs = ['e9', 'e8', 'e7', 'e6', 'e5', 'e4', 'e3', 'e2', 'e1'];

  it('groups across books, a single chapter by its heading, never prologues', () => {
    const points = chapterPoints(books, slugs);
    expect(points.map((p) => p.group)).toEqual([null, 'Jaime', 'Arya', 'Jaime', null, null, 'Arya', 'Arya', 'Jaime']);
    const groups = chapterGroups(points, books, {});
    expect(groups.map((g) => [g.title, g.chapters, g.books])).toEqual([['Arya', 3, 2], ['Jaime', 3, 2]]);
    expect(groups[1].words).toBe(15000);
    expect(groups[1].avgWords).toBe(5000);
    expect(groups[1].dialogueShare).toBeCloseTo(400 / 1300);
  });

  it('only groups within one book when the scope is one book', () => {
    const b4 = chapterPoints(books, slugs, 'b4');
    expect(b4.map((p) => p.group)).toEqual([null, 'Jaime', null, 'Jaime', null]);
    expect(chapterGroups(b4, books, {}).map((g) => g.title)).toEqual(['Jaime']);
    // A group with one released chapter so far isn't a group yet.
    expect(chapterGroups(chapterPoints(books, ['e3', 'e2', 'e1']), books, {})).toEqual([]);
  });

  it('has no groups for a book without repeated headings', () => {
    const plain = show([['x1', 'b', 0, 'Chapter 1', null, 100, 10, 1], ['x2', 'b', 1, 'Chapter 2', null, 100, 10, 1]]);
    const points = chapterPoints(plain, ['x2', 'x1']);
    expect(points.every((p) => p.group === null)).toBe(true);
    expect(chapterGroups(points, plain, {})).toEqual([]);
  });

  it('ranks groups and puts each chapter in its place', () => {
    const podcasts = Object.fromEntries(slugs.map((s) => [s, { ...stats(), durationSeconds: 1800 }]));
    const points = chapterPoints(books, slugs);
    const r = Object.fromEntries(groupRankings(chapterGroups(points, books, podcasts)).map((x) => [x.id, x.entries]));
    expect(r.longestAvg.map((e) => e.row.title)).toEqual(['Jaime', 'Arya']);
    expect(r.mostPace[0].row.title).toBe('Arya'); // 90 min for 12,000 words against 15,000
    expect(r.mostChapters).toHaveLength(2);
    const places = groupPlaces(points);
    expect(places.get('b4/c3')).toMatchObject({ group: 'Jaime', n: 2, count: 3 });
    expect(places.get('b4/c3')?.vsAverage).toBeCloseTo(-0.2);
    expect(places.get('b5/c3')?.n).toBe(3);
    expect(places.has('b4/c0')).toBe(false);
  });
});
