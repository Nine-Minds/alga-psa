import { ADD_ONS } from '@alga-psa/types';
import {
  disabledTelephonyAvailability,
  resolveTelephonyAvailability,
} from './telephonyAvailabilityCore';
import type {
  GetTelephonyAvailabilityInput,
  TelephonyAvailability,
} from './telephonyAvailabilityCore';

export {
  isTelephonyEnterpriseEdition,
  resolveTelephonyAvailability,
  TELEPHONY_AVAILABILITY_MESSAGES,
} from './telephonyAvailabilityCore';
export type {
  GetTelephonyAvailabilityInput,
  ResolveTelephonyAvailabilityInput,
  TelephonyAvailability,
  TelephonyAvailabilityDisabledReason,
} from './telephonyAvailabilityCore';

/**
 * Canonical telephony entitlement check: a non-expired `ADD_ONS.TELEPHONY` row.
 * The expiry predicate is evaluated in SQL so it matches the database clock, the
 * same contract `tenantHasTeamsAddOn` uses.
 */
export async function tenantHasTelephonyAddOn(tenantId: string, knexOverride?: any): Promise<boolean> {
  const { createTenantKnex, tenantDb } = await import('@alga-psa/db');
  const knex = knexOverride ?? (await createTenantKnex(tenantId)).knex;
  const row = await tenantDb(knex, tenantId).table('tenant_addons')
    .where({ addon_key: ADD_ONS.TELEPHONY })
    .andWhere((builder: any) => {
      builder.whereNull('expires_at').orWhere('expires_at', '>', knex.fn.now());
    })
    .first('addon_key');

  return Boolean(row);
}

export async function getTelephonyAvailability(
  input: GetTelephonyAvailabilityInput = {},
): Promise<TelephonyAvailability> {
  const baseAvailability = resolveTelephonyAvailability(input);
  if (baseAvailability.enabled === false) {
    return baseAvailability;
  }

  const tenantId = (input.tenantId || '').trim();
  if (tenantId && !(await tenantHasTelephonyAddOn(tenantId))) {
    return disabledTelephonyAvailability('addon_required');
  }

  return baseAvailability;
}
