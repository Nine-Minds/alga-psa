import type { CadenceOwner } from '@alga-psa/types';

type RecurringAuthoringLineType = 'Fixed' | 'Product' | 'Hourly' | 'Usage';

type RecurringAuthoringValidationInput = {
  lineType: RecurringAuthoringLineType;
  cadenceOwner?: CadenceOwner | null;
  billingTiming?: 'arrears' | 'advance' | null;
  billingFrequency?: string | null;
};

export function getUnsupportedRecurringAuthoringCombinationMessage(
  input: RecurringAuthoringValidationInput,
): string | null {
  if (input.cadenceOwner !== 'contract') {
    return null;
  }

  const billingTiming = input.billingTiming === 'advance' ? 'advance' : 'arrears';
  const billingFrequency = input.billingFrequency ?? 'monthly';

  return `Unsupported recurring authoring combination for ${input.lineType} services: contract anniversary cadence with ${billingTiming} billing on ${billingFrequency} frequency is not enabled during the client-cadence rollout. Use client billing schedule instead.`;
}
