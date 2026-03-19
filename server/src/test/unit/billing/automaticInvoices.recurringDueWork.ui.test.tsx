/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  buildClientScheduleDueWorkRow,
  buildServicePeriodRecurringDueWorkRow,
} from '@alga-psa/shared/billingClients/recurringDueWork';
import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';
import * as billingAndTaxActions from '@alga-psa/billing/actions/billingAndTax';
import * as billingCycleActions from '@alga-psa/billing/actions/billingCycleActions';
import * as invoiceGenerationActions from '@alga-psa/billing/actions/invoiceGeneration';
import * as recurringBillingRunActions from '@alga-psa/billing/actions/recurringBillingRunActions';

(globalThis as unknown as { React?: typeof React }).React = React;

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns, id, currentPage, onPageChange }: any) => {
    const getValue = (row: any, dataIndex: any) => {
      if (Array.isArray(dataIndex)) {
        return dataIndex.reduce((acc, key) => acc?.[key], row);
      }
      return row?.[dataIndex];
    };

    return (
      <div>
        <table data-testid={id || 'data-table'}>
          <tbody>
            {data.map((row: any, rowIndex: number) => (
              <tr key={row.rowKey ?? row.executionIdentityKey ?? row.invoiceId ?? row.billing_cycle_id ?? rowIndex}>
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
        {onPageChange ? (
          <button type="button" onClick={() => onPageChange((currentPage ?? 1) + 1)}>
            Next Page
          </button>
        ) : null}
      </div>
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
  ConfirmationDialog: ({ isOpen, title, message, onConfirm, onClose, id, confirmLabel = 'Confirm' }: any) => {
    if (!isOpen) return null;
    return (
      <div>
        <h2>{title}</h2>
        <div>{message}</div>
        <button id={`${id}-close`} onClick={onClose}>
          Close
        </button>
        <button id={`${id}-confirm`} onClick={() => onConfirm(undefined)}>
          {confirmLabel}
        </button>
      </div>
    );
  },
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, id }: any) => (
    <button id={id} onClick={onClick} type="button">
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <div />,
}));

const { default: AutomaticInvoices } = await import(
  '../../../../../packages/billing/src/components/billing-dashboard/AutomaticInvoices'
);

function createClientRow() {
  return buildClientScheduleDueWorkRow({
    clientId: 'client-1',
    clientName: 'Acme Co',
    billingCycleId: 'cycle-2025-03',
    servicePeriodStart: '2025-03-01',
    servicePeriodEnd: '2025-04-01',
    invoiceWindowStart: '2025-03-01',
    invoiceWindowEnd: '2025-04-01',
  });
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

function createInvoicedClientRow() {
  return {
    invoiceId: 'invoice-client-1',
    invoiceNumber: 'INV-1001',
    invoiceStatus: 'draft',
    invoiceDate: '2025-04-01',
    clientId: 'client-1',
    clientName: 'Acme Co',
    billingCycleId: 'cycle-2025-03',
    hasBillingCycleBridge: true,
    cadenceSource: 'client_schedule' as const,
    executionWindowKind: 'billing_cycle_window' as const,
    servicePeriodStart: '2025-03-01',
    servicePeriodEnd: '2025-04-01',
    servicePeriodLabel: '2025-03-01 to 2025-04-01',
    invoiceWindowStart: '2025-03-01',
    invoiceWindowEnd: '2025-04-01',
    invoiceWindowLabel: '2025-03-01 to 2025-04-01',
  };
}

function createInvoicedContractRow() {
  return {
    invoiceId: 'invoice-contract-1',
    invoiceNumber: 'INV-2001',
    invoiceStatus: 'draft',
    invoiceDate: '2025-05-08',
    clientId: 'client-9',
    clientName: 'Zenith Health',
    billingCycleId: null,
    hasBillingCycleBridge: false,
    cadenceSource: 'contract_anniversary' as const,
    executionWindowKind: 'contract_cadence_window' as const,
    servicePeriodStart: '2025-03-08',
    servicePeriodEnd: '2025-04-08',
    servicePeriodLabel: '2025-03-08 to 2025-04-08',
    invoiceWindowStart: '2025-04-08',
    invoiceWindowEnd: '2025-05-08',
    invoiceWindowLabel: '2025-04-08 to 2025-05-08',
  };
}

describe('AutomaticInvoices recurring due-work UI', () => {
  const getAvailableRecurringDueWorkMock = vi.spyOn(billingAndTaxActions, 'getAvailableRecurringDueWork');
  const getAvailableBillingPeriodsMock = vi.spyOn(billingAndTaxActions, 'getAvailableBillingPeriods');
  const getInvoicedBillingCyclesPaginatedMock = vi.spyOn(billingCycleActions, 'getInvoicedBillingCyclesPaginated');
  const previewInvoiceForSelectionInputMock = vi.spyOn(
    invoiceGenerationActions,
    'previewInvoiceForSelectionInput',
  );
  const getPurchaseOrderOverageForSelectionInputMock = vi.spyOn(
    invoiceGenerationActions,
    'getPurchaseOrderOverageForSelectionInput',
  );
  const generateInvoicesAsRecurringBillingRunMock = vi.spyOn(
    recurringBillingRunActions,
    'generateInvoicesAsRecurringBillingRun',
  );
  const reverseRecurringInvoiceMock = vi.spyOn(
    billingCycleActions,
    'reverseRecurringInvoice',
  );
  const hardDeleteRecurringInvoiceMock = vi.spyOn(
    billingCycleActions,
    'hardDeleteRecurringInvoice',
  );

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();

    getAvailableBillingPeriodsMock.mockResolvedValue({
      periods: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });
    previewInvoiceForSelectionInputMock.mockResolvedValue({
      success: true,
      data: {
        invoiceNumber: 'PREVIEW',
        issueDate: '2025-04-08',
        dueDate: '2025-04-15',
        currencyCode: 'USD',
        customer: { name: 'Acme Co', address: '100 Main St' },
        tenantClient: { name: 'Tenant', address: '500 Billing Ave', logoUrl: null },
        items: [],
        subtotal: 0,
        tax: 0,
        total: 0,
      },
    } as any);
    getPurchaseOrderOverageForSelectionInputMock.mockResolvedValue(null);
    getAvailableRecurringDueWorkMock.mockResolvedValue({
      rows: [createContractRow(), createClientRow()],
      materializationGaps: [],
      total: 2,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
    getInvoicedBillingCyclesPaginatedMock.mockResolvedValue({
      cycles: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });
    reverseRecurringInvoiceMock.mockResolvedValue();
    hardDeleteRecurringInvoiceMock.mockResolvedValue();
    generateInvoicesAsRecurringBillingRunMock.mockResolvedValue({
      runId: 'run-1',
      selectionKey: 'selection-1',
      retryKey: 'retry-1',
      invoicesCreated: 0,
      failedCount: 0,
      failures: [],
    });
  });

  it('T025: AutomaticInvoices loads ready rows from the due-work reader instead of getAvailableBillingPeriods', async () => {
    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(getAvailableRecurringDueWorkMock).toHaveBeenCalledWith({
        page: 1,
        pageSize: 10,
        searchTerm: '',
        dateRange: undefined,
      });
    });

    expect(getAvailableBillingPeriodsMock).not.toHaveBeenCalled();
    expect(screen.getByText('Zenith Health')).toBeInTheDocument();
  });

  it('T026/T029/T030/T039: AutomaticInvoices renders contract-cadence rows with cadence, service-period, invoice-window, contract context, and an unbridged badge', async () => {
    const contractRow = createContractRow();
    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Contract anniversary')).toBeInTheDocument();
    });

    expect(screen.getByText('2025-03-08 to 2025-04-08')).toBeInTheDocument();
    expect(screen.getByText('2025-04-08 to 2025-05-08')).toBeInTheDocument();
    expect(screen.getByText('Zenith Annual Support')).toBeInTheDocument();
    expect(screen.getByText('Managed Services')).toBeInTheDocument();
    expect(screen.getByText('No billing cycle bridge')).toBeInTheDocument();

    fireEvent.click(document.getElementById(`select-${contractRow.executionIdentityKey}`)!);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Preview Selected/i }),
      ).not.toBeDisabled();
      expect(
        screen.getByRole('button', { name: /Generate Invoices for Selected Periods \(1\)/i }),
      ).not.toBeDisabled();
    });
  });

  it('T040: AutomaticInvoices still renders compatibility client-cadence rows during the cutover', async () => {
    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Acme Co')).toBeInTheDocument();
    });

    expect(screen.getByText('Client schedule')).toBeInTheDocument();
    expect(screen.getAllByText('2025-03-01 to 2025-04-01').length).toBeGreaterThan(0);
  });

  it('T091: legacy billing-cycle compatibility rows still support the ready-table preview and batch-generate flow', async () => {
    const clientRow = createClientRow();
    getAvailableRecurringDueWorkMock.mockResolvedValue({
      rows: [clientRow],
      materializationGaps: [],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Acme Co')).toBeInTheDocument();
    });

    expect(screen.queryByText('No billing cycle bridge')).toBeNull();

    fireEvent.click(document.getElementById(`select-${clientRow.executionIdentityKey}`)!);
    fireEvent.click(screen.getByRole('button', { name: /Preview Selected/i }));

    await waitFor(() => {
      expect(previewInvoiceForSelectionInputMock).toHaveBeenCalledWith(clientRow.selectorInput);
      expect(screen.getByText('Client Details')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Close Preview/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /Generate Invoices for Selected Periods \(1\)/i }),
    );

    await waitFor(() => {
      expect(generateInvoicesAsRecurringBillingRunMock).toHaveBeenCalledWith({
        targets: [
          expect.objectContaining({
            selectorInput: clientRow.selectorInput,
            executionWindow: clientRow.executionWindow,
          }),
        ],
      });
    });
  });

  it('T032: AutomaticInvoices preview opens for a client-cadence row through the selector-input preview path', async () => {
    const clientRow = createClientRow();

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Acme Co')).toBeInTheDocument();
    });

    fireEvent.click(document.getElementById(`select-${clientRow.executionIdentityKey}`)!);
    fireEvent.click(screen.getByRole('button', { name: /Preview Selected/i }));

    await waitFor(() => {
      expect(previewInvoiceForSelectionInputMock).toHaveBeenCalledWith(clientRow.selectorInput);
      expect(screen.getByText('Client Details')).toBeInTheDocument();
    });
  });

  it('T033: AutomaticInvoices preview opens for a contract-cadence row through the selector-input preview path', async () => {
    const contractRow = createContractRow();
    previewInvoiceForSelectionInputMock.mockResolvedValueOnce({
      success: true,
      data: {
        invoiceNumber: 'PREVIEW',
        issueDate: '2025-05-08',
        dueDate: '2025-05-15',
        currencyCode: 'USD',
        customer: { name: 'Zenith Health', address: '200 Support Way' },
        tenantClient: { name: 'Tenant', address: '500 Billing Ave', logoUrl: null },
        items: [],
        subtotal: 0,
        tax: 0,
        total: 0,
      },
    } as any);

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Zenith Health')).toBeInTheDocument();
    });

    fireEvent.click(document.getElementById(`select-${contractRow.executionIdentityKey}`)!);
    fireEvent.click(screen.getByRole('button', { name: /Preview Selected/i }));

    await waitFor(() => {
      expect(previewInvoiceForSelectionInputMock).toHaveBeenCalledWith(contractRow.selectorInput);
      expect(screen.getByText('Client Details')).toBeInTheDocument();
    });
  });

  it('T034: AutomaticInvoices batch generate submits selector-input execution windows for unbridged contract-cadence rows', async () => {
    const contractRow = createContractRow();

    getAvailableRecurringDueWorkMock.mockResolvedValue({
      rows: [contractRow],
      materializationGaps: [],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Zenith Health')).toBeInTheDocument();
    });

    fireEvent.click(document.getElementById(`select-${contractRow.executionIdentityKey}`)!);
    fireEvent.click(
      screen.getByRole('button', { name: /Generate Invoices for Selected Periods \(1\)/i }),
    );

    await waitFor(() => {
      expect(generateInvoicesAsRecurringBillingRunMock).toHaveBeenCalledWith({
        targets: [
          expect.objectContaining({
            selectorInput: contractRow.selectorInput,
            executionWindow: contractRow.executionWindow,
          }),
        ],
      });
    });

    const [generateCall] = generateInvoicesAsRecurringBillingRunMock.mock.calls;
    expect(generateCall?.[0]?.targets?.[0]?.billingCycleId).toBeUndefined();
  });

  it('T027/T031/T035: mixed selection generates with execution-window targets and maps failures back to unbridged contract rows', async () => {
    const contractRow = createContractRow();
    const clientRow = createClientRow();

    getAvailableRecurringDueWorkMock.mockResolvedValue({
      rows: [contractRow, clientRow],
      materializationGaps: [],
      total: 2,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
    generateInvoicesAsRecurringBillingRunMock.mockResolvedValue({
      runId: 'run-2',
      selectionKey: 'selection-2',
      retryKey: 'retry-2',
      invoicesCreated: 1,
      failedCount: 1,
      failures: [
        {
          billingCycleId: null,
          executionIdentityKey: contractRow.executionIdentityKey,
          executionWindowKind: 'contract_cadence_window',
          errorMessage: 'Contract cadence failure',
        },
      ],
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Zenith Health')).toBeInTheDocument();
    });

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    const checkboxes = within(readyTable).getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);

    fireEvent.click(
      screen.getByRole('button', { name: /Generate Invoices for Selected Periods \(2\)/i }),
    );

    await waitFor(() => {
      expect(generateInvoicesAsRecurringBillingRunMock).toHaveBeenCalledWith({
        targets: [
          expect.objectContaining({
            executionWindow: contractRow.executionWindow,
            selectorInput: contractRow.selectorInput,
          }),
          expect.objectContaining({
            selectorInput: clientRow.selectorInput,
            executionWindow: clientRow.executionWindow,
          }),
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Zenith Health:/i)).toBeInTheDocument();
      expect(screen.getByText(/Contract cadence failure/i)).toBeInTheDocument();
    });
  });

  it('T083: recurring generation errors for unbridged rows display execution identity when client-name keys are unavailable', async () => {
    const contractRow = {
      ...createContractRow(),
      clientName: '',
    };

    getAvailableRecurringDueWorkMock.mockResolvedValue({
      rows: [contractRow],
      materializationGaps: [],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
    generateInvoicesAsRecurringBillingRunMock.mockResolvedValue({
      runId: 'run-identity-fallback',
      selectionKey: 'selection-identity-fallback',
      retryKey: 'retry-identity-fallback',
      invoicesCreated: 0,
      failedCount: 1,
      failures: [
        {
          billingCycleId: null,
          executionIdentityKey: contractRow.executionIdentityKey,
          executionWindowKind: 'contract_cadence_window',
          errorMessage: 'Execution-window keyed failure',
        },
      ],
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Contract anniversary')).toBeInTheDocument();
    });

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    fireEvent.click(within(readyTable).getAllByRole('checkbox')[0]!);
    fireEvent.click(
      screen.getByRole('button', { name: /Generate Invoices for Selected Periods \(1\)/i }),
    );

    await waitFor(() => {
      expect(screen.getAllByText(new RegExp(contractRow.executionIdentityKey, 'i')).length).toBeGreaterThan(0);
      expect(screen.getByText(/Execution-window keyed failure/i)).toBeInTheDocument();
    });
  });

  it('T028: pagination changes clear execution-window-based selection state before the next page loads', async () => {
    getAvailableRecurringDueWorkMock
      .mockResolvedValueOnce({
        rows: [createClientRow()],
        materializationGaps: [],
        total: 2,
        page: 1,
        pageSize: 10,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        rows: [createContractRow()],
        materializationGaps: [],
        total: 2,
        page: 2,
        pageSize: 10,
        totalPages: 2,
      });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Acme Co')).toBeInTheDocument();
    });

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    const checkboxes = within(readyTable).getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Generate Invoices for Selected Periods \(1\)/i }),
      ).not.toBeDisabled();
    });

    fireEvent.click(screen.getAllByRole('button', { name: /Next Page/i })[0]!);

    await waitFor(() => {
      expect(getAvailableRecurringDueWorkMock).toHaveBeenLastCalledWith({
        page: 2,
        pageSize: 10,
        searchTerm: '',
        dateRange: undefined,
      });
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Generate Invoices for Selected Periods \(0\)/i }),
      ).toBeDisabled();
    });
  });

  it('T053/T058: invoiced recurring history renders a contract-cadence row without a billing_cycle_id and shows service-period-backed reverse copy', async () => {
    getInvoicedBillingCyclesPaginatedMock.mockResolvedValue({
      cycles: [createInvoicedContractRow()],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('INV-2001')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Contract anniversary').length).toBeGreaterThan(0);
    expect(screen.getByText('Service-period-backed')).toBeInTheDocument();
    expect(screen.getAllByText('2025-03-08 to 2025-04-08').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2025-04-08 to 2025-05-08').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: /open menu/i }).at(-1)!);
    fireEvent.click(screen.getByText('Reverse Invoice'));

    await waitFor(() => {
      expect(screen.getByText(/without requiring a client billing cycle row/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Yes, Reverse Invoice/i }));

    await waitFor(() => {
      expect(reverseRecurringInvoiceMock).toHaveBeenCalledWith({
        invoiceId: 'invoice-contract-1',
        billingCycleId: null,
      });
    });
  });

  it('renders a bridged client-cadence history row and deletes it through the billing-cycle-compatible wrapper', async () => {
    getInvoicedBillingCyclesPaginatedMock.mockResolvedValue({
      cycles: [createInvoicedClientRow()],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('INV-1001')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: /open menu/i }).at(-1)!);
    fireEvent.click(screen.getByText('Delete Invoice'));

    await waitFor(() => {
      expect(screen.getByText(/linked billing cycle will also be deleted/i)).toBeInTheDocument();
    });

    fireEvent.click(document.getElementById('delete-recurring-invoice-confirmation-confirm')!);

    await waitFor(() => {
      expect(hardDeleteRecurringInvoiceMock).toHaveBeenCalledWith({
        invoiceId: 'invoice-client-1',
        billingCycleId: 'cycle-2025-03',
      });
    });
  });
});
