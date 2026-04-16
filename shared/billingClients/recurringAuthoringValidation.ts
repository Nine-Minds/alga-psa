import type { CadenceOwner } from '@alga-psa/types';

type RecurringAuthoringLineType = 'Fixed' | 'Product' | 'Hourly' | 'Usage';

type RecurringAuthoringValidationInput = {
  lineType: RecurringAuthoringLineType;
  cadenceOwner?: CadenceOwner | null;
  billingTiming?: 'arrears' | 'advance' | null;
  billingFrequency?: string | null;
};

const SUPPORTED_CONTRACT_CADENCE_FREQUENCIES = [
  'monthly',
  'quarterly',
  'semi-annually',
  'annually',
] as const;
const SUPPORTED_CONTRACT_CADENCE_FREQUENCY_SET = new Set<string>(SUPPORTED_CONTRACT_CADENCE_FREQUENCIES);

export type UnsupportedRecurringAuthoringCombination = {
  lineType: RecurringAuthoringLineType;
  billingFrequency: string;
  supportedBillingFrequencies: readonly string[];
};

const formatEnglishList = (values: readonly string[]): string => {
  if (values.length <= 1) {
    return values[0] ?? '';
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
};

export function getUnsupportedRecurringAuthoringCombination(
  input: RecurringAuthoringValidationInput,
): UnsupportedRecurringAuthoringCombination | null {
  if (input.cadenceOwner !== 'contract') {
    return null;
  }

  const billingFrequency = input.billingFrequency ?? 'monthly';
  if (SUPPORTED_CONTRACT_CADENCE_FREQUENCY_SET.has(billingFrequency)) {
    return null;
  }

  return {
    lineType: input.lineType,
    billingFrequency,
    supportedBillingFrequencies: SUPPORTED_CONTRACT_CADENCE_FREQUENCIES,
  };
}

export function getUnsupportedRecurringAuthoringCombinationMessage(
  input: RecurringAuthoringValidationInput,
): string | null {
  const unsupportedCombination = getUnsupportedRecurringAuthoringCombination(input);
  if (!unsupportedCombination) {
    return null;
  }
  const englishSupportedFrequencies = unsupportedCombination.supportedBillingFrequencies.map((frequency) =>
    frequency === 'annually' ? 'annual' : frequency
  );

  return `Unsupported recurring authoring combination for ${unsupportedCombination.lineType} services: contract anniversary cadence currently supports ${formatEnglishList(englishSupportedFrequencies)} billing frequencies. ${unsupportedCombination.billingFrequency} is not supported yet. Use one of the supported frequencies or invoice on the client billing schedule instead.`;
}
