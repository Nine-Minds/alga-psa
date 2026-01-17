import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const nxBin = path.resolve(process.cwd(), 'node_modules/.bin/nx');

function runNx(args: string[], extraEnv: Record<string, string>) {
  return execFileSync(nxBin, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NX_DAEMON: 'false',
      CI: 'true',
      ...extraEnv,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('nx caching', () => {
  it('reuses the local computation cache for repeated builds', { timeout: 180_000 }, () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-nx-cache-'));

    const first = runNx(['build', '@alga-psa/types'], {
      NX_CACHE_DIRECTORY: cacheDir,
    });
    expect(first).toContain('Successfully ran target');

    const second = runNx(['build', '@alga-psa/types'], {
      NX_CACHE_DIRECTORY: cacheDir,
    });

    expect(
      second.includes('read from cache') || second.includes('local cache'),
      `Expected cache hit. Output:\n${second}`,
    ).toBe(true);
  });

  it('caches @alga-psa/core builds when unchanged', { timeout: 180_000 }, () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-nx-cache-core-'));

    const first = runNx(['build', '@alga-psa/core'], {
      NX_CACHE_DIRECTORY: cacheDir,
    });
    expect(first).toContain('Successfully ran target');

    const second = runNx(['build', '@alga-psa/core'], {
      NX_CACHE_DIRECTORY: cacheDir,
    });

    expect(
      second.includes('read from cache') || second.includes('local cache'),
      `Expected cache hit. Output:\n${second}`,
    ).toBe(true);
  });
});
