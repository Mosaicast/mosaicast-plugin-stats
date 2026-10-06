// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { makeMockBlobs, makeMockCtx, makeMockDocs, makeMockFeeds } from '@mosaicast/plugin-sdk/testing';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetShared } from '../data';
import { bookSummary, flush, index, mount, stats } from '../test/fixtures';
import type { BookStats, ImportRecord } from '../types';
import { EpisodeView } from './EpisodeView';
import { Manage } from './Manage';

const bundles = { bundles: [
  { id: 'main', kind: 'podcast', name: 'Episode' },
  { id: 'spoiler', kind: 'podcast', name: 'Spoiler', spoiler: true },
  { id: 'book', kind: 'book', name: 'Book' },
] };
const podcaster = { id: 'u1', role: 'podcaster' as const, displayName: 'Pod', avatarUrl: '/api/users/u1/avatar' };
const admin = { ...podcaster, id: 'u2', role: 'admin' as const };

function book(): BookStats {
  return {
    model: 1, title: 'Book', warnings: [],
    chapters: [
      { id: 'c0', index: 0, heading: 'Prolog', words: 6000, sentences: 500, paragraphs: 100, characters: [{ text: 'Chett', count: 20 }], newCharacters: [{ text: 'Sam', count: 5 }] },
      { id: 'c1', index: 1, heading: 'Jaime I', words: 4000, sentences: 300, paragraphs: 80, characters: [{ text: 'Jaime', count: 40 }], newCharacters: [] },
    ],
  };
}

function episodeCtx(docs: ReturnType<typeof makeMockDocs>, user: typeof podcaster | null = null) {
  const feeds = makeMockFeeds()
    .withDisplay('ep', { title: 'Ep', description: '', feed: 'gop', season: 5, episodeNo: 1 })
    .withDisplay('ep2', { title: 'Ep2', description: '', feed: 'gop', season: 5, episodeNo: 2 });
  return makeMockCtx({ scope: { type: 'episode', id: 'ep' }, episodes: ['ep'], docs, feeds, user });
}

describe('bundles on the episode page', () => {
  beforeEach(() => {
    forgetShared();
    sessionStorage.clear();
  });

  const main = stats({ alex: 600, max: 400 });
  const spoiler = stats({ alex: 100, max: 900 });
  const docs = () => makeMockDocs({
    'data/site/main/bundles': bundles,
    'data/site/main/index': index({}, { bundles: { ep: { main, spoiler } } }),
    'data/episode/ep/stats:main': main,
    'data/episode/ep/stats:spoiler': spoiler,
  });

  it('hides spoilers until asked, then adds them up', async () => {
    const view = await mount(<EpisodeView ctx={episodeCtx(docs())} />);
    await flush();
    expect(view.text()).toContain('Alex60%');
    const boxes = () => [...view.host.querySelectorAll('.picker label')].map((l) => l.textContent);
    expect(boxes()).toEqual(['Show spoilers']);

    const spoilers = view.host.querySelector('.picker .spoiler input') as HTMLInputElement;
    await act(async () => spoilers.click());
    await flush();
    expect(boxes()).toEqual(['Episode', 'Spoiler', 'Show spoilers']);
    expect(view.text()).toContain('Max65%'); // (400 + 900) / 2000
    expect(JSON.parse(sessionStorage.getItem('mc.stats.view')!)).toEqual({ bundles: ['main', 'spoiler'], spoilers: true });
  });

  it('keeps a signed-in visitor\'s choice on the server, not on the device', async () => {
    const d = docs();
    const view = await mount(<EpisodeView ctx={episodeCtx(d, podcaster)} />);
    await flush();
    await act(async () => (view.host.querySelector('.picker .spoiler input') as HTMLInputElement).click());
    await flush();
    expect(d.stored['data/user/me/view']).toEqual({ bundles: ['main', 'spoiler'], spoilers: true });
    expect(sessionStorage.getItem('mc.stats.view')).toBeNull();
  });

  it('writes nothing on the device until the visitor changes something', async () => {
    await mount(<EpisodeView ctx={episodeCtx(docs())} />);
    await flush();
    expect(sessionStorage.length).toBe(0);
  });
});

