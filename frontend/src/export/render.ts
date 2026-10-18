// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { encode } from 'uqr';
import type { FileType } from './formats';

/**
 * Turning the preview into a file. The preview *is* the image: an `<svg>` with literal colours and system
 * fonts, so serialising it gives the SVG export, and drawing that into a canvas gives PNG and JPEG. The SVG
 * goes into the `<img>` as a `data:` URL, which the host's CSP allows (`img-src 'self' data:`); a `blob:`
 * URL would be refused.
 */
export function serialize(svg: SVGSVGElement): string {
  const xml = new XMLSerializer().serializeToString(svg);
  return xml.startsWith('<?xml') ? xml : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

/** The SVG drawn at its full size into PNG or JPEG. */
export async function rasterize(svgText: string, width: number, height: number, type: FileType): Promise<Blob> {
  const img = new Image();
  img.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('the image could not be drawn'));
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('no canvas');
  c.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the image could not be encoded'))), type.mime, 0.92),
  );
}

/** The finished file for the preview's SVG. */
export async function exportFile(svg: SVGSVGElement, width: number, height: number, type: FileType, name: string): Promise<File> {
  const text = serialize(svg);
  const blob = type.id === 'svg' ? new Blob([text], { type: type.mime }) : await rasterize(text, width, height, type);
  return new File([blob], `${name}.${type.ext}`, { type: type.mime });
}

/** Saves a file through a temporary link inside `root` (the element's shadow root), not the host's DOM. */
export function download(file: File, root: Node): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.style.display = 'none';
  root.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Whether this browser can hand an image file to another app (the phone's share sheet). */
export function canShareFiles(sample?: File): boolean {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (!nav?.share || !nav.canShare) return false;
  try {
    return nav.canShare({ files: [sample ?? new File([''], 'x.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

/**
 * Opens the share sheet with the file. Only the file: several apps (Instagram among them) drop the file when
 * a text or URL comes along. Resolves false when the person closed the sheet.
 */
export async function share(file: File, title: string): Promise<boolean> {
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    throw e;
  }
}

/** A file name from parts: lower case, dashes, nothing a file system minds. */
export function fileName(...parts: (string | number | null | undefined)[]): string {
  return parts
    .filter((p) => p != null && p !== '')
    .map((p) => String(p).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-')
    .slice(0, 100) || 'stats';
}

/** QR modules for a URL, `true` = dark, without a quiet zone (the frame draws one). */
export function qrModules(text: string): boolean[][] {
  return encode(text, { ecc: 'M', border: 0 }).data;
}

/** A URL as people read it: no scheme, no trailing slash. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
