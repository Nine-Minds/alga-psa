import type {
  ChargeExplanation,
  IBillingPeriod,
  IBucketCharge,
  IClientContractLine,
  ISO8601String,
} from "@alga-psa/types";
import type { ChargeComputeClient, ChargeComputeTaxPorts } from "./types";

/**
 * A persisted bucket_usage row, or its in-memory simulator equivalent.
 * The schema uses minute-named columns for both time buckets and generic
 * usage buckets; for usage buckets these values are quantities, not minutes.
 */
export interface BucketUsageComputeRow {
  /** ISO string when simulated; the pg driver returns Date for persisted rows. */
  period_start?: ISO8601String | Date | null;
  period_end?: ISO8601String | Date | null;
  minutes_used?: number | string | null;
  hours_used?: number | string | null;
  overage_minutes?: number | string | null;
  overage_hours?: number | string | null;
  rolled_over_minutes?: number | string | null;
}

export interface BucketServiceComputeConfig {
  config_id: string;
  service_id: string;
  service_name: string;
  tax_rate_id?: string | null;
  unit_of_measure?: string | null;
  billing_method?: string | null;
  /** Minutes for time buckets; generic units for usage buckets. */
  total_minutes?: number | string | null;
  total_hours?: number | string | null;
  /** Cents per hour for time buckets; cents per unit for usage buckets. */
  overage_rate: number | string;
  allow_rollover?: boolean | null;
  /**
   * True when any member multiplier ≠ 1 or an after-hours rule contributed to
   * the consumed (weighted) minutes. Only cosmetic — drives the "weighted hrs"
   * unit label in explanations.
   */
  isWeighted?: boolean | null;
}

export interface BucketPeriodState {
  /** Allowance authored on the bucket configuration. */
  includedQuantity: number;
  /** Unused base allowance carried from the immediately previous period. */
  rolledOverQuantity: number;
  availableQuantity: number;
  consumedQuantity: number;
  overageQuantity: number;
}

export interface ComputeBucketPeriodStateInputs {
  includedQuantity: number;
  consumedQuantity: number;
  allowRollover: boolean;
  previousState?: BucketPeriodState | null;
  /** Production can supply the persisted rollover for an already materialized period. */
  rolledOverQuantity?: number | null;
}

/**
 * Reproduces bucketUsageService's state transition without persistence.
 * Rollover is deliberately limited to unused base allowance from the prior
 * period; previously rolled allowance does not compound into another period.
 */
export function computeBucketPeriodState(
  inputs: ComputeBucketPeriodStateInputs,
): BucketPeriodState {
  const includedQuantity = Math.max(0, Number(inputs.includedQuantity) || 0);
  const consumedQuantity = Math.max(0, Number(inputs.consumedQuantity) || 0);
  const computedRollover =
    inputs.allowRollover && inputs.previousState
      ? Math.max(
          0,
          inputs.previousState.includedQuantity -
            inputs.previousState.consumedQuantity,
        )
      : 0;
  const rolledOverQuantity = Math.max(
    0,
    Number(inputs.rolledOverQuantity ?? computedRollover) || 0,
  );
  const availableQuantity = includedQuantity + rolledOverQuantity;

  return {
    includedQuantity,
    rolledOverQuantity,
    availableQuantity,
    consumedQuantity,
    overageQuantity: Math.max(0, consumedQuantity - availableQuantity),
  };
}

export interface BucketChargeComputeInputs {
  billingPeriod: IBillingPeriod;
  clientContractLine: IClientContractLine;
  client: ChargeComputeClient;
  config: BucketServiceComputeConfig;
  usageRecords: BucketUsageComputeRow[];
  contractCurrency: string;
}

export interface BucketChargeComputeResult {
  charges: IBucketCharge[];
  explanations: ChargeExplanation[];
  states: BucketPeriodState[];
}

interface AggregatedBucketPeriod {
  periodStart: ISO8601String;
  periodEnd: ISO8601String;
  consumedQuantity: number;
  persistedRollover: number;
}

function numberOrZero(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCents(cents: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
  }).format(cents / 100);
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
}

function toDateOnly(value: ISO8601String | Date | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10);
}

function aggregateUsagePeriods(
  usageRecords: BucketUsageComputeRow[],
  billingPeriod: IBillingPeriod,
): AggregatedBucketPeriod[] {
  const byPeriod = new Map<string, AggregatedBucketPeriod>();
  const fallbackStart = billingPeriod.startDate.slice(0, 10);
  const fallbackEndDate = new Date(billingPeriod.endDate);
  fallbackEndDate.setUTCDate(fallbackEndDate.getUTCDate() - 1);
  const fallbackEnd = fallbackEndDate.toISOString().slice(0, 10);

  for (const record of usageRecords) {
    const periodStart = toDateOnly(record.period_start) ?? fallbackStart;
    const periodEnd = toDateOnly(record.period_end) ?? fallbackEnd;
    const key = `${periodStart}:${periodEnd}`;
    const existing = byPeriod.get(key) ?? {
      periodStart,
      periodEnd,
      consumedQuantity: 0,
      persistedRollover: 0,
    };
    const consumed =
      numberOrZero(record.minutes_used) || numberOrZero(record.hours_used) * 60;
    existing.consumedQuantity += consumed;
    // Multiple activity rows may point at one allowance record. Rollover is
    // period state, not activity, so retain the greatest observed value rather
    // than summing it.
    existing.persistedRollover = Math.max(
      existing.persistedRollover,
      numberOrZero(record.rolled_over_minutes),
    );
    byPeriod.set(key, existing);
  }

  return Array.from(byPeriod.values()).sort((left, right) =>
    left.periodStart.localeCompare(right.periodStart),
  );
}

