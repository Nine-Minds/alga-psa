import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Neutrality (plan 6, acceptance A11): a psa tenant with no resolvers pays
 * nothing for the gate. No SQL, no flag-checker call for the capability
 * decision, and server and client agree on false.
 */
const spies = vi.hoisted(() => ({
  flag: vi.fn(async () => true),
  createTenantKnex: vi.fn(),
  getAdminConnection: vi.fn(),
  tenantDb: vi.fn(),
  knexRaw: vi.fn(),
}));

vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: spies.flag }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: spies.createTenantKnex,
  getAdminConnection: spies.getAdminConnection,
  tenantDb: spies.tenantDb,
  knex: spies.knexRaw,
}));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: spies.getAdminConnection }));

import {
  admits,
  capabilityAdmitBootstrapKey,
  capabilityServedBootstrapKey,
  clearCapabilityCache,
  evaluateCapability,
  filterServed,
  resolveClientCapability,
  serves,
} from '@alga-psa/core/capability';
import { resolveCapabilityBootstrap } from '../../../lib/capability/bootstrap';

const sqlCalls = () =>
  spies.createTenantKnex.mock.calls.length +
  spies.getAdminConnection.mock.calls.length +
  spies.tenantDb.mock.calls.length +
  spies.knexRaw.mock.calls.length;

describe('capability neutrality for a psa tenant with no resolvers', () => {
  beforeEach(async () => {
    delete process.env.FORCE_CAPABILITIES;
    vi.clearAllMocks();
    // Fresh registry: no eligibility or participation resolver registered.
    delete (globalThis as any)[Symbol.for('alga.core.capabilityRegistry')];
    clearCapabilityCache();
  });

  it('evaluateCapability: closed, zero SQL, zero flag-checker calls', async () => {
    const d = await evaluateCapability('co-managed', 'psa-tenant');
    expect(d).toMatchObject({ admitted: false, served: false, forced: null });
    expect(d.reasons).toEqual({ admitted: 'resolver-unregistered', served: 'resolver-unregistered' });
    expect(spies.flag).not.toHaveBeenCalled();
    expect(sqlCalls()).toBe(0);
  });

  it('admits, serves and filterServed are individually free', async () => {
    await admits('co-managed', 'psa-tenant');
    await serves('co-managed', 'psa-tenant');
    expect(await filterServed('co-managed', ['a', 'b', 'c'])).toEqual([]);
    expect(spies.flag).not.toHaveBeenCalled();
    expect(sqlCalls()).toBe(0);
  });

  it('bootstrap capability keys: false, zero SQL; the only flag read is the Timeline value', async () => {
    const bootstrap = await resolveCapabilityBootstrap('psa-tenant');
    expect(bootstrap[capabilityServedBootstrapKey('co-managed')]).toBe(false);
    expect(bootstrap[capabilityAdmitBootstrapKey('co-managed')]).toBe(false);
    expect(sqlCalls()).toBe(0);
    // The capability decision made no flag call; the one call is the raw
    // release-v2-0-feature value the Timeline reads.
    expect(spies.flag.mock.calls.map((c: unknown[]) => c[0])).toEqual(['release-v2-0-feature']);
  });

  it('server and client agree on false', async () => {
    const bootstrap = await resolveCapabilityBootstrap('psa-tenant');
    const client = resolveClientCapability({ capability: 'co-managed', bootstrap });
    const server = await evaluateCapability('co-managed', 'psa-tenant');
    expect(client).toMatchObject({ enabled: false, admitted: false, resolved: true });
    expect(client.enabled).toBe(server.served);
    expect(client.admitted).toBe(server.admitted);
  });

  it('flag off (Kansas) and flag on (Emerald) are indistinguishable for the capability', async () => {
    spies.flag.mockResolvedValue(false);
    const kansas = await resolveCapabilityBootstrap('kansas');
    clearCapabilityCache();
    spies.flag.mockResolvedValue(true);
    const emerald = await resolveCapabilityBootstrap('emerald');
    const { ['release-v2-0-feature']: kFlag, ...kRest } = kansas;
    const { ['release-v2-0-feature']: eFlag, ...eRest } = emerald;
    expect(kFlag).toBe(false);
    expect(eFlag).toBe(true);
    expect(eRest).toEqual(kRest);
  });
});
