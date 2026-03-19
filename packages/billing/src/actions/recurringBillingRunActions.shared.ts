import {
  IRecurringDueSelectionInput,
  IRecurringDueWorkRow,
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

export function mapClientCadenceDueWorkRowsToRecurringRunTargets(
  rows: IRecurringDueWorkRow[],
): ClientCadenceRecurringRunTarget[] {
  return rows
    .filter((row) => row.cadenceOwner === 'client' && row.canGenerate)
    .map((row) => ({
      executionWindow: row.executionWindow,
      selectorInput: row.selectorInput,
      clientId: row.clientId,
      clientName: row.clientName ?? 'Unknown client',
      periodStart: row.invoiceWindowStart,
      periodEnd: row.invoiceWindowEnd,
      isEarly: row.isEarly,
    }))
    .sort((left, right) => {
      if (left.periodStart !== right.periodStart) {
        return left.periodStart.localeCompare(right.periodStart);
      }
      return left.executionWindow.identityKey.localeCompare(right.executionWindow.identityKey);
    });
}
