import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { assertCoManagedSeatAdmission } from '@alga-psa/licensing';

export type InternalUserLicenseLimitCode = 'SOLO_PLAN_LIMIT' | 'LICENSE_LIMIT_REACHED';

export type InternalUserLicenseLimitResult =
  | { ok: true; coManaged?: boolean; invitation?: { invitation_id: string; role_id: string; email: string } }
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
 * Enforce the same internal-user seat limits addUser applies (solo-plan,
 * licensed_user_count, and the EE appliance seat limit), so any code path
 * that can create an internal user account — direct creation or an accepted
 * email invitation — is held to the same limit. Must be called against the
 * same trx/knex the account creation happens in whenever possible, to keep
 * the check-then-insert window as small as addUser's.
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
  options?: {
    reservedSeats?: number;
    /** Advisory pre-checks only (invite-send): report `coManaged` instead of
     * applying the static count. Admission itself goes through admitInternalUserSeat. */
    deferCoManaged?: boolean;
  }
): Promise<InternalUserLicenseLimitResult> {
  const tenantRow = await tenantDb(trx, tenant).table('tenants')
    .first('licensed_user_count', 'plan', 'product_code');

  if (!tenantRow) {
    throw new Error(`Tenant not found: ${tenant}`);
  }
  if (options?.deferCoManaged && tenantRow.product_code === 'co_managed') return { ok: true, coManaged: true };

  const usedResult = await tenantDb(trx, tenant).table('users')
    .where({
      user_type: 'internal',
      is_inactive: false,
    })
    .count('* as count');

  const used = parseInt((usedResult as Array<{ count: string }>)[0].count, 10) + (options?.reservedSeats ?? 0);
  const limit = tenantRow.licensed_user_count as number | null;
  const plan = tenantRow.plan as string | null | undefined;

  if (plan === 'solo' && used >= 1) {
    return {
      ok: false,
      code: 'SOLO_PLAN_LIMIT',
      error: 'Solo plan is limited to 1 user. Upgrade to Pro to add more users.',
    };
  }

  if (limit !== null && used >= limit) {
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

/**
 * The one admission primitive for activating an internal (licensed) user seat:
 * direct creation, API creation, invitation acceptance and reactivation all go
 * through it, inside the same transaction as the user insert/update.
 *
 * A co-managed customer tenant is admitted by its sponsor-backed allocation
 * (`assertCoManagedSeatAdmission`) alone: that result is final and the static
 * `licensed_user_count` check is skipped, because the count is a one-time copy
 * of the allocation that goes stale once the sponsor's entitlement changes.
 * Every other tenant falls through to the ordinary / solo / appliance limit.
 *
 * Co-managed refusals throw `CoManagedAdmissionError` (rolling the caller's
 * transaction back); limit refusals are returned as `{ ok: false }`. The row
 * locks taken by the co-managed gate are held until `trx` ends, so the caller
 * must write the user row and roles in the same `trx`.
 */
export async function admitInternalUserSeat(
  trx: Knex.Transaction,
  tenant: string,
  options: {
    email?: string;
    kind?: 'user' | 'invitation';
    existingUserId?: string;
    invitationToken?: string;
    reservedSeats?: number;
  } = {}
): Promise<InternalUserLicenseLimitResult> {
  const { reservedSeats, ...coManagedInput } = options;
  const admission = await assertCoManagedSeatAdmission(trx, tenant, coManagedInput);
  if (admission.managed) {
    return { ok: true, coManaged: true, ...(admission.invitation ? { invitation: admission.invitation } : {}) };
  }
  return checkInternalUserLicenseLimit(trx, tenant, { reservedSeats });
}
