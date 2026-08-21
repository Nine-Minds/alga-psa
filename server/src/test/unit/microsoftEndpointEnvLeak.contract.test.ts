import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Microsoft OAuth suites assert the production authority
 * (https://login.microsoftonline.com). Nothing in them sets an override — but
 * server/knexfile.cjs opens with require('dotenv').config(), so the first
 * suite that reaches it (the search-backfill script, for one) dumps the
 * developer's whole server/.env into the shared fork. A developer running the
 * Graph emulator has MICROSOFT_LOGIN_BASE_URL pointed at it, and from that
 * file onward every authority assertion reads the emulator instead — a roving,
 * seed-dependent failure that never reproduces in isolation.
 *
 * src/test/setup.ts already restores a list of guarded vars to the fork
 * baseline when a file finishes. This contract keeps every env override the
 * endpoint helper honors on that list, so adding a new MICROSOFT_*_BASE_URL
 * escape hatch fails here instead of in someone's next shuffled run.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SETUP_FILE = path.join(REPO_ROOT, 'server/src/test/setup.ts');
const ENDPOINTS_FILE = path.join(REPO_ROOT, 'shared/services/email/microsoftGraphEndpoints.ts');

function guardedEnvVars(): string[] {
  const source = fs.readFileSync(SETUP_FILE, 'utf8');
  const block = source.match(/const GUARDED_ENV_VARS = \[([\s\S]*?)\] as const;/);
  expect(block, 'GUARDED_ENV_VARS array not found in src/test/setup.ts').toBeTruthy();
  return [...block![1].matchAll(/'([A-Z0-9_]+)'/g)].map((match) => match[1]);
}

function envOverridesReadByEndpointHelper(): string[] {
  const source = fs.readFileSync(ENDPOINTS_FILE, 'utf8');
  return [...new Set([...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]))];
}

describe('Microsoft endpoint env leak guard', () => {
  it('keeps every Microsoft base-URL override on the fork-restored guard list', () => {
    const guarded = guardedEnvVars();
    const overrides = envOverridesReadByEndpointHelper();

    expect(overrides.length).toBeGreaterThan(0);
    expect(overrides.filter((name) => !guarded.includes(name))).toEqual([]);
  });
});