export function computeBucketCharges(
  inputs: BucketChargeComputeInputs,
  taxPorts: ChargeComputeTaxPorts,
): BucketChargeComputeResult {
  const {
    billingPeriod,
    clientContractLine,
    client,
    config,
    usageRecords,
    contractCurrency,
  } = inputs;
  const isUsageBucket =
    clientContractLine.contract_line_type === "Usage" ||
    config.billing_method === "usage";
  const includedQuantity = isUsageBucket
    ? numberOrZero(config.total_minutes)
    : numberOrZero(config.total_minutes) ||
      numberOrZero(config.total_hours) * 60;
  const overageRate = Math.ceil(numberOrZero(config.overage_rate));
  const charges: IBucketCharge[] = [];
  const explanations: ChargeExplanation[] = [];
  const states: BucketPeriodState[] = [];

  for (const period of aggregateUsagePeriods(usageRecords, billingPeriod)) {
    const state = computeBucketPeriodState({
      includedQuantity,
      consumedQuantity: period.consumedQuantity,
      allowRollover: Boolean(config.allow_rollover),
      rolledOverQuantity: period.persistedRollover,
    });
    states.push(state);

    const billedOverage = isUsageBucket
      ? state.overageQuantity
      : state.overageQuantity / 60;
    if (billedOverage <= 0) continue;

    const total = Math.ceil(billedOverage * overageRate);
    const { taxRegion: serviceTaxRegion, isTaxable } =
      taxPorts.getTaxInfoFromService({
        service_id: config.service_id,
        tax_rate_id: config.tax_rate_id,
      });
    const effectiveTaxRegion =
      serviceTaxRegion ??
      taxPorts.getLocationTaxRegionCode(clientContractLine.location_id) ??
      taxPorts.getClientDefaultTaxRegionCode(client.client_id) ??
      undefined;

    let taxAmount = 0;
    let taxRate = 0;
    if (!client.is_tax_exempt && isTaxable && effectiveTaxRegion) {
      try {
        const taxResult = taxPorts.calculateTax(
          client.client_id,
          total,
          period.periodEnd,
          effectiveTaxRegion,
          true,
          clientContractLine.currency_code || "USD",
        );
        taxRate = taxResult.taxRate;
        taxAmount = taxResult.taxAmount;
      } catch (error) {
        console.error(
          `Error calculating initial tax for bucket service ${config.service_id}:`,
          error,
        );
      }
    }

    const hoursUsed = state.consumedQuantity / 60;
    const overageHours = state.overageQuantity / 60;
    charges.push({
      type: "bucket",
      service_catalog_id: config.service_id,
      serviceName: config.service_name,
      client_contract_line_id: clientContractLine.client_contract_line_id,
      rate: overageRate,
      total,
      hoursUsed,
      overageHours,
      overageRate,
      quantity: isUsageBucket ? state.overageQuantity : undefined,
      isUsageBucket,
      unitOfMeasure: config.unit_of_measure ?? null,
      unitsUsed: isUsageBucket ? state.consumedQuantity : undefined,
      includedUnits: isUsageBucket ? state.availableQuantity : undefined,
      overageUnits: isUsageBucket ? state.overageQuantity : undefined,
      tax_rate: taxRate,
      tax_region: effectiveTaxRegion,
      serviceId: config.service_id,
      config_id: config.config_id,
      tax_amount: taxAmount,
      is_taxable: isTaxable,
      servicePeriodStart: period.periodStart,
      servicePeriodEnd: period.periodEnd,
      billingTiming: "arrears",
      client_contract_id: clientContractLine.client_contract_id || undefined,
      contract_name: clientContractLine.contract_name || undefined,
      location_id: clientContractLine.location_id ?? null,
    });

    const displayDivisor = isUsageBucket ? 1 : 60;
    const baseUnit = isUsageBucket ? config.unit_of_measure || "units" : "hrs";
    // When any multiplier ≠ 1 or an after-hours rule contributed, the consumed
    // minutes are weighted — name the unit so readers know the burn is weighted.
    const unit = config.isWeighted && !isUsageBucket ? "weighted hrs" : baseUnit;
    const used = state.consumedQuantity / displayDivisor;
    const included = state.includedQuantity / displayDivisor;
    const rollover = state.rolledOverQuantity / displayDivisor;
    const overage = state.overageQuantity / displayDivisor;
    explanations.push({
      chargeKey: `${config.config_id}:${config.service_id}:${period.periodStart}:${period.periodEnd}`,
      serviceName: config.service_name,
      chargeType: "bucket",
      inputs: [
        { label: "Consumed", value: `${formatQuantity(used)} ${unit}` },
        { label: "Included", value: `${formatQuantity(included)} ${unit}` },
        { label: "Rollover", value: `${formatQuantity(rollover)} ${unit}` },
        {
          label: "Overage rate",
          value: formatCents(overageRate, contractCurrency),
        },
      ],
      steps: [
        `${formatQuantity(used)} − (${formatQuantity(included)} + ${formatQuantity(rollover)}) = ${formatQuantity(overage)} ${unit} overage`,
        `${formatQuantity(overage)} × ${formatCents(overageRate, contractCurrency)} = ${formatCents(total, contractCurrency)}`,
      ],
      note:
        rollover > 0
          ? "Unused base allowance from the previous period was applied before overage."
          : undefined,
      markers: ["bucket_overage"],
    });
  }

  return { charges, explanations, states };
}