describe('books on the episode page', () => {
  beforeEach(() => forgetShared());

  it('shows the chapters, the pace against the season, and narrows to a chapter', async () => {
    const d = makeMockDocs({
      'data/site/main/bundles': bundles,
      'data/site/main/index': index({}, {
        bundles: { ep: { main: stats({ durationSeconds: 6000 }) }, ep2: { main: stats({ durationSeconds: 1200 }) } },
        books: {
          ep: { book: bookSummary([{ heading: 'Prolog', words: 6000, sentences: 500 }, { heading: 'Jaime I', words: 4000, sentences: 300 }]) },
          ep2: { book: bookSummary([{ heading: 'Catelyn I', words: 4000, sentences: 300 }]) },
        },
      }),
      'data/episode/ep/stats:main': stats({ durationSeconds: 6000 }),
      'data/episode/ep/stats:book': book(),
    });
    const view = await mount(<EpisodeView ctx={episodeCtx(d)} />);
    await flush();
    await flush();
    const text = view.text();
    expect(text).toContain('Book');
    expect(text).toContain('10,000');
    expect(text).toContain('10 min'); // 100 min of podcast for 10,000 words
    expect(text).toMatch(/more than season 5/);
    expect(text).toContain('First appearances');

    const jaime = [...view.host.querySelectorAll('button.chip')].find((x) => x.textContent === 'Jaime I') as HTMLButtonElement;
    await act(async () => jaime.click());
    expect(view.text()).toContain('4,000');
    expect(view.text()).not.toContain('10 min'); // the recording isn't split by chapter
  });
});

describe('books on the manage page', () => {
  beforeEach(() => forgetShared());

  it('prefills chapters from clear suggestions and assigns them per episode', async () => {
    const r: ImportRecord = {
      id: 'b1', status: 'ready', kind: 'book', fileName: 'book.zip', uploadedAt: '2026-10-03T10:00:00Z',
      processedAt: '2026-10-03T10:00:05Z', reader: 'mat', level: 'episode', hint: 'Book',
      book: { title: 'Book', chapters: [{ id: 'c0', heading: 'Prolog', words: 6000 }, { id: 'c1', heading: 'Jaime I', words: 4000 }, { id: 'c2', heading: 'Jaime II', words: 3000 }] },
      candidates: [],
      chapterCandidates: {
        c0: [{ slug: 'p', title: '5.00 Prolog', score: 0.7 }],
        c1: [{ slug: 'j1', title: '5.01 - Jaime I', score: 0.87 }, { slug: 'j2', title: '5.11 - Jaime II', score: 0.53 }],
        c2: [{ slug: 'j2', title: '5.11 - Jaime II', score: 0.87 }],
      },
      suggestedBundle: 'book', assignments: [], merge: {}, error: null,
    };
    const d = makeMockDocs({ 'data/site/main/import:b1': r, 'data/site/main/bundles': bundles });
    const view = await mount(<Manage ctx={makeMockCtx({ user: podcaster, docs: d, blobs: makeMockBlobs(), episodes: ['p', 'j1', 'j2'] })} />);
    await flush();
    const selects = [...view.host.querySelectorAll('table select')] as HTMLSelectElement[];
    expect(selects.map((x) => x.value)).toEqual(['p', 'j1', 'j2']);

    await act(async () => {
      selects[2].value = 'j1';
      selects[2].dispatchEvent(new Event('change', { bubbles: true }));
    });
    const save = [...view.host.querySelectorAll('button')].find((x) => x.textContent === 'Save chapters') as HTMLButtonElement;
    await act(async () => save.click());
    await flush();
    const cmds = Object.entries(d.stored).filter(([k]) => k.includes('/cmd:')).map(([, v]) => v as { target: { id: string }; parts: string[] });
    expect(cmds.map((c) => [c.target.id, c.parts])).toEqual([['p', ['c0']], ['j1', ['c1', 'c2']]]);
  });

  it('saves new bundles with ids made from their names', async () => {
    const d = makeMockDocs();
    const view = await mount(<Manage ctx={makeMockCtx({ user: admin, docs: d, blobs: makeMockBlobs() })} />);
    await flush();
    const add = [...view.host.querySelectorAll('button')].find((x) => x.textContent === 'Add podcast bundle') as HTMLButtonElement;
    await act(async () => add.click());
    const rows = [...view.host.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('input[type="text"][maxlength="40"]'));
    const last = rows[rows.length - 1];
    const name = last.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(name, 'Spoiler');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => (last.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    const save = [...view.host.querySelectorAll('button')].find((x) => x.textContent === 'Save bundles') as HTMLButtonElement;
    await act(async () => save.click());
    await flush();
    expect((d.stored['data/site/main/bundles'] as { bundles: { id: string; spoiler: boolean }[] }).bundles)
      .toContainEqual(expect.objectContaining({ id: 'spoiler', kind: 'podcast', name: 'Spoiler', spoiler: true }));
  });

  it('shows podcasters the bundles but leaves changing them to admins', async () => {
    const view = await mount(<Manage ctx={makeMockCtx({ user: podcaster, docs: makeMockDocs(), blobs: makeMockBlobs() })} />);
    await flush();
    expect(view.text()).toContain('only admins can change them');
    const save = [...view.host.querySelectorAll('button')].find((x) => x.textContent === 'Save bundles') as HTMLButtonElement;
    expect(save.matches(':disabled')).toBe(true);
  });
});
