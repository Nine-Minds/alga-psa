import {
  type ProductCode,
  ONBOARDING_WIZARD_REQUIRED_STEP_INDEXES,
  ONBOARDING_WIZARD_STEPS,
} from '@alga-psa/types';

export const PSA_ONBOARDING_STEP_INDEXES = ONBOARDING_WIZARD_STEPS.map((_step, index) => index);
export const ALGA_DESK_ONBOARDING_STEP_INDEXES = [0, 1, 2, 3, 5] as const;
// A co-managed customer workspace is an internal IT operation, not an MSP book of
// business. Its SKU excludes client contracts, billing rates, and invoice setup, and
// provisioning already creates the workspace's own organization and contact, so the
// Add Client, Client Contact, and Billing steps have nothing to configure. What is
// left is workspace identity, the customer IT team, and the required ticketing setup.
export const CO_MANAGED_ONBOARDING_STEP_INDEXES = [0, 1, 5] as const;

export function getOnboardingWizardStepIndexes(productCode: ProductCode): number[] {
  switch (productCode) {
    case 'algadesk':
      return [...ALGA_DESK_ONBOARDING_STEP_INDEXES];
    case 'co_managed':
      return [...CO_MANAGED_ONBOARDING_STEP_INDEXES];
    default:
      return [...PSA_ONBOARDING_STEP_INDEXES];
  }
}

export function getOnboardingWizardRequiredStepPositions(productCode: ProductCode): number[] {
  const activeStepIndexes = getOnboardingWizardStepIndexes(productCode);

  return activeStepIndexes.reduce<number[]>((positions, originalStepIndex, displayPosition) => {
    if (ONBOARDING_WIZARD_REQUIRED_STEP_INDEXES.includes(originalStepIndex)) {
      positions.push(displayPosition);
    }

    return positions;
  }, []);
}
