import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDateDomainEventDedupeKey, normalizeDateDomainKeyDate } from '@alga-psa/event-bus/workflow/dateDomainEvents';

const contractWizardActionsSource = readFileSync(
  new URL('../src/actions/contractWizardActions.ts', import.meta.url),
  'utf8'
);
const clientContractActionsSource = readFileSync(
  new URL('../../clients/src/actions/clientContractActions.ts', import.meta.url),
  'utf8'
);
const contractEventBuildersSource = readFileSync(
  new URL('../../../shared/workflow/streams/domainEventBuilders/contractEventBuilders.ts', import.meta.url),
  'utf8'
);

describe('contract renewal upcoming event queue-compatible payload wiring', () => {
  it('computes renewal-upcoming windows from decision due date semantics and carries cycle metadata', () => {
    expect(contractEventBuildersSource).toContain('export const DEFAULT_CONTRACT_RENEWAL_UPCOMING_WINDOW_DAYS = 90;');
    expect(contractEventBuildersSource).toContain('decisionDueAt?: string;');
    expect(contractEventBuildersSource).toContain('renewalCycleKey?: string;');
    expect(contractEventBuildersSource).toContain('decisionDueDate: decisionDueDateRaw,');
    expect(contractEventBuildersSource).toContain('daysUntilDecisionDue,');
    expect(contractEventBuildersSource).toContain('renewalCycleKey: params.renewalCycleKey,');
  });

  it('publishes CONTRACT_RENEWAL_UPCOMING payloads with decision due and cycle fields from contract actions', () => {
    expect(contractWizardActionsSource).toContain('decisionDueDate: normalizeDateDomainKeyDate(renewal.decisionDueDate),');
    expect(contractWizardActionsSource).toContain('daysUntilDecisionDue: renewal.daysUntilDecisionDue,');
    expect(contractWizardActionsSource).toContain('renewalCycleKey: renewal.renewalCycleKey,');
    expect(contractWizardActionsSource).toContain('decisionDueAt: clientContractAssignment.decision_due_date ?? decisionDueAtForWorkflow ?? undefined,');
    expect(contractWizardActionsSource).toContain('emitDateDomainEventOnce(knex, tenant, {');
    expect(contractWizardActionsSource).toContain("eventType: 'CONTRACT_RENEWAL_UPCOMING', entityId: wfData.clientContractId,");

    expect(clientContractActionsSource).toContain('decisionDueDate: normalizeDateDomainKeyDate(renewal.decisionDueDate),');
    expect(clientContractActionsSource).toContain('daysUntilDecisionDue: renewal.daysUntilDecisionDue,');
    expect(clientContractActionsSource).toContain('renewalCycleKey: renewal.renewalCycleKey,');
    expect(clientContractActionsSource).toContain('decisionDueAt: (clientContract as any).decision_due_date ?? undefined,');
    expect(clientContractActionsSource).toContain('emitDateDomainEventOnce(knex, tenant, {');
    expect(clientContractActionsSource).toContain('emitDateDomainEventOnce(db, tenant, {');
    expect(clientContractActionsSource).toContain("eventType: 'CONTRACT_RENEWAL_UPCOMING', entityId: clientContract.client_contract_id,");
    expect(clientContractActionsSource).toContain('cycleKey: renewal.renewalCycleKey ?? normalizeDateDomainKeyDate(renewal.decisionDueDate ?? renewal.renewalAt)');
    expect(contractWizardActionsSource).toContain('renewalCycleKey: clientContractAssignment.renewal_cycle_key ?? undefined');
    const persistedCycleKey = 'fixed-term:2099-06-15';
    const saveCycleKey = persistedCycleKey ?? normalizeDateDomainKeyDate(new Date('2099-06-15T00:00:00'));
    const scanCycleKey = persistedCycleKey ?? '2099-06-15';
    expect(buildDateDomainEventDedupeKey('CONTRACT_RENEWAL_UPCOMING', 'client-contract-1', saveCycleKey))
      .toBe(buildDateDomainEventDedupeKey('CONTRACT_RENEWAL_UPCOMING', 'client-contract-1', scanCycleKey));
  });
});
