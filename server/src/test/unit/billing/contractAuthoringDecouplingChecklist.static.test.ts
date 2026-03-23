import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const contractWizardActionsSource = readFileSync(
  path.resolve(process.cwd(), '../packages/billing/src/actions/contractWizardActions.ts'),
  'utf8',
);
const contractLineServiceActionsSource = readFileSync(
  path.resolve(process.cwd(), '../packages/billing/src/actions/contractLineServiceActions.ts'),
  'utf8',
);

describe('contract authoring decoupling checklist guards', () => {
  it('T003: wizard submission validation accepts service identity across fixed/hourly/usage contexts', () => {
    const serviceIdentityChecks =
      (contractWizardActionsSource.match(/match\.item_kind !== 'service'/g) || []).length;
    expect(serviceIdentityChecks).toBeGreaterThanOrEqual(3);
    expect(contractWizardActionsSource).not.toContain('must be a fixed billing service');
    expect(contractWizardActionsSource).not.toContain('must be a hourly billing service');
    expect(contractWizardActionsSource).not.toContain('must be a usage billing service');
  });

  it('T004: template/draft resume paths preserve decoupled selections and mode-default prefill support', () => {
    expect(contractWizardActionsSource).toContain('getContractTemplateSnapshotForClientWizard');
    expect(contractWizardActionsSource).toContain('getDraftContractForResume');
    expect(contractWizardActionsSource).toContain('fetchModeDefaultRatesByServiceId');
  });

  it('T005: contract-line service attach validates by target line mode instead of service-type billing coupling', () => {
    expect(contractLineServiceActionsSource).toContain('allowedConfigTypesByPlan');
    expect(contractLineServiceActionsSource).not.toContain('service_type_billing_method');
    expect(contractLineServiceActionsSource).not.toContain('Only fixed billing method services can be attached to this template line.');
  });

  it('T006: pricing defaults keep override > mode-default > catalog-default precedence hooks', () => {
    expect(contractWizardActionsSource).toContain('firstPositiveRateInCents(');
    expect(contractWizardActionsSource).toContain('hourlyModeDefaultsByServiceId.get(service.service_id)');
    expect(contractWizardActionsSource).toContain('usageModeDefaultsByServiceId.get(service.service_id)');
    expect(contractWizardActionsSource).toContain('serviceCatalogById.get(service.service_id)?.default_rate');
    expect(contractWizardActionsSource).toContain('user-entered rates override');
  });
});
