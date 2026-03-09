import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('contact phone number migrations', () => {
  const migration = readRepoFile('server/migrations/20260309120000_create_contact_phone_numbers_schema.cjs');

  it('T001: creates tenant-scoped custom phone type definitions with normalized-label uniqueness', () => {
    expect(migration).toContain("createTable('contact_phone_type_definitions'");
    expect(migration).toContain("table.text('normalized_label').notNullable()");
    expect(migration).toContain("table.unique(['tenant', 'normalized_label'])");
    expect(migration).toContain('CHECK (normalized_label = LOWER(BTRIM(normalized_label)))');
  });

  it('T002: creates contact_phone_numbers with exactly one type source per row', () => {
    expect(migration).toContain("createTable('contact_phone_numbers'");
    expect(migration).toContain("table.text('canonical_type').nullable()");
    expect(migration).toContain("table.uuid('custom_phone_type_id').nullable()");
    expect(migration).toContain('ADD CONSTRAINT chk_contact_phone_numbers_type_source');
    expect(migration).toContain('canonical_type IS NOT NULL');
    expect(migration).toContain('custom_phone_type_id IS NOT NULL');
  });

  it('T003: enforces at most one default phone row per contact', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS ux_contact_phone_numbers_default_per_contact');
    expect(migration).toContain('ON contact_phone_numbers (tenant, contact_name_id)');
    expect(migration).toContain('WHERE is_default = true');
  });

  it('T004: backfills scalar contact phone numbers as default work phone rows', () => {
    expect(migration).toContain('INSERT INTO contact_phone_numbers');
    expect(migration).toContain('FROM contacts');
    expect(migration).toContain("'work'");
    expect(migration).toContain('true,');
    expect(migration).toContain('0,');
  });

  it('T005: skips backfill for null or empty scalar phone values', () => {
    expect(migration).toContain('WHERE phone_number IS NOT NULL');
    expect(migration).toContain("AND BTRIM(phone_number) <> ''");
  });
});
