/**
 * @vitest-environment jsdom
 *
 * PRD R7 / F059: bundle component rows in the portal details dialog follow the
 * client's resolved template (its childRows cells and parentBlankColumns).
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InvoiceBundleRowsLayout } from '@alga-psa/types';
import InvoiceDetailsDialog from './InvoiceDetailsDialog';

// API response fixtures use the shared layout contract independently of the
// billing designer's preset builder.
const quantitiesLayout: InvoiceBundleRowsLayout = {
  columnIds: { description: 'description', quantity: 'quantity', unitPrice: 'unit-price', total: 'line-total' },
  childRows: {
    sourcePath: 'item.components',
    itemBinding: 'component',
    parentBlankColumns: ['quantity', 'unit-price'],
    cells: {
      description: { value: { type: 'path', path: 'component.name' } },
      quantity: {
        value: { type: 'path', path: 'component.quantity' },
        format: 'number',
        change: { value: { type: 'path', path: 'component.quantityChange' }, format: 'signed-number' },
      },
    },
  },
};

const totalOnlyLayout: InvoiceBundleRowsLayout = {
  columnIds: quantitiesLayout.columnIds,
  childRows: {
    sourcePath: 'item.components',
    itemBinding: 'component',
    parentBlankColumns: [],
    cells: {
      description: { value: { type: 'path', path: 'component.name' } },
      quantity: { value: { type: 'path', path: 'component.quantity' }, format: 'number' },
      'line-total': { value: { type: 'path', path: 'component.total' }, format: 'currency' },
    },
  },
};

const snapshot = {
  version: 1,
  subtitle: 'Endpoint management and support',
  components: [
    { serviceId: 'ws', name: 'Workstations', quantity: 48, pricingBasis: 'unit', order: 0, servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-02-01', detailItemIds: ['d1'], previousQuantity: 46, comparison: 'compared' },
  ],
};

const invoiceWith = (layout: any, amounts?: any) => ({
  invoice_id: 'inv-1', client_id: 'client-1', invoice_date: '2026-02-01', due_date: '2026-02-15',
  subtotal: 60000, tax: 0, total: 60000, total_amount: 60000, currencyCode: 'USD', currency_code: 'USD',
  status: 'sent', invoice_number: 'INV-001', finalized_at: '2026-02-01', credit_applied: 0, is_manual: false,
  bundle_rows_layout: layout,
  invoice_charges: [{
    item_id: 'charge-1', invoice_id: 'inv-1', description: 'Managed Workplace', quantity: 1,
    unit_price: 60000, total_price: 60000, tax_amount: 0, net_amount: 60000, is_manual: false,
    bundle_presentation: snapshot,
    ...(amounts ? { bundle_component_amounts: amounts } : {}),
  }],
});

let currentInvoice: any = null;

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
  getClientInvoiceById: vi.fn(async () => currentInvoice),
  downloadClientInvoicePdf: vi.fn(async () => ({ success: true, fileId: 'file-1' })),
  sendClientInvoiceEmail: vi.fn(async () => ({ success: true })),
}));

vi.mock('@alga-psa/billing/actions/billingClientLocationActions', () => ({
  getActiveClientLocationsForBilling: vi.fn(async () => []),
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


const renderDialog = async () => {
  render(
    <InvoiceDetailsDialog
      invoiceId="inv-1"
      isOpen={true}
      onClose={() => {}}
      formatCurrency={(amount) => `$${(amount / 100).toFixed(2)}`}
      formatDate={(date) => String(date)}
    />
  );
  await waitFor(() => expect(screen.getByText('Managed Workplace')).toBeInTheDocument());
  const parent = screen.getByText('Managed Workplace').closest('tr') as HTMLElement;
  const child = document.querySelector('[data-automation-id$="-component-0"]') as HTMLElement;
  return { parent, child, childCells: Array.from(child?.querySelectorAll('td') ?? []).map((td) => td.textContent) };
};

describe('InvoiceDetailsDialog bundle component rows follow the template', () => {
  it('quantities preset: name, +2 change and quantity; no prices; quantity and unit price blank on the bundle row', async () => {
    currentInvoice = invoiceWith(quantitiesLayout);
    const { parent, childCells } = await renderDialog();
    expect(within(parent).getByText('Endpoint management and support')).toBeInTheDocument();
    expect(childCells).toEqual(['\u2022 Workstations', '+248', '', '']);
    const parentCells = Array.from(parent.querySelectorAll('td')).map((td) => td.textContent);
    expect(parentCells.slice(1)).toEqual(['', '', '$600.00']);
  });

  it('a total-only binding shows the component amount but not a unit price', async () => {
    currentInvoice = invoiceWith(
      totalOnlyLayout,
      { d1: { item_detail_id: 'd1', allocated_amount: 60000, rate: 1250 } },
    );
    const { childCells } = await renderDialog();
    expect(childCells).toEqual(['\u2022 Workstations', '48', '', '$600.00']);
  });

  it('draws no component rows without a template layout', async () => {
    currentInvoice = invoiceWith(null);
    const { child } = await renderDialog();
    expect(child).toBeNull();
    expect(screen.queryByText('Endpoint management and support')).not.toBeInTheDocument();
  });
});
