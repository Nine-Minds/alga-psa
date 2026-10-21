/**
 * Scenario-backed ContractChargeSource: supplies the shared charge resolver
 * (packages/billing chargeResolution) with data from a ContractScenario, so
 * saved contracts, templates and drafts are simulated by the same selection
 * rules the billing engine applies to live contracts.
 *
 * This file holds no charge-selection rules. Which families a line produces,
 * in which order, which services a pool absorbs from plain hourly pricing and
 * what identity a charge gets all live in the resolver. A source only answers
 * "what is the data": scenario services, scenario pools, simulated pool state.
 *
 * Strictly read-only: it never touches the database, BillingEngine, invoice
 * numbering or TaxService. Tax flows through the read-only ports passed in.
 */

import type {
  ContractScenario,
  IBillingPeriod,
  ScenarioBucketConfig,
  ScenarioLine,
  ScenarioLineService,
  ScenarioPool,
  ScenarioPricingSchedule,
  SimulationDiagnostic,
} from "@alga-psa/types";
import {
  calculateContractBucketPeriodState,
  type ResolvedBillingProfileAssignments,
  type ResolvedBillingTiming,
  type ResolvedContractLineFacts,
} from "@alga-psa/billing/lib/billing/domain";
import type { ChargeComputeTaxContext } from "@alga-psa/billing/lib/billing/compute";
import {
  resolvePoolForService,
  type ConfiguredService,
  type ContractChargeSource,
  type PoolDefinition,
  type PoolPeriodState,
  type ResolutionDiagnostics,
  type PooledTimeExclusion,
  type SuppliedCharge,
  type TaxContextDemand,
  type TimingRequest,
  type TimingResolution,
} from "@alga-psa/billing/lib/billing/chargeResolution";
import { toPlainDate } from "@alga-psa/core";
import { selectActivePricingSchedule } from "@alga-psa/billing/lib/billing/pricing/resolveFixedLineRate";
import {
  buildHourlyServiceConfigMap,
  buildSyntheticTimeEntry,
  buildSyntheticUsageRecord,
  buildUsageServiceConfigMap,
  hasResolvableHourlyRate,
  hasResolvableUsageRate,
  resolveAssumedQuantity,
  syntheticConfigId,
} from "./syntheticActivity";

/** State a simulation run threads across periods (pool rollover, in memory). */
export interface ScenarioRunState {
  poolStates: Map<string, ReturnType<typeof calculateContractBucketPeriodState>>;
}

export function createScenarioRunState(): ScenarioRunState {
  return { poolStates: new Map() };
}

export interface ScenarioChargeSourceInput {
  scenario: ContractScenario;
  line: ScenarioLine;
  lineFacts: ResolvedContractLineFacts;
  client: { client_id: string; is_tax_exempt?: boolean | null };
  billingPeriod: IBillingPeriod;
  /** The line's covered service period for this invoice window. */
  timing: ResolvedBillingTiming;
  periodIndex: number;
  taxPorts: ChargeComputeTaxContext;
  currencyCode: string;
  lineCycle: string;
  diagnostics: SimulationDiagnostic[];
  run: ScenarioRunState;
}

/** A pool as the scenario describes it, whichever way it was declared. */
type ScenarioPoolSpec = Omit<ScenarioPool, "billing_period">;

const isProductService = (service: ScenarioLineService): boolean =>
  service.item_kind === "product";

export class ScenarioChargeSource implements ContractChargeSource {
  readonly line: ResolvedContractLineFacts;
  readonly billingPeriod: IBillingPeriod;
  private poolSpecs: Map<string, ScenarioPoolSpec> | null = null;

  constructor(private readonly input: ScenarioChargeSourceInput) {
    this.line = input.lineFacts;
    this.billingPeriod = input.billingPeriod;
  }

  async client() {
    return {
      clientId: this.input.client.client_id,
      isTaxExempt: this.input.client.is_tax_exempt,
    };
  }

  async resolveTiming(request: TimingRequest): Promise<TimingResolution> {
    if (request.duePosition !== "line") {
      throw new Error(
        `Scenario charge source cannot resolve a "${request.duePosition}" due position; only the line's own position is supported`,
      );
    }
    // The caller only builds a source for a service period that is inside the
    // contract's active window, so the line is always due here.
    return { status: "due", timing: this.input.timing };
  }

