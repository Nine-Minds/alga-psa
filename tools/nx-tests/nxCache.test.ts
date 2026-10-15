import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const nxBin = path.resolve(process.cwd(), 'node_modules/.bin/nx');

async function runNx(args: string[], extraEnv: Record<string, string>) {
  const { stdout } = await execFileAsync(nxBin, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NX_DAEMON: 'false',
      NX_ISOLATE_PLUGINS: 'false',
      CI: 'true',
      PLAYWRIGHT_APP_PORT: process.env.PLAYWRIGHT_APP_PORT || '3300',
      PLAYWRIGHT_APP_PORT_LOCKED: 'true',
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

describe('nx caching', () => {
  it('reuses the local computation cache for repeated builds', { timeout: 180_000 }, async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-nx-cache-'));

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
  });

  it('caches @alga-psa/core builds when unchanged', { timeout: 180_000 }, async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-nx-cache-core-'));

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
  });
});
