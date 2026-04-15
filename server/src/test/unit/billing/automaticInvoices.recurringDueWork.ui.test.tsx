/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  buildServicePeriodRecurringDueWorkRow,
} from '@alga-psa/shared/billingClients/recurringDueWork';
import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';
import * as billingAndTaxActions from '@alga-psa/billing/actions/billingAndTax';
import * as billingCycleActions from '@alga-psa/billing/actions/billingCycleActions';
import * as invoiceGenerationActions from '@alga-psa/billing/actions/invoiceGeneration';
import * as recurringBillingRunActions from '@alga-psa/billing/actions/recurringBillingRunActions';
import type { IRecurringDueWorkInvoiceCandidate } from '@alga-psa/types';

type Row = Record<string, any>;

function normalizeTableName(tableName: string): string {
  return tableName.split(/\s+as\s+/i)[0].trim();
}

function normalizeColumn(column: unknown): string {
  return String(column)
    .replace(/^LOWER\(/i, '')
    .replace(/^DATE\(/i, '')
    .replace(/\)$/g, '')
    .replace(/^.*\./, '')
    .replace(/\s+as\s+.*$/i, '')
    .trim();
}

function compareValues(left: any, right: any) {
  if (left == null && right == null) {
    return 0;
  }
  if (left == null) {
    return -1;
  }
  if (right == null) {
    return 1;
  }
  return String(left).localeCompare(String(right));
}

function applyOperator(rowValue: any, operator: string, expected: any) {
  switch (operator) {
    case '=':
      return rowValue === expected;
    case '>=':
      return String(rowValue) >= String(expected);
    case '<=':
      return String(rowValue) <= String(expected);
    case '>':
      return String(rowValue) > String(expected);
    case '<':
      return String(rowValue) < String(expected);
    default:
      throw new Error(`Unsupported operator ${operator}`);
  }
}

function createQueryBuilder(rows: Row[]) {
  let resultRows = [...rows];

  const builder: any = {
    join: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    select: vi.fn(() => builder),
    where: vi.fn((columnOrCriteria: string | Record<string, any>, operatorOrValue?: any, maybeValue?: any) => {
      if (typeof columnOrCriteria === 'object') {
        resultRows = resultRows.filter((row) =>
          Object.entries(columnOrCriteria).every(([column, expected]) =>
            row[normalizeColumn(column)] === expected,
          ),
        );
        return builder;
      }

      const column = normalizeColumn(columnOrCriteria);
      const operator = maybeValue === undefined ? '=' : operatorOrValue;
      const expected = maybeValue === undefined ? operatorOrValue : maybeValue;
      resultRows = resultRows.filter((row) => applyOperator(row[column], operator, expected));
      return builder;
    }),
    whereIn: vi.fn((column: string, values: any[]) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => values.includes(row[normalized]));
      return builder;
    }),
    whereNotIn: vi.fn((column: string, values: any[]) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => !values.includes(row[normalized]));
      return builder;
    }),
    whereNull: vi.fn((column: string) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => row[normalized] == null);
      return builder;
    }),
    whereNotNull: vi.fn((column: string) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => row[normalized] != null);
      return builder;
    }),
    whereRaw: vi.fn((sql: string, args: any[] = []) => {
      const loweredLikeMatch = sql.match(/LOWER\((.+)\)\s+LIKE\s+\?/i);
      if (loweredLikeMatch) {
        const column = normalizeColumn(loweredLikeMatch[1] ?? '');
        const needle = String(args[0] ?? '').toLowerCase().replaceAll('%', '');
        resultRows = resultRows.filter((row) =>
          String(row[column] ?? '').toLowerCase().includes(needle),
        );
        return builder;
      }

      const dateCompareMatch = sql.match(/DATE\((.+)\)\s*(>=|<=)\s+\?/i);
      if (dateCompareMatch) {
        const column = normalizeColumn(dateCompareMatch[1] ?? '');
        const operator = dateCompareMatch[2] ?? '=';
        const expected = String(args[0] ?? '');
        resultRows = resultRows.filter((row) =>
          applyOperator(String(row[column] ?? '').slice(0, 10), operator, expected),
        );
        return builder;
      }

      throw new Error(`Unsupported whereRaw expression: ${sql}`);
    }),
    orderBy: vi.fn((column: string, direction: 'asc' | 'desc' = 'asc') => {
      const normalized = normalizeColumn(column);
      resultRows = [...resultRows].sort((left, right) => {
        const comparison = compareValues(left[normalized], right[normalized]);
        return direction === 'desc' ? -comparison : comparison;
      });
      return builder;
    }),
    limit: vi.fn((count: number) => {
      resultRows = resultRows.slice(0, count);
      return builder;
    }),
    offset: vi.fn((count: number) => {
      resultRows = resultRows.slice(count);
      return builder;
    }),
    count: vi.fn(() => {
      resultRows = [{ count: resultRows.length }];
      return builder;
    }),
    first: vi.fn(async () => resultRows[0]),
    then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resultRows).then(resolve, reject),
  };

  return builder;
}

