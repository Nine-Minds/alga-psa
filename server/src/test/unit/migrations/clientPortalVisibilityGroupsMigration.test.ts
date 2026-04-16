import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
  __dirname,
  '../../../../migrations/20260315110000_create_client_portal_visibility_groups.cjs'
);

const migration = fs.readFileSync(migrationPath, 'utf8');

describe('client portal visibility groups migration', () => {
  it('T001: creates the per-client visibility groups table with tenant and client ownership fields', () => {
    expect(migration).toContain("createTable('client_portal_visibility_groups'");
    expect(migration).toContain("table.uuid('tenant').notNullable()");
    expect(migration).toContain("table.uuid('client_id').notNullable()");
    expect(migration).toContain("table.primary(['tenant', 'group_id'])");
    expect(migration).toContain("table.unique(['tenant', 'client_id', 'name'])");
  });

  it('T002: creates the group-to-board membership table with tenant-scoped references', () => {
    expect(migration).toContain("createTable('client_portal_visibility_group_boards'");
    expect(migration).toContain("table.uuid('tenant').notNullable()");
    expect(migration).toContain("table.uuid('group_id').notNullable()");
    expect(migration).toContain("table.uuid('board_id').notNullable()");
    expect(migration).toContain("table.primary(['tenant', 'group_id', 'board_id'])");
    expect(migration).toContain("references(['tenant', 'group_id']).inTable('client_portal_visibility_groups')");
  });

  it('T003: adds the nullable contact assignment field with unrestricted NULL semantics', () => {
    expect(migration).toContain("table.uuid('portal_visibility_group_id');");
    expect(migration).toContain('REFERENCES client_portal_visibility_groups (tenant, group_id)');
    expect(migration).not.toContain("table.uuid('portal_visibility_group_id').notNullable()");
  });

  it('T004: leaves existing contacts unrestricted by default with no assignment backfill', () => {
    expect(migration).not.toContain("update({ portal_visibility_group_id:");
    expect(migration).not.toContain("alter column portal_visibility_group_id set not null");
    expect(migration).toContain("if (!hasContactColumn) {");
  });
});
