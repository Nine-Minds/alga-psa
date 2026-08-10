/**
 * Synthetic activity expansion for the contract simulator: turns scenario
 * assumptions ("20 hrs/mo of remote support") into the activity rows the
 * shared pure compute layer expects, so assumed work is priced by exactly the
 * code that prices real approved time entries.
 */

import type {
  ISO8601String,
  ScenarioAssumption,
  ScenarioHourlyConfig,
  ScenarioLine,
  ScenarioLineService,
  ScenarioUsageConfig,
} from '@alga-psa/types';
import { toISODate, toPlainDate } from '@alga-psa/core';
import type {
  HourlyServiceConfigEntry,
  TimeEntryComputeRow,
  UsageRecordComputeRow,
  UsageServiceConfigEntry,
} from '@alga-psa/billing/lib/billing/compute';

export function assumptionKey(lineKey: string, serviceId: string): string {
  return `${lineKey}:${serviceId}`;
}

/** Synthetic stable config id for a scenario line service. */
export function syntheticConfigId(lineKey: string, serviceId: string): string {
  return `${lineKey}:${serviceId}`;
}

/**
 * Resolves the assumed quantity (hours or units) for one line service in one
 * invoice period: the sparse per-period override wins over the flat value.
 */
export function resolveAssumedQuantity(
  assumptions: Record<string, ScenarioAssumption>,
  lineKey: string,
  serviceId: string,
  periodIndex: number,
): number {
  const assumption = assumptions[assumptionKey(lineKey, serviceId)];
  if (!assumption) {
    return 0;
  }
  return assumption.overrides?.[periodIndex] ?? assumption.flat;
}

export interface SyntheticTimeEntryInput {
  line: ScenarioLine;
  service: ScenarioLineService;
  periodIndex: number;
  assumedHours: number;
  /** Covered service-period start ('YYYY-MM-DD' or midnight timestamp). */
  servicePeriodStart: ISO8601String;
}

/**
 * One synthetic aggregate time entry per hourly service per period: the
 * period's assumed hours as a single block starting at the service period
 * start (it may span days). The authoritative billable minutes are the
 * assumed hours converted to minutes; start/end remain only for billing-window
 * eligibility. Rate resolution mirrors production time-entry pricing: the
 * entry custom_rate carries the contract's hourly config rate (or the
 * service-level custom rate), and currency_rate carries the
 * currency-resolved catalog rate as the fallback — the same precedence
 * computeTimeBasedCharges applies to real entries.
 */
export function buildSyntheticTimeEntry(
  input: SyntheticTimeEntryInput,
): TimeEntryComputeRow {
  const { line, service, periodIndex, assumedHours, servicePeriodStart } = input;
  if (!(assumedHours > 0)) {
    throw new Error(
      `Synthetic time entries require positive assumed hours; got ${assumedHours} ` +
        `for service ${service.service_id} on line ${line.key}`,
    );
  }
  const hourly = expectHourlyConfig(service);

  const start = new Date(
    `${toISODate(toPlainDate(servicePeriodStart))}T00:00:00Z`,
  );
  const end = new Date(start.getTime() + assumedHours * 3_600_000);

  return {
    entry_id: `sim-${line.key}-${service.service_id}-${periodIndex}`,
    user_id: 'simulated-user',
    user_type: null,
    start_time: start,
    end_time: end,
    service_id: service.service_id,
    service_name: service.service_name,
    tax_rate_id: service.tax_rate_id,
    custom_rate: hourly.hourly_rate ?? service.custom_rate ?? null,
    currency_rate: service.default_rate,
    billable_duration: assumedHours * 60,
  };
}

/**
 * Hourly service config map for computeTimeBasedCharges, built from scenario
 * configuration instead of contract_line_service_hourly_config rows.
 *
 * Note (v1 semantics): minimum_billable_time and round_up_to_nearest are
 * per-entry rules. Applying them to a single synthetic aggregate entry would
 * distort an aggregate of many real entries, but v1 deliberately treats the
 * period's assumed hours as ONE block of work — matching the "flat
 * assumptions" model — so the rules apply once to that block.
 */
