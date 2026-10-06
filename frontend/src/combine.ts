// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { mergeEntities, mergeNames } from './book';
import type { BookSummary, EpisodeStats, Gap, SpeakerStats, StatsIndex } from './types';

/**
 * Several podcast bundles of one episode as one set of stats, e.g. the normal and the spoiler recording.
 * Times, words and counts add up, shares are recomputed, records take the larger value. The timeline is
 * dropped: two recordings don't share a clock.
 */
export function combine(list: EpisodeStats[]): EpisodeStats | null {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const sum = (f: (s: EpisodeStats) => number | null | undefined) => {
    const values = list.map(f).filter((v): v is number => v != null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const max = (f: (s: EpisodeStats) => Gap | null | undefined) =>
    list.map(f).filter((g): g is Gap => !!g).sort((a, b) => b.seconds - a.seconds)[0] ?? null;

  const speakers = new Map<string, SpeakerStats>();
  for (const s of list) {
    for (const sp of s.speakers) {
      const have = speakers.get(sp.key);
      if (!have) {
        speakers.set(sp.key, { ...sp });
        continue;
      }
      const add = (a?: number | null, b?: number | null) => (a == null ? b : b == null ? a : a + b);
      have.speakingSeconds += sp.speakingSeconds;
      have.words = add(have.words, sp.words);
      have.turns = add(have.turns, sp.turns);
      have.questions = add(have.questions, sp.questions);
      if (sp.longestTurn && (!have.longestTurn || sp.longestTurn.seconds > have.longestTurn.seconds)) {
        have.longestTurn = sp.longestTurn;
      }
    }
  }
  const total = [...speakers.values()].reduce((a, s) => a + s.speakingSeconds, 0);
  const merged = [...speakers.values()]
    .map((s) => ({
      ...s,
      share: total > 0 ? s.speakingSeconds / total : 0,
      wpm: s.words != null && s.speakingSeconds > 0 ? s.words / (s.speakingSeconds / 60) : null,
    }))
    .sort((a, b) => b.speakingSeconds - a.speakingSeconds);

  const events = new Map<string, { label: string; count: number; seconds: number; at: number[] }>();
  for (const s of list) {
    for (const e of s.events) {
      const have = events.get(e.label) ?? { label: e.label, count: 0, seconds: 0, at: [] };
      have.count += e.count;
      have.seconds += e.seconds;
      events.set(e.label, have);
    }
  }
  const entities = new Map<string, Map<string, number>>();
  for (const s of list) {
    for (const g of s.entities) {
      const byText = entities.get(g.label) ?? new Map<string, number>();
      for (const e of g.top) byText.set(e.text, (byText.get(e.text) ?? 0) + e.count);
      entities.set(g.label, byText);
    }
  }

  return {
    model: list[0].model,
    source: list[0].source,
    language: list[0].language,
    durationSeconds: sum((s) => s.durationSeconds),
    speechSeconds: sum((s) => s.speechSeconds),
    overlapSeconds: sum((s) => s.overlapSeconds),
    longestSilence: max((s) => s.longestSilence),
    turns: sum((s) => s.turns),
    words: sum((s) => s.words),
    unattributedWords: sum((s) => s.unattributedWords),
    sentences: sum((s) => s.sentences),
    questions: sum((s) => s.questions),
    speakers: merged,
    events: [...events.values()],
    entities: [...entities.entries()].map(([label, byText]) => ({
      label,
      top: [...byText.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 15),
    })),
    timeline: null,
    warnings: [],
    extra: {},
  };
}

/** Per episode, the selected podcast bundles combined; episodes with none of them are left out. */
export function podcastByEpisode(index: StatsIndex | null | undefined, selected: Set<string>): Record<string, EpisodeStats> {
  const out: Record<string, EpisodeStats> = {};
  for (const [slug, byBundle] of Object.entries(index?.episodes ?? {})) {
    const s = combine(Object.entries(byBundle).filter(([b]) => selected.has(b)).map(([, v]) => v));
    if (s) out[slug] = s;
  }
  return out;
}

/** Per episode, the selected book bundles together (normally just one). */
export function booksByEpisode(index: StatsIndex | null | undefined, selected: Set<string>): Record<string, BookSummary> {
  const out: Record<string, BookSummary> = {};
  for (const [slug, byBundle] of Object.entries(index?.books ?? {})) {
    const list = Object.entries(byBundle).filter(([b]) => selected.has(b)).map(([, v]) => v);
    if (list.length === 1) out[slug] = list[0];
    else if (list.length > 1) out[slug] = joinBooks(list);
  }
  return out;
}

export function joinBooks(list: BookSummary[]): BookSummary {
  const merge = (pick: (b: BookSummary) => { text: string; count: number }[]) => mergeNames(list.map(pick));
  const total = (pick: (b: BookSummary) => number | null | undefined) =>
    list.every((b) => pick(b) != null) ? list.reduce((a, b) => a + (pick(b) ?? 0), 0) : null;
  const longest = list.map((b) => b.longestSentence).filter((v): v is number => v != null);
  const entities = mergeEntities(list.map((b) => b.entities));
  return {
    book: list[0].book,
    title: list[0].title,
    chapters: list.flatMap((b) => b.chapters),
    words: list.reduce((a, b) => a + b.words, 0),
    sentences: total((b) => b.sentences),
    paragraphs: list.reduce((a, b) => a + b.paragraphs, 0),
    longestSentence: longest.length ? Math.max(...longest) : null,
    dialogue: total((b) => b.dialogue),
    questions: total((b) => b.questions),
    characters: merge((b) => b.characters),
    newCharacters: merge((b) => b.newCharacters),
    entities: Object.entries(entities).map(([label, top]) => ({ label, top })),
  };
}
