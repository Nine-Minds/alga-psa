import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readMigration(fileName: string): string {
  return fs.readFileSync(path.join(repoRoot, 'server', 'migrations', fileName), 'utf8');
}

describe('rmm organization mapping default contact migration', () => {
  const migration = readMigration('20260619120000_add_default_contact_to_rmm_org_mappings.cjs');

  it('T001: adds a nullable default_contact_id column to rmm_organization_mappings', () => {
    expect(migration).toContain("const TABLE = 'rmm_organization_mappings'");
    expect(migration).toContain("const COLUMN = 'default_contact_id'");
    expect(migration).toContain('table.uuid(COLUMN).nullable()');
  });

  it('T002: adds a tenant-scoped contact FK with delete unlinking for only default_contact_id', () => {
    expect(migration).toContain('ADD CONSTRAINT ${FK}');
    expect(migration).toContain('FOREIGN KEY (tenant, ${COLUMN})');
    expect(migration).toContain('REFERENCES contacts (tenant, contact_name_id)');
    expect(migration).toContain('ON DELETE SET NULL (${COLUMN})');
  });

  it('T003: adds the tenant/default_contact_id lookup index', () => {
    expect(migration).toContain("const INDEX = 'idx_rmm_org_mappings_default_contact'");
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS ${INDEX}');
    expect(migration).toContain('ON ${TABLE} (tenant, ${COLUMN})');
  });

  it('T004: down removes the FK, index, and column cleanly', () => {
    expect(migration).toContain('ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${FK}');
    expect(migration).toContain('DROP INDEX IF EXISTS ${INDEX}');
    expect(migration).toContain('table.dropColumn(COLUMN)');
  });

  it('T005: is safe to round-trip and keeps column/index when a post-hoc FK is rejected', () => {
    expect(migration).toContain('exports.config = { transaction: false }');
    expect(migration).toContain('await knex.schema.hasColumn(TABLE, COLUMN)');
    expect(migration).toContain('if (!hasColumn)');
    expect(migration).toContain('try {');
    expect(migration).toContain('} catch (error) {');
    expect(migration).toContain('continuing with column and index only');
  });
});
