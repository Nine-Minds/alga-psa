import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/BillingDashboard.tsx', import.meta.url),
  'utf8'
);

describe('BillingDashboard renewals route wiring', () => {
  it('registers a renewals Tabs.Content route in the tab host', () => {
    expect(source).toContain('<Tabs.Content value="renewals">');
    expect(source).toContain('data-testid="renewals-tab-content"');
  });
});
