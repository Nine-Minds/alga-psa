/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

(globalThis as unknown as { React?: typeof React }).React = React;

const mocks = vi.hoisted(() => ({
  getRecurringServicePeriodManagementView: vi.fn(),
  listRecurringServicePeriodScheduleSummaries: vi.fn(),
  previewRecurringServicePeriodRegeneration: vi.fn(),
  repairMissingRecurringServicePeriods: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/recurringServicePeriodActions', () => ({
  getRecurringServicePeriodManagementView: mocks.getRecurringServicePeriodManagementView,
  listRecurringServicePeriodScheduleSummaries: mocks.listRecurringServicePeriodScheduleSummaries,
  previewRecurringServicePeriodRegeneration: mocks.previewRecurringServicePeriodRegeneration,
  repairMissingRecurringServicePeriods: mocks.repairMissingRecurringServicePeriods,
}));

const { default: RecurringServicePeriodsTab } = await import(
  '../../../../../packages/billing/src/components/billing-dashboard/RecurringServicePeriodsTab'
);

describe('RecurringServicePeriodsTab UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const generatedRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp-generated',
      scheduleKey: 'schedule:tenant-1:contract_line:line-1:contract:arrears',
      lifecycleState: 'generated',
      servicePeriod: {
        start: '2026-04-01',
        end: '2026-05-01',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-05-01',
        end: '2026-06-01',
        semantics: 'half_open',
      },
    });

    const editedRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp-edited',
      scheduleKey: generatedRecord.scheduleKey,
      lifecycleState: 'edited',
      provenance: {
        kind: 'user_edited',
        reasonCode: 'boundary_adjustment',
        sourceRuleVersion: 'line-1:v2',
        sourceRunKey: 'edit-1',
        supersedesRecordId: 'rsp-generated',
      },
      servicePeriod: {
        start: '2026-05-01',
        end: '2026-06-03',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-06-03',
        end: '2026-07-03',
        semantics: 'half_open',
      },
    });

    const billedRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp-billed',
      scheduleKey: generatedRecord.scheduleKey,
      lifecycleState: 'billed',
      invoiceLinkage: {
        invoiceId: 'invoice-1',
        invoiceChargeId: 'charge-1',
        invoiceChargeDetailId: 'detail-1',
        linkedAt: '2026-03-18T20:00:00.000Z',
      },
      servicePeriod: {
        start: '2026-03-01',
        end: '2026-04-01',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-04-01',
        end: '2026-05-01',
        semantics: 'half_open',
      },
    });

    mocks.getRecurringServicePeriodManagementView.mockResolvedValue({
      scheduleKey: generatedRecord.scheduleKey,
      obligationId: 'line-1',
      obligationType: 'contract_line',
      cadenceOwner: 'contract',
      duePosition: 'arrears',
      chargeFamily: 'fixed',
      clientId: 'client-1',
      clientName: 'Zenith Health',
      contractId: 'contract-1',
      contractName: 'Zenith Annual Support',
      contractLineId: 'line-1',
      contractLineName: 'Managed Services',
      status: 'ready',
      summary: {
        totalRows: 3,
        exceptionRows: 1,
        generatedRows: 1,
        editedRows: 1,
        skippedRows: 0,
        lockedRows: 0,
        billedRows: 1,
        supersededRows: 0,
        archivedRows: 0,
      },
      rows: [
        {
          record: billedRecord,
          displayState: {
            lifecycleState: 'billed',
            label: 'Billed',
            tone: 'success',
            detail: 'Linked to invoice detail detail-1.',
            reasonLabel: 'Generated from source cadence',
          },
          governance: [],
          clientId: 'client-1',
          clientName: 'Zenith Health',
          contractId: 'contract-1',
          contractName: 'Zenith Annual Support',
          contractLineId: 'line-1',
          contractLineName: 'Managed Services',
        },
        {
          record: generatedRecord,
          displayState: {
            lifecycleState: 'generated',
            label: 'Generated',
            tone: 'neutral',
            detail: 'Matches the current cadence rules and is awaiting billing or review.',
            reasonLabel: 'Generated from source cadence',
          },
          governance: [],
          clientId: 'client-1',
          clientName: 'Zenith Health',
          contractId: 'contract-1',
          contractName: 'Zenith Annual Support',
          contractLineId: 'line-1',
          contractLineName: 'Managed Services',
        },
        {
          record: editedRecord,
          displayState: {
            lifecycleState: 'edited',
            label: 'Edited',
            tone: 'accent',
            detail: 'A later revision changed the generated schedule and remains active.',
            reasonLabel: 'Boundary adjusted',
          },
          governance: [],
          clientId: 'client-1',
          clientName: 'Zenith Health',
          contractId: 'contract-1',
          contractName: 'Zenith Annual Support',
          contractLineId: 'line-1',
          contractLineName: 'Managed Services',
        },
      ],
    });
    mocks.previewRecurringServicePeriodRegeneration.mockResolvedValue({
      activeRecords: [],
      preservedRecords: [],
      regeneratedRecords: [],
      supersededRecords: [],
      newRecords: [],
      conflicts: [],
    });
    mocks.listRecurringServicePeriodScheduleSummaries.mockResolvedValue([]);
    mocks.repairMissingRecurringServicePeriods.mockResolvedValue({
      scheduleKey: generatedRecord.scheduleKey,
      repairedAt: '2026-03-18T20:10:00.000Z',
      historicalBoundaryEnd: null,
      skippedHistoricalCandidates: 0,
      backfilledRows: 2,
      realignedRows: 0,
      supersededRows: 0,
      activeRows: 2,
    });
  });

  it('T065: billing dashboard keeps the service-period management surface wired for recurring troubleshooting and repair', () => {
    const { billingTabDefinitions } = require(
      `${process.cwd()}/../packages/billing/src/components/billing-dashboard/billingTabsConfig.ts`
    );

    expect(billingTabDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 'service-periods',
          href: '/msp/billing?tab=service-periods',
          label: 'Service Periods',
        }),
      ]),
    );
  });

  it('T080: service-period management surface can show future generated rows, edited rows, and billed rows for one recurring obligation', async () => {
    render(
      <RecurringServicePeriodsTab
        initialScheduleKey="schedule:tenant-1:contract_line:line-1:contract:arrears"
      />,
    );

    await waitFor(() => {
      expect(mocks.getRecurringServicePeriodManagementView).toHaveBeenCalledWith(
        'schedule:tenant-1:contract_line:line-1:contract:arrears',
      );
    });

    const table = screen.getByTestId('recurring-service-periods-table');

    expect(screen.getByText('Zenith Annual Support / Managed Services')).toBeInTheDocument();
    expect(within(table).getByText('Generated')).toBeInTheDocument();
    expect(within(table).getByText('Edited')).toBeInTheDocument();
    expect(within(table).getByText('Billed')).toBeInTheDocument();
    expect(within(table).getAllByText('2026-04-01 to 2026-05-01')).toHaveLength(2);
    expect(within(table).getByText('2026-05-01 to 2026-06-03')).toBeInTheDocument();
    expect(within(table).getByText('2026-03-01 to 2026-04-01')).toBeInTheDocument();
    expect(within(table).getByText('Boundary adjusted')).toBeInTheDocument();
    expect(within(table).getByText('Linked to invoice detail detail-1.')).toBeInTheDocument();
  });

  it('T305: zero-row schedules render a repair flow, re-materialize rows, and then show the schedule table', async () => {
    const repairedRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp-repaired',
      scheduleKey: 'schedule:tenant-1:client_contract_line:line-1:client:advance',
      sourceObligation: {
        tenant: 'tenant-1',
        obligationId: 'line-1',
        obligationType: 'client_contract_line',
        chargeFamily: 'fixed',
      },
      cadenceOwner: 'client',
      duePosition: 'advance',
      servicePeriod: {
        start: '2026-04-01',
        end: '2026-05-01',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-04-01',
        end: '2026-05-01',
        semantics: 'half_open',
      },
    });

    mocks.getRecurringServicePeriodManagementView
      .mockResolvedValueOnce({
        scheduleKey: repairedRecord.scheduleKey,
        obligationId: 'line-1',
        obligationType: 'client_contract_line',
        cadenceOwner: 'client',
        duePosition: 'advance',
        chargeFamily: 'fixed',
        clientId: 'client-1',
        clientName: 'Zenith Health',
        contractId: 'contract-1',
        contractName: 'Zenith Annual Support',
        contractLineId: 'line-1',
        contractLineName: 'Managed Services',
        status: 'repair_required',
        summary: {
          totalRows: 0,
          exceptionRows: 0,
          generatedRows: 0,
          editedRows: 0,
          skippedRows: 0,
          lockedRows: 0,
          billedRows: 0,
          supersededRows: 0,
          archivedRows: 0,
        },
        rows: [],
      })
      .mockResolvedValueOnce({
        scheduleKey: repairedRecord.scheduleKey,
        obligationId: 'line-1',
        obligationType: 'client_contract_line',
        cadenceOwner: 'client',
        duePosition: 'advance',
        chargeFamily: 'fixed',
        clientId: 'client-1',
        clientName: 'Zenith Health',
        contractId: 'contract-1',
        contractName: 'Zenith Annual Support',
        contractLineId: 'line-1',
        contractLineName: 'Managed Services',
        status: 'ready',
        summary: {
          totalRows: 1,
          exceptionRows: 0,
          generatedRows: 1,
          editedRows: 0,
          skippedRows: 0,
          lockedRows: 0,
          billedRows: 0,
          supersededRows: 0,
          archivedRows: 0,
        },
        rows: [
          {
            record: repairedRecord,
            displayState: {
              lifecycleState: 'generated',
              label: 'Generated',
              tone: 'neutral',
              detail: 'Matches the current cadence rules and is awaiting billing or review.',
              reasonLabel: 'Generated from source cadence',
            },
            governance: [],
            clientId: 'client-1',
            clientName: 'Zenith Health',
            contractId: 'contract-1',
            contractName: 'Zenith Annual Support',
            contractLineId: 'line-1',
            contractLineName: 'Managed Services',
          },
        ],
      });

    render(
      <RecurringServicePeriodsTab
        initialScheduleKey="schedule:tenant-1:client_contract_line:line-1:client:advance"
      />,
    );

    const repairState = await screen.findByTestId('recurring-service-period-repair-state');
    expect(within(repairState).getByText('Missing persisted service periods')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Repair Missing Service Periods' }));

    await waitFor(() => {
      expect(mocks.repairMissingRecurringServicePeriods).toHaveBeenCalledWith(
        'schedule:tenant-1:client_contract_line:line-1:client:advance',
      );
    });

    await waitFor(() => {
      expect(mocks.getRecurringServicePeriodManagementView).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByTestId('repair-result')).toHaveTextContent(
      'Backfilled 2 rows, realigned 0, skipped 0 historical candidates, and left 2 active rows on this schedule.',
    );

    const table = await screen.findByTestId('recurring-service-periods-table');
    expect(within(table).getByText('Generated')).toBeInTheDocument();
    expect(within(table).getAllByText('2026-04-01 to 2026-05-01')).toHaveLength(2);
  });
});
