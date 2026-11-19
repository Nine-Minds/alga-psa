import { getConnection, tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

async function admitSeatTrialAccess(tenant: string, userId: string, db: Knex | undefined, sessionId?: string) {
  const conn = db ?? await getConnection(tenant);
  const home = tenantDb(conn, tenant);
  const member = await home.table('authorization_resolver_subjects')
    .where({ resolver_id: 'co-managed-seat', user_id: userId }).first('user_id');
  if (!member) return true;
  const binding = home.table('co_managed_seat_assignments as a').where({ 'a.user_id': userId, 'a.state': 'active' });
  home.tenantJoin(binding, 'co_managed_seat_arrangements as r', 'r.arrangement_id', 'a.arrangement_id');
  home.tenantJoin(binding, 'co_managed_allocations as f', 'f.allocation_id', 'r.allocation_id');
  const subject = await binding.where('f.funding_source', 'seat_trial').first('a.assignment_id');
  if (!subject) return true;
  // Active sessions consult the same current-time grant as the record reader. Only a
  // pending pilot needs to serialize a transition with invitation and capacity writers.
  const current = await home.table('co_managed_trial_access').where({ assignment_id: subject.assignment_id }).first('assignment_id');
  if (!sessionId) return Boolean(current);
  let admitted = Boolean(current);
  if (!current) {
    const { activateCoManagedSeatTrial } = await import('./seatTrial');
    const result = await activateCoManagedSeatTrial(conn, { tenant, userId, sessionId });
    admitted = result?.status === 'active' || result?.status === 'paid';
  }
  try {
    const { after } = await import('next/server');
    after(async () => {
      const { reportSeatTrialMilestones } = await import('./seatTrialAnalytics');
      await reportSeatTrialMilestones(conn, tenant);
    });
  } catch {
    // Non-request callers have no response lifecycle. Receipts remain available to the
    // next session, sponsor overview or payment reconciliation.
  }
  return admitted;
}

/** A validated browser session can start an eligible pending pilot. */
export function admitSeatTrialSession(tenant: string, userId: string, sessionId: string, db?: Knex) {
  return admitSeatTrialAccess(tenant, userId, db, sessionId);
}

/** A mobile/API credential can use an existing grant, but cannot start the clock. */
export function admitSeatTrialCredential(tenant: string, userId: string, db: Knex) {
  return admitSeatTrialAccess(tenant, userId, db);
}
