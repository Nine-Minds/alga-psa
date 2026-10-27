import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// createTestDbConnection hands every file a freshly migrated database (cloned
// from a schema template). A suite that then drops and re-migrates `public`
// takes one lock per schema object in a single transaction — 12k+ for the full
// schema — which overflows PostgreSQL's shared lock table on CI and fails the
// whole file with "out of shared memory". Suites must use the connection
// options (e.g. `runSeeds: false`) instead of resetting the schema themselves.
const thisFile = fileURLToPath(import.meta.url);
const testRoot = path.resolve(path.dirname(thisFile), '..');
const PUBLIC_SCHEMA_DROP = /DROP\s+SCHEMA\s+(IF\s+EXISTS\s+)?"?public"?\s+CASCADE/i;

function listTestSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listTestSources(full);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [full] : [];
  });
}

describe('test database reset', () => {
  it('no test suite drops the public schema of the shared suite database', () => {
    const offenders = listTestSources(testRoot)
      .filter((file) => file !== thisFile)
      .filter((file) => PUBLIC_SCHEMA_DROP.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(testRoot, file));
    expect(offenders).toEqual([]);
  });
});
