// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { ReactNode } from 'react';
import type { Basics } from '../components/common';
import { FONTS, mix, type Design } from './design';
import { fit, fitSize, textWidth, wrap, type Font } from './measure';

/**
 * Building blocks for export templates: plain SVG with literal colours, so the same markup is the preview,
 * the SVG file and (drawn into a canvas) the PNG/JPEG. Each block fills the box it's given and scales with
 * the kit's units, so a template works in a story, a square post and a wide card alike.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What every block needs: the design, the sizes, and texts in the image's language. */
export interface Kit {
  d: Design;
  /** Pixels per layout unit: 1 for a 1080 px short side. */
  g: number;
  /** Pixels per text unit: `g` times the design's text size. */
  u: number;
  family: string;
  /** Translator, number locale and speaker names/colours for the image (its language, its background). */
  b: Basics;
  /** Colour of the `i`th series; with `key`, that speaker's colour unless the design asks for accent shades. */
  color: (i: number, key?: string) => string;
  /** Where content sits: the card colour when cards are on, else the background. */
  ground: string;
}

export function makeKit(d: Design, short: number, b: Basics): Kit {
  const g = short / 1080;
  const ground = d.cards ? d.surface : d.bg;
  const shades = [d.accent, mix(d.accent, ground, 0.35), mix(d.accent, d.text, 0.45), mix(d.accent, ground, 0.6), mix(d.text, ground, 0.35), mix(d.accent, d.text, 0.75)];
  return {
    d,
    g,
    u: g * d.scale,
    family: FONTS[d.font],
    b,
    ground,
    color: (i, key) => (d.series === 'speakers' && key ? b.who(key).color : shades[i % shades.length]),
  };
}

export const font = (k: Kit, size: number, weight = 400): Font => ({ size, weight, family: k.family });

export function inset(box: Box, by: number): Box {
  return { x: box.x + by, y: box.y + by, w: Math.max(0, box.w - 2 * by), h: Math.max(0, box.h - 2 * by) };
}

/** Splits a box into rows (`ratios` of the height) or columns, with `gap` between. */
export function split(box: Box, ratios: number[], gap: number, dir: 'rows' | 'cols'): Box[] {
  const total = ratios.reduce((a, r) => a + r, 0);
  const room = (dir === 'rows' ? box.h : box.w) - gap * (ratios.length - 1);
  let at = dir === 'rows' ? box.y : box.x;
  return ratios.map((r) => {
    const size = (room * r) / total;
    const out = dir === 'rows' ? { x: box.x, y: at, w: box.w, h: size } : { x: at, y: box.y, w: size, h: box.h };
    at += size + gap;
    return out;
  });
}

/** Whether a box is clearly wider than tall: templates put things side by side then. */
export const isWide = (box: Box) => box.w > box.h * 1.5;

export function Text({ k, x, y, size, weight = 400, fill, anchor = 'start', children, opacity }: {
  k: Kit;
  x: number;
  y: number;
  size: number;
  weight?: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  children: ReactNode;
  opacity?: number;
}) {
  return (
    <text x={x} y={y} fontFamily={k.family} fontSize={size} fontWeight={weight} fill={fill ?? k.d.text} textAnchor={anchor} opacity={opacity}>
      {children}
    </text>
  );
}

/** A card behind content when the design has cards on. */
export function Panel({ k, box }: { k: Kit; box: Box }) {
  if (!k.d.cards) return null;
  return <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={k.d.radius * k.g} fill={k.d.surface} />;
}

/** Padding inside a panel (none without cards: content then sits straight on the background). */
export const pad = (k: Kit) => (k.d.cards ? 36 * k.g : 0);

export interface Tile {
  label: string;
  value: string;
  sub?: string;
}

/**
 * Big numbers in a grid. Picks the column count that gives the biggest tiles for the box, caps the tile
 * height, and centres the grid vertically.
 */
