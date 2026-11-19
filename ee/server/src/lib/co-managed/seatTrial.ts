import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { randomUUID } from 'node:crypto';
import { createCoManagedSeatArrangement, inviteCoManagedSeatTechnician, refreshCoManagedSeatInvitation, revokeCoManagedSeatInvitation, setCoManagedSeatBoardScope } from '@alga-psa/co-managed';
import { lockCoManagedSponsorPool } from '@alga-psa/licensing';

export type SeatTrialStatus = 'pending' | 'active' | 'base_paused' | 'expired' | 'paid' | 'checkout_pending' | 'ended';

export interface SeatTrialAdmission {
  status: SeatTrialStatus;
  activatedAt: Date | null;
  deadlineAt: Date | null;
  baseAccessUntil: Date | null;
}

/** Bind a hosted Pro sponsor's one-seat pilot before the caller attempts email delivery. */
export async function prepareCoManagedSeatTrial(db: Knex, input: {
  tenant: string; clientId: string; contactId: string; operationId: string; boards: Array<{ boardId: string; canCreate: boolean }>;
  invitedBy?: string;
}) {
  return db.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', ['internal_user_seats', input.tenant]);
    await lockCoManagedSponsorPool(trx, input.tenant);
    const sponsor = tenantDb(trx, input.tenant);
    const owner = await sponsor.table('tenants').first('product_code', 'plan', 'suspended_at');
    const entitlement = await sponsor.table('co_managed_entitlements').first('source');
    if (owner?.product_code !== 'psa' || owner.plan !== 'pro' || owner.suspended_at ||
        (entitlement && entitlement.source !== 'hosted')) throw new Error('SPONSOR_NOT_ELIGIBLE');
    const existing = await sponsor.table('co_managed_seat_trials').forUpdate().first();
    if (existing?.state === 'pending') {
      if (existing.client_id !== input.clientId) throw new Error('TRIAL_CLAIM_UNAVAILABLE');
      const invitation = await refreshCoManagedSeatInvitation(trx, { sponsorTenant: input.tenant, assignmentId: existing.assignment_id });
      return { trialId: existing.trial_id, arrangementId: existing.arrangement_id, assignmentId: existing.assignment_id, invitation };
    }
    if (existing && (existing.activated_at || existing.state !== 'ended')) throw new Error('TRIAL_CLAIM_UNAVAILABLE');
    const arrangement = await createCoManagedSeatArrangement(trx, { sponsorTenant: input.tenant, clientId: input.clientId,
      operationId: input.operationId, seats: 1, fundingSource: 'seat_trial' });
    await setCoManagedSeatBoardScope(trx, { sponsorTenant: input.tenant, arrangementId: arrangement.arrangement_id, boards: input.boards });
    const invitation = await inviteCoManagedSeatTechnician(trx, { sponsorTenant: input.tenant, arrangementId: arrangement.arrangement_id,
      contactId: input.contactId, invitedBy: input.invitedBy, allowTrialFunding: true });
    const trialId = randomUUID();
    if (existing) {
      await sponsor.table('co_managed_seat_trials').where({ trial_id: existing.trial_id }).update({ client_id: input.clientId,
        arrangement_id: arrangement.arrangement_id, allocation_id: arrangement.allocation_id, assignment_id: invitation.assignment_id,
        state: 'pending', activated_at: null, deadline_at: null, conversion_state: 'none', conversion_operation_id: null,
        quoted_quantity: null, updated_at: trx.fn.now(), revision: Number(existing.revision) + 1 });
      return { trialId: existing.trial_id, arrangementId: arrangement.arrangement_id, assignmentId: invitation.assignment_id, invitation };
    }
    await sponsor.table('co_managed_seat_trials').insert({ tenant: input.tenant, trial_id: trialId, client_id: input.clientId,
      arrangement_id: arrangement.arrangement_id, allocation_id: arrangement.allocation_id,
      assignment_id: invitation.assignment_id, state: 'pending' });
    return { trialId, arrangementId: arrangement.arrangement_id, assignmentId: invitation.assignment_id, invitation };
  });
}

