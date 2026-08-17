/**
 * Migration coverage for the inbound auth-failure tracking columns:
 * applies the migration to the test database (up is idempotent) and inspects
 * runtime column/default behavior, including the widened pause-reason CHECK
 * constraint that admits 'auth_failure'.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createRequire } from 'node:module';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';

const describeDb = await describeWithDb();

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20260815120000_add_inbound_auth_failure_tracking_to_email_providers.cjs');

let testDb: Knex;
let testTenant: string;

function tenantTable<Row = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'auth-failure migration test fixture creates and removes tenant rows'
  );
}

async function columnNames(): Promise<Set<string>> {
  const rows = await testDb('information_schema.columns').where('table_name', 'email_providers').pluck('column_name');
  return new Set(rows);
}

describeDb('inbound auth-failure tracking migration (DB-backed)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    testDb = await createTestDbConnection();
    testTenant = uuidv4();
    await tenantFixtureTable().insert({
      tenant: testTenant,
      client_name: 'Migration Test Client',
      email: 'migration@client.com',
      created_at: new Date(),
      updated_at: new Date(),
    });
  }, 180_000);

  afterAll(async () => {
    if (testTenant) {
      await tenantTable('email_providers').delete();
      await tenantFixtureTable().where('tenant', testTenant).delete();
    }
    await testDb?.destroy().catch(() => undefined);
  }, 30_000);

  it('is already applied by the test-database bootstrap and is idempotent', async () => {
    const before = await columnNames();
    expect(before).toContain('inbound_auth_failure_count');
    expect(before).toContain('inbound_auth_failure_last_at');
    expect(before).toContain('inbound_auth_failure_code');

    // Re-running up must be a no-op (hasColumn-guarded alters).
    await migration.up(testDb);
    const after = await columnNames();
    expect(after).toEqual(before);
  });

  it('defaults inbound_auth_failure_count to 0 for new rows without an explicit value', async () => {
    const providerId = uuidv4();
    const now = new Date();
    await tenantTable('email_providers').insert({
      id: providerId,
      tenant: testTenant,
      provider_type: 'imap',
      provider_name: 'Migration Provider',
      mailbox: `migration-${providerId.slice(0, 8)}@example.com`,
      is_active: true,
      status: 'connected',
      created_at: now,
      updated_at: now,
    });

    const row = await tenantTable('email_providers').where({ id: providerId }).first(
      'inbound_auth_failure_count',
      'inbound_auth_failure_last_at',
      'inbound_auth_failure_code'
    );
    expect(Number(row.inbound_auth_failure_count)).toBe(0);
    expect(row.inbound_auth_failure_last_at).toBeNull();
    expect(row.inbound_auth_failure_code).toBeNull();
  });

  it("admits 'auth_failure' through the widened pause-reason CHECK constraint", async () => {
    const providerId = uuidv4();
    const now = new Date();
    await tenantTable('email_providers').insert({
      id: providerId,
      tenant: testTenant,
      provider_type: 'imap',
      provider_name: 'Constraint Provider',
      mailbox: `constraint-${providerId.slice(0, 8)}@example.com`,
      is_active: true,
      status: 'error',
      inbound_paused_at: now,
      inbound_pause_reason: 'auth_failure',
      created_at: now,
      updated_at: now,
    });

    const row = await tenantTable('email_providers').where({ id: providerId }).first('inbound_pause_reason');
    expect(row.inbound_pause_reason).toBe('auth_failure');

    // Manual reasons remain valid after the constraint swap.
    await tenantTable('email_providers').where({ id: providerId }).update({
      inbound_pause_reason: 'manual',
    });
    const manualRow = await tenantTable('email_providers').where({ id: providerId }).first('inbound_pause_reason');
    expect(manualRow.inbound_pause_reason).toBe('manual');
  });

  it('down restores the pre-feature columns and narrowed constraint, then up re-adds them', async () => {
    await migration.down(testDb);

    const narrowed = await columnNames();
    expect(narrowed).not.toContain('inbound_auth_failure_count');
    expect(narrowed).not.toContain('inbound_auth_failure_last_at');
    expect(narrowed).not.toContain('inbound_auth_failure_code');

    // The narrowed constraint rejects auth_failure again.
    const providerId = uuidv4();
    const now = new Date();
    await expect(
      tenantTable('email_providers').insert({
        id: providerId,
        tenant: testTenant,
        provider_type: 'imap',
        provider_name: 'Down Provider',
        mailbox: `down-${providerId.slice(0, 8)}@example.com`,
        is_active: true,
        status: 'error',
        inbound_paused_at: now,
        inbound_pause_reason: 'auth_failure',
        created_at: now,
        updated_at: now,
      })
    ).rejects.toThrow(/email_providers_inbound_pause_reason_check/);

    await migration.up(testDb);

    const restored = await columnNames();
    expect(restored).toContain('inbound_auth_failure_count');
    expect(restored).toContain('inbound_auth_failure_last_at');
    expect(restored).toContain('inbound_auth_failure_code');

    // And auth_failure rows are writable again.
    await tenantTable('email_providers').insert({
      id: providerId,
      tenant: testTenant,
      provider_type: 'imap',
      provider_name: 'Up Again Provider',
      mailbox: `up-${providerId.slice(0, 8)}@example.com`,
      is_active: true,
      status: 'error',
      inbound_paused_at: now,
      inbound_pause_reason: 'auth_failure',
      created_at: now,
      updated_at: now,
    });
  });
});
