// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { makeMockBlobs, makeMockCtx, makeMockDocs } from '@mosaicast/plugin-sdk/testing';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetShared } from '../data';
import type { ImportRecord } from '../types';
import { flush, mount, stats } from '../test/fixtures';
import { Manage } from './Manage';

const podcaster = { id: 'u1', role: 'podcaster' as const, displayName: 'Pod', avatarUrl: '/api/users/u1/avatar' };

function zip(name: string, bytes = [0x50, 0x4b, 3, 4, 0, 0]) {
  return new File([new Uint8Array(bytes)], name, { type: '' });
}

async function drop(host: HTMLElement, files: File[]) {
  const input = host.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  for (let i = 0; i < 5; i++) await flush();
}

const ready: ImportRecord = {
  id: 'ref-1', status: 'ready', fileName: '5.01 Jaime I.zip', uploadedAt: '2026-10-02T10:00:00Z', processedAt: '2026-10-02T10:00:05Z',
  reader: 'mat', level: 'episode', hint: '5.01 Jaime I.mp3', summary: { ...stats(), timeline: null },
  candidates: [{ slug: 's5e1', title: '5.01 - Jaime I', score: 0.95 }, { slug: 's4e1', title: '4.01 - Tyrion I', score: 0.4 }],
  assignments: [], merge: {}, error: null, suggestedBundle: 'podcast',
};