/** Replace only an unaccepted invite; the same client and sponsor claim remain bound. */
export async function replaceCoManagedSeatTrialTechnician(db: Knex, input: { tenant: string; trialId: string; contactId: string; invitedBy?: string }) {
  return db.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', ['internal_user_seats', input.tenant]);
    await lockCoManagedSponsorPool(trx, input.tenant);
    const sponsor = tenantDb(trx, input.tenant);
    const pilot = await sponsor.table('co_managed_seat_trials').where({ trial_id: input.trialId, state: 'pending' }).forUpdate().first();
    if (!pilot || pilot.activated_at) throw new Error('TRIAL_CLAIM_UNAVAILABLE');
    await revokeCoManagedSeatInvitation(trx, { sponsorTenant: input.tenant, assignmentId: pilot.assignment_id });
    const invitation = await inviteCoManagedSeatTechnician(trx, { sponsorTenant: input.tenant, arrangementId: pilot.arrangement_id,
      contactId: input.contactId, invitedBy: input.invitedBy, allowTrialFunding: true });
    await sponsor.table('co_managed_seat_trials').where({ trial_id: pilot.trial_id }).update({ assignment_id: invitation.assignment_id,
      updated_at: trx.fn.now(), revision: Number(pilot.revision) + 1 });
    return { ...pilot, assignment_id: invitation.assignment_id, invitation };
  });
}

export async function resumeCoManagedSeatTrialInvitation(db: Knex, input: { tenant: string; trialId: string }) {
  const pilot = await tenantDb(db, input.tenant).table('co_managed_seat_trials').where({ trial_id: input.trialId, state: 'pending' }).first();
  if (!pilot || pilot.activated_at) throw new Error('TRIAL_CLAIM_UNAVAILABLE');
  return refreshCoManagedSeatInvitation(db, { sponsorTenant: input.tenant, assignmentId: pilot.assignment_id });
}

/** Cancel an unactivated offer; the sponsor claim row remains available for replacement. */
export async function cancelCoManagedSeatTrial(db: Knex, input: { tenant: string; trialId: string }) {
  return db.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', ['internal_user_seats', input.tenant]);
    await lockCoManagedSponsorPool(trx, input.tenant);
    const sponsor = tenantDb(trx, input.tenant);
    const pilot = await sponsor.table('co_managed_seat_trials').where({ trial_id: input.trialId }).forUpdate().first();
    if (!pilot || pilot.state !== 'pending' || pilot.activated_at) throw new Error('TRIAL_CLAIM_UNAVAILABLE');
    await revokeCoManagedSeatInvitation(trx, { sponsorTenant: input.tenant, assignmentId: pilot.assignment_id });
    await sponsor.table('co_managed_seat_arrangements').where({ arrangement_id: pilot.arrangement_id }).update({ state: 'ended', ended_at: trx.fn.now() });
    await sponsor.table('co_managed_allocations').where({ allocation_id: pilot.allocation_id }).update({ state: 'released', released_at: trx.fn.now() });
    await sponsor.table('co_managed_seat_trials').where({ trial_id: pilot.trial_id }).update({ state: 'ended', updated_at: trx.fn.now(), revision: Number(pilot.revision) + 1 });
    return { cancelled: true };
  });
}

/**
 * First authenticated interactive Seat admission. The host must call this only after it has
 * authenticated the bound technician, completed required MFA, rejected API keys/impersonation,
 * and resolved current canonical base access. The DB row lock and DB clock make concurrent
 * sessions converge on one immutable 360-hour window.
 */
