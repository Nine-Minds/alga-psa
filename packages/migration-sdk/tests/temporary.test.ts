import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAmpTemporaryDirectory, sweepAmpTemporaryDirectories } from '../src/temporary';

const created: string[] = [];
afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('AMP temporary workspace cleanup', () => {
  it('removes abandoned workspaces older than 24 hours', () => {
    const abandoned = mkdtempSync(join(tmpdir(), `amp-package-${process.pid}-`));
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(abandoned, old, old);
    created.push(abandoned);

    const current = createAmpTemporaryDirectory('reader');
    created.push(current);
    expect(() => statSync(abandoned)).toThrow();
  });

  it('contains directory enumeration failures and still creates a private workspace', () => {
    expect(() => sweepAmpTemporaryDirectories(Date.now() + 2 * 60 * 60 * 1000, () => {
      throw new Error('temporary filesystem unavailable');
    })).not.toThrow();
    const current = createAmpTemporaryDirectory('package');
    created.push(current);
    expect(statSync(current).isDirectory()).toBe(true);
  });
});
