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
  it('T232: inline fixed-line editing preserves cadence owner through updateContractLine and billing timing through upsertContractLineTerms', () => {
    expect(fixedConfigurationSource).toContain('cadence_owner: cadenceOwner,');
    expect(fixedConfigurationSource).toContain('await updateContractLine(plan.contract_line_id, planData);');
    expect(fixedConfigurationSource).toContain(
      "await upsertContractLineTerms(\n          plan.contract_line_id,\n          planType === 'Fixed' ? billingTiming : 'arrears'\n        );",
    );

    expect(contractLineActionSource).toContain(
      "import { resolveRecurringAuthoringPolicy } from '@shared/billingClients/recurringAuthoringPolicy';",
    );
    expect(contractLineActionSource).toContain(
      'safeUpdateData.cadence_owner = recurringAuthoringPolicy.cadenceOwner;',
    );
    expect(contractLineActionSource).toContain(
      'safeUpdateData.billing_timing = recurringAuthoringPolicy.billingTiming;',
    );
  });
});