  async taxContext(_demand: TaxContextDemand): Promise<ChargeComputeTaxContext> {
    return this.input.taxPorts;
  }

  async billingProfile(): Promise<ResolvedBillingProfileAssignments | null> {
    return null;
  }

  /* -------------------------------------------------------------- */
  /* Pools                                                          */
  /* -------------------------------------------------------------- */

  /**
   * Pools the scenario describes: the line's own pools first, then pools
   * implied by Bucket-config services (the legacy service bucket config and
   * draft bucket overlays) that no declared pool already covers.
   */
  private specs(): Map<string, ScenarioPoolSpec> {
    if (this.poolSpecs) return this.poolSpecs;
    const { line } = this.input;
    const specs = new Map<string, ScenarioPoolSpec>();
    for (const pool of line.pools ?? []) specs.set(pool.pool_id, pool);
    for (const service of line.services) {
      if (isProductService(service)) continue;
      const config = service.configuration;
      if (config.configuration_type !== "Bucket") continue;
      if (config.pool_id && specs.has(config.pool_id)) continue;
      const poolId =
        config.pool_id ?? syntheticConfigId(line.key, service.service_id);
      if (specs.has(poolId)) continue;
      specs.set(poolId, bucketConfigPool(poolId, service, config));
    }
    this.poolSpecs = specs;
    return specs;
  }

  async pools(): Promise<PoolDefinition[]> {
    return Array.from(this.specs().values()).map((spec) => ({
      poolId: spec.pool_id,
      contractLineId: this.input.line.key,
      coversAllServices: spec.covers_all_services,
      memberServiceIds: spec.members.map((member) => member.service_id),
    }));
  }

  async configuredServiceIds(): Promise<string[]> {
    return Array.from(
      new Set(
        this.input.line.services
          .filter((service) => !isProductService(service))
          .map((service) => service.service_id),
      ),
    );
  }

  async configuredServices(): Promise<ConfiguredService[] | null> {
    return this.input.line.services
      .filter((service) => !isProductService(service))
      .map((service) => ({
        serviceId: service.service_id,
        configurationType: service.configuration.configuration_type ?? null,
      }));
  }

  /** The simulator must fail loudly: it cannot show a charge it cannot price. */
  reportUnhandled(diagnostics: ResolutionDiagnostics): void {
    const lineId = this.line.clientContractLineId;
    if (diagnostics.unhandledLineType) {
      throw new Error(
        `Contract line ${lineId} has contract_line_type "${diagnostics.unhandledLineType}", which no charge family handles`,
      );
    }
    const detail = diagnostics.unhandledServices
      .map(
        (service) =>
          `service ${service.serviceId} (configuration_type "${service.configurationType ?? "null"}")`,
      )
      .join("; ");
    throw new Error(
      `Contract line ${lineId} (contract_line_type "${this.line.contractLineType ?? "unknown"}") configures services no charge family handles: ${detail}`,
    );
  }