export async function activateCoManagedSeatTrial(
  db: Knex,
  input: { tenant: string; userId: string; interactive: true; mfaComplete: true; baseAccessUntil: Date | null },
): Promise<SeatTrialAdmission | null> {
  return db.transaction(async (trx) => {
    // Stable even when this sponsor has no purchased co-managed entitlement row.
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', ['co_managed_seat_trial', input.tenant]);
    const sponsor = tenantDb(trx, input.tenant);
    const assignment = await sponsor.table('co_managed_seat_assignments')
      .where({ user_id: input.userId, state: 'active' }).forUpdate().first('assignment_id', 'arrangement_id');
    if (!assignment) return null;
    const pilot = await sponsor.table('co_managed_seat_trials')
      .where({ assignment_id: assignment.assignment_id }).forUpdate().first();
    if (!pilot) return null;
    if (pilot.state === 'paid') return admission('paid', pilot, input.baseAccessUntil);
    if (pilot.state === 'ended') return admission('ended', pilot, input.baseAccessUntil);
    if (pilot.activated_at) return decideAdmission(pilot, input.baseAccessUntil, await databaseNow(trx));
    if (pilot.state !== 'pending' || !input.interactive || !input.mfaComplete) {
      return admission('pending', pilot, input.baseAccessUntil);
    }

    const clock = await trx.raw("SELECT clock_timestamp() AS now, clock_timestamp() + interval '360 hours' AS deadline");
    const now = new Date(clock.rows[0].now);
    if (input.baseAccessUntil && input.baseAccessUntil.getTime() <= now.getTime()) {
      return admission('pending', pilot, input.baseAccessUntil);
    }
    await sponsor.table('co_managed_seat_trials').where({ trial_id: pilot.trial_id })
      .whereNull('activated_at').update({
        state: 'active', activated_at: now, deadline_at: new Date(clock.rows[0].deadline), updated_at: now, revision: Number(pilot.revision) + 1,
      });
    const activated = await sponsor.table('co_managed_seat_trials').where({ trial_id: pilot.trial_id }).first();
    await sponsor.table('co_managed_seat_trial_milestones').insert({
      tenant: input.tenant, trial_id: pilot.trial_id, milestone: 'technician_sign_in',
    }).onConflict(['tenant', 'trial_id', 'milestone']).ignore();
    return decideAdmission(activated, input.baseAccessUntil, now);
  });
}

/** Resolve access for every Seat admission. A base lapse pauses only until the original pilot deadline. */
export async function readCoManagedSeatTrialAdmission(
  db: Knex | Knex.Transaction,
  input: { tenant: string; assignmentId: string; baseAccessUntil: Date | null },
): Promise<SeatTrialAdmission | null> {
  const sponsor = tenantDb(db, input.tenant);
  const pilot = await sponsor.table('co_managed_seat_trials').where({ assignment_id: input.assignmentId }).first();
  if (!pilot) return null;
  if (pilot.state === 'paid') return admission('paid', pilot, input.baseAccessUntil);
  if (pilot.state === 'ended') return admission('ended', pilot, input.baseAccessUntil);
  if (!pilot.activated_at) return admission('pending', pilot, input.baseAccessUntil);
  return decideAdmission(pilot, input.baseAccessUntil, await databaseNow(db));
}

/** Idempotent milestone receipt. Callers record only verified technician/staff work on the same scoped ticket. */
export async function recordCoManagedSeatTrialMilestone(
  db: Knex | Knex.Transaction,
  input: { tenant: string; trialId: string; milestone: 'technician_sign_in' | 'shared_ticket_work' | 'converted' },
): Promise<void> {
  await tenantDb(db, input.tenant).table('co_managed_seat_trial_milestones').insert({
    tenant: input.tenant, trial_id: input.trialId, milestone: input.milestone,
  }).onConflict(['tenant', 'trial_id', 'milestone']).ignore();
}

async function databaseNow(db: Knex | Knex.Transaction): Promise<Date> {
  const result = await db.raw('SELECT clock_timestamp() AS now');
  return new Date(result.rows[0].now);
}

function admission(status: SeatTrialStatus, pilot: Record<string, unknown>, baseAccessUntil: Date | null): SeatTrialAdmission {
  return {
    status,
    activatedAt: pilot.activated_at ? new Date(pilot.activated_at as string | Date) : null,
    deadlineAt: pilot.deadline_at ? new Date(pilot.deadline_at as string | Date) : null,
    baseAccessUntil,
  };
}

function decideAdmission(pilot: Record<string, unknown>, baseAccessUntil: Date | null, now: Date): SeatTrialAdmission {
  const deadline = pilot.deadline_at ? new Date(pilot.deadline_at as string | Date) : null;
  const status: SeatTrialStatus = !deadline || deadline.getTime() <= now.getTime()
    ? 'expired'
    : baseAccessUntil && baseAccessUntil.getTime() <= now.getTime() ? 'base_paused' : 'active';
  return admission(status, pilot, baseAccessUntil);
}
