import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('service-principals Turbopack entry alias', () => {
  it.each([
    ['community', 'oss'],
    ['enterprise', 'ee'],
  ])('resolves the %s edition to its source entry file', (edition, implementation) => {
    const expected = path.resolve(serverDir, `../packages/product-service-principals/${implementation}/entry.ts`);
    const script = `
      import config from './next.config.mjs';
      console.log(config.turbopack.resolveAlias['@product/service-principals/entry']);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: serverDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        EDITION: edition === 'enterprise' ? 'enterprise' : 'community',
        NEXT_PUBLIC_EDITION: edition,
      },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(expected);
  });
});
