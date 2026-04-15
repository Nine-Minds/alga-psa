import { describe, expect, it } from 'vitest';

import {
  buildClientCadenceExecutionWindow,
  buildContractCadenceExecutionWindow,
  buildRecurringRunSelectionIdentity,
  listRecurringRunExecutionWindowKinds,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import {
  buildRecurringBillingRunCompletedPayload,
  buildRecurringBillingRunFailedPayload,
  buildRecurringBillingRunStartedPayload,
} from '@shared/workflow/streams/domainEventBuilders/recurringBillingRunEventBuilders';

describe('recurring billing run window identity payloads', () => {
  it('T007: client-cadence execution identity keys stay stable and bridge-free', () => {
    const firstWindow = buildClientCadenceExecutionWindow({
      clientId: 'client-1',
      scheduleKey: 'schedule-1',
      periodKey: 'period-1',
      windowStart: '2026-04-01',
      windowEnd: '2026-05-01',
    });
    const secondWindow = buildClientCadenceExecutionWindow({
      clientId: 'client-1',
      scheduleKey: 'schedule-1',
      periodKey: 'period-1',
      windowStart: '2026-04-01',
      windowEnd: '2026-05-01',
    });

    const selectionIdentity = buildRecurringRunSelectionIdentity([firstWindow, secondWindow]);
    const executionWindowKinds = listRecurringRunExecutionWindowKinds([firstWindow]);
    const startedPayload = buildRecurringBillingRunStartedPayload({
      runId: '11111111-1111-1111-1111-111111111111',
      startedAt: '2026-03-18T20:00:00.000Z',
      selectionKey: selectionIdentity.selectionKey,
      retryKey: selectionIdentity.retryKey,
      windowIdentity: 'client_cadence_window',
      executionWindowKinds,
    });

    expect(firstWindow.identityKey).toBe(secondWindow.identityKey);
    expect(firstWindow.identityKey).toBe(
      'client_cadence_window:client:client-1:schedule-1:period-1:2026-04-01:2026-05-01',
    );
    expect(firstWindow.identityKey).not.toContain('billing_cycle');
    expect(selectionIdentity.selectionKey).toBe(
      `recurring-run-selection:${firstWindow.identityKey}`,
    );
    expect(selectionIdentity.retryKey).toBe(
      `recurring-run-retry:${firstWindow.identityKey}`,
    );
    expect(startedPayload.windowIdentity).toBe('client_cadence_window');
    expect(startedPayload.executionWindowKinds).toEqual(['client_cadence_window']);
  });

  it('T008: contract-cadence execution identity keys stay stable and bridge-free', () => {
    const firstWindow = buildContractCadenceExecutionWindow({
      clientId: 'client-1',
      contractId: 'contract-1',
      contractLineId: 'line-1',
      windowStart: '2026-04-08',
      windowEnd: '2026-05-08',
    });
    const secondWindow = buildContractCadenceExecutionWindow({
      clientId: 'client-1',
      contractId: 'contract-1',
      contractLineId: 'line-1',
      windowStart: '2026-04-08',
      windowEnd: '2026-05-08',
    });

    const selectionIdentity = buildRecurringRunSelectionIdentity([firstWindow, secondWindow]);
    const executionWindowKinds = listRecurringRunExecutionWindowKinds([firstWindow]);
    const completedPayload = buildRecurringBillingRunCompletedPayload({
      runId: '22222222-2222-2222-2222-222222222222',
      completedAt: '2026-03-18T20:05:00.000Z',
      invoicesCreated: 1,
      failedCount: 0,
      selectionKey: selectionIdentity.selectionKey,
      retryKey: selectionIdentity.retryKey,
      windowIdentity: 'contract_cadence_window',
      executionWindowKinds,
    });
    const failedPayload = buildRecurringBillingRunFailedPayload({
      runId: '22222222-2222-2222-2222-222222222222',
      failedAt: '2026-03-18T20:05:00.000Z',
      errorMessage: 'contract-only run failed',
      retryable: true,
      selectionKey: selectionIdentity.selectionKey,
      retryKey: selectionIdentity.retryKey,
      windowIdentity: 'contract_cadence_window',
      executionWindowKinds,
    });

    expect(firstWindow.identityKey).toBe(secondWindow.identityKey);
    expect(firstWindow.identityKey).toBe(
      'contract_cadence_window:contract:client-1:contract-1:line-1:2026-04-08:2026-05-08',
    );
    expect(firstWindow.identityKey).not.toContain('billing_cycle');
    expect(selectionIdentity.selectionKey).toBe(
      `recurring-run-selection:${firstWindow.identityKey}`,
    );
    expect(selectionIdentity.retryKey).toBe(
      `recurring-run-retry:${firstWindow.identityKey}`,
    );
    expect(completedPayload.windowIdentity).toBe('contract_cadence_window');
    expect(failedPayload.windowIdentity).toBe('contract_cadence_window');
    expect(completedPayload.executionWindowKinds).toEqual(['contract_cadence_window']);
    expect(failedPayload.executionWindowKinds).toEqual(['contract_cadence_window']);
  });
});
