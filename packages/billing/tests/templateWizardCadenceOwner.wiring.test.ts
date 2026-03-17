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
    expect(actionsSource.match(/cadence_owner: submission\.cadence_owner \?\? 'client'/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
