import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';

const dbMocks = vi.hoisted(() => ({ getAdminConnection: vi.fn(), tenantDb: vi.fn() }));
vi.mock('@temporalio/activity', () => ({
  Context: { current: () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }) },
}));
vi.mock('@temporalio/client', () => ({ Client: vi.fn(), Connection: vi.fn() }));
vi.mock('@alga-psa/db/admin.js', () => ({ getAdminConnection: dbMocks.getAdminConnection, refreshAdminConnection: vi.fn() }));
vi.mock('@alga-psa/db', async () => ({
  tenantDb: dbMocks.tenantDb,
  getTenantTableScope: (await import('../../../../../packages/db/src/lib/tenantTableMetadata')).getTenantTableScope,
  retryOnReadOnly: (operation: () => Promise<unknown>) => operation(),
}));
vi.mock('@alga-psa/shared/models/tagModel.js', () => ({ TagModel: {} }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret: vi.fn() }));
vi.mock('../../db/tenant-operations.js', () => ({ insertStripeSubscriptionForTenant: vi.fn() }));
vi.mock('../../services/stripe-service.js', () => ({ updateSubscriptionMetadata: vi.fn() }));
vi.mock('../tenant-email-ingestion-activities.js', () => ({}));
vi.mock('../tenant-suspension-activities.js', () => ({}));

import { deleteTenantData } from '../tenant-deletion-activities.js';

const connectionString = process.env.STRIPE_TENANT_DELETION_TEST_DATABASE_URL;
const suite = describe.skipIf(!connectionString);
let db: Knex;
const createdTables = new Set<string>();
const targetTenant = randomUUID();
const neighborTenant = randomUUID();
const managementTenant = randomUUID();

suite('Stripe tenant deletion activity against PostgreSQL', () => {
  beforeAll(async () => {
    db = knexFactory({ client: 'pg', connection: connectionString, pool: { min: 1, max: 2 } });
    await db.raw('SELECT 1');
    for (const table of ['stripe_customers', 'stripe_customer_bindings', 'tenants']) {
      const exists = await db.schema.hasTable(table);
      if (exists) throw new Error(`Refusing to overwrite pre-existing public.${table} in the isolated deletion database`);
    }

    await db.schema.createTable('tenants', (table) => {
      table.uuid('tenant').primary();
      table.text('client_name').notNullable();
    });
    createdTables.add('tenants');
    await db.schema.createTable('stripe_customer_bindings', (table) => {
      table.text('stripe_customer_external_id').primary();
      table.uuid('tenant').notNullable();
      table.unique(['stripe_customer_external_id', 'tenant'], 'stripe_customer_bindings_owner_key');
    });
    createdTables.add('stripe_customer_bindings');
    await db.schema.createTable('stripe_customers', (table) => {
      table.uuid('tenant').notNullable();
      table.text('stripe_customer_external_id').notNullable();
      table.unique(['tenant', 'stripe_customer_external_id']);
      table.foreign(['stripe_customer_external_id', 'tenant'], 'stripe_customers_binding_owner_fk')
        .references(['stripe_customer_external_id', 'tenant']).inTable('stripe_customer_bindings');
    });
    createdTables.add('stripe_customers');

    await db('tenants').insert([
      { tenant: targetTenant, client_name: 'Target tenant' },
      { tenant: neighborTenant, client_name: 'Neighbor tenant' },
      { tenant: managementTenant, client_name: 'Nine Minds LLC' },
    ]);
    await db('stripe_customer_bindings').insert([
      { stripe_customer_external_id: 'cus_target_deletion', tenant: targetTenant },
      { stripe_customer_external_id: 'cus_neighbor_deletion', tenant: neighborTenant },
    ]);
    await db('stripe_customers').insert([
      { stripe_customer_external_id: 'cus_target_deletion', tenant: targetTenant },
      { stripe_customer_external_id: 'cus_neighbor_deletion', tenant: neighborTenant },
    ]);

    dbMocks.getAdminConnection.mockResolvedValue(db);
    dbMocks.tenantDb.mockImplementation((_connection: Knex, tenant: string) => ({
      table: (table: string) => db(table).where('tenant', tenant),
      unscoped: (table: string) => db(table),
    }));
  });

  afterAll(async () => {
    if (db) {
      for (const table of ['stripe_customers', 'stripe_customer_bindings', 'tenants']) {
        if (createdTables.has(table)) await db.schema.dropTableIfExists(table);
      }
      createdTables.clear();
      await db.destroy();
    }
  });

  it('deletes the target mapping before its binding and leaves the neighbor mapping and binding intact', async () => {
    const result = await deleteTenantData(targetTenant, randomUUID());

    expect(result).toMatchObject({ success: true });
    expect(await db('stripe_customers').select('tenant', 'stripe_customer_external_id'))
      .toEqual([{ tenant: neighborTenant, stripe_customer_external_id: 'cus_neighbor_deletion' }]);
    expect(await db('stripe_customer_bindings').select('tenant', 'stripe_customer_external_id'))
      .toEqual([{ tenant: neighborTenant, stripe_customer_external_id: 'cus_neighbor_deletion' }]);
    expect(await db('tenants').where({ tenant: targetTenant })).toHaveLength(0);
    expect(await db('tenants').where({ tenant: neighborTenant })).toHaveLength(1);
  });
});
