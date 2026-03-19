/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  buildServicePeriodRecurringDueWorkRow,
} from '@alga-psa/shared/billingClients/recurringDueWork';
import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

(globalThis as unknown as { React?: typeof React }).React = React;

import * as billingCycleActions from '@alga-psa/billing/actions/billingCycleActions';
import * as billingAndTaxActions from '@alga-psa/billing/actions/billingAndTax';
import * as invoiceGenerationActions from '@alga-psa/billing/actions/invoiceGeneration';
import * as recurringBillingRunActions from '@alga-psa/billing/actions/recurringBillingRunActions';

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

const { default: AutomaticInvoices } = await import('../../../../../packages/billing/src/components/billing-dashboard/AutomaticInvoices');

function createClientRow(input: {
  clientId: string;
  clientName: string;
  billingCycleId: string;
  scheduleKey: string;
  periodKey: string;
}) {
  return buildServicePeriodRecurringDueWorkRow({
    clientId: input.clientId,
    clientName: input.clientName,
    billingCycleId: input.billingCycleId,
    record: buildRecurringServicePeriodRecord({
      cadenceOwner: 'client',
      duePosition: 'advance',
      sourceObligation: {
        tenant: 'tenant-1',
        obligationId: `${input.clientId}-line-1`,
        obligationType: 'client_contract_line',
        chargeFamily: 'fixed',
      },
      scheduleKey: input.scheduleKey,
      periodKey: input.periodKey,
      invoiceWindow: {
        start: '2025-01-01',
        end: '2025-02-01',
        semantics: 'half_open',
      },
      servicePeriod: {
        start: '2025-01-01',
        end: '2025-02-01',
        semantics: 'half_open',
      },
    }),
  });
}

function createPeriods() {
  return [
    createClientRow({
      clientId: 'client-1',
      clientName: 'Alpha Co',
      billingCycleId: 'cycle-1',
      scheduleKey: 'schedule:tenant-1:client_contract_line:alpha-line-1:client:advance',
      periodKey: 'period:2025-01-01:2025-02-01:alpha',
    }),
    createClientRow({
      clientId: 'client-2',
      clientName: 'Beta Co',
      billingCycleId: 'cycle-2',
      scheduleKey: 'schedule:tenant-1:client_contract_line:beta-line-1:client:advance',
      periodKey: 'period:2025-01-01:2025-02-01:beta',
    }),
  ] as any;
}

function createContractRow() {
  return buildServicePeriodRecurringDueWorkRow({
    clientId: 'client-9',
    clientName: 'Zenith Health',
    contractId: 'contract-1',
    contractLineId: 'line-1',
    contractName: 'Zenith Annual Support',
    contractLineName: 'Managed Services',
    record: buildRecurringServicePeriodRecord({
      cadenceOwner: 'contract',
      duePosition: 'arrears',
      sourceObligation: {
        tenant: 'tenant-1',
        obligationId: 'line-1',
        obligationType: 'contract_line',
        chargeFamily: 'fixed',
      },
      invoiceWindow: {
        start: '2025-04-08',
        end: '2025-05-08',
        semantics: 'half_open',
      },
      servicePeriod: {
        start: '2025-03-08',
        end: '2025-04-08',
        semantics: 'half_open',
      },
    }),
  });
}

