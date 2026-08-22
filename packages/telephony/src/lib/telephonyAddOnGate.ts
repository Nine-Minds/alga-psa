import { tenantDb } from '@alga-psa/db';
import { ADD_ONS } from '@alga-psa/types';

/**
 * Deny-by-default telephony entitlement check for server paths (ingestion,
 * webhooks, provider actions). Mirrors `tenantHasTeamsAddOn`: the expiry
 * predicate runs in SQL so it uses the database clock.
 */
export async function tenantHasTelephonyAddOn(knex: any, tenantId: string): Promise<boolean> {
  const row = await tenantDb(knex, tenantId).table('tenant_addons')
    .where({ addon_key: ADD_ONS.TELEPHONY })
    .andWhere((builder: any) => {
      builder.whereNull('expires_at').orWhere('expires_at', '>', knex.fn.now());
    })
    .first('addon_key');

  return Boolean(row);
}

export class TelephonyAddOnInactiveError extends Error {
  readonly code = 'telephony_addon_inactive' as const;

  constructor(tenantId: string) {
    super(`Telephony add-on is not active for tenant ${tenantId}`);
    this.name = 'TelephonyAddOnInactiveError';
  }
}

export async function assertTelephonyAddOn(knex: any, tenantId: string): Promise<void> {
  if (!(await tenantHasTelephonyAddOn(knex, tenantId))) {
    throw new TelephonyAddOnInactiveError(tenantId);
  }
}
