// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { PLATFORM_API_VERSION } from '@mosaicast/plugin-sdk';
import { describe, expect, it } from 'vitest';
import manifest from '../../plugin.json';

const covered = (key: string) =>
  manifest.data.backendOwned.some((p) => (p === '*' ? true : p.endsWith('*') ? key.startsWith(p.slice(0, -1)) : key === p));

describe('plugin.json', () => {
  it('declares the SDK it was built against', () => {
    expect(manifest.platformApi).toBe(PLATFORM_API_VERSION);
  });

  it('reserves what the backend computes', () => {
    for (const key of ['stats:main', 'stats:spoiler', 'index', 'readers', 'import:abc', 'staged:abc']) expect(covered(key)).toBe(true);
  });

  it('reserves nothing the admin page writes', () => {
    for (const key of ['cmd:123', 'speakers', 'bundles']) expect(covered(key)).toBe(false);
  });

  it('keeps bookkeeping from visitors and bundle settings with admins', () => {
    // Import records and the queue can name an episode that is still a quiet plan.
    expect(manifest.data.keyFloors).toEqual([
      { keys: ['import:*', 'staged:*', 'cmd:*'], readableBy: 'podcaster' },
      { keys: ['bundles'], writableBy: 'admin' },
    ]);
  });

  it('asks for ZIP storage and nothing unstorable', () => {
    expect(manifest.blobs.mimeTypes).toEqual(['application/zip']);
    expect(manifest.blobs.mimeTypes).not.toContain('image/svg+xml');
  });

  it('keeps the uploaded archives away from visitors', () => {
    // The stats are public; the archives behind them hold full transcripts and local file paths.
    expect(manifest.data.readableBy).toBe('anonymous');
    expect(manifest.blobs.readableBy).toBe('podcaster');
  });

  it('only mounts elements the bundle defines, and has a page for its nav', () => {
    for (const slot of manifest.slots) expect(manifest.frontend.elements).toContain(slot.element);
    expect(manifest.slots.some((s) => s.scope === 'site' && s.placement === 'page')).toBe(true);
    for (const n of manifest.nav) expect(n).not.toHaveProperty('role');
  });

  it('declares what it keeps on the device: a session-only view setting', () => {
    const items = manifest.consent.services.flatMap((x) => x.storage.map((i) => ({ ...i, category: x.category, hosts: x.hosts })));
    expect(items).toEqual([expect.objectContaining({ name: 'mc.stats.view', type: 'sessionStorage', duration: 'session', category: 'necessary', hosts: [] })]);
  });

  it('keeps the queue interval above zero', () => {
    expect(manifest.config.queueIntervalSeconds.min).toBeGreaterThanOrEqual(10);
  });
});
