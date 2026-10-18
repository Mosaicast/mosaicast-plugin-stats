// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import type { Design } from './design';

/** Site doc with the export default, written by podcasters from the export dialog. */
export const PRESET_KEY = 'export';

/** Logos a podcaster may upload: what the host stores and a canvas draws without tainting. */
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The site's export default. `design` is sanitized on read (`sanitizeDesign`); `logo` is a blob ref, never a
 * URL. Anything here may name nothing private: it sits behind a podcaster read floor anyway.
 */
export interface ExportPreset {
  design?: Partial<Design> | null;
  format?: string | null;
  fileType?: string | null;
  logo?: { ref: string; mime: string } | null;
  updatedAt?: string | null;
}

export async function loadPreset(ctx: PluginContext): Promise<ExportPreset | null> {
  try {
    return (await ctx.docs.get<ExportPreset>('site', PRESET_KEY)) ?? null;
  } catch (e) {
    ctx.log('warn', `stats: could not load the export default (${String(e)})`);
    return null;
  }
}

export function savePreset(ctx: PluginContext, preset: ExportPreset): Promise<unknown> {
  return ctx.docs.put('site', PRESET_KEY, { ...preset, updatedAt: new Date().toISOString() });
}

/** A file as a `data:` URL, so the SVG carries it inside (an image in an image loads nothing from outside). */
export async function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** The stored logo as a `data:` URL, or null when it's gone or unreadable. */
export async function loadLogo(ctx: PluginContext, ref: string): Promise<string | null> {
  if (!ctx.blobs) return null;
  try {
    const res = await fetch(ctx.blobs.urlFor(ref), { credentials: 'same-origin' });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = sniffImage(bytes);
    return type ? await dataUrl(new Blob([bytes], { type })) : null;
  } catch {
    return null;
  }
}

/** PNG, JPEG or WebP by their first bytes; null for anything else. The host's content type isn't relied on. */
export function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}
