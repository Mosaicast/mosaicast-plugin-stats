// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/** Number and time formatting through `Intl`, in the visitor's locale. */

const cache = new Map<string, Intl.NumberFormat>();

function nf(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, opts);
    cache.set(key, f);
  }
  return f;
}

/** `1:41:35` or `41:35` — clock style, for one episode or a position in it. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** `86 hr 12 min` / `86 Std. 12 Min.` — for totals, where a clock would read oddly. */
export function span(seconds: number, locale: string): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hours = nf(locale, { style: 'unit', unit: 'hour', unitDisplay: 'short' });
  const minutes = nf(locale, { style: 'unit', unit: 'minute', unitDisplay: 'short' });
  if (h === 0) return minutes.format(m);
  return m === 0 ? hours.format(h) : `${hours.format(h)} ${minutes.format(m)}`;
}

/** Seconds with one decimal below a minute (`5.8 s`), else a clock. */
export function pause(seconds: number, locale: string): string {
  if (seconds < 60) {
    return nf(locale, { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 }).format(
      seconds,
    );
  }
  return clock(seconds);
}

export function percent(share: number, locale: string): string {
  return nf(locale, { style: 'percent', maximumFractionDigits: 0 }).format(share);
}

export function count(n: number, locale: string): string {
  return nf(locale, { maximumFractionDigits: 0 }).format(n);
}

/** `13.8K` / `13.817` style compact numbers for tiles. */
export function compact(n: number, locale: string): string {
  return n >= 10_000
    ? nf(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
    : count(n, locale);
}

export function decimal(n: number, locale: string, digits = 1): string {
  return nf(locale, { maximumFractionDigits: digits }).format(n);
}

