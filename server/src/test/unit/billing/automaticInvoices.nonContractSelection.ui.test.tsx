/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  buildServicePeriodRecurringDueWorkRow,
  buildRecurringDueWorkRow,
} from '@alga-psa/shared/billingClients/recurringDueWork';
import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';
import { buildClientCadenceDueSelectionInput } from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import * as billingAndTaxActions from '@alga-psa/billing/actions/billingAndTax';
import * as billingCycleActions from '@alga-psa/billing/actions/billingCycleActions';
import * as invoiceGenerationActions from '@alga-psa/billing/actions/invoiceGeneration';
import * as recurringBillingRunActions from '@alga-psa/billing/actions/recurringBillingRunActions';
import type { IRecurringDueWorkInvoiceCandidate } from '@alga-psa/types';

(globalThis as unknown as { React?: typeof React }).React = React;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

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
            <tr key={row.candidateKey ?? rowIndex}>
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
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: any) => <button type="button">{children}</button>,
  DropdownMenuSeparator: () => <div />,
}));

const { default: AutomaticInvoices } = await import(
  '../../../../../packages/billing/src/components/billing-dashboard/AutomaticInvoices'
);

function createContractMember() {
  return buildServicePeriodRecurringDueWorkRow({
    clientId: 'client-1',
    clientName: 'Acme Co',
    contractId: 'contract-1',
    contractLineId: 'line-1',
    contractName: 'Acme Support',
    contractLineName: 'Managed Services',
    attribution: {
      source: 'explicit_contract',
      label: 'Explicit contract',
      isComplete: true,
      missingFields: [],
    },
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
        start: '2025-03-01',
        end: '2025-04-01',
        semantics: 'half_open',
      },
      servicePeriod: {
        start: '2025-02-01',
        end: '2025-03-01',
        semantics: 'half_open',
      },
    }),
  });
}

function createNonContractMember() {
  return buildRecurringDueWorkRow({
    selectorInput: buildClientCadenceDueSelectionInput({
      clientId: 'client-1',
      scheduleKey: 'schedule:tenant-1:unresolved:usage:usage-1',
      periodKey: 'period:2025-03-01:2025-04-01:unresolved:usage:usage-1',
      windowStart: '2025-03-01',
      windowEnd: '2025-04-01',
    }),
    cadenceSource: 'client_schedule',
    servicePeriodStart: '2025-03-01',
    servicePeriodEnd: '2025-04-01',
    clientName: 'Acme Co',
    scheduleKey: 'schedule:tenant-1:unresolved:usage:usage-1',
    periodKey: 'period:2025-03-01:2025-04-01:unresolved:usage:usage-1',
    recordId: 'unresolved:usage:usage-1',
    contractName: null,
    contractLineName: 'Unresolved usage record',
    currencyCode: 'USD',
    taxSource: 'internal',
    attribution: {
      source: 'unresolved',
      label: 'Unresolved work',
      isComplete: true,
      missingFields: [],
    },
  });
}

function createSystemManagedDefaultMember() {
  return buildServicePeriodRecurringDueWorkRow({
    clientId: 'client-1',
    clientName: 'Acme Co',
    contractId: 'contract-default',
    contractLineId: 'line-default',
    contractName: 'System-managed default contract',
    contractLineName: 'Default billing line',
    attribution: {
      source: 'system_managed_default_contract',
      label: 'System-managed default contract',
      isComplete: true,
      missingFields: [],
    },
    record: buildRecurringServicePeriodRecord({
      cadenceOwner: 'contract',
      duePosition: 'arrears',
      sourceObligation: {
        tenant: 'tenant-1',
        obligationId: 'line-default',
        obligationType: 'contract_line',
        chargeFamily: 'fixed',
      },
      invoiceWindow: {
        start: '2025-03-01',
        end: '2025-04-01',
        semantics: 'half_open',
      },
      servicePeriod: {
        start: '2025-02-01',
        end: '2025-03-01',
        semantics: 'half_open',
      },
    }),
  });
}

