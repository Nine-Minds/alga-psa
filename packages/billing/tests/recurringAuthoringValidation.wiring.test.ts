import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getUnsupportedRecurringAuthoringCombinationMessage } from '../../../shared/billingClients/recurringAuthoringValidation';

describe('recurring authoring validation boundaries', () => {
  it('T240: unsupported authoring combinations fail early with clear cadence, timing, frequency, and line-type boundaries', () => {
    expect(
      getUnsupportedRecurringAuthoringCombinationMessage({
        lineType: 'Hourly',
        cadenceOwner: 'contract',
        billingTiming: 'advance',
        billingFrequency: 'quarterly',
      }),
    ).toBe(
      'Unsupported recurring authoring combination for Hourly services: contract anniversary cadence with advance billing on quarterly frequency is not enabled during the client-cadence rollout. Use client billing schedule instead.',
    );

    expect(
      getUnsupportedRecurringAuthoringCombinationMessage({
        lineType: 'Usage',
        cadenceOwner: 'client',
        billingTiming: 'arrears',
        billingFrequency: 'monthly',
      }),
    ).toBeNull();

    const contractWizardSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/contracts/ContractWizard.tsx'),
      'utf8',
    );
    const templateWizardSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/contracts/template-wizard/TemplateWizard.tsx'),
      'utf8',
    );

    expect(contractWizardSource).toContain(
      "import { getUnsupportedRecurringAuthoringCombinationMessage } from '@shared/billingClients/recurringAuthoringValidation';",
    );
    expect(contractWizardSource).toContain('const recurringAuthoringError = getRecurringAuthoringValidationError();');
    expect(templateWizardSource).toContain(
      "import { getUnsupportedRecurringAuthoringCombinationMessage } from '@shared/billingClients/recurringAuthoringValidation';",
    );
    expect(templateWizardSource).toContain('const recurringAuthoringError = getRecurringAuthoringValidationError();');
  });
});
