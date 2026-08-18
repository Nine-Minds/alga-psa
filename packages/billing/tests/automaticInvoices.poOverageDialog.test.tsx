/**
 * @vitest-environment jsdom
 *
 * Regression tests for the PO overage confirmation dialog on the Generate screen:
 * - Defect A: getPurchaseOrderOverageForSelectionInput RETURNS (does not throw) an
 *   InvoiceGenerationActionError for expected failures. The error object is truthy and
 *   `undefined <= 0` is false, so it used to flow into the dialog and render "$NaN".
 * - Defect B: overage_cents is CENTS but was formatted with the major-unit
 *   formatCurrency, overstating the overage 100x ($612.50 rendered as "$61,250.00").
 */
import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

let mockDueWorkResponse: any;
let mockRecurringInvoiceHistoryResponse: any;
const mockGetAvailableRecurringDueWork = vi.fn();
const mockGetPurchaseOrderOverageForSelectionInput = vi.fn();
const mockPreviewGroupedInvoicesForSelectionInputs = vi.fn();
const mockGenerateGroupedInvoicesAsRecurringBillingRun = vi.fn(async () => ({ failures: [] }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string } & Record<string, unknown>) =>
      (opts && typeof opts.defaultValue === 'string' ? opts.defaultValue : key),
  }),
  useFormatters: () => ({
    formatDate: (value: unknown) => String(value),
    formatCurrency: (value: number) => `$${value}`,
  }),
}));

vi.mock('@alga-psa/billing/actions/billingAndTax', () => ({
  getAvailableRecurringDueWork: mockGetAvailableRecurringDueWork,
}));

vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({
  getPurchaseOrderOverageForSelectionInput: mockGetPurchaseOrderOverageForSelectionInput,
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
      <div data-testid={`${id}-row-count`}>{data.length}</div>
      {data.map((row, index) => {
        const rowKey = row.rowId ?? row.parentSummary?.candidateKey ?? row.candidateKey ?? row.invoiceId ?? `row-${index}`;
        return (
          <div key={rowKey} data-testid={`${id}-row`}>
            {columns.map((column, columnIndex) => {
              const value = column.dataIndex ? row[column.dataIndex] : undefined;
              return (
                <div key={`${rowKey}-${columnIndex}`}>
                  {column.render ? column.render(value, row, index) : String(value ?? '')}
                </div>
              );
            })}
          </div>
        );
      })}
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
  // The component drives parent-row selection through onClick (for shift-range
  // support) and calls event.preventDefault(). On a native jsdom checkbox that
  // cancels the click activation and reverts `.checked`, so we hand the
  // component a no-op preventDefault instead.
  Checkbox: ({ indeterminate: _indeterminate, onClick, ...props }: any) => (
    <input
      type="checkbox"
      data-indeterminate={_indeterminate ? 'true' : 'false'}
      {...props}
      onClick={
        onClick
          ? (event: any) => {
            onClick({
              shiftKey: event.shiftKey,
              metaKey: event.metaKey,
              ctrlKey: event.ctrlKey,
              stopPropagation: () => event.stopPropagation(),
              preventDefault: () => {},
            });
          }
          : undefined
      }
    />
  ),
}));
vi.mock('@alga-psa/ui/components/DateRangePicker', () => ({
  DateRangePicker: () => <div data-testid="date-range-picker" />,
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ variant: _variant, ...props }: any) => <div {...props}>{props.children}</div>,
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
// Render dialog content so the overage message copy is assertable.
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ id, isOpen, title, message }: any) =>
    isOpen
      ? (
        <div data-testid={id}>
          <div>{title}</div>
          <div>{message}</div>
        </div>
      )
      : null,
}));
vi.mock('@alga-psa/ui/components/Popover', () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ checked, onCheckedChange, size: _size, ...props }: any) => (
    <input
      type="checkbox"
      role="switch"
      checked={Boolean(checked)}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
}));
vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({
  default: ({ text }: { text: string }) => <div>{text}</div>,
}));

