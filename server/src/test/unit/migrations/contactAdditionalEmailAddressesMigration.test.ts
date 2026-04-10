import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('contact additional email addresses migrations', () => {
  const migration = readRepoFile('server/migrations/20260315120000_create_contact_additional_email_addresses_schema.cjs');

  it('T002: creates email label definitions with tenant-scoped normalized label uniqueness', () => {
    expect(migration).toContain("createTable('contact_email_type_definitions'");
    expect(migration).toContain("table.text('normalized_label').notNullable()");
    expect(migration).toContain("table.unique(['tenant', 'normalized_label'])");
    expect(migration).toContain('chk_contact_email_type_definitions_normalized_label');
  });

  it('T002: creates contact_additional_email_addresses table with canonical/custom type columns and display order', () => {
    expect(migration).toContain("createTable('contact_additional_email_addresses'");
    expect(migration).toContain("table.text('email_address').notNullable()");
    expect(migration).toContain("table.text('canonical_type').nullable()");
    expect(migration).toContain("table.uuid('custom_email_type_id').nullable()");
    expect(migration).toContain("table.integer('display_order').notNullable().defaultTo(0)");
  });

  it('T002: adds normalized email generation for case-insensitive matching', () => {
    expect(migration).toContain('normalized_email_address text');
    expect(migration).toContain('GENERATED ALWAYS AS');
    expect(migration).toContain("normalizedEmailSql('email_address')");
  });

  it('T002: enforces valid canonical/custom type source for additional emails', () => {
    expect(migration).toContain('chk_contact_additional_email_addresses_canonical_type');
    expect(migration).toContain('chk_contact_additional_email_addresses_type_source');
    expect(migration).toContain('canonical_type IN');
    expect(migration).toContain("custom_email_type_id IS NOT NULL");
  });

  it('T006: enforces tenant scoped additional-email uniqueness in schema', () => {
    expect(migration).toContain('ux_contact_additional_email_addresses_tenant_normalized_email');
    expect(migration).toContain('(tenant, normalized_email_address)');
  });

  it('T006: builds cross-table uniqueness checks via triggers', () => {
    expect(migration).toContain('check_contact_primary_email_uniqueness');
    expect(migration).toContain('check_contact_additional_email_uniqueness');
    expect(migration).toContain('LOWER(BTRIM(c.email)) = LOWER(BTRIM(NEW.email_address))');
    expect(migration).toContain('cea.normalized_email_address = normalized_primary');
  });

  it('T001: seeds a safe default primary-email label for pre-existing contacts', () => {
    expect(migration).toContain("primary_email_canonical_type = 'work'");
    expect(migration).toContain('WHERE email IS NOT NULL');
  });
});
