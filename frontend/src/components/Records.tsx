// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useRef, useState } from 'react';
import { Icon, type Basics } from './common';

/** One place in a ranking, ready to draw. */
export interface RankRow {
  id: string;
  /** The number, formatted. */
  value: string;
  /** A person, with their colour. */
  who?: { name: string; color: string };
  /** What it is when it isn't a person, e.g. a chapter heading. */
  what?: string;
  /** Where it happened: an episode link. */
  link?: { href: string; text: string };
  /** A second number, formatted, e.g. "6,172 words". */
  extra?: string;
}

/** A record: its label and the whole ranking behind it, holder first. */
export interface RecordSpec {
  id: string;
  label: string;
  rows: RankRow[];
}

/**
 * Record cards in groups ("Episodes", "People"), each showing its holder. "Ranking" opens a dialog with
 * everyone behind them, so a record is never just a number without context.
 */
export function RecordGroups({ groups, b }: { groups: { title?: string; records: RecordSpec[] }[]; b: Basics }) {
  const [open, setOpen] = useState<RecordSpec | null>(null);
  const shown = groups.filter((g) => g.records.length > 0);
  if (shown.length === 0) return null;
  return (
    <section className="section">
      <h3>{b.t('records.title')}</h3>
      {shown.map((g, i) => (
        <div key={g.title ?? i} style={{ marginTop: i > 0 ? 14 : 0 }}>
          {g.title && shown.length > 1 && <div className="small muted" style={{ marginBottom: 6 }}>{g.title}</div>}
          <div className="records">
            {g.records.map((r) => <RecordCard key={r.id} spec={r} onRanking={() => setOpen(r)} b={b} />)}
          </div>
        </div>
      ))}
      <RankingDialog spec={open} onClose={() => setOpen(null)} b={b} />
    </section>
  );
}

function RecordCard({ spec, onRanking, b }: { spec: RecordSpec; onRanking: () => void; b: Basics }) {
  const top = spec.rows[0];
  return (
    <div className="record">
      <div className="label">{spec.label}</div>
      <div className="value">
        {top.value}
        {(top.who || top.what) && <span className="muted small"> · {top.who?.name ?? top.what}</span>}
      </div>
      <div className="where">
        {top.link ? <a href={top.link.href}>{top.link.text}</a> : <span className="muted">{top.extra}</span>}
      </div>
      <button type="button" className="link small" onClick={onRanking} aria-haspopup="dialog">
        {b.t('records.ranking', { n: spec.rows.length })}
      </button>
    </div>
  );
}

/** The full ranking of one record, in a modal dialog (Esc or a click outside closes it). */
function RankingDialog({ spec, onClose, b }: { spec: RecordSpec | null; onClose: () => void; b: Basics }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (spec && !d.open) {
      // jsdom has no showModal; the attribute still makes the content visible there.
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!spec && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [spec]);
  const people = spec?.rows.some((r) => r.who);
  const where = spec?.rows.some((r) => r.link);
  const extra = spec?.rows.some((r) => r.extra);
  return (
    <dialog
      ref={ref}
      className="ranking"
      aria-labelledby="ranking-title"
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {spec && (
        <div className="ranking-body">
          <div className="row-head">
            <h3 id="ranking-title" style={{ margin: 0 }}>{spec.label}</h3>
            <button type="button" className="btn" onClick={onClose} aria-label={b.t('records.close')}>
              <Icon name="close" />
            </button>
          </div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  {(people || spec.rows.some((r) => r.what)) && <th scope="col" style={{ textAlign: 'left' }}>{people ? b.t('records.who') : b.t('book.chapter')}</th>}
                  {where && <th scope="col" style={{ textAlign: 'left' }}>{b.t('book.episode')}</th>}
                  <th scope="col">{b.t('records.value')}</th>
                  {extra && <th scope="col" />}
                </tr>
              </thead>
              <tbody>
                {spec.rows.map((r, i) => (
                  <tr key={r.id} className={i === 0 ? 'first' : undefined}>
                    <td className="muted">{i + 1}</td>
                    {(people || spec.rows.some((x) => x.what)) && (
                      <td style={{ textAlign: 'left' }}>
                        {r.who ? (
                          <span className="person"><span className="swatch" style={{ background: r.who.color }} />{r.who.name}</span>
                        ) : r.what}
                      </td>
                    )}
                    {where && <td style={{ textAlign: 'left' }}>{r.link ? <a href={r.link.href}>{r.link.text}</a> : null}</td>}
                    <td style={{ fontWeight: i === 0 ? 600 : undefined }}>{r.value}</td>
                    {extra && <td className="muted">{r.extra}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </dialog>
  );
}
