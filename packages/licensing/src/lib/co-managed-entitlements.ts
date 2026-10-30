import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { verifyLicense } from './verify-license';
import { isLicenseVerifyFailure } from './license-types';

const GRACE_MS = 30 * 86_400_000;

export interface CoManagedEntitlementState {
  capacity: number;
  allocated: number;
  available: number;
  canGrow: boolean;
  isReadOnly: boolean;
  graceEndsAt: string | null;
}

async function databaseNow(trx: Knex.Transaction): Promise<Date> {
  const result = await trx.raw('SELECT clock_timestamp() AS now');
  return new Date(result.rows[0].now);
}

async function allocatedSeats(trx: Knex.Transaction, sponsor: string): Promise<number> {
  const result = await tenantDb(trx, sponsor).table('co_managed_allocations')
    .whereNot('state', 'released').sum('seats as used').first();
  return Number(result?.used ?? 0);
}

function signedCapacity(row: any, sponsor: string, now: Date): { capacity: number; active: boolean } {
  // hosted rows are written by the billing adapter and admin_grant rows by an operator;
  // neither carries a signature, so the row's own capacity is the grant.
  if (row.source === 'hosted' || row.source === 'admin_grant') return { capacity: row.capacity, active: true };
  if (row.source !== 'self_host') return { capacity: 0, active: false };
  const license = verifyLicense(row.signed_license);
  if (isLicenseVerifyFailure(license) || license.claims.aud !== sponsor || license.claims.tier !== 'pro' ||
      license.claims.exp * 1000 <= now.getTime()) return { capacity: 0, active: false };
  return { capacity: license.claims.co_managed_seats ?? 0, active: true };
}

/** Caller holds the sponsor entitlement row lock. Expiry is evaluated on demand
 * so delayed webhooks/workers cannot extend a customer's grace period. */
/** A hosted row that was never verified active: created at capacity 0 (valid_until == verified_at)
 * and still without a lapse. A pool that never opened has nothing to lapse, so no grace clock. */
export function neverActivated(row: { source: string; lapse_started_at?: unknown; valid_until: unknown; verified_at: unknown }): boolean {
  return row.source === 'hosted' && !row.lapse_started_at &&
    new Date(row.valid_until as string).getTime() <= new Date(row.verified_at as string).getTime();
}

export async function materializeState(trx: Knex.Transaction, sponsor: string, row: any, now: Date,
  inactiveSince?: Date, neverActive: boolean = neverActivated(row)): Promise<CoManagedEntitlementState> {
  const allocated = await allocatedSeats(trx, sponsor);
  const owner = await tenantDb(trx, sponsor).table('tenants').forShare().first('product_code', 'plan', 'suspended_at');
  now = await databaseNow(trx);
  const signed = signedCapacity(row, sponsor, now);
  const expires = new Date(row.valid_until);
  // A suspended sponsor (cancelled and awaiting deletion) sponsors nothing new:
  // its capacity lapses like an expired license, so setups and acceptance stop
  // and live workspaces get the usual grace. Lifting the suspension restores it.
  const eligible = owner?.product_code === 'psa' && !owner.suspended_at && (row.source !== 'hosted' || owner.plan === 'pro');
  const active = eligible && signed.active && expires.getTime() > now.getTime();
  const capacity = active ? signed.capacity : 0;
  // LEVERAGE: friction co-managed-never-active — lapse is derived from row columns, so "never active" must be re-derived from valid_until/verified_at.
  const lapsed = (!active || capacity < allocated) && !(neverActive && allocated === 0);
  let start: Date | null = null;
  if (lapsed) {
    start = row.lapse_started_at ? new Date(row.lapse_started_at) : new Date(Math.min(
      now.getTime(), expires.getTime(), inactiveSince?.getTime() ?? now.getTime(),
    ));
  }
  const deadline = start ? new Date(start.getTime() + GRACE_MS) : null;
  if ((row.lapse_started_at ? new Date(row.lapse_started_at).getTime() : null) !== (start?.getTime() ?? null)) {
    // write-admission: exempt — sponsor entitlement lifecycle owned by licensing; it decides admission rather than being subject to it
    await tenantDb(trx, sponsor).table('co_managed_entitlements').update({
      lapse_started_at: start, read_only_after: deadline, updated_at: now,
      revision: trx.raw('revision + 1'),
    });
  }
  return {
    capacity, allocated, available: Math.max(0, capacity - allocated),
    canGrow: active && !lapsed && capacity > allocated,
    isReadOnly: deadline !== null && deadline.getTime() <= now.getTime(),
    graceEndsAt: deadline?.toISOString() ?? null,
  };
}

/** Safe to use from workers and ordinary API/actions; no release flag dependency. */
export async function getCoManagedEntitlementState(db: Knex, sponsor: string): Promise<CoManagedEntitlementState> {
  return db.transaction(async (trx) => {
    const row = await tenantDb(trx, sponsor).table('co_managed_entitlements').forUpdate().first();
    if (!row) return { capacity: 0, allocated: await allocatedSeats(trx, sponsor), available: 0,
      canGrow: false, isReadOnly: true, graceEndsAt: null };
    return materializeState(trx, sponsor, row, await databaseNow(trx));
  });
}
