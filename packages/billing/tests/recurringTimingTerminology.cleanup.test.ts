import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('recurring timing terminology cleanup', () => {
  it('T165: migrated UI copy, comments, and portal summaries avoid stale recurring timing terminology', () => {
    const billingUiSources = [
      '../src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep.tsx',
      '../src/components/billing-dashboard/ContractLineDialog.tsx',
      '../src/components/billing-dashboard/contracts/CreateCustomContractLineDialog.tsx',
      '../src/components/billing-dashboard/contract-lines/FixedContractLineConfiguration.tsx',
      '../src/components/billing-dashboard/contract-lines/FixedContractLinePresetConfiguration.tsx',
      '../src/components/billing-dashboard/service-configurations/FixedServiceConfigPanel.tsx',
    ].map((file) => readFileSync(resolve(__dirname, file), 'utf8'));

    const portalSummarySource = readFileSync(
      resolve(__dirname, '../../client-portal/src/components/billing/PaymentSuccessContent.tsx'),
      'utf8'
    );
    const mspSuccessSource = readFileSync(
      resolve(__dirname, '../../../server/src/app/msp/licenses/purchase/success/page.tsx'),
      'utf8'
    );
    const actionCommentsSource = readFileSync(
      resolve(__dirname, '../src/actions/contractLineAction.ts'),
      'utf8'
    );

    const combined = [
      ...billingUiSources,
      portalSummarySource,
      mspSuccessSource,
      actionCommentsSource,
    ].join('\n');

    expect(combined).toContain('Adjust for Partial Periods');
    expect(combined).toContain('Partial-Period Adjustment');
    expect(combined).toContain('partial-period charge adjustments');
    expect(combined).toContain('legacy partial-period compatibility');

    expect(combined).not.toContain('Enable Proration');
    expect(combined).not.toContain('<strong>Proration:</strong>');
    expect(combined).not.toContain('prorated charges');
    expect(combined).not.toContain('proration-only copy');
    expect(combined).not.toContain('proration/alignment');
  });
});
