// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import { useState } from 'react';
import * as fmt from '../format';
import type { EpisodeStats } from '../types';
import type { Basics } from './common';

/**
 * Who speaks when: one lane per speaker, one per kind of sound event. Clicking a lane opens the episode
 * at that moment (through the host's own `?t=` link, so the player starts there).
 */
export function Timeline({ ctx, slug, stats, b }: { ctx: PluginContext; slug: string; stats: EpisodeStats; b: Basics }) {
  const duration = stats.durationSeconds ?? lastEnd(stats);
  const [hover, setHover] = useState<{ lane: string; t: number } | null>(null);
  if (!stats.timeline || !duration) return null;
  const lanes = stats.speakers.filter((s) => (stats.timeline!.speakers[s.key]?.length ?? 0) > 0);
  const events = stats.events.filter((e) => e.at.length > 0);

  const at = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / Math.max(1, r.width)) * duration));
  };
  const open = (seconds: number) => {
    window.location.assign(ctx.links.episode(slug, { t: Math.floor(seconds) }));
  };
  const lane = (id: string, children: React.ReactNode) => (
    <div
      className="lane"
      onMouseMove={(e) => setHover({ lane: id, t: at(e.currentTarget, e.clientX) })}
      onMouseLeave={() => setHover(null)}
      onClick={(e) => open(at(e.currentTarget, e.clientX))}
      title={hover?.lane === id ? b.t('timeline.jump', { time: fmt.clock(hover.t) }) : undefined}
    >
      <svg viewBox={`0 0 ${duration} 1`} preserveAspectRatio="none" aria-hidden="true">
        {children}
      </svg>
    </div>
  );

  return (
    <div>
      <div className="lanes">
        {lanes.map((s) => {
          const person = b.who(s.key, s);
          const flat = stats.timeline!.speakers[s.key];
          const rects = [];
          for (let i = 0; i + 1 < flat.length; i += 2) {
            rects.push(<rect key={i} x={flat[i]} width={Math.max(flat[i + 1] - flat[i], duration / 2000)} y={0} height={1} fill={person.color} />);
          }
          return [
            <div key={`${s.key}-name`} className="small">{person.name}</div>,
            <div key={`${s.key}-lane`}>{lane(s.key, rects)}</div>,
          ];
        })}
        {events.map((e) => [
          <div key={`${e.label}-name`} className="small muted">{eventName(e.label, b)}</div>,
          <div key={`${e.label}-lane`}>
            {lane(
              `event:${e.label}`,
              e.at.map((start, i) => (
                <rect key={i} x={start} width={Math.max(duration / 400, 1)} y={0.2} height={0.6} fill="var(--mc-text-muted)" />
              )),
            )}
          </div>,
        ])}
      </div>
      <div className="lanes" aria-hidden="true">
        <span />
        <div className="scale">
          <span>0:00</span>
          <span>{hover ? b.t('timeline.jump', { time: fmt.clock(hover.t) }) : ''}</span>
          <span>{fmt.clock(duration)}</span>
        </div>
      </div>
      <p className="sr">{b.t('timeline.sr')}</p>
    </div>
  );
}

export function eventName(label: string, b: Basics): string {
  const key = `event.${label}`;
  const name = b.t(key);
  return name === key ? label.charAt(0).toUpperCase() + label.slice(1) : name;
}

function lastEnd(stats: EpisodeStats): number {
  let end = 0;
  for (const flat of Object.values(stats.timeline?.speakers ?? {})) {
    if (flat.length) end = Math.max(end, flat[flat.length - 1]);
  }
  return end;
}
