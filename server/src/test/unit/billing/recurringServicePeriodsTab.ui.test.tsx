/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

(globalThis as unknown as { React?: typeof React }).React = React;

const mocks = vi.hoisted(() => ({
  getRecurringServicePeriodManagementView: vi.fn(),
  previewRecurringServicePeriodRegeneration: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/recurringServicePeriodActions', () => ({
  getRecurringServicePeriodManagementView: mocks.getRecurringServicePeriodManagementView,
  previewRecurringServicePeriodRegeneration: mocks.previewRecurringServicePeriodRegeneration,
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
  });

  it('T065: billing dashboard keeps the service-period management surface wired for recurring troubleshooting and repair', () => {
    const billingDashboardSource = readFileSync(
      resolve(__dirname, '../../../../../packages/billing/src/components/billing-dashboard/BillingDashboard.tsx'),
      'utf8',
    );
    const billingTabsSource = readFileSync(
      resolve(__dirname, '../../../../../packages/billing/src/components/billing-dashboard/billingTabsConfig.ts'),
      'utf8',
    );

    expect(billingDashboardSource).toContain("import RecurringServicePeriodsTab from './RecurringServicePeriodsTab';");
    expect(billingDashboardSource).toContain('<Tabs.Content value="service-periods">');
    expect(billingDashboardSource).toContain(
      '<RecurringServicePeriodsTab initialScheduleKey={searchParams?.get(\'scheduleKey\') ?? undefined} />',
    );
    expect(billingTabsSource).toContain("value: 'service-periods'");
    expect(billingTabsSource).toContain("href: '/msp/billing?tab=service-periods'");
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
});
