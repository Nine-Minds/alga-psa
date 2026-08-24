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
 * Canonical telephony entitlement check. Telephony ships inside the Microsoft
 * Teams add-on, so a non-expired `ADD_ONS.TEAMS` row is what entitles it. The
 * expiry predicate is evaluated in SQL so it matches the database clock.
 */
export async function tenantHasTelephonyEntitlement(tenantId: string, knexOverride?: any): Promise<boolean> {
  const { createTenantKnex, tenantDb } = await import('@alga-psa/db');
  const knex = knexOverride ?? (await createTenantKnex(tenantId)).knex;
  const row = await tenantDb(knex, tenantId).table('tenant_addons')
    .where({ addon_key: ADD_ONS.TEAMS })
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
  if (tenantId && !(await tenantHasTelephonyEntitlement(tenantId))) {
    return disabledTelephonyAvailability('addon_required');
  }

  return baseAvailability;
}
