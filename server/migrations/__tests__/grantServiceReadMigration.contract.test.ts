import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// This backfill shipped on main as 20261113140000_grant_service_read_to_msp_roles.cjs. Deployed
// databases record that exact name in knex_migrations, so renaming or restamping the file makes
// knex reject the directory as corrupt ("the following files are missing") on every upgrade.
const MIGRATIONS_DIR = path.resolve(__dirname, '..');
const SHIPPED_NAME = '20261113140000_grant_service_read_to_msp_roles.cjs';
const SUFFIX = '_grant_service_read_to_msp_roles.cjs';

const allMigrations = readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{14}_.*\.cjs$/.test(name));

describe('grant service:read to MSP roles migration', () => {
  it('keeps the filename it shipped under', () => {
    expect(allMigrations.filter((name) => name.endsWith(SUFFIX))).toEqual([SHIPPED_NAME]);
  });

  it('labels its tenant-enumeration scope with its own filename', () => {
    const source = readFileSync(path.join(MIGRATIONS_DIR, SHIPPED_NAME), 'utf8');
    const label = source.match(/MIGRATION_TENANT = 'migration:([^']+)'/)?.[1];
    expect(`${label}.cjs`).toBe(SHIPPED_NAME);
  });
});