describe('Contract PO UI flows', () => {
  const previewInvoiceForSelectionInputMock = vi.spyOn(invoiceGenerationActions, 'previewInvoiceForSelectionInput');
  const getPurchaseOrderOverageForSelectionInputMock = vi.spyOn(
    invoiceGenerationActions,
    'getPurchaseOrderOverageForSelectionInput'
  );
  const generateInvoicesAsRecurringBillingRunMock = vi.spyOn(
    recurringBillingRunActions,
    'generateInvoicesAsRecurringBillingRun'
  );
  const getInvoicedBillingCyclesPaginatedMock = vi.spyOn(billingCycleActions, 'getInvoicedBillingCyclesPaginated');
  const removeBillingCycleMock = vi.spyOn(billingCycleActions, 'removeBillingCycle');
  const hardDeleteBillingCycleMock = vi.spyOn(billingCycleActions, 'hardDeleteBillingCycle');
  const getAvailableRecurringDueWorkMock = vi.spyOn(billingAndTaxActions, 'getAvailableRecurringDueWork');

  beforeEach(() => {
    previewInvoiceForSelectionInputMock.mockReset();
    getPurchaseOrderOverageForSelectionInputMock.mockReset();
    generateInvoicesAsRecurringBillingRunMock.mockReset();
    getInvoicedBillingCyclesPaginatedMock.mockReset();
    removeBillingCycleMock.mockReset();
    hardDeleteBillingCycleMock.mockReset();
    getAvailableRecurringDueWorkMock.mockReset();

    // Mock paginated invoiced cycles (empty)
    getInvoicedBillingCyclesPaginatedMock.mockResolvedValue({
      cycles: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0
    });
    // Mock paginated available billing periods with test data
    getAvailableRecurringDueWorkMock.mockResolvedValue({
      rows: createPeriods(),
      materializationGaps: [],
      total: 2,
      page: 1,
      pageSize: 10,
      totalPages: 1
    });
    generateInvoicesAsRecurringBillingRunMock.mockResolvedValue({
      runId: 'run-1',
      invoicesCreated: 0,
      failedCount: 0,
      failures: [],
    });
    getPurchaseOrderOverageForSelectionInputMock.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it('T007: batch invoicing does not prompt when no invoice can overrun PO limits', async () => {
    getPurchaseOrderOverageForSelectionInputMock.mockResolvedValue(null);

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    // Wait for data to load
    await waitFor(() => {
      expect(getAvailableRecurringDueWorkMock).toHaveBeenCalled();
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
      expect(getPurchaseOrderOverageForSelectionInputMock).toHaveBeenCalledTimes(2);
      expect(generateInvoicesAsRecurringBillingRunMock).toHaveBeenCalledTimes(1);
      expect(generateInvoicesAsRecurringBillingRunMock).toHaveBeenCalledWith({
        targets: [
          expect.objectContaining({
            selectorInput: expect.objectContaining({
              executionWindow: expect.objectContaining({
                periodKey: 'period:2025-01-01:2025-02-01:alpha',
              }),
            }),
          }),
          expect.objectContaining({
            selectorInput: expect.objectContaining({
              executionWindow: expect.objectContaining({
                periodKey: 'period:2025-01-01:2025-02-01:beta',
              }),
            }),
          }),
        ],
      });
    });

    expect(screen.queryByText('Purchase Order Limit Overages')).toBeNull();
  });

  it('T008: batch invoicing prompts upfront when overage possible and can skip overage invoices', async () => {
    getPurchaseOrderOverageForSelectionInputMock.mockImplementation(async (selectorInput: any) => {
      if (selectorInput.executionWindow?.periodKey === 'period:2025-01-01:2025-02-01:alpha') {
        return { overage_cents: 500, po_number: 'PO-1' };
      }
      return null;
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    // Wait for data to load
    await waitFor(() => {
      expect(getAvailableRecurringDueWorkMock).toHaveBeenCalled();
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
      expect(generateInvoicesAsRecurringBillingRunMock).toHaveBeenCalledTimes(1);
      expect(generateInvoicesAsRecurringBillingRunMock).toHaveBeenCalledWith({
        targets: [
          expect.objectContaining({
            selectorInput: expect.objectContaining({
              executionWindow: expect.objectContaining({
                periodKey: 'period:2025-01-01:2025-02-01:beta',
              }),
            }),
          }),
        ],
        allowPoOverage: false,
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Skipped due to PO overage/i)).toBeInTheDocument();
    });
  });

  it('T006: single invoice requires explicit override confirmation to proceed on overage', async () => {
    getPurchaseOrderOverageForSelectionInputMock.mockResolvedValue({ overage_cents: 2500, po_number: 'PO-OVR' });
    previewInvoiceForSelectionInputMock.mockResolvedValue({
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
      expect(getAvailableRecurringDueWorkMock).toHaveBeenCalled();
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
      expect(getPurchaseOrderOverageForSelectionInputMock).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /Proceed Anyway/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Proceed Anyway/i }));

    await waitFor(() => {
      expect(getPurchaseOrderOverageForSelectionInputMock).toHaveBeenCalledTimes(1);
    });

    const [selectorInput] = getPurchaseOrderOverageForSelectionInputMock.mock.calls[0] ?? [];
    expect(selectorInput?.executionWindow?.periodKey).toBe('period:2025-01-01:2025-02-01:alpha');

    await waitFor(() => {
      expect(generateInvoicesAsRecurringBillingRunMock).toHaveBeenCalledWith({
        targets: [
          expect.objectContaining({
            selectorInput: expect.objectContaining({
              executionWindow: expect.objectContaining({
                periodKey: 'period:2025-01-01:2025-02-01:alpha',
              }),
            }),
          }),
        ],
        allowPoOverage: true,
      });
    });
  });

  it('T036: batch PO-overage analysis resolves a contract-cadence row with no billing_cycle_id', async () => {
    const contractRow = createContractRow();
    getAvailableRecurringDueWorkMock.mockResolvedValue({
      rows: [contractRow],
      materializationGaps: [],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
    getPurchaseOrderOverageForSelectionInputMock.mockResolvedValue({
      overage_cents: 1200,
      po_number: 'PO-CONTRACT',
    } as any);

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Zenith Health')).toBeInTheDocument();
    });

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    const checkbox = within(readyTable).getAllByRole('checkbox')[0];
    fireEvent.click(checkbox!);
    fireEvent.click(
      screen.getByRole('button', { name: /Generate Invoices for Selected Periods \(1\)/i }),
    );

    await waitFor(() => {
      expect(getPurchaseOrderOverageForSelectionInputMock).toHaveBeenCalledWith(contractRow.selectorInput);
      expect(screen.getByText('Purchase Order Limit Overages')).toBeInTheDocument();
      expect(screen.getByText(/Zenith Health: over by/i)).toBeInTheDocument();
    });
  });

  it('T093: compatibility client-cadence PO-overage checks still run through selector-input identity without changing legacy batch behavior', async () => {
    const [clientRow] = createPeriods();
    getAvailableRecurringDueWorkMock.mockResolvedValue({
      rows: [clientRow],
      materializationGaps: [],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
    getPurchaseOrderOverageForSelectionInputMock.mockResolvedValue({
      overage_cents: 900,
      po_number: 'PO-LEGACY',
    } as any);

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Co')).toBeInTheDocument();
    });

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    fireEvent.click(within(readyTable).getAllByRole('checkbox')[0]!);
    fireEvent.click(
      screen.getByRole('button', { name: /Generate Invoices for Selected Periods \(1\)/i }),
    );

    await waitFor(() => {
      expect(getPurchaseOrderOverageForSelectionInputMock).toHaveBeenCalledWith(clientRow.selectorInput);
      expect(screen.getByText('Purchase Order Limit Overages')).toBeInTheDocument();
      expect(screen.getByText(/Alpha Co: over by/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Allow overages (generate all invoices)'));
    fireEvent.click(document.getElementById('po-overage-batch-decision-confirm')!);

    await waitFor(() => {
      expect(generateInvoicesAsRecurringBillingRunMock).toHaveBeenCalledWith({
        targets: [
          expect.objectContaining({
            selectorInput: expect.objectContaining({
              executionWindow: expect.objectContaining({
                periodKey: 'period:2025-01-01:2025-02-01:alpha',
              }),
            }),
          }),
        ],
        allowPoOverage: true,
      });
    });
  });

  it('T037/T038: selector-input preview generate supports contract-cadence rows, survives reopen, and submits recurring targets without a billing-cycle bridge', async () => {
    const contractRow = createContractRow();
    getAvailableRecurringDueWorkMock.mockResolvedValue({
      rows: [contractRow],
      materializationGaps: [],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
    getPurchaseOrderOverageForSelectionInputMock.mockResolvedValue({
      overage_cents: 2500,
      po_number: 'PO-CONTRACT',
    } as any);
    previewInvoiceForSelectionInputMock.mockResolvedValue({
      success: true,
      data: {
        invoiceNumber: 'INV-CONTRACT',
        issueDate: '2025-04-08',
        dueDate: '2025-05-08',
        currencyCode: 'USD',
        customer: { name: 'Zenith Health', address: '200 Support Way' },
        tenantClient: { name: 'Tenant', address: 'Tenant Address', logoUrl: null },
        items: [],
        subtotal: 0,
        tax: 0,
        total: 0,
      },
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Zenith Health')).toBeInTheDocument();
    });

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    const checkbox = within(readyTable).getAllByRole('checkbox')[0];
    fireEvent.click(checkbox!);
    fireEvent.click(screen.getByRole('button', { name: /Preview Selected/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Generate Invoice$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Close Preview/i }));
    fireEvent.click(screen.getByRole('button', { name: /Preview Selected/i }));

    await waitFor(() => {
      expect(previewInvoiceForSelectionInputMock).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getByRole('button', { name: /^Generate Invoice$/i }));

    await waitFor(() => {
      expect(getPurchaseOrderOverageForSelectionInputMock).toHaveBeenCalledWith(contractRow.selectorInput);
      expect(screen.getByRole('button', { name: /Proceed Anyway/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Proceed Anyway/i }));

    await waitFor(() => {
      expect(generateInvoicesAsRecurringBillingRunMock).toHaveBeenCalledWith({
        targets: [
          expect.objectContaining({
            selectorInput: contractRow.selectorInput,
            executionWindow: contractRow.executionWindow,
          }),
        ],
        allowPoOverage: true,
      });
    });

    const [generateCall] = generateInvoicesAsRecurringBillingRunMock.mock.calls;
    expect(generateCall?.[0]?.targets?.[0]?.billingCycleId).toBeUndefined();
  });
});
