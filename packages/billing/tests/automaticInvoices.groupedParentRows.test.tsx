/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

let mockDueWorkResponse: any;

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
  previewInvoiceForSelectionInput: vi.fn(async () => ({ success: false, error: 'Not used in this test' })),
}));

vi.mock('@alga-psa/billing/actions/recurringBillingRunActions', () => ({
  generateInvoicesAsRecurringBillingRun: vi.fn(async () => ({ failures: [] })),
}));

vi.mock('@alga-psa/billing/actions/billingCycleActions', () => ({
  getRecurringInvoiceHistoryPaginated: vi.fn(async () => ({ rows: [], total: 0, page: 1, pageSize: 10 })),
  reverseRecurringInvoice: vi.fn(async () => undefined),
  hardDeleteRecurringInvoice: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data }: { id: string; data: any[] }) => (
    <div data-testid={id}>
      <div data-testid={`${id}-row-count`}>{data.length}</div>
      {data.map((row) => (
        <div key={row.candidateKey ?? row.invoiceId} data-testid={`${id}-row`}>
          {row.candidateKey ?? row.invoiceId}
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
  Checkbox: (props: any) => <input type="checkbox" {...props} />,
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
              billingCycleId: 'bc-1',
              selectorInput: { executionWindow: { windowStart: '2026-03-01', windowEnd: '2026-04-01', cadenceOwner: 'contract', duePosition: 'advance' } },
            },
            {
              executionIdentityKey: 'exec-2',
              billingCycleId: 'bc-2',
              selectorInput: { executionWindow: { windowStart: '2026-03-01', windowEnd: '2026-04-01', cadenceOwner: 'contract', duePosition: 'advance' } },
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
});
