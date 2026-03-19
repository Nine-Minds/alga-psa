import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getUnsupportedRecurringAuthoringCombinationMessage } from '../../../shared/billingClients/recurringAuthoringValidation';

describe('recurring authoring validation boundaries', () => {
  it('T240: unsupported authoring combinations fail early with clear cadence, frequency, and line-type boundaries', () => {
    expect(
      getUnsupportedRecurringAuthoringCombinationMessage({
        lineType: 'Hourly',
        cadenceOwner: 'contract',
        billingTiming: 'advance',
        billingFrequency: 'quarterly',
      }),
    ).toBeNull();

    expect(
      getUnsupportedRecurringAuthoringCombinationMessage({
        lineType: 'Usage',
        cadenceOwner: 'contract',
        billingTiming: 'arrears',
        billingFrequency: 'weekly',
      }),
    ).toBe(
      'Unsupported recurring authoring combination for Usage services: contract anniversary cadence currently supports monthly, quarterly, semi-annually, and annual billing frequencies. weekly is not supported yet. Use one of the supported frequencies or invoice on the client billing schedule instead.',
    );

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
