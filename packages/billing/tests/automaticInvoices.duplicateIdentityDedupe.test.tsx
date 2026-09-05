/**
 * @vitest-environment jsdom
 *
 * Regression coverage for duplicated execution identities in the recurring
 * invoice candidate list. The persisted due-work reader joins
 * client_billing_cycles on invoice-window dates, so duplicate cycle rows for
 * the same period used to fan one obligation out into two identical members.
 * The UI then rendered two child rows with the same DOM id and submitted the
 * same execution identity twice on preview — which is how the live smoke run
 * hit the wrong "not materialized" failure instead of the coded
 * USAGE_RECORDS_MISSING preview state.
 *
 * These tests drive the real grouped-preview path (candidate → parent group →
 * child selection → Preview Selected) with a candidate carrying a duplicated
 * identity and assert exactly one row, one selector, and one submitted
 * selector input per execution identity.
 */
import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

let mockDueWorkResponse: any;
let mockRecurringInvoiceHistoryResponse: any;
const mockGetAvailableRecurringDueWork = vi.fn();
const mockPreviewGroupedInvoicesForSelectionInputs = vi.fn(async (groups: Array<{ previewGroupKey: string; selectorInputs: any[] }>) => ({
  success: true,
  invoiceCount: groups.length,
  previews: groups.map((group) => ({
    previewGroupKey: group.previewGroupKey,
    selectorInputs: group.selectorInputs,
    data: {
      invoiceNumber: 'PREVIEW',
      issueDate: '2026-09-01',
      dueDate: '2026-09-30',
      customer: { name: 'Emerald City', address: '1 Yellow Brick Rd' },
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
  // The component drives selection through onClick (for shift-range support)
  // and calls event.preventDefault(); on a native jsdom checkbox that cancels
  // the click activation, so hand it a no-op preventDefault instead.
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
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
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

// Load the component once during module setup so a cold Vite transform is not
// charged against the first test's behavioral timeout on busy CI runners.
const { default: AutomaticInvoices } = await import(
  '../src/components/billing-dashboard/AutomaticInvoices'
);

const USAGE_IDENTITY_KEY = 'client-window:emerald:schedule-usage:period-2026-08:2026-09-01:2026-10-01';
const PARENT_GROUP_KEY = 'parent-group:client-emerald:2026-09-01:2026-10-01';
const CHILD_SELECTOR_ID = `select-child-${PARENT_GROUP_KEY}-${USAGE_IDENTITY_KEY}`;

const buildUsageMember = (billingCycleId: string) => ({
  executionIdentityKey: USAGE_IDENTITY_KEY,
  canGenerate: true,
  billingCycleId,
  clientId: 'client-emerald',
  clientName: 'Emerald City',
  purchaseOrderScopeKey: null,
  currencyCode: 'USD',
  taxSource: 'exclusive',
  exportShapeKey: 'shape-a',
  cadenceSource: 'client_schedule',
  duePosition: 'arrears',
  chargeType: 'Usage',
  scheduleKey: 'schedule-usage',
  servicePeriodStart: '2026-08-01',
  servicePeriodEnd: '2026-09-01',
  servicePeriodLabel: '2026-08-01 to 2026-09-01',
  invoiceWindowStart: '2026-09-01',
  invoiceWindowEnd: '2026-10-01',
  selectorInput: {
    clientId: 'client-emerald',
    windowStart: '2026-09-01',
    windowEnd: '2026-10-01',
    executionWindow: {
      kind: 'client_cadence_window',
      identityKey: USAGE_IDENTITY_KEY,
      cadenceOwner: 'client',
      scheduleKey: 'schedule-usage',
      periodKey: 'period-2026-08',
    },
  },
});

describe('AutomaticInvoices duplicate execution identity dedupe', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    cleanup();
    mockGetAvailableRecurringDueWork.mockReset();
    mockPreviewGroupedInvoicesForSelectionInputs.mockClear();
    mockGenerateGroupedInvoicesAsRecurringBillingRun.mockClear();
    mockDueWorkResponse = {
      invoiceCandidates: [
        {
          candidateKey: 'invoice-candidate:client-emerald:2026-09-01:2026-10-01',
          clientId: 'client-emerald',
          clientName: 'Emerald City',
          windowStart: '2026-09-01',
          windowEnd: '2026-10-01',
          windowLabel: '2026-09-01 to 2026-10-01',
          servicePeriodStart: '2026-08-01',
          servicePeriodEnd: '2026-09-01',
          servicePeriodLabel: '2026-08-01 to 2026-09-01',
          cadenceOwners: ['client'],
          cadenceSources: ['client_schedule'],
          contractId: 'contract-usage',
          contractName: 'Smoke Usage Contract',
          splitReasons: [],
          // The fanned-out reader reported both copies, so the count and the
          // member list disagree with the true obligation count on purpose.
          memberCount: 2,
          canGenerate: true,
          blockedReason: null,
          members: [buildUsageMember('bc-1'), buildUsageMember('bc-2')],
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

  it('renders one child row and one selector per execution identity', async () => {
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    // The parent group reflects the deduped obligation count, not the fanned-out one.
    await waitFor(() => {
      expect(screen.getByText('1 line item')).toBeInTheDocument();
    }, { timeout: 5000 });

    const expandButton = await screen.findByRole('button', { name: 'Expand' });
    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(document.getElementById(CHILD_SELECTOR_ID)).not.toBeNull();
    });

    // Exactly one DOM node carries the child-selector id: duplicated members
    // used to render two identical rows with colliding ids.
    expect(document.querySelectorAll(`[id="${CHILD_SELECTOR_ID}"]`)).toHaveLength(1);
  });

  it('previewing the selected child submits each execution identity exactly once', async () => {
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    const expandButton = await screen.findByRole('button', { name: 'Expand' });
    fireEvent.click(expandButton);

    const childCheckbox = await waitFor(() => {
      const checkbox = document.getElementById(CHILD_SELECTOR_ID) as HTMLInputElement | null;
      expect(checkbox).not.toBeNull();
      return checkbox as HTMLInputElement;
    });
    fireEvent.click(childCheckbox);

    const previewButton = await screen.findByRole('button', { name: 'Preview Selected' });
    fireEvent.click(previewButton);

    await waitFor(() => {
      expect(mockPreviewGroupedInvoicesForSelectionInputs).toHaveBeenCalledTimes(1);
    });

    const submittedGroups = mockPreviewGroupedInvoicesForSelectionInputs.mock.calls[0][0];
    const submittedIdentityKeys = submittedGroups.flatMap((group) =>
      group.selectorInputs.map((selectorInput: any) => selectorInput.executionWindow.identityKey),
    );
    // One group, one selector input, one occurrence of the identity — the
    // duplicated member must not double-submit the selection.
    expect(submittedGroups).toHaveLength(1);
    expect(submittedIdentityKeys).toEqual([USAGE_IDENTITY_KEY]);
  });

  it('generation also receives a single target for a duplicated identity', async () => {
    render(<AutomaticInvoices onGenerateSuccess={() => undefined} />);

    const expandButton = await screen.findByRole('button', { name: 'Expand' });
    fireEvent.click(expandButton);

    const childCheckbox = await waitFor(() => {
      const checkbox = document.getElementById(CHILD_SELECTOR_ID) as HTMLInputElement | null;
      expect(checkbox).not.toBeNull();
      return checkbox as HTMLInputElement;
    });
    fireEvent.click(childCheckbox);

    const generateButton = await screen.findByRole('button', { name: 'Generate Invoices (1)' });
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(mockGenerateGroupedInvoicesAsRecurringBillingRun).toHaveBeenCalledTimes(1);
    });

    const runArgs = mockGenerateGroupedInvoicesAsRecurringBillingRun.mock.calls[0][0] as any;
    expect(runArgs.groupedTargets).toHaveLength(1);
    expect(runArgs.groupedTargets[0].selectorInputs).toHaveLength(1);
    expect(runArgs.groupedTargets[0].selectorInputs[0].executionWindow.identityKey).toBe(USAGE_IDENTITY_KEY);
  });
});
