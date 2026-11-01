import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// The state lists are pure; the licensing/db graph the module also imports is not under test.
vi.mock('@alga-psa/licensing', () => ({ countCoManagedCommittedSeats: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn(), withTransaction: vi.fn() }));
import knexFactory from 'knex';
import { CO_MANAGED_UPGRADE_PENDING_STATES, CO_MANAGED_UPGRADE_PURCHASE_STATES } from '../upgradePurchase';

const require = createRequire(import.meta.url);
const migrationStates = require('../../../../server/migrations/utils/coManagedUpgradePurchaseStates.cjs') as {
  CO_MANAGED_UPGRADE_PURCHASE_STATES: string[]; CO_MANAGED_UPGRADE_PENDING_STATES: string[];
};

describe('independent-upgrade purchase states: one list for the CHECK, the index and the domain', () => {
  it('the migration and the domain share the same lists', () => {
    expect([...migrationStates.CO_MANAGED_UPGRADE_PURCHASE_STATES]).toEqual([...CO_MANAGED_UPGRADE_PURCHASE_STATES]);
    expect([...migrationStates.CO_MANAGED_UPGRADE_PENDING_STATES]).toEqual([...CO_MANAGED_UPGRADE_PENDING_STATES]);
  });
  it('includes payment_failed (the reference CHECK omitted it)', () => {
    expect(CO_MANAGED_UPGRADE_PURCHASE_STATES).toContain('payment_failed');
    for (const pending of CO_MANAGED_UPGRADE_PENDING_STATES) expect(CO_MANAGED_UPGRADE_PURCHASE_STATES).toContain(pending);
  });
});

// A2 regression against a real, migrated database. Set L8B_TEST_DATABASE_URL to a disposable database
// that has had the L8b migrations applied, e.g. postgres://postgres:***@127.0.0.1:5474/cm_l8b_scratch
const url = process.env.L8B_TEST_DATABASE_URL;
describe.skipIf(!url)('co_managed_upgrade_purchases against the migrated database', () => {
  const insert = (db: any, tenant: string, operation: string, state: string) => db('co_managed_upgrade_purchases').insert({
    tenant, operation_id: operation, requested_by: operation, quantity: 3, billing_interval: 'month', price_id: 'price_x', state });
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const withTenant = async (work: (trx: any, tenant: string) => Promise<void>) => {
    const db = knexFactory({ client: 'pg', connection: url });
    try {
      await db.transaction(async trx => {
        const tenant = (await trx('tenants').first('tenant')).tenant;
        await work(trx, tenant);
        throw Object.assign(new Error('rollback'), { rollback: true });
      }).catch(error => { if (!error.rollback) throw error; });
    } finally { await db.destroy(); }
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
      await trx.raw('SAVEPOINT s');
      await insert(trx, tenant, uuid(2), 'checkout');
    })).rejects.toThrow(/co_upgrade_one_pending_purchase/);
    await withTenant(async (trx, tenant) => {
      await insert(trx, tenant, uuid(1), 'expired');
      await insert(trx, tenant, uuid(2), 'checkout');
    });
  });
});
