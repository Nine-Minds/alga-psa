import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake } from './fakeCoManagedDb';

const gate = vi.hoisted(() => ({ served: true, flag: true as boolean | 'throw', flagCalls: 0 }));
vi.mock('@alga-psa/db', async () => {
  const fake = await import('./fakeCoManagedDb');
  return { tenantDb: (db: any, tenant: string) => fake.fakeTenantDb(db, tenant), tenantTableMetadata: {},
    withTransaction: (db: any, work: any) => db.transaction(work) };
});
vi.mock('@alga-psa/licensing', () => ({ countCoManagedCommittedSeats: async () => 0, resolveSelfHostTier: () => null,
  verifyLicense: () => null, retainHostedPsaUpgradeCandidate: async () => ({ seats: 0 }), HostedPsaUpgradeAdmissionError: class extends Error {} }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: async () => { gate.flagCalls += 1; if (gate.flag === 'throw') throw new Error('posthog down'); return gate.flag; } }));
vi.mock('@alga-psa/core/capability', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  serves: async () => ({ served: gate.served }),
}));

import { resolveCoManagedUpgradeAccess } from '../independentUpgradeScreen';

const CUSTOMER = '00000000-0000-4000-8000-0000000000c1';
const SPONSOR = '00000000-0000-4000-8000-0000000000a1';
const REL = '00000000-0000-4000-8000-0000000000d1';

function world(opts: { relationship?: boolean; upgradeRow?: boolean } = {}) {
  const { store, db } = createFake();
  if (opts.relationship) store.seed('co_management_relationships', { tenant: CUSTOMER, relationship_id: REL, sponsor_tenant: SPONSOR, state: 'active', revision: 1, ended_at: null });
  if (opts.upgradeRow) store.seed('co_managed_independent_upgrades', { tenant: CUSTOMER, operation_id: '00000000-0000-4000-8000-0000000000b1' });
  return db;
}

beforeEach(() => { delete process.env.FORCE_CAPABILITIES; gate.served = true; gate.flag = true; gate.flagCalls = 0; });
afterEach(() => { delete process.env.FORCE_CAPABILITIES; });

describe('resolveCoManagedUpgradeAccess', () => {
  it('customer: flag on, serves, customer-side relationship', async () => {
    expect(await resolveCoManagedUpgradeAccess(world({ relationship: true }), CUSTOMER)).toBe('customer');
  });
  it('sponsor (serves, no relationship on its own tenant, no upgrade row) is closed', async () => {
    expect(await resolveCoManagedUpgradeAccess(world(), SPONSOR)).toBe('closed');
  });
  it('former customer no longer serving, with an upgrade row, is former', async () => {
    gate.served = false;
    expect(await resolveCoManagedUpgradeAccess(world({ relationship: true, upgradeRow: true }), CUSTOMER)).toBe('former');
  });
  it('non-serving tenant without an upgrade row is closed even with a relationship', async () => {
    gate.served = false;
    expect(await resolveCoManagedUpgradeAccess(world({ relationship: true }), CUSTOMER)).toBe('closed');
  });
  it.each(['co-managed:off', 'co-managed:maybe'])('kill switch %s closes it even for a former customer, before any query', async value => {
    process.env.FORCE_CAPABILITIES = value;
    gate.served = false;
    expect(await resolveCoManagedUpgradeAccess(new Proxy({} as any, { get() { throw new Error('db touched'); } }), CUSTOMER)).toBe('closed');
    expect(gate.flagCalls).toBe(0);
  });
  it('release flag off closes it for a former customer', async () => {
    gate.flag = false; gate.served = false;
    expect(await resolveCoManagedUpgradeAccess(world({ upgradeRow: true }), CUSTOMER)).toBe('closed');
  });
  it('a flag evaluation failure is closed', async () => {
    gate.flag = 'throw';
    expect(await resolveCoManagedUpgradeAccess(world({ relationship: true }), CUSTOMER)).toBe('closed');
  });
});
