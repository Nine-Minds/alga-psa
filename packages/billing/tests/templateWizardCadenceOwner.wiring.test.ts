import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('template wizard cadence_owner wiring', () => {
  it('T114: template wizard carries cadence_owner defaults through state, submission, and persisted template lines', () => {
    const wizardSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/contracts/template-wizard/TemplateWizard.tsx'),
      'utf8'
    );
    const fixedStepSource = readFileSync(
      resolve(
        __dirname,
        '../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateFixedFeeServicesStep.tsx'
      ),
      'utf8'
    );
    const actionsSource = readFileSync(
      resolve(__dirname, '../src/actions/contractWizardActions.ts'),
      'utf8'
    );

    expect(wizardSource).toContain("cadence_owner: 'client'");
    expect(wizardSource).toContain("cadence_owner: wizardData.cadence_owner ?? 'client'");
    expect(fixedStepSource).toContain('Invoice on client billing schedule');
    expect(fixedStepSource).toContain('Invoice on contract anniversary');
    expect(fixedStepSource).toContain(
      'Choose which schedule should define recurring service periods for contracts created from this template.'
    );
    expect(fixedStepSource).toContain(
      "updateData({ cadence_owner: value as TemplateWizardData['cadence_owner'] })"
    );
    expect(actionsSource.match(/cadence_owner: recurringAuthoringPolicy\.cadenceOwner/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('T235: template fixed-line authoring captures billing timing and partial-period defaults explicitly before template persistence', () => {
    const wizardSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/contracts/template-wizard/TemplateWizard.tsx'),
      'utf8'
    );
    const fixedStepSource = readFileSync(
      resolve(
        __dirname,
        '../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateFixedFeeServicesStep.tsx'
      ),
      'utf8'
    );
    const reviewSource = readFileSync(
      resolve(
        __dirname,
        '../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateReviewContractStep.tsx'
      ),
      'utf8'
    );
    const actionsSource = readFileSync(
      resolve(__dirname, '../src/actions/contractWizardActions.ts'),
      'utf8'
    );

    expect(wizardSource).toContain("billing_timing: 'arrears'");
    expect(wizardSource).toContain('enable_proration: false');
    expect(wizardSource).toContain("billing_timing: wizardData.billing_timing ?? 'arrears'");
    expect(wizardSource).toContain('enable_proration: wizardData.enable_proration ?? false');

    expect(fixedStepSource).toContain('Billing Timing');
    expect(fixedStepSource).toContain('Adjust for Partial Periods');
    expect(fixedStepSource).toContain(
      "updateData({ billing_timing: value as TemplateWizardData['billing_timing'] })"
    );
    expect(fixedStepSource).toContain("updateData({ enable_proration: checked })");
    expect(fixedStepSource).toContain('The first invoice bills at the start of the first covered service period.');
    expect(fixedStepSource).toContain('The first invoice bills after the first covered service period closes.');

    expect(reviewSource).toContain('Partial-period adjustment:');
    expect(actionsSource).toContain('billingTiming: submission.billing_timing,');
  });
});
