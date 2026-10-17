// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { ThemeTokens } from '@mosaicast/plugin-sdk';

/**
 * How an exported image looks. Everything a podcaster can change in the export dialog, and what the site's
 * saved default (`export` doc) holds. Colours are `#rrggbb` so they work in `<input type="color">` and in an
 * SVG that is drawn without the page's CSS.
 */
export interface Design {
  /** Page colour behind everything; with a gradient, where it starts. */
  bg: string;
  /** Where a gradient ends, and the glow's colour. */
  bg2: string;
  background: Background;
  /** Gradient direction in degrees, 0 = top to bottom. */
  angle: number;
  /** Cards behind the content. */
  surface: string;
  text: string;
  muted: string;
  /** Fills: bars, highlights, badges. */
  accent: string;
  /** Text on top of the accent. */
  accentContrast: string;
  /** Content on cards, or straight on the background. */
  cards: boolean;
  font: FontId;
  /** Text size, 1 = normal. */
  scale: number;
  /** Corner radius of cards and bars, in pixels at 1080 px. */
  radius: number;
  density: Density;
  /** Speaker colours as on the site, or shades of the accent. */
  series: SeriesMode;
  /** Name shown at the top; the site's host name until someone types one. */
  brand: string;
  showBrand: boolean;
  showLogo: boolean;
  showLink: boolean;
  showQr: boolean;
}

export type Background = 'solid' | 'gradient' | 'glow' | 'dots' | 'grid';
export type FontId = 'sans' | 'serif' | 'rounded' | 'condensed' | 'mono';
export type Density = 'compact' | 'normal' | 'airy';
export type SeriesMode = 'speakers' | 'accent';

export const BACKGROUNDS: Background[] = ['solid', 'gradient', 'glow', 'dots', 'grid'];
export const DENSITIES: Density[] = ['compact', 'normal', 'airy'];
export const SERIES_MODES: SeriesMode[] = ['speakers', 'accent'];

/**
 * Font stacks. Only fonts installed on the device work: an SVG drawn into an image can't load web fonts, so
 * these name common system fonts and end in a generic family.
 */
export const FONTS: Record<FontId, string> = {
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, Cambria, 'Times New Roman', Times, serif",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', 'Nunito', 'Varela Round', system-ui, sans-serif",
  condensed: "'Roboto Condensed', 'Arial Narrow', 'Helvetica Neue Condensed', 'Liberation Sans Narrow', sans-serif-condensed, sans-serif",
  mono: "ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', Menlo, Consolas, monospace",
};
export const FONT_IDS = Object.keys(FONTS) as FontId[];

/** Padding around the content, as a share of the image's shorter side. */
export const PADDING: Record<Density, number> = { compact: 0.045, normal: 0.065, airy: 0.09 };

/** Colour presets: the page as it looks now, plain light and dark, and one filled with the accent. */
export type PresetId = 'page' | 'light' | 'dark' | 'accent';
export const PRESET_IDS: PresetId[] = ['page', 'light', 'dark', 'accent'];

type Colors = Pick<Design, 'bg' | 'bg2' | 'surface' | 'text' | 'muted' | 'accent' | 'accentContrast'>;

/** The colours of a preset, given the site's theme. */
export function presetColors(id: PresetId, theme: ThemeTokens | undefined): Colors {
  const page = themeColors(theme);
  switch (id) {
    case 'light':
      return { bg: '#f7f5f0', bg2: mix('#f7f5f0', page.accent, 0.22), surface: '#ffffff', text: '#1b1a17', muted: '#5f5c55', accent: page.accent, accentContrast: page.accentContrast };
    case 'dark':
      return { bg: '#14161b', bg2: mix('#14161b', page.accent, 0.35), surface: '#1f232b', text: '#f3f1ec', muted: '#a7a39a', accent: page.accent, accentContrast: page.accentContrast };
    case 'accent': {
      // The accent is the admin's unchecked seed: nudge it darker or lighter until the text reads on it.
      const text = contrast('#ffffff', page.accent) >= contrast('#111111', page.accent) ? '#ffffff' : '#111111';
      let bg = page.accent;
      for (let i = 0; i < 12 && contrast(text, bg) < 4.5; i++) bg = mix(bg, text === '#ffffff' ? '#000000' : '#ffffff', 0.08);
      const dark = text === '#ffffff';
      return {
        bg,
        bg2: mix(bg, dark ? '#000000' : '#ffffff', 0.35),
        surface: mix(bg, dark ? '#ffffff' : '#000000', 0.1),
        text,
        muted: mix(text, bg, 0.3),
        accent: text,
        accentContrast: bg,
      };
    }
    default:
      return page;
  }
}

