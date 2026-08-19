import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import {
  createBillingProfile,
  ensureDefaultBillingProfile,
  seedBillingCycle,
} from '../../../../test-utils/billingProfileTestHelpers';
import { createClientContractLineCycles } from '@alga-psa/shared/billingClients/createBillingCycles';

/**
 * S8 — per-profile billing cycles (T034, T035, T036).
 *
 * The safety property is that a client nobody has segmented gets exactly the
 * cycles it has today: the default profile's pass is the only one that runs.
 * The new behaviour only appears once a profile is marked as billing
 * separately, which is an explicit act.
 */

const HOOK_TIMEOUT = 300_000;

let db: Knex;
let tenantId: string;

function table(name: string) {
  return tenantDb(db, tenantId).table(name);
}

async function seedClient(name: string, billingCycle = 'monthly'): Promise<string> {
  const clientId = uuidv4();
  await table('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: name,
    billing_cycle: billingCycle,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return clientId;
}

async function cyclesFor(clientId: string) {
  return table('client_billing_cycles')
    .where({ client_id: clientId })
    .orderBy('period_start_date', 'asc')
    .select('billing_cycle_id', 'billing_profile_id', 'billing_cycle', 'period_start_date');
}

describe('billing profiles S8 — per-profile cycles (T034, T035, T036)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ databaseName: 'test_db_billing_profiles' });

    tenantId = uuidv4();
    await tenantDb(db, tenantId)
      .unscoped('tenants', 'test fixture creates tenant rows')
      .insert({
        tenant: tenantId,
        client_name: 'S8 Fixture',
        email: `s8-${tenantId.slice(0, 8)}@profiles.test`,
      });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('T034: every cycle carries a profile, and the unique constraint is per profile', async () => {
    const clientId = await seedClient('Constraint Client');
    const defaultProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const siteProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Site B');

    // The same period for two different profiles is exactly what S8 makes
    // possible — it must not look like a duplicate.
    await seedBillingCycle(db, tenantId, {
      billing_cycle_id: uuidv4(),
      client_id: clientId,
      billing_profile_id: defaultProfileId,
      billing_cycle: 'monthly',
      effective_date: '2025-07-01T00:00:00Z',
      period_start_date: '2025-07-01T00:00:00Z',
      period_end_date: '2025-08-01T00:00:00Z',
    });
    await seedBillingCycle(db, tenantId, {
      billing_cycle_id: uuidv4(),
      client_id: clientId,
      billing_profile_id: siteProfileId,
      billing_cycle: 'monthly',
      effective_date: '2025-07-01T00:00:00Z',
      period_start_date: '2025-07-01T00:00:00Z',
      period_end_date: '2025-08-01T00:00:00Z',
    });

    expect(await cyclesFor(clientId)).toHaveLength(2);

    // The same profile twice in one period still is a duplicate.
    await expect(
      seedBillingCycle(db, tenantId, {
        billing_cycle_id: uuidv4(),
        client_id: clientId,
        billing_profile_id: siteProfileId,
        billing_cycle: 'monthly',
        effective_date: '2025-07-01T00:00:00Z',
        period_start_date: '2025-07-01T00:00:00Z',
        period_end_date: '2025-08-01T00:00:00Z',
      }),
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  }, HOOK_TIMEOUT);

  it('T034: an unsegmented client gets exactly the cycles it would have had', async () => {
    const clientId = await seedClient('Ordinary Client');
    const defaultProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);

    const result = await createClientContractLineCycles(
      db,
      { client_id: clientId, tenant: tenantId, billing_cycle: 'monthly' } as any,
      { manual: true },
    );
    expect(result).toEqual({ success: true });

    const cycles = await cyclesFor(clientId);
    // One pass, one cycle, on the client's default profile.
    expect(cycles).toHaveLength(1);
    expect(cycles[0].billing_profile_id).toBe(defaultProfileId);
  }, HOOK_TIMEOUT);

  it('T035/T036: a separately-billing profile gets its own cycle, on its own frequency', async () => {
    const clientId = await seedClient('Franchise Group');
    const defaultProfileId = await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const siteProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Franchise Site');

    // Per-profile billing frequency comes free from running one pass per
    // profile — franchise-shape customers stagger billing dates per site.
    await table('client_billing_profiles')
      .where({ billing_profile_id: siteProfileId })
      .update({ bills_separately: true, billing_cycle: 'quarterly' });

    const result = await createClientContractLineCycles(
      db,
      { client_id: clientId, tenant: tenantId, billing_cycle: 'monthly' } as any,
      { manual: true },
    );
    expect(result).toEqual({ success: true });

    const cycles = await cyclesFor(clientId);
    expect(cycles).toHaveLength(2);

    const byProfile = new Map(cycles.map((cycle: any) => [cycle.billing_profile_id, cycle]));
    expect(byProfile.get(defaultProfileId).billing_cycle).toBe('monthly');
    expect(byProfile.get(siteProfileId).billing_cycle).toBe('quarterly');
  }, HOOK_TIMEOUT);

  it('T036: a separately-billing profile with no frequency of its own inherits the client’s', async () => {
    const clientId = await seedClient('Inheriting Group', 'weekly');
    await ensureDefaultBillingProfile({ db, tenantId }, clientId);
    const siteProfileId = await createBillingProfile({ db, tenantId }, clientId, 'Inheriting Site');
    await table('client_billing_profiles')
      .where({ billing_profile_id: siteProfileId })
      .update({ bills_separately: true });

    await createClientContractLineCycles(
      db,
      { client_id: clientId, tenant: tenantId, billing_cycle: 'weekly' } as any,
      { manual: true },
    );

    const cycles = await cyclesFor(clientId);
    expect(cycles.every((cycle: any) => cycle.billing_cycle === 'weekly')).toBe(true);
  }, HOOK_TIMEOUT);
});
