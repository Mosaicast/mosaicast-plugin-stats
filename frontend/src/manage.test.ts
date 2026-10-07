// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { makeMockBlobs, makeMockCtx } from '@mosaicast/plugin-sdk/testing';
import { describe, expect, it } from 'vitest';
import { retryAfter, uploadArchive } from './manage';

const zip = () => new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'ep.zip', { type: 'application/zip' });

function limited(times: number) {
  const blobs = makeMockBlobs({ mimeTypes: ['application/zip'] });
  const upload = blobs.upload.bind(blobs);
  let left = times;
  blobs.upload = (file: File) => {
    if (left-- > 0) {
      return Promise.reject(Object.assign(new Error('429'), {
        status: 429, problem: { detail: 'Too many requests. Try again in 42 seconds.' },
      }));
    }
    return upload(file);
  };
  return blobs;
}

describe('uploading', () => {
  it('waits out the upload limit and carries on', async () => {
    const ctx = makeMockCtx({ blobs: limited(2) });
    const pauses: number[] = [];
    const slept: number[] = [];
    const result = await uploadArchive(ctx, zip(), null, '', String, (s) => pauses.push(s), async (ms) => { slept.push(ms); });
    expect(result.state).toBe('queued');
    expect(pauses).toEqual([43, 43]);
    expect(slept).toEqual([43_000, 43_000]);
  });

  it('gives up after a few rounds', async () => {
    const ctx = makeMockCtx({ blobs: limited(99) });
    const result = await uploadArchive(ctx, zip(), null, '', String, undefined, async () => {});
    expect(result).toEqual({ state: 'failed', reason: 'upload.rateLimited' });
  });

  it('reads the wait from the refusal', () => {
    expect(retryAfter('Too many requests. Try again in 17 seconds.')).toBe(18);
    expect(retryAfter(undefined)).toBe(60);
    expect(retryAfter('Try again in 9999 seconds.')).toBe(121);
  });
});
