import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('fixed recurring partial-period copy wiring', () => {
  it('T115: fixed recurring configuration panels explain partial-period coverage instead of proration as a timing workaround', () => {
    const files = [
      '../src/components/billing-dashboard/contract-lines/FixedContractLineConfiguration.tsx',
      '../src/components/billing-dashboard/contract-lines/FixedContractLinePresetConfiguration.tsx',
      '../src/components/billing-dashboard/ContractLineDialog.tsx',
      '../src/components/billing-dashboard/contracts/CreateCustomContractLineDialog.tsx',
      '../src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep.tsx',
      '../src/components/billing-dashboard/contracts/wizard-steps/ReviewContractStep.tsx',
      '../src/components/billing-dashboard/service-configurations/FixedServiceConfigPanel.tsx',
    ].map((file) => readFileSync(resolve(__dirname, file), 'utf8'));

    const combined = files.join('\n');

    expect(combined).toContain(
      'whether partial-period coverage should adjust the charge'
    );
    expect(combined).toContain(
      'the recurring fee scales to the covered portion of a service period'
    );
    expect(combined).toContain('Partial-Period Adjustment:');
    expect(combined).toContain(
      'Controls how partial-period coverage is calculated when the recurring fee needs to scale to less than a full service period.'
    );
    expect(combined).toContain('Adjust for Partial Periods');
    expect(combined).toContain('Partial-Period Adjustment:');
    expect(combined).not.toContain(
      'Toggle this on if you want the base rate to be prorated when the contract starts mid-cycle.'
    );
    expect(combined).not.toContain(
      'When enabled, the recurring fee will be prorated for partial billing periods'
    );
    expect(combined).not.toContain('Enable Proration');
    expect(combined).not.toContain('<strong>Proration:</strong>');
  });
});
