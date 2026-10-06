// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import { useEffect, useState } from 'react';
import { SERIES_LIGHT } from '../palette';
import { prettify } from '../people';
import type { SpeakerSettings } from '../types';
import { Icon, type Basics } from './common';

/**
 * Names and colours per speaker key, for the whole site. Stored as one `speakers` document; a key with no
 * name falls back to whatever the source called the speaker.
 */
export function SpeakerEditor({
  ctx, b, settings, keys, onSaved,
}: {
  ctx: PluginContext;
  b: Basics;
  settings: SpeakerSettings | null;
  keys: Map<string, string>;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<SpeakerSettings['people']>(settings?.people ?? {});
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  useEffect(() => setDraft(settings?.people ?? {}), [settings]);
  if (keys.size === 0) return <p className="small muted">{b.t('people.none')}</p>;

  const set = (key: string, patch: { name?: string; color?: number }) => {
    setState('idle');
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  };
  const save = async () => {
    setState('saving');
    const people: SpeakerSettings['people'] = {};
    for (const [key, p] of Object.entries(draft)) {
      const name = p.name?.trim();
      if (name || typeof p.color === 'number') people[key] = { ...(name ? { name } : {}), ...(typeof p.color === 'number' ? { color: p.color } : {}) };
    }
    try {
      await ctx.docs.put('site', 'speakers', { people });
      setState('saved');
      onSaved();
    } catch (e) {
      ctx.log('warn', `stats: could not save speaker names (${String(e)})`);
      setState('failed');
    }
  };

  return (
    <div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{b.t('people.label')}</th>
              <th scope="col" style={{ textAlign: 'left' }}>{b.t('people.name')}</th>
              <th scope="col" style={{ textAlign: 'left' }}>{b.t('people.colour')}</th>
            </tr>
          </thead>
          <tbody>
            {[...keys.entries()].map(([key, label]) => {
              const person = b.who(key, { label });
              const chosen = draft[key]?.color ?? person.slot;
              return (
                <tr key={key}>
                  <td>
                    <span className="who">
                      <span className="swatch" style={{ background: SERIES_LIGHT[chosen] ?? person.color }} />
                      <span>{label}</span>
                    </span>
                    {key !== label && <div className="tiny muted">{key}</div>}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <input type="text" aria-label={b.t('people.nameFor', { label })} placeholder={prettify(label)} value={draft[key]?.name ?? ''}
                      maxLength={60} onChange={(e) => set(key, { name: e.target.value })} />
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <select aria-label={b.t('people.colourFor', { label })} value={chosen} onChange={(e) => set(key, { color: Number(e.target.value) })}>
                      {SERIES_LIGHT.map((_, i) => <option key={i} value={i}>{b.t(`colour.${i}`)}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="controls">
        <button type="button" className="btn primary" disabled={state === 'saving'} onClick={() => void save()}>{b.t('people.save')}</button>
        {state === 'saved' && <span className="small" role="status"><Icon name="check" /> {b.t('people.saved')}</span>}
        {state === 'failed' && <span className="small" role="status"><Icon name="warning" /> {b.t('error.save')}</span>}
      </div>
    </div>
  );
}
