// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { isPluginApiError, PROBLEM_TYPES, type PluginContext } from '@mosaicast/plugin-sdk';
import { useEffect, useState } from 'react';
import { bundleId, resolveBundles } from '../bundles';
import type { Bundle, BundleSettings, ImportRecord } from '../types';
import { Icon, type Basics } from './common';

/**
 * The site's bundles: e.g. "Episode" and "Spoiler" for podcast results, "Book" for book results. Stored as
 * one `bundles` document. A bundle that still has stats assigned can't be removed here, because its stats
 * would silently disappear; unassign them first.
 */
export function BundleEditor({
  ctx, b, settings, imports, onSaved, canEdit,
}: {
  ctx: PluginContext;
  /** Bundles are a site setting: only admins may change them (a `writableBy: admin` key floor). */
  canEdit: boolean;
  b: Basics;
  settings: BundleSettings | null;
  imports: ImportRecord[];
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Bundle[]>(() => resolveBundles(settings));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'forbidden'>('idle');
  useEffect(() => setDraft(resolveBundles(settings)), [settings]);
  const used = new Set(imports.flatMap((r) => r.assignments.map((a) => a.bundle)));
  const set = (i: number, patch: Partial<Bundle>) => {
    setState('idle');
    setDraft((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };
  const add = (kind: Bundle['kind']) => {
    setState('idle');
    setDraft((d) => [...d, { id: '', kind, name: '', spoiler: false, match: '' }]);
  };
  const save = async () => {
    setState('saving');
    const taken: string[] = [];
    const bundles: Bundle[] = [];
    for (const x of draft) {
      const name = x.name?.trim() ?? '';
      const id = x.id || bundleId(name || x.kind, [...taken, ...draft.map((d) => d.id).filter(Boolean)]);
      taken.push(id);
      bundles.push({ id, kind: x.kind, name: name || null, spoiler: !!x.spoiler, match: x.match?.trim() || null });
    }
    try {
      await ctx.docs.put('site', 'bundles', { bundles });
      setState('saved');
      onSaved();
    } catch (e) {
      if (isPluginApiError(e) && e.status === 403 && e.problem?.type === PROBLEM_TYPES.keyFloor) {
        setState('forbidden');
        return;
      }
      ctx.log('warn', `stats: could not save bundles (${String(e)})`);
      setState('failed');
    }
  };

  return (
    <div>
      {!canEdit && <p className="note"><Icon name="info" /> {b.t('bundle.adminsOnly')}</p>}
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{b.t('bundle.kind')}</th>
              <th scope="col" style={{ textAlign: 'left' }}>{b.t('bundle.name')}</th>
              <th scope="col" style={{ textAlign: 'left' }}>{b.t('bundle.spoiler')}</th>
              <th scope="col" style={{ textAlign: 'left' }}>{b.t('bundle.match')}</th>
              <th scope="col"><span className="sr">{b.t('imports.remove')}</span></th>
            </tr>
          </thead>
          <tbody>
            {draft.map((x, i) => {
              const inUse = !!x.id && used.has(x.id);
              return (
                <tr key={x.id || `new-${i}`}>
                  <td>{b.t(`bundle.kind.${x.kind}`)}{x.id && <div className="tiny muted">{x.id}</div>}</td>
                  <td style={{ textAlign: 'left' }}>
                    <input type="text" value={x.name ?? ''} maxLength={40} placeholder={b.t(`bundle.default.${x.kind}`)}
                      aria-label={b.t('bundle.name')} onChange={(e) => set(i, { name: e.target.value })} />
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <label className="check" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={!!x.spoiler} aria-label={b.t('bundle.spoiler')}
                        onChange={(e) => set(i, { spoiler: e.target.checked })} />
                    </label>
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <input type="text" value={x.match ?? ''} maxLength={60} placeholder={b.t('bundle.matchExample')}
                      aria-label={b.t('bundle.match')} onChange={(e) => set(i, { match: e.target.value })} />
                  </td>
                  <td>
                    <button type="button" className="link" disabled={inUse} title={inUse ? b.t('bundle.inUse') : undefined}
                      onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
                      <Icon name="delete" /> <span className="sr">{b.t('imports.remove')}</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="controls">
        <button type="button" className="btn" onClick={() => add('podcast')}>{b.t('bundle.addPodcast')}</button>
        <button type="button" className="btn" onClick={() => add('book')}>{b.t('bundle.addBook')}</button>
        <button type="button" className="btn primary" disabled={state === 'saving'} onClick={() => void save()}>{b.t('bundle.save')}</button>
        {state === 'saved' && <span className="small" role="status"><Icon name="check" /> {b.t('people.saved')}</span>}
        {state === 'failed' && <span className="small" role="status"><Icon name="warning" /> {b.t('error.save')}</span>}
        {state === 'forbidden' && <span className="small" role="status"><Icon name="warning" /> {b.t('bundle.adminsOnly')}</span>}
      </div>
      </fieldset>
    </div>
  );
}
