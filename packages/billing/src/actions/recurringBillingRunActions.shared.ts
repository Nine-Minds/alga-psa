import {
  IRecurringDueSelectionInput,
  IRecurringDueWorkInvoiceCandidate,
  IRecurringRunExecutionWindowIdentity,
  RecurringRunExecutionWindowKind,
} from '@alga-psa/types';

export type RecurringBillingRunInvoiceFailure = {
  billingCycleId?: string | null;
  executionIdentityKey?: string;
  executionWindowKind?: RecurringRunExecutionWindowKind;
  errorMessage: string;
};

export type RecurringBillingRunTarget = {
  selectorInput: IRecurringDueSelectionInput;
  executionWindow: IRecurringRunExecutionWindowIdentity;
  billingCycleId?: string | null;
};

export type RecurringBillingRunGroupedTarget = {
  groupKey: string;
  selectorInputs: IRecurringDueSelectionInput[];
  billingCycleId?: string | null;
};

export type ClientCadenceRecurringRunTarget = RecurringBillingRunTarget & {
  clientId: string;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  isEarly: boolean;
};

export type RecurringBillingRunResult = {
  runId: string;
  selectionKey: string;
  retryKey: string;
  invoicesCreated: number;
  failedCount: number;
  failures: RecurringBillingRunInvoiceFailure[];
};

export function mapClientCadenceInvoiceCandidatesToRecurringRunTargets(
  invoiceCandidates: IRecurringDueWorkInvoiceCandidate[],
): ClientCadenceRecurringRunTarget[] {
  const resolveSharedBillingCycleId = (
    candidate: IRecurringDueWorkInvoiceCandidate,
  ): string | null => {
    const billingCycleIds = new Set(
      candidate.members
        .map((member) => member.billingCycleId)
        .filter((billingCycleId): billingCycleId is string => Boolean(billingCycleId)),
    );

    if (billingCycleIds.size !== 1 || candidate.members.some((member) => !member.billingCycleId)) {
      return null;
    }

    return Array.from(billingCycleIds)[0] ?? null;
  };

  return invoiceCandidates
    .filter(
      (candidate) =>
        candidate.canGenerate &&
        candidate.cadenceOwners.length === 1 &&
        candidate.cadenceOwners[0] === 'client' &&
        Boolean(candidate.members[0]?.executionWindow?.identityKey) &&
        Boolean(candidate.members[0]?.selectorInput),
    )
    .map((candidate) => ({
      executionWindow: candidate.members[0]!.executionWindow,
      selectorInput: candidate.members[0]!.selectorInput,
      billingCycleId: resolveSharedBillingCycleId(candidate),
      clientId: candidate.clientId,
      clientName: candidate.clientName ?? 'Unknown client',
      periodStart: candidate.windowStart,
      periodEnd: candidate.windowEnd,
      isEarly: candidate.members.some((member) => member.isEarly),
    }))
    .sort((left, right) => {
      if (left.periodStart !== right.periodStart) {
        return left.periodStart.localeCompare(right.periodStart);
      }
      return left.executionWindow.identityKey.localeCompare(right.executionWindow.identityKey);
    });
}
