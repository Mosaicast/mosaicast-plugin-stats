// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { makeMockBlobs, makeMockCtx, makeMockDocs, makeMockFeeds } from '@mosaicast/plugin-sdk/testing';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatsPage } from '../components/StatsPage';
import { EpisodeView } from '../components/EpisodeView';
import { forgetShared } from '../data';
import { flush, index, mount, stats } from '../test/fixtures';

const episodes = ['s5e2', 's5e1', 's4e1'];
const labels = { s5e2: 'S05E02 · Catelyn I', s5e1: 'S05E01 · Jaime I', s4e1: 'S04E01 · Tyrion I' };

function ctxAt(path: string, opts: { role?: 'podcaster' | null; docs?: ReturnType<typeof makeMockDocs>; blobs?: ReturnType<typeof makeMockBlobs> } = {}) {
  const docs = opts.docs ?? makeMockDocs({
    'data/site/main/index': index({ s5e2: stats({ laughs: 2 }), s5e1: stats({ alex: 300, max: 700 }), s4e1: stats() }),
  });
  const feeds = makeMockFeeds()
    .withDisplay('s5e2', { title: 'Catelyn I', description: '', feed: 'gop', season: 5, episodeNo: 2 })
    .withDisplay('s5e1', { title: 'Jaime I', description: '', feed: 'gop', season: 5, episodeNo: 1 })
    .withDisplay('s4e1', { title: 'Tyrion I', description: '', feed: 'gop', season: 4, episodeNo: 1 });
  const role = opts.role === undefined ? 'podcaster' : opts.role;
  return makeMockCtx({
    route: { path },
    episodes,
    episodeLabels: labels,
    docs,
    feeds,
    blobs: opts.blobs ?? null,
    user: role ? { id: 'u1', role, displayName: 'Pod', avatarUrl: '/api/users/u1/avatar' } : null,
  });
}

const buttons = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('button.export-btn')];
const byText = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;

async function change(el: HTMLSelectElement | HTMLInputElement, value: string) {
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
  await flush();
}

