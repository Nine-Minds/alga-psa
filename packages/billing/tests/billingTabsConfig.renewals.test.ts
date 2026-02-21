import { describe, expect, it } from 'vitest';
import { billingTabDefinitions, type BillingTabValue } from '../src/components/billing-dashboard/billingTabsConfig';

describe('billingTabsConfig renewals tab metadata', () => {
  it('includes renewals in BillingTabValue union usage and tab definitions', () => {
    const values: BillingTabValue[] = billingTabDefinitions.map((tab) => tab.value);

    expect(values).toContain('renewals');

    const renewals = billingTabDefinitions.find((tab) => tab.value === 'renewals');
    expect(renewals).toMatchObject({
      value: 'renewals',
      label: 'Renewals',
      href: '/msp/billing?tab=renewals',
    });
  });
});