  async poolPeriodState(
    pool: PoolDefinition,
    timing: ResolvedBillingTiming | undefined,
  ): Promise<PoolPeriodState> {
    const { scenario, line, run, periodIndex } = this.input;
    const spec = this.specs().get(pool.poolId);
    if (!spec) throw new Error(`Pool ${pool.poolId} was not described by pools()`);
    if (!timing) {
      throw new Error("Scenario pools are only simulated for a timed service period");
    }
    const definitions = await this.pools();
    const configured = new Set(await this.configuredServiceIds());
    const isUsagePool = line.contract_line_type === "Usage";

    // Every service the pool absorbs burns its assumed activity into it,
    // weighted by its membership multiplier (1x for a catch-all non-member).
    const contributors: Array<{
      service: ScenarioLineService;
      weightedMinutes: number;
    }> = [];
    const seen = new Set<string>();
    for (const service of line.services) {
      if (isProductService(service) || seen.has(service.service_id)) continue;
      seen.add(service.service_id);
      if (
        resolvePoolForService(definitions, configured, service.service_id)
          ?.poolId !== pool.poolId
      ) {
        continue;
      }
      const assumed = Math.max(
        0,
        resolveAssumedQuantity(
          scenario.assumptions,
          line.key,
          service.service_id,
          periodIndex,
        ),
      );
      const multiplier =
        spec.members.find((member) => member.service_id === service.service_id)
          ?.burn_multiplier ?? 1;
      contributors.push({
        service,
        weightedMinutes: (isUsagePool ? assumed : assumed * 60) * multiplier,
      });
    }
    const consumedQuantity = contributors.reduce(
      (sum, contributor) => sum + contributor.weightedMinutes,
      0,
    );

    const stateKey = `${line.key}:${pool.poolId}`;
    const state = calculateContractBucketPeriodState({
      includedQuantity: spec.total_minutes,
      consumedQuantity,
      allowRollover: spec.allow_rollover,
      previousState: run.poolStates.get(stateKey) ?? null,
    });
    run.poolStates.set(stateKey, state);

    // Pool identity on the charge: the first explicit member, else the first
    // service the pool absorbs.
    const memberIds = new Set(spec.members.map((member) => member.service_id));
    const first =
      contributors.find((c) => memberIds.has(c.service.service_id))?.service ??
      line.services.find(
        (service) =>
          !isProductService(service) && memberIds.has(service.service_id),
      ) ??
      contributors[0]?.service;
    const unit = isUsagePool
      ? usageUnitForPool(line, first?.service_id)
      : "hours";
    // LEVERAGE: pattern after-hours-not-simulated — the simulator has no time-of-day activity, so a pool's after-hours multiplier only flags the pool as weighted; the engine burns each entry by its own clock time. Needs a source-supplied time-of-day assumption.
    const weighted =
      Number(spec.after_hours_multiplier) !== 0 ||
      spec.members.some((member) => member.burn_multiplier !== 1);

    return {
      pool,
      configuration: {
        configurationId: pool.poolId,
        serviceId: first?.service_id ?? null,
        serviceName:
          spec.pool_name ??
          (memberIds.size === 1 && first
            ? first.service_name
            : `Bucket pool ${pool.poolId.slice(0, 8)}`),
        taxRateId: first?.tax_rate_id ?? null,
        unitOfMeasure: unit,
        billingMethod: isUsagePool ? "usage" : "hourly",
        includedMinutes: spec.total_minutes,
        overageRate: spec.overage_rate,
        allowRollover: spec.allow_rollover,
        weighted,
      },
      periodContributions: [
        {
          start: timing.servicePeriodStart,
          end: timing.servicePeriodEnd,
          services: contributors
            .filter((contributor) => contributor.weightedMinutes > 0)
            .map((contributor) => ({
              serviceId: contributor.service.service_id,
              serviceName: spec.pool_name ?? contributor.service.service_name,
              taxRateId: contributor.service.tax_rate_id,
              unitOfMeasure: unit,
              billingMethod: isUsagePool ? "usage" : "hourly",
              weightedMinutes: contributor.weightedMinutes,
            })),
        },
      ],
      periods: [
        {
          start: timing.servicePeriodStart,
          end: timing.servicePeriodEnd,
          minutesUsed: consumedQuantity,
          overageMinutes: state.overageQuantity,
          rolledOverMinutes: state.rolledOverQuantity,
        },
      ],
      taxRateIds: [
        ...contributors.map((contributor) => contributor.service.tax_rate_id),
        first?.tax_rate_id ?? null,
      ],
      metadata: {
        lineCycle: this.input.lineCycle,
        ...(first ? { serviceId: first.service_id } : {}),
        quantityLabel: isUsagePool
          ? `${unit} overage`
          : "hrs overage",
      },
    };
  }

  /* -------------------------------------------------------------- */
  /* Families                                                       */
  /* -------------------------------------------------------------- */

