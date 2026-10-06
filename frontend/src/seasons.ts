// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import { useEffect, useMemo, useState } from 'react';

/** Episode slug → season number, for the episodes the host has told us about. */
export type SeasonLookup = (slug: string) => number | null;

/**
 * The season from a host label ("S05E22 · Title", or "S05 · Title" for an episode without a number).
 * Only a fallback for hosts older than core 0.7.6, whose snapshots don't carry the season yet.
 */
export function seasonFromLabel(slug: string, labels?: Record<string, string>): number | null {
  const m = /^S(\d{1,4})(?:E\d+)?\s·/.exec(labels?.[slug] ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * Seasons for a list of episodes, from their display snapshots (`DisplaySnapshot.season`, SDK 0.17). The
 * client splits a long list into batches itself (SDK 0.19). Until the answer is in, and for anything the
 * snapshot doesn't say, the host label is used.
 */
export function useSeasons(ctx: PluginContext, slugs: string[]): SeasonLookup {
  const [known, setKnown] = useState<Record<string, number | null>>({});
  useEffect(() => {
    let live = true;
    if (slugs.length === 0) return;
    ctx.feeds
      .displayMany(slugs)
      .then((answer) => {
        if (!live) return;
        const next: Record<string, number | null> = {};
        for (const [slug, snap] of Object.entries(answer)) {
          if (typeof snap.season === 'number') next[slug] = snap.season;
          else if (snap.feed !== undefined) next[slug] = null; // the host saying "no season"
        }
        setKnown(next);
      })
      .catch((e: unknown) => ctx.log('warn', `stats: could not read episode seasons (${String(e)})`));
    return () => {
      live = false;
    };
  }, [ctx.feeds, slugs]);
  const labels = ctx.episodeLabels;
  return useMemo(
    () => (slug: string) => (slug in known ? known[slug] : seasonFromLabel(slug, labels)),
    [known, labels],
  );
}

/** Groups episode slugs by season, keeping the given order inside each group. Seasons sort newest first. */
export function bySeason(slugs: string[], seasonOf: SeasonLookup): Map<number | null, string[]> {
  const groups = new Map<number | null, string[]>();
  for (const slug of slugs) {
    const s = seasonOf(slug);
    const list = groups.get(s) ?? [];
    list.push(slug);
    groups.set(s, list);
  }
  return new Map([...groups.entries()].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b - a)));
}
