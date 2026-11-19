import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { acceptCoManagedSeatInvitation } from '@alga-psa/co-managed';
import { readCoManagedPoolCapacity, reserveAndActivateCoManagedSeatAllocation } from '@alga-psa/licensing';
import { activateCoManagedSeatTrial, prepareCoManagedSeatTrial, readCoManagedSeatTrialAdmission } from '../../../../ee/server/src/lib/co-managed/seatTrial';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, ensureContactWithEmail } from '../../../test-utils/testDataFactory';

const describeDb = await describeWithDb();

describeDb('co-managed Seat trial admission on migrated PostgreSQL', { shuffle: false }, () => {
  let db: Knex;
  beforeAll(async () => { db = await createTestDbConnection({ databaseName: 'seat_trial_admission_test' }); }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  it('acceptance leaves the clock empty; concurrent first sessions establish one 360-hour window', async () => {
    const tenant = await createTenant(db, `Seat trial ${randomUUID()}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`,
      capacity: 0, verified_at: new Date(Date.now() - 60_000), valid_until: new Date(Date.now() + 86_400_000) });
    const client = await createClient(db, tenant, `Trial client ${randomUUID()}`);
    const contactId = await ensureContactWithEmail(db, tenant, client, `${randomUUID()}@client.example`, 'Taylor Technician');
    const operationId = randomUUID();
    const prepared = await prepareCoManagedSeatTrial(db, { tenant, clientId: client, contactId, operationId, boards: [] });
    const arrangement = await db('co_managed_seat_arrangements').where({ tenant, arrangement_id: prepared.arrangementId }).first();
    const allocation = await db('co_managed_allocations').where({ tenant, allocation_id: arrangement.allocation_id }).first();
    expect(allocation).toMatchObject({ seats: 1, funding_source: 'seat_trial' });
    expect((await db('co_managed_entitlements').where({ tenant }).first()).capacity).toBe(0);
    await expect(reserveAndActivateCoManagedSeatAllocation(db, { sponsorTenant: tenant, clientId: client,
      operationId, seats: 1, fundingSource: 'paid' })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    const accepted = await acceptCoManagedSeatInvitation(db, { token: prepared.invitation.token, password: 'Correct-horse-9-battery' });
    const assignment = await db('co_managed_seat_assignments').where({ tenant, user_id: accepted.user_id }).first();
    const trialId = prepared.trialId;
    expect(assignment.assignment_id).toBe(prepared.assignmentId);

    expect((await db('co_managed_seat_trials').where({ tenant, trial_id: trialId }).first()).activated_at).toBeNull();
    const baseEnd = new Date(Date.now() + 2 * 86_400_000);
    const starts = await Promise.all([
      activateCoManagedSeatTrial(db, { tenant, userId: accepted.user_id, interactive: true, mfaComplete: true, baseAccessUntil: baseEnd }),
      activateCoManagedSeatTrial(db, { tenant, userId: accepted.user_id, interactive: true, mfaComplete: true, baseAccessUntil: baseEnd }),
    ]);
    expect(starts).toHaveLength(2);
    expect(starts[0]?.status).toBe('active');
    expect(starts[1]?.status).toBe('active');
    expect(starts[0]?.activatedAt?.getTime()).toBe(starts[1]?.activatedAt?.getTime());
    expect(starts[0]?.deadlineAt?.getTime()).toBe(starts[1]?.deadlineAt?.getTime());
    expect(starts[0]!.deadlineAt!.getTime() - starts[0]!.activatedAt!.getTime()).toBe(360 * 60 * 60 * 1000);

    expect(await readCoManagedSeatTrialAdmission(db, { tenant, assignmentId: assignment.assignment_id,
      baseAccessUntil: new Date(Date.now() - 1_000) })).toMatchObject({ status: 'base_paused' });
    const restored = await readCoManagedSeatTrialAdmission(db, { tenant, assignmentId: assignment.assignment_id, baseAccessUntil: null });
    expect(restored).toMatchObject({ status: 'active' });
    expect(restored?.deadlineAt?.getTime()).toBe(starts[0]?.deadlineAt?.getTime());
    expect(await db('co_managed_seat_trial_milestones').where({ tenant, trial_id: trialId, milestone: 'technician_sign_in' })).toHaveLength(1);
  });

  it('prepares a hosted Pro trial without an entitlement row and without changing the base user count', async () => {
    const tenant = await createTenant(db, `Seat trial no pool ${randomUUID()}`, { productCode: 'psa' });
    const client = await createClient(db, tenant, `Trial client ${randomUUID()}`);
    const contactId = await ensureContactWithEmail(db, tenant, client, `${randomUUID()}@client.example`, 'Morgan Technician');
    const usersBefore = await db('users').where({ tenant }).count('* as count').first();

    const prepared = await prepareCoManagedSeatTrial(db, { tenant, clientId: client, contactId, operationId: randomUUID(), boards: [] });

    expect(await db('co_managed_entitlements').where({ tenant }).first()).toBeUndefined();
    const pilot = await db('co_managed_seat_trials').where({ tenant, trial_id: prepared.trialId }).first();
    expect(await db('co_managed_allocations').where({ tenant, allocation_id: pilot.allocation_id }).first())
      .toMatchObject({ funding_source: 'seat_trial', seats: 1 });
    await db.transaction(async (trx) => expect(await readCoManagedPoolCapacity(trx, tenant, 0))
      .toMatchObject({ purchased: 0, allocated: 0, available: 0 }));
    const usersAfter = await db('users').where({ tenant }).count('* as count').first();
    expect(String(usersAfter?.count ?? 0)).toBe(String(usersBefore?.count ?? 0));
  });
});