  async fixed(timing: ResolvedBillingTiming): Promise<SuppliedCharge<"fixed"> | null> {
    const { scenario, line, lineFacts, client, billingPeriod, lineCycle } = this.input;
    const fixedServices = line.services.filter(
      (service) => !isProductService(service) && isFixed(service),
    );
    if (fixedServices.length === 0 && line.contract_line_type !== "Fixed") {
      return null;
    }

    const planServices = fixedServices.map((service) => {
      const config = service.configuration;
      if (config.configuration_type !== "Fixed") {
        throw new Error(
          `Service ${service.service_id} passed to fixed simulation is not Fixed`,
        );
      }
      return {
        service_id: service.service_id,
        service_name: service.service_name,
        default_rate: service.default_rate,
        tax_rate_id: service.tax_rate_id,
        config_id: syntheticConfigId(line.key, service.service_id),
        // Per-unit members keep their raw quantity (0 is an explicit zero);
        // every other fixed member keeps the >= 1 clamped quantity.
        configuration_quantity: isUnit(service)
          ? (service.configuration_quantity ?? service.quantity)
          : service.quantity,
        service_base_rate: config.base_rate,
        pricing_basis: isUnit(service) ? ("unit" as const) : null,
      };
    });

    const { effectiveCustomRate, customRateSource } = resolveEffectiveCustomRate(
      scenario.pricing_schedules,
      line,
      timing,
    );

    return {
      facts: {
        kind: "fixed",
        line: lineFacts,
        client: { clientId: client.client_id, isTaxExempt: client.is_tax_exempt },
        billingPeriod,
        timing,
        contractLine: {
          type: line.contract_line_type,
          customRate: line.custom_rate,
          enableProration: line.enable_proration,
        },
        effectiveCustomRate,
        customRateSource,
        services: planServices.map((service) => ({
          serviceId: service.service_id,
          serviceName: service.service_name,
          defaultRate: service.default_rate,
          taxRateId: service.tax_rate_id,
          configurationId: service.config_id,
          configurationQuantity: service.configuration_quantity,
          baseRate: service.service_base_rate,
          pricingBasis: service.pricing_basis,
        })),
        // The scenario carries the full service list; there is no separate
        // catalog fallback row to load for a hypothetical line.
        fallbackService: null,
      },
      taxContext: this.input.taxPorts,
      metadata: { lineCycle, quantityLabel: cadenceQuantityLabel(lineCycle) },
    };
  }

  async hourly(
    timing: ResolvedBillingTiming,
    exclusion: PooledTimeExclusion | null,
  ): Promise<SuppliedCharge<"hourly"> | null> {
    const { scenario, line, lineFacts, client, billingPeriod, currencyCode, lineCycle, diagnostics } =
      this.input;
    const periodIndex = this.input.periodIndex;
    const pooled = new Set(exclusion?.serviceIds ?? []);
    const hourlyServices = line.services.filter(
      (service) =>
        !isProductService(service) &&
        service.configuration.configuration_type === "Hourly" &&
        !pooled.has(service.service_id),
    );
    const timeEntries = [] as Array<ReturnType<typeof buildSyntheticTimeEntry>>;

    for (const service of hourlyServices) {
      const assumedHours = resolveAssumedQuantity(
        scenario.assumptions,
        line.key,
        service.service_id,
        periodIndex,
      );
      if (!(assumedHours > 0)) continue;

      if (!hasResolvableHourlyRate(service)) {
        if (
          !diagnostics.some(
            (diagnostic) =>
              diagnostic.line_key === line.key &&
              diagnostic.message.startsWith(
                `${service.service_name} has no ${currencyCode} hourly rate`,
              ),
          )
        ) {
          diagnostics.push({
            severity: "warning",
            line_key: line.key,
            message: `${service.service_name} has no ${currencyCode} hourly rate, so its hours are omitted. Add a catalog or service rate to include it.`,
          });
        }
        continue;
      }

      timeEntries.push(
        buildSyntheticTimeEntry({
          line,
          service,
          periodIndex,
          assumedHours,
          servicePeriodStart: timing.servicePeriodStart,
        }),
      );
    }

    if (timeEntries.length === 0) return null;

    const configs = buildHourlyServiceConfigMap(line);
    return {
      facts: {
        kind: "hourly",
        line: lineFacts,
        client: { clientId: client.client_id, isTaxExempt: client.is_tax_exempt },
        billingPeriod,
        timing,
        overtime: {
          enabled: line.enable_overtime,
          threshold: line.overtime_threshold,
          rate: line.overtime_rate,
        },
        serviceConfigurations: Array.from(configs, ([serviceId, value]) => ({
          serviceId,
          configurationId: value.config.config_id,
          hourlyRate: value.config.hourly_rate,
          minimumBillableTime: value.config.minimum_billable_time,
          roundUpToNearest: value.config.round_up_to_nearest,
          userTypeRates: Array.from(value.userTypeRates, ([userType, rate]) => ({
            userType,
            rate,
          })),
        })),
        activity: timeEntries.map((entry) => ({
          sourceId: entry.entry_id,
          userId: entry.user_id,
          userType: entry.user_type,
          start: entry.start_time.toISOString(),
          end: entry.end_time.toISOString(),
          serviceId: entry.service_id,
          serviceName: entry.service_name,
          taxRateId: entry.tax_rate_id,
          customRate: entry.custom_rate,
          currencyRate: entry.currency_rate,
          billableMinutes: entry.billable_duration,
        })),
      },
      taxContext: this.input.taxPorts,
      metadata: { lineCycle, quantityLabel: "hrs" },
    };
  }

