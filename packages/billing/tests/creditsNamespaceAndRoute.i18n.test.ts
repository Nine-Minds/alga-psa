// @vitest-environment node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

describe('MSP credits namespace and route i18n contract', () => {
  it('T001: lang-pack validation passes for credits namespace across production and pseudo locales', () => {
    const output = execSync(
      'node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs',
      {
        cwd: path.resolve(__dirname, '../../..'),
        encoding: 'utf8',
      },
    );

    expect(output).toContain('PASSED');
    expect(output).toContain('Errors: 0');
    expect(output).toContain('Warnings: 0');
  });

  it('T002: english credits namespace exposes the planned top-level groups', () => {
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/credits.json',
    );

    expect(Object.keys(en)).toEqual([
      'page',
      'columns',
      'status',
      'actions',
      'tabs',
      'settings',
      'charts',
      'stats',
      'management',
      'reconciliation',
      'application',
      'expiration',
      'expirationDialog',
      'context',
    ]);
  });
});