function buildMember(index: number) {
  const line = `line-${index}`;
  return {
    executionIdentityKey: `exec-${index}`,
    canGenerate: true,
    billingCycleId: `bc-${index}`,
    clientId: 'client-1',
    purchaseOrderScopeKey: 'po-1',
    currencyCode: 'USD',
    taxSource: 'exclusive',
    exportShapeKey: 'shape-a',
    cadenceSource: 'contract_anniversary',
    duePosition: 'advance',
    servicePeriodLabel: '2026-03-01 to 2026-04-01',
    amountCents: 12500,
    selectorInput: {
      clientId: 'client-1',
      windowStart: '2026-03-01',
      windowEnd: '2026-04-01',
      executionWindow: {
        kind: 'contract_cadence_window',
        identityKey: `contract-window:${line}:2026-03-01:2026-04-01`,
        cadenceOwner: 'contract',
        contractId: 'contract-1',
        contractLineId: line,
      },
    },
  };
}

async function selectParentAndClickGenerate() {
  const AutomaticInvoices = (await import('../src/components/billing-dashboard/AutomaticInvoices')).default;
  render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

  const parentCheckbox = await waitFor(() => {
    const checkbox = document.getElementById(
      'select-parent-group:client-1:2026-03-01:2026-04-01',
    ) as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();
    return checkbox as HTMLInputElement;
  }, { timeout: 5000 });
  fireEvent.click(parentCheckbox);

  const generateButton = await screen.findByText('Generate Invoices (2)');
  fireEvent.click(generateButton);
}

describe('AutomaticInvoices PO overage dialog', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    cleanup();
    mockGetAvailableRecurringDueWork.mockReset();
    mockGetPurchaseOrderOverageForSelectionInput.mockReset();
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
          members: [buildMember(1), buildMember(2)],
        },
      ],
      materializationGaps: [],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    };
    mockRecurringInvoiceHistoryResponse = { rows: [], total: 0, page: 1, pageSize: 10 };
    mockGetAvailableRecurringDueWork.mockResolvedValue(mockDueWorkResponse);
  });

  it('formats overage_cents as minor units — a 61250-cent overage renders as $612.50, not $61,250.00 (Defect B)', async () => {
    mockGetPurchaseOrderOverageForSelectionInput.mockResolvedValue({
      overage_cents: 61250,
      po_number: 'PO-123',
    });

    await selectParentAndClickGenerate();

    const dialog = await screen.findByTestId('po-overage-batch-decision');
    expect(dialog.textContent).toContain('$612.50');
    expect(dialog.textContent).not.toContain('$61,250.00');
    expect(dialog.textContent).not.toContain('NaN');
    expect(mockGenerateGroupedInvoicesAsRecurringBillingRun).not.toHaveBeenCalled();
  });

  it('surfaces a returned action error instead of rendering the overage dialog with $NaN (Defect A)', async () => {
    mockGetPurchaseOrderOverageForSelectionInput.mockResolvedValue({
      actionError: 'Billing cycle not found. It may have been updated or deleted. Please refresh and try again.',
    });

    await selectParentAndClickGenerate();

    await waitFor(() => {
      expect(
        screen.getAllByText('Billing cycle not found. It may have been updated or deleted. Please refresh and try again.').length,
      ).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('po-overage-batch-decision')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('$NaN');
    expect(mockGenerateGroupedInvoicesAsRecurringBillingRun).not.toHaveBeenCalled();
  });

  it('treats a malformed overage payload (non-finite overage_cents) as no overage rather than rendering $NaN', async () => {
    mockGetPurchaseOrderOverageForSelectionInput.mockResolvedValue({
      overage_cents: undefined,
      po_number: null,
    });

    await selectParentAndClickGenerate();

    await waitFor(() => {
      expect(mockGenerateGroupedInvoicesAsRecurringBillingRun).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId('po-overage-batch-decision')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('$NaN');
  });
});
