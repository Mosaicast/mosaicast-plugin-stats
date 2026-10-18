// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { createPluginI18n } from '@mosaicast/plugin-sdk';
import { describe, expect, it } from 'vitest';
import type { Basics } from '../components/common';
import { CATALOGS } from '../i18n';
import { people } from '../people';
import { bookSummary, index, mount, stats } from '../test/fixtures';
import { bookOf } from '../book';
import { contrast, mix, pageDesign, presetColors, sanitizeDesign, toHex } from './design';
import { FORMATS } from './formats';
import { Frame } from './frame';
import { ITEMS, optionValues, type ExportArea, type ExportData } from './items';
import { makeKit, niceTicks } from './kit';
import { fit, wrap } from './measure';
import { sniffImage } from './preset';
import { displayUrl, fileName, qrModules } from './render';

function basics(lang = 'en'): Basics {
  const i18n = createPluginI18n(CATALOGS, { current: () => lang, onChange: () => () => {} });
  const t = i18n.t.bind(i18n);
  return {
    t,
    plural: i18n.plural.bind(i18n),
    bytes: i18n.bytes.bind(i18n),
    locale: i18n.locale,
    who: people(null, idx, false),
    bundles: [],
    bundleName: (x) => x.name ?? x.id,
  };
}

const book = (chapters: Parameters<typeof bookSummary>[0], names: string[]) => ({ ...bookSummary(chapters, names), title: 'A Feast for Crows', book: 'feast' });
const idx = index(
  { s5e2: stats({ laughs: 2 }), s5e1: stats({ alex: 300, max: 700, laughs: 5 }), s4e1: stats({ durationSeconds: 3000 }) },
  {
    books: {
      s5e2: { book: book([{ heading: 'Jaime II', words: 4000, sentences: 250, id: 'c2', index: 2, group: 'Jaime' }, { heading: 'Cersei I', words: 3000, sentences: 200, id: 'c3', index: 3, group: 'Cersei' }], ['Jaime', 'Brienne']) },
      s5e1: { book: book([{ heading: 'Jaime I', words: 5000, sentences: 300, id: 'c1', index: 1, group: 'Jaime' }, { heading: 'Cersei II', words: 3500, sentences: 220, id: 'c4', index: 4, group: 'Cersei' }], ['Jaime', 'Cersei']) },
    },
  },
);
const slugs = ['s5e2', 's5e1', 's4e1'];
const labels = { s5e2: 'S05E02 · Catelyn I', s5e1: 'S05E01 · Jaime I', s4e1: 'S04E01 · Tyrion I' };

function data(area: ExportArea, over: Partial<ExportData> = {}): ExportData {
  const podcasts = Object.fromEntries(Object.entries(idx.episodes).map(([slug, x]) => [slug, x.podcast]));
  const books = Object.fromEntries(Object.entries(idx.books).map(([slug, x]) => [slug, x.book]));
  return {
    area, slugs, podcasts, books, labels, b: basics(), scopeLabel: 'All seasons',
    seasonOf: (slug) => (slug.startsWith('s5') ? 5 : 4),
    slug: area === 'episode' ? 's5e1' : null,
    ...over,
  };
}

