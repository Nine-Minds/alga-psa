import { tenantDb } from '@alga-psa/db';
import { ADD_ONS } from '@alga-psa/types';

/**
 * Deny-by-default telephony entitlement check for server paths (ingestion,
 * webhooks, provider actions). Telephony ships inside the Microsoft Teams
 * add-on, so `ADD_ONS.TEAMS` is the entitlement; the expiry predicate runs in
 * SQL so it uses the database clock.
 */
export async function tenantHasTelephonyEntitlement(knex: any, tenantId: string): Promise<boolean> {
  const row = await tenantDb(knex, tenantId).table('tenant_addons')
    .where({ addon_key: ADD_ONS.TEAMS })
    .andWhere((builder: any) => {
      builder.whereNull('expires_at').orWhere('expires_at', '>', knex.fn.now());
    })
    .first('addon_key');

  return Boolean(row);
}

export class TelephonyEntitlementInactiveError extends Error {
  readonly code = 'telephony_addon_inactive' as const;

  constructor(tenantId: string) {
    super(`Microsoft Teams add-on is not active for tenant ${tenantId}`);
    this.name = 'TelephonyEntitlementInactiveError';
  }
}

export async function assertTelephonyEntitlement(knex: any, tenantId: string): Promise<void> {
  if (!(await tenantHasTelephonyEntitlement(knex, tenantId))) {
    throw new TelephonyEntitlementInactiveError(tenantId);
  }
}
