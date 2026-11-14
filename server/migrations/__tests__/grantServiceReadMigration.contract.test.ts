import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// The service:read backfill was restamped from 20261113140000 to 20261113150000 because it
// collided with the resolver-membership migration (which must own its timestamp). The backfill is
// additive and idempotent, so a restamp is safe; these checks keep its self-references honest.
const MIGRATIONS_DIR = path.resolve(__dirname, '..');
const SUFFIX = '_grant_service_read_to_msp_roles.cjs';

const allMigrations = readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{14}_.*\.cjs$/.test(name));
const timestampOf = (name: string) => name.slice(0, 14);

describe('grant service:read to MSP roles migration', () => {
  const matches = allMigrations.filter((name) => name.endsWith(SUFFIX));

  it('exists exactly once', () => {
    expect(matches).toHaveLength(1);
  });

  it('owns its timestamp', () => {
    const [file] = matches;
    expect(allMigrations.filter((other) => timestampOf(other) === timestampOf(file))).toEqual([file]);
  });

  it('labels its tenant-enumeration scope with its own filename', () => {
    const [file] = matches;
    const source = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const label = source.match(/MIGRATION_TENANT = 'migration:([^']+)'/)?.[1];
    expect(`${label}.cjs`).toBe(file);
  });
});
