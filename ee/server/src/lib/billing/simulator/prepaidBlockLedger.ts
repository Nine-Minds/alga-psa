/**
 * Data supply for the simulator's Prepaid Block lines: runs the in-memory
 * block timeline (prepaidBlockTimeline.ts) once per line and keeps, per
 * invoice period, the issues, the draws and the share of assumed hourly
 * demand the blocks absorbed.
 *
 * It holds no charge rules. Whether an issue becomes a charge, how it is taxed
 * and how a draw is shown are decided by the shared resolver; the scenario
 * source (./scenarioChargeSource) hands the resolver what this ledger records.
 */

import type {
  ContractScenario,
  ScenarioLine,
  ScenarioLineService,
  ScenarioPrepaidBlockConfig,
  SimulationDiagnostic,
} from "@alga-psa/types";
import { resolveCadenceOwner } from "@alga-psa/shared/billingClients/recurringTiming";
import { Temporal } from "@js-temporal/polyfill";
import {
  nthCadenceBoundaryAfter,
  type CadenceAdvanceRule,
} from "@alga-psa/shared/billingClients/cadenceBoundaryAdvance";
import { prorateRecurringCoverageByRatio } from "@alga-psa/shared/billingClients/coverageProration";
import { normalizeAnchorSettingsForCycle } from "@alga-psa/shared/billingClients/billingCycleAnchors";
import type { ResolvedBillingTiming } from "@alga-psa/billing/lib/billing/domain";
import {
  normalizeBillingCycle,
  type SimulatedInvoicePeriodWindow,
} from "./hypotheticalPeriods";
import {
  simulatePrepaidBlockTimeline,
  type PrepaidBlockDraw,
  type PrepaidBlockIssue,
} from "./prepaidBlockTimeline";
import { resolveAssumedQuantity } from "./syntheticActivity";

export interface PrepaidBlockLedger {
  config: ScenarioPrepaidBlockConfig;
  /** The service the block is sold as (and drawn against). */
  soldAs: ScenarioLineService;
  issuesByPeriod: Map<number, PrepaidBlockIssue[]>;
  drawsByPeriod: Map<number, PrepaidBlockDraw[]>;
  /** Share (0-1) of each period's assumed hourly demand that blocks absorbed. */
  demandCoverage: Map<number, number>;
  /** Cadence blocks only: the cadence rollover is counted on. */
  cadenceRule?: CadenceAdvanceRule;
}

/** The cadence a scenario line's service periods (and so its block validity) follow. */
export function cadenceRuleForLine(
  scenario: ContractScenario,
  line: ScenarioLine,
): CadenceAdvanceRule {
  const billingCycle = normalizeBillingCycle(line.billing_frequency);
  if (resolveCadenceOwner(line.cadence_owner) === "client") {
    const anchor = scenario.invoice_schedule.anchor;
    return {
      owner: "client",
      billingCycle,
      anchor: normalizeAnchorSettingsForCycle(billingCycle, {
        dayOfMonth: anchor.day_of_month,
        monthOfYear: anchor.month_of_year,
        dayOfWeek: anchor.day_of_week,
        referenceDate: anchor.reference_date,
      }),
    };
  }
  return {
    owner: "contract",
    billingCycle,
    anchorDate: (scenario.contract_start_date ?? scenario.horizon.start_date).slice(0, 10),
  };
}

export interface DueTiming {
  periodIndex: number;
  timing: ResolvedBillingTiming;
}

/**
 * The ledger of a cadence-issued block: one block per due block period, each
 * valid from its period start for `rollover_periods` further cadence periods;
 * each hourly period's assumed demand draws the valid blocks oldest-expiry
 * first. Timings are the ones the shared stream rules produced, so block
 * validity and burn windows cannot drift from what invoicing derives.
 */
