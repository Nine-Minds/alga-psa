import { describe, expect, it } from 'vitest';
import { billingTabDefinitions, type BillingTabValue } from '../src/components/billing-dashboard/billingTabsConfig';

describe('billingTabsConfig renewals tab metadata', () => {
  it('does not include renewals as a standalone billing tab', () => {
    const values: BillingTabValue[] = billingTabDefinitions.map((tab) => tab.value);

    expect(values).not.toContain('renewals');
  });
});
