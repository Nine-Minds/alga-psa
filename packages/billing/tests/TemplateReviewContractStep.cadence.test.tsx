/**
 * @vitest-environment jsdom
 *
 * Template wizard review: a cadence Prepaid Block line summarizes as "N h every billing period for
 * <price>" with its rollover, in the template's base currency; a consumption line keeps its
 * existing summary.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useOptionalI18n: () => null,
  useTranslation: () => ({
    t: (key: string, opts?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
      if (!opts) return key;
      if (typeof opts === 'string') return opts;
      const base = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
      return base.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts[name] ?? ''));
    },
  }),
  useFormatters: () => ({
    locale: 'en-US',
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat('en-US', options).format(value),
  }),
}));
vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useFormatBillingFrequency: () => (value: string) => value,
}));

import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import { TemplateReviewContractStep } from '../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateReviewContractStep';
import { emptyPrepaidBlockDraft, withIssueMode } from '../src/components/billing-dashboard/contracts/prepaidBlockConfigDraft';

function renderStep(block: ReturnType<typeof emptyPrepaidBlockDraft>) {
  const data: any = {
    contract_name: 'Block Template', description: '', billing_frequency: 'monthly', cadence_owner: 'client',
    billing_timing: 'advance', enable_proration: false, currency_code: 'EUR',
    fixed_services: [], product_services: [], hourly_services: [], usage_services: [],
    prepaid_block_drafts: [{ name: 'Support block', services: [{ service_id: 'svc-1', service_name: 'Support' }], block }],
  };
  return render(
    <CurrencyFormatProvider currencyCode="USD">
      <TemplateReviewContractStep data={data} updateData={vi.fn()} />
    </CurrencyFormatProvider>,
  );
}

describe('TemplateReviewContractStep cadence Prepaid Block', () => {
  afterEach(() => cleanup());

  it('summarizes a cadence block with its price and rollover', () => {
    renderStep({
      ...withIssueMode(emptyPrepaidBlockDraft(), 'cadence'),
      hours: '10', priceMinor: 90000, priceManual: true, rolloverPeriods: '2',
    });
    const summary = document.getElementById('template-review-prepaid-block-0-summary');
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent('10 h every billing period for');
    expect(summary).toHaveTextContent(/900[.,]00/);
    expect(summary).toHaveTextContent('Carry over 2 periods');
  });

  it('has no cadence summary for a consumption block', () => {
    renderStep({ ...emptyPrepaidBlockDraft(), hours: '10', priceMinor: 90000, priceManual: true });
    expect(document.getElementById('template-review-prepaid-block-0-summary')).toBeNull();
    expect(document.getElementById('template-review-prepaid-block-0')).toHaveTextContent('10 hours for');
  });
});
