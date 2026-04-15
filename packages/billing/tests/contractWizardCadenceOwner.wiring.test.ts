import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('contract wizard cadence_owner wiring', () => {
  it('T106 and T231: client wizard actions thread cadence_owner and shared timing defaults through live-line writes and compatibility reads', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/actions/contractWizardActions.ts'),
      'utf8'
    );

    expect(source).toContain("from '@shared/billingClients/recurringAuthoringPolicy';");
    expect(source).toContain('resolveRecurringAuthoringPolicy');
    expect(source.match(/const recurringAuthoringPolicy = resolveRecurringAuthoringPolicy\(/g)?.length).toBe(2);
    expect(source.match(/billing_timing: recurringAuthoringPolicy\.billingTiming/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source.match(/cadence_owner: recurringAuthoringPolicy\.cadenceOwner/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source.match(/billing_cycle_alignment: recurringAuthoringPolicy\.billingCycleAlignment/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain("let cadenceOwner: CadenceOwner = 'client';");
    expect(source).toContain('cadenceOwner = line.cadence_owner ?? cadenceOwner;');
    expect(source).toContain('cadence_owner: cadenceOwner,');
  });

  it('threads cadence_owner and billing_timing through wizard defaults, template snapshots, and fixed-fee UI copy', () => {
    const wizardSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/contracts/ContractWizard.tsx'),
      'utf8'
    );
    const contractBasicsSource = readFileSync(
      resolve(
        __dirname,
        '../src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep.tsx'
      ),
      'utf8'
    );
    const fixedFeeStepSource = readFileSync(
      resolve(
        __dirname,
        '../src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep.tsx'
      ),
      'utf8'
    );

    expect(wizardSource).toContain("cadence_owner: 'client'");
    expect(wizardSource).toContain("billing_timing: 'arrears'");
    expect(wizardSource).toContain('cadence_owner: snapshot.cadence_owner ?? prev.cadence_owner');
    expect(wizardSource).toContain('billing_timing: snapshot.billing_timing ?? prev.billing_timing');
    expect(wizardSource).toContain("cadence_owner: wizardData.cadence_owner ?? 'client'");
    expect(wizardSource).toContain("billing_timing: wizardData.billing_timing ?? 'arrears'");
    expect(contractBasicsSource).toContain('Invoice on client billing schedule');
    expect(contractBasicsSource).toContain('Invoice on contract anniversary');
    expect(contractBasicsSource).toContain(
      'Sets the default cadence owner applied to recurring lines created in this wizard.'
    );
    expect(contractBasicsSource).toContain('Recurring Cadence Default');
    expect(contractBasicsSource).toContain(
      "updateData({ cadence_owner: value as ContractWizardData['cadence_owner'] })"
    );
    expect(fixedFeeStepSource).toContain("import { getRecurringAuthoringPreview } from '../recurringAuthoringPreview';");
    expect(fixedFeeStepSource).toContain('Recurring Preview Before Save');
    expect(fixedFeeStepSource).toContain('recurringPreview.firstInvoiceSummary');
    expect(fixedFeeStepSource).toContain('billingFrequency: data.fixed_billing_frequency ?? data.billing_frequency');
    expect(fixedFeeStepSource).toContain('recurringPreview.materializedPeriodsHeading');
    expect(fixedFeeStepSource).toContain('recurringPreview.materializedPeriods.map');
  });

  it('T062: wizard and template boundaries keep client cadence as an explicit product default while write helpers stay bridge-free', () => {
    const wizardSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/contracts/ContractWizard.tsx'),
      'utf8'
    );
    const templateWizardSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/contracts/template-wizard/TemplateWizard.tsx'),
      'utf8'
    );
    const actionsSource = readFileSync(
      resolve(__dirname, '../src/actions/contractWizardActions.ts'),
      'utf8'
    );
    const recurringAuthoringPolicySource = readFileSync(
      resolve(__dirname, '../../../shared/billingClients/recurringAuthoringPolicy.ts'),
      'utf8'
    );

    expect(wizardSource).toContain("cadence_owner: wizardData.cadence_owner ?? 'client'");
    expect(templateWizardSource).toContain("cadence_owner: wizardData.cadence_owner ?? 'client'");
    expect(actionsSource).toContain('defaultCadenceOwner: DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER');
    expect(recurringAuthoringPolicySource).toContain('defaultCadenceOwner?: CadenceOwner | null;');
    expect(recurringAuthoringPolicySource).toContain('?? input.defaultCadenceOwner;');
    expect(recurringAuthoringPolicySource).toContain('Recurring authoring requires an explicit cadence owner or a stored cadence owner to reuse.');
  });
});