function buildCandidate(members: any[]): IRecurringDueWorkInvoiceCandidate {
  return {
    candidateKey: 'candidate-mixed-1',
    clientId: 'client-1',
    clientName: 'Acme Co',
    windowStart: '2025-03-01',
    windowEnd: '2025-04-01',
    windowLabel: '2025-03-01 to 2025-04-01',
    servicePeriodStart: '2025-02-01',
    servicePeriodEnd: '2025-04-01',
    servicePeriodLabel: '2025-02-01 to 2025-04-01',
    cadenceOwners: ['client', 'contract'],
    cadenceSources: ['client_schedule', 'contract_anniversary'],
    contractId: 'contract-1',
    contractName: 'Acme Support',
    purchaseOrderScopeKey: null,
    currencyCode: 'USD',
    taxSource: 'internal',
    exportShapeKey: null,
    splitReasons: [],
    memberCount: members.length,
    canGenerate: true,
    blockedReason: null,
    members,
  };
}

const cloneMember = (
  member: IRecurringDueWorkInvoiceCandidate['members'][number],
  overrides: Partial<IRecurringDueWorkInvoiceCandidate['members'][number]>,
): IRecurringDueWorkInvoiceCandidate['members'][number] => ({
  ...member,
  ...overrides,
  selectorInput: {
    ...member.selectorInput,
    ...overrides.selectorInput,
    executionWindow: {
      ...member.selectorInput.executionWindow,
      ...(overrides.selectorInput?.executionWindow ?? {}),
    },
  },
});

