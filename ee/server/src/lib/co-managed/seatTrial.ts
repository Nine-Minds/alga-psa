import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export type SeatTrialStatus = 'pending' | 'active' | 'base_paused' | 'expired' | 'paid' | 'checkout_pending' | 'ended';

export interface SeatTrialAdmission {
  status: SeatTrialStatus;
  activatedAt: Date | null;
  deadlineAt: Date | null;
  baseAccessUntil: Date | null;
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

    const now = await databaseNow(trx);
    if (input.baseAccessUntil && input.baseAccessUntil.getTime() <= now.getTime()) {
      return admission('pending', pilot, input.baseAccessUntil);
    }
    await sponsor.table('co_managed_seat_trials').where({ trial_id: pilot.trial_id })
      .whereNull('activated_at').update({
        state: 'active', activated_at: trx.raw('clock_timestamp()'),
        deadline_at: trx.raw("clock_timestamp() + interval '360 hours'"), updated_at: trx.fn.now(), revision: Number(pilot.revision) + 1,
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