describe('Manage', () => {
  beforeEach(() => forgetShared());

  it('uploads ZIPs and leaves the reading to the backend', async () => {
    const blobs = makeMockBlobs({ mimeTypes: ['application/zip'], maxFileBytes: 1024 });
    const docs = makeMockDocs();
    const view = await mount(<Manage ctx={makeMockCtx({ user: podcaster, blobs, docs })} />);
    await drop(view.host, [zip('a.zip'), zip('notes.txt'), zip('b.zip', [0x7b, 0x7d])]);

    expect(blobs.uploads.map((u) => [u.filename, u.mime])).toEqual([['a.zip', 'application/zip']]);
    expect(Object.keys(docs.stored).filter((k) => k.includes('/cmd:'))).toEqual([]);
    expect(view.text()).toContain('Not a ZIP file');
    expect(view.text()).toMatch(/1 change in progress/);
  });

  it('queues a command only when a format is picked by hand', async () => {
    const blobs = makeMockBlobs({ mimeTypes: ['application/zip'] });
    const docs = makeMockDocs({ 'data/site/main/readers': [{ id: 'mat', name: 'MAT' }] });
    const view = await mount(<Manage ctx={makeMockCtx({ user: podcaster, blobs, docs })} />);
    const select = view.host.querySelector('#stats-reader') as HTMLSelectElement;
    await act(async () => {
      select.value = 'mat';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await drop(view.host, [zip('a.zip')]);
    const cmd = Object.entries(docs.stored).find(([k]) => k.includes('/cmd:'))?.[1];
    expect(cmd).toMatchObject({ type: 'ingest', ref: blobs.stored[0].ref, fileName: 'a.zip', reader: 'mat' });
  });

  it('stops showing an upload as in progress once its import exists', async () => {
    const blobs = makeMockBlobs({ mimeTypes: ['application/zip'] });
    const docs = makeMockDocs();
    const view = await mount(<Manage ctx={makeMockCtx({ user: podcaster, blobs, docs })} />);
    await drop(view.host, [zip('a.zip')]);
    expect(view.text()).toMatch(/in progress/);
    const ref = blobs.stored[0].ref;
    docs.stored[`data/site/main/import:${ref}`] = { ...ready, id: ref, archive: ref };
    await act(async () => { await new Promise((r) => setTimeout(r, 2700)); });
    await flush();
    expect(view.text()).not.toMatch(/in progress/);
    expect(view.text()).toContain('5.01 Jaime I.zip');
  });

  it('says so when a file is over the limit', async () => {
    const blobs = makeMockBlobs({ mimeTypes: ['application/zip'], maxFileBytes: 4 });
    const view = await mount(<Manage ctx={makeMockCtx({ user: podcaster, blobs })} />);
    await drop(view.host, [zip('big.zip')]);
    expect(blobs.uploads).toHaveLength(0);
    expect(view.text()).toMatch(/Bigger than/);
  });

  it('suggests the best episode and queues the assignment', async () => {
    const docs = makeMockDocs({ 'data/site/main/import:ref-1': ready });
    const ctx = makeMockCtx({
      user: podcaster, docs, blobs: makeMockBlobs({ mimeTypes: ['application/zip'] }),
      episodes: ['s5e1', 's4e1'], episodeLabels: { s5e1: 'S05E01 · 5.01 - Jaime I', s4e1: 'S04E01 · 4.01 - Tyrion I' },
    });
    const view = await mount(<Manage ctx={ctx} />);
    const select = view.host.querySelector('select[id^="t-"]') as HTMLSelectElement;
    expect(select.value).toBe('s5e1');
    const assign = [...view.host.querySelectorAll('button')].find((b) => b.textContent === 'Assign') as HTMLButtonElement;
    await act(async () => assign.click());
    await flush();
    const cmd = Object.entries(docs.stored).find(([k]) => k.startsWith('data/site/main/cmd:'))?.[1];
    expect(cmd).toMatchObject({ type: 'assign', importId: 'ref-1', target: { type: 'episode', id: 's5e1' } });
    expect(view.text()).toMatch(/in progress/);
  });

  it('can read a kept archive again, or download it', async () => {
    const blobs = makeMockBlobs({ mimeTypes: ['application/zip'] });
    const docs = makeMockDocs({ 'data/site/main/import:ref-1': { ...ready, archive: 'blob-9' } });
    const view = await mount(<Manage ctx={makeMockCtx({ user: podcaster, docs, blobs, episodes: ['s5e1'] })} />);
    const link = [...view.host.querySelectorAll('a')].find((a) => a.textContent === 'Download ZIP') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(blobs.urlFor('blob-9'));
    const again = [...view.host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Read again') as HTMLButtonElement;
    await act(async () => again.click());
    await flush();
    const cmd = Object.entries(docs.stored).find(([k]) => k.startsWith('data/site/main/cmd:'))?.[1];
    expect(cmd).toMatchObject({ type: 'reread', importId: 'ref-1' });
  });

  it('says when assigned stats wait for the release', async () => {
    const waiting: ImportRecord = { ...ready, status: 'assigned', assignments: [{ target: { type: 'episode', id: 's5e37' }, bundle: 'podcast', live: false }] };
    const docs = makeMockDocs({ 'data/site/main/import:ref-1': waiting });
    const view = await mount(<Manage ctx={makeMockCtx({ user: podcaster, docs, blobs: makeMockBlobs(), episodes: ['s5e37'], episodeLabels: { s5e37: 'S05E37 · Brienne I' } })} />);
    const tab = [...view.host.querySelectorAll('button.chip')].find((x) => x.textContent?.startsWith('Assigned')) as HTMLButtonElement;
    await act(async () => tab.click());
    expect(view.text()).toContain('Waits for release');
    expect(view.text()).toContain('visitors see it once the episode is released');
  });

  it('copes with records an older version wrote', async () => {
    const old = { id: 'o1', status: 'failed', fileName: 'old.zip', uploadedAt: '2026-10-01T10:00:00Z', processedAt: '2026-10-01T10:00:00Z',
      candidates: [], target: null, merge: {}, error: { code: 'nothing-to-show', message: 'x' } } as unknown as ImportRecord;
    const docs = makeMockDocs({ 'data/site/main/import:o1': old });
    const view = await mount(<Manage ctx={makeMockCtx({ user: podcaster, docs, blobs: makeMockBlobs() })} />);
    expect(view.text()).toContain('old.zip');
  });

  it('shows why an upload failed', async () => {
    const failed: ImportRecord = { ...ready, id: 'ref-2', status: 'failed', summary: null, candidates: [], error: { code: 'unsafe-path', message: 'x' } };
    const docs = makeMockDocs({ 'data/site/main/import:ref-2': failed });
    const view = await mount(<Manage ctx={makeMockCtx({ user: podcaster, docs, blobs: makeMockBlobs() })} />);
    expect(view.text()).toContain('point outside of it');
  });
});
