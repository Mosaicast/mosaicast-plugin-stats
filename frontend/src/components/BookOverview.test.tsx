// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { makeMockCtx, makeMockDocs } from '@mosaicast/plugin-sdk/testing';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetShared } from '../data';
import { flush, index, mount, stats } from '../test/fixtures';
import type { BookStats, BookSummary, Chapter } from '../types';
import { StatsPage } from './StatsPage';

function chapter(index: number, heading: string, characters: string[], places: string[]): Chapter {
  return {
    id: `c${index}`, index, heading, words: 5000 + index * 100, sentences: 400, paragraphs: 50,
    longestSentence: 60, dialogue: 120 + index * 10, questions: 12,
    characters: characters.map((text, i) => ({ text, count: 30 - i * 5 })),
    newCharacters: index === 0 ? characters.map((text) => ({ text, count: 1 })) : [],
    entities: [{ label: 'LOCATION', top: places.map((text, i) => ({ text, count: 9 - i })) }],
  };
}

function summary(book: string, chapters: Chapter[]): BookSummary {
  return {
    book, title: book === 'b5' ? 'Book Five' : 'Book Six',
    chapters: chapters.map(({ characters: _c, newCharacters: _n, entities: _e, ...numbers }) => numbers),
    words: chapters.reduce((a, c) => a + c.words, 0), sentences: chapters.length * 400, paragraphs: 50,
    characters: [{ text: 'Jaime', count: 40 }], newCharacters: [], entities: [{ label: 'LOCATION', top: [{ text: 'Harrenhal', count: 12 }] }],
  };
}

const c5 = [chapter(0, 'Prolog', ['Chett', 'Sam'], ['Mauer']), chapter(1, 'Jaime I', ['Jaime', 'Brienne'], ['Harrenhal', 'Trident'])];
const c6 = [chapter(0, 'Arya I', ['Arya', 'Sandor'], ['Trident'])];
const published = (chapters: Chapter[]): BookStats => ({ model: 2, title: 'x', chapters, warnings: [] });

function ctxAt(path: string, podcasts: Parameters<typeof index>[0] = {}) {
  const docs = makeMockDocs({
    'data/site/main/index': index(podcasts, { books: {
      e1: { book: summary('b5', [c5[0]]) },
      e2: { book: summary('b5', [c5[1]]) },
      e3: { book: summary('b6', c6) },
    } }),
    'data/episode/e1/stats:book': published([c5[0]]),
    'data/episode/e2/stats:book': published([c5[1]]),
    'data/episode/e3/stats:book': published(c6),
  });
  return { docs, ctx: makeMockCtx({
    route: { path },
    episodes: ['e3', 'e2', 'e1'],
    episodeLabels: { e1: 'S05E00 · Prolog', e2: 'S05E01 · Jaime I', e3: 'S06E01 · Arya I' },
    docs,
  }) };
}

describe('books view', () => {
  beforeEach(() => forgetShared());

  it('shows every book chapter by chapter, with names from one batched read', async () => {
    const { ctx, docs } = ctxAt('books');
    const view = await mount(<StatsPage ctx={ctx} />);
    await flush();
    await flush();
    expect(view.text()).toContain('Book stats');
    expect(view.text()).toContain('Chapter length');
    expect(view.text()).toContain('Words per sentence');
    expect(view.text()).toContain('Most dialogue');
    // The scope row: all, the seasons with books, and one chip per book.
    const scope = [...view.host.querySelectorAll('nav')].pop()!;
    expect([...scope.querySelectorAll('a')].map((a) => a.textContent?.trim())).toEqual(['All', 'Season 6', 'Season 5', 'Book Five', 'Book Six']);
    // Chapter rows in book order, with their top names.
    const rows = [...view.host.querySelectorAll('table.by-chapter tbody tr')].map((r) => r.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('Jaime I');
    expect(rows[1]).toContain('Brienne');
    expect(rows[1]).toContain('Harrenhal');
    expect(docs.calls.filter((c) => c.method === 'getMany')).toHaveLength(1);
    // Two books side by side.
    expect(view.text()).toContain('Book Five');
    expect(view.text()).toContain('Book Six');
  });

  it('narrows down to one book and draws a heat map', async () => {
    const { ctx } = ctxAt('books/b6');
    const view = await mount(<StatsPage ctx={ctx} />);
    await flush();
    await flush();
    expect(view.host.querySelector('h1')?.textContent).toBe('Book Six');
    expect(view.host.querySelectorAll('table.by-chapter tbody tr')).toHaveLength(1);
    const toMap = [...view.host.querySelectorAll('button')].find((x) => x.textContent === 'Heat map')!;
    await act(async () => toMap.click());
    const names = [...view.host.querySelectorAll('table.heat tbody th')].map((t) => t.textContent);
    expect(names).toEqual(['Arya', 'Sandor']);
    expect(view.host.querySelector('table.heat td.l4')).not.toBeNull();
  });

  it('puts podcast and book side by side per episode, sortable, with a total', async () => {
    const { ctx } = ctxAt('books/b5', { e1: { ...stats({ laughs: 3 }), durationSeconds: 3000 }, e2: { ...stats({ laughs: 1 }), durationSeconds: 1200 } });
    const view = await mount(<StatsPage ctx={ctx} />);
    await flush();
    await flush();
    const table = view.host.querySelector('table.pace')!;
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.replace(/[↕▲▼]/g, ''));
    expect(heads).toEqual(['Episode', 'Chapters', 'Book words', 'Length', 'Min. per 1,000 words', 'Sec. per sentence',
      'Spoken per book word', 'Laughs', 'Most talked about']);
    const order = () => [...table.querySelectorAll('tbody th')].map((th) => th.textContent);
    expect(order()).toEqual(['Prolog', 'Jaime I']); // book order
    const sortBy = async (label: string) => {
      const btn = [...table.querySelectorAll('th button.sort')].find((x) => x.textContent?.startsWith(label)) as HTMLButtonElement;
      await act(async () => btn.click());
    };
    await sortBy('Laughs');
    expect(order()).toEqual(['Prolog', 'Jaime I']); // 3 laughs before 1
    await sortBy('Laughs');
    expect(order()).toEqual(['Jaime I', 'Prolog']);
    expect(table.querySelector('th[aria-sort="ascending"]')?.textContent).toContain('Laughs');
    const total = table.querySelector('tfoot tr')!.textContent;
    expect(total).toContain('Total');
    expect(total).toContain('2 chapters');
    // More time per word than average gets the warm tint, less the cool one.
    expect(table.querySelector('tbody tr .delta[class*="delta-more"]')).not.toBeNull();
    expect(table.querySelector('tbody tr .delta[class*="delta-less"]')).not.toBeNull();
    expect(view.text()).toContain('how many minutes of podcast each 1,000 words of book got');
  });

  it('shows the full ranking behind a record', async () => {
    const { ctx } = ctxAt('books');
    const view = await mount(<StatsPage ctx={ctx} />);
    await flush();
    const card = [...view.host.querySelectorAll('.record')].find((r) => r.textContent?.includes('Longest chapter'))!;
    await act(async () => (card.querySelector('button') as HTMLButtonElement).click());
    const dialog = view.host.querySelector('dialog.ranking')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    const rows = [...dialog.querySelectorAll('tbody tr')].map((r) => r.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('Jaime I');
  });

  it('links from the podcast page to the books', async () => {
    const { ctx } = ctxAt('');
    const view = await mount(<StatsPage ctx={ctx} />);
    await flush();
    // No podcast stats at all: the books view is the page.
    expect(view.text()).toContain('Chapter by chapter');
  });
});
