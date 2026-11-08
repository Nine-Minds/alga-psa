/**
 * L7a A3/A4 on real Postgres: the lapse state machine (injected clock) enforced through the L0c
 * write-admission choke point, for every table in OPERATIONAL_WRITE_TABLES.
 *   grace -> writes still admitted; read_only -> every operational write refused, reads succeed;
 *   renewal -> writes restored; ended relationship -> reads kept, every write refused.
 */
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { OPERATIONAL_WRITE_TABLES, admitOperationalWrite, registerWriteAdmissionResolver, resetWriteAdmissionResolver } from '@alga-psa/db';
import { admits, registerCapabilityEligibility } from '@alga-psa/core/capability';
import { clearCapabilityCache } from '@alga-psa/core/capability/testing';
import { flagTargetingEnvName, registerFeatureFlagChecker } from '@alga-psa/core/features';
import { FeatureFlags } from '../../../../packages/core/src/lib/featureFlagRuntime';
import { invalidateWriteAdmission } from '@alga-psa/db/writeAdmission';
import { GRACE_MS, readCoManagedLifecycleLockFree } from '@alga-psa/licensing';
import { createCoManagedWriteAdmissionResolver, installCoManagedWriteAdmission, readCoManagedLifecycleForServer } from '@alga-psa/licensing/co-managed-write-admission';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { seedBoundaryFixture, type BoundaryFixture } from './coManagedArchiveBoundaryCases';

const describeDb = await describeWithDb();
const DAY = 86_400_000;

