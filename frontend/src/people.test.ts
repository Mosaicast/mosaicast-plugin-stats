// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { SERIES_DARK, SERIES_LIGHT, isDark } from './palette';
import { people, prettify } from './people';
import { index, stats } from './test/fixtures';

describe('people', () => {
  const idx = index({ e1: stats() });

  it('names speakers from the source and capitalises plain lower-case labels', () => {
    const who = people(null, idx, false);
    expect(who('alex-1').name).toBe('Alex');
    expect(prettify('sprecher_0')).toBe('sprecher_0');
  });

  it('gives each person a stable colour, whatever their rank', () => {
    const quiet = index({ e1: stats({ alex: 10, max: 900 }) });
    expect(people(null, quiet, false)('alex-1').color).toBe(SERIES_LIGHT[0]);
    expect(people(null, idx, false)('alex-1').color).toBe(SERIES_LIGHT[0]);
    expect(people(null, idx, false)('max-1').color).toBe(SERIES_LIGHT[1]);
  });

  it('follows the podcaster settings', () => {
    const who = people({ people: { 'max-1': { name: 'Maximilian', color: 0 } } }, idx, true);
    expect(who('max-1')).toMatchObject({ name: 'Maximilian', color: SERIES_DARK[0] });
    expect(who('alex-1').color).toBe(SERIES_DARK[1]);
  });

  it('tells dark themes from light ones', () => {
    expect(isDark({ bg: '#141210' } as never)).toBe(true);
    expect(isDark({ bg: '#fffaf6' } as never)).toBe(false);
    expect(isDark(undefined)).toBe(false);
  });
});