export function buildHourlyServiceConfigMap(
  line: ScenarioLine,
): Map<string, HourlyServiceConfigEntry> {
  const configMap = new Map<string, HourlyServiceConfigEntry>();

  for (const service of line.services) {
    if (service.configuration.configuration_type !== 'Hourly') {
      continue;
    }
    const hourly = service.configuration;

    configMap.set(service.service_id, {
      config: {
        config_id: syntheticConfigId(line.key, service.service_id),
        hourly_rate: hourly.hourly_rate ?? 0,
        minimum_billable_time: hourly.minimum_billable_time ?? 0,
        round_up_to_nearest: hourly.round_up_to_nearest ?? 0,
      },
      userTypeRates: new Map(
        hourly.user_type_rates.map((rate) => [rate.user_type, rate.rate]),
      ),
    });
  }

  return configMap;
}

export function buildSyntheticUsageRecord(input: {
  line: ScenarioLine;
  service: ScenarioLineService;
  periodIndex: number;
  assumedQuantity: number;
}): UsageRecordComputeRow {
  const { line, service, periodIndex, assumedQuantity } = input;
  if (!(assumedQuantity > 0)) {
    throw new Error(
      `Synthetic usage records require a positive quantity; got ${assumedQuantity} ` +
        `for service ${service.service_id} on line ${line.key}`,
    );
  }
  expectUsageConfig(service);
  return {
    usage_id: `sim-${line.key}-${service.service_id}-${periodIndex}`,
    service_id: service.service_id,
    service_name: service.service_name,
    quantity: assumedQuantity,
    tax_rate_id: service.tax_rate_id,
    currency_rate: service.default_rate,
  };
}

export function buildUsageServiceConfigMap(
  line: ScenarioLine,
): Map<string, UsageServiceConfigEntry> {
  const configMap = new Map<string, UsageServiceConfigEntry>();
  for (const service of line.services) {
    if (service.configuration.configuration_type !== 'Usage') continue;
    const usage = service.configuration;
    configMap.set(service.service_id, {
      config: {
        config_id: syntheticConfigId(line.key, service.service_id),
        custom_rate: service.custom_rate ?? usage.base_rate,
        minimum_usage: usage.minimum_usage,
        enable_tiered_pricing: usage.enable_tiered_pricing,
      },
      rateTiers: usage.tiers,
    });
  }
  return configMap;
}

export function hasResolvableUsageRate(service: ScenarioLineService): boolean {
  const usage = expectUsageConfig(service);
  return (
    service.custom_rate != null ||
    usage.base_rate != null ||
    service.default_rate != null ||
    (usage.enable_tiered_pricing && usage.tiers.length > 0)
  );
}

/**
 * True when the service's assumed hours can be priced: computeTimeBasedCharges
 * fails fast on entries with no resolvable rate, so the simulator pre-checks
 * and surfaces a diagnostic instead of aborting the whole timeline.
 */
export function hasResolvableHourlyRate(service: ScenarioLineService): boolean {
  const hourly = expectHourlyConfig(service);
  return (
    hourly.hourly_rate != null ||
    service.custom_rate != null ||
    service.default_rate != null
  );
}

function expectHourlyConfig(service: ScenarioLineService): ScenarioHourlyConfig {
  if (service.configuration.configuration_type !== 'Hourly') {
    throw new Error(
      `Service ${service.service_id} is configured as ` +
        `${service.configuration.configuration_type}, not Hourly`,
    );
  }
  return service.configuration;
}

function expectUsageConfig(service: ScenarioLineService): ScenarioUsageConfig {
  if (service.configuration.configuration_type !== 'Usage') {
    throw new Error(
      `Service ${service.service_id} is configured as ` +
        `${service.configuration.configuration_type}, not Usage`,
    );
  }
  return service.configuration;
}
