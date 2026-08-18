/**
 * Bucket Hours report against the canonical weighted bucket_usage ledger
 * (real DB).
 *
 * Regression coverage for the 2026-08-16 smoke defect: getBucketUsageReport
 * summed ALL-TIME raw time_entries.billable_duration (unweighted, unscoped)
 * and rounded hours, so the report disagreed with the period-scoped weighted
 * bucket_usage ledger the draw and overage-billing paths actually maintain.
 *
 * These tests drive the shipped getBucketUsageReport server action against
 * the STANDARD test database and prove:
 *   - a 2x-member entry recorded through the canonical ledger path
 *     (findOrCreateCurrentBucketUsageRecord + computeWeightedMinutes +
 *     updateBucketUsageMinutes) is reported at its WEIGHTED amount,
 *   - used/remaining/utilization/overage come from the current-period ledger
 *     row (including an over-cap pool with real overage),
 *   - raw time_entries, out-of-period bucket_usage rows, and unrelated
 *     clients/contracts do NOT contaminate a pool's totals,
 *   - a pool with no current-period usage row still reports 0 used /
 *     full remaining.
 *
 * Self-sufficient: seeds its own tenant/client/contract/line/pool/usage and
 * never depends on dev-DB fixtures (integration files share one vitest
 * process and createTestDbConnection pins DB_NAME_SERVER=test_database).
 *
 * Opt-in: needs a reachable database (RUN_DB_TESTS=1).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';
import { tenantDb } from '@alga-psa/db';
import {
  findOrCreateCurrentBucketUsageRecord,
  updateBucketUsageMinutes,
} from '@alga-psa/shared/billingClients/bucketUsageService';
import { computeWeightedMinutes } from '@alga-psa/shared/billingClients/weightedBurn';

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
      (envVar && process.env[envVar]) || fallback || ''),
  },
}));

let mockCurrentUser: any = null;

// The factories below only read mockCurrentUser lazily (at action-call time),
// which keeps them safe under vi.mock hoisting.
// contractReportActions imports withAuth from the package index while sibling
// actions import the subpath — mock both so either resolution is covered.
vi.mock('@alga-psa/auth', () => {
  const withAuth = (action: any) => async (...args: any[]) => {
    const user = mockCurrentUser;
    if (!user) {
      throw new Error('User not authenticated');
    }
    const { runWithTenant } = await import('@alga-psa/db');
    return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
  };
  return {
    withAuth,
    withOptionalAuth: withAuth,
    withAuthCheck: (action: any) => async (...args: any[]) => action(mockCurrentUser, ...args),
    getSession: async () => ({ user: undefined }),
    hasPermission: async () => true,
  };
});

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: any) => async (...args: any[]) => {
    const user = mockCurrentUser;
    if (!user) {
      throw new Error('User not authenticated');
    }
    const { runWithTenant } = await import('@alga-psa/db');
    return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
  },
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

const ENABLED = process.env.RUN_DB_TESTS === '1';

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

describe.skipIf(!ENABLED)('bucket usage report reads the period-scoped weighted ledger (real DB)', () => {
  let db: Knex;
  let tenantId: string;
  let userId: string;
  let getBucketUsageReport: any;

  // Fixture A: clean weighted pool — 120-min cap, one 30-min entry at 2x → 60
  // weighted minutes used, plus every contamination source aimed at it.
  const CONTRACT_A = `Report weighted contract ${randomUUID().slice(0, 8)}`;
  const CLIENT_A = `report-client-a-${randomUUID().slice(0, 8)}`;
  // Fixture B: unrelated client + contract with its own fully-used pool.
  const CONTRACT_B = `Report unrelated contract ${randomUUID().slice(0, 8)}`;
  const CLIENT_B = `report-client-b-${randomUUID().slice(0, 8)}`;
  // Fixture C: over-cap pool — 150 weighted minutes against a 120-min cap.
  const CONTRACT_C = `Report overage contract ${randomUUID().slice(0, 8)}`;
  const CLIENT_C = `report-client-c-${randomUUID().slice(0, 8)}`;
  // Second pool on contract A's line with no usage rows at all.
  const IDLE_POOL_MINUTES = 300;

  async function seedContract(opts: {
    scopedDb: ReturnType<typeof tenantDb>;
    contractName: string;
    clientName: string;
    serviceId: string;
    burnMultiplier: number;
    poolMinutes: number;
  }): Promise<{ clientId: string; contractId: string; contractLineId: string; bucketId: string }> {
    const { scopedDb } = opts;
    const clientId = randomUUID();
    const contractId = randomUUID();
    const contractLineId = randomUUID();
    const bucketId = randomUUID();

    await scopedDb.table('clients').insert({
      tenant: tenantId, client_id: clientId, client_name: opts.clientName,
    });
    await scopedDb.table('contracts').insert({
      tenant: tenantId, contract_id: contractId, contract_name: opts.contractName,
    });
    await scopedDb.table('contract_lines').insert({
      tenant: tenantId, contract_line_id: contractLineId, contract_id: contractId,
      contract_line_name: `${opts.contractName} line`,
      contract_line_type: 'Bucket', billing_frequency: 'monthly',
      cadence_owner: 'client', is_template: false, is_active: true,
    });
    await scopedDb.table('client_contracts').insert({
      tenant: tenantId, client_contract_id: randomUUID(), client_id: clientId,
      contract_id: contractId, start_date: '2026-01-01', end_date: null,
      is_active: true,
    });
    await scopedDb.table('contract_line_buckets').insert({
      tenant: tenantId, bucket_id: bucketId, contract_line_id: contractLineId,
      bucket_name: `${opts.contractName} pool`,
      total_minutes: opts.poolMinutes, overage_rate: 15000,
      allow_rollover: false, covers_all_services: false,
    });
    await scopedDb.table('contract_line_bucket_services').insert({
      tenant: tenantId, bucket_id: bucketId, contract_line_id: contractLineId,
      service_id: opts.serviceId, burn_multiplier: opts.burnMultiplier,
    });

    return { clientId, contractId, contractLineId, bucketId };
  }

  /**
   * Records raw entry minutes through the canonical weighted ledger path:
   * resolve the current-period usage row, weight the entry with the member
   * multiplier, and apply the weighted delta (which also recomputes overage).
   */
  async function recordWeightedEntry(
    clientId: string,
    serviceId: string,
    rawMinutes: number,
    multiplier: number,
  ): Promise<void> {
    const nowISO = new Date().toISOString();
    await db.transaction(async (trx) => {
      const record = await findOrCreateCurrentBucketUsageRecord(
        trx, clientId, serviceId, nowISO, null, tenantId,
      );
      const weighted = computeWeightedMinutes(
        {
          startTime: new Date(Date.now() - rawMinutes * 60_000),
          endTime: new Date(),
          billableDuration: rawMinutes,
        },
        multiplier,
        null,
      );
      expect(weighted.weightedMinutes).toBe(rawMinutes * multiplier);
      await updateBucketUsageMinutes(trx, record.usage_id, weighted.weightedMinutes, tenantId);
    });
  }

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    tenantId = await createTenant(db, 'Bucket usage report tenant');
    userId = await createUser(db, tenantId);

    const scopedDb = tenantDb(db, tenantId);

    let serviceTypeId = (await scopedDb.table('service_types').first('id'))?.id;
    if (!serviceTypeId) {
      serviceTypeId = randomUUID();
      await scopedDb.table('service_types').insert({
        id: serviceTypeId,
        tenant: tenantId,
        name: `Report service type ${randomUUID().slice(0, 6)}`,
        is_active: true,
      });
    }

    const serviceIdA = randomUUID();
    const serviceIdB = randomUUID();
    const serviceIdC = randomUUID();
    for (const serviceId of [serviceIdA, serviceIdB, serviceIdC]) {
      await scopedDb.table('service_catalog').insert({
        tenant: tenantId, service_id: serviceId,
        service_name: `report-svc-${serviceId.slice(0, 6)}`,
        billing_method: 'hourly',
        custom_service_type_id: serviceTypeId,
      });
    }

    const fixtureA = await seedContract({
      scopedDb, contractName: CONTRACT_A, clientName: CLIENT_A,
      serviceId: serviceIdA, burnMultiplier: 2, poolMinutes: 120,
    });
    const fixtureB = await seedContract({
      scopedDb, contractName: CONTRACT_B, clientName: CLIENT_B,
      serviceId: serviceIdB, burnMultiplier: 1, poolMinutes: 240,
    });
    const fixtureC = await seedContract({
      scopedDb, contractName: CONTRACT_C, clientName: CLIENT_C,
      serviceId: serviceIdC, burnMultiplier: 2, poolMinutes: 120,
    });

    // A second, never-used pool on contract A's line (multiple pools per line).
    await scopedDb.table('contract_line_buckets').insert({
      tenant: tenantId, bucket_id: randomUUID(),
      contract_line_id: fixtureA.contractLineId,
      bucket_name: 'Idle pool',
      total_minutes: IDLE_POOL_MINUTES, overage_rate: 15000,
      allow_rollover: false, covers_all_services: false,
    });

    // Canonical weighted writes.
    // A: one 30-minute entry at 2x → 60 weighted minutes of a 120-minute cap.
    await recordWeightedEntry(fixtureA.clientId, serviceIdA, 30, 2);
    // B: unrelated pool fully consumed (240 weighted minutes of 240).
    await recordWeightedEntry(fixtureB.clientId, serviceIdB, 240, 1);
    // C: 30 + 45 raw minutes at 2x → 150 weighted minutes of a 120-minute cap
    // → 30 weighted overage minutes.
    await recordWeightedEntry(fixtureC.clientId, serviceIdC, 30, 2);
    await recordWeightedEntry(fixtureC.clientId, serviceIdC, 45, 2);

    // Contamination aimed at fixture A — none of it may move A's totals.
    // 1. Raw, unweighted time entry (8h) on A's line: the pre-fix query summed
    //    exactly this all-time billable_duration.
    const now = new Date();
    await scopedDb.table('time_entries').insert({
      tenant: tenantId, entry_id: randomUUID(), user_id: userId,
      start_time: new Date(now.getTime() - 8 * 60 * 60_000), end_time: now,
      billable_duration: 480, service_id: serviceIdA,
      contract_line_id: fixtureA.contractLineId,
      work_date: dateOnly(now), work_timezone: 'UTC',
    });
    // 2. Out-of-period ledger row on A's own pool (previous month, huge usage).
    const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prevMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    await scopedDb.table('bucket_usage').insert({
      tenant: tenantId, usage_id: randomUUID(),
      client_id: fixtureA.clientId, contract_line_id: fixtureA.contractLineId,
      service_catalog_id: serviceIdA, bucket_id: fixtureA.bucketId,
      period_start: dateOnly(prevMonthStart), period_end: dateOnly(prevMonthEnd),
      minutes_used: 999, overage_minutes: 500, rolled_over_minutes: 0,
    });

    mockCurrentUser = {
      user_id: userId,
      tenant: tenantId,
      user_type: 'internal',
    };
    ({ getBucketUsageReport } = await import('@alga-psa/billing/actions/contractReportActions'));
  }, 180_000);

  afterAll(async () => {
    if (!db) return;
    const scopedDb = tenantDb(db, tenantId);
    for (const table of [
      'bucket_usage',
      'time_entries',
      'contract_line_bucket_services',
      'contract_line_buckets',
      'client_contracts',
      'contract_lines',
      'contracts',
      'service_catalog',
      'clients',
      'users',
    ]) {
      await scopedDb.table(table).where({ tenant: tenantId }).delete().catch(() => undefined);
    }
    await db('tenants').where({ tenant: tenantId }).delete().catch(() => undefined);
    await db.destroy().catch(() => undefined);
  });

  it('reports the 2x entry at its weighted amount from the current-period ledger, immune to raw and out-of-period data', async () => {
    const report = await getBucketUsageReport();
    expect(Array.isArray(report)).toBe(true);

    const rowsA = report.filter((row: any) => row.contract_name === CONTRACT_A);
    // Contract A carries two pools: the active 120-minute pool + the idle one.
    expect(rowsA).toHaveLength(2);

    const active = rowsA.find((row: any) => row.total_hours === 2);
    expect(active, 'the 120-minute pool row must exist').toBeDefined();
    expect(active.client_name).toBe(CLIENT_A);
    // 30 raw minutes at 2x = 60 weighted minutes = 1h — NOT the 8h raw entry,
    // NOT the 999-minute July ledger row, and NOT rounded to whole hours.
    expect(active.used_hours).toBe(1);
    expect(active.remaining_hours).toBe(1);
    expect(active.utilization_percentage).toBe(50);
    expect(active.overage_hours).toBe(0);
  });

  it('reports a pool with no current-period ledger row as untouched', async () => {
    const report = await getBucketUsageReport();
    const idle = report.find(
      (row: any) => row.contract_name === CONTRACT_A && row.total_hours === IDLE_POOL_MINUTES / 60,
    );
    expect(idle, 'the idle pool row must still be listed').toBeDefined();
    expect(idle.used_hours).toBe(0);
    expect(idle.remaining_hours).toBe(IDLE_POOL_MINUTES / 60);
    expect(idle.utilization_percentage).toBe(0);
    expect(idle.overage_hours).toBe(0);
  });

  it('keeps unrelated clients/contracts in their own rows without cross-contamination', async () => {
    const report = await getBucketUsageReport();

    const rowB = report.find((row: any) => row.contract_name === CONTRACT_B);
    expect(rowB).toBeDefined();
    expect(rowB.client_name).toBe(CLIENT_B);
    expect(rowB.total_hours).toBe(4);
    expect(rowB.used_hours).toBe(4);
    expect(rowB.remaining_hours).toBe(0);
    expect(rowB.utilization_percentage).toBe(100);
    expect(rowB.overage_hours).toBe(0);

    // And B's fully-consumed pool did not leak into A's clean row.
    const activeA = report.find(
      (row: any) => row.contract_name === CONTRACT_A && row.total_hours === 2,
    );
    expect(activeA.used_hours).toBe(1);
  });

  it('derives overage and >100% utilization from weighted ledger minutes', async () => {
    const report = await getBucketUsageReport();

    const rowC = report.find((row: any) => row.contract_name === CONTRACT_C);
    expect(rowC).toBeDefined();
    expect(rowC.client_name).toBe(CLIENT_C);
    // 75 raw minutes at 2x = 150 weighted of 120: 2.5h used, 0 remaining,
    // 0.5h overage, 125% utilization — fractional hours preserved.
    expect(rowC.total_hours).toBe(2);
    expect(rowC.used_hours).toBe(2.5);
    expect(rowC.remaining_hours).toBe(0);
    expect(rowC.overage_hours).toBe(0.5);
    expect(rowC.utilization_percentage).toBe(125);
  });
});
