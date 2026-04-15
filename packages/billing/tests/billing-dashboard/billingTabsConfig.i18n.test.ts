// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[key];
  }, record);
}

const expectedLabelKeys: Array<{ value: string; labelKey: string }> = [
  { value: 'quotes', labelKey: 'dashboard.tabs.quotes' },
  { value: 'quote-templates', labelKey: 'dashboard.tabs.quoteLayouts' },
  { value: 'quote-business-templates', labelKey: 'dashboard.tabs.quoteTemplates' },
  { value: 'client-contracts', labelKey: 'dashboard.tabs.clientContracts' },
  { value: 'accounting-exports', labelKey: 'dashboard.tabs.accountingExports' },
  { value: 'contract-templates', labelKey: 'dashboard.tabs.contractTemplates' },
  { value: 'invoicing', labelKey: 'dashboard.tabs.invoicing' },
  { value: 'invoice-templates', labelKey: 'dashboard.tabs.invoiceLayouts' },
  { value: 'tax-rates', labelKey: 'dashboard.tabs.taxRates' },
  { value: 'contract-lines', labelKey: 'dashboard.tabs.contractLinePresets' },
  { value: 'billing-cycles', labelKey: 'dashboard.tabs.billingCycles' },
  { value: 'service-periods', labelKey: 'dashboard.tabs.servicePeriods' },
  { value: 'usage-tracking', labelKey: 'dashboard.tabs.usageTracking' },
  { value: 'reports', labelKey: 'dashboard.tabs.reports' },
  { value: 'service-catalog', labelKey: 'dashboard.tabs.serviceCatalog' },
  { value: 'products', labelKey: 'dashboard.tabs.products' },
];

describe('billingTabsConfig i18n wiring contract', () => {
  it('T031: every tab definition carries a labelKey and BillingDashboard resolves it via t(tab.labelKey, { defaultValue: tab.label })', () => {
    const configSource = read('../../src/components/billing-dashboard/billingTabsConfig.ts');
    const dashboardSource = read('../../src/components/billing-dashboard/BillingDashboard.tsx');

    for (const { value, labelKey } of expectedLabelKeys) {
      // Each definition block mentions both its value and its labelKey
      expect(configSource).toContain(`value: '${value}'`);
      expect(configSource).toContain(`labelKey: '${labelKey}'`);
    }

    // BillingDashboard consumes the labelKey via t()
    expect(dashboardSource).toContain('label: t(tab.labelKey, { defaultValue: tab.label })');
  });

  it('T032: all 16 tab labels are present in the de locale (dashboard.tabs.*)', () => {
    const deLocale = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/de/msp/billing.json'
    );

    for (const { labelKey } of expectedLabelKeys) {
      const value = getLeaf(deLocale, labelKey);
      expect(typeof value, `${labelKey} should be a non-empty string in de locale`).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });
});