  // LEVERAGE: pattern usage-pooled-exclusion — neither source excludes pool-absorbed usage from the plain usage charge the way hourly excludes pooled time (PooledTimeExclusion is hourly-only); a Usage-line pool and its plain usage charge can both bill.
  async usage(timing: ResolvedBillingTiming): Promise<SuppliedCharge<"usage"> | null> {
    const { scenario, line, lineFacts, client, billingPeriod, currencyCode, lineCycle, diagnostics } =
      this.input;
    const periodIndex = this.input.periodIndex;
    const usageServices = line.services.filter(
      (service) =>
        !isProductService(service) &&
        service.configuration.configuration_type === "Usage",
    );
    const usageRecords = [] as Array<ReturnType<typeof buildSyntheticUsageRecord>>;

    for (const service of usageServices) {
      const assumedQuantity = resolveAssumedQuantity(
        scenario.assumptions,
        line.key,
        service.service_id,
        periodIndex,
      );
      if (!(assumedQuantity > 0)) continue;
      if (!hasResolvableUsageRate(service)) {
        if (
          !diagnostics.some(
            (diagnostic) =>
              diagnostic.line_key === line.key &&
              diagnostic.message.startsWith(
                `${service.service_name} has no ${currencyCode} usage rate`,
              ),
          )
        ) {
          diagnostics.push({
            severity: "warning",
            line_key: line.key,
            message: `${service.service_name} has no ${currencyCode} usage rate, so its activity is omitted. Add a catalog or service rate to include it.`,
          });
        }
        continue;
      }
      usageRecords.push(
        buildSyntheticUsageRecord({ line, service, periodIndex, assumedQuantity }),
      );
    }
    if (usageRecords.length === 0) return null;

    const configs = buildUsageServiceConfigMap(line);
    return {
      facts: {
        kind: "usage",
        line: lineFacts,
        client: { clientId: client.client_id, isTaxExempt: client.is_tax_exempt },
        billingPeriod,
        timing,
        serviceConfigurations: Array.from(configs, ([serviceId, value]) => ({
          serviceId,
          configurationId: value.config.config_id,
          customRate: value.config.custom_rate,
          minimumUsage: value.config.minimum_usage,
          tieredPricing: value.config.enable_tiered_pricing,
          tiers: value.rateTiers.map((tier) => ({
            minimum: tier.min_quantity,
            maximum: tier.max_quantity,
            rate: tier.rate,
          })),
        })),
        activity: usageRecords.map((record) => ({
          sourceId: record.usage_id,
          serviceId: record.service_id,
          serviceName: record.service_name,
          quantity: record.quantity,
          taxRateId: record.tax_rate_id,
          currencyRate: record.currency_rate,
        })),
      },
      taxContext: this.input.taxPorts,
      metadata: { lineCycle, quantityLabel: "units" },
    };
  }

  async recurringQuantity(
    kind: "product" | "license",
    timing: ResolvedBillingTiming,
  ): Promise<SuppliedCharge<"product" | "license"> | null> {
    const { line, lineFacts, client, lineCycle } = this.input;
    const priceable = uniqueProductServices(line.services).filter(
      (service) =>
        service.is_license === (kind === "license") &&
        hasRecurringQuantityPrice(service),
    );
    if (priceable.length === 0) return null;

    return {
      facts: {
        kind,
        line: lineFacts,
        client: { clientId: client.client_id, isTaxExempt: client.is_tax_exempt },
        timing,
        services: priceable.map((service) => ({
          serviceId: service.service_id,
          serviceName: service.service_name,
          defaultRate: service.legacy_default_rate,
          taxRateId: service.tax_rate_id,
          configurationId:
            service.configuration_id ??
            syntheticConfigId(line.key, service.service_id),
          serviceQuantity: service.service_quantity,
          serviceCustomRate: service.service_custom_rate,
          configurationQuantity:
            service.configuration_quantity ?? service.quantity,
          configurationCustomRate:
            service.configuration_custom_rate ?? service.custom_rate,
          priceRate: service.default_rate,
        })),
      },
      taxContext: this.input.taxPorts,
      metadata: { lineCycle, quantityLabel: "units" },
    };
  }
}

