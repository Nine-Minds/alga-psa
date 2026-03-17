/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BillingOverviewTab from './BillingOverviewTab';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        return fallback;
      }
      return _key;
    },
  }),
}));

vi.mock('./BucketUsageChart', () => ({
  default: () => <div>bucket-chart</div>,
}));

vi.mock('./PlanDetailsDialog', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: ({ ...props }: any) => <div {...props}>loading</div>,
}));

afterEach(() => {
  cleanup();
});

describe('BillingOverviewTab recurring service periods', () => {
  it('renders canonical service-period and cadence-owner summaries on the overview cards', () => {
    render(
      <BillingOverviewTab
        contractLine={{
          contract_line_id: 'line-1',
          contract_line_name: 'Managed Firewall',
          billing_frequency: 'Monthly',
          billing_timing: 'advance',
          cadence_owner: 'client',
          start_date: '2026-01-01',
          end_date: null,
          is_active: true,
        } as any}
        invoices={[
          {
            invoice_id: 'inv-1',
            invoice_number: 'INV-001',
            client_id: 'client-1',
            client: { name: 'Acme Corp', logo: '', address: '' },
            contact: { name: '', address: '' },
            invoice_date: '2026-02-01' as any,
            due_date: '2026-02-15' as any,
            status: 'sent',
            subtotal: 10000,
            tax: 0,
            total: 10000,
            total_amount: 10000,
            credit_applied: 0,
            is_manual: false,
            invoice_charges: [],
            currencyCode: 'USD',
            service_period_start: '2026-01-01' as any,
            service_period_end: '2026-02-01' as any,
          },
        ] as any}
        bucketUsage={[]}
        isBucketUsageLoading={false}
        isLoading={false}
        formatCurrency={(amount) => `$${(amount / 100).toFixed(2)}`}
        formatDate={(date) => String(date)}
      />
    );

    expect(
      screen.getByText('Recurring service periods follow the client billing schedule for this line.')
    ).toBeInTheDocument();
    expect(screen.getByText('Service Period: 2026-01-01 - 2026-02-01')).toBeInTheDocument();
  });
});
