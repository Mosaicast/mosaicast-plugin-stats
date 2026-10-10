// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import type { BookSummary, EpisodeStats, StatsIndex } from '../types';

/** A small but complete set of stats for one episode. */
export function stats(over: Partial<EpisodeStats> & { alex?: number; max?: number; laughs?: number } = {}): EpisodeStats {
  const alex = over.alex ?? 600;
  const max = over.max ?? 400;
  const total = alex + max;
  return {
    model: 1,
    source: { reader: 'mat', format: '2.6.0', tool: 'MAT 0.3.1', inputName: 'ep.mp3' },
    language: 'de',
    durationSeconds: 1200,
    speechSeconds: total,
    overlapSeconds: 0,
    longestSilence: { seconds: 4.5, at: 300 },
    turns: 40,
    words: 3000,
    unattributedWords: 2,
    sentences: 200,
    questions: 20,
    speakers: [
      { key: 'alex-1', label: 'alex', name: 'alex', speakingSeconds: alex, share: alex / total, words: 1800, wpm: 180, turns: 20, longestTurn: { seconds: 61, at: 120 }, questions: 12 },
      { key: 'max-1', label: 'max', name: 'max', speakingSeconds: max, share: max / total, words: 1200, wpm: 180, turns: 20, longestTurn: { seconds: 40, at: 500 }, questions: 8 },
    ],
    events: over.laughs ? [{ label: 'laughter', count: over.laughs, seconds: over.laughs * 5, at: [] }] : [],
    entities: [{ label: 'PERSON', top: [{ text: 'Jon', count: 5 }, { text: 'Arya', count: 2 }] }],
    timeline: { resolution: 0.1, speakers: { 'alex-1': [0, 600], 'max-1': [600, 1000] } },
    warnings: [],
    extra: {},
    ...over,
  };
}

/** An index with podcast stats in the default bundle, plus optional extra bundles and books. */
export function index(
  episodes: Record<string, EpisodeStats>,
  extra: { bundles?: Record<string, Record<string, EpisodeStats>>; books?: StatsIndex['books'] } = {},
): StatsIndex {
  const byBundle: StatsIndex['episodes'] = {};
  for (const [slug, s] of Object.entries(episodes)) byBundle[slug] = { podcast: s };
  for (const [slug, more] of Object.entries(extra.bundles ?? {})) byBundle[slug] = { ...byBundle[slug], ...more };
  return { model: 1, updatedAt: '2026-10-02T10:00:00Z', episodes: byBundle, scopes: {}, books: extra.books ?? {}, bookScopes: {} };
}

/** A book summary covering the given chapters. */
export function bookSummary(
  chapters: { heading: string; words: number; sentences?: number; id?: string; index?: number; group?: string }[],
  characters: string[] = [],
): BookSummary {
  return {
    title: 'Book',
    chapters: chapters.map((c, i) => ({
      id: c.id ?? `c${i}`, index: c.index, heading: c.heading, group: c.group, words: c.words, sentences: c.sentences ?? null, paragraphs: 10,
    })),
    words: chapters.reduce((a, c) => a + c.words, 0),
    sentences: chapters.every((c) => c.sentences != null) ? chapters.reduce((a, c) => a + (c.sentences ?? 0), 0) : null,
    paragraphs: chapters.length * 10,
    characters: characters.map((text, i) => ({ text, count: 10 - i })),
    newCharacters: characters.slice(0, 1).map((text) => ({ text, count: 3 })),
  };
}

/** Renders into a detached container and gives back helpers. */
export async function mount(node: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root;
  await act(async () => {
    root = createRoot(host);
    root.render(node);
  });
  await flush();
  return {
    host,
    text: () => host.textContent ?? '',
    unmount: () => act(() => root.unmount()),
  };
}

export async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}
