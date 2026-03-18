/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import InvoiceDetailsDialog from './InvoiceDetailsDialog';

const invoiceFixture = {
  invoice_id: 'inv-1',
  client_id: 'client-1',
  invoice_date: '2026-02-01',
  due_date: '2026-02-15',
  subtotal: 10000,
  tax: 0,
  total: 10000,
  total_amount: 10000,
  currencyCode: 'USD',
  currency_code: 'USD',
  status: 'sent',
  invoice_number: 'INV-001',
  finalized_at: '2026-02-01',
  credit_applied: 0,
  is_manual: false,
  invoice_charges: [
    {
      item_id: 'charge-1',
      invoice_id: 'inv-1',
      description: 'Managed Firewall',
      quantity: 1,
      unit_price: 10000,
      total_price: 10000,
      tax_amount: 0,
      net_amount: 10000,
      is_manual: false,
      service_period_start: '2026-01-01',
      service_period_end: '2026-02-01',
      billing_timing: 'advance',
      cadence_owner: 'client',
      recurring_detail_periods: [
        {
          service_period_start: '2026-02-01',
          service_period_end: '2026-03-01',
          billing_timing: 'advance',
        },
        {
          service_period_start: '2026-01-01',
          service_period_end: '2026-02-01',
          billing_timing: 'advance',
        },
      ],
    },
    {
      item_id: 'charge-contract',
      invoice_id: 'inv-1',
      description: 'Contract Anniversary Backup',
      quantity: 1,
      unit_price: 7000,
      total_price: 7000,
      tax_amount: 0,
      net_amount: 7000,
      is_manual: false,
      service_period_start: '2026-01-08',
      service_period_end: '2026-02-08',
      billing_timing: 'advance',
      cadence_owner: 'contract',
      recurring_detail_periods: [
        {
          service_period_start: '2026-01-08',
          service_period_end: '2026-02-08',
          billing_timing: 'advance',
        },
      ],
    },
    {
      item_id: 'charge-2',
      invoice_id: 'inv-1',
      description: 'Legacy Summary Service',
      quantity: 1,
      unit_price: 5000,
      total_price: 5000,
      tax_amount: 0,
      net_amount: 5000,
      is_manual: false,
      service_period_start: '2025-12-01',
      service_period_end: '2026-01-01',
    },
    {
      item_id: 'charge-3',
      invoice_id: 'inv-1',
      description: 'Manual Credit',
      quantity: 1,
      unit_price: -500,
      total_price: -500,
      tax_amount: 0,
      net_amount: -500,
      is_manual: true,
    },
  ],
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/client-portal/actions', () => ({
  getClientInvoiceById: vi.fn(async () => invoiceFixture),
  downloadClientInvoicePdf: vi.fn(async () => ({ success: true, fileId: 'file-1' })),
  sendClientInvoiceEmail: vi.fn(async () => ({ success: true })),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: any) => (isOpen ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: () => <div>Loading...</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

describe('InvoiceDetailsDialog recurring service periods', () => {
  it('T121: renders canonical recurring service-period metadata for invoice line items', async () => {
    render(
      <InvoiceDetailsDialog
        invoiceId="inv-1"
        isOpen={true}
        onClose={() => {}}
        formatCurrency={(amount) => `$${(amount / 100).toFixed(2)}`}
        formatDate={(date) => String(date)}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Managed Firewall')).toBeInTheDocument();
    });

    expect(screen.getByText('Service Periods:')).toBeInTheDocument();
    const firewallRow = screen.getByText('Managed Firewall').closest('tr');
    expect(firewallRow).not.toBeNull();
    expect(within(firewallRow as HTMLElement).getAllByRole('listitem').map((node) => node.textContent)).toEqual([
      '2026-01-01 - 2026-02-01',
      '2026-02-01 - 2026-03-01',
    ]);
    expect(within(firewallRow as HTMLElement).getByText('Advance')).toBeInTheDocument();
  });

  it('T196: client-portal invoice detail dialogs flatten or omit recurring period copy according to the documented projection policy', async () => {
    render(
      <InvoiceDetailsDialog
        invoiceId="inv-1"
        isOpen={true}
        onClose={() => {}}
        formatCurrency={(amount) => `$${(amount / 100).toFixed(2)}`}
        formatDate={(date) => String(date)}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Legacy Summary Service')).toBeInTheDocument();
      expect(screen.getByText('Manual Credit')).toBeInTheDocument();
    });

    const legacySummaryRow = screen.getByText('Legacy Summary Service').closest('tr');
    expect(legacySummaryRow).not.toBeNull();
    expect(within(legacySummaryRow as HTMLElement).getByText('Service Period: 2025-12-01 - 2026-01-01')).toBeInTheDocument();
    expect(within(legacySummaryRow as HTMLElement).queryByText('Service Periods:')).not.toBeInTheDocument();

    const manualRow = screen.getByText('Manual Credit').closest('tr');
    expect(manualRow).not.toBeNull();
    expect(within(manualRow as HTMLElement).queryByText(/Service Period/)).not.toBeInTheDocument();
    expect(within(manualRow as HTMLElement).getByText('Financial-only line. No recurring service period.')).toBeInTheDocument();
  });

  it('T267: client-portal invoice detail dialogs intentionally render or omit canonical recurring detail periods according to policy', async () => {
    render(
      <InvoiceDetailsDialog
        invoiceId="inv-1"
        isOpen={true}
        onClose={() => {}}
        formatCurrency={(amount) => `$${(amount / 100).toFixed(2)}`}
        formatDate={(date) => String(date)}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Managed Firewall')).toBeInTheDocument();
      expect(screen.getByText('Manual Credit')).toBeInTheDocument();
    });

    const recurringRow = screen.getByText('Managed Firewall').closest('tr');
    expect(recurringRow).not.toBeNull();
    expect(within(recurringRow as HTMLElement).getByText('Service Periods:')).toBeInTheDocument();
    expect(within(recurringRow as HTMLElement).getAllByRole('listitem').map((node) => node.textContent)).toEqual([
      '2026-01-01 - 2026-02-01',
      '2026-02-01 - 2026-03-01',
    ]);

    const manualRow = screen.getByText('Manual Credit').closest('tr');
    expect(manualRow).not.toBeNull();
    expect(within(manualRow as HTMLElement).queryByText(/Service Period/)).not.toBeInTheDocument();
    expect(within(manualRow as HTMLElement).getByText('Financial-only line. No recurring service period.')).toBeInTheDocument();
  });

  it('keeps client- and contract-cadence recurring lines readable when one invoice mixes both canonical detail-backed shapes', async () => {
    render(
      <InvoiceDetailsDialog
        invoiceId="inv-1"
        isOpen={true}
        onClose={() => {}}
        formatCurrency={(amount) => `$${(amount / 100).toFixed(2)}`}
        formatDate={(date) => String(date)}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Managed Firewall')).toBeInTheDocument();
      expect(screen.getByText('Contract Anniversary Backup')).toBeInTheDocument();
    });

    const clientCadenceRow = screen.getByText('Managed Firewall').closest('tr');
    expect(clientCadenceRow).not.toBeNull();
    expect(within(clientCadenceRow as HTMLElement).getByText('Service Periods:')).toBeInTheDocument();

    const contractCadenceRow = screen.getByText('Contract Anniversary Backup').closest('tr');
    expect(contractCadenceRow).not.toBeNull();
    expect(
      within(contractCadenceRow as HTMLElement).getByText('Service Period: 2026-01-08 - 2026-02-08')
    ).toBeInTheDocument();
  });
});
