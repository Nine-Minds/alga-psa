import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('telephony call intents migration', () => {
  const migration = read('server/migrations/20260826160000_create_telephony_call_intents.cjs');

  it('creates a tenant-distributed, tenant-keyed intent table', () => {
    expect(migration).toContain("const TABLE_NAME = 'telephony_call_intents'");
    expect(migration).toContain("table.primary(['tenant', 'intent_id'])");
    expect(migration).toContain('ensureTenantDistribution(knex, TABLE_NAME)');
    expect(migration).toContain('FOREIGN KEY (tenant) REFERENCES tenants(tenant)');
    expect(migration).toContain('exports.config = { transaction: false }');
  });

  it('indexes only pending intents by tenant, provider, and normalized number', () => {
    expect(migration).toContain('(tenant, provider, phone_number_e164, created_at DESC)');
    expect(migration).toContain("WHERE status = 'pending'");
    expect(migration).toContain("CHECK (status IN ('pending', 'matched', 'expired', 'cancelled'))");
  });

  it('registers the table with runtime and migration tenant metadata and tenant deletion', () => {
    expect(read('packages/db/src/lib/tenantTableMetadata.ts'))
      .toContain("telephony_call_intents: { scope: 'tenant' }");
    expect(read('server/migrations/utils/tenantDb.cjs'))
      .toContain("telephony_call_intents: { scope: 'tenant' }");
    expect(read('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts'))
      .toContain("'telephony_call_artifacts', 'telephony_call_intents', 'telephony_call_records'");
  });
});
