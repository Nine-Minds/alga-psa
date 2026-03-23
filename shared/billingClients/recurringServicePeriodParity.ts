import type {
  IRecurringDuePeriodSelection,
  IRecurringServicePeriodParityComparisonResult,
  IRecurringServicePeriodParityDrift,
  IRecurringServicePeriodRecord,
  ISO8601String,
  RecurringServicePeriodParityComparisonState,
} from '@alga-psa/types';
import { DEFAULT_RECURRING_SERVICE_PERIOD_PARITY_COMPARISON_STATES } from '@alga-psa/types';
import {
  buildRecurringServicePeriodPeriodKey,
  buildRecurringServicePeriodScheduleKey,
} from './recurringServicePeriodKeys';

function toDateOnly(value: ISO8601String): ISO8601String {
  return `${value.slice(0, 10)}` as ISO8601String;
}

function buildCompositeKey(scheduleKey: string, periodKey: string) {
  return `${scheduleKey}::${periodKey}`;
}

function normalizeDerivedSelection(tenant: string, selection: IRecurringDuePeriodSelection) {
  const scheduleKey = buildRecurringServicePeriodScheduleKey({
    tenant,
    obligationType: selection.servicePeriod.sourceObligation.obligationType,
    obligationId: selection.servicePeriod.sourceObligation.obligationId,
    cadenceOwner: selection.servicePeriod.cadenceOwner,
    duePosition: selection.servicePeriod.duePosition,
  });
  const periodKey = buildRecurringServicePeriodPeriodKey(selection.servicePeriod);

  return {
    compositeKey: buildCompositeKey(scheduleKey, periodKey),
    scheduleKey,
    periodKey,
    obligationId: selection.servicePeriod.sourceObligation.obligationId,
    cadenceOwner: selection.servicePeriod.cadenceOwner,
    duePosition: selection.servicePeriod.duePosition,
    servicePeriodStart: toDateOnly(selection.servicePeriod.start),
    servicePeriodEnd: toDateOnly(selection.servicePeriod.end),
    invoiceWindowStart: toDateOnly(selection.invoiceWindow.start),
    invoiceWindowEnd: toDateOnly(selection.invoiceWindow.end),
  };
}

function normalizePersistedRecord(record: IRecurringServicePeriodRecord) {
  return {
    compositeKey: buildCompositeKey(record.scheduleKey, record.periodKey),
    scheduleKey: record.scheduleKey,
    periodKey: record.periodKey,
    obligationId: record.sourceObligation.obligationId,
    cadenceOwner: record.cadenceOwner,
    duePosition: record.duePosition,
    servicePeriodStart: toDateOnly(record.servicePeriod.start),
    servicePeriodEnd: toDateOnly(record.servicePeriod.end),
    invoiceWindowStart: toDateOnly(record.invoiceWindow.start),
    invoiceWindowEnd: toDateOnly(record.invoiceWindow.end),
    lifecycleState: record.lifecycleState,
  };
}

export function compareDerivedRecurringTimingToPersistedSchedule(input: {
  tenant: string;
  derivedSelections: IRecurringDuePeriodSelection[];
  persistedRecords: IRecurringServicePeriodRecord[];
  lifecycleStates?: RecurringServicePeriodParityComparisonState[];
}): IRecurringServicePeriodParityComparisonResult {
  const allowedStates = new Set(
    input.lifecycleStates ?? DEFAULT_RECURRING_SERVICE_PERIOD_PARITY_COMPARISON_STATES,
  );
  const persistedByKey = new Map(
    input.persistedRecords
      .filter((record) => allowedStates.has(record.lifecycleState as RecurringServicePeriodParityComparisonState))
      .map((record) => {
        const normalized = normalizePersistedRecord(record);
        return [normalized.compositeKey, normalized] as const;
      }),
  );
  const drifts: IRecurringServicePeriodParityDrift[] = [];

  for (const selection of input.derivedSelections) {
    const normalizedDerived = normalizeDerivedSelection(input.tenant, selection);
    const persisted = persistedByKey.get(normalizedDerived.compositeKey);

    if (!persisted) {
      drifts.push({
        kind: 'missing_persisted_period',
        scheduleKey: normalizedDerived.scheduleKey,
        periodKey: normalizedDerived.periodKey,
        obligationId: normalizedDerived.obligationId,
        cadenceOwner: normalizedDerived.cadenceOwner,
        duePosition: normalizedDerived.duePosition,
        servicePeriodStart: normalizedDerived.servicePeriodStart,
        servicePeriodEnd: normalizedDerived.servicePeriodEnd,
        derivedInvoiceWindowStart: normalizedDerived.invoiceWindowStart,
        derivedInvoiceWindowEnd: normalizedDerived.invoiceWindowEnd,
      });
      continue;
    }

    persistedByKey.delete(normalizedDerived.compositeKey);

    if (
      persisted.invoiceWindowStart !== normalizedDerived.invoiceWindowStart
      || persisted.invoiceWindowEnd !== normalizedDerived.invoiceWindowEnd
    ) {
      drifts.push({
        kind: 'invoice_window_mismatch',
        scheduleKey: normalizedDerived.scheduleKey,
        periodKey: normalizedDerived.periodKey,
        obligationId: normalizedDerived.obligationId,
        cadenceOwner: normalizedDerived.cadenceOwner,
        duePosition: normalizedDerived.duePosition,
        servicePeriodStart: normalizedDerived.servicePeriodStart,
        servicePeriodEnd: normalizedDerived.servicePeriodEnd,
        derivedInvoiceWindowStart: normalizedDerived.invoiceWindowStart,
        derivedInvoiceWindowEnd: normalizedDerived.invoiceWindowEnd,
        persistedInvoiceWindowStart: persisted.invoiceWindowStart,
        persistedInvoiceWindowEnd: persisted.invoiceWindowEnd,
        persistedLifecycleState: persisted.lifecycleState,
      });
    }
  }

  for (const persisted of persistedByKey.values()) {
    drifts.push({
      kind: 'unexpected_persisted_period',
      scheduleKey: persisted.scheduleKey,
      periodKey: persisted.periodKey,
      obligationId: persisted.obligationId,
      cadenceOwner: persisted.cadenceOwner,
      duePosition: persisted.duePosition,
      servicePeriodStart: persisted.servicePeriodStart,
      servicePeriodEnd: persisted.servicePeriodEnd,
      persistedInvoiceWindowStart: persisted.invoiceWindowStart,
      persistedInvoiceWindowEnd: persisted.invoiceWindowEnd,
      persistedLifecycleState: persisted.lifecycleState,
    });
  }

  return {
    matches: drifts.length === 0,
    drifts,
  };
}
