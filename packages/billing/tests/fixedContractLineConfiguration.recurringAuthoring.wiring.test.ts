import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const fixedConfigurationSource = readFileSync(
  new URL('../src/components/billing-dashboard/contract-lines/FixedContractLineConfiguration.tsx', import.meta.url),
  'utf8',
);
const contractLineActionSource = readFileSync(
  new URL('../src/actions/contractLineAction.ts', import.meta.url),
  'utf8',
);

describe('fixed contract line recurring authoring wiring', () => {
  it('T232: inline fixed-line editing persists cadence owner and billing timing through one updateContractLine mutation', () => {
    expect(fixedConfigurationSource).toContain('cadence_owner: cadenceOwner,');
    expect(fixedConfigurationSource).toContain("billing_timing: planType === 'Fixed' ? billingTiming : 'arrears',");
    expect(fixedConfigurationSource).toContain('await updateContractLine(plan.contract_line_id, planData);');
    expect(fixedConfigurationSource).not.toContain('await upsertContractLineTerms(');

    expect(contractLineActionSource).toContain(
      'resolveRecurringAuthoringPolicy',
    );
    expect(contractLineActionSource).toContain(
      'safeUpdateData.cadence_owner = recurringAuthoringPolicy.cadenceOwner;',
    );
    expect(contractLineActionSource).toContain(
      'safeUpdateData.billing_timing = recurringAuthoringPolicy.billingTiming;',
    );
  });
});
