// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/**
 * The documents the backend writes, mirrored from the Java model (`dev.mosaicast.plugin.stats.model` and
 * `ingest.Docs`). Everything optional on the Java side is optional here: a source that can't say something
 * leaves it out and the views skip it.
 */

export interface Gap {
  seconds: number;
  at: number;
}

export interface SpeakerStats {
  /** Stable identity across episodes; the name mapping is keyed by this. */
  key: string;
  /** The raw label in this result. */
  label: string;
  name?: string | null;
  speakingSeconds: number;
  share: number;
  words?: number | null;
  wpm?: number | null;
  turns?: number | null;
  longestTurn?: Gap | null;
  questions?: number | null;
}

export interface EventStats {
  label: string;
  count: number;
  seconds: number;
  at: number[];
}

export interface EntityGroup {
  label: string;
  top: { text: string; count: number }[];
}

export interface Source {
  reader: string;
  format?: string | null;
  tool?: string | null;
  createdAt?: string | null;
  inputName?: string | null;
  inputHash?: string | null;
}

export interface Warning {
  code: string;
  params: Record<string, string>;
}

export interface EpisodeStats {
  model: number;
  source?: Source | null;
  language?: string | null;
  durationSeconds?: number | null;
  speechSeconds?: number | null;
  overlapSeconds?: number | null;
  longestSilence?: Gap | null;
  turns?: number | null;
  words?: number | null;
  unattributedWords?: number | null;
  sentences?: number | null;
  questions?: number | null;
  speakers: SpeakerStats[];
  events: EventStats[];
  entities: EntityGroup[];
  /** Per speaker key a flat `[start, end, start, end, …]` list; absent in the index. */
  timeline?: { resolution: number; speakers: Record<string, number[]> } | null;
  warnings: Warning[];
  extra: Record<string, unknown>;
}

/** Stats kinds the readers produce. */
export type Kind = 'podcast' | 'book';

/** A chapter of a book: counts and names only. */
export interface Chapter {
  id: string;
  index: number;
  heading: string;
  words: number;
  sentences?: number | null;
  paragraphs: number;
  /** Words in the longest sentence. */
  longestSentence?: number | null;
  /** Sentences with direct speech. */
  dialogue?: number | null;
  questions?: number | null;
  characters: { text: string; count: number }[];
  newCharacters: { text: string; count: number }[];
  /** Places, groups, … (not people) by label. Missing in books read before model 2. */
  entities?: EntityGroup[] | null;
}

/** Book stats as published on an episode: the chapters it covers. */
export interface BookStats {
  model: number;
  source?: Source | null;
  title?: string | null;
  language?: string | null;
  chapters: Chapter[];
  warnings: Warning[];
}

/** A set of chapters in the site index: totals and per-chapter numbers, merged top names. */
export interface BookSummary {
  /** URL name of the book, the same for every part of it (`books/<book>`). */
  book?: string | null;
  title?: string | null;
  chapters: ChapterNumbers[];
  words: number;
  sentences?: number | null;
  paragraphs: number;
  longestSentence?: number | null;
  dialogue?: number | null;
  questions?: number | null;
  characters: { text: string; count: number }[];
  newCharacters: { text: string; count: number }[];
  entities?: EntityGroup[] | null;
}

/** One chapter's numbers in the index, without names. */
export interface ChapterNumbers {
  id: string;
  index?: number | null;
  heading: string;
  words: number;
  sentences?: number | null;
  paragraphs: number;
  longestSentence?: number | null;
  dialogue?: number | null;
  questions?: number | null;
}

/** Everything published, by target and bundle. */
export interface StatsIndex {
  model: number;
  updatedAt: string;
  /** Podcast stats: episode slug → bundle id → summary. */
  episodes: Record<string, Record<string, EpisodeStats>>;
  scopes: Record<string, Record<string, EpisodeStats>>;
  /** Book stats: episode slug → bundle id → chapters. */
  books: Record<string, Record<string, BookSummary>>;
  bookScopes: Record<string, Record<string, BookSummary>>;
}

/** A named slot for one kind of stats, set up on the manage page. */
export interface Bundle {
  id: string;
  kind: Kind;
  name?: string | null;
  spoiler?: boolean | null;
  /** A file name or title containing this suggests the bundle. */
  match?: string | null;
}

export interface BundleSettings {
  bundles: Bundle[];
}

/** One place an import is shown. */
export interface Assignment {
  target: Target;
  bundle: string;
  /** Books: chapter ids for this target; absent means all. */
  parts?: string[] | null;
  /** Published right now; false while the episode isn't released. */
  live?: boolean | null;
  /** The target doesn't exist (any more). */
  unavailable?: boolean | null;
}

export interface Target {
  type: 'episode' | 'season' | 'feed';
  id: string;
}

export interface Candidate {
  slug: string;
  title: string;
  score: number;
}

export interface ImportRecord {
  id: string;
  status: 'ready' | 'assigned' | 'failed';
  kind?: Kind | null;
  fileName: string;
  uploadedAt: string;
  processedAt: string;
  reader?: string | null;
  level?: 'episode' | 'season' | 'feed' | null;
  hint?: string | null;
  summary?: EpisodeStats | null;
  /** Books: headings and lengths. */
  book?: { title?: string | null; chapters: { id: string; heading: string; words: number }[] } | null;
  candidates: Candidate[];
  /** Books: per chapter id, matching episodes. */
  chapterCandidates?: Record<string, Candidate[]>;
  suggestedBundle?: string | null;
  assignments: Assignment[];
  merge: Record<string, string>;
  error?: { code: string; message: string } | null;
  /** Blob ref of the uploaded archive, kept so it can be read again. */
  archive?: string | null;
}

export interface ReaderInfo {
  id: string;
  name: string;
}

/** A queued instruction for the backend; see `Docs.Command` on the Java side. */
export type Command =
  | { type: 'ingest'; at: string; ref: string; fileName: string; reader?: string }
  | { type: 'assign'; at: string; importId: string; target: Target; bundle?: string; parts?: string[] | null;
      merge?: Record<string, string> }
  | { type: 'unassign'; at: string; importId: string; target?: Target }
  | { type: 'reread' | 'discard'; at: string; importId: string };

/** What a visitor picked: bundles (null means the defaults) and whether spoilers are shown. */
export interface ViewChoice {
  bundles: string[] | null;
  spoilers: boolean;
}

/** Display names and colours per speaker key, written by podcasters on the manage page. */
export interface SpeakerSettings {
  people: Record<string, { name?: string; color?: number; hidden?: boolean }>;
}