describeDb('co-managed lapse enforced through the write-admission choke point', { shuffle: false }, () => {
  let db: Knex; let f: BoundaryFixture; let clock = new Date();

  const tables = Object.keys(OPERATIONAL_WRITE_TABLES);
  const attempt = async (table: string) => { try { await admitOperationalWrite(db, f.customer, table, 'l7a-test'); return 'admitted'; } catch { return 'refused'; } };
  const outcomes = async () => { invalidateWriteAdmission(f.customer); return new Set(await Promise.all(tables.map(attempt))); };
  const lapse = async (startedAt: Date | null) => {
    await db('co_managed_entitlements').where({ tenant: f.msp }).update({ lapse_started_at: startedAt, read_only_after: startedAt ? new Date(startedAt.getTime() + GRACE_MS) : null });
  };

  beforeAll(async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    db = await createTestDbConnection({ databaseName: 'l7a_lapse_admission_test' });
    f = await seedBoundaryFixture(db);
    registerCapabilityEligibility('co-managed', async ({ tenantId }) => Boolean(await db('co_managed_entitlements').where({ tenant: tenantId }).first('tenant')));
    // The allocation is `active` so the relationship is in good standing until the entitlement lapses.
    registerWriteAdmissionResolver(createCoManagedWriteAdmissionResolver((conn, tenant) => readCoManagedLifecycleLockFree(conn as Knex, tenant, () => clock)));
  }, 300_000);
  afterAll(async () => { resetWriteAdmissionResolver(); delete process.env.FORCE_CAPABILITIES; await db?.destroy(); });

  it('in good standing every operational write is admitted', async () => {
    expect([...await outcomes()]).toEqual(['admitted']);
  });

  it('grace: writes are still admitted before the durable deadline', async () => {
    clock = new Date(); await lapse(new Date(clock.getTime() - (GRACE_MS - DAY)));
    expect([...await outcomes()]).toEqual(['admitted']);
  });

  it('read_only: every operational write is refused and reads still succeed', async () => {
    clock = new Date(); await lapse(new Date(clock.getTime() - GRACE_MS - DAY));
    expect([...await outcomes()]).toEqual(['refused']);
    expect(await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId }).first('state')).toMatchObject({ state: 'active' });
    expect(await db('tenants').where({ tenant: f.customer }).first('tenant')).toBeTruthy();
  });

  it('the deadline is durable: the same lapse is read-only exactly at the deadline, never earlier', async () => {
    const started = new Date(); await lapse(started);
    clock = new Date(started.getTime() + GRACE_MS - 1); expect([...await outcomes()]).toEqual(['admitted']);
    clock = new Date(started.getTime() + GRACE_MS); expect([...await outcomes()]).toEqual(['refused']);
  });

  it('renewal restores writes', async () => {
    clock = new Date(); await lapse(null);
    expect([...await outcomes()]).toEqual(['admitted']);
  });

  it('an ended relationship keeps reads and refuses every write', async () => {
    await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId }).update({ state: 'terminated', ended_at: new Date() });
    expect([...await outcomes()]).toEqual(['refused']);
    expect(await db('co_managed_participation_evidence').where({ tenant: f.msp }).count('* as n').first()).toMatchObject({ n: expect.any(String) });
  });

  it('the installed default reader preserves flag-off and unentitled neutrality, then enforces an entitled lapse and ended state', async () => {
    const flagEnv = flagTargetingEnvName('release-v2-0-feature');
    const originalFlag = process.env[flagEnv];
    const originalForce = process.env.FORCE_CAPABILITIES;
    const entitlement = await db('co_managed_entitlements').where({ tenant: f.msp }).first();
    try {
      await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId }).update({ state: 'active', ended_at: null });
      await db('co_managed_allocations').where({ tenant: f.msp, relationship_id: f.relationshipId }).update({ state: 'active' });
      const started = new Date(Date.now() - GRACE_MS - DAY);
      await lapse(started);
      installCoManagedWriteAdmission();
      delete process.env.FORCE_CAPABILITIES;

      process.env[flagEnv] = f.msp;
      process.env.FORCE_CAPABILITIES = 'co-managed:off';
      clearCapabilityCache();
      expect([...await outcomes()]).toEqual(['admitted']);
      delete process.env.FORCE_CAPABILITIES;

      process.env[flagEnv] = '';
      clearCapabilityCache();
      expect([...await outcomes()]).toEqual(['admitted']);

      process.env[flagEnv] = f.msp;
      await db('co_managed_entitlements').where({ tenant: f.msp }).delete();
      clearCapabilityCache();
      expect([...await outcomes()]).toEqual(['admitted']);

      await db('co_managed_entitlements').insert(entitlement);
      await lapse(started);
      clearCapabilityCache();
      expect(await admits('co-managed', f.msp)).toMatchObject({ admitted: true });
      expect([...await outcomes()]).toEqual(['refused']);
      await lapse(null);
      clearCapabilityCache();
      expect([...await outcomes()]).toEqual(['admitted']);

      await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId }).update({ state: 'terminated', ended_at: new Date() });
      clearCapabilityCache();
      expect([...await outcomes()]).toEqual(['refused']);
    } finally {
      registerWriteAdmissionResolver(createCoManagedWriteAdmissionResolver((conn, tenant) => readCoManagedLifecycleLockFree(conn as Knex, tenant, () => clock)));
      if (originalFlag === undefined) delete process.env[flagEnv]; else process.env[flagEnv] = originalFlag;
      if (originalForce === undefined) delete process.env.FORCE_CAPABILITIES; else process.env.FORCE_CAPABILITIES = originalForce;
      clearCapabilityCache();
      invalidateWriteAdmission(f.customer);
    }
  });

  it.each(['checker absent', 'checker unavailable'])('worker default reader enforces ended and lapsed state when the feature checker is %s without calling it', async (checkerMode) => {
    const flagEnv = flagTargetingEnvName('release-v2-0-feature');
    const checkerKey = Symbol.for('alga.core.featureFlagChecker');
    const registry = globalThis as typeof globalThis & Record<symbol, unknown>;
    const originalChecker = registry[checkerKey];
    const originalFlag = process.env[flagEnv];
    const originalForce = process.env.FORCE_CAPABILITIES;
    const checker = vi.fn(async () => { throw new Error('PostHog unavailable in worker'); });
    try {
      installCoManagedWriteAdmission();
      delete process.env.FORCE_CAPABILITIES;
      process.env[flagEnv] = f.msp;
      clearCapabilityCache();
      if (checkerMode === 'checker absent') delete registry[checkerKey];
      else registerFeatureFlagChecker(checker);

      const attempt = async () => {
        invalidateWriteAdmission(f.customer);
        await expect(admitOperationalWrite(db, f.customer, tables[0], 'worker-lifecycle-probe')).rejects.toThrow();
      };

      await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId })
        .update({ state: 'terminated', ended_at: new Date() });
      await lapse(new Date(Date.now() - GRACE_MS - DAY));
      await attempt();

      await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId })
        .update({ state: 'active', ended_at: null });
      await db('co_managed_allocations').where({ tenant: f.msp, relationship_id: f.relationshipId }).update({ state: 'active' });
      await attempt();
      expect(checker).not.toHaveBeenCalled();
    } finally {
      await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId })
        .update({ state: 'active', ended_at: null });
      await lapse(null);
      if (originalChecker === undefined) delete registry[checkerKey]; else registry[checkerKey] = originalChecker;
      if (originalFlag === undefined) delete process.env[flagEnv]; else process.env[flagEnv] = originalFlag;
      if (originalForce === undefined) delete process.env.FORCE_CAPABILITIES; else process.env.FORCE_CAPABILITIES = originalForce;
      clearCapabilityCache();
      invalidateWriteAdmission(f.customer);
    }
  });

  it('server admission keeps known flag-off neutrality and fails back to durable lifecycle state when flag evaluation is unavailable', async () => {
    const flagEnv = flagTargetingEnvName('release-v2-0-feature');
    const checkerKey = Symbol.for('alga.core.featureFlagChecker');
    const registry = globalThis as typeof globalThis & Record<symbol, unknown>;
    const originalChecker = registry[checkerKey];
    const originalFlag = process.env[flagEnv];
    const originalForce = process.env.FORCE_CAPABILITIES;
    let unavailable = false;
    const posthog = { isFeatureEnabled: vi.fn(async () => {
      if (unavailable) throw new Error('PostHog unavailable');
      return false;
    }) };
    const flags = new FeatureFlags({ clientResolver: () => posthog as any });
    try {
      delete process.env[flagEnv];
      delete process.env.FORCE_CAPABILITIES;
      registerFeatureFlagChecker((flag, context) => flags.evaluate(flag, context));
      installCoManagedWriteAdmission({ readState: readCoManagedLifecycleForServer });
      await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId })
        .update({ state: 'terminated', ended_at: new Date() });
      await lapse(new Date(Date.now() - GRACE_MS - DAY));
      clearCapabilityCache();
      expect([...await outcomes()]).toEqual(['admitted']);
      expect(posthog.isFeatureEnabled).toHaveBeenCalled();

      unavailable = true;
      flags.clearCache();
      clearCapabilityCache();
      expect([...await outcomes()]).toEqual(['refused']);
    } finally {
      await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId })
        .update({ state: 'active', ended_at: null });
      await lapse(null);
      if (originalChecker === undefined) delete registry[checkerKey]; else registry[checkerKey] = originalChecker;
      if (originalFlag === undefined) delete process.env[flagEnv]; else process.env[flagEnv] = originalFlag;
      if (originalForce === undefined) delete process.env.FORCE_CAPABILITIES; else process.env.FORCE_CAPABILITIES = originalForce;
      clearCapabilityCache();
      invalidateWriteAdmission(f.customer);
    }
  });

  it('the server lifecycle reader is neutral when admission is off, but enforces admitted lapsed and ended workspaces', async () => {
    const flagEnv = flagTargetingEnvName('release-v2-0-feature');
    const checkerKey = Symbol.for('alga.core.featureFlagChecker');
    const registry = globalThis as typeof globalThis & Record<symbol, unknown>;
    const originalChecker = registry[checkerKey];
    const originalFlag = process.env[flagEnv];
    const originalForce = process.env.FORCE_CAPABILITIES;
    const entitlement = await db('co_managed_entitlements').where({ tenant: f.msp }).first();
    const flags = new FeatureFlags({ clientResolver: () => ({ isFeatureEnabled: async () => true }) as any });
    try {
      await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId })
        .update({ state: 'active', ended_at: null });
      await db('co_managed_allocations').where({ tenant: f.msp, relationship_id: f.relationshipId }).update({ state: 'active' });
      await lapse(new Date(Date.now() - GRACE_MS - DAY));
      delete process.env.FORCE_CAPABILITIES;
      registerFeatureFlagChecker((flag, context) => flags.evaluate(flag, context));

      process.env[flagEnv] = '';
      clearCapabilityCache();
      expect((await readCoManagedLifecycleForServer(db, f.customer)).canWrite).toBe(true);

      process.env[flagEnv] = f.msp;
      await db('co_managed_entitlements').where({ tenant: f.msp }).delete();
      clearCapabilityCache();
      expect((await readCoManagedLifecycleForServer(db, f.customer)).canWrite).toBe(true);

      await db('co_managed_entitlements').insert(entitlement);
      await lapse(new Date(Date.now() - GRACE_MS - DAY));
      process.env.FORCE_CAPABILITIES = 'co-managed:off';
      clearCapabilityCache();
      expect((await readCoManagedLifecycleForServer(db, f.customer)).canWrite).toBe(true);

      delete process.env.FORCE_CAPABILITIES;
      clearCapabilityCache();
      expect(await readCoManagedLifecycleForServer(db, f.customer)).toMatchObject({ state: 'read_only', canWrite: false });

      await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId })
        .update({ state: 'terminated', ended_at: new Date() });
      clearCapabilityCache();
      expect(await readCoManagedLifecycleForServer(db, f.customer)).toMatchObject({ state: 'terminated', canWrite: false });
    } finally {
      await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId })
        .update({ state: 'active', ended_at: null });
      if (!await db('co_managed_entitlements').where({ tenant: f.msp }).first()) {
        await db('co_managed_entitlements').insert(entitlement);
      }
      await lapse(null);
      if (originalChecker === undefined) delete registry[checkerKey]; else registry[checkerKey] = originalChecker;
      if (originalFlag === undefined) delete process.env[flagEnv]; else process.env[flagEnv] = originalFlag;
      if (originalForce === undefined) delete process.env.FORCE_CAPABILITIES; else process.env.FORCE_CAPABILITIES = originalForce;
      clearCapabilityCache();
      invalidateWriteAdmission(f.customer);
    }
  });

  it.each(['throwing client', 'missing client', 'undefined result'])('server uses the real feature runtime and keeps an ended workspace read-only on %s', async (failure) => {
    const flagEnv = flagTargetingEnvName('release-v2-0-feature');
    const checkerKey = Symbol.for('alga.core.featureFlagChecker');
    const registry = globalThis as typeof globalThis & Record<symbol, unknown>;
    const originalChecker = registry[checkerKey];
    const originalFlag = process.env[flagEnv];
    const originalForce = process.env.FORCE_CAPABILITIES;
    const clientResolver = failure === 'missing client' ? () => null : () => ({
      isFeatureEnabled: async () => {
        if (failure === 'throwing client') throw new Error('PostHog unavailable');
        return undefined;
      },
    } as any);
    const flags = new FeatureFlags({ clientResolver });
    try {
      delete process.env[flagEnv];
      delete process.env.FORCE_CAPABILITIES;
      delete process.env.DISABLE_FEATURE_FLAGS;
      delete process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS;
      registerFeatureFlagChecker((flag, context) => flags.evaluate(flag, context));
      await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId })
        .update({ state: 'terminated', ended_at: new Date() });
      installCoManagedWriteAdmission({ readState: readCoManagedLifecycleForServer });
      clearCapabilityCache();
      expect([...await outcomes()]).toEqual(['refused']);
    } finally {
      await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId })
        .update({ state: 'active', ended_at: null });
      await lapse(null);
      if (originalChecker === undefined) delete registry[checkerKey]; else registry[checkerKey] = originalChecker;
      if (originalFlag === undefined) delete process.env[flagEnv]; else process.env[flagEnv] = originalFlag;
      if (originalForce === undefined) delete process.env.FORCE_CAPABILITIES; else process.env.FORCE_CAPABILITIES = originalForce;
      clearCapabilityCache();
      invalidateWriteAdmission(f.customer);
    }
  });

  it.each(['worker reader', 'server reader'])('forced-on overrides empty tenant targeting for the %s', async (readerKind) => {
    const flagEnv = flagTargetingEnvName('release-v2-0-feature');
    const originalFlag = process.env[flagEnv];
    const originalForce = process.env.FORCE_CAPABILITIES;
    try {
      process.env.FORCE_CAPABILITIES = 'co-managed:on';
      process.env[flagEnv] = '';
      await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId })
        .update({ state: 'terminated', ended_at: new Date() });
      clearCapabilityCache();
      const result = await createCoManagedWriteAdmissionResolver(readerKind === 'server reader' ? readCoManagedLifecycleForServer : undefined)(db, f.customer);
      expect(result.canWrite).toBe(false);
    } finally {
      await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId })
        .update({ state: 'active', ended_at: null });
      if (originalFlag === undefined) delete process.env[flagEnv]; else process.env[flagEnv] = originalFlag;
      if (originalForce === undefined) delete process.env.FORCE_CAPABILITIES; else process.env.FORCE_CAPABILITIES = originalForce;
      clearCapabilityCache();
      invalidateWriteAdmission(f.customer);
    }
  });

  it('a plain PSA tenant is never refused, whatever the sponsor lapse', async () => {
    invalidateWriteAdmission(f.msp);
    for (const table of tables) await admitOperationalWrite(db, f.msp, table, 'l7a-test');
  });
});
