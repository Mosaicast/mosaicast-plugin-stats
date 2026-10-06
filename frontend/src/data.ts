// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import { useEffect, useState } from 'react';
import { bookOf } from './book';
import type { BookStats, BundleSettings, Chapter, EpisodeStats, SpeakerSettings, StatsIndex } from './types';

/**
 * The index and the speaker settings are read by every tile on a page (twenty feed cards at once), so a
 * read is shared for a few seconds. `ctx.docs` already joins identical reads in flight; this also covers
 * cards that mount a moment apart while the feed scrolls. Short on purpose: the backend rewrites the
 * index whenever stats change.
 */
const SHARE_MS = 10_000;
const shared = new Map<string, { at: number; value: Promise<unknown> }>();

function sharedRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const hit = shared.get(key);
  if (hit && Date.now() - hit.at < SHARE_MS) return hit.value as Promise<T>;
  const value = read();
  shared.set(key, { at: Date.now(), value });
  value.catch(() => shared.delete(key));
  return value;
}

/** Forget shared reads, e.g. after the manage page saved something. */
export function forgetShared(): void {
  shared.clear();
}

export function loadIndex(ctx: PluginContext): Promise<StatsIndex | null> {
  return sharedRead('index', () => ctx.docs.get<StatsIndex>('site', 'index'));
}

export function loadSpeakers(ctx: PluginContext): Promise<SpeakerSettings | null> {
  return sharedRead('speakers', () => ctx.docs.get<SpeakerSettings>('site', 'speakers'));
}

export function loadBundleSettings(ctx: PluginContext): Promise<BundleSettings | null> {
  return sharedRead('bundles', () => ctx.docs.get<BundleSettings>('site', 'bundles'));
}

/** Published stats of one bundle on an episode: podcast or book, by the bundle's kind. */
export function loadEpisodeStats<T = EpisodeStats>(ctx: PluginContext, slug: string, bundle: string): Promise<T | null> {
  return ctx.docs.get<T>({ type: 'episode', id: slug }, `stats:${bundle}`);
}

/**
 * The full chapters (with their names) of the selected book bundles on the given episodes, keyed like
 * `ChapterPoint.key`. The index only has numbers; names per chapter live in each episode's `stats:<bundle>`.
 * One `getMany` for the lot. Undefined while loading, empty when it failed.
 */
export function useChapterDetails(
  ctx: PluginContext,
  index: StatsIndex | null | undefined,
  selected: Set<string>,
  slugs: string[],
): Map<string, Chapter> | undefined {
  const wanted: { slug: string; bundle: string; book: string }[] = [];
  for (const slug of slugs) {
    for (const [bundle, summary] of Object.entries(index?.books?.[slug] ?? {})) {
      if (selected.has(bundle)) wanted.push({ slug, bundle, book: bookOf(summary) });
    }
  }
  const signature = wanted.map((w) => `${w.slug}:${w.bundle}`).join(',');
  const [state, setState] = useState<{ signature: string; chapters: Map<string, Chapter> } | null>(null);
  useEffect(() => {
    if (wanted.length === 0) {
      setState({ signature, chapters: new Map() });
      return;
    }
    let live = true;
    const ids = [...new Set(wanted.map((w) => w.slug))];
    const keys = [...new Set(wanted.map((w) => `stats:${w.bundle}`))];
    ctx.docs
      .getMany<BookStats>('episode', ids, keys)
      .then((found) => {
        const chapters = new Map<string, Chapter>();
        for (const w of wanted) {
          for (const c of found[w.slug]?.[`stats:${w.bundle}`]?.chapters ?? []) {
            const key = `${w.book}/${c.id}`;
            if (!chapters.has(key)) chapters.set(key, c);
          }
        }
        if (live) setState({ signature, chapters });
      })
      .catch(() => live && setState({ signature, chapters: new Map() }));
    return () => {
      live = false;
    };
    // `signature` stands for `wanted`.
  }, [ctx.docs, signature]);
  return state?.signature === signature ? state.chapters : undefined;
}

/** Whether the visitor can manage stats (matches the manifest's write floor). */
export function canManage(ctx: PluginContext): boolean {
  return ctx.user?.role === 'podcaster' || ctx.user?.role === 'admin';
}