describe('export design', () => {
  it('reads colours the theme may hand over in any common notation', () => {
    expect(toHex('#ABC', '#000000')).toBe('#aabbcc');
    expect(toHex('rgb(255, 0, 10)', '#000000')).toBe('#ff000a');
    expect(toHex('#11223344', '#000000')).toBe('#112233');
    expect(toHex('var(--x)', '#123456')).toBe('#123456');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('keeps only valid values from a stored default', () => {
    const base = pageDesign(undefined, 'example.org');
    const out = sanitizeDesign({ bg: 'red', text: '#ABCDEF', font: 'comic', scale: 9, background: 'dots', showQr: 'yes', brand: 'x'.repeat(200) }, base);
    expect(out.bg).toBe(base.bg);
    expect(out.text).toBe('#abcdef');
    expect(out.font).toBe(base.font);
    expect(out.scale).toBe(1.35);
    expect(out.background).toBe('dots');
    expect(out.showQr).toBe(base.showQr);
    expect(out.brand).toHaveLength(80);
    expect(sanitizeDesign(null, base)).toBe(base);
  });

  it('puts readable text on the accent preset, whatever the accent', () => {
    for (const accent of ['#ffee58', '#1a237e', '#2a78d6']) {
      const c = presetColors('accent', { bg: '#ffffff', surface: '#ffffff', text: '#111111', textMuted: '#666666', accent, accentContrast: '#ffffff', border: '#dddddd' });
      expect(contrast(c.text, c.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('export helpers', () => {
  it('wraps and shortens text to a width', () => {
    const font = { size: 10, family: 'sans-serif' };
    const lines = wrap('one two three four five six seven eight nine ten', 60, font, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(fit('short', 1000, font)).toBe('short');
    expect(fit('a very long label indeed', 50, font).endsWith('…')).toBe(true);
  });

  it('names files and links plainly', () => {
    expect(fileName('stats', 'podcast-summary', 'Staffel 5 · Bücher', 'story')).toBe('stats-podcast-summary-staffel-5-bucher-story');
    expect(displayUrl('https://example.org/p/stats/')).toBe('example.org/p/stats');
  });

  it('encodes the link as a QR code', () => {
    const m = qrModules('https://example.org/p/stats/season/5');
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
  });

  it('draws round grid values', () => {
    expect(niceTicks(73)).toEqual([0, 20, 40, 60, 80]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });

  it('only takes PNG, JPEG and WebP as a logo', () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(new Uint8Array([...'<svg'].map((c) => c.charCodeAt(0))))).toBeNull();
  });
});

describe('export items', () => {
  const areas: ExportArea[] = ['podcast', 'book', 'episode'];
  for (const area of areas) {
    for (const item of ITEMS.filter((x) => x.area === area)) {
      it(`${item.id} draws in every format`, async () => {
        const d = data(area);
        const opts = optionValues(item, d, {});
        const model = item.build(d, opts);
        expect(model, 'has something to show for the fixture').not.toBeNull();
        const headline = item.headline(model, d, opts);
        expect(headline.length).toBeGreaterThan(0);
        expect(d.b.t(item.label)).not.toBe(item.label);
        for (const o of item.options?.(d) ?? []) expect(d.b.t(o.label)).not.toBe(o.label);
        for (const format of FORMATS) {
          const k = makeKit(pageDesign(undefined, 'example.org'), Math.min(format.width, format.height), d.b);
          const view = await mount(
            <Frame format={format} k={k} logo={null} url="https://example.org/p/stats" label={headline}
              texts={{ headline, subline: item.subline?.(model, d, opts) ?? d.scopeLabel, linkLabel: 'More stats' }}>
              {(box) => item.draw(model, box, k, opts)}
            </Frame>,
          );
          const svg = view.host.querySelector('svg')!;
          expect(svg.getAttribute('width')).toBe(String(format.width));
          expect(view.text()).toContain('example.org/p/stats');
          // Nothing drawn outside the image or with a broken number.
          expect(view.host.innerHTML).not.toMatch(/NaN|Infinity|undefined/);
          await view.unmount();
        }
      });
    }
  }

  it('has nothing to show without stats', () => {
    const empty = data('podcast', { podcasts: {}, books: {} });
    for (const item of ITEMS) expect(item.build(empty, optionValues(item, empty, {}))).toBeNull();
  });

  it('every option of every item draws', async () => {
    for (const area of areas) {
      const d = data(area);
      for (const item of ITEMS.filter((x) => x.area === area)) {
        for (const o of item.options?.(d) ?? []) {
          for (const c of o.choices) {
            const opts = optionValues(item, d, { [o.id]: c.value });
            const model = item.build(d, opts);
            if (model == null) continue;
            const k = makeKit(pageDesign(undefined, 'x'), 1080, d.b);
            const view = await mount(
              <Frame format={FORMATS[0]} k={k} logo={null} url="https://x/p/stats" label="x" texts={{ headline: 'x', subline: 'y', linkLabel: 'z' }}>
                {(box) => item.draw(model, box, k, opts)}
              </Frame>,
            );
            expect(view.host.innerHTML, `${item.id} ${o.id}=${c.value}`).not.toMatch(/NaN|Infinity/);
            await view.unmount();
          }
        }
      }
    }
  });

  it('narrows book exports to one book and one chapter group', () => {
    const item = ITEMS.find((x) => x.id === 'book.summary')!;
    const d = data('book', { only: bookOf(idx.books.s5e1.book) });
    const opts = optionValues(item, d, { group: 'jaime' });
    expect(opts.group).toBe('jaime');
    const model = item.build(d, opts) as { tiles: { label: string; value: string }[] };
    expect(model.tiles.find((t) => t.label === 'Chapters')?.value).toBe('2');
    expect(item.headline(model, d, opts)).toBe('Jaime chapters');
  });

  it('speaks the image language, not the page language', () => {
    const item = ITEMS.find((x) => x.id === 'podcast.speakers')!;
    const d = data('podcast', { b: basics('de') });
    expect(item.headline(item.build(d, {}), d, {})).toBe('Wer redet am meisten?');
  });
});
