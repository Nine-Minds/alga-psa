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
import { generateClientCadenceServicePeriods } from '@alga-psa/shared/billingClients/clientCadenceServicePeriods';
import { materializeClientCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeClientCadenceServicePeriods';
import { materializeContractCadenceServicePeriods } from '@alga-psa/shared/billingClients/materializeContractCadenceServicePeriods';
import { resolveCadenceOwner } from '@alga-psa/shared/billingClients/recurringTiming';
import {
  contractLineRecurringStreams,
  type RecurringChargeStream,
} from '@alga-psa/shared/billingClients/contractLineTimingRule';
import { simulationRefusal } from './simulationRefusal';

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
    throw simulationRefusal(
      "CONTRACT_SIMULATION_SCENARIO_INVALID",
      `Simulation horizon requires a positive integer period_count; got ${horizon.period_count}. Choose a number of billing periods to simulate.`,
    );
  }
  if (!horizon.start_date) {
    throw simulationRefusal(
      "CONTRACT_SIMULATION_SCENARIO_INVALID",
      "Simulation horizon requires a start_date. Choose a start date for the simulation.",
    );
  }

  const windows = listInvoiceWindows(
    schedule,
    toISODate(toPlainDate(horizon.start_date)),
    horizon.period_count,
  );
  return windows.map((window, index) => ({
    index,
    startDate: window.start,
    endDateExclusive: window.end,
  }));
}

const SCHEDULE_OBLIGATION: IPersistedRecurringObligationRef = {
  tenant: 'contract-simulator',
  obligationId: 'invoice-schedule',
  chargeFamily: 'fixed',
};

/** More days than any one billing cycle spans, so a chunk always reaches its periods. */
const MAX_CYCLE_DAYS = 366;
const WINDOWS_PER_CHUNK = 60;

/**
 * `count` consecutive invoice windows of a client billing schedule, the first
 * being the window that contains `from`. Windows come from the shared
 * client-cadence generator, which takes the client's persisted cycle windows
 * (`schedule.history`) verbatim and anchors the current cycle only outside
 * them. Generation starts at the earliest history window, because the
 * window containing `from` after a cycle change depends on where the last
 * persisted window ended, not on the new anchor alone.
 */
export function listInvoiceWindows(
  schedule: ScenarioBillingSchedule,
  from: string,
  count: number,
): Array<{ start: string; end: string }> {
  const historicalCycles = scheduleHistoricalCycles(schedule);
  const earliestHistory = historicalCycles
    .map((cycle) => toISODate(toPlainDate(cycle.start)))
    .sort()[0];
  let cursor = earliestHistory && earliestHistory < from ? earliestHistory : from;
  const anchorSettings = {
    dayOfMonth: schedule.anchor.day_of_month,
    monthOfYear: schedule.anchor.month_of_year,
    dayOfWeek: schedule.anchor.day_of_week,
    referenceDate: schedule.anchor.reference_date,
  };
  const windows: Array<{ start: string; end: string }> = [];
  while (windows.length < count) {
    const remaining = Math.min(count - windows.length, WINDOWS_PER_CHUNK);
    const base = cursor > from ? cursor : from;
    const rangeEnd = toISODate(
      toPlainDate(base).add({ days: remaining * MAX_CYCLE_DAYS }),
    );
    const chunk = generateClientCadenceServicePeriods({
      billingCycle: schedule.billing_cycle,
      rangeStart: toUtcMidnight(cursor),
      rangeEnd: toUtcMidnight(rangeEnd),
      sourceObligation: SCHEDULE_OBLIGATION,
      duePosition: 'advance',
      anchorSettings,
      historicalCycles,
    });
    if (chunk.length === 0) {
      throw new Error('Invoice schedule generation produced no windows.');
    }
    for (const period of chunk) {
      const end = toISODate(toPlainDate(period.end));
      if (end > from && windows.length < count) {
        windows.push({ start: toISODate(toPlainDate(period.start)), end });
      }
    }
    cursor = toISODate(toPlainDate(chunk[chunk.length - 1].end));
  }
  return windows;
}

