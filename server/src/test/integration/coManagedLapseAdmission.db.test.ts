/**
 * L7a A3/A4 on real Postgres: the lapse state machine (injected clock) enforced through the L0c
 * write-admission choke point, for every table in OPERATIONAL_WRITE_TABLES.
 *   grace -> writes still admitted; read_only -> every operational write refused, reads succeed;
 *   renewal -> writes restored; ended relationship -> reads kept, every write refused.
 */
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { OPERATIONAL_WRITE_TABLES, admitOperationalWrite, registerWriteAdmissionResolver, resetWriteAdmissionResolver } from '@alga-psa/db';
import { invalidateWriteAdmission } from '@alga-psa/db/writeAdmission';
import { GRACE_MS, readCoManagedLifecycleLockFree } from '@alga-psa/licensing';
import { createCoManagedWriteAdmissionResolver } from '@alga-psa/licensing/co-managed-write-admission';
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

  it('a plain PSA tenant is never refused, whatever the sponsor lapse', async () => {
    invalidateWriteAdmission(f.msp);
    for (const table of tables) await admitOperationalWrite(db, f.msp, table, 'l7a-test');
  });
});
