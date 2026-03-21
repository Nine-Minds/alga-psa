/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

let mockDueWorkResponse: any;
let mockRecurringInvoiceHistoryResponse: any;
const mockPreviewGroupedInvoicesForSelectionInputs = vi.fn(async (groups: Array<{ previewGroupKey: string; selectorInputs: any[] }>) => ({
  success: true,
  invoiceCount: groups.length,
  previews: groups.map((group) => ({
    previewGroupKey: group.previewGroupKey,
    selectorInputs: group.selectorInputs,
    data: {
      invoiceNumber: 'PREVIEW',
      issueDate: '2026-03-01',
      dueDate: '2026-03-31',
      customer: { name: 'Acme Co', address: '123 Main St' },
      items: [],
      subtotal: 0,
      tax: 0,
      total: 0,
    },
  })),
}));
const mockGenerateGroupedInvoicesAsRecurringBillingRun = vi.fn(async () => ({ failures: [] }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('@alga-psa/billing/actions/billingAndTax', () => ({
  getAvailableRecurringDueWork: vi.fn(async () => mockDueWorkResponse),
}));

vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({
  getPurchaseOrderOverageForSelectionInput: vi.fn(async () => ({ overage_cents: 0, po_number: null })),
  previewGroupedInvoicesForSelectionInputs: mockPreviewGroupedInvoicesForSelectionInputs,
}));

vi.mock('@alga-psa/billing/actions/recurringBillingRunActions', () => ({
  generateInvoicesAsRecurringBillingRun: vi.fn(async () => ({ failures: [] })),
  generateGroupedInvoicesAsRecurringBillingRun: mockGenerateGroupedInvoicesAsRecurringBillingRun,
}));

vi.mock('@alga-psa/billing/actions/billingCycleActions', () => ({
  getRecurringInvoiceHistoryPaginated: vi.fn(async () => mockRecurringInvoiceHistoryResponse),
  reverseRecurringInvoice: vi.fn(async () => undefined),
  hardDeleteRecurringInvoice: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({
    id,
    data,
    columns = [],
  }: {
    id: string;
    data: any[];
    columns?: Array<{ dataIndex?: string; render?: (value: unknown, row: any, index: number) => React.ReactNode }>;
  }) => (
    <div data-testid={id}>
      <div data-testid={`${id}-header`}>
        {columns.map((column, columnIndex) => (
          <div key={`header-${columnIndex}`}>{(column as any).title ?? null}</div>
        ))}
      </div>
      <div data-testid={`${id}-row-count`}>{data.length}</div>
      {data.map((row, index) => (
        <div
          key={row.parentSummary?.candidateKey ?? row.candidateKey ?? row.invoiceId}
          data-testid={`${id}-row`}
        >
          {columns.map((column, columnIndex) => {
            const value = column.dataIndex ? row[column.dataIndex] : undefined;
            return (
              <div key={`${row.parentSummary?.candidateKey ?? row.candidateKey ?? row.invoiceId}-${columnIndex}`}>
                {column.render ? column.render(value, row, index) : String(value ?? '')}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ containerClassName: _containerClassName, ...props }: any) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ indeterminate: _indeterminate, ...props }: any) => (
    <input
      type="checkbox"
      data-indeterminate={_indeterminate ? 'true' : 'false'}
      {...props}
    />
  ),
}));
vi.mock('@alga-psa/ui/components/DateRangePicker', () => ({
  DateRangePicker: () => <div data-testid="date-range-picker" />,
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));
vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({
  default: ({ text }: { text: string }) => <div>{text}</div>,
}));

describe('AutomaticInvoices grouped parent rows', () => {
  beforeEach(() => {
    mockPreviewGroupedInvoicesForSelectionInputs.mockClear();
    mockGenerateGroupedInvoicesAsRecurringBillingRun.mockClear();
    mockDueWorkResponse = {
      invoiceCandidates: [
        {
          candidateKey: 'invoice-candidate:client-1:2026-03-01:2026-04-01',
          clientId: 'client-1',
          clientName: 'Acme Co',
          windowStart: '2026-03-01',
          windowEnd: '2026-04-01',
          windowLabel: '2026-03-01 to 2026-04-01',
          servicePeriodStart: '2026-03-01',
          servicePeriodEnd: '2026-04-01',
          servicePeriodLabel: '2026-03-01 to 2026-04-01',
          cadenceOwners: ['contract'],
          cadenceSources: ['contract_anniversary'],
          contractId: 'contract-1',
          contractName: 'Main Contract',
          splitReasons: [],
          memberCount: 2,
          canGenerate: true,
          blockedReason: null,
          members: [
            {
              executionIdentityKey: 'exec-1',
              canGenerate: true,
              billingCycleId: 'bc-1',
              clientId: 'client-1',
              purchaseOrderScopeKey: 'po-1',
              currencyCode: 'USD',
              taxSource: 'exclusive',
              exportShapeKey: 'shape-a',
              cadenceSource: 'contract_anniversary',
              servicePeriodLabel: '2026-03-01 to 2026-04-01',
              executionWindow: { duePosition: 'advance' },
              amountCents: 12500,
              selectorInput: {
                clientId: 'client-1',
                windowStart: '2026-03-01',
                windowEnd: '2026-04-01',
                executionWindow: {
                  kind: 'contract_cadence_window',
                  identityKey: 'contract-window:line-1:2026-03-01:2026-04-01',
                  cadenceOwner: 'contract',
                  contractId: 'contract-1',
                  contractLineId: 'line-1',
                },
              },
            },
            {
              executionIdentityKey: 'exec-2',
              canGenerate: true,
              billingCycleId: 'bc-2',
              clientId: 'client-1',
              purchaseOrderScopeKey: 'po-1',
              currencyCode: 'USD',
              taxSource: 'exclusive',
              exportShapeKey: 'shape-a',
              cadenceSource: 'contract_anniversary',
              servicePeriodLabel: '2026-03-01 to 2026-04-01',
              executionWindow: { duePosition: 'advance' },
              amountCents: 17500,
              selectorInput: {
                clientId: 'client-1',
                windowStart: '2026-03-01',
                windowEnd: '2026-04-01',
                executionWindow: {
                  kind: 'contract_cadence_window',
                  identityKey: 'contract-window:line-2:2026-03-01:2026-04-01',
                  cadenceOwner: 'contract',
                  contractId: 'contract-1',
                  contractLineId: 'line-2',
                },
              },
            },
          ],
        },
      ],
      materializationGaps: [],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    };
    mockRecurringInvoiceHistoryResponse = { rows: [], total: 0, page: 1, pageSize: 10 };
  });

  it('renders one parent group row for a shared client + invoice window instead of one top-level row per child (T001)', async () => {
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;

    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByTestId('automatic-invoices-table-row-count')).toHaveTextContent('1');
    });

    expect(screen.getByText('Each parent row groups due obligations by client and invoice window. Child obligations remain the atomic execution units.')).toBeInTheDocument();
    expect(screen.getByTestId('automatic-invoices-table')).toBeInTheDocument();
    expect(screen.getAllByTestId('automatic-invoices-table-row')).toHaveLength(1);
  });

  it('renders parent summary child count, aggregate amount, and invoice window (T002)', async () => {
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;

    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByText('2 obligations')).toBeInTheDocument();
    });

    expect(screen.getAllByText('2026-03-01 to 2026-04-01').length).toBeGreaterThan(0);
    expect(screen.getByText('$300.00')).toBeInTheDocument();
  });

  it('expands a parent row to reveal child candidate details (T003)', async () => {
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;

    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    const expandButton = await screen.findByRole('button', { name: 'Expand' });
    fireEvent.click(expandButton);

    expect(
      await screen.findByTestId('child-row-parent-group:client-1:2026-03-01:2026-04-01-exec-1'),
    ).toBeInTheDocument();
    expect(screen.getByText('Execution exec-1')).toBeInTheDocument();
    expect(screen.getAllByText('Cadence: Contract anniversary').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Service period: 2026-03-01 to 2026-04-01').length).toBeGreaterThan(0);
    expect(screen.getByText('Amount: $125.00')).toBeInTheDocument();
  });

  it('is combinable only when all ready children share client/currency/PO/tax/export scope (T004)', async () => {
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;

    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    await waitFor(() => {
      const checkbox = document.getElementById(
        'select-parent-group:client-1:2026-03-01:2026-04-01',
      ) as HTMLInputElement | null;
      expect(checkbox).not.toBeNull();
      expect(checkbox?.disabled).toBe(false);
    });

    expect(
      screen.queryByTestId('combinability-reasons-parent-group:client-1:2026-03-01:2026-04-01'),
    ).not.toBeInTheDocument();
  });

  it('shows PO incompatibility reason when child PO scope differs (T005)', async () => {
    mockDueWorkResponse.invoiceCandidates[0].members[1].purchaseOrderScopeKey = 'po-2';
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;

    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    await waitFor(() => {
      const checkbox = document.getElementById(
        'select-parent-group:client-1:2026-03-01:2026-04-01',
      ) as HTMLInputElement | null;
      expect(checkbox).not.toBeNull();
      expect(checkbox?.disabled).toBe(true);
    });

    expect(
      screen.getByTestId('combinability-reasons-parent-group:client-1:2026-03-01:2026-04-01'),
    ).toHaveTextContent('PO scope differs');
  });

  it('shows currency incompatibility reason when child currency differs (T006)', async () => {
    mockDueWorkResponse.invoiceCandidates[0].members[1].currencyCode = 'EUR';
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;

    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    await waitFor(() => {
      const checkbox = document.getElementById(
        'select-parent-group:client-1:2026-03-01:2026-04-01',
      ) as HTMLInputElement | null;
      expect(checkbox).not.toBeNull();
      expect(checkbox?.disabled).toBe(true);
    });

    expect(
      screen.getByTestId('combinability-reasons-parent-group:client-1:2026-03-01:2026-04-01'),
    ).toHaveTextContent('Currency differs');
  });

  it('shows tax incompatibility reason when child tax source differs (T007)', async () => {
    mockDueWorkResponse.invoiceCandidates[0].members[1].taxSource = 'inclusive';
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;

    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    await waitFor(() => {
      const checkbox = document.getElementById(
        'select-parent-group:client-1:2026-03-01:2026-04-01',
      ) as HTMLInputElement | null;
      expect(checkbox).not.toBeNull();
      expect(checkbox?.disabled).toBe(true);
    });

    expect(
      screen.getByTestId('combinability-reasons-parent-group:client-1:2026-03-01:2026-04-01'),
    ).toHaveTextContent('Tax treatment differs');
  });

  it('shows export-shape incompatibility reason when child export shape differs (T008)', async () => {
    mockDueWorkResponse.invoiceCandidates[0].members[1].exportShapeKey = 'shape-b';
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;

    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    await waitFor(() => {
      const checkbox = document.getElementById(
        'select-parent-group:client-1:2026-03-01:2026-04-01',
      ) as HTMLInputElement | null;
      expect(checkbox).not.toBeNull();
      expect(checkbox?.disabled).toBe(true);
    });

    expect(
      screen.getByTestId('combinability-reasons-parent-group:client-1:2026-03-01:2026-04-01'),
    ).toHaveTextContent('Export shape differs');
  });

  it('selecting a combinable parent selects the full group target (T009)', async () => {
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    const parentCheckbox = await waitFor(() => {
      const checkbox = document.getElementById(
        'select-parent-group:client-1:2026-03-01:2026-04-01',
      ) as HTMLInputElement | null;
      expect(checkbox).not.toBeNull();
      return checkbox as HTMLInputElement;
    });
    fireEvent.click(parentCheckbox);

    expect(parentCheckbox.checked).toBe(true);
    expect(screen.getByText('Generate Invoices for Selected Periods (2)')).toBeInTheDocument();
  });

  it('non-combinable parent stays disabled while child rows remain selectable (T010)', async () => {
    mockDueWorkResponse.invoiceCandidates[0].members[1].currencyCode = 'EUR';
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    const expandButton = await screen.findByRole('button', { name: 'Expand' });
    fireEvent.click(expandButton);

    const parentCheckbox = document.getElementById(
      'select-parent-group:client-1:2026-03-01:2026-04-01',
    ) as HTMLInputElement;
    const childCheckbox = document.getElementById(
      'select-child-parent-group:client-1:2026-03-01:2026-04-01-exec-1',
    ) as HTMLInputElement;

    expect(parentCheckbox.disabled).toBe(true);
    expect(childCheckbox.disabled).toBe(false);
  });

  it('partial child selection drives parent indeterminate state (T011)', async () => {
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    const expandButton = await screen.findByRole('button', { name: 'Expand' });
    fireEvent.click(expandButton);

    const childCheckbox = document.getElementById(
      'select-child-parent-group:client-1:2026-03-01:2026-04-01-exec-1',
    ) as HTMLInputElement;
    fireEvent.click(childCheckbox);

    const parentCheckbox = document.getElementById(
      'select-parent-group:client-1:2026-03-01:2026-04-01',
    ) as HTMLInputElement;
    expect(parentCheckbox.checked).toBe(false);
    expect(parentCheckbox.dataset.indeterminate).toBe('true');
  });

  it('select all selects combinable groups by parent row (T012)', async () => {
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    const [selectAll] = await screen.findAllByRole('checkbox');
    fireEvent.click(selectAll);

    const parentCheckbox = document.getElementById(
      'select-parent-group:client-1:2026-03-01:2026-04-01',
    ) as HTMLInputElement;
    expect(parentCheckbox.checked).toBe(true);
  });

  it('select all selects child rows for non-combinable groups (T013)', async () => {
    mockDueWorkResponse.invoiceCandidates[0].members[1].taxSource = 'inclusive';
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    const [selectAll] = await screen.findAllByRole('checkbox');
    fireEvent.click(selectAll);

    const expandButton = await screen.findByRole('button', { name: 'Expand' });
    fireEvent.click(expandButton);

    const parentCheckbox = document.getElementById(
      'select-parent-group:client-1:2026-03-01:2026-04-01',
    ) as HTMLInputElement;
    const childOne = document.getElementById(
      'select-child-parent-group:client-1:2026-03-01:2026-04-01-exec-1',
    ) as HTMLInputElement;
    const childTwo = document.getElementById(
      'select-child-parent-group:client-1:2026-03-01:2026-04-01-exec-2',
    ) as HTMLInputElement;

    expect(parentCheckbox.checked).toBe(false);
    expect(childOne.checked).toBe(true);
    expect(childTwo.checked).toBe(true);
  });

  it('keeps blocked children visible but unselectable via child selection and select all (T014)', async () => {
    mockDueWorkResponse.invoiceCandidates[0].canGenerate = false;
    mockDueWorkResponse.invoiceCandidates[0].members[1].canGenerate = false;
    mockDueWorkResponse.invoiceCandidates[0].members[1].currencyCode = 'EUR';
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    const [selectAll] = await screen.findAllByRole('checkbox');
    fireEvent.click(selectAll);

    const expandButton = await screen.findByRole('button', { name: 'Expand' });
    fireEvent.click(expandButton);

    const blockedChild = document.getElementById(
      'select-child-parent-group:client-1:2026-03-01:2026-04-01-exec-2',
    ) as HTMLInputElement;
    const readyChild = document.getElementById(
      'select-child-parent-group:client-1:2026-03-01:2026-04-01-exec-1',
    ) as HTMLInputElement;

    expect(
      screen.getByTestId('child-row-parent-group:client-1:2026-03-01:2026-04-01-exec-2'),
    ).toBeInTheDocument();
    expect(blockedChild.disabled).toBe(true);
    expect(blockedChild.checked).toBe(false);
    expect(readyChild.checked).toBe(true);
  });

  it('previewing a selected combinable parent renders one combined invoice preview count (T015)', async () => {
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    const parentCheckbox = await waitFor(() => {
      const checkbox = document.getElementById(
        'select-parent-group:client-1:2026-03-01:2026-04-01',
      ) as HTMLInputElement | null;
      expect(checkbox).not.toBeNull();
      return checkbox as HTMLInputElement;
    });
    fireEvent.click(parentCheckbox);

    fireEvent.click(screen.getByRole('button', { name: 'Preview Selected' }));

    await waitFor(() => {
      expect(screen.getByTestId('preview-invoice-count-summary')).toHaveTextContent(
        'This selection will generate 1 invoice.',
      );
    });
    expect(mockPreviewGroupedInvoicesForSelectionInputs).toHaveBeenCalledTimes(1);
    const previewPayload = mockPreviewGroupedInvoicesForSelectionInputs.mock.calls[0][0];
    expect(previewPayload).toHaveLength(1);
    expect(previewPayload[0].selectorInputs).toHaveLength(2);
  });

  it('previewing mixed child selection renders multi-invoice preview count (T016)', async () => {
    mockDueWorkResponse.invoiceCandidates[0].members[1].currencyCode = 'EUR';
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    const expandButton = await screen.findByRole('button', { name: 'Expand' });
    fireEvent.click(expandButton);

    const childOne = document.getElementById(
      'select-child-parent-group:client-1:2026-03-01:2026-04-01-exec-1',
    ) as HTMLInputElement;
    const childTwo = document.getElementById(
      'select-child-parent-group:client-1:2026-03-01:2026-04-01-exec-2',
    ) as HTMLInputElement;
    fireEvent.click(childOne);
    fireEvent.click(childTwo);
    fireEvent.click(screen.getByRole('button', { name: 'Preview Selected' }));

    await waitFor(() => {
      expect(screen.getByTestId('preview-invoice-count-summary')).toHaveTextContent(
        'This selection will generate 2 invoices.',
      );
    });
  });

  it('preview request uses exact selected child scope without unselected siblings (T017)', async () => {
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    const expandButton = await screen.findByRole('button', { name: 'Expand' });
    fireEvent.click(expandButton);

    const childOne = document.getElementById(
      'select-child-parent-group:client-1:2026-03-01:2026-04-01-exec-1',
    ) as HTMLInputElement;
    fireEvent.click(childOne);
    fireEvent.click(screen.getByRole('button', { name: 'Preview Selected' }));

    await waitFor(() => {
      expect(mockPreviewGroupedInvoicesForSelectionInputs).toHaveBeenCalledTimes(1);
    });
    const previewPayload = mockPreviewGroupedInvoicesForSelectionInputs.mock.calls[0][0];
    expect(previewPayload).toHaveLength(1);
    expect(previewPayload[0].selectorInputs).toHaveLength(1);
    expect(previewPayload[0].selectorInputs[0].executionWindow.contractLineId).toBe('line-1');
  });

  it('generation payload does not re-expand into unselected siblings from the same group (T020)', async () => {
    mockDueWorkResponse.invoiceCandidates[0].members.push({
      executionIdentityKey: 'exec-3',
      canGenerate: true,
      billingCycleId: 'bc-3',
      clientId: 'client-1',
      purchaseOrderScopeKey: 'po-1',
      currencyCode: 'USD',
      taxSource: 'exclusive',
      exportShapeKey: 'shape-a',
      cadenceSource: 'contract_anniversary',
      servicePeriodLabel: '2026-03-01 to 2026-04-01',
      executionWindow: { duePosition: 'advance' },
      amountCents: 5000,
      selectorInput: {
        clientId: 'client-1',
        windowStart: '2026-03-01',
        windowEnd: '2026-04-01',
        executionWindow: {
          kind: 'contract_cadence_window',
          identityKey: 'contract-window:line-3:2026-03-01:2026-04-01',
          cadenceOwner: 'contract',
          contractId: 'contract-1',
          contractLineId: 'line-3',
        },
      },
    });
    mockDueWorkResponse.invoiceCandidates[0].memberCount = 3;

    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    const expandButton = await screen.findByRole('button', { name: 'Expand' });
    fireEvent.click(expandButton);

    const childOne = document.getElementById(
      'select-child-parent-group:client-1:2026-03-01:2026-04-01-exec-1',
    ) as HTMLInputElement;
    fireEvent.click(childOne);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Invoices for Selected Periods (1)' }));

    await waitFor(() => {
      expect(mockGenerateGroupedInvoicesAsRecurringBillingRun).toHaveBeenCalledTimes(1);
    });
    const generationPayload = mockGenerateGroupedInvoicesAsRecurringBillingRun.mock.calls[0][0];
    expect(generationPayload.groupedTargets).toHaveLength(1);
    expect(generationPayload.groupedTargets[0].selectorInputs).toHaveLength(1);
    expect(generationPayload.groupedTargets[0].selectorInputs[0].executionWindow.contractLineId).toBe('line-1');
  });

  it('keeps parent non-combinable when PO scope differs across child candidates (T026)', async () => {
    mockDueWorkResponse.invoiceCandidates[0].members[1].purchaseOrderScopeKey = 'po-2';
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    await waitFor(() => {
      const parentCheckbox = document.getElementById(
        'select-parent-group:client-1:2026-03-01:2026-04-01',
      ) as HTMLInputElement | null;
      expect(parentCheckbox).not.toBeNull();
      expect(parentCheckbox?.disabled).toBe(true);
    });
    expect(
      screen.getByTestId('combinability-reasons-parent-group:client-1:2026-03-01:2026-04-01'),
    ).toHaveTextContent('PO scope differs');
  });

  it('legacy single-assignment/single-child groups still generate through the existing flow (T028/T029)', async () => {
    mockDueWorkResponse.invoiceCandidates[0].members = [mockDueWorkResponse.invoiceCandidates[0].members[0]];
    mockDueWorkResponse.invoiceCandidates[0].memberCount = 1;
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    const parentCheckbox = await waitFor(() => {
      const checkbox = document.getElementById(
        'select-parent-group:client-1:2026-03-01:2026-04-01',
      ) as HTMLInputElement | null;
      expect(checkbox).not.toBeNull();
      return checkbox as HTMLInputElement;
    });
    fireEvent.click(parentCheckbox);

    fireEvent.click(screen.getByRole('button', { name: 'Preview Selected' }));
    await waitFor(() => {
      expect(screen.getByTestId('preview-invoice-count-summary')).toHaveTextContent(
        'This selection will generate 1 invoice.',
      );
    });
    expect(screen.queryByTestId('grouped-preview-unavailable-copy')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Generate Invoices for Selected Periods (1)' }));
    await waitFor(() => {
      expect(mockGenerateGroupedInvoicesAsRecurringBillingRun).toHaveBeenCalledTimes(1);
    });
    const payload = mockGenerateGroupedInvoicesAsRecurringBillingRun.mock.calls[0][0];
    expect(payload.groupedTargets).toHaveLength(1);
    expect(payload.groupedTargets[0].selectorInputs).toHaveLength(1);
  });

  it('renders recurring history assignment scope summary and multi-contract badge for combined invoices (T024/T025)', async () => {
    mockRecurringInvoiceHistoryResponse = {
      rows: [
        {
          invoiceId: 'invoice-1',
          invoiceNumber: 'INV-1001',
          invoiceStatus: 'draft',
          invoiceDate: '2026-03-08',
          billingCycleId: null,
          hasBillingCycleBridge: false,
          clientId: 'client-1',
          clientName: 'Acme Co',
          cadenceSource: 'contract_anniversary',
          servicePeriodStart: '2026-03-01',
          servicePeriodEnd: '2026-04-01',
          servicePeriodLabel: '2026-03-01 to 2026-04-01',
          invoiceWindowStart: '2026-03-01',
          invoiceWindowEnd: '2026-04-01',
          invoiceWindowLabel: '2026-03-01 to 2026-04-01',
          assignmentContractIds: ['assignment-1', 'assignment-2'],
          isMultiAssignment: true,
          assignmentSummary: 'Multi-assignment invoice (2)',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
    };
    const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByTestId('already-invoiced-table-row-count')).toHaveTextContent('1');
    });
    expect(screen.getByText('Multi-assignment invoice (2)')).toBeInTheDocument();
    expect(screen.getByText('Multi-contract invoice')).toBeInTheDocument();
  });
});
