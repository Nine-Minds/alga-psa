import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

export type InternalUserLicenseLimitCode = 'SOLO_PLAN_LIMIT' | 'LICENSE_LIMIT_REACHED';

export type InternalUserLicenseLimitResult =
  | { ok: true }
  | { ok: false; code: InternalUserLicenseLimitCode; error: string };

/**
 * Enforce the same internal-user seat limits addUser applies (solo-plan,
 * licensed_user_count, and the EE appliance seat limit), so any code path
 * that can create an internal user account — direct creation or an accepted
 * email invitation — is held to the same limit. Must be called against the
 * same trx/knex the account creation happens in whenever possible, to keep
 * the check-then-insert window as small as addUser's.
 */
export async function checkInternalUserLicenseLimit(
  trx: Knex.Transaction | Knex,
  tenant: string
): Promise<InternalUserLicenseLimitResult> {
  const tenantRow = await tenantDb(trx, tenant).table('tenants')
    .first('licensed_user_count', 'plan');

  if (!tenantRow) {
    throw new Error(`Tenant not found: ${tenant}`);
  }

  const usedResult = await tenantDb(trx, tenant).table('users')
    .where({
      user_type: 'internal',
      is_inactive: false,
    })
    .count('* as count');

  const used = parseInt((usedResult as Array<{ count: string }>)[0].count, 10);
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
      return await checkApplianceLicenseSeatLimit(used);
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
