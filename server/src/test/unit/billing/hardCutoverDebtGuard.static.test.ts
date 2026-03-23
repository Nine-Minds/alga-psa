import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(relativePathFromRepoRoot: string): string {
  return readFileSync(path.resolve(process.cwd(), '..', relativePathFromRepoRoot), 'utf8');
}

describe('hard cutover debt guard', () => {
  it('T018: active billing/editor codepaths do not retain per_unit compatibility branches', () => {
    const sources = [
      'packages/billing/src/actions/serviceActions.ts',
      'packages/billing/src/models/service.ts',
      'packages/billing/src/components/settings/billing/QuickAddService.tsx',
      'packages/billing/src/components/settings/billing/QuickAddProduct.tsx',
      'packages/billing/src/components/settings/billing/ProductsManager.tsx',
      'packages/billing/src/components/settings/billing/ServiceCatalogManager.tsx',
      'packages/billing/src/components/billing-dashboard/ServiceForm.tsx',
      'packages/billing/src/components/billing-dashboard/contracts/ServiceCatalogPicker.tsx',
      'packages/billing/src/components/billing-dashboard/ContractLineDialog.tsx',
      'packages/billing/src/components/billing-dashboard/contracts/CreateCustomContractLineDialog.tsx',
      'server/src/components/layout/QuickCreateDialog.tsx',
      'server/src/test/e2e/utils/e2eTestSetup.ts',
    ].map(read);

    for (const source of sources) {
      expect(source).not.toContain('per_unit');
    }
  });

  it('T018: no catalog billing-method eligibility gating remains in contract authoring picker surfaces', () => {
    const contractLineDialog = read('packages/billing/src/components/billing-dashboard/ContractLineDialog.tsx');
    const createCustomLineDialog = read('packages/billing/src/components/billing-dashboard/contracts/CreateCustomContractLineDialog.tsx');
    const fixedWizardStep = read('packages/billing/src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep.tsx');
    const hourlyWizardStep = read('packages/billing/src/components/billing-dashboard/contracts/wizard-steps/HourlyServicesStep.tsx');
    const usageWizardStep = read('packages/billing/src/components/billing-dashboard/contracts/wizard-steps/UsageBasedServicesStep.tsx');

    expect(contractLineDialog).not.toContain('billingMethods={');
    expect(createCustomLineDialog).not.toContain('billingMethods={');
    expect(fixedWizardStep).not.toContain("billingMethods={['fixed']}");
    expect(hourlyWizardStep).not.toContain("billingMethods={['hourly']}");
    expect(usageWizardStep).not.toContain("billingMethods={['usage']}");
  });

  it('T018: no unconditional null-line fallback SQL and no service_type alias proxying remains', () => {
    const billingEngine = read('packages/billing/src/lib/billing/billingEngine.ts');
    const scheduling = read('packages/scheduling/src/actions/timeEntryCrudActions.ts');
    const availability = read('packages/client-portal/src/services/availabilityService.ts');

    expect(billingEngine).not.toContain('contract_line_id IS NULL');
    expect(billingEngine).not.toContain('usage_tracking.contract_line_id IS NULL');
    expect(scheduling).not.toContain('billing_method as service_type');
    expect(availability).not.toContain('billing_method as service_type');
  });
});
