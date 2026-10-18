// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/**
 * Text measuring for the export templates. SVG text doesn't wrap, so templates break lines and shorten
 * labels themselves, measured with a canvas in the same font the SVG names. Where there is no canvas
 * (tests), an estimate from the character count stands in.
 */

let canvas: CanvasRenderingContext2D | null | undefined;

function context(): CanvasRenderingContext2D | null {
  if (canvas === undefined) {
    try {
      // jsdom has no canvas and logs an error on every attempt.
      canvas = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)
        ? null
        : document.createElement('canvas').getContext('2d');
    } catch {
      canvas = null;
    }
  }
  return canvas;
}

export interface Font {
  size: number;
  weight?: number;
  family: string;
}

/** Width of one line of text in pixels. */
export function textWidth(text: string, font: Font): number {
  const c = context();
  if (c) {
    c.font = `${font.weight ?? 400} ${font.size}px ${font.family}`;
    return c.measureText(text).width;
  }
  return text.length * font.size * ((font.weight ?? 400) >= 600 ? 0.58 : 0.53);
}

/** The text shortened with an ellipsis so it fits `max` pixels. */
export function fit(text: string, max: number, font: Font): string {
  if (textWidth(text, font) <= max) return text;
  const chars = [...text];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(chars.slice(0, mid).join('').trimEnd() + '…', font) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '…' : chars.slice(0, lo).join('').trimEnd() + '…';
}

/** The biggest size from `font.size` down to `min` at which the text fits on one line. */
export function fitSize(text: string, max: number, font: Font, min: number): number {
  let size = font.size;
  const width = textWidth(text, font);
  if (width > max && width > 0) size = Math.max(min, Math.floor(font.size * (max / width)));
  return size;
}

/** Greedy line breaking into at most `lines` lines; the last one is shortened if text is left over. */
export function wrap(text: string, max: number, font: Font, lines = 3): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = '';
  let i = 0;
  for (; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (textWidth(next, font) <= max || !line) {
      line = next;
      continue;
    }
    out.push(line);
    line = words[i];
    if (out.length === lines - 1) {
      line = words.slice(i).join(' ');
      i = words.length;
      break;
    }
  }
  if (line) out.push(line);
  return out.slice(0, lines).map((l) => fit(l, max, font));
}
