// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useState } from 'react';
import type { ChapterPoint } from '../book';
import * as fmt from '../format';
import { tipBeside, titleOf, useWidth, type Basics } from './common';

const HEIGHT = 160;
const PAD = { top: 18, right: 4, bottom: 22, left: 52 };

type Measure = 'words' | 'sentences';

/**
 * Three small bar charts over the chapters in scope, in book order: how long each chapter is (words or
 * sentences), how long its sentences are on average, and how much of it is dialogue. One measure per chart,
 * so nothing shares an axis it doesn't belong on. Where one book ends and the next starts, a line and the
 * book's title mark the change.
 */
export function ChapterCharts({ points, labels, b }: { points: ChapterPoint[]; labels?: Record<string, string>; b: Basics }) {
  const [measure, setMeasure] = useState<Measure>('words');
  const sentences = points.some((p) => p.sentences != null);
  const speech = points.some((p) => p.dialogueShare != null);
  if (points.length < 2) return null;
  const size = measure === 'sentences' && sentences ? 'sentences' : 'words';
  return (
    <div>
      <div className="chart-head">
        <h3>{b.t('bookChart.length')}</h3>
        {sentences && (
          <div className="chips" role="group" aria-label={b.t('bookChart.length')}>
            {(['words', 'sentences'] as const).map((m) => (
              <button key={m} type="button" className="chip" aria-pressed={size === m} onClick={() => setMeasure(m)}>
                {b.t(`book.${m}`)}
              </button>
            ))}
          </div>
        )}
      </div>
      <Bars
        points={points}
        value={(p) => (size === 'words' ? p.words : p.sentences ?? null)}
        axis={(v) => fmt.count(v, b.locale)}
        label={b.t('bookChart.length')}
        labels={labels}
        b={b}
      />
      {sentences && (
        <>
          <h3 style={{ marginTop: 18 }}>{b.t('bookChart.sentenceLength')}</h3>
          <Bars
            points={points}
            value={(p) => p.avgSentence}
            axis={(v) => fmt.decimal(v, b.locale, 0)}
            label={b.t('bookChart.sentenceLength')}
            labels={labels}
            b={b}
          />
        </>
      )}
      {speech && (
        <>
          <h3 style={{ marginTop: 18 }}>{b.t('bookChart.dialogue')}</h3>
          <Bars
            points={points}
            value={(p) => p.dialogueShare}
            axis={(v) => fmt.percent(v, b.locale)}
            top={1}
            label={b.t('bookChart.dialogue')}
            labels={labels}
            b={b}
          />
        </>
      )}
    </div>
  );
}

interface Tip {
  /** The hovered band's edges. */
  left: number;
  right: number;
  point: ChapterPoint;
}

function Bars({
  points,
  value,
  axis,
  top,
  label,
  labels,
  b,
}: {
  points: ChapterPoint[];
  value: (p: ChapterPoint) => number | null | undefined;
  axis: (v: number) => string;
  /** Fixed top of the scale (1 for shares); otherwise a nice number above the largest value. */
  top?: number;
  label: string;
  labels?: Record<string, string>;
  b: Basics;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const plotW = Math.max(120, width - PAD.left - PAD.right);
  const band = plotW / points.length;
  const barW = Math.max(2, Math.min(22, band * 0.72));
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const max = Math.max(...points.map((p) => value(p) ?? 0), 0);
  const ticks = top != null ? [0, top / 2, top] : niceTicks(max);
  const scaleTop = ticks[ticks.length - 1] || 1;
  const labelEvery = Math.max(1, Math.ceil(28 / band));
  const xOf = (i: number) => PAD.left + band * i;
  // Where a new book starts, for the divider and its title.
  const starts = points.map((p, i) => (i === 0 || points[i - 1].book !== p.book ? i : -1)).filter((i) => i >= 0);
  const several = starts.length > 1;

  const show = (point: ChapterPoint, i: number) => setTip({ left: xOf(i), right: xOf(i) + band, point });

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={label}>
        {ticks.map((v) => {
          const y = PAD.top + plotH * (1 - v / scaleTop);
          return (
            <g key={v}>
              <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} />
              <text className="axis" x={PAD.left - 6} y={y + 4} textAnchor="end">{axis(v)}</text>
            </g>
          );
        })}
        {several && starts.map((i) => (
          <g key={`book-${i}`}>
            {i > 0 && <line className="divider" x1={xOf(i)} x2={xOf(i)} y1={2} y2={PAD.top + plotH} />}
            <text className="axis" x={xOf(i) + 4} y={11}>{shorten(points[i].title, Math.max(8, Math.floor(((starts.find((s) => s > i) ?? points.length) - i) * band / 6.5)))}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const v = value(p);
          if (v == null || v <= 0) return null;
          const h = (Math.min(v, scaleTop) / scaleTop) * plotH;
          const x = xOf(i) + (band - barW) / 2;
          return <path key={p.key} d={roundedTop(x, PAD.top + plotH - h, barW, h, Math.min(4, barW / 2))} fill="var(--mc-accent-2)" />;
        })}
        {points.map((p, i) => (i % labelEvery === 0 || starts.includes(i) ? (
          <text key={p.key} className="axis" x={xOf(i) + band / 2} y={HEIGHT - 6} textAnchor="middle">{p.index + 1}</text>
        ) : null))}
        {points.map((p, i) => (
          <rect
            key={p.key}
            className="hit"
            x={xOf(i)}
            y={PAD.top}
            width={band}
            height={plotH}
            tabIndex={0}
            aria-label={p.heading}
            onMouseEnter={() => show(p, i)}
            onFocus={() => show(p, i)}
            onMouseLeave={() => setTip(null)}
            onBlur={() => setTip(null)}
          />
        ))}
      </svg>
      {tip && (
        <div className="tip" style={tipBeside(tip.left, tip.right, width, PAD.top)}>
          <div className="t">{tip.point.heading}</div>
          <div className="small muted" style={{ marginBottom: 4 }}>
            {several ? `${tip.point.title} · ` : ''}{titleOf(tip.point.slug, labels)}
          </div>
          <ChapterTipRows p={tip.point} b={b} />
        </div>
      )}
    </div>
  );
}

/** Every number of one chapter, for the tooltips. */
export function ChapterTipRows({ p, b }: { p: ChapterPoint; b: Basics }) {
  const row = (label: string, value: string) => (
    <div className="row" key={label}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <>
      {row(b.t('book.words'), fmt.count(p.words, b.locale))}
      {p.sentences != null && row(b.t('book.sentences'), fmt.count(p.sentences, b.locale))}
      {p.avgSentence != null && row(b.t('book.avgSentence'), fmt.decimal(p.avgSentence, b.locale))}
      {p.longestSentence != null && row(b.t('book.longestSentence'), b.t('book.wordCount', { n: fmt.count(p.longestSentence, b.locale) }))}
      {p.dialogueShare != null && row(b.t('book.dialogue'), fmt.percent(p.dialogueShare, b.locale))}
      {p.questions != null && row(b.t('book.questions'), fmt.count(p.questions, b.locale))}
    </>
  );
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** 0 and three or four round steps up to at least `max`. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 3;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.001; v += step) out.push(Number(v.toPrecision(12)));
  if (out[out.length - 1] < max) out.push(Number((out[out.length - 1] + step).toPrecision(12)));
  return out;
}

/** A bar with rounded top corners and a square base. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
