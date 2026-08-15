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
 * passes vacuously), so this drives the shipped action against the dev DB and
 * the real "Smoke Weighted Pool" fixture (tenant `dd8cb218…`, line
 * `8378103c…`, pool `a2222e86…`, one member with a joined service_name).
 *
 * Opt-in: needs a reachable database (RUN_DB_TESTS=1).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

import { wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
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

// The "Smoke Weighted Pool" fixture in the dev database (alga-psa-local-test).
const FIXTURE = {
  tenant: 'dd8cb218-d46d-47f3-be27-8aa50aad5fce',
  contractLineId: '8378103c-994e-40a9-9e45-56e76c87682b',
  bucketId: 'a2222e86-ed91-4f5f-86a1-7a8327a8f89a',
};

describe.skipIf(!ENABLED)('bucket pool list loads a real pool snapshot with members (real DB)', () => {
  let db: Knex;
  let listBucketPoolsForLine: any;

  beforeAll(async () => {
    wireLocalTestDbEnv();
    const { createTenantKnex } = await import('@alga-psa/db');
    db = (await createTenantKnex(FIXTURE.tenant)).knex;

    mockCurrentUser = {
      user_id: '00000000-0000-0000-0000-000000000000',
      tenant: FIXTURE.tenant,
      user_type: 'internal',
    };
    ({ listBucketPoolsForLine } = await import('@alga-psa/billing/actions/bucketPoolActions'));
  }, 120_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('loads the pool snapshot with joined member service_name (no ambiguous tenant column)', async () => {
    const expectedPool = await tenantDb(db, FIXTURE.tenant)
      .table('contract_line_buckets')
      .where({ tenant: FIXTURE.tenant, bucket_id: FIXTURE.bucketId })
      .first();
    expect(expectedPool, 'fixture pool must exist in the dev database').toBeDefined();

    const expectedMembers = await tenantDb(db, FIXTURE.tenant)
      .table('contract_line_bucket_services')
      .where({ tenant: FIXTURE.tenant, bucket_id: FIXTURE.bucketId });

    const snapshots = await listBucketPoolsForLine(FIXTURE.contractLineId);
    expect(snapshots).toBeInstanceOf(Array);

    const pool = snapshots.find((snapshot: any) => snapshot.bucket_id === FIXTURE.bucketId);
    expect(pool, 'the fixture pool must appear in the line pool list').toBeDefined();

    // The full pool config round-trips through the snapshot.
    expect(pool.bucket_name).toBe(expectedPool.bucket_name);
    expect(pool.covers_all_services).toBe(Boolean(expectedPool.covers_all_services));
    expect(Number(pool.total_minutes)).toBe(Number(expectedPool.total_minutes));
    expect(Number(pool.overage_rate)).toBe(Number(expectedPool.overage_rate));
    expect(pool.allow_rollover).toBe(Boolean(expectedPool.allow_rollover));

    // The members query must join service_catalog successfully and carry the
    // real service_name — this is the query that failed with an ambiguous
    // `tenant` column reference before the fix.
    expect(pool.members).toHaveLength(expectedMembers.length);
    for (const member of expectedMembers) {
      const snapshotMember = pool.members.find((m: any) => m.service_id === member.service_id);
      expect(snapshotMember, 'every member row must appear in the snapshot').toBeDefined();
      expect(Number(snapshotMember.burn_multiplier)).toBe(Number(member.burn_multiplier));
      const catalog = await tenantDb(db, FIXTURE.tenant)
        .table('service_catalog')
        .where({ tenant: FIXTURE.tenant, service_id: member.service_id })
        .first('service_name');
      expect(snapshotMember.service_name).toBe(catalog?.service_name ?? member.service_id);
    }
  });
});
