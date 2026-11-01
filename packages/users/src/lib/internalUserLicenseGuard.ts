import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

export type InternalUserLicenseLimitCode = 'SOLO_PLAN_LIMIT' | 'LICENSE_LIMIT_REACHED';

export type InternalUserLicenseLimitResult =
  | { ok: true; coManaged?: boolean }
  | { ok: false; code: InternalUserLicenseLimitCode; error: string };

// ee/server typechecks this package's sources with strictNullChecks off, where
// boolean-discriminant narrowing (`if (!result.ok)`) does not apply — a
// type-predicate guard narrows correctly under both strict and non-strict
// modes. See reference_ee_server_strict_false_narrowing.
export function isInternalUserLicenseLimitRejected(
  result: InternalUserLicenseLimitResult
): result is { ok: false; code: InternalUserLicenseLimitCode; error: string } {
  return result.ok === false;
}

/**
 * Pending email invitations, which reserve a seat until they are accepted
 * (`used_at` set — the invitee then counts as an active user, never both) or
 * expire. The one definition of "pending": sendUserInvitation reserves it and
 * the onboarding wizard reports it. `excludeEmail` leaves out the invitee being
 * (re)invited so a resend never blocks itself.
 */
export async function countPendingInvitationSeats(
  trx: Knex.Transaction | Knex,
  tenant: string,
  options?: { excludeEmail?: string }
): Promise<number> {
  let query = tenantDb(trx, tenant).table('user_invitations')
    .whereNull('used_at')
    .where('expires_at', '>', trx.fn.now());
  if (options?.excludeEmail !== undefined) query = query.whereNot('email', options.excludeEmail);
  const row = await query.count('* as count').first();
  return parseInt(String(row?.count ?? '0'), 10);
}

/**
 * Per-tenant seat lock. `pg_advisory_xact_lock` is transaction-scoped: it is
 * held until the caller's transaction commits or rolls back, so it covers the
 * seat check *and* the user insert / reactivation / invitation write that
 * follows. Two int4 keys (namespace, tenant) keep it clear of other advisory
 * locks and make tenants independent of one another.
 */
export const INTERNAL_USER_SEAT_LOCK_NAMESPACE = 'internal_user_seats';

export async function lockInternalUserSeats(trx: Knex.Transaction, tenant: string): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', [
    INTERNAL_USER_SEAT_LOCK_NAMESPACE,
    String(tenant),
  ]);
}

function assertTransaction(trx: Knex.Transaction | Knex, caller: string): asserts trx is Knex.Transaction {
  // knex sets `isTransaction = true` on every transaction object (and on
  // nested/savepoint transactions); a plain Knex instance has it undefined.
  if (!(trx as { isTransaction?: boolean }).isTransaction) {
    throw new Error(`${caller} must run inside a transaction: the seat lock is transaction-scoped`);
  }
}

async function evaluateSeatLimits(
  trx: Knex.Transaction,
  tenant: string,
  tenantRow: { licensed_user_count: number | null; plan: string | null | undefined },
  used: number
): Promise<InternalUserLicenseLimitResult> {
  const limit = tenantRow.licensed_user_count as number | null;
  const plan = tenantRow.plan as string | null | undefined;

  if (plan === 'solo' && used >= 1) {
    return {
      ok: false,
      code: 'SOLO_PLAN_LIMIT',
      error: 'Solo plan is limited to 1 user. Upgrade to Pro to add more users.',
    };
  }

  if (limit !== null && limit !== undefined && used >= limit) {
    return {
      ok: false,
      code: 'LICENSE_LIMIT_REACHED',
      error: "You've reached your MSP user license limit.",
    };
  }

  // Appliance license seat limit — Enterprise Edition only. Resolves to a
  // no-op stub on CE (`@enterprise` → packages/ee/src), so no appliance
  // licensing concept ships in or runs on Community Edition.
  const seatLimit = await (async () => {
    try {
      const { checkApplianceLicenseSeatLimit } = await import('@enterprise/lib/license/userSeatGuard');
      return await checkApplianceLicenseSeatLimit(used, tenant);
    } catch {
      return null;
    }
  })();
  if (seatLimit) {
    return {
      ok: false,
      code: 'LICENSE_LIMIT_REACHED',
      error: `You've reached the seat limit (${seatLimit.seats}) of your Alga appliance license. Add seats at nineminds.com/portal, then use "Refresh license now" on the License page.`,
    };
  }

  return { ok: true };
}