describe('image export', () => {
  beforeEach(() => forgetShared());
  afterEach(() => vi.restoreAllMocks());

  it('offers export buttons to podcasters only', async () => {
    const visitor = await mount(<StatsPage ctx={ctxAt('', { role: null })} />);
    await flush();
    expect(visitor.text()).toContain('Records');
    expect(buttons(visitor.host)).toHaveLength(0);

    const podcaster = await mount(<StatsPage ctx={ctxAt('')} />);
    await flush();
    // Overview, speaking time, chart, records, names, seasons.
    expect(buttons(podcaster.host).length).toBeGreaterThanOrEqual(5);
  });

  it('opens the dialog on the stat it was asked for and previews it', async () => {
    const view = await mount(<StatsPage ctx={ctxAt('season/5')} />);
    await flush();
    await act(async () => buttons(view.host)[0].click());
    await flush();
    const dialog = view.host.querySelector('dialog.export')!;
    expect(dialog).not.toBeNull();
    const svg = dialog.querySelector('svg')!;
    expect(svg.getAttribute('aria-label')).toBe('The stats at a glance');
    expect(svg.getAttribute('width')).toBe('1080');
    expect(svg.getAttribute('height')).toBe('1920');
    expect(dialog.textContent).toContain('Season 5 · 2 episodes');
    expect(dialog.textContent).toContain('/p/stats/season/5');

    // Another format, another language.
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>('button.chip')].find((b) => b.textContent?.startsWith('Post 1:1'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(dialog.querySelector('svg')!.getAttribute('height')).toBe('1080');
    const lang = [...dialog.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'de'))!;
    await change(lang, 'de');
    expect(dialog.querySelector('svg')!.getAttribute('aria-label')).toBe('Die Stats auf einen Blick');
    expect(dialog.textContent).toContain('Staffel 5');
    // The dialog itself stays in the page's language.
    expect(dialog.textContent).toContain('Download');
  });

  it('switches between the exports of the page and edits the texts', async () => {
    const view = await mount(<StatsPage ctx={ctxAt('')} />);
    await flush();
    await act(async () => buttons(view.host)[0].click());
    await flush();
    const dialog = view.host.querySelector('dialog.export')!;
    const what = dialog.querySelector('select')!;
    expect([...what.options].map((o) => o.value)).toEqual(['podcast.summary', 'podcast.speakers', 'podcast.trend', 'podcast.records', 'podcast.ranking', 'podcast.names', 'podcast.seasons']);
    await change(what, 'podcast.speakers');
    expect(dialog.querySelector('svg')!.getAttribute('aria-label')).toBe('Who talks the most?');
    const headline = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
    await change(headline, 'Alex vs. Max');
    expect(dialog.querySelector('svg')!.textContent).toContain('Alex vs. Max');
  });

  it('saves the look as the site default and starts from it next time', async () => {
    const docs = makeMockDocs({ 'data/site/main/index': index({ s5e2: stats(), s5e1: stats() }) });
    const view = await mount(<StatsPage ctx={ctxAt('', { docs })} />);
    await flush();
    await act(async () => buttons(view.host)[0].click());
    await flush();
    const dialog = view.host.querySelector('dialog.export')!;
    await act(async () => byText(dialog as HTMLElement, 'Dark').click());
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>('button.chip')].find((b) => b.textContent?.startsWith('Wide'))!.click());
    await act(async () => byText(dialog as HTMLElement, 'Save as default').click());
    await flush();
    const saved = docs.stored['data/site/main/export'] as { design: { bg: string }; format: string };
    expect(saved.format).toBe('wide');
    expect(saved.design.bg).toBe('#14161b');
    expect(dialog.textContent).toContain('Saved as the default');
    await view.unmount();

    forgetShared();
    const again = await mount(<StatsPage ctx={ctxAt('', { docs })} />);
    await flush();
    await act(async () => buttons(again.host)[0].click());
    await flush();
    const svg = again.host.querySelector('dialog.export svg')!;
    expect(svg.getAttribute('width')).toBe('1920');
    expect(svg.querySelector('linearGradient stop')!.getAttribute('stop-color')).toBe('#14161b');
  });

  it('downloads the SVG the preview shows', async () => {
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      created.push(b);
      return 'blob:x';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const view = await mount(<StatsPage ctx={ctxAt('')} />);
    await flush();
    await act(async () => buttons(view.host)[0].click());
    await flush();
    const dialog = view.host.querySelector('dialog.export')!;
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>('button.chip')].find((b) => b.textContent === 'SVG')!.click());
    await act(async () => byText(dialog as HTMLElement, 'Download').click());
    await flush();
    expect(click).toHaveBeenCalled();
    const text = await (created[0] as File).text();
    expect((created[0] as File).name).toBe('stats-podcast-summary-all-seasons-story.svg');
    expect(text).toContain('<svg');
    expect(text).toContain('The stats at a glance');
    expect(text).not.toContain('var(--');
  });

  it('keeps its own bundle choice, spoilers included', async () => {
    const docs = makeMockDocs({
      'data/site/main/index': index({ s5e1: stats({ alex: 300, max: 700 }) }, { bundles: { s5e1: { spoiler: stats({ alex: 900, max: 100 }) } } }),
      'data/site/main/bundles': { bundles: [{ id: 'podcast', kind: 'podcast', name: 'Episode' }, { id: 'spoiler', kind: 'podcast', name: 'Spoiler episode', spoiler: true }] },
    });
    const view = await mount(<StatsPage ctx={ctxAt('', { docs })} />);
    await flush();
    await act(async () => buttons(view.host)[0].click());
    await flush();
    const dialog = view.host.querySelector('dialog.export')!;
    expect(dialog.querySelector('svg')!.textContent).not.toContain('Spoilers');
    const spoilers = [...dialog.querySelectorAll('label')].find((l) => l.textContent === 'Show spoilers')!.querySelector('input')!;
    await act(async () => spoilers.click());
    await flush();
    expect(dialog.querySelector('svg')!.textContent).toContain('Spoilers');
    // The page's own choice is untouched.
    expect(docs.stored['data/user/me/view']).toBeUndefined();
  });

  it('uploads a logo into the site default and refuses what is not an image', async () => {
    const docs = makeMockDocs({ 'data/site/main/index': index({ s5e1: stats() }) });
    const blobs = makeMockBlobs({ mimeTypes: ['application/zip', 'image/png', 'image/jpeg', 'image/webp'] });
    const view = await mount(<StatsPage ctx={ctxAt('', { docs, blobs })} />);
    await flush();
    await act(async () => buttons(view.host)[0].click());
    await flush();
    const dialog = view.host.querySelector('dialog.export')!;
    const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
    const pick = async (file: File) => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
      await flush();
      await flush();
    };
    await pick(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
    expect(dialog.textContent).toContain('Only PNG, JPEG or WebP');
    expect(blobs.uploads).toHaveLength(0);

    await pick(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 0])], 'logo.png', { type: 'image/png' }));
    expect(blobs.uploads).toHaveLength(1);
    const saved = docs.stored['data/site/main/export'] as { logo: { ref: string } };
    expect(saved.logo.ref).toBe(blobs.stored[0].ref);
    expect(dialog.querySelector('svg image')).not.toBeNull();
  });

  it('exports an episode from its page, linking back to it', async () => {
    const docs = makeMockDocs({
      'data/site/main/index': index({ s5e1: stats({ laughs: 3 }) }),
      'data/episode/s5e1/stats:podcast': stats({ laughs: 3 }),
    });
    const ctx = makeMockCtx({
      scope: { type: 'episode', id: 's5e1' },
      episodes: ['s5e1'],
      episodeLabels: labels,
      docs,
      user: { id: 'u1', role: 'podcaster', displayName: 'Pod', avatarUrl: '/x' },
    });
    const view = await mount(<EpisodeView ctx={ctx} />);
    await flush();
    await flush();
    expect(buttons(view.host).length).toBeGreaterThanOrEqual(2);
    await act(async () => buttons(view.host)[0].click());
    await flush();
    const svg = view.host.querySelector('dialog.export svg')!;
    expect(svg.getAttribute('aria-label')).toBe('Jaime I');
    expect(svg.textContent).toContain('/episodes/s5e1');
  });
});
