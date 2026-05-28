import {
  type ProductCode,
  ONBOARDING_WIZARD_REQUIRED_STEP_INDEXES,
  ONBOARDING_WIZARD_STEPS,
} from '@alga-psa/types';

export const PSA_ONBOARDING_STEP_INDEXES = ONBOARDING_WIZARD_STEPS.map((_step, index) => index);
export const ALGA_DESK_ONBOARDING_STEP_INDEXES = [0, 1, 2, 3, 5] as const;

export function getOnboardingWizardStepIndexes(productCode: ProductCode): number[] {
  return productCode === 'algadesk'
    ? [...ALGA_DESK_ONBOARDING_STEP_INDEXES]
    : [...PSA_ONBOARDING_STEP_INDEXES];
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
