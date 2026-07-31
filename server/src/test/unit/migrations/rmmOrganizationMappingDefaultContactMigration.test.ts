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
    expect(migration).toContain("alterTable('rmm_organization_mappings'");
    expect(migration).toContain("table.uuid('default_contact_id').nullable()");
  });

  it('T002: adds no database foreign key (deletion is handled in the backend for Citus)', () => {
    expect(migration).not.toContain("foreign(['tenant', 'default_contact_id'])");
    expect(migration).not.toContain("onDelete('SET NULL')");
  });

  it('T003: adds the tenant/default_contact_id lookup index', () => {
    expect(migration).toContain(
      "index(['tenant', 'default_contact_id'], 'idx_rmm_org_mappings_default_contact')",
    );
  });

  it('T004: down removes the index and column cleanly', () => {
    expect(migration).toContain(
      "dropIndex(['tenant', 'default_contact_id'], 'idx_rmm_org_mappings_default_contact')",
    );
    expect(migration).toContain("dropColumn('default_contact_id')");
  });
});
