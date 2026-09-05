import type {
  ChargeExplanation,
  IBillingPeriod,
  IBucketCharge,
  IClientContractLine,
  ISO8601String,
} from "@alga-psa/types";
import type {
  ChargeComputeClient,
  ChargeComputeTaxPorts,
  ChargeProfileAssignments,
} from "./types";
import { resolveChargeProfileFor } from "../billingProfileResolution";

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
  /** Null when the pool is dormant (zero members): the pool identity lives on
   * `config_id`, never here — a bucket_id must not masquerade as a service. */
  service_id: string | null;
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

/**
 * One service's weighted burn contribution to a pool period. The billing engine
 * computes these through the same draw set and weighted math the reconciliation
 * uses; overage is then attributed to the services that actually burned it
 * rather than an arbitrary member of the pool.
 */
export interface BucketServiceContribution {
  service_id: string;
  service_name?: string;
  tax_rate_id?: string | null;
  unit_of_measure?: string | null;
  billing_method?: string | null;
  weightedMinutes: number;
}

export interface BucketPeriodContributions {
  periodStart: ISO8601String;
  periodEnd: ISO8601String;
  services: BucketServiceContribution[];
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
  /**
   * bucket_usage carries no segment-bearing field, so bucket charges stop at
   * the contract step of the resolution chain (F027, documented via F070).
   */
  billingProfile?: ChargeProfileAssignments | null;
  /**
   * Per-service weighted contributions, keyed per usage-record period. When
   * supplied, each period's overage charge is attributed to the services that
   * actually burned it (pro-rata by weighted minutes, largest-remainder on
   * cents) instead of an arbitrary pool member. When omitted, the legacy
   * config-keyed single aggregate charge is produced unchanged. Supplied-but-
   * empty for a period (overage recorded with no attributable weighted burn)
   * yields the null-service-FK single charge the engine keys for that edge.
   */
  serviceContributions?: BucketPeriodContributions[];
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

/** One emit-ready slice of a pool-period's overage charge. */
interface OveragePortion {
  serviceId: string | null;
  serviceName: string;
  taxRateId: string | null;
  unitOfMeasure: string | null;
  billingMethod: string | null;
  /** Fraction of the pool overage this portion carries (0..1). */
  share: number;
  totalCents: number;
}

/**
 * Split a pool-period's overage charge across the contributing services
 * pro-rata by weighted minutes, with largest-remainder rounding on cents so the
 * portions sum exactly to `totalCents` (no drift). Ordering of the returned
 * portions follows the input order.
 */
function apportionOverage(
  totalCents: number,
  contributors: BucketServiceContribution[],
): OveragePortion[] {
  const totalWeight = contributors.reduce(
    (sum, contributor) => sum + contributor.weightedMinutes,
    0,
  );
  const exactShares = contributors.map((contributor) =>
    totalWeight > 0 ? contributor.weightedMinutes / totalWeight : 0,
  );
  const exactCents = exactShares.map((share) => totalCents * share);
  const floors = exactCents.map(Math.floor);
  let remainder = totalCents - floors.reduce((sum, value) => sum + value, 0);
  const order = contributors
    .map((_, index) => index)
    .sort(
      (left, right) =>
        exactCents[right] -
        floors[right] -
        (exactCents[left] - floors[left]),
    );
  const portionCents = [...floors];
  for (const index of order) {
    if (remainder <= 0) break;
    portionCents[index] += 1;
    remainder -= 1;
  }

  return contributors.map((contributor, index) => ({
    serviceId: contributor.service_id,
    serviceName: contributor.service_name ?? "",
    taxRateId: contributor.tax_rate_id ?? null,
    unitOfMeasure: contributor.unit_of_measure ?? null,
    billingMethod: contributor.billing_method ?? null,
    share: exactShares[index],
    totalCents: portionCents[index],
  }));
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
    billingProfile,
  } = inputs;
  const resolvedProfile = resolveChargeProfileFor(billingProfile);
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

  const serviceContributionsByPeriod = new Map(
    (inputs.serviceContributions ?? []).map((periodContributions) => [
      `${periodContributions.periodStart}:${periodContributions.periodEnd}`,
      periodContributions.services,
    ]),
  );

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

    // Attribute overage metadata by ACTUAL contribution, never member-list
    // position:
    //   2+ contributing services → per-service portions (largest-remainder on
    //     cents, summing exactly to `total`);
    //   1 contributor            → one charge carrying that service's metadata
    //     (a single-member pool's only contributor IS its member, so legacy
    //     migrated pools keep byte-identical output);
    //   0 contributors           → overage recorded with no attributable
    //     weighted burn: keep today's null-service-FK single charge (the engine
    //     keys this edge with a null service_id config).
    // When no contribution data is supplied at all, the config-keyed aggregate
    // charge is produced unchanged (legacy/simulator callers).
    const contributors = (
      serviceContributionsByPeriod.get(`${period.periodStart}:${period.periodEnd}`) ?? []
    ).filter((contribution) => contribution.weightedMinutes > 0);

    // When contribution data is supplied but a period has no attributable
    // weighted burn, the overage charge is today's null-service-FK single
    // charge (the engine keys this edge on the pool, never an invented
    // service). Without contribution data the config-keyed charge is used.
    const hasContributionData = inputs.serviceContributions !== undefined;

