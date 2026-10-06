// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { LAUGHTER } from './aggregate';
import type { BookSummary, ChapterNumbers, EntityGroup, EpisodeStats } from './types';

/** One episode's book numbers next to how long the episode ran. */
export interface BookRow {
  slug: string;
  headings: string[];
  words: number;
  sentences: number | null;
  paragraphs: number;
  /** Podcast length (selected podcast bundles), if the episode has podcast stats. */
  seconds: number | null;
  /** Minutes of podcast per 1,000 words of book. */
  minutesPerKWords: number | null;
  /** Seconds of podcast per sentence of book. */
  secondsPerSentence: number | null;
  /** Words said in the episode for each word of the book. */
  spokenPerWord: number | null;
  /** Laughs in the episode, if it was analysed for them. */
  laughs: number | null;
  /** The names mentioned most in the episode (not the hosts), most first. */
  topNames: { text: string; count: number }[];
}

export interface BookAggregate {
  episodes: number;
  chapters: number;
  words: number;
  sentences: number | null;
  paragraphs: number;
  /** Over episodes that have both book and podcast stats. */
  minutesPerKWords: number | null;
  secondsPerSentence: number | null;
  characters: { text: string; count: number }[];
  newCharacters: { text: string; count: number; slug: string }[];
  rows: BookRow[];
}

/**
 * Sums book stats over a set of episodes and puts them next to the podcast time spent on them. The pace
 * numbers only count episodes that have both, so an episode without a recording analysis doesn't make the
 * book look faster.
 */
export function aggregateBooks(
  books: Record<string, BookSummary>,
  podcasts: Record<string, EpisodeStats>,
  slugs: string[],
): BookAggregate {
  const rows: BookRow[] = [];
  const characters = new Map<string, number>();
  const newcomers: BookAggregate['newCharacters'] = [];
  let paceSeconds = 0;
  let paceWords = 0;
  let paceSentenceSeconds = 0;
  let paceSentences = 0;
  let sentencesKnown = true;
  for (const slug of slugs) {
    const b = books[slug];
    if (!b) continue;
    const podcast = podcasts[slug];
    const seconds = podcast?.durationSeconds ?? null;
    const spoken = podcast?.words ?? null;
    rows.push({
      slug,
      headings: b.chapters.map((c) => c.heading),
      words: b.words,
      sentences: b.sentences ?? null,
      paragraphs: b.paragraphs,
      seconds,
      minutesPerKWords: seconds != null && b.words > 0 ? seconds / 60 / (b.words / 1000) : null,
      secondsPerSentence: seconds != null && b.sentences ? seconds / b.sentences : null,
      spokenPerWord: spoken != null && b.words > 0 ? spoken / b.words : null,
      laughs: podcast ? podcast.events.find((e) => e.label === LAUGHTER)?.count ?? 0 : null,
      topNames: podcast?.entities.find((g) => g.label === 'PERSON')?.top.slice(0, 5) ?? [],
    });
    if (b.sentences == null) sentencesKnown = false;
    if (seconds != null && b.words > 0) {
      paceSeconds += seconds;
      paceWords += b.words;
    }
    if (seconds != null && b.sentences) {
      paceSentenceSeconds += seconds;
      paceSentences += b.sentences;
    }
    b.characters.forEach((e) => characters.set(e.text, (characters.get(e.text) ?? 0) + e.count));
    b.newCharacters.forEach((e) => newcomers.push({ ...e, slug }));
  }
  return {
    episodes: rows.length,
    chapters: rows.reduce((a, r) => a + r.headings.length, 0),
    words: rows.reduce((a, r) => a + r.words, 0),
    sentences: sentencesKnown && rows.length ? rows.reduce((a, r) => a + (r.sentences ?? 0), 0) : null,
    paragraphs: rows.reduce((a, r) => a + r.paragraphs, 0),
    minutesPerKWords: paceWords > 0 ? paceSeconds / 60 / (paceWords / 1000) : null,
    secondsPerSentence: paceSentences > 0 ? paceSentenceSeconds / paceSentences : null,
    characters: [...characters.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 15),
    newCharacters: newcomers.sort((a, b) => b.count - a.count).slice(0, 15),
    rows,
  };
}

