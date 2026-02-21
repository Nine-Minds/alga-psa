import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
    expect(contractWizardActionsSource).toContain('decisionDueDate: renewal.decisionDueDate,');
    expect(contractWizardActionsSource).toContain('daysUntilDecisionDue: renewal.daysUntilDecisionDue,');
    expect(contractWizardActionsSource).toContain('renewalCycleKey: renewal.renewalCycleKey,');
    expect(contractWizardActionsSource).toContain('decisionDueAt: decisionDueAtForWorkflow ?? undefined,');

    expect(clientContractActionsSource).toContain('decisionDueDate: renewal.decisionDueDate,');
    expect(clientContractActionsSource).toContain('daysUntilDecisionDue: renewal.daysUntilDecisionDue,');
    expect(clientContractActionsSource).toContain('renewalCycleKey: renewal.renewalCycleKey,');
    expect(clientContractActionsSource).toContain('decisionDueAt: (clientContract as any).decision_due_date ?? undefined,');
  });
});
