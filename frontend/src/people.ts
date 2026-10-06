// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { SpeakerSettings, StatsIndex } from './types';
import { seriesColor } from './palette';

/** How to show one speaker key: a name and a colour. */
export interface Person {
  key: string;
  name: string;
  color: string;
  slot: number;
}

export type People = (key: string, fallback?: { label?: string; name?: string | null }) => Person;

/**
 * Builds the speaker lookup the views share. Names come from the podcaster's settings, else from the
 * source (MAT knows "alex"), else the raw label. Colour slots come from the settings, else from a stable
 * order over every key the site has: the same person has the same colour on every page.
 */
export function people(settings: SpeakerSettings | null, index: StatsIndex | null, dark: boolean): People {
  const configured = settings?.people ?? {};
  const known = new Map<string, { label?: string; name?: string | null }>();
  const all = [...Object.values(index?.episodes ?? {}), ...Object.values(index?.scopes ?? {})].flatMap((b) => Object.values(b));
  for (const stats of all) {
    for (const s of stats.speakers) {
      if (!known.has(s.key)) known.set(s.key, { label: s.label, name: s.name });
    }
  }
  const taken = new Set<number>();
  const slots = new Map<string, number>();
  for (const [key, p] of Object.entries(configured)) {
    if (typeof p.color === 'number' && p.color >= 0) {
      slots.set(key, p.color);
      taken.add(p.color);
    }
  }
  let next = 0;
  const assign = (key: string) => {
    while (taken.has(next)) next++;
    slots.set(key, next);
    taken.add(next);
  };
  for (const key of [...Object.keys(configured), ...[...known.keys()].sort()]) {
    if (!slots.has(key)) assign(key);
  }
  return (key, fallback) => {
    if (!slots.has(key)) assign(key);
    const slot = slots.get(key)!;
    const from = known.get(key) ?? fallback ?? {};
    const name = configured[key]?.name?.trim() || prettify(from.name || from.label || key);
    return { key, name, color: seriesColor(slot, dark), slot };
  };
}

/** `alex` → `Alex`; labels like `sprecher_0` or `SPEAKER_00` stay as they are. */
export function prettify(label: string): string {
  if (/^[a-zäöüß]+$/.test(label)) return label.charAt(0).toUpperCase() + label.slice(1);
  return label;
}