function toUtcMidnight(value: ISO8601String): ISO8601String {
  return `${toISODate(toPlainDate(value))}T00:00:00Z`;
}

/**
 * A scenario schedule's billed cycle history in the UTC-midnight form the
 * shared client-cadence generator requires. The scenario stores date-only
 * values; every reader converts here so none passes bare dates through.
 */
function scheduleHistoricalCycles(
  schedule: ScenarioBillingSchedule,
): Array<{ start: ISO8601String; end: ISO8601String }> {
  return (schedule.history ?? []).map((cycle) => ({
    start: toUtcMidnight(cycle.start_date),
    end: toUtcMidnight(cycle.end_date),
  }));
}

export interface GenerateLineServicePeriodsInput {
  line: ScenarioLine;
  horizon: SimulationHorizon;
  invoiceSchedule: ScenarioBillingSchedule;
  /** Anchor for contract-cadence lines; null anchors at the horizon start. */
  contractStartDate: ISO8601String | null;
  scenarioId: string;
}

/** One stream's hypothetical service periods for a line. */
export interface LineStreamServicePeriods {
  stream: RecurringChargeStream;
  records: IRecurringServicePeriodRecord[];
}

/**
 * Generates a line's hypothetical service periods in memory via the shared
 * pure cadence layer (the same generalization recurringAuthoringPreview.ts
 * applies with hardcoded dates), once per recurring stream of the line (the
 * streams come from contractLineRecurringStreams, the same function the
 * production materializers use). No rows are read or written.
 */
export function generateLineServicePeriods(
  input: GenerateLineServicePeriodsInput,
): LineStreamServicePeriods[] {
  const {
    line,
    horizon,
    invoiceSchedule,
    contractStartDate,
    scenarioId,
  } =
    input;

  const lineCycle = normalizeBillingCycle(line.billing_frequency);
  const cadenceOwner = resolveCadenceOwner(line.cadence_owner);
  // A client-owned stream follows the CLIENT's cycle (as the production
  // regeneration does), not the line's frequency.
  const streamCycle =
    cadenceOwner === 'client' ? normalizeBillingCycle(invoiceSchedule.billing_cycle) : lineCycle;
  const asOf = toUtcMidnight(horizon.start_date);
  const anchorDate = toUtcMidnight(contractStartDate ?? horizon.start_date);

  // Cover the whole invoice timeline plus one extra line-cadence period so
  // boundary periods (arrears due at the horizon edge) are always generated.
  const invoicePeriods = buildInvoicePeriods(horizon, invoiceSchedule);
  const finalInvoiceEnd = invoicePeriods.at(-1)?.endDateExclusive ?? toISODate(toPlainDate(horizon.start_date));
  const invoiceHorizonDays = toPlainDate(horizon.start_date).until(
    toPlainDate(finalInvoiceEnd),
    { largestUnit: 'days' },
  ).days;
  const targetHorizonDays =
    invoiceHorizonDays + monthsPerCycle(streamCycle) * 31 + 60;

  return contractLineRecurringStreams(line, line.prepaid_block).map(
    ({ stream, family, duePosition }) => {
      const sourceObligation: IPersistedRecurringObligationRef = {
        tenant: 'contract-simulator',
        obligationId: line.key,
        chargeFamily: family,
      };
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

      return {
        stream,
        records:
          cadenceOwner === 'contract'
            ? materializeContractCadenceServicePeriods({ ...common, anchorDate }).records
            : materializeClientCadenceServicePeriods({
                ...common,
                billingCycle: streamCycle,
                anchorSettings: {
                  dayOfMonth: invoiceSchedule.anchor.day_of_month,
                  monthOfYear: invoiceSchedule.anchor.month_of_year,
                  dayOfWeek: invoiceSchedule.anchor.day_of_week,
                  referenceDate: invoiceSchedule.anchor.reference_date,
                },
                historicalCycles: scheduleHistoricalCycles(invoiceSchedule),
              }).records,
      };
    },
  );
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
