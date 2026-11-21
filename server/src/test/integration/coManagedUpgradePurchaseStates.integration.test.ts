import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import { copyFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant } from '../../../test-utils/testDataFactory';
import { CO_MANAGED_UPGRADE_PURCHASE_STATES } from '@alga-psa/co-managed';

let db: Knex;
let migrationRoot: string;
beforeAll(async () => {
  db = await createTestDbConnection();
  // Setup images ship migrations without application packages. Execute this migration from
  // that isolated payload, then exercise its real CHECK and unique index below.
  migrationRoot = await mkdtemp(join(tmpdir(), 'alga-upgrade-migration-'));
  const file = '20261106000100_create_co_managed_upgrade_purchases.cjs';
  await copyFile(resolve(__dirname, '../../../migrations', file), join(migrationRoot, file));
  await cp(resolve(__dirname, '../../../migrations/utils'), join(migrationRoot, 'utils'), { recursive: true });
  const migration = createRequire(import.meta.url)(join(migrationRoot, file));
  await migration.down(db);
  await migration.up(db);
}, 600_000);
afterAll(async () => {
  await db?.destroy();
  if (migrationRoot) await rm(migrationRoot, { recursive: true, force: true });
});

describe('co_managed_upgrade_purchases against the migrated database', () => {
  const insert = (db: Knex.Transaction, tenant: string, operation: string, state: string) => db('co_managed_upgrade_purchases').insert({
    tenant, operation_id: operation, requested_by: operation, quantity: 3, billing_interval: 'month', price_id: 'price_x', state });
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const withTenant = async (work: (trx: Knex.Transaction, tenant: string) => Promise<void>) => {
    await db.transaction(async trx => {
      const tenant = await createTenant(trx, 'Purchase state validation');
      await work(trx, tenant);
      throw Object.assign(new Error('rollback'), { rollback: true });
    }).catch(error => { if (!error.rollback) throw error; });
  };

  it('accepts every state the domain writes, including payment_failed', async () => {
    for (const [index, state] of CO_MANAGED_UPGRADE_PURCHASE_STATES.entries()) {
      await withTenant(async (trx, tenant) => { await insert(trx, tenant, uuid(index + 1), state); });
    }
  });

  it('rejects an unknown state', async () => {
    await expect(withTenant(async (trx, tenant) => { await insert(trx, tenant, uuid(99), 'bogus'); })).rejects.toThrow(/co_upgrade_purchase_state_check/);
  });

  it('allows one pending purchase per tenant, and a new one after the old is expired', async () => {
    await expect(withTenant(async (trx, tenant) => {
      await insert(trx, tenant, uuid(1), 'payment_failed');
      await insert(trx, tenant, uuid(2), 'checkout');
    })).rejects.toThrow(/co_upgrade_one_pending_purchase/);
    await withTenant(async (trx, tenant) => {
      await insert(trx, tenant, uuid(1), 'expired');
      await insert(trx, tenant, uuid(2), 'checkout');
    });
  });
});
