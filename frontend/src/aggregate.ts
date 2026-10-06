// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { EpisodeStats } from './types';

/** One person summed over a set of episodes. */
export interface SpeakerTotal {
  key: string;
  label: string;
  name?: string | null;
  seconds: number;
  share: number;
  words: number;
  /** Speaking seconds of the episodes that counted words, so pace isn't skewed by ones that didn't. */
  wordSeconds: number;
  wpm: number | null;
  questions: number;
  episodes: number;
  longestTurn: { seconds: number; at: number; slug: string } | null;
}

/** A record holder: which episode, and the number. */
export interface Record_ {
  slug: string;
  value: number;
  at?: number;
  key?: string;
}

/** Per-episode numbers for the trend charts, in the order the episodes were given. */
export interface EpisodePoint {
  slug: string;
  durationSeconds: number | null;
  shares: Record<string, number>;
  laughs: number;
}

export interface Aggregate {
  /** Episodes in scope that have stats. */
  analysed: number;
  /** Episodes in scope, with or without stats. */
  total: number;
  durationSeconds: number;
  speechSeconds: number;
  words: number;
  questions: number;
  speakers: SpeakerTotal[];
  events: Record<string, { count: number; seconds: number }>;
  entities: Record<string, { text: string; count: number; episodes: number }[]>;
  longestEpisode: Record_ | null;
  shortestEpisode: Record_ | null;
  longestSilence: Record_ | null;
  longestTurn: Record_ | null;
  mostLaughs: Record_ | null;
  points: EpisodePoint[];
}

/** The event label MAT uses for laughing; the views give it its own tile. */
export const LAUGHTER = 'laughter';

/**
 * Sums the stats of the given episodes. Works for any set (a feed, a season, the whole site), which is
 * why aggregation happens here rather than in stored per-season documents: the host decides which
 * episodes a scope has, and this only adds up what it is handed (ARCHITECTURE §7.7).
 */
export function aggregate(byEpisode: Record<string, EpisodeStats>, slugs: string[], topEntities = 15): Aggregate {
  const people = new Map<string, SpeakerTotal>();
  const events: Aggregate['events'] = {};
  const entities = new Map<string, Map<string, { spellings: Map<string, number>; count: number; episodes: number }>>();
  const points: EpisodePoint[] = [];
  let analysed = 0;
  let durationSeconds = 0;
  let speechSeconds = 0;
  let words = 0;
  let questions = 0;
  let longestEpisode: Record_ | null = null;
  let shortestEpisode: Record_ | null = null;
  let longestSilence: Record_ | null = null;
  let longestTurn: Record_ | null = null;
  let mostLaughs: Record_ | null = null;

  for (const slug of slugs) {
    const s = byEpisode[slug];
    if (!s) continue;
    analysed++;
    const d = s.durationSeconds ?? null;
    if (d != null) {
      durationSeconds += d;
      if (!longestEpisode || d > longestEpisode.value) longestEpisode = { slug, value: d };
      if (!shortestEpisode || d < shortestEpisode.value) shortestEpisode = { slug, value: d };
    }
    speechSeconds += s.speechSeconds ?? 0;
    words += s.words ?? 0;
    questions += s.questions ?? 0;
    if (s.longestSilence && (!longestSilence || s.longestSilence.seconds > longestSilence.value)) {
      longestSilence = { slug, value: s.longestSilence.seconds, at: s.longestSilence.at };
    }
    const shares: Record<string, number> = {};
    for (const sp of s.speakers) {
      shares[sp.key] = (shares[sp.key] ?? 0) + sp.share;
      const t = people.get(sp.key) ?? {
        key: sp.key, label: sp.label, name: sp.name, seconds: 0, share: 0, words: 0, wordSeconds: 0,
        wpm: null, questions: 0, episodes: 0, longestTurn: null,
      };
      t.seconds += sp.speakingSeconds;
      if (sp.words != null) {
        t.words += sp.words;
        t.wordSeconds += sp.speakingSeconds;
      }
      t.questions += sp.questions ?? 0;
      t.episodes++;
      if (sp.longestTurn && (!t.longestTurn || sp.longestTurn.seconds > t.longestTurn.seconds)) {
        t.longestTurn = { ...sp.longestTurn, slug };
      }
      if (sp.longestTurn && (!longestTurn || sp.longestTurn.seconds > longestTurn.value)) {
        longestTurn = { slug, value: sp.longestTurn.seconds, at: sp.longestTurn.at, key: sp.key };
      }
      people.set(sp.key, t);
    }
    let laughs = 0;
    for (const e of s.events) {
      const sum = (events[e.label] ??= { count: 0, seconds: 0 });
      sum.count += e.count;
      sum.seconds += e.seconds;
      if (e.label === LAUGHTER) laughs += e.count;
    }
    if (laughs > 0 && (!mostLaughs || laughs > mostLaughs.value)) mostLaughs = { slug, value: laughs };
    for (const group of s.entities) {
      const byText = entities.get(group.label) ?? new Map();
      for (const { text, count } of group.top) {
        const k = text.toLocaleLowerCase();
        const e = byText.get(k) ?? { spellings: new Map<string, number>(), count: 0, episodes: 0 };
        e.spellings.set(text, (e.spellings.get(text) ?? 0) + count);
        e.count += count;
        e.episodes++;
        byText.set(k, e);
      }
      entities.set(group.label, byText);
    }
    points.push({ slug, durationSeconds: d, shares, laughs });
  }

  const totalSeconds = [...people.values()].reduce((a, p) => a + p.seconds, 0);
  const speakers = [...people.values()]
    .map((p) => ({
      ...p,
      share: totalSeconds > 0 ? p.seconds / totalSeconds : 0,
      wpm: p.wordSeconds > 0 ? p.words / (p.wordSeconds / 60) : null,
    }))
    .sort((a, b) => b.seconds - a.seconds);

  const topByLabel: Aggregate['entities'] = {};
  for (const [label, byText] of entities) {
    topByLabel[label] = [...byText.values()]
      .map((e) => ({
        text: [...e.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
        count: e.count,
        episodes: e.episodes,
      }))
      .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
      .slice(0, topEntities);
  }

  return {
    analysed, total: slugs.length, durationSeconds, speechSeconds, words, questions, speakers, events,
    entities: topByLabel, longestEpisode, shortestEpisode, longestSilence, longestTurn, mostLaughs, points,
  };
}
