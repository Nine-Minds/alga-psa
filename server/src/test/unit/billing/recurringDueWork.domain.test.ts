import { describe, expect, it } from 'vitest';

import {
  buildClientScheduleDueWorkRow,
  mergeRecurringDueWorkRows,
  buildServicePeriodRecurringDueWorkRow,
} from '@alga-psa/shared/billingClients/recurringDueWork';
import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

describe('recurring due-work row builder', () => {
  it('T001: returns stable execution identity for a client-cadence billing-cycle-backed recurring row', () => {
    const row = buildClientScheduleDueWorkRow({
      clientId: 'client-1',
      clientName: 'Acme Co',
      billingCycleId: 'cycle-2025-02',
      servicePeriodStart: '2025-02-01',
      servicePeriodEnd: '2025-03-01',
    });

    expect(row).toMatchObject({
      rowKey: 'recurring-due-row:billing_cycle_window:client:client-1:cycle-2025-02:2025-02-01:2025-03-01',
      executionIdentityKey: 'billing_cycle_window:client:client-1:cycle-2025-02:2025-02-01:2025-03-01',
      selectionKey: 'recurring-run-selection:billing_cycle_window:client:client-1:cycle-2025-02:2025-02-01:2025-03-01',
      retryKey: 'recurring-run-retry:billing_cycle_window:client:client-1:cycle-2025-02:2025-02-01:2025-03-01',
      cadenceOwner: 'client',
      cadenceSource: 'client_schedule',
      executionWindowKind: 'billing_cycle_window',
      billingCycleId: 'cycle-2025-02',
      hasBillingCycleBridge: true,
    });
    expect(row.selectorInput.executionWindow.identityKey).toBe(row.executionIdentityKey);
  });

  it('T002: returns stable execution identity for a contract-cadence recurring service-period row with no billing-cycle bridge', () => {
    const row = buildServicePeriodRecurringDueWorkRow({
      clientId: 'client-1',
      clientName: 'Acme Co',
      contractId: 'contract-1',
      contractLineId: 'line-1',
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
          start: '2025-03-08',
          end: '2025-04-08',
          semantics: 'half_open',
        },
        servicePeriod: {
          start: '2025-02-08',
          end: '2025-03-08',
          semantics: 'half_open',
        },
      }),
    });

    expect(row).toMatchObject({
      rowKey: 'recurring-due-row:contract_cadence_window:contract:client-1:contract-1:line-1:2025-03-08:2025-04-08',
      executionIdentityKey: 'contract_cadence_window:contract:client-1:contract-1:line-1:2025-03-08:2025-04-08',
      selectionKey: 'recurring-run-selection:contract_cadence_window:contract:client-1:contract-1:line-1:2025-03-08:2025-04-08',
      retryKey: 'recurring-run-retry:contract_cadence_window:contract:client-1:contract-1:line-1:2025-03-08:2025-04-08',
      cadenceOwner: 'contract',
      cadenceSource: 'contract_anniversary',
      executionWindowKind: 'contract_cadence_window',
      billingCycleId: null,
      hasBillingCycleBridge: false,
    });
    expect(row.selectorInput.executionWindow.identityKey).toBe(row.executionIdentityKey);
  });

  it('T003: exposes cadence-source metadata, service-period labels, and invoice-window labels for client-cadence rows', () => {
    const row = buildClientScheduleDueWorkRow({
      clientId: 'client-1',
      clientName: 'Acme Co',
      billingCycleId: 'cycle-2025-02',
      servicePeriodStart: '2025-02-01',
      servicePeriodEnd: '2025-03-01',
      invoiceWindowStart: '2025-02-01',
      invoiceWindowEnd: '2025-03-01',
    });

    expect(row.cadenceSource).toBe('client_schedule');
    expect(row.servicePeriodLabel).toBe('2025-02-01 to 2025-03-01');
    expect(row.invoiceWindowLabel).toBe('2025-02-01 to 2025-03-01');
  });

  it('T004: exposes cadence-source metadata, service-period labels, and invoice-window labels for contract-cadence rows', () => {
    const row = buildServicePeriodRecurringDueWorkRow({
      clientId: 'client-1',
      clientName: 'Acme Co',
      contractId: 'contract-1',
      contractLineId: 'line-1',
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
          start: '2025-03-08',
          end: '2025-04-08',
          semantics: 'half_open',
        },
        servicePeriod: {
          start: '2025-02-08',
          end: '2025-03-08',
          semantics: 'half_open',
        },
      }),
    });

    expect(row.cadenceSource).toBe('contract_anniversary');
    expect(row.servicePeriodLabel).toBe('2025-02-08 to 2025-03-08');
    expect(row.invoiceWindowLabel).toBe('2025-03-08 to 2025-04-08');
  });

  it('T005: includes contract and contract-line context for contract-cadence recurring windows', () => {
    const row = buildServicePeriodRecurringDueWorkRow({
      clientId: 'client-1',
      clientName: 'Acme Co',
      contractId: 'contract-1',
      contractLineId: 'line-1',
      contractName: 'Main Support Agreement',
      contractLineName: 'Managed Services',
      record: buildRecurringServicePeriodRecord({
        cadenceOwner: 'contract',
        sourceObligation: {
          tenant: 'tenant-1',
          obligationId: 'line-1',
          obligationType: 'contract_line',
          chargeFamily: 'fixed',
        },
      }),
    });

    expect(row.contractId).toBe('contract-1');
    expect(row.contractLineId).toBe('line-1');
    expect(row.contractName).toBe('Main Support Agreement');
    expect(row.contractLineName).toBe('Managed Services');
  });

  it('T008: includes a compatibility client-cadence row when no persisted recurring service-period row exists yet', () => {
    const compatibilityRow = buildClientScheduleDueWorkRow({
      clientId: 'client-1',
      clientName: 'Acme Co',
      billingCycleId: 'cycle-2025-02',
      servicePeriodStart: '2025-02-01',
      servicePeriodEnd: '2025-03-01',
    });
    const persistedContractRow = buildServicePeriodRecurringDueWorkRow({
      clientId: 'client-1',
      clientName: 'Acme Co',
      contractId: 'contract-1',
      contractLineId: 'line-1',
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
          start: '2025-03-08',
          end: '2025-04-08',
          semantics: 'half_open',
        },
        servicePeriod: {
          start: '2025-02-08',
          end: '2025-03-08',
          semantics: 'half_open',
        },
      }),
    });

    const merged = mergeRecurringDueWorkRows({
      persistedRows: [persistedContractRow],
      compatibilityRows: [compatibilityRow],
    });

    expect(merged.map((row) => row.executionIdentityKey)).toEqual([
      persistedContractRow.executionIdentityKey,
      compatibilityRow.executionIdentityKey,
    ]);
  });

  it('T017: hourly recurring service-period rows can participate in due-work selection once persisted charge-family support is widened', () => {
    const row = buildServicePeriodRecurringDueWorkRow({
      clientId: 'client-1',
      clientName: 'Acme Co',
      contractId: 'contract-1',
      contractLineId: 'line-hourly',
      record: buildRecurringServicePeriodRecord({
        cadenceOwner: 'contract',
        duePosition: 'arrears',
        sourceObligation: {
          tenant: 'tenant-1',
          obligationId: 'line-hourly',
          obligationType: 'contract_line',
          chargeFamily: 'hourly',
        },
        invoiceWindow: {
          start: '2025-03-08',
          end: '2025-04-08',
          semantics: 'half_open',
        },
        servicePeriod: {
          start: '2025-02-08',
          end: '2025-03-08',
          semantics: 'half_open',
        },
      }),
    });

    expect(row.executionWindowKind).toBe('contract_cadence_window');
    expect(row.selectorInput.executionWindow.contractLineId).toBe('line-hourly');
    expect(row.billingCycleId).toBeNull();
    expect(row.hasBillingCycleBridge).toBe(false);
  });

  it('T018: usage recurring service-period rows can participate in due-work selection once persisted charge-family support is widened', () => {
    const row = buildServicePeriodRecurringDueWorkRow({
      clientId: 'client-1',
      clientName: 'Acme Co',
      contractId: 'contract-1',
      contractLineId: 'line-usage',
      record: buildRecurringServicePeriodRecord({
        cadenceOwner: 'contract',
        duePosition: 'arrears',
        sourceObligation: {
          tenant: 'tenant-1',
          obligationId: 'line-usage',
          obligationType: 'contract_line',
          chargeFamily: 'usage',
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

    expect(row.executionWindowKind).toBe('contract_cadence_window');
    expect(row.selectorInput.executionWindow.contractLineId).toBe('line-usage');
    expect(row.billingCycleId).toBeNull();
    expect(row.hasBillingCycleBridge).toBe(false);
  });
});
