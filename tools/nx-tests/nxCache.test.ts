import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runNx } from './nxTestUtils';

describe('nx caching', () => {
  it('reuses the local computation cache for repeated builds', { timeout: 180_000 }, async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-nx-cache-'));
    try {
      const first = await runNx(['build', '@alga-psa/types'], {
        NX_CACHE_DIRECTORY: cacheDir,
      });
      expect(first).toContain('Successfully ran target');

      const second = await runNx(['build', '@alga-psa/types'], {
        NX_CACHE_DIRECTORY: cacheDir,
      });

      expect(
        second.includes('read from cache') || second.includes('local cache'),
        `Expected cache hit. Output:\n${second}`,
      ).toBe(true);
    } finally {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('caches @alga-psa/core builds when unchanged', { timeout: 180_000 }, async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-nx-cache-core-'));
    try {
      const first = await runNx(['build', '@alga-psa/core'], {
        NX_CACHE_DIRECTORY: cacheDir,
      });
      expect(first).toContain('Successfully ran target');

      const second = await runNx(['build', '@alga-psa/core'], {
        NX_CACHE_DIRECTORY: cacheDir,
      });

      expect(
        second.includes('read from cache') || second.includes('local cache'),
        `Expected cache hit. Output:\n${second}`,
      ).toBe(true);
    } finally {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
