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
import type { SimulatedInvoicePeriodWindow } from "./hypotheticalPeriods";
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
