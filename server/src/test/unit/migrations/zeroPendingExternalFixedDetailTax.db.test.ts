import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * alga-2026-0003122 data repair: a draft whose tax is delegated to the
 * accounting system (tax_source = 'pending_external') reads 0 tax on its
 * invoice_charges rows, but before the application fix the fixed-plan
 * allocation rows kept the billing engine's computed tax, which made every
 * accounting export batch fail validation. The migration zeroes those
 * allocation rows and must leave internal and already-imported (external)
 * invoices alone.
 */
const migration: {
  config: { transaction: boolean };
  BATCH_SIZE: number;
  up(db: Knex): Promise<void>;
  down(db: Knex): Promise<void>;
} = createRequire(import.meta.url)(
  fileURLToPath(new URL(
    '../../../../migrations/20261105120000_zero_pending_external_fixed_detail_tax.cjs',
    import.meta.url,
  )),
);

const schema = `pending_external_tax_${randomUUID().replaceAll('-', '')}`;
let db: Knex;

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

type Fixture = { tenant: string; taxSource: string; details: Array<{ tax: number; rate: number }> };

async function seed({ tenant, taxSource, details }: Fixture) {
  const invoiceId = randomUUID();
  const itemId = randomUUID();
  await db('invoices').insert({ tenant, invoice_id: invoiceId, tax_source: taxSource });
  await db('invoice_charges').insert({ tenant, item_id: itemId, invoice_id: invoiceId });
  const detailIds: string[] = [];
  for (const detail of details) {
    const detailId = randomUUID();
    detailIds.push(detailId);
    await db('invoice_charge_details').insert({ tenant, item_detail_id: detailId, item_id: itemId });
    await db('invoice_charge_fixed_details').insert({
      tenant, item_detail_id: detailId, allocated_amount: 25_000, tax_amount: detail.tax, tax_rate: String(detail.rate),
    });
  }
  return detailIds;
}

const taxOf = async (detailId: string) => {
  const row = await db('invoice_charge_fixed_details').where({ item_detail_id: detailId }).first();
  return { tax: Number(row.tax_amount), rate: Number(row.tax_rate) };
};

beforeAll(async () => {
  if (!process.env.DB_USER_ADMIN || !process.env.DB_PASSWORD_ADMIN) {
    throw new Error('Pending-external fixed-detail repair test requires the isolated workspace DB credentials');
  }
  db = knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN,
      database: process.env.TEST_DB_NAME || 'test_database',
    },
    searchPath: [schema, 'public'], pool: { min: 0, max: 2 },
  });
  await db.raw('CREATE SCHEMA ??', [schema]);
  // Minimal pre-repair shape, so the assertions do not depend on current seeds.
  await db.schema.createTable('invoices', (table) => {
    table.uuid('tenant').notNullable(); table.uuid('invoice_id').notNullable();
    table.text('tax_source').notNullable(); table.primary(['tenant', 'invoice_id']);
  });
  await db.schema.createTable('invoice_charges', (table) => {
    table.uuid('tenant').notNullable(); table.uuid('item_id').notNullable();
    table.uuid('invoice_id').notNullable(); table.primary(['tenant', 'item_id']);
  });
  await db.schema.createTable('invoice_charge_details', (table) => {
    table.uuid('tenant').notNullable(); table.uuid('item_detail_id').notNullable();
    table.uuid('item_id').notNullable(); table.primary(['tenant', 'item_detail_id']);
  });
  await db.schema.createTable('invoice_charge_fixed_details', (table) => {
    table.uuid('tenant').notNullable(); table.uuid('item_detail_id').notNullable();
    table.integer('allocated_amount'); table.integer('tax_amount'); table.decimal('tax_rate');
    table.primary(['tenant', 'item_detail_id']);
  });
});

afterAll(async () => {
  if (db) {
    try { await db.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema]); }
    finally { await db.destroy(); }
  }
});

describe('zero_pending_external_fixed_detail_tax migration', () => {
  it('zeroes only pending_external allocations, in every tenant, and is idempotent', async () => {
    expect(migration.config).toEqual({ transaction: false });
    expect(migration.BATCH_SIZE).toBeGreaterThan(0);

    const drifted = await seed({ tenant: TENANT_A, taxSource: 'pending_external', details: [{ tax: 2_500, rate: 10 }, { tax: 6_800, rate: 10 }] });
    const alreadyClean = await seed({ tenant: TENANT_A, taxSource: 'pending_external', details: [{ tax: 0, rate: 0 }] });
    const internal = await seed({ tenant: TENANT_A, taxSource: 'internal', details: [{ tax: 2_500, rate: 10 }] });
    // tax_rate is numeric(8,2), so the blended rate lands rounded.
    const imported = await seed({ tenant: TENANT_A, taxSource: 'external', details: [{ tax: 672, rate: 2.69 }] });
    // A second tenant proves the per-tenant, tenant-pinned loop covers them all.
    const otherTenant = await seed({ tenant: TENANT_B, taxSource: 'pending_external', details: [{ tax: 1_250, rate: 10 }] });

    await migration.up(db);

    for (const detailId of drifted) expect(await taxOf(detailId)).toEqual({ tax: 0, rate: 0 });
    expect(await taxOf(alreadyClean[0])).toEqual({ tax: 0, rate: 0 });
    expect(await taxOf(otherTenant[0])).toEqual({ tax: 0, rate: 0 });
    // Internal tax stays engine-owned; imported external tax stays as imported.
    expect(await taxOf(internal[0])).toEqual({ tax: 2_500, rate: 10 });
    expect(await taxOf(imported[0])).toEqual({ tax: 672, rate: 2.69 });

    // Idempotent: the second run matches nothing and writes nothing.
    const updateCounts: number[] = [];
    const recordUpdate = (response: { command?: string; rowCount?: number }) => {
      if (response?.command === 'UPDATE' && typeof response.rowCount === 'number') {
        updateCounts.push(response.rowCount);
      }
    };
    db.on('query-response', recordUpdate);
    try {
      await migration.up(db);
    } finally {
      db.removeListener('query-response', recordUpdate);
    }
    expect(updateCounts.every((count) => count === 0)).toBe(true);
    expect(await taxOf(internal[0])).toEqual({ tax: 2_500, rate: 10 });
    expect(await taxOf(imported[0])).toEqual({ tax: 672, rate: 2.69 });

    await expect(migration.down(db)).resolves.toBeUndefined();
  });

  it('is a no-op on a database with no delegated-tax invoices', async () => {
    await db('invoice_charge_fixed_details').del();
    await db('invoice_charge_details').del();
    await db('invoice_charges').del();
    await db('invoices').del();
    const internal = await seed({ tenant: TENANT_A, taxSource: 'internal', details: [{ tax: 900, rate: 10 }] });

    await migration.up(db);

    expect(await taxOf(internal[0])).toEqual({ tax: 900, rate: 10 });
  });
});
