/**
 * Hypothetical billing timeline generation for the EE contract simulator.
 *
 * The simulator never reads or writes `recurring_service_periods`; every
 * service period is generated in memory through the same pure cadence layer
 * (`shared/billingClients/materialize*ServicePeriods`) that production
 * materialization uses, so hypothetical timelines cannot drift from the
 * periods real invoicing would settle.
 *
 * The overall invoice timeline is `horizon.period_count` consecutive periods
 * of the CONTRACT's billing frequency starting at `horizon.start_date`. Each
 * line generates service periods on its own cadence; a service period is
 * assigned to the invoice period whose window contains its due boundary
 * (advance: the service period start; arrears: the exclusive service-period
 * end boundary — arrears bills after the covered period closes).
 */

import { Temporal } from '@js-temporal/polyfill';
import type {
  IPersistedRecurringObligationRef,
  IRecurringServicePeriodRecord,
  ISO8601String,
  ScenarioBillingSchedule,
  ScenarioLine,
  SimulationHorizon,
} from '@alga-psa/types';
import { toISODate, toPlainDate } from '@alga-psa/core';
import { materializeClientCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeClientCadenceServicePeriods';
import { materializeContractCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeContractCadenceServicePeriods';
import { resolveCadenceOwner } from '@alga-psa/shared/billingClients/recurringTiming';
import {
  getBillingPeriodForDate,
  getNextBillingBoundaryAfter,
  normalizeAnchorSettingsForCycle,
} from '@alga-psa/shared/billingClients/billingCycleAnchors';

export type SimulatorBillingCycle =
  | 'monthly'
  | 'quarterly'
  | 'semi-annually'
  | 'annually';

const SIMULATOR_SOURCE_RULE_VERSION = 'contract-simulator:v1';

/**
 * Normalizes a stored billing frequency to the cadences the simulator (and
 * the contract cadence generators) support. Unknown/absent values fall back
 * to monthly; callers that care can detect the fallback via
 * isSupportedBillingFrequency and surface a diagnostic.
 */
export function normalizeBillingCycle(
  frequency: string | null | undefined,
): SimulatorBillingCycle {
  switch ((frequency ?? '').trim().toLowerCase()) {
    case 'quarterly':
      return 'quarterly';
    case 'semi-annually':
    case 'semi-annual':
    case 'semiannually':
      return 'semi-annually';
    case 'annually':
    case 'annual':
    case 'yearly':
      return 'annually';
    default:
      return 'monthly';
  }
}

export function isSupportedBillingFrequency(
  frequency: string | null | undefined,
): boolean {
  const normalized = (frequency ?? '').trim().toLowerCase();
  return (
    normalized === '' ||
    normalized === 'monthly' ||
    normalized === 'quarterly' ||
    normalized === 'semi-annually' ||
    normalized === 'semi-annual' ||
    normalized === 'semiannually' ||
    normalized === 'annually' ||
    normalized === 'annual' ||
    normalized === 'yearly'
  );
}

export function monthsPerCycle(cycle: SimulatorBillingCycle): number {
  switch (cycle) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'semi-annually':
      return 6;
    case 'annually':
      return 12;
  }
}

/** One invoice period of the simulated timeline. Dates are 'YYYY-MM-DD'. */
export interface SimulatedInvoicePeriodWindow {
  index: number;
  /** Inclusive first day of the invoice period. */
  startDate: ISO8601String;
  /** Exclusive end boundary ([start, end) semantics). */
  endDateExclusive: ISO8601String;
}

export function buildInvoicePeriods(
  horizon: SimulationHorizon,
  schedule: ScenarioBillingSchedule,
): SimulatedInvoicePeriodWindow[] {
  if (!Number.isInteger(horizon.period_count) || horizon.period_count < 1) {
    throw new Error(
      `Simulation horizon requires a positive integer period_count; got ${horizon.period_count}`,
    );
  }
  if (!horizon.start_date) {
    throw new Error('Simulation horizon requires a start_date');
  }

  const anchor = normalizeAnchorSettingsForCycle(schedule.billing_cycle, {
    dayOfMonth: schedule.anchor.day_of_month,
    monthOfYear: schedule.anchor.month_of_year,
    dayOfWeek: schedule.anchor.day_of_week,
    referenceDate: schedule.anchor.reference_date,
  });
  const first = getBillingPeriodForDate(
    toUtcMidnight(horizon.start_date),
    schedule.billing_cycle,
    anchor,
  );
  const periods: SimulatedInvoicePeriodWindow[] = [];
  let start = first.periodStartDate;
  let end = first.periodEndDate;

  for (let index = 0; index < horizon.period_count; index += 1) {
    periods.push({
      index,
      startDate: toISODate(toPlainDate(start)),
      endDateExclusive: toISODate(toPlainDate(end)),
    });
    start = end;
    end = getNextBillingBoundaryAfter(end, schedule.billing_cycle, anchor);
  }

  return periods;
}

function toUtcMidnight(value: ISO8601String): ISO8601String {
  return `${toISODate(toPlainDate(value))}T00:00:00Z`;
}

export interface GenerateLineServicePeriodsInput {
  line: ScenarioLine;
  horizon: SimulationHorizon;
  invoiceSchedule: ScenarioBillingSchedule;
  /** Anchor for contract-cadence lines; null anchors at the horizon start. */
  contractStartDate: ISO8601String | null;
  scenarioId: string;
}

/**
 * Generates a line's hypothetical service periods in memory via the shared
 * pure cadence layer (the same generalization recurringAuthoringPreview.ts
 * applies with hardcoded dates). No rows are read or written.
 */
export function generateLineServicePeriods(
  input: GenerateLineServicePeriodsInput,
): IRecurringServicePeriodRecord[] {
  const {
    line,
    horizon,
    invoiceSchedule,
    contractStartDate,
    scenarioId,
  } =
    input;

  const lineCycle = normalizeBillingCycle(line.billing_frequency);
  const duePosition = line.billing_timing === 'advance' ? 'advance' : 'arrears';
  const cadenceOwner = resolveCadenceOwner(line.cadence_owner);
  const asOf = toUtcMidnight(horizon.start_date);
  const anchorDate = toUtcMidnight(contractStartDate ?? horizon.start_date);

  const sourceObligation: IPersistedRecurringObligationRef = {
    tenant: 'contract-simulator',
    obligationId: line.key,
    obligationType: 'contract_line',
    chargeFamily: 'fixed',
  };

  // Cover the whole invoice timeline plus one extra line-cadence period so
  // boundary periods (arrears due at the horizon edge) are always generated.
  const invoicePeriods = buildInvoicePeriods(horizon, invoiceSchedule);
  const finalInvoiceEnd = invoicePeriods.at(-1)?.endDateExclusive ?? toISODate(toPlainDate(horizon.start_date));
  const invoiceHorizonDays = toPlainDate(horizon.start_date).until(
    toPlainDate(finalInvoiceEnd),
    { largestUnit: 'days' },
  ).days;
  const targetHorizonDays =
    invoiceHorizonDays + monthsPerCycle(lineCycle) * 31 + 60;

  const common = {
    asOf,
    materializedAt: asOf,
    billingCycle: lineCycle,
    sourceObligation,
    duePosition,
    sourceRuleVersion: SIMULATOR_SOURCE_RULE_VERSION,
    sourceRunKey: `simulation-${scenarioId}`,
    targetHorizonDays,
    replenishmentThresholdDays: 30,
  } as const;

  return cadenceOwner === 'contract'
    ? materializeContractCadenceServicePeriods({ ...common, anchorDate }).records
    : materializeClientCadenceServicePeriods({
        ...common,
        anchorSettings: {
          dayOfMonth: invoiceSchedule.anchor.day_of_month,
          monthOfYear: invoiceSchedule.anchor.month_of_year,
          dayOfWeek: invoiceSchedule.anchor.day_of_week,
          referenceDate: invoiceSchedule.anchor.reference_date,
        },
      }).records;
}

export interface ServicePeriodAssignment {
  periodIndex: number;
  record: IRecurringServicePeriodRecord;
}

/**
 * Assigns each service period to the invoice period whose window contains its
 * due boundary: the service period start for advance, the exclusive service
 * period end boundary for arrears (mirroring the engine's due-selection rule
 * that arrears periods bill in the window opening at their close). Periods
 * whose boundary falls outside the horizon are dropped.
 */
export function assignServicePeriodsToInvoicePeriods(
  records: IRecurringServicePeriodRecord[],
  invoicePeriods: SimulatedInvoicePeriodWindow[],
): ServicePeriodAssignment[] {
  const assignments: ServicePeriodAssignment[] = [];

  for (const record of records) {
    const boundary =
      record.duePosition === 'advance'
        ? toPlainDate(record.servicePeriod.start)
        : toPlainDate(record.servicePeriod.end);

    const period = invoicePeriods.find(
      (candidate) =>
        Temporal.PlainDate.compare(toPlainDate(candidate.startDate), boundary) <=
          0 &&
        Temporal.PlainDate.compare(
          boundary,
          toPlainDate(candidate.endDateExclusive),
        ) < 0,
    );

    if (period) {
      assignments.push({ periodIndex: period.index, record });
    }
  }

  return assignments;
}
