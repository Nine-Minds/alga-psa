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

/** The Stripe adapter must validate customer, product, price, payment state,
 * and the sponsoring PSA Pro subscription before returning this snapshot. */
export interface HostedCoManagedSnapshot {
  capacity: number;
  validUntil: Date;
  active: boolean;
  lapseSince?: Date;
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
  if (row.source === 'hosted') return { capacity: row.capacity, active: true };
  if (row.source !== 'self_host') return { capacity: 0, active: false };
  const license = verifyLicense(row.signed_license);
  if (isLicenseVerifyFailure(license) || license.claims.aud !== sponsor || license.claims.tier !== 'pro' ||
      license.claims.exp * 1000 <= now.getTime()) return { capacity: 0, active: false };
  return { capacity: license.claims.co_managed_seats ?? 0, active: true };
}

/** Caller holds the sponsor entitlement row lock. Expiry is evaluated on demand
 * so delayed webhooks/workers cannot extend a customer's grace period. */
async function materializeState(trx: Knex.Transaction, sponsor: string, row: any, now: Date,
  inactiveSince?: Date): Promise<CoManagedEntitlementState> {
  const allocated = await allocatedSeats(trx, sponsor);
  const signed = signedCapacity(row, sponsor, now);
  const expires = new Date(row.valid_until);
  const active = signed.active && expires.getTime() > now.getTime();
  const capacity = active ? signed.capacity : 0;
  const lapsed = !active || capacity < allocated;
  let start: Date | null = null;
  if (lapsed) {
    start = row.lapse_started_at ? new Date(row.lapse_started_at) : new Date(Math.min(
      now.getTime(), expires.getTime(), inactiveSince?.getTime() ?? now.getTime(),
    ));
  }
  const deadline = start ? new Date(start.getTime() + GRACE_MS) : null;
  if ((row.lapse_started_at ? new Date(row.lapse_started_at).getTime() : null) !== (start?.getTime() ?? null)) {
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

/** Internal adapter entry point. Load CURRENT Stripe state while holding the
 * same lock as allocation, so delayed or reordered webhook deliveries cannot
 * overwrite a newer observation. A co-managed subscription never updates MSP seats. */
export async function reconcileHostedCoManagedEntitlement(
  db: Knex, sponsor: string, subscriptionId: string,
  loadCurrent: () => Promise<HostedCoManagedSnapshot>,
): Promise<CoManagedEntitlementState> {
  if (!subscriptionId) throw new Error('Co-managed subscription identity is required');
  return db.transaction(async (trx) => {
    const scoped = tenantDb(trx, sponsor);
    const initialNow = await databaseNow(trx);
    await scoped.table('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted',
      source_reference: subscriptionId, capacity: 0, verified_at: initialNow, valid_until: initialNow,
    }).onConflict('tenant').ignore();
    const row = await scoped.table('co_managed_entitlements').forUpdate().first();
    if (row.source !== 'hosted' || row.source_reference !== subscriptionId) {
      throw new Error('Co-managed entitlement belongs to a different subscription');
    }
    const snapshot = await loadCurrent();
    if (!Number.isSafeInteger(snapshot.capacity) || snapshot.capacity < 0 || snapshot.capacity > 2147483647 ||
        !Number.isFinite(snapshot.validUntil.getTime()) ||
        (snapshot.lapseSince && !Number.isFinite(snapshot.lapseSince.getTime()))) {
      throw new Error('Invalid co-managed entitlement snapshot');
    }
    const now = await databaseNow(trx);
    const update = {
      capacity: snapshot.capacity,
      valid_until: snapshot.active ? snapshot.validUntil : new Date(Math.min(now.getTime(), snapshot.validUntil.getTime())),
      verified_at: now, updated_at: now, revision: trx.raw('revision + 1'),
    };
    await scoped.table('co_managed_entitlements').update(update);
    // Preserve an existing lapse until current capacity is sufficient. Do not
    // reset its clock just because another delinquency webhook was received.
    const earlierLapse = new Date(Math.min(
      snapshot.lapseSince?.getTime() ?? now.getTime(),
      new Date(row.valid_until).getTime() <= now.getTime() ? new Date(row.valid_until).getTime() : now.getTime(),
    ));
    return materializeState(trx, sponsor, { ...row, ...update }, now, earlierLapse);
  });
}

/** Accept only a current signed entitlement bound to this sponsor. An older
 * offline refresh cannot supersede newer signed capacity, including a reduction. */
export async function reconcileSelfHostCoManagedEntitlement(
  db: Knex, sponsor: string, token: string,
): Promise<CoManagedEntitlementState> {
  const license = verifyLicense(token);
  if (isLicenseVerifyFailure(license) || license.claims.aud !== sponsor || license.claims.tier !== 'pro') {
    throw new Error('A valid sponsor-bound Pro license is required');
  }
  const claims = license.claims;
  if ((claims.co_managed_seats ?? 0) > 2147483647) throw new Error('Co-managed capacity exceeds the supported range');
  return db.transaction(async (trx) => {
    const initialNow = await databaseNow(trx);
    const scoped = tenantDb(trx, sponsor);
    await scoped.table('co_managed_entitlements').insert({ tenant: sponsor, source: 'self_host',
      source_reference: claims.sub, capacity: 0, signed_license: token,
      source_version: 0, verified_at: initialNow, valid_until: initialNow,
    }).onConflict('tenant').ignore();
    const row = await scoped.table('co_managed_entitlements').forUpdate().first();
    const now = await databaseNow(trx);
    if (!Number.isSafeInteger(claims.iat) || claims.exp * 1000 <= now.getTime() || claims.iat * 1000 > now.getTime() + 60_000) {
      throw new Error('Co-managed license is not current');
    }
    if (row.source !== 'self_host') throw new Error('Cannot replace hosted capacity with an offline license');
    if (Number(row.source_version) >= claims.iat) return materializeState(trx, sponsor, row, await databaseNow(trx));
    const update = {
      source_reference: claims.sub, source_version: claims.iat, signed_license: token,
      capacity: claims.co_managed_seats ?? 0,
      valid_until: new Date(claims.exp * 1000), verified_at: now, updated_at: now,
      revision: trx.raw('revision + 1'),
    };
    await scoped.table('co_managed_entitlements').update(update);
    return materializeState(trx, sponsor, { ...row, ...update }, now,
      new Date(row.valid_until).getTime() <= now.getTime() ? new Date(row.valid_until) : undefined);
  });
}

/** Called only after an authenticated license-service revocation response.
 * Match the observed token so a delayed response cannot revoke a newer license.
 * The ordinary appliance license retains its existing separate grace behavior. */
export async function recordSelfHostCoManagedRevocation(db: Knex, token: string): Promise<void> {
  const license = verifyLicense(token);
  if (isLicenseVerifyFailure(license) || !license.claims.aud) return;
  const sponsor = license.claims.aud;
  await db.transaction(async (trx) => {
    const scoped = tenantDb(trx, sponsor);
    const row = await scoped.table('co_managed_entitlements').where({ source: 'self_host', signed_license: token }).forUpdate().first();
    if (!row) return;
    const now = await databaseNow(trx);
    const expires = new Date(Math.min(new Date(row.valid_until).getTime(), now.getTime()));
    await scoped.table('co_managed_entitlements').update({ valid_until: expires, updated_at: now, revision: trx.raw('revision + 1') });
    await materializeState(trx, sponsor, { ...row, valid_until: expires }, now);
  });
}
