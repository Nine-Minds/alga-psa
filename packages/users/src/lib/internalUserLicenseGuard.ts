import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

export type InternalUserLicenseLimitCode = 'SOLO_PLAN_LIMIT' | 'LICENSE_LIMIT_REACHED';

export type InternalUserLicenseLimitResult =
  | { ok: true }
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
 * Shared technician admission check. Write paths pass their open transaction,
 * which keeps the tenant/allocation lock until the user or invitation commits.
 * Nontransactional callers get an advisory check only.
 *
 * Co-managed customers use their sponsor allocation and live invitation
 * reservations, independently of the MSP's appliance limit. The original
 * administrator token is required for admission before relationship activation.
 * Ordinary PSA/AlgaDesk tenants retain their plan and appliance limits.
 * `reservedSeats` is an advisory count for legacy invitation callers; the
 * transactional invitation path recounts reservations under its lock.
 */
export async function checkInternalUserLicenseLimit(
  trx: Knex.Transaction | Knex,
  tenant: string,
  options?: { reservedSeats?: number; email?: string; kind?: 'user' | 'invitation'; existingUserId?: string; invitationToken?: string }
): Promise<InternalUserLicenseLimitResult> {
  let tenantRow = await tenantDb(trx, tenant).table('tenants')
    .first('licensed_user_count', 'plan', 'product_code');

  if (!tenantRow) {
    throw new Error(`Tenant not found: ${tenant}`);
  }

  if (tenantRow.product_code === 'co_managed') {
    const { assertCoManagedSeatAdmission, CoManagedAdmissionError } = await import('@alga-psa/licensing');
    try {
      // Nontransactional callers receive an advisory check. The service that
      // writes the account/invitation repeats it inside its write transaction.
      if (trx.isTransaction) await assertCoManagedSeatAdmission(trx as Knex.Transaction, tenant, options);
      else await trx.transaction(inner => assertCoManagedSeatAdmission(inner, tenant, options));
      return { ok: true };
    } catch (error) {
      if (error instanceof CoManagedAdmissionError) return { ok: false, code: 'LICENSE_LIMIT_REACHED', error: error.message };
      throw error;
    }
  }

  if (trx.isTransaction) tenantRow = await tenantDb(trx, tenant).table('tenants').forUpdate().first('licensed_user_count', 'plan', 'product_code');
  if (!tenantRow) throw new Error(`Tenant not found: ${tenant}`);
  if (options?.existingUserId) {
    const existing = await tenantDb(trx, tenant).table('users').where('user_id', options.existingUserId).first('user_type', 'is_inactive');
    if (existing?.user_type === 'internal' && existing.is_inactive === false) return { ok: true };
  }

  const usedResult = await tenantDb(trx, tenant).table('users')
    .where({
      user_type: 'internal',
      is_inactive: false,
    })
    .count('* as count');

  let reservedSeats = options?.reservedSeats ?? 0;
  if (options?.kind === 'invitation' && trx.isTransaction) {
    const pending = await tenantDb(trx, tenant).table('user_invitations').whereNull('used_at')
      .whereNot('email', options.email || '').where('expires_at', '>', trx.fn.now()).count('* as count').first();
    reservedSeats = Number(pending?.count || 0);
  }
  const used = parseInt((usedResult as Array<{ count: string }>)[0].count, 10) + reservedSeats;
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
      return await checkApplianceLicenseSeatLimit(used, tenant, trx);
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
