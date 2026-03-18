import {
  buildBillingCycleDueSelectionInput,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import type {
  IRecurringDueSelectionInput,
  IRecurringRunExecutionWindowIdentity,
  RecurringRunExecutionWindowKind,
} from '@alga-psa/types';
import type { BillingPeriodWithMeta } from './billingAndTax';

export type RecurringBillingRunInvoiceFailure = {
  billingCycleId?: string | null;
  executionIdentityKey?: string;
  executionWindowKind?: RecurringRunExecutionWindowKind;
  errorMessage: string;
};

export type RecurringBillingRunTarget = {
  billingCycleId?: string | null;
  selectorInput?: IRecurringDueSelectionInput;
  executionWindow: IRecurringRunExecutionWindowIdentity;
};

export type ClientCadenceRecurringRunTarget = RecurringBillingRunTarget & {
  clientId: string;
  clientName: string;
  selectorInput: IRecurringDueSelectionInput;
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

export function mapClientCadenceBillingPeriodsToRecurringRunTargets(
  periods: BillingPeriodWithMeta[],
): ClientCadenceRecurringRunTarget[] {
  return periods
    .filter((period) => Boolean(period.can_generate && period.billing_cycle_id))
    .map((period) => {
      const billingCycleId = period.billing_cycle_id as string;
      const selectorInput = buildBillingCycleDueSelectionInput({
        clientId: period.client_id,
        billingCycleId,
        windowStart: period.period_start_date,
        windowEnd: period.period_end_date,
      });

      return {
        billingCycleId,
        executionWindow: selectorInput.executionWindow,
        selectorInput,
        clientId: period.client_id,
        clientName: period.client_name,
        periodStart: period.period_start_date,
        periodEnd: period.period_end_date,
        isEarly: Boolean(period.is_early),
      };
    })
    .sort((left, right) => {
      if (left.periodStart !== right.periodStart) {
        return left.periodStart.localeCompare(right.periodStart);
      }
      return left.billingCycleId.localeCompare(right.billingCycleId);
    });
}
