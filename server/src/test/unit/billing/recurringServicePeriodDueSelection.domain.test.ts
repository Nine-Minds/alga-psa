import { describe, expect, it } from 'vitest';

import { buildBillingCycleDueSelectionInput } from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import {
  buildRecurringServicePeriodDueSelectionQuery,
  selectDueRecurringServicePeriodRecords,
} from '@alga-psa/shared/billingClients/recurringServicePeriodDueSelection';
import {
  buildRecurringServicePeriodInvoiceLinkage,
  buildRecurringServicePeriodRecord,
} from '../../test-utils/recurringTimingFixtures';

describe('recurring service period due selection', () => {
  it('T344: persisted due-selection query contract filters eligible unlinked service-period records by schedule key, exact invoice window, and lifecycle state before runtime cutover', () => {
    const selectorInput = buildBillingCycleDueSelectionInput({
      clientId: 'client-1',
      billingCycleId: 'cycle-1',
      windowStart: '2025-02-01',
      windowEnd: '2025-03-01',
    });
    const dueRecord = buildRecurringServicePeriodRecord({
      scheduleKey: 'schedule:a',
      cadenceOwner: 'client',
      lifecycleState: 'generated',
      servicePeriod: { start: '2025-01-01', end: '2025-02-01', semantics: 'half_open' },
      invoiceWindow: { start: '2025-02-01', end: '2025-03-01', semantics: 'half_open' },
    });
    const editedRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp_02',
      scheduleKey: 'schedule:b',
      cadenceOwner: 'client',
      lifecycleState: 'edited',
      servicePeriod: { start: '2025-01-15', end: '2025-02-01', semantics: 'half_open' },
      invoiceWindow: { start: '2025-02-01', end: '2025-03-01', semantics: 'half_open' },
    });
    const lockedRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp_03',
      scheduleKey: 'schedule:a',
      cadenceOwner: 'client',
      lifecycleState: 'locked',
      servicePeriod: { start: '2025-01-20', end: '2025-02-01', semantics: 'half_open' },
      invoiceWindow: { start: '2025-02-01', end: '2025-03-01', semantics: 'half_open' },
    });

    const query = buildRecurringServicePeriodDueSelectionQuery({
      tenant: 'tenant-1',
      scheduleKeys: ['schedule:b', 'schedule:a', 'schedule:a'],
      selectorInput,
    });

    const selected = selectDueRecurringServicePeriodRecords([
      buildRecurringServicePeriodRecord({
        recordId: 'rsp_skip',
        scheduleKey: 'schedule:a',
        lifecycleState: 'skipped',
        invoiceWindow: { start: '2025-02-01', end: '2025-03-01', semantics: 'half_open' },
      }),
      buildRecurringServicePeriodRecord({
        recordId: 'rsp_billed',
        scheduleKey: 'schedule:a',
        lifecycleState: 'billed',
        invoiceWindow: { start: '2025-02-01', end: '2025-03-01', semantics: 'half_open' },
        invoiceLinkage: buildRecurringServicePeriodInvoiceLinkage(),
      }),
      buildRecurringServicePeriodRecord({
        recordId: 'rsp_other_window',
        scheduleKey: 'schedule:a',
        lifecycleState: 'generated',
        invoiceWindow: { start: '2025-03-01', end: '2025-04-01', semantics: 'half_open' },
      }),
      buildRecurringServicePeriodRecord({
        recordId: 'rsp_other_schedule',
        scheduleKey: 'schedule:other',
        lifecycleState: 'generated',
        invoiceWindow: { start: '2025-02-01', end: '2025-03-01', semantics: 'half_open' },
      }),
      dueRecord,
      editedRecord,
      lockedRecord,
    ], query);

    expect(query.scheduleKeys).toEqual(['schedule:a', 'schedule:b']);
    expect(query.lifecycleStates).toEqual(['generated', 'edited', 'locked']);
    expect(selected.map((record) => record.recordId)).toEqual([
      dueRecord.recordId,
      editedRecord.recordId,
      lockedRecord.recordId,
    ]);
  });

  it('filters by cadence owner and optional charge-family scope', () => {
    const selectorInput = {
      clientId: 'client-1',
      windowStart: '2025-03-08',
      windowEnd: '2025-04-08',
      executionWindow: {
        kind: 'contract_cadence_window' as const,
        identityKey: 'contract:window',
        cadenceOwner: 'contract' as const,
        clientId: 'client-1',
        contractLineId: 'line-1',
        windowStart: '2025-03-08',
        windowEnd: '2025-04-08',
      },
    };
    const contractProduct = buildRecurringServicePeriodRecord({
      recordId: 'rsp_contract_product',
      scheduleKey: 'schedule:contract',
      cadenceOwner: 'contract',
      sourceObligation: {
        tenant: 'tenant-1',
        obligationId: 'line-1',
        obligationType: 'contract_line',
        chargeFamily: 'product',
      },
      invoiceWindow: { start: '2025-03-08', end: '2025-04-08', semantics: 'half_open' },
    });
    const clientFixed = buildRecurringServicePeriodRecord({
      recordId: 'rsp_client_fixed',
      scheduleKey: 'schedule:contract',
      cadenceOwner: 'client',
      invoiceWindow: { start: '2025-03-08', end: '2025-04-08', semantics: 'half_open' },
    });

    const query = buildRecurringServicePeriodDueSelectionQuery({
      tenant: 'tenant-1',
      scheduleKeys: ['schedule:contract'],
      selectorInput,
      chargeFamilies: ['product'],
    });

    expect(selectDueRecurringServicePeriodRecords([contractProduct, clientFixed], query)).toEqual([
      contractProduct,
    ]);
  });
});
