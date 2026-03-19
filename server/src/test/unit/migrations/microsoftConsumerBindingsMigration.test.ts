import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('microsoft profile consumer bindings migration', () => {
  const migration = readRepoFile('server/migrations/20260307143000_create_microsoft_profile_consumer_bindings.cjs');

  it('T073/T074: creates a tenant-scoped Microsoft consumer-binding model and drops it on rollback', () => {
    expect(migration).toContain("createTable('microsoft_profile_consumer_bindings'");
    expect(migration).toContain("table.uuid('tenant').notNullable()");
    expect(migration).toContain("table.text('consumer_type').notNullable()");
    expect(migration).toContain("table.uuid('profile_id').notNullable()");
    expect(migration).toContain("table.uuid('created_by')");
    expect(migration).toContain("table.uuid('updated_by')");
    expect(migration).toContain("table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())");
    expect(migration).toContain("table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())");
    expect(migration).toContain("await knex.schema.dropTableIfExists('microsoft_profile_consumer_bindings');");
  });

  it('T075/T076: constrains supported consumer types to MSP SSO, email, calendar, and Teams', () => {
    expect(migration).toContain('microsoft_profile_consumer_bindings_consumer_type_check');
    expect(migration).toContain("CHECK (consumer_type IN ('msp_sso', 'email', 'calendar', 'teams'))");
  });

  it('T077/T078: enforces one binding per tenant consumer and references tenant-scoped Microsoft profiles', () => {
    expect(migration).toContain("table.primary(['tenant', 'consumer_type'])");
    expect(migration).toContain(".foreign(['tenant', 'profile_id'])");
    expect(migration).toContain(".references(['tenant', 'profile_id'])");
    expect(migration).toContain(".inTable('microsoft_profiles')");
    expect(migration).toContain('microsoft_profile_consumer_bindings_tenant_profile_idx');
    expect(migration).toContain('ON microsoft_profile_consumer_bindings (tenant, profile_id);');
  });
});
