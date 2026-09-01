import { resolveTelephonyAvailability } from './telephonyAvailabilityCore';
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
  return resolveTelephonyAvailability(input);
}
