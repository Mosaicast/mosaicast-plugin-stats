// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { Bundle, BundleSettings, Kind, StatsIndex } from './types';

export const KINDS: Kind[] = ['podcast', 'book'];
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * The site's bundles, as the backend reads them: the saved settings (invalid entries dropped), plus one
 * implicit bundle per kind nobody configured, whose id is the kind itself.
 */
export function resolveBundles(settings: BundleSettings | null): Bundle[] {
  const out: Bundle[] = [];
  for (const b of settings?.bundles ?? []) {
    if (b && ID.test(b.id) && KINDS.includes(b.kind) && !out.some((o) => o.id === b.id)) out.push(b);
  }
  for (const kind of KINDS) {
    if (!out.some((b) => b.kind === kind) && !out.some((b) => b.id === kind)) {
      out.push({ id: kind, kind, name: null, spoiler: false });
    }
  }
  return out;
}

/** The bundles that have data in the index for any of these episodes, in settings order. */
export function bundlesWithData(all: Bundle[], index: StatsIndex | null | undefined, slugs: string[]): Bundle[] {
  const present = new Set<string>();
  for (const slug of slugs) {
    for (const id of Object.keys(index?.episodes?.[slug] ?? {})) present.add(id);
    for (const id of Object.keys(index?.books?.[slug] ?? {})) present.add(id);
  }
  return all.filter((b) => present.has(b.id));
}

/** A bundle's name for visitors: the configured one, else a translated default per kind. */
export function bundleName(b: Bundle, t: (key: string) => string): string {
  return b.name?.trim() || t(`bundle.default.${b.kind}`);
}

/** A url- and key-safe id from a name, unique among the taken ones. */
export function bundleId(name: string, taken: string[]): string {
  const base = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'bundle';
  let id = /^[a-z0-9]/.test(base) ? base : `b-${base}`;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}