async function countActiveInternalUsers(trx: Knex.Transaction, tenant: string): Promise<number> {
  const usedResult = await tenantDb(trx, tenant).table('users')
    .where({
      user_type: 'internal',
      is_inactive: false,
    })
    .count('* as count');
  return parseInt((usedResult as Array<{ count: string }>)[0].count, 10);
}

/**
 * Enforce the internal-user seat limits (solo-plan, licensed_user_count, and
 * the EE appliance/signed seat claim) for any path that can occupy a seat:
 * direct creation, reactivation, invitation send (reservation) and acceptance.
 *
 * REQUIRES a transaction. The first statement takes a per-tenant transaction
 * advisory lock (see `lockInternalUserSeats`) before any read, and the lock is
 * held until the caller's transaction ends — so the caller MUST perform the
 * seat-consuming write in that same transaction, and concurrent checks for the
 * same tenant are serialized end to end. Passing a non-transaction throws.
 *
 * `reservedSeats` counts toward the limit on top of existing users — the
 * invite-send path passes its count of other pending invitations so an admin
 * can't send more invites than there are seats left. Acceptance passes
 * nothing: the accepting invitation is itself pending and must not block
 * itself (or race other pending invites — last seat stays first-come,
 * first-served at accept time).
 */
export async function checkInternalUserLicenseLimit(
  trx: Knex.Transaction | Knex,
  tenant: string,
  options?: { reservedSeats?: number; deferCoManaged?: boolean }
): Promise<InternalUserLicenseLimitResult> {
  assertTransaction(trx, 'checkInternalUserLicenseLimit');
  await lockInternalUserSeats(trx, tenant);

  const tenantRow = await tenantDb(trx, tenant).table('tenants')
    .first('licensed_user_count', 'plan', 'product_code');

  if (!tenantRow) {
    throw new Error(`Tenant not found: ${tenant}`);
  }
  if (options?.deferCoManaged && tenantRow.product_code === 'co_managed') return { ok: true, coManaged: true };

  const used = (await countActiveInternalUsers(trx, tenant)) + (options?.reservedSeats ?? 0);
  return evaluateSeatLimits(trx, tenant, tenantRow, used);
}

export class InternalUserSeatOverflowError extends Error {
  readonly name = 'InternalUserSeatOverflowError';
  readonly statusCode = 403;
  constructor(message: string, readonly code: InternalUserLicenseLimitCode) {
    super(message);
  }
}

/**
 * Post-write tripwire. Call in the same transaction AFTER the user row is
 * written (insert or reactivation). Recounts active internal users; if the
 * write left the tenant over its limits, throws so the transaction rolls back.
 * A backstop for the lock (e.g. a path that forgot it), not the mechanism.
 * Do not call for co-managed seat admissions, which have their own accounting.
 */
export async function assertInternalUserSeatsWithinLimit(
  trx: Knex.Transaction | Knex,
  tenant: string
): Promise<void> {
  assertTransaction(trx, 'assertInternalUserSeatsWithinLimit');
  const tenantRow = await tenantDb(trx, tenant).table('tenants')
    .first('licensed_user_count', 'plan', 'product_code');
  if (!tenantRow) {
    throw new Error(`Tenant not found: ${tenant}`);
  }
  // The new seat is already in the count; the check asks "was there room for
  // it", i.e. whether the seats held by everyone else already hit a limit.
  const others = Math.max((await countActiveInternalUsers(trx, tenant)) - 1, 0);
  const verdict = await evaluateSeatLimits(trx, tenant, tenantRow, others);
  if (isInternalUserLicenseLimitRejected(verdict)) {
    throw new InternalUserSeatOverflowError(verdict.error, verdict.code);
  }
}
