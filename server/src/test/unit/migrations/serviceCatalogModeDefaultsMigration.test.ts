import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('service catalog mode defaults migration', () => {
  const migration = readRepoFile('server/migrations/20260321110000_create_service_catalog_mode_defaults.cjs');

  it('T003: creates mode-default pricing table keyed by tenant+service+billing_mode+currency', () => {
    expect(migration).toContain("createTable('service_catalog_mode_defaults'");
    expect(migration).toContain("table.uuid('tenant').notNullable()");
    expect(migration).toContain("table.uuid('service_id').notNullable()");
    expect(migration).toContain("table.text('billing_mode').notNullable()");
    expect(migration).toContain("table.string('currency_code', 3).notNullable()");
    expect(migration).toContain("table.integer('rate').notNullable()");
    expect(migration).toContain("table.unique(");
    expect(migration).toContain("['tenant', 'service_id', 'billing_mode', 'currency_code']");
    expect(migration).toContain('service_catalog_mode_defaults_tenant_service_mode_currency_uq');
  });

  it('T003: constrains billing_mode to fixed|hourly|usage and enforces non-negative rates', () => {
    expect(migration).toContain("CHECK (billing_mode IN ('fixed', 'hourly', 'usage'))");
    expect(migration).toContain('CHECK (rate >= 0)');
  });
});
