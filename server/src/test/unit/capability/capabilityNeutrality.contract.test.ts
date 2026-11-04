import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Neutrality (plan 6, acceptance A11), on the real request path.
 *
 * Nothing between the root layout and PostHog is mocked except the two
 * process boundaries: the posthog-node client (a fake that applies a
 * tenant-group targeting rule and records the subject it was asked about) and
 * the database (spies on the tenant read that flag enrichment performs). The
 * flag checker is the server's own `featureFlags.isEnabled`, registered exactly
 * as `initializeApp` registers it.
 *
 * Budgets asserted:
 * - the capability gate itself: zero SQL and zero PostHog calls for a tenant
 *   with no resolvers;
 * - the root-layout bootstrap: one PostHog evaluation per tenant per flag-cache
 *   window (60 s) and one `tenants` SELECT per tenant per
 *   TENANT_FLAG_PROPERTIES_TTL_MS (5 min), however many requests arrive.
 */

const db = vi.hoisted(() => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  tenantsFirst: vi.fn(async () => ({ created_at: '2024-01-01T00:00:00.000Z', status: 'active' })),
  tenantDb: vi.fn(),
  getAdminConnection: vi.fn(),
  knexRaw: vi.fn(),
}));
const posthogNode = vi.hoisted(() => ({
  onTenants: new Set<string>(),
  isFeatureEnabled: vi.fn(),
}));

vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: { isEnabled: true, getClient: () => posthogNode, capture: vi.fn() },
}));
vi.mock('server/src/lib/db', () => ({ createTenantKnex: db.createTenantKnex }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: db.createTenantKnex,
  tenantDb: db.tenantDb,
  getAdminConnection: db.getAdminConnection,
  knex: db.knexRaw,
}));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: db.getAdminConnection }));

import { registerFeatureFlagChecker } from '@alga-psa/core/features';
import {
  admits,
  capabilityAdmitBootstrapKey,
  capabilityServedBootstrapKey,
  evaluateCapability,
  filterServed,
  resolveClientCapability,
  serves,
} from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import {
  clearTenantFlagPropertiesCache,
  featureFlags,
  TENANT_FLAG_PROPERTIES_TTL_MS,
} from '../../../lib/feature-flags/featureFlags';
import { resolveCapabilityBootstrap } from '../../../lib/capability/bootstrap';

const FLAG = 'release-v2-0-feature';
const tenantReads = () => db.tenantDb.mock.calls.length;
const sqlCalls = () =>
  db.createTenantKnex.mock.calls.length +
  db.tenantDb.mock.calls.length +
  db.getAdminConnection.mock.calls.length +
  db.knexRaw.mock.calls.length;