/* ------------------------------------------------------------------ */
/* Fixed-line rate                                                    */
/* ------------------------------------------------------------------ */

/**
 * Mirrors the engine's load-phase pricing-schedule selection: among schedules
 * overlapping the due service period (effective_date < servicePeriodEndExclusive
 * AND (end_date null OR end_date > servicePeriodStartExclusive)) the latest
 * effective_date wins; its custom_rate applies only when non-null (a null-rate
 * latest schedule does NOT fall back to earlier schedules, matching the
 * engine's `.first()` + null check). Otherwise the assignment custom rate.
 */
function resolveEffectiveCustomRate(
  schedules: ScenarioPricingSchedule[],
  line: ScenarioLine,
  timing: ResolvedBillingTiming,
): {
  effectiveCustomRate: number | null;
  customRateSource: "pricing_schedule" | "assignment" | null;
} {
  const periodStart = toPlainDate(timing.servicePeriodStartExclusive);
  const periodEndExclusive = toPlainDate(timing.servicePeriodEndExclusive);

  const latest = selectActivePricingSchedule(
    schedules.map((schedule) => ({
      schedule_id: null,
      contract_line_id: null,
      effective_date: schedule.effective_date,
      end_date: schedule.end_date,
      custom_rate: schedule.custom_rate,
    })),
    line.key,
    { start: periodStart.toString(), end: periodEndExclusive.toString() },
  );

  if (latest && latest.custom_rate != null) {
    return {
      effectiveCustomRate: Number(latest.custom_rate),
      customRateSource: "pricing_schedule",
    };
  }

  if (line.custom_rate != null) {
    return {
      effectiveCustomRate: line.custom_rate,
      customRateSource: "assignment",
    };
  }

  return { effectiveCustomRate: null, customRateSource: null };
}

/* ------------------------------------------------------------------ */
/* Scenario helpers                                                   */
/* ------------------------------------------------------------------ */

function bucketConfigPool(
  poolId: string,
  service: ScenarioLineService,
  config: ScenarioBucketConfig,
): ScenarioPoolSpec {
  return {
    pool_id: poolId,
    pool_name: config.pool_name ?? null,
    covers_all_services: Boolean(config.covers_all_services),
    total_minutes: config.total_minutes,
    overage_rate: config.overage_rate,
    allow_rollover: config.allow_rollover,
    after_hours_multiplier: config.after_hours_multiplier ?? null,
    business_hours_schedule_id: config.business_hours_schedule_id ?? null,
    members:
      config.is_pool_member === false
        ? []
        : [
            {
              service_id: service.service_id,
              burn_multiplier: config.burn_multiplier ?? 1,
            },
          ],
  };
}

export function uniqueProductServices(
  services: ScenarioLineService[],
): ScenarioLineService[] {
  const byServiceId = new Map<string, ScenarioLineService>();
  for (const service of services) {
    if (!isProductService(service)) continue;
    // A product can appear twice (primary plus a pool overlay copy); the
    // primary comes first and carries the same pricing facts.
    if (!byServiceId.has(service.service_id)) {
      byServiceId.set(service.service_id, service);
    }
  }
  return Array.from(byServiceId.values());
}

export function hasRecurringQuantityPrice(service: ScenarioLineService): boolean {
  return service.custom_rate != null || service.default_rate != null;
}

function isFixed(service: ScenarioLineService): boolean {
  return service.configuration.configuration_type === "Fixed";
}

function isUnit(service: ScenarioLineService): boolean {
  return (
    service.configuration.configuration_type === "Fixed" &&
    service.configuration.pricing_basis === "unit"
  );
}

function usageUnitForPool(line: ScenarioLine, serviceId: string | undefined): string {
  const usageConfig = line.services.find(
    (service) =>
      service.service_id === serviceId &&
      service.configuration.configuration_type === "Usage",
  )?.configuration;
  return usageConfig?.configuration_type === "Usage"
    ? usageConfig.unit_of_measure
    : "units";
}

function cadenceQuantityLabel(lineCycle: string): string {
  switch (lineCycle) {
    case "quarterly":
      return "3 months";
    case "semi-annually":
      return "6 months";
    case "annually":
      return "12 months";
    default:
      return "1 month";
  }
}
