/**
 * Bucket pool action snapshot against a real Postgres (real DB).
 *
 * Regression coverage for the loadPoolSnapshot ambiguous-`tenant` bug: the
 * members query aliased `contract_line_bucket_services as clbs` and then
 * `.where({ tenant, ... })` UNQUALIFIED, while left-joining `service_catalog
 * as sc` — which also has a `tenant` column. Postgres rejects the ambiguous
 * column reference, `listBucketPoolsForLine` 500s, and the pool editor hangs
 * on "Loading bucket pools…".
 *
 * The ambiguity only manifests against real Postgres (a mocked knex test
 * passes vacuously), so this drives the shipped action against the STANDARD
 * test database (`createTestDbConnection` → `test_database`), seeding its own
 * tenant, service, pool, and member row so it never depends on dev-DB
 * fixtures. Integration test files share one vitest process and
 * `createTestDbConnection` sets `process.env.DB_NAME_SERVER='test_database'`
 * process-wide, so a dev-DB fixture (like the "Smoke Weighted Pool") is not
 * reachable from here.
 *
 * Opt-in: needs a reachable database (RUN_DB_TESTS=1).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { randomUUID } from 'node:crypto';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { createTenant } from '../../../test-utils/testDataFactory';
import { tenantDb } from '@alga-psa/db';

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

describe.skipIf(!ENABLED)('bucket pool list loads a real pool snapshot with members (real DB)', () => {
  let db: Knex;
  let tenantId: string;
  let contractLineId: string;
  let bucketId: string;
  let serviceId: string;
  let listBucketPoolsForLine: any;

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    tenantId = await createTenant(db, 'Bucket pool actions tenant');

    const scopedDb = tenantDb(db, tenantId);

    let serviceTypeId = (await scopedDb.table('service_types').first('id'))?.id;
    if (!serviceTypeId) {
      await scopedDb.table('service_types').insert({
        id: randomUUID(),
        tenant: tenantId,
        name: `Bucket pool service type ${uuidv4().slice(0, 6)}`,
        is_active: true,
      });
      serviceTypeId = (await scopedDb.table('service_types').first('id'))?.id;
    }

    serviceId = randomUUID();
    await scopedDb.table('service_catalog').insert({
      tenant: tenantId,
      service_id: serviceId,
      service_name: `pool-svc-${serviceId.slice(0, 6)}`,
      billing_method: 'hourly',
      custom_service_type_id: serviceTypeId,
    });

    const contractId = randomUUID();
    contractLineId = randomUUID();
    await scopedDb.table('contracts').insert({
      tenant: tenantId,
      contract_id: contractId,
      contract_name: `Bucket pool contract ${uuidv4().slice(0, 6)}`,
    });
    await scopedDb.table('contract_lines').insert({
      tenant: tenantId,
      contract_line_id: contractLineId,
      contract_id: contractId,
      contract_line_name: 'Bucket pool line',
      contract_line_type: 'Bucket',
      billing_frequency: 'monthly',
      cadence_owner: 'client',
      is_template: false,
      is_active: true,
    });

    bucketId = randomUUID();
    await scopedDb.table('contract_line_buckets').insert({
      tenant: tenantId,
      bucket_id: bucketId,
      contract_line_id: contractLineId,
      bucket_name: 'Self-sufficient pool',
      total_minutes: 600,
      overage_rate: 15000,
      allow_rollover: false,
      covers_all_services: false,
    });
    await scopedDb.table('contract_line_bucket_services').insert({
      tenant: tenantId,
      bucket_id: bucketId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      burn_multiplier: 2,
    });

    mockCurrentUser = {
      user_id: '00000000-0000-0000-0000-000000000000',
      tenant: tenantId,
      user_type: 'internal',
    };
    ({ listBucketPoolsForLine } = await import('@alga-psa/billing/actions/bucketPoolActions'));
  }, 180_000);

  afterAll(async () => {
    const scopedDb = tenantDb(db, tenantId);
    await scopedDb.table('contract_line_bucket_services').where({ tenant: tenantId }).delete();
    await scopedDb.table('contract_line_buckets').where({ tenant: tenantId }).delete();
    await scopedDb.table('service_catalog').where({ tenant: tenantId }).delete();
    await scopedDb.table('service_types').where({ tenant: tenantId }).delete();
    await scopedDb.table('contract_lines').where({ tenant: tenantId }).delete();
    await scopedDb.table('contracts').where({ tenant: tenantId }).delete();
    await scopedDb.table('tenants').where({ tenant: tenantId }).delete();
    await db?.destroy().catch(() => undefined);
  });

  it('loads the pool snapshot with joined member service_name (no ambiguous tenant column)', async () => {
    const snapshots = await listBucketPoolsForLine(contractLineId);
    expect(snapshots).toBeInstanceOf(Array);

    const pool = snapshots.find((snapshot: any) => snapshot.bucket_id === bucketId);
    expect(pool, 'the seeded pool must appear in the line pool list').toBeDefined();

    // The full pool config round-trips through the snapshot.
    expect(pool.bucket_name).toBe('Self-sufficient pool');
    expect(pool.covers_all_services).toBe(false);
    expect(Number(pool.total_minutes)).toBe(600);
    expect(Number(pool.overage_rate)).toBe(15000);
    expect(pool.allow_rollover).toBe(false);

    // The members query must join service_catalog successfully and carry the
    // real service_name — this is the query that failed with an ambiguous
    // `tenant` column reference before the fix.
    expect(pool.members).toHaveLength(1);
    expect(pool.members[0].service_id).toBe(serviceId);
    expect(pool.members[0].service_name).toBe(`pool-svc-${serviceId.slice(0, 6)}`);
    expect(Number(pool.members[0].burn_multiplier)).toBe(2);
    expect(pool.dormant).toBe(false);
  });
});
