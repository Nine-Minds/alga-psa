import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../migrations/20260321150000_add_system_managed_default_contract_marker.cjs',
);

describe('system-managed default-contract marker migration contract', () => {
  it('T015: migration is idempotent and guarded for already-migrated schemas', () => {
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain("hasTable('contracts')");
    expect(migration).toContain("if (!await hasColumn(knex, 'contracts', DEFAULT_MARKER_COLUMN))");
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(migration).toContain('DROP INDEX IF EXISTS');
  });
});