const dbMocks = vi.hoisted(() => {
  const rowsByTable: Record<string, Row[]> = {};
  const missingTables = new Set<string>();

  const trx = vi.fn((tableName: string) => {
    const normalizedTableName = normalizeTableName(tableName);
    if (missingTables.has(normalizedTableName)) {
      throw new Error(`relation "${normalizedTableName}" does not exist`);
    }

    return createQueryBuilder(rowsByTable[normalizedTableName] ?? []);
  }) as any;
  trx.raw = vi.fn((sql: string) => sql);

  return {
    missingTables,
    rowsByTable,
    trx,
    createTenantKnex: vi.fn(async () => ({ knex: trx })),
    withTransaction: vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<unknown>) =>
      callback(trx),
    ),
  };
});

(globalThis as unknown as { React?: typeof React }).React = React;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: 'user-1',
          tenant: 'tenant-1',
        },
        { tenant: 'tenant-1' },
        ...args,
      ),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: dbMocks.createTenantKnex,
  withTransaction: dbMocks.withTransaction,
  runWithTenant: async (_tenant: string, callback: () => Promise<unknown> | unknown) => callback(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

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
              <tr key={row.candidateKey ?? row.rowKey ?? row.executionIdentityKey ?? row.invoiceId ?? row.billing_cycle_id ?? rowIndex}>
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

function createClientRow(options: { billingCycleId?: string | null } = {}) {
  return buildServicePeriodRecurringDueWorkRow({
    clientId: 'client-1',
    clientName: 'Acme Co',
    billingCycleId: options.billingCycleId === undefined ? 'cycle-2025-03' : options.billingCycleId,
    record: buildRecurringServicePeriodRecord({
      cadenceOwner: 'client',
      duePosition: 'advance',
      sourceObligation: {
        tenant: 'tenant-1',
        obligationId: 'line-1',
        obligationType: 'client_contract_line',
        chargeFamily: 'fixed',
      },
      scheduleKey: 'schedule:tenant-1:client_contract_line:line-1:client:advance',
      periodKey: 'period:2025-03-01:2025-04-01',
      invoiceWindow: {
        start: '2025-03-01',
        end: '2025-04-01',
        semantics: 'half_open',
      },
      servicePeriod: {
        start: '2025-03-01',
        end: '2025-04-01',
        semantics: 'half_open',
      },
    }),
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
    executionWindowKind: 'client_cadence_window' as const,
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

function buildInvoiceCandidate(
  members: any[],
  options: { candidateKey?: string; approvalBlockedEntryCount?: number } = {},
): IRecurringDueWorkInvoiceCandidate {
  const first = members[0];
  const servicePeriodStart = members
    .map((member) => member.servicePeriodStart)
    .sort()[0];
  const servicePeriodEnd = members
    .map((member) => member.servicePeriodEnd)
    .sort()
    .slice(-1)[0];
  const windowStart = first.invoiceWindowStart;
  const windowEnd = first.invoiceWindowEnd;
  const canGenerate = members.every((member) => Boolean(member.canGenerate));

  return {
    candidateKey: options.candidateKey ?? `candidate:${first.executionIdentityKey}`,
    clientId: first.clientId,
    clientName: first.clientName ?? null,
    windowStart,
    windowEnd,
    windowLabel: `${windowStart} to ${windowEnd}`,
    servicePeriodStart,
    servicePeriodEnd,
    servicePeriodLabel: `${servicePeriodStart} to ${servicePeriodEnd}`,
    cadenceOwners: Array.from(new Set(members.map((member) => member.cadenceOwner))),
    cadenceSources: Array.from(new Set(members.map((member) => member.cadenceSource))),
    contractId: first.contractId ?? null,
    contractName: first.contractName ?? null,
    splitReasons: [],
    memberCount: members.length,
    canGenerate,
    blockedReason: options.approvalBlockedEntryCount && options.approvalBlockedEntryCount > 0
      ? `Blocked until approval: ${options.approvalBlockedEntryCount} unapproved ${options.approvalBlockedEntryCount === 1 ? 'entry' : 'entries'}.`
      : canGenerate
        ? null
        : 'Blocked',
    approvalBlockedEntryCount: options.approvalBlockedEntryCount ?? 0,
    hasApprovalBlockers: Boolean(options.approvalBlockedEntryCount && options.approvalBlockedEntryCount > 0),
    members,
  };
}

describe('AutomaticInvoices recurring due-work UI', () => {
  const originalGetAvailableRecurringDueWork = billingAndTaxActions.getAvailableRecurringDueWork;
  const getAvailableRecurringDueWorkMock = vi.spyOn(billingAndTaxActions, 'getAvailableRecurringDueWork');
  const getAvailableBillingPeriodsMock = vi.spyOn(billingAndTaxActions, 'getAvailableBillingPeriods');
  const getRecurringInvoiceHistoryPaginatedMock = vi.spyOn(billingCycleActions, 'getRecurringInvoiceHistoryPaginated');
  const previewInvoiceForSelectionInputMock = vi.spyOn(
    invoiceGenerationActions,
    'previewGroupedInvoicesForSelectionInputs',
  );
  const getPurchaseOrderOverageForSelectionInputMock = vi.spyOn(
    invoiceGenerationActions,
    'getPurchaseOrderOverageForSelectionInput',
  );
  const generateInvoicesAsRecurringBillingRunMock = vi.spyOn(
    recurringBillingRunActions,
    'generateGroupedInvoicesAsRecurringBillingRun',
  );
  const generateLegacyInvoicesAsRecurringBillingRunMock = vi.spyOn(
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
    dbMocks.missingTables.clear();
    window.history.replaceState({}, '', '/msp/billing?tab=invoicing&subtab=generate');

    dbMocks.rowsByTable.client_billing_cycles = [
      {
        tenant: 'tenant-1',
        client_id: 'client-2',
        client_name: 'Bravo Co',
        billing_cycle_id: 'cycle-2025-02',
        billing_cycle: 'monthly',
        period_start_date: '2025-02-01',
        period_end_date: '2025-03-01',
        effective_date: '2025-02-01',
        invoice_id: null,
      },
    ];

    dbMocks.rowsByTable.client_contracts = [
      {
        tenant: 'tenant-1',
        client_id: 'client-2',
        client_contract_line_id: 'line-2',
        cadence_owner: 'client',
        billing_frequency: 'monthly',
        billing_timing: 'advance',
        start_date: '2025-01-01',
        end_date: null,
        is_active: true,
      },
    ];

    dbMocks.rowsByTable.recurring_service_periods = [
      {
        tenant: 'tenant-1',
        record_id: 'rsp-contract-1',
        schedule_key: 'schedule:tenant-1:contract_line:line-1:contract:arrears',
        period_key: 'period:2025-03-08:2025-04-08',
        lifecycle_state: 'generated',
        cadence_owner: 'contract',
        obligation_type: 'contract_line',
        service_period_start: '2025-03-08',
        service_period_end: '2025-04-08',
        invoice_window_start: '2025-04-08',
        invoice_window_end: '2025-05-08',
        invoice_charge_detail_id: null,
        client_id: 'client-9',
        client_name: 'Zenith Health',
        billing_cycle_id: null,
        contract_id: 'contract-1',
        contract_name: 'Zenith Annual Support',
        contract_line_id: 'line-1',
        contract_line_name: 'Managed Services',
      },
      {
        tenant: 'tenant-1',
        record_id: 'rsp-client-1',
        schedule_key: 'schedule:tenant-1:client_contract_line:line-2:client:advance',
        period_key: 'period:2025-03-01:2025-04-01',
        lifecycle_state: 'generated',
        cadence_owner: 'client',
        obligation_type: 'client_contract_line',
        service_period_start: '2025-03-01',
        service_period_end: '2025-04-01',
        invoice_window_start: '2025-03-01',
        invoice_window_end: '2025-04-01',
        invoice_charge_detail_id: null,
        client_id: 'client-2',
        client_name: 'Bravo Co',
        billing_cycle_id: null,
        contract_id: 'contract-2',
        contract_name: 'Bravo Monthly Support',
        contract_line_id: 'line-2',
        contract_line_name: 'Bravo Retainer',
      },
    ];

    getAvailableBillingPeriodsMock.mockResolvedValue({
      periods: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });
    previewInvoiceForSelectionInputMock.mockResolvedValue({
      success: true,
      invoiceCount: 1,
      previews: [{
        previewGroupKey: 'default-preview-group',
        selectorInputs: [createClientRow().selectorInput],
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
      }],
    } as any);
    getPurchaseOrderOverageForSelectionInputMock.mockResolvedValue(null);
    const contractRow = createContractRow();
    const clientRow = createClientRow();
    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [
        buildInvoiceCandidate([contractRow], { candidateKey: 'candidate-contract-default' }),
        buildInvoiceCandidate([clientRow], { candidateKey: 'candidate-client-default' }),
      ],
      materializationGaps: [],
      total: 2,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
    getRecurringInvoiceHistoryPaginatedMock.mockResolvedValue({
      rows: [],
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
    generateLegacyInvoicesAsRecurringBillingRunMock.mockResolvedValue({
      runId: 'legacy-run-1',
      selectionKey: 'legacy-selection-1',
      retryKey: 'legacy-retry-1',
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
        dateRange: {
          from: undefined,
          to: expect.any(String),
        },
      });
    });

    expect(getAvailableBillingPeriodsMock).not.toHaveBeenCalled();
    expect(screen.getByText('Zenith Health')).toBeInTheDocument();
  });

  it('handles an empty recurring due-work and history page', async () => {
    getAvailableRecurringDueWorkMock.mockResolvedValueOnce({
      invoiceCandidates: [],
      materializationGaps: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });
    getRecurringInvoiceHistoryPaginatedMock.mockResolvedValueOnce({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(getAvailableRecurringDueWorkMock).toHaveBeenCalled();
      expect(getRecurringInvoiceHistoryPaginatedMock).toHaveBeenCalled();
    });

    expect(screen.getByText('Ready to Invoice')).toBeInTheDocument();
    expect(screen.getByText('Recurring Invoice History')).toBeInTheDocument();
  });

  it('T005/T006/T010/T011/T012: AutomaticInvoices renders Needs Approval above Ready to Invoice and moves approval-blocked windows out of ready selection', async () => {
    const blockedRow = {
      ...createContractRow(),
      clientId: 'client-blocked',
      clientName: 'Blocked Co',
      contractLineId: 'blocked-line-1',
      contractName: 'Blocked Contract',
      contractLineName: 'Blocked Hourly',
      canGenerate: false,
      blockedReason: 'Blocked until approval: 2 unapproved entries.',
      approvalBlockedEntryCount: 2,
    };
    const readyRow = {
      ...createClientRow(),
      clientId: 'client-ready',
      clientName: 'Ready Co',
      canGenerate: true,
      approvalBlockedEntryCount: 0,
    };

    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [
        buildInvoiceCandidate([blockedRow], {
          candidateKey: 'candidate-blocked-t005',
          approvalBlockedEntryCount: 2,
        }),
        buildInvoiceCandidate([readyRow], {
          candidateKey: 'candidate-ready-t005',
          approvalBlockedEntryCount: 0,
        }),
      ],
      materializationGaps: [],
      total: 2,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    const needsApprovalSection = await screen.findByTestId('needs-approval-section');
    const sectionHeadings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent?.trim());
    expect(sectionHeadings.indexOf('Needs Approval')).toBeLessThan(
      sectionHeadings.indexOf('Ready to Invoice'),
    );
    expect(within(needsApprovalSection).getByText('Blocked Co')).toBeInTheDocument();
    expect(within(needsApprovalSection).getByText('2 unapproved entries')).toBeInTheDocument();
    expect(
      within(needsApprovalSection).getByRole('link', { name: 'Review Approvals' }),
    ).toHaveAttribute(
      'href',
      '/msp/time-sheet-approvals?clientId=client-blocked&windowStart=2025-04-08&windowEnd=2025-05-08',
    );

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    expect(within(readyTable).queryByText('Blocked Co')).toBeNull();
    expect(within(readyTable).getByText('Ready Co')).toBeInTheDocument();
  });

  it('T006/T012: Needs Approval rows are informational only and do not become selectable/generatable targets', async () => {
    const blockedRow = {
      ...createContractRow(),
      clientId: 'client-blocked-only',
      clientName: 'Blocked Only Co',
      canGenerate: false,
      blockedReason: 'Blocked until approval: 1 unapproved entry.',
      approvalBlockedEntryCount: 1,
    };
    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [
        buildInvoiceCandidate([blockedRow], {
          candidateKey: 'candidate-blocked-only',
          approvalBlockedEntryCount: 1,
        }),
      ],
      materializationGaps: [],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    const needsApprovalSection = await screen.findByTestId('needs-approval-section');
    expect(within(needsApprovalSection).getByText('Blocked Only Co')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Preview Selected/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Generate Invoices for Selected Periods \(0\)/i }),
    ).toBeDisabled();
  });

  it('persists the automatic client filter in the URL and scopes it to needs/ready rows only', async () => {
    window.history.replaceState(
      {},
      '',
      '/msp/billing?tab=invoicing&subtab=generate&automaticClientFilter=Blocked',
    );

    const blockedRow = {
      ...createContractRow(),
      clientId: 'client-blocked-filtered',
      clientName: 'Blocked Co',
      canGenerate: false,
      blockedReason: 'Blocked until approval: 1 unapproved entry.',
      approvalBlockedEntryCount: 1,
    };
    const readyRow = {
      ...createClientRow(),
      clientId: 'client-ready-filtered',
      clientName: 'Ready Co',
      canGenerate: true,
      approvalBlockedEntryCount: 0,
    };

    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [
        buildInvoiceCandidate([blockedRow], {
          candidateKey: 'candidate-blocked-filtered',
          approvalBlockedEntryCount: 1,
        }),
        buildInvoiceCandidate([readyRow], {
          candidateKey: 'candidate-ready-filtered',
          approvalBlockedEntryCount: 0,
        }),
      ],
      materializationGaps: [
        {
          executionIdentityKey: 'gap-blocked-filtered',
          selectionKey: 'gap-selection-blocked-filtered',
          clientId: 'client-gap-filtered',
          clientName: 'Repair Co',
          scheduleKey: 'schedule:tenant-1:client_contract_line:line-gap:client:advance',
          periodKey: 'period:2025-03-01:2025-04-01',
          billingCycleId: 'cycle-gap',
          invoiceWindowStart: '2025-03-01',
          invoiceWindowEnd: '2025-04-01',
          servicePeriodStart: '2025-03-01',
          servicePeriodEnd: '2025-04-01',
          reason: 'missing_service_period_materialization',
          detail: 'Recurring service periods were not materialized for this canonical client-cadence execution window.',
        },
      ],
      total: 2,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    const filterInput = await screen.findByDisplayValue('Blocked');
    expect(filterInput).toBeInTheDocument();

    const needsApprovalSection = await screen.findByTestId('needs-approval-section');
    expect(within(needsApprovalSection).getByText('Blocked Co')).toBeInTheDocument();
    expect(within(needsApprovalSection).queryByText('Ready Co')).toBeNull();

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    expect(within(readyTable).queryByText('Ready Co')).toBeNull();

    const gapPanel = await screen.findByTestId('recurring-materialization-gap-panel');
    expect(within(gapPanel).getByText('Repair Co')).toBeInTheDocument();

    fireEvent.change(filterInput, { target: { value: 'Ready' } });

    await waitFor(() => {
      expect(window.location.search).toContain('automaticClientFilter=Ready');
      expect(within(needsApprovalSection).queryByText('Blocked Co')).toBeNull();
      expect(within(readyTable).getByText('Ready Co')).toBeInTheDocument();
    });

    expect(within(gapPanel).getByText('Repair Co')).toBeInTheDocument();
  });

  it('T004: AutomaticInvoices loads through the real due-work action in a migrated schema with no `client_contract_lines` table', async () => {
    dbMocks.missingTables.add('client_contract_lines');
    getAvailableRecurringDueWorkMock.mockImplementation(originalGetAvailableRecurringDueWork);

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(getAvailableRecurringDueWorkMock).toHaveBeenCalledWith({
        page: 1,
        pageSize: 10,
        dateRange: {
          from: undefined,
          to: expect.any(String),
        },
      });
      expect(screen.getByText('Zenith Health')).toBeInTheDocument();
      expect(screen.getAllByText('Bravo Co').length).toBeGreaterThan(0);
    });

    expect(screen.queryByText('Failed to load billing periods. Please try again.')).toBeNull();
    expect(getAvailableBillingPeriodsMock).not.toHaveBeenCalled();
  });

  it('T011/T026/T029/T030/T039: AutomaticInvoices renders contract-cadence rows with cadence, service-period, invoice-window, contract context, and a service-period-backed badge', async () => {
    const contractRow = createContractRow();
    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Contract anniversary')).toBeInTheDocument();
    });

    expect(screen.getByText('2025-03-08 to 2025-04-08')).toBeInTheDocument();
    expect(screen.getByText('2025-04-08 to 2025-05-08')).toBeInTheDocument();
    expect(screen.getByText('1 contract')).toBeInTheDocument();
    expect(screen.getByText('1 line')).toBeInTheDocument();
    expect(screen.getAllByText('Service-period-backed').length).toBeGreaterThan(0);

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    fireEvent.click(within(readyTable).getAllByRole('checkbox')[0]!);

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

  it('removes bridge-only row menus from ready service-period work', async () => {
    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Acme Co')).toBeInTheDocument();
      expect(screen.getByText('Zenith Health')).toBeInTheDocument();
    });

    expect(screen.queryAllByRole('button', { name: /open menu/i })).toHaveLength(0);
    expect(screen.queryByText('Delete Cycle')).toBeNull();
  });

  it('T066: missing recurring materialization is presented as an explicit repair action instead of a fallback-ready invoice row', async () => {
    getAvailableRecurringDueWorkMock.mockResolvedValueOnce({
      invoiceCandidates: [],
      materializationGaps: [
        {
          executionIdentityKey: 'client_schedule:client-1:schedule:tenant-1:client_contract_line:line-1:client:advance:period:2025-03-01:2025-04-01:2025-03-01:2025-04-01',
          selectionKey: 'client_schedule:client-1:schedule:tenant-1:client_contract_line:line-1:client:advance:period:2025-03-01:2025-04-01',
          clientId: 'client-1',
          clientName: 'Acme Co',
          scheduleKey: 'schedule:tenant-1:client_contract_line:line-1:client:advance',
          periodKey: 'period:2025-03-01:2025-04-01',
          billingCycleId: 'cycle-2025-03',
          invoiceWindowStart: '2025-03-01',
          invoiceWindowEnd: '2025-04-01',
          servicePeriodStart: '2025-03-01',
          servicePeriodEnd: '2025-04-01',
          reason: 'missing_service_period_materialization' as const,
          detail: 'Recurring service periods were not materialized for this canonical client-cadence execution window.',
        },
      ],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    const gapPanel = await screen.findByTestId('recurring-materialization-gap-panel');
    const gapEntry = within(gapPanel).getByTestId(
      'recurring-materialization-gap-client_schedule:client-1:schedule:tenant-1:client_contract_line:line-1:client:advance:period:2025-03-01:2025-04-01',
    );
    const readyTable = screen.getByTestId('automatic-invoices-table');

    expect(within(gapPanel).getByText('Recurring service period repair required')).toBeInTheDocument();
    expect(within(gapEntry).getByText('Acme Co')).toBeInTheDocument();
    expect(
      within(gapEntry).getByText(
        'Repair the canonical service-period records instead of generating a compatibility invoice row.',
      ),
    ).toBeInTheDocument();
    expect(within(readyTable).queryByText('Acme Co')).not.toBeInTheDocument();

    const repairLink = within(gapEntry).getByRole('link', { name: 'Review Service Periods' });
    expect(repairLink).toHaveAttribute(
      'href',
      '/msp/billing?tab=service-periods&scheduleKey=schedule%3Atenant-1%3Aclient_contract_line%3Aline-1%3Aclient%3Aadvance',
    );
  });

  it('T010: AutomaticInvoices can render and act on a client-cadence recurring row whose bridge metadata is null', async () => {
    const clientRow = createClientRow({ billingCycleId: null });
    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [buildInvoiceCandidate([clientRow])],
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

    expect(screen.getByText('Client schedule')).toBeInTheDocument();
    expect(screen.getAllByText('Service-period-backed').length).toBeGreaterThan(0);
    expect(clientRow.billingCycleId).toBeNull();
    expect(clientRow.selectorInput.billingCycleId).toBeUndefined();

    const clientRowElement = screen.getByText('Acme Co').closest('tr');
    expect(clientRowElement).toBeTruthy();
    fireEvent.click(within(clientRowElement!).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Preview Selected/i }));

    await waitFor(() => {
      expect(previewInvoiceForSelectionInputMock).toHaveBeenCalledWith([
        expect.objectContaining({
          selectorInputs: [clientRow.selectorInput],
        }),
      ]);
      expect(screen.getByText('Client Details')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Close Preview/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /Generate Invoices for Selected Periods \(1\)/i }),
    );

    await waitFor(() => {
      expect(generateInvoicesAsRecurringBillingRunMock).toHaveBeenCalledWith({
        groupedTargets: [
          expect.objectContaining({
            selectorInputs: [clientRow.selectorInput],
          }),
        ],
      });
    });

    const [generateCall] = generateInvoicesAsRecurringBillingRunMock.mock.calls;
    expect(generateCall?.[0]?.groupedTargets?.[0]?.billingCycleId).toBeNull();
    expect(generateCall?.[0]?.groupedTargets?.[0]?.selectorInputs?.[0]?.billingCycleId).toBeUndefined();
  });

  it('T007/T012/T013/T091: client-cadence ready rows use canonical selector input while still preserving passive billing-cycle metadata for the table', async () => {
    const clientRow = createClientRow();
    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [buildInvoiceCandidate([clientRow])],
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

    expect(screen.queryByText('Service-period-backed')).toBeNull();
    expect(clientRow.selectorInput.billingCycleId).toBeUndefined();
    expect(clientRow.selectorInput.executionWindow.kind).toBe('client_cadence_window');

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    fireEvent.click(within(readyTable).getAllByRole('checkbox')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /Preview Selected/i }));

    await waitFor(() => {
      expect(previewInvoiceForSelectionInputMock).toHaveBeenCalledWith([
        expect.objectContaining({
          selectorInputs: [clientRow.selectorInput],
        }),
      ]);
      expect(screen.getByText('Client Details')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Close Preview/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /Generate Invoices for Selected Periods \(1\)/i }),
    );

    await waitFor(() => {
      expect(generateInvoicesAsRecurringBillingRunMock).toHaveBeenCalledWith({
        groupedTargets: [
          expect.objectContaining({
            selectorInputs: [clientRow.selectorInput],
            billingCycleId: 'cycle-2025-03',
          }),
        ],
      });
    });

    const [generateCall] = generateInvoicesAsRecurringBillingRunMock.mock.calls;
    expect(generateCall?.[0]?.groupedTargets?.[0]?.billingCycleId).toBe('cycle-2025-03');
    expect(generateCall?.[0]?.groupedTargets?.[0]?.selectorInputs?.[0]?.billingCycleId).toBeUndefined();
    expect(generateCall?.[0]?.groupedTargets?.[0]?.selectorInputs?.[0]?.executionWindow?.kind).toBe(
      'client_cadence_window',
    );
  });

  it('T097: AutomaticInvoices disables preview for grouped candidates and shows explicit grouped-preview copy', async () => {
    const contractRow = createContractRow();
    const groupedMember = {
      ...createContractRow(),
      executionIdentityKey: `${contractRow.executionIdentityKey}:grouped-member-2`,
      selectorInput: {
        ...contractRow.selectorInput,
        executionWindow: {
          ...contractRow.selectorInput.executionWindow,
          periodKey: 'period:2025-04-08:2025-05-08',
          invoiceWindow: {
            ...contractRow.selectorInput.executionWindow.invoiceWindow,
            start: '2025-05-08',
            end: '2025-06-08',
          },
          servicePeriod: {
            ...contractRow.selectorInput.executionWindow.servicePeriod,
            start: '2025-04-08',
            end: '2025-05-08',
          },
        },
      },
    };

    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [
        buildInvoiceCandidate([contractRow, groupedMember], { candidateKey: 'candidate-grouped-t097' }),
      ],
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

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    fireEvent.click(within(readyTable).getAllByRole('checkbox')[0]!);

    const previewButton = screen.getByRole('button', { name: /Preview Selected/i });
    expect(previewButton).not.toBeDisabled();
    expect(screen.getByTestId('grouped-preview-unavailable-copy')).toHaveTextContent(
      'Preview supports grouped selections; direct "Generate from preview" remains single-selection only.',
    );

    fireEvent.click(previewButton);
    await waitFor(() => {
      expect(previewInvoiceForSelectionInputMock).toHaveBeenCalledWith([
        expect.objectContaining({
          selectorInputs: [contractRow.selectorInput, groupedMember.selectorInput],
        }),
      ]);
    });
  });

  it('T098: AutomaticInvoices preview for a single-member candidate remains enabled and uses that candidate selector input', async () => {
    const contractRow = createContractRow();
    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [
        buildInvoiceCandidate([contractRow], { candidateKey: 'candidate-single-t098' }),
      ],
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

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    fireEvent.click(within(readyTable).getAllByRole('checkbox')[0]!);

    const previewButton = screen.getByRole('button', { name: /Preview Selected/i });
    expect(previewButton).not.toBeDisabled();
    expect(screen.queryByTestId('grouped-preview-unavailable-copy')).toBeNull();

    fireEvent.click(previewButton);

    await waitFor(() => {
      expect(previewInvoiceForSelectionInputMock).toHaveBeenCalledWith([
        expect.objectContaining({
          selectorInputs: [contractRow.selectorInput],
        }),
      ]);
      expect(screen.getByText('Client Details')).toBeInTheDocument();
    });
  });

  it('T099: AutomaticInvoices contract column derives names from candidate members and does not collapse partial metadata to no-context copy', async () => {
    const fullMember = createContractRow();
    const partialMember = {
      ...createContractRow(),
      contractName: null,
      contractLineName: null,
      executionIdentityKey: `${fullMember.executionIdentityKey}:partial-contract-metadata`,
      selectorInput: {
        ...fullMember.selectorInput,
        executionWindow: {
          ...fullMember.selectorInput.executionWindow,
          periodKey: 'period:2025-05-08:2025-06-08',
          invoiceWindow: {
            ...fullMember.selectorInput.executionWindow.invoiceWindow,
            start: '2025-06-08',
            end: '2025-07-08',
          },
          servicePeriod: {
            ...fullMember.selectorInput.executionWindow.servicePeriod,
            start: '2025-05-08',
            end: '2025-06-08',
          },
        },
      },
    };

    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [
        buildInvoiceCandidate([fullMember, partialMember], { candidateKey: 'candidate-contract-metadata-t099' }),
      ],
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

    expect(screen.getByText('1 contract')).toBeInTheDocument();
    expect(screen.getByText('1 line')).toBeInTheDocument();
    expect(screen.queryByText('No contract context')).toBeNull();
  });

  it('T100: AutomaticInvoices surfaces contract metadata missing warning copy for partially identified member metadata', async () => {
    const fullMember = createContractRow();
    const partialMember = {
      ...createContractRow(),
      contractName: null,
      contractLineName: null,
      attribution: { isComplete: false },
      executionIdentityKey: `${fullMember.executionIdentityKey}:partial-contract-metadata-warning`,
      selectorInput: {
        ...fullMember.selectorInput,
        executionWindow: {
          ...fullMember.selectorInput.executionWindow,
          periodKey: 'period:2025-06-08:2025-07-08',
          invoiceWindow: {
            ...fullMember.selectorInput.executionWindow.invoiceWindow,
            start: '2025-07-08',
            end: '2025-08-08',
          },
          servicePeriod: {
            ...fullMember.selectorInput.executionWindow.servicePeriod,
            start: '2025-06-08',
            end: '2025-07-08',
          },
        },
      },
    };

    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [
        buildInvoiceCandidate([fullMember, partialMember], { candidateKey: 'candidate-contract-metadata-t100' }),
      ],
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

    expect(
      screen.getByTestId('contract-metadata-warning-candidate-contract-metadata-t100'),
    ).toHaveTextContent('Assignment attribution metadata missing (1 obligation)');
  });

  it('T101: cadence-source rendering is exhaustive and unknown values render explicit unknown-state copy', async () => {
    const unknownCadenceRow = {
      ...createContractRow(),
      cadenceSource: 'legacy_contract_window' as any,
    };

    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [
        buildInvoiceCandidate([unknownCadenceRow], { candidateKey: 'candidate-cadence-unknown-t101' }),
      ],
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

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    const row = within(readyTable).getByText('Zenith Health').closest('tr');
    expect(row).toBeTruthy();
    expect(within(row!).getByText('Unknown cadence source (legacy_contract_window)')).toBeInTheDocument();
    expect(within(row!).queryByText('Client schedule')).toBeNull();
  });

  it('T032: AutomaticInvoices preview opens for a client-cadence row through the selector-input preview path', async () => {
    const clientRow = createClientRow();
    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [buildInvoiceCandidate([clientRow], { candidateKey: 'candidate-client-t032' })],
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

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    fireEvent.click(within(readyTable).getAllByRole('checkbox')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /Preview Selected/i }));

    await waitFor(() => {
      expect(previewInvoiceForSelectionInputMock).toHaveBeenCalledWith([
        expect.objectContaining({
          selectorInputs: [clientRow.selectorInput],
        }),
      ]);
      expect(screen.getByText('Client Details')).toBeInTheDocument();
    });
  });

  it('T033: AutomaticInvoices preview opens for a contract-cadence row through the selector-input preview path', async () => {
    const contractRow = createContractRow();
    previewInvoiceForSelectionInputMock.mockResolvedValueOnce({
      success: true,
      invoiceCount: 1,
      previews: [{
        previewGroupKey: 'candidate-contract-t033',
        selectorInputs: [contractRow.selectorInput],
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
      }],
    } as any);

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Zenith Health')).toBeInTheDocument();
    });

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    fireEvent.click(within(readyTable).getAllByRole('checkbox')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /Preview Selected/i }));

    await waitFor(() => {
      expect(previewInvoiceForSelectionInputMock).toHaveBeenCalledWith([
        expect.objectContaining({
          selectorInputs: [contractRow.selectorInput],
        }),
      ]);
      expect(screen.getByText('Client Details')).toBeInTheDocument();
    });
  });

  it('T034: AutomaticInvoices batch generate submits selector-input execution windows for unbridged contract-cadence rows', async () => {
    const contractRow = createContractRow();

    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [buildInvoiceCandidate([contractRow])],
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

    const readyTable = screen.getAllByTestId('automatic-invoices-table').at(-1)!;
    fireEvent.click(within(readyTable).getAllByRole('checkbox')[0]!);
    fireEvent.click(
      screen.getByRole('button', { name: /Generate Invoices for Selected Periods \(1\)/i }),
    );

    await waitFor(() => {
      expect(generateInvoicesAsRecurringBillingRunMock).toHaveBeenCalledWith({
        groupedTargets: [
          expect.objectContaining({
            selectorInputs: [contractRow.selectorInput],
          }),
        ],
      });
    });

    const [generateCall] = generateInvoicesAsRecurringBillingRunMock.mock.calls;
    expect(generateCall?.[0]?.groupedTargets?.[0]?.billingCycleId).toBeNull();
  });

  it('T027/T031/T035: mixed selection generates with execution-window targets and maps failures back to unbridged contract rows', async () => {
    const contractRow = createContractRow();
    const clientRow = createClientRow();

    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [
        buildInvoiceCandidate([contractRow]),
        buildInvoiceCandidate([clientRow]),
      ],
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
        groupedTargets: [
          expect.objectContaining({
            selectorInputs: [contractRow.selectorInput],
          }),
          expect.objectContaining({
            selectorInputs: [clientRow.selectorInput],
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
      invoiceCandidates: [buildInvoiceCandidate([contractRow])],
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
        invoiceCandidates: [buildInvoiceCandidate([createClientRow()])],
        materializationGaps: [],
        total: 2,
        page: 1,
        pageSize: 10,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        invoiceCandidates: [buildInvoiceCandidate([createContractRow()])],
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
      expect(getAvailableRecurringDueWorkMock).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
        dateRange: {
          from: undefined,
          to: expect.any(String),
        },
      });
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Generate Invoices for Selected Periods \(0\)/i }),
      ).toBeDisabled();
    });
  });

  it('T035/T036/T053/T058: recurring invoice history renders a contract-cadence row without a billing_cycle_id and shows service-period-backed reverse copy', async () => {
    getRecurringInvoiceHistoryPaginatedMock.mockResolvedValue({
      rows: [createInvoicedContractRow()],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('INV-2001')).toBeInTheDocument();
    });

    expect(screen.getByText('Recurring Invoice History')).toBeInTheDocument();
    expect(screen.queryByText('Already Invoiced')).toBeNull();
    expect(screen.getAllByText('Contract anniversary').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Service-period-backed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2025-03-08 to 2025-04-08').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2025-04-08 to 2025-05-08').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: /open menu/i }).at(-1)!);
    fireEvent.click(screen.getByText('Reverse Invoice'));

    await waitFor(() => {
      expect(screen.queryByText('Reverse Billing Cycle')).toBeNull();
      expect(screen.getByText(/without requiring client-cycle bridge metadata/i)).toBeInTheDocument();
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
    getRecurringInvoiceHistoryPaginatedMock.mockResolvedValue({
      rows: [createInvoicedClientRow()],
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
      expect(screen.getByText(/linked client cadence bridge record will also be deleted/i)).toBeInTheDocument();
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
