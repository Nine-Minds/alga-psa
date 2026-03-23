import type {
  IRecurringDueSelectionInput,
  IRecurringServicePeriodDueSelectionQuery,
  IRecurringServicePeriodRecord,
  RecurringChargeFamily,
  RecurringServicePeriodDueSelectionState,
} from '@alga-psa/types';
import { DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES } from '@alga-psa/types';

export function buildRecurringServicePeriodDueSelectionQuery(input: {
  tenant: string;
  scheduleKeys: string[];
  selectorInput: IRecurringDueSelectionInput;
  lifecycleStates?: RecurringServicePeriodDueSelectionState[];
  chargeFamilies?: RecurringChargeFamily[];
}): IRecurringServicePeriodDueSelectionQuery {
  const scheduleKeys = Array.from(new Set(input.scheduleKeys.filter(Boolean))).sort();

  if (scheduleKeys.length === 0) {
    throw new Error('Persisted recurring due-selection requires at least one scheduleKey.');
  }

  return {
    tenant: input.tenant,
    cadenceOwner: input.selectorInput.executionWindow.cadenceOwner,
    executionWindow: input.selectorInput.executionWindow,
    scheduleKeys,
    windowStart: input.selectorInput.windowStart,
    windowEnd: input.selectorInput.windowEnd,
    lifecycleStates: [...(input.lifecycleStates ?? DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES)],
    chargeFamilies: input.chargeFamilies ? [...input.chargeFamilies] : undefined,
  };
}

export function isRecurringServicePeriodRecordDue(
  record: IRecurringServicePeriodRecord,
  query: IRecurringServicePeriodDueSelectionQuery,
) {
  return (
    record.sourceObligation.tenant === query.tenant
    && record.cadenceOwner === query.cadenceOwner
    && query.scheduleKeys.includes(record.scheduleKey)
    && record.invoiceWindow.start === query.windowStart
    && record.invoiceWindow.end === query.windowEnd
    && query.lifecycleStates.includes(record.lifecycleState as RecurringServicePeriodDueSelectionState)
    && record.invoiceLinkage == null
    && (
      !query.chargeFamilies
      || query.chargeFamilies.includes(record.sourceObligation.chargeFamily)
    )
  );
}

export function selectDueRecurringServicePeriodRecords(
  records: IRecurringServicePeriodRecord[],
  query: IRecurringServicePeriodDueSelectionQuery,
) {
  return records
    .filter((record) => isRecurringServicePeriodRecordDue(record, query))
    .sort((left, right) => {
      if (left.servicePeriod.start !== right.servicePeriod.start) {
        return left.servicePeriod.start.localeCompare(right.servicePeriod.start);
      }
      if (left.servicePeriod.end !== right.servicePeriod.end) {
        return left.servicePeriod.end.localeCompare(right.servicePeriod.end);
      }
      if (left.sourceObligation.obligationId !== right.sourceObligation.obligationId) {
        return left.sourceObligation.obligationId.localeCompare(right.sourceObligation.obligationId);
      }
      return left.revision - right.revision;
    });
}
