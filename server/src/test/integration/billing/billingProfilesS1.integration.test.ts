import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { getTenantTableScope, tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const HOOK_TIMEOUT = 300_000;
const MIGRATION_DIR = path.resolve(process.cwd(), 'migrations');

const createMigration = require(
  path.join(MIGRATION_DIR, '20260816000000_create_client_billing_profiles.cjs')
);
const assignmentMigration = require(
  path.join(MIGRATION_DIR, '20260816010000_add_billing_profile_assignment_columns.cjs')
);
// Later slices add tables that reference client_billing_profiles. A real
// rollback runs migrations down in reverse order, so this test has to as well
// — otherwise it would be asserting that S1 can be dropped out from under its
// own dependants, which no rollback ever does.
const dependentMigrationsNewestFirst = [
  '20260822000000_add_billing_profile_bill_to_and_tax.cjs',
  '20260821000000_create_portal_user_billing_profile_access.cjs',
].map((file) => require(path.join(MIGRATION_DIR, file)));

// Column matrix for F006–F012 (the assignment columns S1 adds).
const ASSIGNMENT_COLUMNS: Array<[string, string]> = [
  ['client_contracts', 'billing_profile_id'],
  ['contract_lines', 'billing_profile_id'],
  ['client_locations', 'default_billing_profile_id'],
  ['tickets', 'billing_profile_id'],
  ['projects', 'billing_profile_id'],
  ['invoice_charges', 'billing_profile_id'],
  ['invoice_charges', 'billing_profile_source'],
  ['time_entries', 'contract_line_source'],
];

let db: Knex;
const tenantsToCleanup = new Set<string>();

function table(tenantId: string, name: string) {
  return tenantDb(db, tenantId).table(name);
}

function tenantsUnscoped() {
  return tenantDb(db, '__billing_profiles_s1_fixture__').unscoped(
    'tenants',
    'test fixture creates and removes tenant rows'
  );
}

async function seedTenantAndClients(tenantId: string, clientNames: string[]): Promise<string[]> {
  await tenantsUnscoped().insert({
    tenant: tenantId,
    client_name: `Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.test`,
  });

  const clientIds = clientNames.map(() => uuidv4());
  await table(tenantId, 'clients').insert(
    clientNames.map((name, index) => ({
      tenant: tenantId,
      client_id: clientIds[index],
      client_name: name,
      billing_cycle: 'monthly',
    }))
  );
  return clientIds;
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await table(tenantId, 'client_billing_profiles').del();
  await table(tenantId, 'invoice_charges').del();
  await table(tenantId, 'invoices').del();
  await table(tenantId, 'clients').del();
  await tenantsUnscoped().where({ tenant: tenantId }).del();
}

describe('billing profiles S1 — schema + default-profile backfill (T006–T009)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
    }
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('T006: backfill creates exactly one system-managed default profile per existing client and re-running creates no duplicates', async () => {
    const tenantId = uuidv4();
    tenantsToCleanup.add(tenantId);
    const clientIds = await seedTenantAndClients(tenantId, ['Alpha Corp', 'Beta Ltd']);

    // The bootstrap already ran the backfill against an empty clients table;
    // run the migration's up again to exercise the backfill on the new clients.
    await createMigration.up(db);

    for (const clientId of clientIds) {
      const profiles = await table(tenantId, 'client_billing_profiles')
        .where({ client_id: clientId })
        .orderBy('name');
      expect(profiles).toHaveLength(1);
      expect(profiles[0]).toMatchObject({
        is_default: true,
        is_system_managed_default: true,
        is_active: true,
      });
    }

    // Named from the client (F004).
    const alphaProfile = await table(tenantId, 'client_billing_profiles')
      .where({ client_id: clientIds[0] })
      .first();
    expect(alphaProfile?.name).toBe('Alpha Corp');

    // Idempotent re-run (F005) — no duplicates.
    await createMigration.up(db);
    const alphaCount = await table(tenantId, 'client_billing_profiles')
      .where({ client_id: clientIds[0] })
      .count('* as count')
      .first();
    expect(Number(alphaCount?.count)).toBe(1);
  }, HOOK_TIMEOUT);

  it('T007: the partial unique index rejects a second is_default profile for the same client', async () => {
    const tenantId = uuidv4();
    tenantsToCleanup.add(tenantId);
    const [clientId] = await seedTenantAndClients(tenantId, ['Solo Corp']);
    await createMigration.up(db);

    // A second non-default profile is allowed.
    const secondProfileId = uuidv4();
    await table(tenantId, 'client_billing_profiles').insert({
      tenant: tenantId,
      billing_profile_id: secondProfileId,
      client_id: clientId,
      name: 'Solo Corp — Backup',
      is_default: false,
      is_system_managed_default: false,
    });
    expect(
      await table(tenantId, 'client_billing_profiles')
        .where({ billing_profile_id: secondProfileId })
        .first()
    ).toBeTruthy();

    // A second default is rejected.
    await expect(
      table(tenantId, 'client_billing_profiles').insert({
        tenant: tenantId,
        billing_profile_id: uuidv4(),
        client_id: clientId,
        name: 'Solo Corp — Illegal Default',
        is_default: true,
        is_system_managed_default: false,
      })
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  }, HOOK_TIMEOUT);

  it('T008: down migrations restore the prior schema and leave existing billing data intact', async () => {
    const tenantId = uuidv4();
    tenantsToCleanup.add(tenantId);
    const [clientId] = await seedTenantAndClients(tenantId, ['Data Corp']);

    // Some pre-existing billing data.
    const invoiceId = uuidv4();
    const chargeId = uuidv4();
    await table(tenantId, 'invoices').insert({
      tenant: tenantId,
      invoice_id: invoiceId,
      invoice_number: `INV-${tenantId.slice(0, 6)}`,
      invoice_date: new Date('2026-08-01T00:00:00.000Z'),
      due_date: new Date('2026-08-31T00:00:00.000Z'),
      total_amount: 1200,
      subtotal: 1200,
      tax: 0,
      status: 'draft',
      invoice_type: 'standard',
      client_id: clientId,
      currency_code: 'USD',
    });
    await table(tenantId, 'invoice_charges').insert({
      tenant: tenantId,
      item_id: chargeId,
      invoice_id: invoiceId,
      description: 'Managed services',
      quantity: 1,
      unit_price: 1200,
      total_price: 1200,
      is_manual: true,
    });

    // Sanity: the S1 columns exist up front.
    for (const [tbl, col] of ASSIGNMENT_COLUMNS) {
      await expect(db.schema.hasColumn(tbl, col)).resolves.toBe(true);
    }
    await expect(db.schema.hasTable('client_billing_profiles')).resolves.toBe(true);

    for (const migration of dependentMigrationsNewestFirst) {
      await migration.down(db);
    }
    await assignmentMigration.down(db);
    await createMigration.down(db);

    // Prior schema restored.
    for (const [tbl, col] of ASSIGNMENT_COLUMNS) {
      await expect(db.schema.hasColumn(tbl, col)).resolves.toBe(false);
    }
    await expect(db.schema.hasTable('client_billing_profiles')).resolves.toBe(false);

    // Existing billing data intact.
    const charge = await table(tenantId, 'invoice_charges').where({ item_id: chargeId }).first();
    expect(charge).toBeTruthy();
    expect(charge?.description).toBe('Managed services');
    expect(
      await table(tenantId, 'clients').where({ client_id: clientId }).first()
    ).toBeTruthy();

    // Restore for the rest of the suite (and for T008's own re-apply invariant).
    await createMigration.up(db);
    await assignmentMigration.up(db);
    for (const migration of [...dependentMigrationsNewestFirst].reverse()) {
      await migration.up(db);
    }
    await expect(db.schema.hasTable('client_billing_profiles')).resolves.toBe(true);
    for (const [tbl, col] of ASSIGNMENT_COLUMNS) {
      await expect(db.schema.hasColumn(tbl, col)).resolves.toBe(true);
    }
  }, HOOK_TIMEOUT);

  it('T009: client_billing_profiles is tenant-scoped and registered for deletion in tenant teardown', async () => {
    // F013 — registered in tenant table metadata (Citus distribution + facade).
    expect(getTenantTableScope('client_billing_profiles')).toEqual({ scope: 'tenant' });

    // The tenantDb facade accepts and tenant-scopes the table.
    const tenantId = uuidv4();
    tenantsToCleanup.add(tenantId);
    await seedTenantAndClients(tenantId, ['Scoped Corp']);
    await createMigration.up(db);
    const rows = await table(tenantId, 'client_billing_profiles');
    expect(rows).toHaveLength(1);
    expect(rows[0].client_id).toBeTruthy();

    // F014 — the deletion activity's ordered table list includes the table,
    // placed after every table that references it and before clients.
    const activitiesPath = path.resolve(
      process.cwd(),
      '../ee/temporal-workflows/src/activities/tenant-deletion-activities.ts'
    );
    const source = fs.readFileSync(activitiesPath, 'utf8');
    const tablesBlock = source.slice(source.indexOf('TENANT_TABLES_DELETION_ORDER'));
    const profileIndex = tablesBlock.indexOf("'client_billing_profiles'");
    const clientsIndex = tablesBlock.indexOf("'clients'");
    expect(profileIndex).toBeGreaterThanOrEqual(0);
    expect(clientsIndex).toBeGreaterThan(profileIndex);
  }, HOOK_TIMEOUT);
});
