import type { CadenceOwner } from '@alga-psa/types';

type CadenceOwnerRolloutValidationInput = {
  cadenceOwner?: CadenceOwner | null;
  billingTiming?: 'arrears' | 'advance' | null;
};

export const CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE =
  'Contract-owned cadence is not enabled during the client-cadence rollout.';

export function getCadenceOwnerRolloutValidationMessage(
  input: CadenceOwnerRolloutValidationInput,
): string | null {
  if (input.cadenceOwner === 'contract') {
    return CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE;
  }

  return null;
}

export function assertSupportedCadenceOwnerDuringRollout(
  input: CadenceOwnerRolloutValidationInput,
): void {
  const message = getCadenceOwnerRolloutValidationMessage(input);
  if (message) {
    throw new Error(message);
  }
}
