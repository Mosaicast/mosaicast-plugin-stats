// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/**
 * Image sizes an export can have. Adding one is a line here plus its label in `locales/*.json`
 * (`export.format.<id>`); every template lays itself out in whatever box the frame leaves it.
 */
export interface ExportFormat {
  id: string;
  width: number;
  height: number;
  /**
   * Margins kept free of anything that matters, in pixels: where an app draws its own buttons over the
   * image (Instagram's story header and reply bar). Only the background reaches into them.
   */
  safe: { top: number; bottom: number; left: number; right: number };
}

const NONE = { top: 0, bottom: 0, left: 0, right: 0 };

export const FORMATS: ExportFormat[] = [
  // Instagram covers roughly the top 250 px (profile, progress) and the bottom 300 px (reply bar).
  { id: 'story', width: 1080, height: 1920, safe: { top: 250, bottom: 300, left: 0, right: 0 } },
  { id: 'portrait', width: 1080, height: 1350, safe: NONE },
  { id: 'square', width: 1080, height: 1080, safe: NONE },
  { id: 'wide', width: 1920, height: 1080, safe: NONE },
  { id: 'card', width: 1200, height: 675, safe: NONE },
];

export function formatById(id: string | null | undefined): ExportFormat {
  return FORMATS.find((f) => f.id === id) ?? FORMATS[0];
}

/** What the image is saved as. */
export interface FileType {
  id: 'png' | 'jpeg' | 'svg';
  mime: string;
  ext: string;
}

export const FILE_TYPES: FileType[] = [
  { id: 'png', mime: 'image/png', ext: 'png' },
  { id: 'jpeg', mime: 'image/jpeg', ext: 'jpg' },
  { id: 'svg', mime: 'image/svg+xml', ext: 'svg' },
];

export function fileTypeById(id: string | null | undefined): FileType {
  return FILE_TYPES.find((f) => f.id === id) ?? FILE_TYPES[0];
}
