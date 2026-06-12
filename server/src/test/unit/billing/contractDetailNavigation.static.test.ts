import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const contractDetailPath = path.resolve(
  process.cwd(),
  '../packages/billing/src/components/billing-dashboard/contracts/ContractDetail.tsx',
);
const billingDashboardPath = path.resolve(
  process.cwd(),
  '../packages/billing/src/components/billing-dashboard/BillingDashboard.tsx',
);

describe('contract detail navigation', () => {
  it('routes back to concrete billing contract list tabs instead of the legacy contracts tab', () => {
    const source = fs.readFileSync(contractDetailPath, 'utf8');

    expect(source).toContain("? '/msp/billing?tab=contract-templates'");
    expect(source).toContain(": '/msp/billing?tab=client-contracts'");
    expect(source).toContain("router.push('/msp/billing?tab=client-contracts')");
    expect(source).not.toContain("tab=contracts&subtab=");
    expect(source).not.toContain("params.set('tab', 'contracts')");
  });

  it('keeps legacy consolidated contracts URLs from falling through to the Quotes tab', () => {
    const source = fs.readFileSync(billingDashboardPath, 'utf8');

    expect(source).toContain("requestedTabParam === 'contracts'");
    expect(source).toContain("? (searchParams?.get('subtab') === 'templates' ? 'contract-templates' : 'client-contracts')");
  });
});
