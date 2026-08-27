import { isFeatureFlagEnabled, RELEASE_V1_5_FEATURE_FLAG } from '@alga-psa/core/features';
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

export async function tenantHasTelephonyFeatureAccess(
  tenantId: string,
  userId?: string | null,
): Promise<boolean> {
  return isFeatureFlagEnabled(RELEASE_V1_5_FEATURE_FLAG, {
    tenantId,
    userId: userId || undefined,
  });
}

export async function getTelephonyAvailability(
  input: GetTelephonyAvailabilityInput = {},
): Promise<TelephonyAvailability> {
  const baseAvailability = resolveTelephonyAvailability(input);
  if (baseAvailability.enabled === false) {
    return baseAvailability;
  }

  const tenantId = (input.tenantId || '').trim();
  if (tenantId && !(await tenantHasTelephonyFeatureAccess(tenantId, input.userId))) {
    return disabledTelephonyAvailability('feature_disabled');
  }

  return baseAvailability;
}
