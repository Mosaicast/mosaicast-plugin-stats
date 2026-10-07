// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { isPluginApiError, type PluginContext } from '@mosaicast/plugin-sdk';
import type { Command, ImportRecord } from './types';

/**
 * The admin side talks to the backend through a queue in the doc store: plugins author no HTTP routes,
 * so the page writes `cmd:<id>` documents and the backend works them off on its next tick.
 */
export async function queue(ctx: PluginContext, cmd: Command): Promise<void> {
  await ctx.docs.put('site', `cmd:${uid()}`, cmd);
}

export function now(): string {
  return new Date().toISOString();
}

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Every document under a prefix, across pages. */
export async function listAll<T>(ctx: PluginContext, prefix: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 50; page++) {
    const res = await ctx.docs.list<T>('site', { prefix, page, size: 200 });
    out.push(...res.items.map((i) => i.value));
    if (page + 1 >= res.totalPages) break;
  }
  return out;
}

/**
 * An import record with every list and map present. Records written by an older version of the plugin may
 * lack fields that were added later; the page shouldn't have to care.
 */
export function normalizeImport(r: ImportRecord): ImportRecord {
  return {
    ...r,
    candidates: r.candidates ?? [],
    chapterCandidates: r.chapterCandidates ?? {},
    assignments: r.assignments ?? [],
    merge: r.merge ?? {},
  };
}

/** Commands still waiting for the backend. */
export async function pendingCount(ctx: PluginContext): Promise<number> {
  const res = await ctx.docs.list('site', { prefix: 'cmd:', size: 1 });
  return res.totalElements;
}

/** Needs attention first (failed, then unassigned), newest upload first within each group. */
export function sortImports(list: ImportRecord[]): ImportRecord[] {
  const rank = { failed: 0, ready: 1, assigned: 2 } as const;
  return [...list].sort(
    (a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''),
  );
}

/** The best candidate if it's convincing enough to assign without looking. */
export function confidentMatch(r: ImportRecord): string | null {
  const [first, second] = r.candidates;
  if (!first || first.score < 0.6) return null;
  if (second && first.score - second.score < 0.1) return null;
  return first.slug;
}

/**
 * Book chapters whose best episode is clear: chapter id → slug. An episode that already shows book stats
 * from another import (in this bundle) is skipped, so a second book with the same chapter names ("Arya I"
 * in volume 5 and volume 6) doesn't land on top of the first.
 */
export function bookSuggestions(r: ImportRecord, bundle: string, taken: Map<string, Set<string>>): Record<string, string> {
  const plan: Record<string, string> = {};
  for (const [chapter, list] of Object.entries(r.chapterCandidates ?? {})) {
    const free = list.filter((c) => !taken.get(c.slug)?.has(bundle));
    const [first, second] = free;
    if (!first || first.score < 0.6) continue;
    if (second && first.score - second.score < 0.1) continue;
    plan[chapter] = first.slug;
  }
  return plan;
}

/** For each book import, the episodes that already show book stats from *other* imports, per bundle. */
export function takenByOthers(imports: ImportRecord[], self: string): Map<string, Set<string>> {
  const taken = new Map<string, Set<string>>();
  for (const r of imports) {
    if (r.id === self || !r.book) continue;
    for (const a of r.assignments) {
      if (a.target.type !== 'episode') continue;
      const set = taken.get(a.target.id) ?? new Set<string>();
      set.add(a.bundle);
      taken.set(a.target.id, set);
    }
  }
  return taken;
}

export type UploadState =
  | { state: 'waiting' }
  | { state: 'uploading' }
  /** The site's upload limit was hit; the upload goes on by itself after `seconds`. */
  | { state: 'paused'; seconds: number }
  | { state: 'queued'; ref: string }
  | { state: 'failed'; reason: string; params?: Record<string, string | number> };

/**
 * Uploads one archive. That's all it takes: the backend reads every archive it doesn't know yet. Only a
 * reader picked by hand needs a command on top. Returns how it went, with a translation key for the
 * failure reason. (Browsers disagree on what to call a ZIP; the SDK and core 0.7.6 both settle that.)
 */
export async function uploadArchive(
  ctx: PluginContext,
  file: File,
  maxBytes: number | null,
  reader: string,
  /** Formats the size limit for the "too big" message (`i18n.bytes`). */
  bytes: (n: number) => string,
  onPause?: (seconds: number) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<UploadState> {
  if (!ctx.blobs) return { state: 'failed', reason: 'upload.noStorage' };
  if (!/\.zip$/i.test(file.name)) return { state: 'failed', reason: 'upload.notZip' };
  if (maxBytes != null && file.size > maxBytes) {
    return { state: 'failed', reason: 'upload.tooBig', params: { max: bytes(maxBytes) } };
  }
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x50 || head[1] !== 0x4b) return { state: 'failed', reason: 'upload.notZip' };
  for (let attempt = 0; ; attempt++) {
    try {
      const stored = await ctx.blobs.upload(file);
      if (reader) await queue(ctx, { type: 'ingest', at: now(), ref: stored.ref, fileName: file.name, reader });
      return { state: 'queued', ref: stored.ref };
    } catch (e) {
      // Core allows a few uploads per minute per client (10 by default). A big batch runs into that; wait
      // as long as it says and carry on, rather than failing the rest of the batch.
      if (isPluginApiError(e) && e.status === 429 && attempt < MAX_PAUSES) {
        const seconds = retryAfter(e.problem?.detail);
        onPause?.(seconds);
        await sleep(seconds * 1000);
        continue;
      }
      return uploadFailure(ctx, file, e);
    }
  }
}

/** How many times one upload waits for the rate limit before giving up. */
const MAX_PAUSES = 5;

/** Seconds to wait, from core's "Try again in N seconds."; a minute when it doesn't say. */
export function retryAfter(detail: string | undefined): number {
  const n = Number(/(\d+)\s*sec/i.exec(detail ?? '')?.[1]);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 120) + 1 : 60;
}

function uploadFailure(ctx: PluginContext, file: File, e: unknown): UploadState {
  if (isPluginApiError(e)) {
    if (e.status === 429) return { state: 'failed', reason: 'upload.rateLimited' };
    if (e.status === 413) return { state: 'failed', reason: 'upload.quota' };
    if (e.status === 415) return { state: 'failed', reason: 'upload.refused' };
    if (e.status === 403) return { state: 'failed', reason: 'upload.forbidden' };
  }
  ctx.log('warn', `stats: upload of ${file.name} failed (${String(e)})`);
  return { state: 'failed', reason: 'upload.failed' };
}
