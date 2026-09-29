/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import fs from 'node:fs';
import path from 'node:path';

// Resolve strings from the real en locale so the test covers the shipped bucketSummary text.
const enLocale = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../../../../server/public/locales/en/msp/contracts.json'), 'utf8'),
) as Record<string, unknown>;
const lookup = (key: string): string | undefined => {
  const value = key.split('.').reduce<unknown>(
    (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
    enLocale,
  );
  return typeof value === 'string' ? value : undefined;
};

const actions = vi.hoisted(() => ({
  getContractById: vi.fn(),
  getContractSummary: vi.fn(),
  getContractAssignments: vi.fn(),
  getDetailedContractLines: vi.fn(),
  getTemplateLineServicesWithConfigurations: vi.fn(),
  getDefaultBillingSettings: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractActions', () => actions);
vi.mock('@alga-psa/billing/actions/contractLineServiceActions', () => ({
  getContractLineServicesWithConfigurations: vi.fn(),
  getTemplateLineServicesWithConfigurations: (...args: unknown[]) => actions.getTemplateLineServicesWithConfigurations(...args),
}));
vi.mock('@alga-psa/billing/actions/billingSettingsActions', () => ({
  getDefaultBillingSettings: (...args: unknown[]) => actions.getDefaultBillingSettings(...args),
}));
vi.mock('@alga-psa/billing/actions/contractSimulationActions', () => ({
  listContractSimulationClients: vi.fn().mockResolvedValue([]),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useOptionalI18n: () => null,
  useTranslation: () => ({
    t: (key: string, fallback?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
      if (!fallback) return key;
      if (typeof fallback === 'string') return fallback;
      const base = lookup(key) ?? (typeof fallback.defaultValue === 'string' ? fallback.defaultValue : key);
      return base.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(fallback[name] ?? ''));
    },
  }),
  useFormatters: () => ({ locale: 'en-US' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('contractId=template-1'),
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [],
}));
vi.mock('../contract-lines/GenericContractLineServicesList', () => ({
  default: () => <div />,
}));
vi.mock('./ContractLineEditDialog', () => ({ ContractLineEditDialog: () => null }));

import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import ContractTemplateDetail from './ContractTemplateDetail';

const NBSP = /\u00a0/g;

function mockTemplate(currencyCode: string, overageRate: number | null | undefined) {
  actions.getContractById.mockResolvedValue({
    contract_id: 'template-1',
    contract_name: 'Template One',
    contract_type: 'Fixed',
    billing_frequency: 'monthly',
    currency_code: currencyCode,
    status: 'draft',
    is_template: true,
    template_metadata: {},
  });
  actions.getContractSummary.mockResolvedValue({});
  actions.getContractAssignments.mockResolvedValue([]);
  actions.getDetailedContractLines.mockResolvedValue([{
    contract_line_id: 'line-1',
    contract_line_name: 'Support',
    contract_line_type: 'Hourly',
    billing_frequency: 'monthly',
    rate: 12345,
  }]);
  actions.getTemplateLineServicesWithConfigurations.mockResolvedValue([{
    service: { service_id: 'svc-1', service_name: 'Help Desk', billing_method: 'hourly' },
    configuration: { service_id: 'svc-1', configuration_type: 'Bucket', quantity: null },
    typeConfig: null,
    bucketConfig: {
      total_minutes: 600,
      overage_rate: overageRate,
      allow_rollover: false,
      billing_period: 'monthly',
    },
  }]);
  actions.getDefaultBillingSettings.mockResolvedValue({ defaultCurrencyCode: 'USD' });
}

async function renderBucketSummary(): Promise<string> {
  render(
    <CurrencyFormatProvider currencyCode="USD" locale="en-US">
      <ContractTemplateDetail />
    </CurrencyFormatProvider>,
  );
  const summary = await screen.findByText(/Bucket: 600 min/);
  return (summary.textContent ?? '').replace(NBSP, ' ');
}

describe('ContractTemplateDetail bucket summary overage', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders a USD overage of 7500 minor units as $75.00', async () => {
    mockTemplate('USD', 7500);
    const text = await renderBucketSummary();

    expect(text).toContain('Overage $75.00');
    expect(text).not.toContain('$7500');
    expect(text).not.toContain('$$');
  });

  it('renders a EUR template overage in euros with no dollar sign', async () => {
    mockTemplate('EUR', 7500);
    const text = await renderBucketSummary();

    expect(text).toMatch(/Overage .*75\.00/);
    expect(text).toContain('€');
    expect(text).not.toContain('$');
    expect(text).not.toContain('7500');
  });

  it('renders a GBP template overage with the pound symbol', async () => {
    mockTemplate('GBP', 7500);
    const text = await renderBucketSummary();

    expect(text).toContain('£75.00');
    expect(text).not.toContain('$');
  });

  it('renders a missing overage rate as a zero amount in the template currency', async () => {
    mockTemplate('EUR', null);
    const text = await renderBucketSummary();

    expect(text).toMatch(/Overage .*0\.00/);
    expect(text).toContain('€');
    expect(text).not.toContain('$');
  });
});
