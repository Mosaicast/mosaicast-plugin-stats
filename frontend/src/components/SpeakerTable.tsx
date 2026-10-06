// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import * as fmt from '../format';
import type { Basics } from './common';

export interface SpeakerRow {
  key: string;
  label?: string;
  name?: string | null;
  seconds: number;
  share: number;
  words: number | null;
  wpm: number | null;
  questions: number | null;
  turns?: number | null;
  episodes?: number;
  longest: { seconds: number; at: number; slug: string } | null;
}

/** The per-person numbers as a table. Also the text alternative for the share bar and charts. */
export function SpeakerTable({ rows, ctx, b, showEpisodes }: { rows: SpeakerRow[]; ctx: PluginContext; b: Basics; showEpisodes?: boolean }) {
  const has = (f: (r: SpeakerRow) => unknown) => rows.some((r) => f(r) != null);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{b.t('speakers.who')}</th>
            <th scope="col">{b.t('speakers.time')}</th>
            <th scope="col">{b.t('speakers.share')}</th>
            {has((r) => r.words) && <th scope="col">{b.t('speakers.words')}</th>}
            {has((r) => r.wpm) && <th scope="col">{b.t('speakers.pace')}</th>}
            {has((r) => r.questions) && <th scope="col">{b.t('speakers.questions')}</th>}
            {showEpisodes && <th scope="col">{b.t('speakers.episodes')}</th>}
            {has((r) => r.longest) && <th scope="col">{b.t('speakers.longest')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const person = b.who(r.key, r);
            return (
              <tr key={r.key}>
                <th scope="row" style={{ fontWeight: 400, color: 'var(--mc-text)', fontSize: '0.9rem' }}>
                  <span className="who">
                    <span className="swatch" style={{ background: person.color }} />
                    {person.name}
                  </span>
                </th>
                <td>{r.seconds >= 3600 ? fmt.span(r.seconds, b.locale) : fmt.clock(r.seconds)}</td>
                <td>{fmt.percent(r.share, b.locale)}</td>
                {has((x) => x.words) && <td>{r.words != null ? fmt.count(r.words, b.locale) : '–'}</td>}
                {has((x) => x.wpm) && <td>{r.wpm != null ? fmt.count(r.wpm, b.locale) : '–'}</td>}
                {has((x) => x.questions) && <td>{r.questions != null ? fmt.count(r.questions, b.locale) : '–'}</td>}
                {showEpisodes && <td>{fmt.count(r.episodes ?? 0, b.locale)}</td>}
                {has((x) => x.longest) && (
                  <td>
                    {r.longest ? (
                      <a href={ctx.links.episode(r.longest.slug, { t: Math.floor(r.longest.at) })} title={b.t('timeline.jump', { time: fmt.clock(r.longest.at) })}>
                        {fmt.clock(r.longest.seconds)}
                      </a>
                    ) : '–'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