describe('AutomaticInvoices non-contract selection UI', () => {
  const getAvailableRecurringDueWorkMock = vi.spyOn(billingAndTaxActions, 'getAvailableRecurringDueWork');
  const getRecurringInvoiceHistoryPaginatedMock = vi.spyOn(billingCycleActions, 'getRecurringInvoiceHistoryPaginated');
  const previewGroupedInvoicesForSelectionInputsMock = vi.spyOn(
    invoiceGenerationActions,
    'previewGroupedInvoicesForSelectionInputs',
  );
  const getPurchaseOrderOverageForSelectionInputMock = vi.spyOn(
    invoiceGenerationActions,
    'getPurchaseOrderOverageForSelectionInput',
  );
  const generateGroupedInvoicesAsRecurringBillingRunMock = vi.spyOn(
    recurringBillingRunActions,
    'generateGroupedInvoicesAsRecurringBillingRun',
  );

  const contractMember = createContractMember();
  const nonContractMember = createNonContractMember();
  const defaultContractMember = createSystemManagedDefaultMember();

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();

    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [buildCandidate([contractMember, nonContractMember])],
      materializationGaps: [],
      total: 1,
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
    previewGroupedInvoicesForSelectionInputsMock.mockResolvedValue({
      success: true,
      invoiceCount: 2,
      previews: [
        {
          previewGroupKey: 'group-1',
          selectorInputs: [contractMember.selectorInput],
          data: {
            invoiceNumber: 'INV-PREVIEW-1',
            issueDate: '2025-04-01',
            dueDate: '2025-04-15',
            currencyCode: 'USD',
            customer: { name: 'Acme Co', address: '100 Main St' },
            tenantClient: { name: 'Tenant', address: '500 Billing Ave', logoUrl: null },
            items: [],
            subtotal: 0,
            tax: 0,
            total: 0,
          } as any,
        },
      ],
    });
    getPurchaseOrderOverageForSelectionInputMock.mockResolvedValue(null);
    generateGroupedInvoicesAsRecurringBillingRunMock.mockResolvedValue({
      runId: 'run-1',
      selectionKey: 'selection-1',
      retryKey: 'retry-1',
      invoicesCreated: 1,
      failedCount: 0,
      failures: [],
    });
  });

  it('T043: renders non-contract candidates as first-class child rows', async () => {
    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [buildCandidate([nonContractMember])],
      materializationGaps: [],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await screen.findByText('Acme Co');
    fireEvent.click(screen.getByLabelText('Expand'));

    await waitFor(() => {
      expect(
        screen.getByTestId(`non-contract-child-${nonContractMember.executionIdentityKey}`),
      ).toHaveTextContent('Unresolved work');
    });
  });

  it('T009: grouped rows expose business-safe attribution labels and block generation when attribution metadata is missing', async () => {
    const defaultAttributionOnlyMember = cloneMember(defaultContractMember, {
      executionIdentityKey: 'default-contract-attribution-only',
      contractName: null,
      contractLineName: null,
      attribution: {
        source: 'system_managed_default_contract',
        label: 'System-managed default contract',
        isComplete: true,
        missingFields: [],
      },
    } as any);
    const metadataGapMember = cloneMember(defaultContractMember, {
      executionIdentityKey: 'default-contract-metadata-gap',
      contractName: null,
      contractLineName: null,
      canGenerate: false,
      blockedReason: 'Contract attribution metadata is incomplete for one or more obligations. Review assignment data before generation.',
      attribution: {
        source: 'system_managed_default_contract',
        label: 'System-managed default contract',
        isComplete: false,
        missingFields: ['contractLineName'],
      },
    } as any);

    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [
        buildCandidate([defaultAttributionOnlyMember, nonContractMember, metadataGapMember]),
      ],
      materializationGaps: [],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await screen.findByText('Acme Co');
    fireEvent.click(screen.getByLabelText('Expand'));
    expect(screen.getAllByText('System-managed default contract').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unresolved work').length).toBeGreaterThan(0);

    expect(
      screen.getByTestId('contract-metadata-warning-candidate-mixed-1'),
    ).toHaveTextContent('Assignment attribution metadata missing (1 obligation)');

    const generateButton = screen.getByRole('button', { name: /Generate Invoices for Selected Periods/i });
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(generateGroupedInvoicesAsRecurringBillingRunMock).not.toHaveBeenCalledWith(
        expect.objectContaining({
          groupedTargets: expect.arrayContaining([
            expect.objectContaining({
              selectorInputs: expect.arrayContaining([metadataGapMember.selectorInput]),
            }),
          ]),
        }),
      );
    });
  });

  it('T044: selecting only contract-backed child generates contract-only invoice target', async () => {
    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await screen.findByText('Acme Co');
    fireEvent.click(screen.getByLabelText('Expand'));

    const parentGroupKey = 'parent-group:client-1:2025-03-01:2025-04-01';
    const contractChildCheckbox = document.getElementById(
      `select-child-${parentGroupKey}-${contractMember.executionIdentityKey}`,
    ) as HTMLInputElement;
    fireEvent.click(contractChildCheckbox);
    fireEvent.click(screen.getByRole('button', { name: /Generate Invoices for Selected Periods/i }));

    await waitFor(() => {
      expect(generateGroupedInvoicesAsRecurringBillingRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          groupedTargets: [
            {
              groupKey: `child-selection:${contractMember.executionIdentityKey}`,
              selectorInputs: [contractMember.selectorInput],
            },
          ],
        }),
      );
    });
  });

  it('T045: selecting only non-contract child generates non-contract-only invoice target', async () => {
    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await screen.findByText('Acme Co');
    fireEvent.click(screen.getByLabelText('Expand'));

    const parentGroupKey = 'parent-group:client-1:2025-03-01:2025-04-01';
    const nonContractChildCheckbox = document.getElementById(
      `select-child-${parentGroupKey}-${nonContractMember.executionIdentityKey}`,
    ) as HTMLInputElement;
    fireEvent.click(nonContractChildCheckbox);
    fireEvent.click(screen.getByRole('button', { name: /Generate Invoices for Selected Periods/i }));

    await waitFor(() => {
      expect(generateGroupedInvoicesAsRecurringBillingRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          groupedTargets: [
            {
              groupKey: `child-selection:${nonContractMember.executionIdentityKey}`,
              selectorInputs: [nonContractMember.selectorInput],
            },
          ],
        }),
      );
    });
  });

  it('T049: preview summary states multi-invoice outcome explicitly for mixed selections', async () => {
    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    await screen.findByText('Acme Co');
    const parentCheckbox = document.getElementById('select-parent-group:client-1:2025-03-01:2025-04-01') as HTMLInputElement;
    fireEvent.click(parentCheckbox);
    fireEvent.click(screen.getByRole('button', { name: /Preview Selected/i }));

    const summary = await screen.findByTestId('preview-invoice-count-summary');
    expect(within(summary).getByText('This selection will generate 2 separate invoices.')).toBeInTheDocument();
  });

  it('T011: mixed compatibility rules combine only compatible selections and split incompatible selections', async () => {
    const compatibleContractMember = cloneMember(contractMember, {
      executionIdentityKey: 'contract-compatible-1',
      currencyCode: 'USD',
      taxSource: 'internal',
      exportShapeKey: 'export-default',
      purchaseOrderScopeKey: 'po-default',
      selectorInput: {
        executionWindow: {
          identityKey: 'contract_cadence_window:contract:client-1:contract-1:line-compatible-1:2025-03-01:2025-04-01',
        } as any,
      } as any,
    });
    const compatibleNonContractMember = cloneMember(nonContractMember, {
      executionIdentityKey: 'non-contract-compatible-1',
      currencyCode: 'USD',
      taxSource: 'internal',
      exportShapeKey: 'export-default',
      purchaseOrderScopeKey: 'po-default',
      selectorInput: {
        executionWindow: {
          identityKey: 'client_cadence_window:client:client-1:schedule-compatible-1:period-compatible-1:2025-03-01:2025-04-01',
        } as any,
      } as any,
    });
    const incompatibleNonContractMember = cloneMember(nonContractMember, {
      executionIdentityKey: 'non-contract-incompatible-1',
      currencyCode: 'EUR',
      taxSource: 'internal',
      exportShapeKey: 'export-default',
      purchaseOrderScopeKey: 'po-default',
      selectorInput: {
        executionWindow: {
          identityKey: 'client_cadence_window:client:client-1:schedule-incompatible-1:period-incompatible-1:2025-04-01:2025-05-01',
        } as any,
      } as any,
      windowStart: '2025-04-01',
      windowEnd: '2025-05-01',
    });

    getAvailableRecurringDueWorkMock.mockResolvedValue({
      invoiceCandidates: [
        buildCandidate([compatibleContractMember, compatibleNonContractMember]),
        {
          ...buildCandidate([compatibleContractMember, incompatibleNonContractMember]),
          candidateKey: 'candidate-mixed-2',
          windowStart: '2025-04-01',
          windowEnd: '2025-05-01',
          windowLabel: '2025-04-01 to 2025-05-01',
          servicePeriodStart: '2025-03-01',
          servicePeriodEnd: '2025-05-01',
          servicePeriodLabel: '2025-03-01 to 2025-05-01',
          purchaseOrderScopeKey: 'po-default',
          currencyCode: 'EUR',
          taxSource: 'internal',
          exportShapeKey: 'export-default',
        },
      ],
      materializationGaps: [],
      total: 2,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    render(<AutomaticInvoices onGenerateSuccess={vi.fn()} />);

    const clientRows = await screen.findAllByText('Acme Co');
    expect(clientRows.length).toBeGreaterThanOrEqual(2);
    const expandButtons = screen.getAllByLabelText('Expand');
    fireEvent.click(expandButtons[0]);
    fireEvent.click(expandButtons[1]);

    const compatibleParentCheckbox = document.getElementById(
      'select-parent-group:client-1:2025-03-01:2025-04-01',
    ) as HTMLInputElement;
    const incompatibleParentCheckbox = document.getElementById(
      'select-parent-group:client-1:2025-04-01:2025-05-01',
    ) as HTMLInputElement;
    expect(compatibleParentCheckbox.disabled).toBe(false);
    expect(incompatibleParentCheckbox.disabled).toBe(true);

    const reasons = await screen.findAllByText(/Currency differs/);
    expect(reasons.length).toBeGreaterThan(0);

    const parentGroupKey = 'parent-group:client-1:2025-04-01:2025-05-01';
    const incompatibleChildCheckbox = document.getElementById(
      `select-child-${parentGroupKey}-${incompatibleNonContractMember.executionIdentityKey}`,
    ) as HTMLInputElement;
    fireEvent.click(compatibleParentCheckbox);
    fireEvent.click(incompatibleChildCheckbox);
    fireEvent.click(screen.getByRole('button', { name: /Generate Invoices for Selected Periods/i }));

    await waitFor(() => {
      expect(generateGroupedInvoicesAsRecurringBillingRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          groupedTargets: expect.arrayContaining([
            {
              groupKey: 'parent-selection:candidate-mixed-1',
              selectorInputs: [
                compatibleContractMember.selectorInput,
                compatibleNonContractMember.selectorInput,
              ],
            },
            {
              groupKey: `child-selection:${incompatibleNonContractMember.executionIdentityKey}`,
              selectorInputs: [incompatibleNonContractMember.selectorInput],
            },
          ]),
        }),
      );
    });
  });
});
