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

  describe('chapter groups', () => {
    const grouped = (c: Chapter, group: string | null): Chapter => ({ ...c, group });
    // Book five: Prolog, Jaime I, Arya (its only one), Jaime II. Book six: Arya I, Arya II.
    const b5 = [
      grouped(chapter(0, 'Prolog', ['Chett'], ['Mauer']), null),
      grouped(chapter(1, 'Jaime I', ['Jaime', 'Brienne'], ['Harrenhal']), 'Jaime'),
      grouped(chapter(2, 'Arya', ['Arya'], ['Trident']), null),
      grouped(chapter(3, 'Jaime II', ['Jaime', 'Cersei'], ['Königsmund']), 'Jaime'),
    ];
    const b6 = [grouped(chapter(0, 'Arya I', ['Arya', 'Sandor'], ['Trident']), 'Arya'), grouped(chapter(1, 'Arya II', ['Arya'], ['Braavos']), 'Arya')];
    const all = [...b5.map((c) => ['b5', c] as const), ...b6.map((c) => ['b6', c] as const)];
    const slugs = all.map((_, i) => `g${i}`);

    function groupedCtx(path: string) {
      const docs = makeMockDocs({
        'data/site/main/index': index({}, { books: Object.fromEntries(all.map(([book, c], i) => [slugs[i], { book: summary(book, [c]) }])) }),
        ...Object.fromEntries(all.map(([, c], i) => [`data/episode/${slugs[i]}/stats:book`, published([c])])),
      });
      return makeMockCtx({
        route: { path },
        episodes: [...slugs].reverse(),
        episodeLabels: Object.fromEntries(all.map(([, c], i) => [slugs[i], c.heading])),
        docs,
      });
    }
    const groupRows = (host: HTMLElement) => [...host.querySelectorAll('table.groups tbody tr')].map((r) => r.querySelector('th')?.textContent);

    it('adds chapters up per group across books, prologues left out', async () => {
      const view = await mount(<StatsPage ctx={groupedCtx('books')} />);
      await flush();
      await flush();
      expect(view.text()).toContain('Chapter groups');
      expect(groupRows(view.host)).toEqual(['Arya', 'Jaime']); // Arya: b5's single chapter plus b6's two
      const arya = view.host.querySelector('table.groups tbody tr')!.textContent;
      expect(arya).toContain('3');
      expect(arya).toContain('Sandor');
      const names = () => view.host.querySelectorAll('table.groups tbody tr:first-child ol.names-list li').length;
      expect(names()).toBe(2); // Arya, Sandor: fewer than 3 known
      const top5 = [...view.host.querySelectorAll('button.chip')].find((x) => x.textContent === 'Top 5' && x.closest('section')?.querySelector('table.groups')) as HTMLButtonElement;
      await act(async () => top5.click());
      expect(top5.getAttribute('aria-pressed')).toBe('true');
      expect(view.text()).toContain('Most chapters');
      const options = [...view.host.querySelectorAll('.group-pick option')].map((o) => o.textContent);
      expect(options).toEqual(['All chapters', 'Arya (3)', 'Jaime (2)']);
    });

    it('narrows the page down to one group', async () => {
      const view = await mount(<StatsPage ctx={groupedCtx('books')} />);
      await flush();
      await flush();
      const jaime = [...view.host.querySelectorAll('table.groups button.link')].find((x) => x.textContent === 'Jaime') as HTMLButtonElement;
      await act(async () => jaime.click());
      const rows = [...view.host.querySelectorAll('table.by-chapter tbody tr th div:first-child')].map((d) => d.textContent);
      expect(rows).toEqual(['Jaime I', 'Jaime II']);
      expect((view.host.querySelector('.group-pick select') as HTMLSelectElement).value).toBe('jaime');
      expect(view.text()).toContain('Words per chapter');
      expect(view.text()).toContain('Cersei'); // names from the group's own chapters
      expect(view.text()).not.toContain('Chett');
      const clear = [...view.host.querySelectorAll('.group-pick button')].find((x) => x.textContent === 'Show all chapters') as HTMLButtonElement;
      await act(async () => clear.click());
      expect(view.host.querySelectorAll('table.by-chapter tbody tr')).toHaveLength(6);
    });

    it('keeps one book to its own groups', async () => {
      const view = await mount(<StatsPage ctx={groupedCtx('books/b5')} />);
      await flush();
      await flush();
      expect(groupRows(view.host)).toEqual(['Jaime']); // b5's lone Arya chapter is no group on its own
    });

    it('shows nothing new for a book without groups', async () => {
      const { ctx } = ctxAt('books');
      const view = await mount(<StatsPage ctx={ctx} />);
      await flush();
      expect(view.host.querySelector('.group-pick')).toBeNull();
      expect(view.text()).not.toContain('Chapter groups');
    });
  });
});