export function buildCadencePrepaidBlockLedger(input: {
  scenario: ContractScenario;
  line: ScenarioLine;
  blockTimings: DueTiming[];
  hourlyTimings: DueTiming[];
  diagnostics: SimulationDiagnostic[];
}): PrepaidBlockLedger | null {
  const { scenario, line, blockTimings, hourlyTimings, diagnostics } = input;
  const config = line.prepaid_block;
  if (!config) return null;
  const hourlyServices = line.services.filter(
    (service) =>
      service.item_kind !== "product" &&
      service.configuration.configuration_type === "Hourly",
  );
  const soldAs =
    line.services.find(
      (service) => service.service_id === config.sold_as_service_id,
    ) ?? hourlyServices[0];
  if (!(config.block_minutes > 0) || !soldAs) {
    diagnostics.push({
      severity: "warning",
      line_key: line.key,
      message: !soldAs
        ? "Prepaid block has no service to sell the block as, so no blocks are simulated."
        : "Prepaid block has no block size, so no blocks are simulated.",
    });
    return null;
  }

  const rule = cadenceRuleForLine(scenario, line);
  const rolloverPeriods = config.rollover_periods ?? 0;
  const blocks = [...blockTimings]
    .sort((a, b) => a.timing.servicePeriodStart.localeCompare(b.timing.servicePeriodStart))
    .map(({ timing }, index) => {
      const ratio = line.enable_proration
        ? Math.max(0, Math.min(timing.coverageRatio ?? 1, 1))
        : 1;
      return {
        ordinal: index + 1,
        validFrom: timing.servicePeriodStart,
        expiration: Temporal.PlainDate.from(
          nthCadenceBoundaryAfter(timing.servicePeriodStart, rolloverPeriods + 1, rule),
        )
          .subtract({ days: 1 })
          .toString(),
        remaining: prorateRecurringCoverageByRatio(config.block_minutes, ratio),
      };
    });

  const drawsByPeriod = new Map<number, PrepaidBlockDraw[]>();
  const demandCoverage = new Map<number, number>();
  const ordered = [...hourlyTimings].sort((a, b) =>
    a.timing.servicePeriodStart.localeCompare(b.timing.servicePeriodStart),
  );
  for (const { periodIndex, timing } of ordered) {
    let demand = 0;
    for (const service of hourlyServices) {
      demand +=
        Math.max(
          0,
          resolveAssumedQuantity(
            scenario.assumptions,
            line.key,
            service.service_id,
            periodIndex,
          ),
        ) * 60;
    }
    demand = Math.round(demand);
    let left = demand;
    const draws: PrepaidBlockDraw[] = [];
    const valid = blocks
      .filter(
        (block) =>
          block.validFrom <= timing.servicePeriodStart &&
          block.expiration >= timing.servicePeriodEnd,
      )
      .sort(
        (a, b) =>
          a.expiration.localeCompare(b.expiration) || a.ordinal - b.ordinal,
      );
    for (const block of valid) {
      if (left <= 0) break;
      const take = Math.min(left, block.remaining);
      if (take <= 0) continue;
      block.remaining -= take;
      left -= take;
      draws.push({
        periodIndex,
        blockOrdinal: block.ordinal,
        minutes: take,
        remainingMinutes: block.remaining,
      });
    }
    if (draws.length > 0) drawsByPeriod.set(periodIndex, draws);
    demandCoverage.set(
      periodIndex,
      demand > 0 ? Math.max(0, Math.min(1, (demand - left) / demand)) : 0,
    );
  }

  return {
    config,
    soldAs,
    issuesByPeriod: new Map(),
    drawsByPeriod,
    demandCoverage,
    cadenceRule: rule,
  };
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
}

const groupByPeriod = <T extends { periodIndex: number }>(
  items: T[],
): Map<number, T[]> => {
  const grouped = new Map<number, T[]>();
  for (const item of items) {
    const group = grouped.get(item.periodIndex) ?? [];
    group.push(item);
    grouped.set(item.periodIndex, group);
  }
  return grouped;
};

/**
 * Null when the line's block configuration cannot be simulated (a diagnostic
 * says why); the line then bills all its demand at the hourly rate.
 */
export function buildPrepaidBlockLedger(input: {
  scenario: ContractScenario;
  line: ScenarioLine;
  invoicePeriods: SimulatedInvoicePeriodWindow[];
  contractStartDate: string | null;
  contractEndDate: string | null;
  diagnostics: SimulationDiagnostic[];
}): PrepaidBlockLedger | null {
  const {
    scenario,
    line,
    invoicePeriods,
    contractStartDate,
    contractEndDate,
    diagnostics,
  } = input;
  const config = line.prepaid_block;
  if (!config) return null;

  const hourlyServices = line.services.filter(
    (service) =>
      service.item_kind !== "product" &&
      service.configuration.configuration_type === "Hourly",
  );
  const soldAs =
    line.services.find(
      (service) => service.service_id === config.sold_as_service_id,
    ) ?? hourlyServices[0];

  if (!(config.block_minutes > 0)) {
    diagnostics.push({
      severity: "warning",
      line_key: line.key,
      message: "Prepaid block has no block size, so no blocks are simulated.",
    });
    return null;
  }
  if (!soldAs) {
    diagnostics.push({
      severity: "warning",
      line_key: line.key,
      message:
        "Prepaid block has no service to sell the block as, so no blocks are simulated.",
    });
    return null;
  }
  if (config.trigger_on_renewal) {
    diagnostics.push({
      severity: "info",
      line_key: line.key,
      message:
        "Renewal-triggered blocks are not simulated; only the start, usage and expiry triggers are.",
    });
  }

  const demandMinutesByPeriod = new Map<number, number>();
  for (const window of invoicePeriods) {
    let minutes = 0;
    for (const service of hourlyServices) {
      minutes +=
        Math.max(
          0,
          resolveAssumedQuantity(
            scenario.assumptions,
            line.key,
            service.service_id,
            window.index,
          ),
        ) * 60;
    }
    demandMinutesByPeriod.set(window.index, Math.round(minutes));
  }

  const timeline = simulatePrepaidBlockTimeline({
    config,
    periods: invoicePeriods.map((window) => ({
      index: window.index,
      startDate: window.startDate,
      endDateExclusive: window.endDateExclusive,
    })),
    contractStartDate,
    contractEndDate,
    demandMinutesByPeriod,
  });

  const demandCoverage = new Map<number, number>();
  for (const [periodIndex, demand] of demandMinutesByPeriod) {
    const overage = timeline.overageMinutesByPeriod.get(periodIndex) ?? 0;
    demandCoverage.set(
      periodIndex,
      demand > 0 ? Math.max(0, Math.min(1, (demand - overage) / demand)) : 0,
    );
  }

  for (const forfeiture of timeline.forfeitures) {
    diagnostics.push({
      severity: "info",
      line_key: line.key,
      message: `Block ${forfeiture.blockOrdinal} expires on ${forfeiture.date} with ${formatHours(forfeiture.minutes / 60)} h unused, which are forfeited.`,
    });
  }

  return {
    config,
    soldAs,
    issuesByPeriod: groupByPeriod(timeline.issues),
    drawsByPeriod: groupByPeriod(timeline.draws),
    demandCoverage,
  };
}