export function StatGrid({ k, box, tiles, maxCols = 4 }: { k: Kit; box: Box; tiles: Tile[]; maxCols?: number }) {
  if (tiles.length === 0) return null;
  const gap = 22 * k.g;
  let best = { cols: 1, w: box.w, h: 0, score: -1 };
  for (let cols = 1; cols <= Math.min(maxCols, tiles.length); cols++) {
    const rows = Math.ceil(tiles.length / cols);
    const w = (box.w - gap * (cols - 1)) / cols;
    const h = Math.min((box.h - gap * (rows - 1)) / rows, 250 * k.u);
    const score = Math.min(w / 1.6, h);
    if (score > best.score) best = { cols, w, h, score };
  }
  const rows = Math.ceil(tiles.length / best.cols);
  const height = rows * best.h + (rows - 1) * gap;
  const top = box.y + Math.max(0, (box.h - height) / 2);
  const f = Math.min(1, best.h / (215 * k.u), best.w / (300 * k.u));
  const p0 = 26 * k.g * Math.max(f, 0.6);
  // Values share a size where they can, so a long one doesn't look less important; one very long value
  // shrinks on its own instead of taking every tile down with it.
  const fitted = tiles.map((t) => fitSize(t.value, best.w - 2 * p0, font(k, 82 * k.u * f, 700), 34 * k.u * f));
  const shared = Math.max(Math.min(...fitted), 82 * k.u * f * 0.62);
  return (
    <g>
      {tiles.map((t, i) => {
        const col = i % best.cols;
        const row = Math.floor(i / best.cols);
        // A last row with fewer tiles is centred.
        const inRow = row === rows - 1 ? tiles.length - row * best.cols : best.cols;
        const shift = ((best.cols - inRow) * (best.w + gap)) / 2;
        const x = box.x + shift + col * (best.w + gap);
        const y = top + row * (best.h + gap);
        const p = p0;
        const inner = best.w - 2 * p;
        // Labels stay readable on a phone even when tiles get short.
        const labelSize = Math.max(28 * k.u, 30 * k.u * f);
        const subSize = Math.max(22 * k.u, 26 * k.u * f);
        const valueSize = Math.min(shared, fitted[i]);
        const block = labelSize * 1.2 + valueSize * 1.05 + (t.sub ? subSize * 1.35 : 0);
        const y0 = y + Math.max(p, (best.h - block) / 2);
        return (
          <g key={i}>
            {k.d.cards ? (
              <rect x={x} y={y} width={best.w} height={best.h} rx={k.d.radius * k.g} fill={k.d.surface} />
            ) : (
              <rect x={x} y={y + p * 0.6} width={6 * k.g} height={best.h - p * 1.2} rx={3 * k.g} fill={k.d.accent} />
            )}
            <Text k={k} x={x + p} y={y0 + labelSize} size={labelSize} fill={k.d.muted}>{fit(t.label, inner, font(k, labelSize))}</Text>
            <Text k={k} x={x + p} y={y0 + labelSize * 1.2 + valueSize * 0.95} size={valueSize} weight={700}>{fit(t.value, inner, font(k, valueSize, 700))}</Text>
            {t.sub && (
              <Text k={k} x={x + p} y={y0 + labelSize * 1.2 + valueSize * 1.05 + subSize * 1.15} size={subSize} fill={k.d.muted}>
                {fit(t.sub, inner, font(k, subSize))}
              </Text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export interface Part {
  key: string;
  name: string;
  share: number;
  color: string;
  /** Next to the percentage, e.g. the speaking time. */
  detail?: string;
}

/** Names with colour dots and numbers, one per row (two columns when there's room). */
export function Legend({ k, box, rows, cols }: { k: Kit; box: Box; rows: { color: string; name: string; value: string; detail?: string }[]; cols?: number }) {
  const columns = cols ?? (box.w > 1100 * k.g && rows.length > 3 ? 2 : 1);
  const perCol = Math.ceil(rows.length / columns);
  const gap = 40 * k.g;
  const colW = (box.w - gap * (columns - 1)) / columns;
  const rowH = Math.min(box.h / Math.max(perCol, 1), 96 * k.u);
  const f = Math.min(1, rowH / (80 * k.u));
  const size = 38 * k.u * f;
  const top = box.y + Math.max(0, (box.h - rowH * perCol) / 2);
  return (
    <g>
      {rows.map((r, i) => {
        const x = box.x + Math.floor(i / perCol) * (colW + gap);
        const y = top + (i % perCol) * rowH + rowH / 2;
        const dot = 13 * k.u * f;
        const valueW = Math.max(90 * k.u * f, measure(k, r.value, size, 700));
        const detail = r.detail ? fit(r.detail, colW * 0.42, font(k, size * 0.72)) : '';
        const detailW = detail ? measure(k, detail, size * 0.72, 400) + 24 * k.g : 0;
        return (
          <g key={i}>
            <circle cx={x + dot} cy={y} r={dot} fill={r.color} />
            <Text k={k} x={x + dot * 2 + 16 * k.g} y={y + size * 0.35} size={size} weight={600}>
              {fit(r.name, colW - dot * 2 - 16 * k.g - valueW - detailW - 12 * k.g, font(k, size, 600))}
            </Text>
            {detail && (
              <Text k={k} x={x + colW - valueW - 12 * k.g} y={y + size * 0.3} size={size * 0.72} fill={k.d.muted} anchor="end">{detail}</Text>
            )}
            <Text k={k} x={x + colW} y={y + size * 0.35} size={size} weight={700} anchor="end">{r.value}</Text>
          </g>
        );
      })}
    </g>
  );
}

/** A 100 % bar, one segment per person, with the legend under it. */
export function ShareBar({ k, box, parts }: { k: Kit; box: Box; parts: Part[] }) {
  const shown = parts.filter((p) => p.share > 0);
  const barH = Math.min(70 * k.g, box.h * 0.22);
  const gap = 5 * k.g;
  const width = box.w - gap * (shown.length - 1);
  let x = box.x;
  const legendTop = box.y + barH + 30 * k.g;
  const clip = `share-${Math.round(box.x)}-${Math.round(box.y)}`;
  return (
    <g>
      <clipPath id={clip}>
        <rect x={box.x} y={box.y} width={box.w} height={barH} rx={Math.min(k.d.radius * k.g, barH / 2)} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        {shown.map((p) => {
          const w = Math.max(2 * k.g, width * p.share);
          const el = <rect key={p.key} x={x} y={box.y} width={w} height={barH} fill={p.color} />;
          x += w + gap;
          return el;
        })}
      </g>
      <Legend
        k={k}
        box={{ x: box.x, y: legendTop, w: box.w, h: box.y + box.h - legendTop }}
        rows={shown.map((p) => ({ color: p.color, name: p.name, value: fmtShare(p.share, k), detail: p.detail }))}
      />
    </g>
  );
}

export const fmtShare = (share: number, k: Kit) =>
  new Intl.NumberFormat(k.b.locale, { style: 'percent', maximumFractionDigits: 0 }).format(share);

/** A ring chart with an optional number in the middle. */
export function Donut({ k, cx, cy, r, parts, center }: { k: Kit; cx: number; cy: number; r: number; parts: Part[]; center?: { value: string; label: string } }) {
  const shown = parts.filter((p) => p.share > 0);
  const thick = r * 0.3;
  const mid = r - thick / 2;
  const gapAngle = shown.length > 1 ? 0.012 * Math.PI * 2 : 0;
  let a = -Math.PI / 2;
  const total = shown.reduce((s, p) => s + p.share, 0) || 1;
  const arcs = shown.map((p) => {
    const sweep = (p.share / total) * Math.PI * 2;
    const from = a + gapAngle / 2;
    const to = a + Math.max(sweep - gapAngle / 2, from - a + 0.001);
    a += sweep;
    if (shown.length === 1) return <circle key={p.key} cx={cx} cy={cy} r={mid} fill="none" stroke={p.color} strokeWidth={thick} />;
    const large = to - from > Math.PI ? 1 : 0;
    const d = `M ${cx + mid * Math.cos(from)} ${cy + mid * Math.sin(from)} A ${mid} ${mid} 0 ${large} 1 ${cx + mid * Math.cos(to)} ${cy + mid * Math.sin(to)}`;
    return <path key={p.key} d={d} fill="none" stroke={p.color} strokeWidth={thick} />;
  });
  const inner = (r - thick) * 1.6;
  const valueSize = center ? fitSize(center.value, inner, font(k, r * 0.34, 700), r * 0.14) : 0;
  const labelSize = Math.min(r * 0.13, 32 * k.u);
  return (
    <g>
      {arcs}
      {center && (
        <>
          <Text k={k} x={cx} y={cy + valueSize * 0.3} size={valueSize} weight={700} anchor="middle">{center.value}</Text>
          <Text k={k} x={cx} y={cy + valueSize * 0.3 + labelSize * 1.5} size={labelSize} fill={k.d.muted} anchor="middle">
            {fit(center.label, inner, font(k, labelSize))}
          </Text>
        </>
      )}
    </g>
  );
}

export interface BarRow {
  label: string;
  value: number;
  display: string;
  color?: string;
  sub?: string;
}

/** Horizontal bars with the label above each bar and the number at its end. */
export function BarList({ k, box, rows, max, slots }: { k: Kit; box: Box; rows: BarRow[]; max?: number; slots?: number }) {
  if (rows.length === 0) return null;
  if (twoColumns(k, box, rows.length, 110)) {
    const top = Math.max(max ?? 0, ...rows.map((r) => r.value));
    const half = Math.ceil(rows.length / 2);
    const [a, b] = split(box, [1, 1], 48 * k.g, 'cols');
    return <><BarList k={k} box={a} rows={rows.slice(0, half)} max={top} slots={half} /><BarList k={k} box={b} rows={rows.slice(half)} max={top} slots={half} /></>;
  }
  const top = Math.max(max ?? 0, ...rows.map((r) => r.value)) || 1;
  const n = Math.max(rows.length, slots ?? 0);
  const rowH = Math.min(box.h / n, 130 * k.u);
  const f = Math.min(1, rowH / (110 * k.u));
  const size = 34 * k.u * f;
  const barH = Math.max(8 * k.g, rowH * 0.3);
  const y0 = box.y + Math.max(0, (box.h - rowH * n) / 2);
  return (
    <g>
      {rows.map((r, i) => {
        const y = y0 + i * rowH;
        const color = r.color ?? k.d.accent;
        const valueW = measure(k, r.display, size, 700);
        const labelY = y + size * 1.05;
        const barY = labelY + size * 0.35;
        return (
          <g key={i}>
            <Text k={k} x={box.x} y={labelY} size={size} weight={600}>{fit(r.label, box.w - valueW - 20 * k.g, font(k, size, 600))}</Text>
            {r.sub && (
              <Text k={k} x={box.x + box.w - valueW - 20 * k.g} y={labelY} size={size * 0.7} fill={k.d.muted} anchor="end">
                {fit(r.sub, box.w * 0.35, font(k, size * 0.7))}
              </Text>
            )}
            <Text k={k} x={box.x + box.w} y={labelY} size={size} weight={700} anchor="end">{r.display}</Text>
            <rect x={box.x} y={barY} width={box.w} height={barH} rx={Math.min(k.d.radius * k.g, barH / 2)} fill={mix(k.d.muted, k.ground, 0.8)} />
            <rect x={box.x} y={barY} width={Math.max(barH, (box.w * r.value) / top)} height={barH} rx={Math.min(k.d.radius * k.g, barH / 2)} fill={color} />
          </g>
        );
      })}
    </g>
  );
}

export interface Column {
  label: string;
  /** Stacked from the bottom. */
  parts: { value: number; color: string }[];
}

/**
 * Vertical bars over a set of things in order (episodes, chapters, seasons), stacked when a column has more
 * than one part. `ticks` are drawn as grid lines with their labels.
 */
export function Columns({ k, box, columns, max, ticks, tickLabel }: {
  k: Kit;
  box: Box;
  columns: Column[];
  max?: number;
  ticks?: number[];
  tickLabel?: (v: number) => string;
}) {
  if (columns.length === 0) return null;
  const top = max ?? Math.max(...columns.map((c) => c.parts.reduce((a, p) => a + p.value, 0)), 1);
  const axisSize = 26 * k.u;
  const labelW = ticks && tickLabel ? Math.max(...ticks.map((t) => measure(k, tickLabel(t), axisSize, 400))) + 14 * k.g : 0;
  const plot = { x: box.x + labelW, y: box.y + axisSize, w: box.w - labelW, h: box.h - axisSize * 2.8 };
  const band = plot.w / columns.length;
  const barW = Math.max(2 * k.g, Math.min(band * 0.72, 90 * k.g));
  const r = Math.min(k.d.radius * k.g * 0.5, barW / 2);
  const every = Math.max(1, Math.ceil((Math.max(...columns.map((c) => Math.min(220 * k.g, measure(k, c.label, axisSize, 400)))) + 16 * k.g) / band));
  const y = (v: number) => plot.y + plot.h - (plot.h * v) / top;
  return (
    <g>
      {ticks?.map((t) => (
        <g key={t}>
          <line x1={plot.x} x2={plot.x + plot.w} y1={y(t)} y2={y(t)} stroke={mix(k.d.muted, k.ground, 0.65)} strokeWidth={1.5 * k.g} />
          {tickLabel && <Text k={k} x={plot.x - 12 * k.g} y={y(t) + axisSize * 0.35} size={axisSize} fill={k.d.muted} anchor="end">{tickLabel(t)}</Text>}
        </g>
      ))}
      {columns.map((c, i) => {
        const x = plot.x + band * i + (band - barW) / 2;
        let base = 0;
        const total = c.parts.reduce((a, p) => a + p.value, 0);
        return (
          <g key={i}>
            {c.parts.map((p, j) => {
              const y1 = y(base + p.value);
              const h = Math.max(0, y(base) - y1);
              base += p.value;
              // Only the top segment gets rounded corners.
              const last = base >= total - 1e-9;
              return last && r > 0 && h > r
                ? <path key={j} d={roundedTop(x, y1, barW, h, r)} fill={p.color} />
                : <rect key={j} x={x} y={y1} width={barW} height={h} fill={p.color} />;
            })}
            {i % every === 0 && (
              <Text k={k} x={x + barW / 2} y={plot.y + plot.h + axisSize * 1.4} size={axisSize} fill={k.d.muted} anchor="middle">
                {fit(c.label, band * every - 8 * k.g, font(k, axisSize))}
              </Text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M ${x} ${y + h} V ${y + r} Q ${x} ${y} ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + h} Z`;
}

/**
 * Whether a list reads better in two columns: rows would get cramped in one (below `comfortable` text units
 * each), and two columns are still wide enough for a name and a number.
 */
function twoColumns(k: Kit, box: Box, rows: number, comfortable: number): boolean {
  return rows > 3 && box.h / rows < comfortable * k.u && box.w / 2 > 520 * k.g;
}

/** Nice round grid values from 0 up to at least `max`. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) out.push(Number(v.toPrecision(6)));
  return out;
}

export interface RankRow {
  title: string;
  value: string;
  sub?: string;
  color?: string;
}

/** A numbered list, first place highlighted. */
export function RankList({ k, box, rows, from = 0, slots }: { k: Kit; box: Box; rows: RankRow[]; from?: number; slots?: number }) {
  if (twoColumns(k, box, rows.length, 120)) {
    const half = Math.ceil(rows.length / 2);
    const [a, b] = split(box, [1, 1], 48 * k.g, 'cols');
    return <><RankList k={k} box={a} rows={rows.slice(0, half)} from={from} slots={half} /><RankList k={k} box={b} rows={rows.slice(half)} from={from + half} slots={half} /></>;
  }
  const n = Math.max(rows.length, slots ?? 0, 1);
  const rowH = Math.min(box.h / n, 150 * k.u);
  const f = Math.min(1, rowH / (130 * k.u));
  const size = 38 * k.u * f;
  const subSize = 27 * k.u * f;
  const badge = rowH * 0.62;
  const y0 = box.y + Math.max(0, (box.h - rowH * n) / 2);
  return (
    <g>
      {rows.map((r, i) => {
        const y = y0 + i * rowH;
        const cy = y + rowH / 2;
        const textX = box.x + badge + 24 * k.g;
        const valueSize = i + from === 0 ? size * 1.15 : size;
        const valueW = measure(k, r.value, valueSize, 700) + 20 * k.g;
        const titleW = box.w - (textX - box.x) - valueW;
        return (
          <g key={i}>
            <circle cx={box.x + badge / 2} cy={cy} r={badge / 2} fill={i + from === 0 ? k.d.accent : mix(k.d.muted, k.ground, 0.75)} />
            <Text k={k} x={box.x + badge / 2} y={cy + size * 0.36} size={size} weight={700} anchor="middle" fill={i + from === 0 ? k.d.accentContrast : k.d.text}>{i + from + 1}</Text>
            {r.color && <rect x={textX} y={cy - (r.sub ? size * 0.95 : size * 0.45)} width={8 * k.g} height={size * 0.8} rx={3 * k.g} fill={r.color} />}
            <Text k={k} x={textX + (r.color ? 20 * k.g : 0)} y={r.sub ? cy - size * 0.15 : cy + size * 0.35} size={size} weight={600}>
              {fit(r.title, titleW - (r.color ? 20 * k.g : 0), font(k, size, 600))}
            </Text>
            {r.sub && <Text k={k} x={textX} y={cy + subSize * 1.2} size={subSize} fill={k.d.muted}>{fit(r.sub, titleW, font(k, subSize))}</Text>}
            <Text k={k} x={box.x + box.w} y={cy + valueSize * 0.35} size={valueSize} weight={700} anchor="end">{r.value}</Text>
          </g>
        );
      })}
    </g>
  );
}

/** Words as pills, bigger the more often they come up; stops when the box is full. */
export function Chips({ k, box, items }: { k: Kit; box: Box; items: { text: string; count: number }[] }) {
  if (items.length === 0) return null;
  const most = items[0]?.count || 1;
  const least = items[items.length - 1]?.count ?? 0;
  const gap = 16 * k.g;
  type Placed = { x: number; y: number; w: number; h: number; size: number; text: string; count: string; strong: boolean };
  /** Lays the chips out at a scale; how many fit and the height they take. */
  const layout = (scale: number) => {
    const lines: Placed[][] = [[]];
    let x = 0;
    let y = 0;
    let lineH = 0;
    let placed = 0;
    for (let i = 0; i < items.length; i++) {
      const e = items[i];
      const t = most === least ? 1 : (e.count - least) / (most - least);
      const size = (28 + 30 * t) * k.u * scale;
      const count = new Intl.NumberFormat(k.b.locale).format(e.count);
      const text = fit(e.text, box.w * 0.8, font(k, size, 600));
      const w = Math.min(box.w, size * 1.2 + measure(k, text, size, 600) + measure(k, count, size * 0.62, 400) + size * 0.5);
      const h = size * 1.75;
      if (x > 0 && x + w > box.w) {
        y += lineH + gap;
        x = 0;
        lineH = 0;
        lines.push([]);
      }
      if (y + h > box.h) {
        if (lines[lines.length - 1].length === 0) lines.pop();
        y -= gap;
        break;
      }
      lines[lines.length - 1].push({ x, y, w, h, size, text, count, strong: i < 3 });
      placed++;
      x += w + gap;
      lineH = Math.max(lineH, h);
    }
    return { lines, placed, y, lineH };
  };
  // As big as the box allows while every name fits; at the smallest scale, as many as fit.
  let best = layout(0.6);
  for (const scale of [1.8, 1.6, 1.4, 1.25, 1.1, 1, 0.9, 0.8, 0.7]) {
    const l = layout(scale);
    if (l.placed === items.length) {
      best = l;
      break;
    }
  }
  const { lines, y, lineH } = best;
  const used = y + lineH;
  const offY = box.y + Math.max(0, (box.h - used) / 2);
  return (
    <g>
      {lines.map((line, li) => {
        const width = line.length ? line[line.length - 1].x + line[line.length - 1].w : 0;
        const offX = box.x + (box.w - width) / 2;
        const rowH = Math.max(...line.map((p) => p.h), 0);
        return line.map((p, i) => {
          const px = offX + p.x;
          const py = offY + p.y + (rowH - p.h) / 2;
          const fill = p.strong ? k.d.accent : mix(k.d.muted, k.ground, 0.82);
          const ink = p.strong ? k.d.accentContrast : k.d.text;
          return (
            <g key={`${li}-${i}`}>
              <rect x={px} y={py} width={p.w} height={p.h} rx={p.h / 2} fill={fill} />
              <Text k={k} x={px + p.size * 0.6} y={py + p.h / 2 + p.size * 0.35} size={p.size} weight={600} fill={ink}>{p.text}</Text>
              <Text k={k} x={px + p.w - p.size * 0.6} y={py + p.h / 2 + p.size * 0.3} size={p.size * 0.62} fill={ink} anchor="end" opacity={0.75}>{p.count}</Text>
            </g>
          );
        });
      })}
    </g>
  );
}

const measure = (k: Kit, text: string, size: number, weight: number) => textWidth(text, font(k, size, weight));

/** Lines of wrapped text from `y` down; returns the elements and the height used. */
export function Paragraph({ k, x, y, w, text, size, weight = 400, fill, lines = 3, lineHeight = 1.18 }: {
  k: Kit;
  x: number;
  y: number;
  w: number;
  text: string;
  size: number;
  weight?: number;
  fill?: string;
  lines?: number;
  lineHeight?: number;
}) {
  const list = wrap(text, w, font(k, size, weight), lines);
  return (
    <g>
      {list.map((l, i) => (
        <Text key={i} k={k} x={x} y={y + size * 0.92 + i * size * lineHeight} size={size} weight={weight} fill={fill}>{l}</Text>
      ))}
    </g>
  );
}

/** Height `Paragraph` takes for the same input. */
export function paragraphHeight(k: Kit, text: string, w: number, size: number, weight = 400, lines = 3, lineHeight = 1.18): number {
  const n = text ? wrap(text, w, font(k, size, weight), lines).length : 0;
  return n === 0 ? 0 : size * 0.92 + (n - 1) * size * lineHeight + size * 0.28;
}
