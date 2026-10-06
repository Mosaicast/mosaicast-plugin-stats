// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useState } from 'react';
import type { EpisodePoint } from '../aggregate';
import * as fmt from '../format';
import { shortLabel, tipBeside, titleOf, useWidth, type Basics } from './common';

const HEIGHT = 170;
const PAD = { top: 8, right: 4, bottom: 22, left: 52 };

interface TipState {
  chart: number;
  /** The hovered band's edges. */
  left: number;
  right: number;
  point: EpisodePoint;
}

/**
 * Two small charts over the episodes in scope, oldest first: how speaking time was split in each episode,
 * and how long each one ran. Separate charts on purpose: one is a share, the other a length, and they
 * don't belong on one axis.
 */
export function EpisodeCharts({
  points,
  people,
  labels,
  b,
}: {
  points: EpisodePoint[];
  people: string[];
  labels?: Record<string, string>;
  b: Basics;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  if (points.length < 2) return null;

  const plotW = Math.max(120, width - PAD.left - PAD.right);
  const band = plotW / points.length;
  const barW = Math.max(2, Math.min(24, band * 0.72));
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const labelEvery = Math.max(1, Math.ceil(44 / band));
  const maxLen = Math.max(...points.map((p) => p.durationSeconds ?? 0), 1);
  const lenTicks = ticksForMinutes(maxLen);
  const lenMax = lenTicks[lenTicks.length - 1] * 60;

  const show = (chart: number, point: EpisodePoint, i: number) =>
    setTip({ chart, left: PAD.left + band * i, right: PAD.left + band * (i + 1), point });

  const xLabels = points.map((p, i) =>
    i % labelEvery === 0 ? (
      <text key={p.slug} className="axis" x={PAD.left + band * i + band / 2} y={HEIGHT - 6} textAnchor="middle">
        {shortLabel(p.slug, labels)}
      </text>
    ) : null,
  );

  const hits = (chart: number) => points.map((p, i) => (
    <rect
      key={p.slug}
      className="hit"
      x={PAD.left + band * i}
      y={PAD.top}
      width={band}
      height={plotH}
      tabIndex={0}
      aria-label={titleOf(p.slug, labels)}
      onMouseEnter={() => show(chart, p, i)}
      onFocus={() => show(chart, p, i)}
      onMouseLeave={() => setTip(null)}
      onBlur={() => setTip(null)}
    />
  ));

  const tipBox = (chart: number) => tip?.chart === chart && (
    <div className="tip" style={tipBeside(tip.left, tip.right, width, PAD.top)}>
      <div className="t">{labels?.[tip.point.slug] ?? tip.point.slug}</div>
      {tip.point.durationSeconds != null && (
        <div className="row">
          <span>{b.t('tile.length')}</span>
          <span>{fmt.clock(tip.point.durationSeconds)}</span>
        </div>
      )}
      {people
        .filter((k) => tip.point.shares[k])
        .map((k) => {
          const person = b.who(k);
          return (
            <div className="row" key={k}>
              <span>
                <span className="swatch" style={{ background: person.color }} />
                {person.name}
              </span>
              <span>{fmt.percent(tip.point.shares[k], b.locale)}</span>
            </div>
          );
        })}
      {tip.point.laughs > 0 && (
        <div className="row">
          <span>{b.t('tile.laughs')}</span>
          <span>{fmt.count(tip.point.laughs, b.locale)}</span>
        </div>
      )}
    </div>
  );

  return (
    <div ref={ref}>
      <h3>{b.t('chart.shares')}</h3>
      <div className="chart">
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={b.t('chart.shares')}>
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH * (1 - v)} y2={PAD.top + plotH * (1 - v)} />
              <text className="axis" x={PAD.left - 6} y={PAD.top + plotH * (1 - v) + 4} textAnchor="end">
                {fmt.percent(v, b.locale)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const x = PAD.left + band * i + (band - barW) / 2;
            let y = PAD.top + plotH;
            const keys = people.filter((k) => p.shares[k] > 0);
            const gaps = Math.max(0, keys.length - 1) * 2;
            return (
              <g key={p.slug}>
                {keys.map((k, j) => {
                  const h = Math.max(0, p.shares[k] * (plotH - gaps));
                  y -= h + (j > 0 ? 2 : 0);
                  return <rect key={k} x={x} y={y} width={barW} height={h} fill={b.who(k).color} rx={j === keys.length - 1 ? 3 : 0} />;
                })}
              </g>
            );
          })}
          {xLabels}
          {hits(0)}
        </svg>
        {tipBox(0)}
      </div>

      <h3 style={{ marginTop: 18 }}>{b.t('chart.lengths')}</h3>
      <div className="chart">
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={b.t('chart.lengths')}>
          {lenTicks.map((m) => {
            const y = PAD.top + plotH * (1 - (m * 60) / lenMax);
            return (
              <g key={m}>
                <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} />
                <text className="axis" x={PAD.left - 6} y={y + 4} textAnchor="end">
                  {m === 0 ? '0' : fmt.span(m * 60, b.locale)}
                </text>
              </g>
            );
          })}
          {points.map((p, i) => {
            if (p.durationSeconds == null) return null;
            const h = (p.durationSeconds / lenMax) * plotH;
            const x = PAD.left + band * i + (band - barW) / 2;
            return <path key={p.slug} d={roundedTop(x, PAD.top + plotH - h, barW, h, Math.min(4, barW / 2))} fill="var(--mc-accent-2)" />;
          })}
          {xLabels}
          {hits(1)}
        </svg>
        {tipBox(1)}
      </div>
    </div>
  );
}

/** Nice minute ticks from 0 up to at least `seconds`. */
function ticksForMinutes(seconds: number): number[] {
  const minutes = seconds / 60;
  const step = minutes <= 40 ? 10 : minutes <= 90 ? 30 : minutes <= 240 ? 60 : 120;
  const top = Math.max(step, Math.ceil(minutes / step) * step);
  const out: number[] = [];
  for (let m = 0; m <= top; m += step) out.push(m);
  return out;
}

/** A bar with rounded top corners and a square base. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
