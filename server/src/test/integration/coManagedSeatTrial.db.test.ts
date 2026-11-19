import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { acceptCoManagedSeatInvitation, createCoManagedSeatArrangement, inviteCoManagedSeatTechnician } from '@alga-psa/co-managed';
import { activateCoManagedSeatTrial, readCoManagedSeatTrialAdmission } from '../../../../ee/server/src/lib/co-managed/seatTrial';
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
      capacity: 1, verified_at: new Date(Date.now() - 60_000), valid_until: new Date(Date.now() + 86_400_000) });
    const client = await createClient(db, tenant, `Trial client ${randomUUID()}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId: client, operationId: randomUUID(), seats: 1 });
    const contactId = await ensureContactWithEmail(db, tenant, client, `${randomUUID()}@client.example`, 'Taylor Technician');
    const invitation = await inviteCoManagedSeatTechnician(db, { sponsorTenant: tenant,
      arrangementId: arrangement.arrangement_id, contactId });
    const accepted = await acceptCoManagedSeatInvitation(db, { token: invitation.token, password: 'Correct-horse-9-battery' });
    const assignment = await db('co_managed_seat_assignments').where({ tenant, user_id: accepted.user_id }).first();
    await db('co_managed_allocations').where({ tenant, allocation_id: arrangement.allocation_id })
      .update({ funding_source: 'seat_trial' });
    const trialId = randomUUID();
    await db('co_managed_seat_trials').insert({ tenant, trial_id: trialId, client_id: client,
      arrangement_id: arrangement.arrangement_id, allocation_id: arrangement.allocation_id,
      assignment_id: assignment.assignment_id, state: 'pending' });

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
});
