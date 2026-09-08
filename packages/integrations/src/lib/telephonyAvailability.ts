import { assertPsaOnlyTenantAccess, ProductAccessError } from '@shared/services/productAccessGuard';
import { resolveTelephonyAvailability, disabledTelephonyAvailability } from './telephonyAvailabilityCore';
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

export async function getTelephonyAvailability(
  input: GetTelephonyAvailabilityInput = {},
): Promise<TelephonyAvailability> {
  const availability = resolveTelephonyAvailability(input);
  if (!availability.enabled || !input.tenantId?.trim()) return availability;
  try { await assertPsaOnlyTenantAccess(input.tenantId, 'telephony_integration'); }
  catch (error) {
    if (error instanceof ProductAccessError) return disabledTelephonyAvailability('product_unavailable');
    throw error;
  }
  return availability;
}