/** How a value compares to an average: +0.12 means 12 % above. Null when either is missing. */
export function versus(value: number | null | undefined, average: number | null | undefined): number | null {
  if (value == null || average == null || average === 0) return null;
  return value / average - 1;
}

/** The URL name of a book, as the backend makes it (`BookStats.slug`); for index entries written before it did. */
export function bookSlug(title: string | null | undefined): string {
  if (!title) return 'book';
  let plain = title
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (plain.length > 80) plain = plain.slice(0, 80).replace(/-+$/, '');
  return plain || 'book';
}

export function bookOf(s: BookSummary): string {
  return s.book || bookSlug(s.title);
}

/** One chapter in a scope, in book order, with the episode that covers it. */
export interface ChapterPoint extends ChapterNumbers {
  /** `<book>/<chapter id>`, unique across books. */
  key: string;
  book: string;
  title: string;
  /** Position in the book, from 0. */
  index: number;
  /** The episode this chapter is shown on. */
  slug: string;
  /** Words per sentence. */
  avgSentence: number | null;
  /** Share of sentences with direct speech. */
  dialogueShare: number | null;
}

/**
 * Every chapter the given episodes cover, books in the order the show reaches them and chapters in book order.
 * A chapter shown on two episodes counts once. With `only`, just that book's chapters.
 */
