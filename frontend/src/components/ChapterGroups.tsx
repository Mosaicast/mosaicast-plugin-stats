// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useState } from 'react';
import { groupRankings, mergeNames, type ChapterGroupRow, type GroupRecordId } from '../book';
import * as fmt from '../format';
import type { Chapter } from '../types';
import type { RecordSpec } from './Records';
import { nextSort, sortRows, SortTh, type Basics, type SortKey, type SortState } from './common';

interface Column {
  id: string;
  label: string;
  hint?: string;
  sort?: SortKey<ChapterGroupRow>;
  cell: (r: ChapterGroupRow) => React.ReactNode;
  left?: boolean;
  wrap?: boolean;
}

/**
 * Chapter groups side by side ("Jaime", "Cersei", …: chapters sharing a heading in the book): how many
 * chapters, how long, how wordy, how much dialogue, how much podcast per word, whom they mention most. Every
 * column sorts; a group's name narrows the whole page down to its chapters. Top 3 or 5 characters per group.
 */
export function ChapterGroupTable({ rows, details, active, onPick, b }: {
  rows: ChapterGroupRow[];
  /** Per-chapter names, undefined while loading. */
  details: Map<string, Chapter> | undefined;
  /** The group the page is narrowed to, if any. */
  active: string | null;
  onPick: (id: string | null) => void;
  b: Basics;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const [names, setNames] = useState(3);
  const dash = '–';
  const top = (r: ChapterGroupRow) => mergeNames(r.points.map((p) => details?.get(p.key)?.characters ?? []), names);
  const columns: Column[] = [
    {
      id: 'group', label: b.t('groups.group'), left: true, sort: (r) => r.title,
      cell: (r) => (
        <button type="button" className="link" aria-pressed={active === r.id} onClick={() => onPick(active === r.id ? null : r.id)}>
          {r.title}
        </button>
      ),
    },
    { id: 'chapters', label: b.t('book.chapters'), sort: (r) => r.chapters, cell: (r) => fmt.count(r.chapters, b.locale) },
    { id: 'words', label: b.t('book.words'), sort: (r) => r.words, cell: (r) => fmt.compact(r.words, b.locale) },
    { id: 'avgWords', label: b.t('groups.avgWords'), wrap: true, sort: (r) => r.avgWords, cell: (r) => fmt.count(r.avgWords, b.locale) },
  ];
  if (rows.some((r) => r.avgSentence != null)) {
    columns.push({
      id: 'avgSentence', label: b.t('book.avgSentence'), wrap: true, sort: (r) => r.avgSentence,
      cell: (r) => (r.avgSentence != null ? fmt.decimal(r.avgSentence, b.locale) : dash),
    });
  }
  if (rows.some((r) => r.dialogueShare != null)) {
    columns.push({
      id: 'dialogue', label: b.t('book.dialogue'), sort: (r) => r.dialogueShare,
      cell: (r) => (r.dialogueShare != null ? fmt.percent(r.dialogueShare, b.locale) : dash),
    });
  }
  if (rows.some((r) => r.minutesPerKWords != null)) {
    columns.push({
      id: 'pace', label: b.t('pace.perK'), hint: b.t('pace.perKHint'), wrap: true, sort: (r) => r.minutesPerKWords,
      cell: (r) => (r.minutesPerKWords != null ? fmt.decimal(r.minutesPerKWords, b.locale) : dash),
    });
  }
  if (details === undefined || rows.some((r) => top(r).length > 0)) {
    columns.push({
      id: 'names', label: b.t('books.characters'), left: true, wrap: true,
      cell: (r) => {
        const list = top(r);
        if (details === undefined) return '…';
        if (list.length === 0) return dash;
        return (
          <ol className="names-list">
            {list.map((e) => <li key={e.text}>{e.text} <span className="muted">{fmt.count(e.count, b.locale)}</span></li>)}
          </ol>
        );
      },
    });
  }
  const current = sort && columns.find((c) => c.id === sort.id);
  const order = sort ? sortRows(rows, current?.sort, sort.dir) : rows;

  return (
    <section className="section">
      <div className="chart-head">
        <h3>{b.t('groups.title')}</h3>
        {columns.some((c) => c.id === 'names') && (
          <div className="chips" role="group" aria-label={b.t('books.characters')}>
            {[3, 5].map((n) => (
              <button key={n} type="button" className="chip" aria-pressed={names === n} onClick={() => setNames(n)}>
                {b.t('books.topN', { n })}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="small muted" style={{ margin: '0 0 8px' }}>{b.t('groups.hint')}</p>
      <div className="table-wrap">
        <table className="pace groups">
          <thead>
            <tr>
              {columns.map((c) => (
                <SortTh key={c.id} id={c.id} label={c.label} hint={c.hint} wrap={c.wrap} left={c.left} sort={sort}
                  onSort={c.sort && (() => setSort((now) => nextSort(now, c.id, c.id === 'group')))} />
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((r) => (
              <tr key={r.id} className={active === r.id ? 'active' : undefined}>
                {columns.map((c, i) => i === 0
                  ? <th key={c.id} scope="row" style={{ fontWeight: 400, textAlign: 'left' }}>{c.cell(r)}</th>
                  : <td key={c.id} style={c.left ? { textAlign: 'left', whiteSpace: 'normal' } : undefined}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Records between chapter groups, for the records section next to the chapter records. */
export function groupRecords(rows: ChapterGroupRow[], b: Basics): RecordSpec[] {
  const words = (v: number) => b.t('book.wordCount', { n: fmt.count(v, b.locale) });
  const value: Record<GroupRecordId, (v: number) => string> = {
    mostChapters: (v) => b.plural('book.chapterCount', v),
    longestAvg: words,
    wordiest: (v) => b.t('books.perSentence', { n: fmt.decimal(v, b.locale) }),
    mostDialogue: (v) => fmt.percent(v, b.locale),
    leastDialogue: (v) => fmt.percent(v, b.locale),
    mostPace: (v) => b.t('book.paceValue', { n: fmt.decimal(v, b.locale) }),
    leastPace: (v) => b.t('book.paceValue', { n: fmt.decimal(v, b.locale) }),
  };
  return groupRankings(rows).map((r) => ({
    id: `group-${r.id}`,
    label: b.t(`groups.${r.id}`),
    whatLabel: b.t('groups.group'),
    rows: r.entries.map((e) => ({
      id: e.row.id,
      value: value[r.id](e.value),
      what: e.row.title,
      extra: r.id === 'mostChapters' ? undefined : b.plural('book.chapterCount', e.row.chapters),
    })),
  }));
}