describe('capability neutrality on the real evaluator path', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.FORCE_CAPABILITIES;
    delete process.env.DISABLE_FEATURE_FLAGS;
    delete process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS;
    vi.clearAllMocks();
    db.tenantDb.mockImplementation(() => ({ table: () => ({ first: db.tenantsFirst }) }));
    // A tenant-group rule, evaluated the way PostHog evaluates it.
    posthogNode.onTenants = new Set(['emerald']);
    posthogNode.isFeatureEnabled.mockImplementation(
      async (_flag: string, _distinctId: string, opts?: { groups?: { tenant?: string } }) =>
        posthogNode.onTenants.has(opts?.groups?.tenant ?? ''),
    );
    registerFeatureFlagChecker((flag, ctx) => featureFlags.isEnabled(flag, ctx));
    featureFlags.clearCache();
    clearTenantFlagPropertiesCache();
    // Fresh gate registry: no eligibility or participation resolver registered.
    resetCapabilityRegistry();
    clearCapabilityCache();
  });
  afterEach(() => {
    vi.useRealTimers();
    (globalThis as any)[Symbol.for('alga.core.featureFlagChecker')] = undefined;
  });

  it('evaluateCapability: closed, zero SQL, zero PostHog calls', async () => {
    const d = await evaluateCapability('co-managed', 'kansas');
    expect(d).toMatchObject({ admitted: false, served: false, forced: null });
    expect(d.reasons).toEqual({ admitted: 'resolver-unregistered', served: 'resolver-unregistered' });
    expect(posthogNode.isFeatureEnabled).not.toHaveBeenCalled();
    expect(sqlCalls()).toBe(0);
  });

  it('admits, serves and filterServed are individually free', async () => {
    await admits('co-managed', 'kansas');
    await serves('co-managed', 'kansas');
    expect(await filterServed('co-managed', ['a', 'b', 'c'])).toEqual([]);
    expect(posthogNode.isFeatureEnabled).not.toHaveBeenCalled();
    expect(sqlCalls()).toBe(0);
  });

  it('bootstrap: one PostHog evaluation and one tenant read on a cold tenant, none for the capability', async () => {
    const bootstrap = await resolveCapabilityBootstrap('kansas');
    expect(bootstrap).toEqual({
      [FLAG]: false,
      [capabilityServedBootstrapKey('co-managed')]: false,
      [capabilityAdmitBootstrapKey('co-managed')]: false,
    });
    expect(posthogNode.isFeatureEnabled).toHaveBeenCalledTimes(1);
    expect(posthogNode.isFeatureEnabled.mock.calls[0][0]).toBe(FLAG);
    expect(tenantReads()).toBe(1);
    expect(db.createTenantKnex).toHaveBeenCalledTimes(1);
  });

  it('bootstrap cost is amortised: steady-state requests are free, the tenant read outlives the flag cache', async () => {
    await resolveCapabilityBootstrap('kansas');
    for (let i = 0; i < 100; i += 1) await resolveCapabilityBootstrap('kansas');
    expect(posthogNode.isFeatureEnabled).toHaveBeenCalledTimes(1);
    expect(tenantReads()).toBe(1);

    // Flag cache (60 s) expires: PostHog is asked again, the tenant row is not re-read.
    await vi.advanceTimersByTimeAsync(61_000);
    await resolveCapabilityBootstrap('kansas');
    expect(posthogNode.isFeatureEnabled).toHaveBeenCalledTimes(2);
    expect(tenantReads()).toBe(1);

    // Tenant-properties TTL expires: one more read.
    await vi.advanceTimersByTimeAsync(TENANT_FLAG_PROPERTIES_TTL_MS);
    await resolveCapabilityBootstrap('kansas');
    expect(tenantReads()).toBe(2);
  });

  it('concurrent cold requests for one tenant share a single tenant read', async () => {
    await Promise.all(Array.from({ length: 20 }, () => resolveCapabilityBootstrap('kansas')));
    expect(tenantReads()).toBe(1);
  });

  it('a failed tenant read is not cached', async () => {
    db.tenantsFirst.mockRejectedValueOnce(new Error('db down'));
    await resolveCapabilityBootstrap('kansas');
    featureFlags.clearCache();
    await resolveCapabilityBootstrap('kansas');
    expect(tenantReads()).toBe(2);
  });

  it('the flag is evaluated for the tenant subject (tenant_<id>, group tenant), never a user', async () => {
    await resolveCapabilityBootstrap('emerald');
    const [flag, distinctId, opts] = posthogNode.isFeatureEnabled.mock.calls[0];
    expect(flag).toBe(FLAG);
    expect(distinctId).toBe('tenant_emerald');
    expect(opts.groups).toEqual({ tenant: 'emerald' });
    expect(opts.personProperties).toMatchObject({ tenant: 'emerald', tenant_status: 'active' });
  });

  it('server and client agree on false', async () => {
    const bootstrap = await resolveCapabilityBootstrap('kansas');
    const client = resolveClientCapability({ capability: 'co-managed', bootstrap });
    const server = await evaluateCapability('co-managed', 'kansas');
    expect(client).toMatchObject({ enabled: false, admitted: false, resolved: true });
    expect(client.enabled).toBe(server.served);
    expect(client.admitted).toBe(server.admitted);
  });

  it('flag off (Kansas) and flag on (Emerald) differ only in the Timeline flag', async () => {
    const kansas = await resolveCapabilityBootstrap('kansas');
    const emerald = await resolveCapabilityBootstrap('emerald');
    const { [FLAG]: kFlag, ...kRest } = kansas;
    const { [FLAG]: eFlag, ...eRest } = emerald;
    expect(kFlag).toBe(false);
    expect(eFlag).toBe(true);
    expect(eRest).toEqual(kRest);
  });
});
