import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const onboardingActionsSource = readFileSync(
  path.resolve(process.cwd(), '../packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts'),
  'utf8',
);
const onboardingBillingStepSource = readFileSync(
  path.resolve(process.cwd(), '../packages/onboarding/src/components/steps/BillingSetupStep.tsx'),
  'utf8',
);
const serviceFormSource = readFileSync(
  path.resolve(process.cwd(), '../packages/billing/src/components/billing-dashboard/ServiceForm.tsx'),
  'utf8',
);
const quickAddServiceSource = readFileSync(
  path.resolve(process.cwd(), '../packages/billing/src/components/settings/billing/QuickAddService.tsx'),
  'utf8',
);

describe('onboarding and service settings decouple service type identity from billing mode', () => {
  it('T016: onboarding service creation uses explicit billing mode input and not service-type billing metadata', () => {
    expect(onboardingActionsSource).toContain('serviceBillingMode?: \'fixed\' | \'hourly\' | \'usage\';');
    expect(onboardingActionsSource).toContain("billing_method: data.serviceBillingMode || 'usage'");
    expect(onboardingActionsSource).not.toContain('billing_method: serviceType.billing_method');
  });

  it('T016: onboarding billing step captures billing mode separately from service type selection', () => {
    expect(onboardingBillingStepSource).toContain('id="serviceBillingMode"');
    expect(onboardingBillingStepSource).toContain('Billing mode is configured separately on each service');
  });

  it('T016: service settings forms do not auto-overwrite billing mode when service type changes', () => {
    expect(serviceFormSource).not.toContain('setBillingMethod(selectedType.billing_method)');
    expect(quickAddServiceSource).not.toContain('billing_method: selectedType?.billing_method');
  });
});
