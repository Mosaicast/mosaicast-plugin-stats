// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { LAUGHTER, type SpeakerTotal } from './aggregate';
import type { EpisodeStats } from './types';

/** One place in a ranking: an episode, a person, or a person in an episode. */
export interface Entry {
  value: number;
  /** The episode it happened in. */
  slug?: string;
  /** The person. */
  key?: string;
  /** Seconds into the episode, for a link that jumps there. */
  at?: number;
  /** A second number to show next to the value (words, a per-hour rate, …). */
  extra?: number;
  /** The two biggest speaking shares, for how even an episode was. */
  split?: [number, number];
}

/** A record and everything behind it, best first. The holder is `entries[0]`. */
export interface Ranking {
  id: RecordId;
  /** Episodes, people, or people in episodes; decides how an entry is drawn. */
  of: 'episode' | 'speaker' | 'turn';
  entries: Entry[];
}

export type RecordId =
  | 'longest' | 'shortest' | 'words' | 'pace' | 'laughs' | 'questions' | 'backAndForth' | 'crosstalk' | 'pause'
  | 'oneSided' | 'balanced' | 'fastest' | 'slowest' | 'asks' | 'monologue';

/** Turn lists get long (people × episodes); a ranking shows this many. */
const MAX_TURNS = 100;

/**
 * Every podcast record for a set of episodes, each with its full ranking. Records about episodes rank the
 * episodes in scope; records about people rank the people, summed over the scope (`speakers` from
 * `aggregate`). Rankings without at least two entries are left out: a record nobody competed for isn't one.
 */
export function podcastRankings(byEpisode: Record<string, EpisodeStats>, slugs: string[], speakers: SpeakerTotal[]): Ranking[] {
  const episodes = slugs.filter((s) => byEpisode[s]).map((slug) => ({ slug, s: byEpisode[slug] }));
  const rank = (id: RecordId, pick: (s: EpisodeStats, slug: string) => Entry | null, lowFirst = false): Ranking => ({
    id,
    of: 'episode',
    entries: sorted(episodes.map(({ slug, s }) => pick(s, slug)), lowFirst),
  });
  const byShare = (s: EpisodeStats) => [...s.speakers].sort((a, b) => b.share - a.share);
  const top = (s: EpisodeStats) => byShare(s)[0];
  const minutes = (seconds: number | null | undefined) => (seconds ? seconds / 60 : null);

  const out: Ranking[] = [
    rank('longest', (s, slug) => (s.durationSeconds != null ? { slug, value: s.durationSeconds } : null)),
    rank('shortest', (s, slug) => (s.durationSeconds != null ? { slug, value: s.durationSeconds } : null), true),
    rank('words', (s, slug) => (s.words != null ? { slug, value: s.words } : null)),
    rank('pace', (s, slug) => {
      const m = minutes(s.speechSeconds);
      return s.words != null && m ? { slug, value: s.words / m } : null;
    }),
    rank('laughs', (s, slug) => {
      const n = s.events.find((e) => e.label === LAUGHTER)?.count ?? 0;
      const m = minutes(s.durationSeconds);
      return { slug, value: n, extra: m ? n / (m / 60) : undefined };
    }),
    rank('questions', (s, slug) => (s.questions != null ? { slug, value: s.questions } : null)),
    rank('backAndForth', (s, slug) => {
      const m = minutes(s.speechSeconds);
      return s.turns != null && m ? { slug, value: s.turns / m, extra: s.turns } : null;
    }),
    rank('crosstalk', (s, slug) => (s.overlapSeconds != null ? { slug, value: s.overlapSeconds } : null)),
    rank('pause', (s, slug) => (s.longestSilence ? { slug, value: s.longestSilence.seconds, at: s.longestSilence.at } : null)),
    rank('oneSided', (s, slug) => (s.speakers.length > 1 ? { slug, value: top(s).share, key: top(s).key } : null)),
    // How far apart the two biggest shares are: 0 is a perfect split.
    rank('balanced', (s, slug) => {
      const [a, b] = byShare(s);
      return b ? { slug, value: a.share - b.share, split: [a.share, b.share] } : null;
    }, true),
  ];

  const people = (id: RecordId, pick: (p: SpeakerTotal) => Entry | null, lowFirst = false): Ranking => ({
    id,
    of: 'speaker',
    entries: sorted(speakers.map(pick), lowFirst),
  });
  out.push(
    people('fastest', (p) => (p.wpm != null ? { key: p.key, value: p.wpm, extra: p.words } : null)),
    people('slowest', (p) => (p.wpm != null ? { key: p.key, value: p.wpm, extra: p.words } : null), true),
    people('asks', (p) => (p.seconds > 0 ? { key: p.key, value: p.questions, extra: p.questions / (p.seconds / 3600) } : null)),
  );

  const turns: Entry[] = [];
  for (const { slug, s } of episodes) {
    for (const sp of s.speakers) {
      if (sp.longestTurn) turns.push({ slug, key: sp.key, value: sp.longestTurn.seconds, at: sp.longestTurn.at });
    }
  }
  out.push({ id: 'monologue', of: 'turn', entries: sorted(turns, false).slice(0, MAX_TURNS) });

  return out.filter((r) => r.entries.length > 1);
}

function sorted(list: (Entry | null)[], lowFirst: boolean): Entry[] {
  return list
    .filter((e): e is Entry => e != null && Number.isFinite(e.value))
    .sort((a, b) => (lowFirst ? a.value - b.value : b.value - a.value));
}