function themeColors(theme: ThemeTokens | undefined): Colors {
  const bg = toHex(theme?.bg, '#ffffff');
  const accent = toHex(theme?.accent, '#2a78d6');
  return {
    bg,
    bg2: toHex(theme?.accent2, mix(bg, accent, 0.25)),
    surface: toHex(theme?.surface, bg),
    text: toHex(theme?.text, '#111111'),
    muted: toHex(theme?.textMuted, '#666666'),
    accent,
    accentContrast: toHex(theme?.accentContrast, isDark(accent) ? '#ffffff' : '#111111'),
  };
}

/** The design an export starts from when the site has no saved default: the page's own look. */
export function pageDesign(theme: ThemeTokens | undefined, brand: string): Design {
  return {
    ...presetColors('page', theme),
    background: 'gradient',
    angle: 160,
    cards: true,
    font: 'sans',
    scale: 1,
    radius: 24,
    density: 'normal',
    series: 'speakers',
    brand,
    showBrand: true,
    showLogo: true,
    showLink: true,
    showQr: true,
  };
}

const COLOR_KEYS = ['bg', 'bg2', 'surface', 'text', 'muted', 'accent', 'accentContrast'] as const;
const FLAGS = ['cards', 'showBrand', 'showLogo', 'showLink', 'showQr'] as const;

/**
 * A design from stored or typed input: whatever is valid in `raw` over `base`. The saved default is
 * written by any podcaster through the generic doc store, so nothing in it is trusted as-is.
 */
export function sanitizeDesign(raw: unknown, base: Design): Design {
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const out: Design = { ...base };
  for (const k of COLOR_KEYS) if (typeof r[k] === 'string' && HEX.test(r[k] as string)) out[k] = (r[k] as string).toLowerCase();
  for (const k of FLAGS) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  if (BACKGROUNDS.includes(r.background as Background)) out.background = r.background as Background;
  if (FONT_IDS.includes(r.font as FontId)) out.font = r.font as FontId;
  if (DENSITIES.includes(r.density as Density)) out.density = r.density as Density;
  if (SERIES_MODES.includes(r.series as SeriesMode)) out.series = r.series as SeriesMode;
  out.angle = num(r.angle, 0, 360, base.angle);
  out.scale = num(r.scale, 0.75, 1.35, base.scale);
  out.radius = num(r.radius, 0, 60, base.radius);
  if (typeof r.brand === 'string') out.brand = r.brand.slice(0, 80);
  return out;
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** `#rgb`, `#rrggbb`, `#rrggbbaa` or `rgb()/rgba()` as `#rrggbb`; anything else gives `fallback`. */
export function toHex(color: string | null | undefined, fallback: string): string {
  const c = color?.trim().toLowerCase() ?? '';
  if (HEX.test(c)) return c;
  if (/^#[0-9a-f]{8}$/.test(c)) return c.slice(0, 7);
  if (/^#[0-9a-f]{3,4}$/.test(c)) return `#${[...c.slice(1, 4)].map((x) => x + x).join('')}`;
  const m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(c);
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('')}`;
  return fallback;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(toHex(hex, '#000000').slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `a` moved towards `b` by `t` (0…1). */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Relative luminance (WCAG). */
export function luminance(hex: string): number {
  const ch = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function isDark(hex: string): boolean {
  return luminance(hex) < 0.25;
}

/** WCAG contrast ratio of two colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
