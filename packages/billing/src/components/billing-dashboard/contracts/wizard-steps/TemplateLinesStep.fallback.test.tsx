/**
 * @vitest-environment jsdom
 */
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useOptionalI18n: () => null,
  useTranslation: () => ({
    t: (key: string, fallback?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
      if (!fallback) return key;
      if (typeof fallback === 'string') return fallback;
      const base = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : key;
      return base.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(fallback[name] ?? ''));
    },
  }),
  useFormatters: () => ({ locale: 'en-US' }),
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
  useFormatBillingFrequency: () => (value: string) => value,
  useFormatContractLineType: () => (value: string) => value,
}));

import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import { TemplateLinesStep } from './TemplateLinesStep';
import { findMissingTemplateAmounts } from './templateLineAmounts';

const field = (over: Record<string, unknown> = {}) => ({
  slot_key: 'k',
  template_amount: null,
  amount: null,
  catalog_amount: null,
  required: false,
  ...over,
});

function makeView(source: 'none' | 'price_set'): any {
  const fallback = source === 'none';
  return {
    template_id: 't1',
    currency_code: 'EUR',
    template_currency: 'USD',
    amount_source: source,
    can_save_template_amounts: true,
    lines: [
      {
        template_line_id: 'l1',
        line_name: 'Support',
        line_type: 'Hourly',
        billing_frequency: 'monthly',
        bucket_pool_count: 1,
        base_rate: field(),
        overtime_rate: field({ slot_key: 'ot', template_amount: 22500, required: fallback, amount: fallback ? null : 21000 }),
        bucket_pools: [
          {
            template_bucket_id: 'b1',
            name: 'Block',
            overage_rate: field({ slot_key: 'ov', template_amount: 9000, required: fallback, amount: fallback ? null : 8500 }),
          },
        ],
        services: [
          {
            service_id: 's1',
            service_name: 'Helpdesk',
            quantity: 1,
            rate: field({
              slot_key: 'a',
              template_amount: 15000,
              required: fallback,
              amount: fallback ? null : 14000,
              catalog_amount: fallback ? 12000 : null,
            }),
            overtime_rate: field({ slot_key: 'mot', template_amount: 20000, required: fallback, amount: fallback ? null : 19000 }),
            bucket_overage_rate: field(),
          },
          {
            service_id: 's2',
            service_name: 'Onsite',
            quantity: 1,
            rate: field({ slot_key: 'b', template_amount: 20000, required: fallback, amount: fallback ? null : 18000 }),
            overtime_rate: field(),
            bucket_overage_rate: field(),
          },
        ],
      },
    ],
  };
}

function Harness({ view, onEdits }: { view: any; onEdits?: (edits: any[]) => void }) {
  const [edits, setEdits] = useState<any[]>([]);
  onEdits?.(edits);
  return (
    <CurrencyFormatProvider currencyCode="EUR">
      <TemplateLinesStep view={view} isLoading={false} loadError={null} edits={edits} onChange={setEdits} />
    </CurrencyFormatProvider>
  );
}

describe('TemplateLinesStep (mismatch fallback)', () => {
  afterEach(() => cleanup());

  it('shows the fallback alert, template-currency references and a blocking message per unfilled field', () => {
    let latest: any[] = [];
    const view = makeView('none');
    const { container } = render(<Harness view={view} onEdits={(e) => (latest = e)} />);

    expect(container.querySelector('#template-fallback-alert')).toHaveTextContent(
      'This template has no EUR rates. Its structure is copied; enter EUR amounts below.',
    );
    // References are in the template currency (USD), not the contract currency.
    expect(screen.getByText(/Template: \$150\.00 USD/)).toBeInTheDocument();
    expect(screen.getByText(/Template: \$225\.00 USD/)).toBeInTheDocument(); // line overtime
    expect(screen.getAllByText(/Template: \$200\.00 USD/)).toHaveLength(2); // member overtime + Onsite rate
    expect(screen.getByText(/Template: \$90\.00 USD/)).toBeInTheDocument(); // pool overage

    // Helpdesk's rate is pre-filled from the EUR catalog and labelled so.
    expect(screen.getByText('Catalog price')).toBeInTheDocument();
    expect(latest[0].services.find((s: any) => s.service_id === 's1').rate).toBe(12000);

    // Everything else is required and blank: it is flagged and blocks creation.
    expect(screen.getAllByText(/No EUR amount\. Enter one/).length).toBeGreaterThanOrEqual(4);
    const missing = findMissingTemplateAmounts(view, latest);
    expect(missing.map((ref) => ref.kind).sort()).toEqual(
      ['bucket_overage_rate', 'line_overtime_rate', 'member_overtime_rate', 'member_rate'],
    );
  });

  it('renders a matching price set without references, fallback alert or blocks', () => {
    const view = makeView('price_set');
    const { container } = render(<Harness view={view} />);
    expect(container.querySelector('#template-fallback-alert')).toBeNull();
    expect(screen.queryByText(/Template: /)).toBeNull();
    expect(screen.queryByText(/No EUR amount/)).toBeNull();
    expect(screen.getAllByText("From the template's EUR rates").length).toBeGreaterThan(0);
    expect(findMissingTemplateAmounts(view, [])).toEqual([]);
  });
});
