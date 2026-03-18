import { describe, expect, it } from 'vitest';

import { compareDerivedRecurringTimingToPersistedSchedule } from '@alga-psa/shared/billingClients/recurringServicePeriodParity';
import { buildRecurringInvoiceWindow, buildRecurringServicePeriod, buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

describe('recurring service period parity comparison', () => {
  it('T293: parity comparison surfaces differences between legacy derived timing and persisted service-period schedules before cutover', () => {
    const sourceObligation = {
      obligationId: 'line-1',
      obligationType: 'contract_line' as const,
      chargeFamily: 'fixed' as const,
    };
    const derivedSelections = [
      {
        servicePeriod: buildRecurringServicePeriod({
          cadenceOwner: 'client',
          duePosition: 'arrears',
          sourceObligation,
          start: '2025-01-01',
          end: '2025-02-01',
        }),
        invoiceWindow: buildRecurringInvoiceWindow({
          cadenceOwner: 'client',
          duePosition: 'arrears',
          start: '2025-02-01',
          end: '2025-03-01',
        }),
      },
      {
        servicePeriod: buildRecurringServicePeriod({
          cadenceOwner: 'client',
          duePosition: 'arrears',
          sourceObligation: {
            obligationId: 'line-2',
            obligationType: 'contract_line',
            chargeFamily: 'fixed',
          },
          start: '2025-01-15',
          end: '2025-02-15',
        }),
        invoiceWindow: buildRecurringInvoiceWindow({
          cadenceOwner: 'client',
          duePosition: 'arrears',
          start: '2025-02-15',
          end: '2025-03-15',
        }),
      },
    ];

    const comparison = compareDerivedRecurringTimingToPersistedSchedule({
      tenant: 'tenant-1',
      derivedSelections,
      persistedRecords: [
        buildRecurringServicePeriodRecord({
          scheduleKey: 'schedule:tenant-1:contract_line:line-1:client:arrears',
          periodKey: 'period:2025-01-01:2025-02-01',
          cadenceOwner: 'client',
          duePosition: 'arrears',
          sourceObligation: {
            tenant: 'tenant-1',
            obligationId: 'line-1',
            obligationType: 'contract_line',
            chargeFamily: 'fixed',
          },
          servicePeriod: { start: '2025-01-01', end: '2025-02-01', semantics: 'half_open' },
          invoiceWindow: { start: '2025-02-02', end: '2025-03-02', semantics: 'half_open' },
        }),
        buildRecurringServicePeriodRecord({
          recordId: 'rsp_extra',
          scheduleKey: 'schedule:tenant-1:contract_line:line-3:client:arrears',
          periodKey: 'period:2025-02-01:2025-03-01',
          cadenceOwner: 'client',
          duePosition: 'arrears',
          sourceObligation: {
            tenant: 'tenant-1',
            obligationId: 'line-3',
            obligationType: 'contract_line',
            chargeFamily: 'fixed',
          },
          servicePeriod: { start: '2025-02-01', end: '2025-03-01', semantics: 'half_open' },
          invoiceWindow: { start: '2025-03-01', end: '2025-04-01', semantics: 'half_open' },
        }),
      ],
    });

    expect(comparison.matches).toBe(false);
    expect(comparison.drifts).toEqual([
      expect.objectContaining({
        kind: 'invoice_window_mismatch',
        scheduleKey: 'schedule:tenant-1:contract_line:line-1:client:arrears',
        periodKey: 'period:2025-01-01:2025-02-01',
        derivedInvoiceWindowStart: '2025-02-01',
        persistedInvoiceWindowStart: '2025-02-02',
      }),
      expect.objectContaining({
        kind: 'missing_persisted_period',
        scheduleKey: 'schedule:tenant-1:contract_line:line-2:client:arrears',
        periodKey: 'period:2025-01-15:2025-02-15',
      }),
      expect.objectContaining({
        kind: 'unexpected_persisted_period',
        scheduleKey: 'schedule:tenant-1:contract_line:line-3:client:arrears',
        periodKey: 'period:2025-02-01:2025-03-01',
      }),
    ]);
  });
});