    const portions: OveragePortion[] =
      contributors.length > 1
        ? apportionOverage(total, contributors)
        : contributors.length === 1
          ? [
              {
                serviceId: contributors[0].service_id,
                serviceName: contributors[0].service_name || config.service_name,
                taxRateId: contributors[0].tax_rate_id ?? null,
                unitOfMeasure: contributors[0].unit_of_measure ?? null,
                billingMethod: contributors[0].billing_method ?? null,
                share: 1,
                totalCents: total,
              },
            ]
          : hasContributionData
            ? [
                {
                  serviceId: null,
                  serviceName: config.service_name,
                  taxRateId: null,
                  unitOfMeasure: null,
                  billingMethod: null,
                  share: 1,
                  totalCents: total,
                },
              ]
            : [
                {
                  serviceId: config.service_id,
                  serviceName: config.service_name,
                  taxRateId: config.tax_rate_id ?? null,
                  unitOfMeasure: config.unit_of_measure ?? null,
                  billingMethod: config.billing_method ?? null,
                  share: 1,
                  totalCents: total,
                },
              ];

    for (const portion of portions) {
      const { taxRegion: serviceTaxRegion, isTaxable } =
        taxPorts.getTaxInfoFromService({
          service_id: portion.serviceId ?? undefined,
          tax_rate_id: portion.taxRateId,
        });
      const effectiveTaxRegion =
        serviceTaxRegion ??
        taxPorts.getLocationTaxRegionCode(clientContractLine.location_id) ??
        taxPorts.getClientDefaultTaxRegionCode(client.client_id) ??
        undefined;

      let taxAmount = 0;
      let taxRate = 0;
      // Exemption is per billing profile (F131): one invoice can carry both
      // exempt and non-exempt lines when a client holds several legal entities.
      // Passing no profile yields the client-level answer.
      if (
        !taxPorts.isTaxExemptForProfile(resolvedProfile?.billingProfileId) &&
        isTaxable &&
        effectiveTaxRegion
      ) {
        try {
          const taxResult = taxPorts.calculateTax(
            client.client_id,
            portion.totalCents,
            period.periodEnd,
            effectiveTaxRegion,
            true,
            clientContractLine.currency_code || "USD",
            resolvedProfile?.billingProfileId ?? null,
          );
          taxRate = taxResult.taxRate;
          taxAmount = taxResult.taxAmount;
        } catch (error) {
          console.error(
            `Error calculating initial tax for bucket service ${portion.serviceId}:`,
            error,
          );
        }
      }

      // Every per-portion quantity is share-scaled so the portion reads as its
      // own slice of the pool period: hoursUsed/overageHours and (for usage
      // buckets) unitsUsed/includedUnits/overageUnits all carry the same
      // `share`, so the invoice-line derivation `hoursUsed − overageHours`
      // equals this service's prorated included+rollover and the portions sum
      // to the pool-period truth (rather than each claiming the full pool).
      const hoursUsed = (state.consumedQuantity / 60) * portion.share;
      const overageHours = (state.overageQuantity / 60) * portion.share;
      charges.push({
        type: "bucket",
        service_catalog_id: portion.serviceId ?? null,
        serviceName: portion.serviceName || config.service_name,
        client_contract_line_id: clientContractLine.client_contract_line_id,
        rate: overageRate,
        total: portion.totalCents,
        hoursUsed,
        overageHours,
        overageRate,
        quantity: isUsageBucket ? state.overageQuantity * portion.share : undefined,
        isUsageBucket,
        unitOfMeasure: portion.unitOfMeasure ?? null,
        unitsUsed: isUsageBucket ? state.consumedQuantity * portion.share : undefined,
        includedUnits: isUsageBucket ? state.availableQuantity * portion.share : undefined,
        overageUnits: isUsageBucket ? state.overageQuantity * portion.share : undefined,
        tax_rate: taxRate,
        tax_region: effectiveTaxRegion,
        serviceId: portion.serviceId ?? undefined,
        config_id: config.config_id,
        tax_amount: taxAmount,
        is_taxable: isTaxable,
        servicePeriodStart: period.periodStart,
        servicePeriodEnd: period.periodEnd,
        billingTiming: "arrears",
        client_contract_id: clientContractLine.client_contract_id || undefined,
        contract_name: clientContractLine.contract_name || undefined,
        location_id: clientContractLine.location_id ?? null,
        billing_profile_id: resolvedProfile?.billingProfileId ?? null,
        billing_profile_source: resolvedProfile?.source ?? null,
      });

      const displayDivisor = isUsageBucket ? 1 : 60;
      const baseUnit = isUsageBucket ? config.unit_of_measure || "units" : "hrs";
      // When any multiplier ≠ 1 or an after-hours rule contributed, the consumed
      // minutes are weighted — name the unit so readers know the burn is weighted.
      const unit = config.isWeighted && !isUsageBucket ? "weighted hrs" : baseUnit;
      // Share-scaled display values keep the printed equation true for the
      // portion: used − (included + rollover) = overage.
      const used = (state.consumedQuantity / displayDivisor) * portion.share;
      const included = (state.includedQuantity / displayDivisor) * portion.share;
      const rollover = (state.rolledOverQuantity / displayDivisor) * portion.share;
      const overage = (state.overageQuantity / displayDivisor) * portion.share;
      explanations.push({
        chargeKey: `${config.config_id}:${portion.serviceId}:${period.periodStart}:${period.periodEnd}`,
        serviceName: portion.serviceName || config.service_name,
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
          `${formatQuantity(overage)} × ${formatCents(overageRate, contractCurrency)} = ${formatCents(portion.totalCents, contractCurrency)}`,
        ],
        note:
          rollover > 0
            ? "Unused base allowance from the previous period was applied before overage."
            : undefined,
        markers: ["bucket_overage"],
      });
    }
  }

  return { charges, explanations, states };
}