export function chapterPoints(books: Record<string, BookSummary>, slugs: string[], only?: string): ChapterPoint[] {
  const order: string[] = [];
  const byBook = new Map<string, ChapterPoint[]>();
  const seen = new Set<string>();
  // The host lists episodes newest first; the oldest one decides which book comes first.
  for (const slug of [...slugs].reverse()) {
    const s = books[slug];
    if (!s) continue;
    const book = bookOf(s);
    if (only && book !== only) continue;
    if (!byBook.has(book)) {
      byBook.set(book, []);
      order.push(book);
    }
    for (const c of s.chapters) {
      const key = `${book}/${c.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      byBook.get(book)!.push({
        ...c,
        key,
        book,
        title: s.title || book,
        index: c.index ?? (Number(/^c(\d+)$/.exec(c.id)?.[1]) || 0),
        slug,
        avgSentence: c.sentences ? c.words / c.sentences : null,
        dialogueShare: c.sentences && c.dialogue != null ? c.dialogue / c.sentences : null,
      });
    }
  }
  return order.flatMap((book) => byBook.get(book)!.sort((x, y) => x.index - y.index));
}

/** Sentence numbers over a set of chapters; null where some chapter doesn't know them. */
export interface SentenceTotals {
  chapters: number;
  words: number;
  sentences: number | null;
  avgSentence: number | null;
  longestSentence: number | null;
  dialogueShare: number | null;
  questions: number | null;
}

export function sentenceTotals(points: ChapterPoint[]): SentenceTotals {
  const known = points.length > 0 && points.every((p) => p.sentences != null);
  const speech = known && points.every((p) => p.dialogue != null);
  const sentences = known ? points.reduce((a, p) => a + (p.sentences ?? 0), 0) : null;
  const words = points.reduce((a, p) => a + p.words, 0);
  const longest = points.map((p) => p.longestSentence).filter((v): v is number => v != null);
  return {
    chapters: points.length,
    words,
    sentences,
    avgSentence: sentences ? words / sentences : null,
    longestSentence: longest.length ? Math.max(...longest) : null,
    dialogueShare: speech && sentences ? points.reduce((a, p) => a + (p.dialogue ?? 0), 0) / sentences : null,
    questions: speech ? points.reduce((a, p) => a + (p.questions ?? 0), 0) : null,
  };
}

/** A chapter and the number it's ranked by. */
export interface ChapterRecord {
  point: ChapterPoint;
  value: number;
}

export type ChapterRecordId =
  | 'longest' | 'shortest' | 'longestSentence' | 'wordiest' | 'mostDialogue' | 'leastDialogue' | 'mostQuestions';

/**
 * Chapter records, each with its full ranking (holder first). Ratios leave out tiny chapters: a
 * three-sentence epigraph with 100 % dialogue isn't a record.
 */
export function chapterRankings(points: ChapterPoint[]): { id: ChapterRecordId; entries: ChapterRecord[] }[] {
  const rank = (id: ChapterRecordId, value: (p: ChapterPoint) => number | null | undefined, lowFirst = false) => ({
    id,
    entries: points
      .map((point) => ({ point, value: value(point) }))
      .filter((e): e is ChapterRecord => e.value != null && Number.isFinite(e.value))
      .sort((a, b) => (lowFirst ? a.value - b.value : b.value - a.value)),
  });
  const solid = (p: ChapterPoint) => (p.sentences ?? 0) >= 20;
  return [
    rank('longest', (p) => p.words),
    rank('shortest', (p) => (p.words > 0 ? p.words : null), true),
    rank('longestSentence', (p) => p.longestSentence),
    rank('wordiest', (p) => (solid(p) ? p.avgSentence : null)),
    rank('mostDialogue', (p) => (solid(p) ? p.dialogueShare : null)),
    rank('leastDialogue', (p) => (solid(p) ? p.dialogueShare : null), true),
    rank('mostQuestions', (p) => p.questions),
  ].filter((r) => r.entries.length > 1);
}

/** One book (or season) as a row: its chapters' numbers and the podcast time spent on them. */
export interface GroupRow extends SentenceTotals {
  id: string;
  title: string;
  /** Minutes of podcast per 1,000 words, over episodes that have podcast stats. */
  minutesPerKWords: number | null;
}

/** Rows per book for the given chapters, in the order the books come. */
export function byBook(points: ChapterPoint[], books: Record<string, BookSummary>, podcasts: Record<string, EpisodeStats>): GroupRow[] {
  const order = [...new Set(points.map((p) => p.book))];
  return order.map((id) => {
    const mine = points.filter((p) => p.book === id);
    return { id, title: mine[0].title, ...sentenceTotals(mine), minutesPerKWords: pace(mine, books, podcasts) };
  });
}

/**
 * Podcast minutes per 1,000 words for a set of chapters. An episode's time belongs to all the chapters it
 * covers, so an episode counts only when every one of its chapters is in the set.
 */
export function pace(points: ChapterPoint[], books: Record<string, BookSummary>, podcasts: Record<string, EpisodeStats>): number | null {
  const keys = new Set(points.map((p) => p.key));
  let seconds = 0;
  let words = 0;
  for (const slug of new Set(points.map((p) => p.slug))) {
    const s = books[slug];
    const length = podcasts[slug]?.durationSeconds;
    if (!s || length == null) continue;
    const book = bookOf(s);
    if (!s.chapters.every((c) => keys.has(`${book}/${c.id}`))) continue;
    seconds += length;
    words += s.words;
  }
  return words > 0 ? seconds / 60 / (words / 1000) : null;
}

/** Names merged over a set of summaries, most mentioned first. */
export function mergeNames(lists: { text: string; count: number }[][], limit = 15): { text: string; count: number }[] {
  const m = new Map<string, number>();
  lists.forEach((l) => l.forEach((e) => m.set(e.text, (m.get(e.text) ?? 0) + e.count)));
  return [...m.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)).slice(0, limit);
}

/** Places, groups, … per label, merged over summaries or chapters. */
export function mergeEntities(groups: (EntityGroup[] | null | undefined)[], limit = 15): Record<string, { text: string; count: number }[]> {
  const byLabel = new Map<string, { text: string; count: number }[][]>();
  groups.forEach((list) => (list ?? []).forEach((g) => byLabel.set(g.label, [...(byLabel.get(g.label) ?? []), g.top])));
  return Object.fromEntries([...byLabel.entries()].map(([label, lists]) => [label, mergeNames(lists, limit)]));
}
