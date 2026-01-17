/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

(globalThis as unknown as { React?: typeof React }).React = React;

import * as billingCycleActions from '@alga-psa/billing/actions/billingCycleActions';
import * as billingAndTaxActions from '@alga-psa/billing/actions/billingAndTax';
import * as invoiceGenerationActions from '@alga-psa/billing/actions/invoiceGeneration';

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns, id }: any) => {
    const getValue = (row: any, dataIndex: any) => {
      if (Array.isArray(dataIndex)) {
        return dataIndex.reduce((acc, key) => acc?.[key], row);
      }
      return row?.[dataIndex];
    };
    return (
      <table data-testid={id || 'data-table'}>
        <tbody>
          {data.map((row: any, rowIndex: number) => (
            <tr key={row.billing_cycle_id ?? rowIndex}>
              {columns.map((col: any, colIndex: number) => (
                <td key={colIndex}>
                  {col.render
                    ? col.render(getValue(row, col.dataIndex), row, rowIndex)
                    : String(getValue(row, col.dataIndex) ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: any) => (isOpen ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, title, message, options, onConfirm, onClose, id, confirmLabel = 'Confirm' }: any) => {
    const [selected, setSelected] = React.useState(options?.[0]?.value ?? '');
    if (!isOpen) return null;
    return (
      <div>
        <h2>{title}</h2>
        <div>{message}</div>
        {options?.length ? (
          <div>
            {options.map((opt: any) => (
              <label key={opt.value}>
                <input
                  type="radio"
                  name={`${id}-option`}
                  value={opt.value}
                  checked={selected === opt.value}
                  onChange={() => setSelected(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        ) : null}
        <button id={`${id}-close`} onClick={onClose}>
          Close
        </button>
        <button
          id={`${id}-confirm`}
          onClick={() => onConfirm(options?.length ? selected : undefined)}
        >
          {confirmLabel}
        </button>
      </div>
    );
  },
}));

const { AutomaticInvoices } = await import('@alga-psa/billing');

function createPeriods() {
  return [
    {
      client_id: 'client-1',
      client_name: 'Alpha Co',
      billing_cycle_id: 'cycle-1',
      billing_cycle: 'monthly',
      period_start_date: '2025-01-01T00:00:00Z',
      period_end_date: '2025-02-01T00:00:00Z',
      effective_date: '2025-01-01T00:00:00Z',
      tenant: 'tenant-1',
      can_generate: true,
      is_early: false,
    },
    {
      client_id: 'client-2',
      client_name: 'Beta Co',
      billing_cycle_id: 'cycle-2',
      billing_cycle: 'monthly',
      period_start_date: '2025-01-01T00:00:00Z',
      period_end_date: '2025-02-01T00:00:00Z',
      effective_date: '2025-01-01T00:00:00Z',
      tenant: 'tenant-1',
      can_generate: true,
      is_early: false,
    },
  ] as any;
}

describe('Contract PO UI flows', () => {
  const previewInvoiceMock = vi.spyOn(invoiceGenerationActions, 'previewInvoice');
  const generateInvoiceMock = vi.spyOn(invoiceGenerationActions, 'generateInvoice');
  const getPurchaseOrderOverageForBillingCycleMock = vi.spyOn(
    invoiceGenerationActions,
    'getPurchaseOrderOverageForBillingCycle'
  );
  const getInvoicedBillingCyclesPaginatedMock = vi.spyOn(billingCycleActions, 'getInvoicedBillingCyclesPaginated');
  const removeBillingCycleMock = vi.spyOn(billingCycleActions, 'removeBillingCycle');
  const hardDeleteBillingCycleMock = vi.spyOn(billingCycleActions, 'hardDeleteBillingCycle');
  const getAvailableBillingPeriodsMock = vi.spyOn(billingAndTaxActions, 'getAvailableBillingPeriods');

  beforeEach(() => {
    previewInvoiceMock.mockReset();
    generateInvoiceMock.mockReset();
    getPurchaseOrderOverageForBillingCycleMock.mockReset();
    getInvoicedBillingCyclesPaginatedMock.mockReset();
    removeBillingCycleMock.mockReset();
    hardDeleteBillingCycleMock.mockReset();
    getAvailableBillingPeriodsMock.mockReset();

    // Mock paginated invoiced cycles (empty)
    getInvoicedBillingCyclesPaginatedMock.mockResolvedValue({
      cycles: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0
    });
    // Mock paginated available billing periods with test data
    getAvailableBillingPeriodsMock.mockResolvedValue({
      periods: createPeriods(),
      total: 2,
      page: 1,
      pageSize: 10,
      totalPages: 1
    });
    generateInvoiceMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('T007: batch invoicing does not prompt when no invoice can overrun PO limits', async () => {
    getPurchaseOrderOverageForBillingCycleMock.mockResolvedValue(null);

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    // Wait for data to load
    await waitFor(() => {
      expect(getAvailableBillingPeriodsMock).toHaveBeenCalled();
    });

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!
    const checkboxes = within(readyTable).getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);

    const generateButtons = screen.getAllByRole('button', {
      name: /Generate Invoices for Selected Periods/i,
    });
    const generateButton = generateButtons.find((b) => !(b as HTMLButtonElement).disabled);
    expect(generateButton).toBeTruthy();
    fireEvent.click(generateButton!);

    await waitFor(() => {
      expect(getPurchaseOrderOverageForBillingCycleMock).toHaveBeenCalledTimes(2);
      expect(generateInvoiceMock).toHaveBeenCalledTimes(2);
    });

    expect(screen.queryByText('Purchase Order Limit Overages')).toBeNull();
  });

  it('T008: batch invoicing prompts upfront when overage possible and can skip overage invoices', async () => {
    getPurchaseOrderOverageForBillingCycleMock.mockImplementation(async (billingCycleId: string) => {
      if (billingCycleId === 'cycle-1') {
        return { overage_cents: 500, po_number: 'PO-1' };
      }
      return null;
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    // Wait for data to load
    await waitFor(() => {
      expect(getAvailableBillingPeriodsMock).toHaveBeenCalled();
    });

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!
    const checkboxes = within(readyTable).getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);

    const generateButtons = screen.getAllByRole('button', {
      name: /Generate Invoices for Selected Periods/i,
    });
    const generateButton = generateButtons.find((b) => !(b as HTMLButtonElement).disabled);
    expect(generateButton).toBeTruthy();
    fireEvent.click(generateButton!);

    await waitFor(() => {
      expect(screen.getByText('Purchase Order Limit Overages')).toBeInTheDocument();
      expect(screen.getByText(/over by/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Skip invoices that would overrun their PO'));
    fireEvent.click(document.getElementById('po-overage-batch-decision-confirm')!);

    await waitFor(() => {
      expect(generateInvoiceMock).toHaveBeenCalledTimes(1);
      expect(generateInvoiceMock).toHaveBeenCalledWith('cycle-2', { allowPoOverage: false });
    });

    await waitFor(() => {
      expect(screen.getByText(/Skipped due to PO overage/i)).toBeInTheDocument();
    });
  });

  it('T006: single invoice requires explicit override confirmation to proceed on overage', async () => {
    getPurchaseOrderOverageForBillingCycleMock.mockResolvedValue({ overage_cents: 2500, po_number: 'PO-OVR' });
    previewInvoiceMock.mockResolvedValue({
      success: true,
      data: {
        invoiceNumber: 'INV-TEST',
        issueDate: '2025-01-01',
        dueDate: '2025-02-01',
        currencyCode: 'USD',
        customer: { name: 'Alpha Co', address: '1 Test St' },
        tenantClient: { name: 'Tenant', address: 'Tenant Address', logoUrl: null },
        items: [],
        subtotal: 0,
        tax: 0,
        total: 0,
      },
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    // Wait for data to load
    await waitFor(() => {
      expect(getAvailableBillingPeriodsMock).toHaveBeenCalled();
    });

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!
    const checkbox = within(readyTable).getAllByRole('checkbox')[0];
    fireEvent.click(checkbox!);

    const previewButtons = screen.getAllByRole('button', { name: /Preview Selected/i });
    const previewButton = previewButtons.find((b) => !(b as HTMLButtonElement).disabled);
    expect(previewButton).toBeTruthy();
    fireEvent.click(previewButton!);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Generate Invoice$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Generate Invoice$/i }));

    await waitFor(() => {
      expect(getPurchaseOrderOverageForBillingCycleMock).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /Proceed Anyway/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Proceed Anyway/i }));

    await waitFor(() => {
      expect(getPurchaseOrderOverageForBillingCycleMock).toHaveBeenCalledTimes(1);
    });

    const [billingCycleId] = getPurchaseOrderOverageForBillingCycleMock.mock.calls[0] ?? [];
    expect(typeof billingCycleId).toBe('string');

    await waitFor(() => {
      expect(generateInvoiceMock).toHaveBeenCalledWith(billingCycleId, { allowPoOverage: true });
    });
  });
});
