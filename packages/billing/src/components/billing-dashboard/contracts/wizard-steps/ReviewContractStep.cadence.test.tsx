// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Non-template wizard review: a cadence Prepaid Block line summarizes as "N h every billing period
 * for <price>" with its rollover, the price in the contract currency; a consumption line keeps its
 * existing summary. Strings resolve from a package-local fixture that mirrors the English
 * `msp/contracts` entries (the test must not import the server locale files: that would make
 * @alga-psa/billing depend on `server`). The fixture has no defaultValue fallbacks, so a key the
 * component stops using, or a new one it adds, shows up as MISSING.
 */

const contractsLocale = {
  wizardReview: {
    sections: { prepaidBlocks: 'Prepaid Block Lines' },
    prepaid: {
      badgeCount_one: '{{count}} line',
      badgeCount_other: '{{count}} lines',
      blockSummary: '{{hours}} hours for {{price}}',
      expiresAfter_one: 'expires after {{count}} month',
      expiresAfter_other: 'expires after {{count}} months',
      neverExpires: 'never expires',
      cadenceSummary: '{{hours}} h every billing period for {{price}}',
      overageRate: 'overage {{rate}}/h',
    },
  },
  prepaidBlock: {
    fields: {
      rolloverCarry_one: 'Carry over {{count}} period',
      rolloverCarry_other: 'Carry over {{count}} periods',
      rolloverNone: 'Expire at the end of the period',
    },
  },
} as const;

function lookup(key: string): string | undefined {
  let node: any = contractsLocale;
  for (const part of key.split('.')) {
    node = node?.[part];
    if (node === undefined) return undefined;
  }
  return typeof node === 'string' ? node : undefined;
}

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getClientByIdForBilling: vi.fn(async () => ({ client_name: 'Example Client' })),
}));
vi.mock('@alga-psa/billing/actions/billingProfileActions', () => ({
  getClientBillingProfilesForBilling: vi.fn(async () => []),
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/billing/hooks/useBillingEnumOptions')>()),
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
  useFormatBillingFrequency: () => (value: string) => value,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) => {
      const count = options.count as number | undefined;
      const plural = count === undefined ? undefined : lookup(`${key}_${count === 1 ? 'one' : 'other'}`);
      const template = plural ?? lookup(key) ?? `MISSING:${key}`;
      return template.replace(/{{(\w+)}}/g, (_m, token) => String(options[token] ?? ''));
    },
  }),
  useFormatters: () => ({
    formatCurrency: (value: number, currency: string) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value),
    formatNumber: (value: number) => String(value),
    formatDate: (value: Date) => value.toISOString().slice(0, 10),
  }),
}));

const { ReviewContractStep } = await import('./ReviewContractStep');
const { emptyPrepaidBlockDraft, withIssueMode } = await import('../prepaidBlockConfigDraft');

function renderStep(block: ReturnType<typeof emptyPrepaidBlockDraft>) {
  const data: any = {
    client_id: 'client-1',
    contract_name: 'Example Support',
    billing_frequency: 'monthly',
    currency_code: 'EUR',
    start_date: '2026-01-01',
    fixed_lines: [],
    product_services: [],
    hourly_services: [],
    usage_services: [],
    prepaid_block_drafts: [
      { name: 'Support block', services: [{ service_id: 'svc-1', service_name: 'Support', hourly_rate: 12000 }], block },
    ],
  };
  return render(<ReviewContractStep data={data} />);
}

describe('ReviewContractStep cadence Prepaid Block', () => {
  afterEach(() => cleanup());

  it('summarizes a cadence block with hours, contract-currency price and rollover', () => {
    renderStep({
      ...withIssueMode(emptyPrepaidBlockDraft(), 'cadence'),
      hours: '10', priceMinor: 90000, priceManual: true, rolloverPeriods: '2',
    });
    expect(document.getElementById('wizard-review-prepaid-blocks')).not.toBeNull();
    expect(document.getElementById('wizard-review-prepaid-block-0')).not.toBeNull();
    const summary = document.getElementById('wizard-review-prepaid-block-0-summary');
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent('10 h every billing period for €900.00');
    expect(summary).toHaveTextContent('Carry over 2 periods');
    expect(summary).not.toHaveTextContent('MISSING:');
  });

  it('has no cadence summary for a consumption block', () => {
    renderStep({ ...emptyPrepaidBlockDraft(), hours: '10', priceMinor: 90000, priceManual: true });
    expect(document.getElementById('wizard-review-prepaid-block-0-summary')).toBeNull();
    expect(document.getElementById('wizard-review-prepaid-block-0')).toHaveTextContent('10 hours for €900.00');
  });
});
