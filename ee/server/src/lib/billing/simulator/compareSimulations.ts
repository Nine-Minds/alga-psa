import type {
  ContractSimulationResult,
  SimulatedInvoiceLine,
  SimulationComparison,
  SimulationLineDelta,
} from '@alga-psa/types';

interface AggregatedLine {
  line_key: string;
  service_id: string | null;
  charge_type: string;
  service_name: string;
  amount: number;
}

function stableLineKey(line: SimulatedInvoiceLine): string {
  return `${line.line_key}:${line.service_id ?? 'none'}:${line.charge_type}`;
}

function aggregateLines(lines: SimulatedInvoiceLine[]): Map<string, AggregatedLine> {
  const aggregated = new Map<string, AggregatedLine>();
  for (const line of lines) {
    const key = stableLineKey(line);
    const existing = aggregated.get(key);
    if (existing) {
      existing.amount += line.total;
    } else {
      aggregated.set(key, {
        line_key: line.line_key,
        service_id: line.service_id,
        charge_type: line.charge_type,
        service_name: line.service_name,
        amount: line.total,
      });
    }
  }
  return aggregated;
}

/** Pure, order-stable comparison of a scenario run against its baseline. */
export function compareSimulations(
  baseline: ContractSimulationResult,
  scenario: ContractSimulationResult,
): SimulationComparison {
  const baselinePeriods = new Map(
    baseline.periods.map((period) => [
      `${period.period_start}:${period.period_end}`,
      period,
    ]),
  );
  const scenarioPeriods = new Map(
    scenario.periods.map((period) => [
      `${period.period_start}:${period.period_end}`,
      period,
    ]),
  );
  const periodKeys = Array.from(
    new Set([...baselinePeriods.keys(), ...scenarioPeriods.keys()]),
  ).sort();

  const periods = periodKeys.map((periodKey, index) => {
    const baselinePeriod = baselinePeriods.get(periodKey);
    const scenarioPeriod = scenarioPeriods.get(periodKey);
    const baselineLines = aggregateLines(baselinePeriod?.lines ?? []);
    const scenarioLines = aggregateLines(scenarioPeriod?.lines ?? []);
    const lineKeys = Array.from(
      new Set([...baselineLines.keys(), ...scenarioLines.keys()]),
    ).sort();
    const lines: SimulationLineDelta[] = [];

    for (const lineKey of lineKeys) {
      const before = baselineLines.get(lineKey);
      const after = scenarioLines.get(lineKey);
      if (!before && after) {
        lines.push({
          line_key: after.line_key,
          service_id: after.service_id,
          charge_type: after.charge_type,
          service_name: after.service_name,
          kind: 'added',
          delta: after.amount,
        });
      } else if (before && !after) {
        lines.push({
          line_key: before.line_key,
          service_id: before.service_id,
          charge_type: before.charge_type,
          service_name: before.service_name,
          kind: 'removed',
          delta: -before.amount,
        });
      } else if (before && after && before.amount !== after.amount) {
        lines.push({
          line_key: after.line_key,
          service_id: after.service_id,
          charge_type: after.charge_type,
          service_name: after.service_name,
          kind: 'changed',
          delta: after.amount - before.amount,
        });
      }
    }

    return {
      index: scenarioPeriod?.index ?? baselinePeriod?.index ?? index,
      total_delta: (scenarioPeriod?.total ?? 0) - (baselinePeriod?.total ?? 0),
      lines,
    };
  });

  return {
    periods,
    horizon_total_delta: periods.reduce(
      (sum, period) => sum + period.total_delta,
      0,
    ),
  };
}
