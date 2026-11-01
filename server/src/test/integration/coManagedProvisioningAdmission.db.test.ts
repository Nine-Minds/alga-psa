/**
 * L7a regression on real Postgres: with `installCoManagedWriteAdmission()` installed with its DEFAULTS, the guarded
 * writes performed by co-managed bootstrap/acceptance are admitted while the relationship is `provisioning` or
 * `pending_acceptance` (main's L0c answered `independent` here). Ended and lapsed workspaces stay refused.
 */
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OPERATIONAL_WRITE_TABLES, admitOperationalWrite, resetWriteAdmissionResolver } from '@alga-psa/db';
import { invalidateWriteAdmission } from '@alga-psa/db/writeAdmission';
import { GRACE_MS } from '@alga-psa/licensing';
import { installCoManagedWriteAdmission } from '@alga-psa/licensing/co-managed-write-admission';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { seedBoundaryFixture, type BoundaryFixture } from './coManagedArchiveBoundaryCases';

const describeDb = await describeWithDb();

describeDb('co-managed provisioning writes under the default write-admission reader', { shuffle: false }, () => {
  let db: Knex; let f: BoundaryFixture;
  const tables = Object.keys(OPERATIONAL_WRITE_TABLES);
  const outcomes = async () => {
    invalidateWriteAdmission(f.customer);
    return new Set(await Promise.all(tables.map(async table => {
      try { await admitOperationalWrite(db, f.customer, table, 'l7a-provisioning-test'); return 'admitted'; } catch { return 'refused'; }
    })));
  };
  const setState = (state: string, extra: object = {}) =>
    db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId }).update({ state, ...extra });

  beforeAll(async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    db = await createTestDbConnection({ databaseName: 'l7a_provisioning_admission_test' });
    f = await seedBoundaryFixture(db);
    installCoManagedWriteAdmission(); // defaults: L7a's lock-free reader
  }, 300_000);
  afterAll(async () => { resetWriteAdmissionResolver(); delete process.env.FORCE_CAPABILITIES; await db?.destroy(); });
  beforeEach(() => { invalidateWriteAdmission(f.customer); });

  it.each(['provisioning', 'pending_acceptance'])('admits every guarded write while the relationship is %s', async (state) => {
    await setState(state);
    // During provisioning the seats are only reserved and no accepted_at exists yet.
    await db('co_managed_allocations').where({ tenant: f.msp, relationship_id: f.relationshipId }).update({ state: 'reserved' });
    expect([...await outcomes()]).toEqual(['admitted']);
  });

  it('once active with an allocation, writes are admitted; a lapse past grace is refused', async () => {
    await setState('active');
    await db('co_managed_allocations').where({ tenant: f.msp, relationship_id: f.relationshipId }).update({ state: 'active' });
    expect([...await outcomes()]).toEqual(['admitted']);
    const started = new Date(Date.now() - GRACE_MS - 86_400_000);
    await db('co_managed_entitlements').where({ tenant: f.msp }).update({ lapse_started_at: started, read_only_after: new Date(started.getTime() + GRACE_MS) });
    expect([...await outcomes()]).toEqual(['refused']);
    await db('co_managed_entitlements').where({ tenant: f.msp }).update({ lapse_started_at: null, read_only_after: null });
  });

  it('an ended relationship is refused', async () => {
    await setState('terminated', { ended_at: new Date() });
    expect([...await outcomes()]).toEqual(['refused']);
  });
});
