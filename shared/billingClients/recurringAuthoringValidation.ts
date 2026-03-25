import type { CadenceOwner } from '@alga-psa/types';

type RecurringAuthoringLineType = 'Fixed' | 'Product' | 'Hourly' | 'Usage';

type RecurringAuthoringValidationInput = {
  lineType: RecurringAuthoringLineType;
  cadenceOwner?: CadenceOwner | null;
  billingTiming?: 'arrears' | 'advance' | null;
  billingFrequency?: string | null;
};

const SUPPORTED_CONTRACT_CADENCE_FREQUENCIES = new Set([
  'monthly',
  'quarterly',
  'semi-annually',
  'annually',
]);

export function getUnsupportedRecurringAuthoringCombinationMessage(
  input: RecurringAuthoringValidationInput,
): string | null {
  if (input.cadenceOwner !== 'contract') {
    return null;
  }

  const billingFrequency = input.billingFrequency ?? 'monthly';
  if (SUPPORTED_CONTRACT_CADENCE_FREQUENCIES.has(billingFrequency)) {
    return null;
  }

  return `Unsupported recurring authoring combination for ${input.lineType} services: contract anniversary cadence currently supports monthly, quarterly, semi-annually, and annual billing frequencies. ${billingFrequency} is not supported yet. Use one of the supported frequencies or invoice on the client billing schedule instead.`;
}
