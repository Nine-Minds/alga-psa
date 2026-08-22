/**
 * EE contract simulation orchestrator: prices a ContractScenario over its
 * horizon through the shared pure billing compute layer.
 *
 * Strictly read-only against the database. This module must never import
 * BillingEngine, invoice generation/numbering, or TaxService (whose
 * calculateTax provisions default client tax settings); all tax/region
 * lookups flow through the read-only ports in ./readOnlyTaxPorts.
 *
 * Fixed, Hourly, Usage, and Bucket service families are priced through shared
 * compute. Bucket allowance state is threaded in memory across the horizon.
 */

import type { Knex } from "knex";
import { Temporal } from "@js-temporal/polyfill";
import type {
  ChargeExplanation,
  ContractScenario,
  ContractSimulationResult,
  IBillingCharge,
  IBillingPeriod,
  IClientContractLine,
  IRecurringActivityWindow,
  IRecurringServicePeriod,
  IRecurringServicePeriodRecord,
  ISO8601String,
  ScenarioBucketConfig,
  ScenarioLine,
  ScenarioLineService,
  ScenarioPricingSchedule,
  SimulatedInvoiceLine,
  SimulatedPeriod,
  SimulatedPeriodMarker,
  SimulationDiagnostic,
} from "@alga-psa/types";
import { RECURRING_RANGE_SEMANTICS } from "@alga-psa/types";
import { toISODate, toPlainDate } from "@alga-psa/core";
import { tenantDb } from "@alga-psa/db";
import {
  calculateServicePeriodCoverage,
  intersectActivityWindow,
} from "@alga-psa/shared/billingClients/recurringTiming";
import {
  computeBucketPeriodState,
  type BucketPeriodState,
  type ChargeComputeClient,
  type ChargeComputeTaxPorts,
  type ChargeComputeTiming,
  type FixedPlanServiceRow,
  type TimeEntryComputeRow,
  type UsageRecordComputeRow,
} from "@alga-psa/billing/lib/billing/compute";
import {
  assignServicePeriodsToInvoicePeriods,
  buildInvoicePeriods,
  generateLineServicePeriods,
  isSupportedBillingFrequency,
  monthsPerCycle,
  normalizeBillingCycle,
  type SimulatedInvoicePeriodWindow,
} from "./hypotheticalPeriods";
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
import { createReadOnlyTaxPorts } from "./readOnlyTaxPorts";
import { validateScenarioTenantScope } from "./validateScenarioTenantScope";
import {
  loadSimulatorInvoiceParties,
  type SimulatorInvoiceParties,
} from "./invoicePreviewContext";
import { enrichWithGroupedItems } from "@alga-psa/billing/lib/adapters/invoiceAdapters";
import {
  calculateContractBilling,
  calculateContractCharge,
  calculateContractDiscountsAndAdjustments,
  findContractChargeExplanation,
} from "@alga-psa/billing";

interface PeriodAccumulator {
  window: SimulatedInvoicePeriodWindow;
  lines: SimulatedInvoiceLine[];
  prorated: boolean;
  lineCycles: Set<string>;
}

export async function simulateContractScenario(
  knex: Knex,
  tenant: string,
  scenario: ContractScenario,
): Promise<ContractSimulationResult> {
  if (!tenant) {
    throw new Error(
      "Tenant context is required to simulate a contract scenario",
    );
  }
  if (!scenario) {
    throw new Error("A contract scenario is required to run a simulation");
  }
  if (!Array.isArray(scenario.lines)) {
    throw new Error(
      `Scenario ${scenario.scenario_id ?? "(unknown)"} has no lines array`,
    );
  }

  const db = tenantDb(knex, tenant);
  await validateScenarioTenantScope(knex, tenant, scenario);
  const diagnostics: SimulationDiagnostic[] = [];
  const currencyCode = scenario.currency_code || "USD";

  // --- Client context (read-only) ---
  let client: ChargeComputeClient;
  let profileBinding: {
    tax_region: string | null;
    currency_code: string;
  } | null = null;
  if (scenario.client_binding.kind === "client") {
    const clientRow = await db
      .table("clients")
      .where({ client_id: scenario.client_binding.client_id })
      .first("client_id", "is_tax_exempt");
    if (!clientRow) {
      throw new Error(
        `Client ${scenario.client_binding.client_id} bound to scenario ` +
          `${scenario.scenario_id} not found in tenant ${tenant}`,
      );
    }
    client = {
      client_id: clientRow.client_id,
      is_tax_exempt: Boolean(clientRow.is_tax_exempt),
    };
  } else {
    profileBinding = scenario.client_binding;
    client = { client_id: "simulated-client", is_tax_exempt: false };
  }
  const invoiceParties = await loadSimulatorInvoiceParties(
    knex,
    tenant,
    scenario.client_binding,
  );

  const taxPorts = await createReadOnlyTaxPorts(knex, tenant, {
    clientId: client.client_id,
    clientIsTaxExempt: Boolean(client.is_tax_exempt),
    locationIds: scenario.lines.flatMap((line) =>
      line.location_id ? [line.location_id] : [],
    ),
    profileBinding,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  // --- Invoice timeline (contract billing frequency) ---
  const invoicePeriods = buildInvoicePeriods(
    scenario.horizon,
    scenario.invoice_schedule,
  );

  const periodAccumulators: PeriodAccumulator[] = invoicePeriods.map(
    (window) => ({
      window,
      lines: [],
      prorated: false,
      lineCycles: new Set<string>(),
    }),
  );
  const bucketStateByService = new Map<string, BucketPeriodState>();

  const contractStartDate = scenario.contract_start_date
    ? toISODate(toPlainDate(scenario.contract_start_date))
    : null;
  const contractEndDate = scenario.contract_end_date
    ? toISODate(toPlainDate(scenario.contract_end_date))
    : null;
  const activityWindow: IRecurringActivityWindow = {
    // Contract end dates are inclusive; the activity window uses [start, end).
    start: contractStartDate ?? undefined,
    end: contractEndDate
      ? toISODate(toPlainDate(contractEndDate).add({ days: 1 }))
      : undefined,
    semantics: RECURRING_RANGE_SEMANTICS,
  };

  for (const line of scenario.lines) {
    simulateLineDiagnostics(line, diagnostics, currencyCode);

    const lineCycle = normalizeBillingCycle(line.billing_frequency);
    const records = generateLineServicePeriods({
      line,
      horizon: scenario.horizon,
      invoiceSchedule: scenario.invoice_schedule,
      contractStartDate: scenario.contract_start_date,
      scenarioId: scenario.scenario_id,
    });
    const assignments = assignServicePeriodsToInvoicePeriods(
      records,
      invoicePeriods,
    );

    if (assignments.length === 0) {
      diagnostics.push({
        severity: "warning",
        line_key: line.key,
        message: `Does not appear in the next ${scenario.horizon.period_count} invoices because it uses a ${lineCycle} schedule and bills in ${line.billing_timing}.`,
      });
      continue;
    }

    const fixedServices = line.services.filter(
      (service) =>
        service.item_kind !== "product" &&
        service.configuration.configuration_type === "Fixed",
    );
    const hourlyServices = line.services.filter(
      (service) =>
        service.item_kind !== "product" &&
        service.configuration.configuration_type === "Hourly",
    );
    const usageServices = line.services.filter(
      (service) =>
        service.item_kind !== "product" &&
        service.configuration.configuration_type === "Usage",
    );
    const bucketServices = line.services.filter(
      (service) =>
        service.item_kind !== "product" &&
        service.configuration.configuration_type === "Bucket",
    );
    const productServices = uniqueProductServices(line.services).filter(
      (service) => !service.is_license,
    );
    const licenseServices = uniqueProductServices(line.services).filter(
      (service) => service.is_license,
    );

    const clientContractLine = buildSyntheticClientContractLine(
      tenant,
      scenario,
      line,
      client.client_id,
      contractStartDate,
      contractEndDate,
    );

    for (const { periodIndex, record } of assignments) {
      const accumulator = periodAccumulators[periodIndex];
      const timing = buildChargeTiming(record, activityWindow);
      if (!timing) {
        // Service period falls entirely outside the contract's active window;
        // production settlement drops it the same way.
        continue;
      }

      const billingPeriod: IBillingPeriod = {
        tenant,
        startDate: accumulator.window.startDate,
        endDate: accumulator.window.endDateExclusive,
      };

      if (fixedServices.length > 0 || line.contract_line_type === "Fixed") {
        await simulateFixedCharges({
          scenario,
          line,
          fixedServices,
          client,
          clientContractLine,
          billingPeriod,
          timing,
          taxPorts,
          currencyCode,
          lineCycle,
          accumulator,
        });
      }

      if (hourlyServices.length > 0) {
        await simulateHourlyCharges({
          scenario,
          line,
          hourlyServices,
          client,
          clientContractLine,
          billingPeriod,
          timing,
          taxPorts,
          currencyCode,
          lineCycle,
          accumulator,
          diagnostics,
        });
      }

      if (usageServices.length > 0) {
        await simulateUsageCharges({
          scenario,
          line,
          usageServices,
          client,
          clientContractLine,
          billingPeriod,
          timing,
          taxPorts,
          currencyCode,
          lineCycle,
          accumulator,
          diagnostics,
        });
      }

      if (bucketServices.length > 0) {
        await simulateBucketCharges({
          scenario,
          line,
          bucketServices,
          client,
          clientContractLine,
          billingPeriod,
          timing,
          taxPorts,
          currencyCode,
          lineCycle,
          accumulator,
          bucketStateByService,
        });
      }

      if (productServices.length > 0) {
        await simulateRecurringQuantityCharges({
          scenario,
          line,
          quantityServices: productServices,
          chargeType: "product",
          client,
          clientContractLine,
          billingPeriod,
          timing,
          taxPorts,
          currencyCode,
          lineCycle,
          accumulator,
        });
      }

      if (licenseServices.length > 0) {
        await simulateRecurringQuantityCharges({
          scenario,
          line,
          quantityServices: licenseServices,
          chargeType: "license",
          client,
          clientContractLine,
          billingPeriod,
          timing,
          taxPorts,
          currencyCode,
          lineCycle,
          accumulator,
        });
      }
    }
  }

  for (const accumulator of periodAccumulators) {
    applyScenarioDiscountsAndAdjustments(accumulator, scenario, tenant);
  }
  const periods: SimulatedPeriod[] = periodAccumulators.map((accumulator) =>
    finalizePeriod(
      accumulator,
      scenario,
      tenant,
      contractEndDate,
      invoiceParties,
    ),
  );

  return {
    scenario_id: scenario.scenario_id,
    currency_code: currencyCode,
    horizon: scenario.horizon,
    periods,
    diagnostics,
  };
}

/* ------------------------------------------------------------------ */
/* Per-line diagnostics                                               */
/* ------------------------------------------------------------------ */

function simulateLineDiagnostics(
  line: ScenarioLine,
  diagnostics: SimulationDiagnostic[],
  currencyCode: string,
): void {
  if (!isSupportedBillingFrequency(line.billing_frequency)) {
    diagnostics.push({
      severity: "info",
      line_key: line.key,
      message: `Uses the ${line.billing_frequency} frequency, which this projection cannot model. Monthly billing was used instead.`,
    });
  }

  if (line.services.length === 0) {
    diagnostics.push({
      severity: "info",
      line_key: line.key,
      message: "Has no services, so it adds no charges.",
    });
  }

  for (const service of uniqueProductServices(line.services)) {
    if (hasRecurringQuantityPrice(service)) continue;
    const chargeType = service.is_license ? "license" : "product";
    diagnostics.push({
      severity: "warning",
      line_key: line.key,
      message: `${service.service_name} has no ${currencyCode} ${chargeType} price. Add a catalog or service rate to include it.`,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Recurring product and license charges                              */
/* ------------------------------------------------------------------ */

function uniqueProductServices(
  services: ScenarioLineService[],
): ScenarioLineService[] {
  const byServiceId = new Map<string, ScenarioLineService>();
  for (const service of services) {
    if (service.item_kind !== "product") continue;
    const current = byServiceId.get(service.service_id);
    if (
      !current ||
      (current.configuration.configuration_type === "Bucket" &&
        service.configuration.configuration_type !== "Bucket")
    ) {
      byServiceId.set(service.service_id, service);
    }
  }
  return Array.from(byServiceId.values());
}

function hasRecurringQuantityPrice(service: ScenarioLineService): boolean {
  return service.custom_rate != null || service.default_rate != null;
}

async function simulateRecurringQuantityCharges(
  input: SimulateFamilyInput & {
    quantityServices: ScenarioLineService[];
    chargeType: "product" | "license";
  },
): Promise<void> {
  const {
    line,
    quantityServices,
    chargeType,
    client,
    clientContractLine,
    timing,
    taxPorts,
    currencyCode,
    lineCycle,
    accumulator,
  } = input;
  const priceableServices = quantityServices.filter(hasRecurringQuantityPrice);
  if (priceableServices.length === 0) return;

  const { charges, explanations } = calculateContractCharge({
    kind: chargeType,
    executionMode: "simulate",
    inputs: {
      clientContractLine,
      client,
      timing,
      chargeType,
      services: priceableServices.map((service) => ({
        service_id: service.service_id,
        service_name: service.service_name,
        default_rate: service.legacy_default_rate,
        tax_rate_id: service.tax_rate_id,
        config_id:
          service.configuration_id ??
          syntheticConfigId(line.key, service.service_id),
        service_quantity: service.service_quantity,
        service_line_custom_rate: service.service_custom_rate,
        configuration_quantity:
          service.configuration_quantity ?? service.quantity,
        configuration_custom_rate:
          service.configuration_custom_rate ?? service.custom_rate,
        price_rate: service.default_rate,
      })),
      contractCurrency: currencyCode,
    },
    taxContext: taxPorts,
  });
  for (const charge of charges) {
    pushChargeLine({
      accumulator,
      lineKey: line.key,
      lineCycle,
      billingTiming: line.billing_timing,
      charge: {
        serviceId: charge.serviceId,
        serviceName: charge.serviceName,
        chargeType: charge.type,
        quantityLabel: `${formatHours(charge.quantity)} units`,
        quantity: charge.quantity,
        rate: charge.rate,
        net: charge.total,
        tax: charge.tax_amount ?? 0,
        servicePeriodStart: charge.servicePeriodStart,
        servicePeriodEnd: charge.servicePeriodEnd,
      },
      currencyCode,
      explanation: findContractChargeExplanation(
        chargeType,
        charge,
        explanations,
        clientContractLine.client_contract_line_id,
      ),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Bucket charges                                                     */
/* ------------------------------------------------------------------ */

async function simulateBucketCharges(
  input: SimulateFamilyInput & {
    bucketServices: ScenarioLineService[];
    bucketStateByService: Map<string, BucketPeriodState>;
  },
): Promise<void> {
  const {
    scenario,
    line,
    bucketServices,
    client,
    clientContractLine,
    billingPeriod,
    timing,
    taxPorts,
    currencyCode,
    lineCycle,
    accumulator,
    bucketStateByService,
  } = input;
  const periodIndex = accumulator.window.index;

  for (const service of bucketServices) {
    const config = service.configuration as ScenarioBucketConfig;
    const assumedConsumption = Math.max(
      0,
      resolveAssumedQuantity(
        scenario.assumptions,
        line.key,
        service.service_id,
        periodIndex,
      ),
    );
    const isUsageBucket = line.contract_line_type === "Usage";
    const consumedQuantity = isUsageBucket
      ? assumedConsumption
      : assumedConsumption * 60;
    const stateKey = `${line.key}:${service.service_id}`;
    const state = computeBucketPeriodState({
      includedQuantity: config.total_minutes,
      consumedQuantity,
      allowRollover: config.allow_rollover,
      previousState: bucketStateByService.get(stateKey) ?? null,
    });
    bucketStateByService.set(stateKey, state);

    const { charges, explanations } = calculateContractCharge({
      kind: "bucket",
      executionMode: "simulate",
      inputs: {
        billingPeriod,
        clientContractLine,
        client,
        config: {
          config_id: syntheticConfigId(line.key, service.service_id),
          service_id: service.service_id,
          service_name: service.service_name,
          tax_rate_id: service.tax_rate_id,
          unit_of_measure: isUsageBucket
            ? usageUnitForBucket(line, service.service_id)
            : "hours",
          billing_method: isUsageBucket ? "usage" : "hourly",
          total_minutes: config.total_minutes,
          overage_rate: config.overage_rate,
          allow_rollover: config.allow_rollover,
        },
        usageRecords: [
          {
            period_start: timing.servicePeriodStart,
            period_end: timing.servicePeriodEnd,
            minutes_used: consumedQuantity,
            overage_minutes: state.overageQuantity,
            rolled_over_minutes: state.rolledOverQuantity,
          },
        ],
        contractCurrency: currencyCode,
      },
      taxContext: taxPorts,
    });
    for (const charge of charges) {
      pushChargeLine({
        accumulator,
        lineKey: line.key,
        lineCycle,
        billingTiming: line.billing_timing,
        charge: {
          serviceId: charge.serviceId ?? null,
          serviceName: charge.serviceName,
          chargeType: charge.type,
          quantityLabel: isUsageBucket
            ? `${formatHours(charge.overageUnits ?? 0)} ${charge.unitOfMeasure ?? "units"} overage`
            : `${formatHours(charge.overageHours ?? 0)} hrs overage`,
          quantity: isUsageBucket
            ? (charge.overageUnits ?? 0)
            : (charge.overageHours ?? 0),
          rate: charge.rate ?? 0,
          net: charge.total ?? 0,
          tax: charge.tax_amount ?? 0,
          servicePeriodStart: charge.servicePeriodStart,
          servicePeriodEnd: charge.servicePeriodEnd,
        },
        currencyCode,
        explanation: findContractChargeExplanation(
          "bucket",
          charge,
          explanations,
          clientContractLine.client_contract_line_id,
        ),
      });
    }
  }
}

function usageUnitForBucket(line: ScenarioLine, serviceId: string): string {
  const usageConfig = line.services.find(
    (service) =>
      service.service_id === serviceId &&
      service.configuration.configuration_type === "Usage",
  )?.configuration;
  return usageConfig?.configuration_type === "Usage"
    ? usageConfig.unit_of_measure
    : "units";
}

/* ------------------------------------------------------------------ */
/* Usage charges                                                      */
/* ------------------------------------------------------------------ */

async function simulateUsageCharges(
  input: SimulateFamilyInput & {
    usageServices: ScenarioLineService[];
    diagnostics: SimulationDiagnostic[];
  },
): Promise<void> {
  const {
    scenario,
    line,
    usageServices,
    client,
    clientContractLine,
    billingPeriod,
    timing,
    taxPorts,
    currencyCode,
    lineCycle,
    accumulator,
    diagnostics,
  } = input;
  const periodIndex = accumulator.window.index;
  const usageRecords: UsageRecordComputeRow[] = [];

  for (const service of usageServices) {
    const assumedQuantity = resolveAssumedQuantity(
      scenario.assumptions,
      line.key,
      service.service_id,
      periodIndex,
    );
    if (!(assumedQuantity > 0)) continue;
    if (!hasResolvableUsageRate(service)) {
      diagnostics.push({
        severity: "warning",
        line_key: line.key,
        message: `${service.service_name} has no ${currencyCode} usage rate, so its activity was omitted from invoice ${periodIndex + 1}.`,
      });
      continue;
    }
    usageRecords.push(
      buildSyntheticUsageRecord({
        line,
        service,
        periodIndex,
        assumedQuantity,
      }),
    );
  }

  if (usageRecords.length === 0) return;
  const { charges, explanations } = calculateContractCharge({
    kind: "usage",
    executionMode: "simulate",
    inputs: {
      billingPeriod,
      clientContractLine,
      timing,
      client,
      serviceConfigMap: buildUsageServiceConfigMap(line),
      usageRecords,
      contractCurrency: currencyCode,
    },
    taxContext: taxPorts,
  });
  for (const charge of charges) {
    const service = usageServices.find(
      (candidate) => candidate.service_id === charge.serviceId,
    );
    pushChargeLine({
      accumulator,
      lineKey: line.key,
      lineCycle,
      billingTiming: line.billing_timing,
      charge: {
        serviceId: charge.serviceId ?? null,
        serviceName: charge.serviceName,
        chargeType: charge.type,
        quantityLabel: `${formatHours(charge.quantity ?? 0)} ${
          service?.configuration.configuration_type === "Usage"
            ? service.configuration.unit_of_measure
            : "units"
        }`,
        quantity: charge.quantity ?? 0,
        rate: charge.rate ?? 0,
        net: charge.total ?? 0,
        tax: charge.tax_amount ?? 0,
        servicePeriodStart: charge.servicePeriodStart,
        servicePeriodEnd: charge.servicePeriodEnd,
      },
      currencyCode,
      explanation: findContractChargeExplanation(
        "usage",
        charge,
        explanations,
        clientContractLine.client_contract_line_id,
      ),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Timing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Builds the ChargeComputeTiming for one hypothetical service period,
 * mirroring how the engine derives ResolvedRecurringChargeTiming from a
 * settled service period (billingEngine.buildRecurringChargeTimingSelection /
 * buildRecurringTimingSelectionsFromPersistedRecords): the covered period
 * (service period ∩ contract activity window) supplies both the half-open
 * exclusive range and the inclusive start/end (end = day before the exclusive
 * boundary); coverageRatio is coveredDays / totalDays.
 */
function buildChargeTiming(
  record: IRecurringServicePeriodRecord,
  activityWindow: IRecurringActivityWindow,
): ChargeComputeTiming | null {
  const servicePeriod: IRecurringServicePeriod = {
    kind: "service_period",
    cadenceOwner: record.cadenceOwner,
    duePosition: record.duePosition,
    sourceObligation: record.sourceObligation,
    start: record.servicePeriod.start,
    end: record.servicePeriod.end,
    semantics: RECURRING_RANGE_SEMANTICS,
  };

  const covered = intersectActivityWindow(servicePeriod, activityWindow);
  if (!covered) {
    return null;
  }

  const coverage = calculateServicePeriodCoverage(servicePeriod, covered);
  if (coverage.coveredDays <= 0) {
    return null;
  }

  return {
    duePosition: record.duePosition,
    servicePeriodStart: toISODate(toPlainDate(coverage.coveredPeriod.start)),
    servicePeriodEnd: toISODate(
      toPlainDate(coverage.coveredPeriod.end).subtract({ days: 1 }),
    ),
    servicePeriodStartExclusive: toISODate(
      toPlainDate(coverage.coveredPeriod.start),
    ),
    servicePeriodEndExclusive: toISODate(
      toPlainDate(coverage.coveredPeriod.end),
    ),
    coverageRatio: coverage.coverageRatio,
  };
}

/* ------------------------------------------------------------------ */
/* Synthetic client contract line                                     */
/* ------------------------------------------------------------------ */

function buildSyntheticClientContractLine(
  tenant: string,
  scenario: ContractScenario,
  line: ScenarioLine,
  clientId: string,
  contractStartDate: ISO8601String | null,
  contractEndDate: ISO8601String | null,
): IClientContractLine {
  return {
    tenant,
    client_contract_line_id: line.key,
    client_id: clientId,
    contract_line_id: line.key,
    billing_timing: line.billing_timing,
    cadence_owner: line.cadence_owner,
    start_date:
      contractStartDate ?? toISODate(toPlainDate(scenario.horizon.start_date)),
    end_date: contractEndDate,
    is_active: true,
    currency_code: scenario.currency_code,
    custom_rate: line.custom_rate ?? undefined,
    enable_proration: line.enable_proration,
    location_id: line.location_id,
    is_system_managed_default: scenario.is_system_managed_default,
    contract_id: scenario.contract_id ?? undefined,
    contract_line_name: line.contract_line_name,
    contract_line_type: line.contract_line_type,
    billing_frequency: line.billing_frequency,
  };
}

/* ------------------------------------------------------------------ */
/* Pricing schedules                                                  */
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
  timing: ChargeComputeTiming,
): {
  effectiveCustomRate: number | null;
  customRateSource: "pricing_schedule" | "assignment" | null;
} {
  const periodStart = toPlainDate(timing.servicePeriodStartExclusive);
  const periodEndExclusive = toPlainDate(timing.servicePeriodEndExclusive);

  const overlapping = schedules.filter(
    (schedule) =>
      Temporal.PlainDate.compare(
        toPlainDate(schedule.effective_date),
        periodEndExclusive,
      ) < 0 &&
      (schedule.end_date == null ||
        Temporal.PlainDate.compare(
          toPlainDate(schedule.end_date),
          periodStart,
        ) > 0),
  );

  const latest = overlapping.reduce<ScenarioPricingSchedule | null>(
    (winner, schedule) =>
      winner === null ||
      Temporal.PlainDate.compare(
        toPlainDate(schedule.effective_date),
        toPlainDate(winner.effective_date),
      ) > 0
        ? schedule
        : winner,
    null,
  );

  if (latest && latest.custom_rate != null) {
    return {
      effectiveCustomRate: latest.custom_rate,
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
/* Fixed charges                                                      */
/* ------------------------------------------------------------------ */

interface SimulateFamilyInput {
  scenario: ContractScenario;
  line: ScenarioLine;
  client: ChargeComputeClient;
  clientContractLine: IClientContractLine;
  billingPeriod: IBillingPeriod;
  timing: ChargeComputeTiming;
  taxPorts: ChargeComputeTaxPorts;
  currencyCode: string;
  lineCycle: string;
  accumulator: PeriodAccumulator;
}

async function simulateFixedCharges(
  input: SimulateFamilyInput & { fixedServices: ScenarioLineService[] },
): Promise<void> {
  const {
    scenario,
    line,
    fixedServices,
    client,
    clientContractLine,
    billingPeriod,
    timing,
    taxPorts,
    currencyCode,
    lineCycle,
    accumulator,
  } = input;

  const planServices: FixedPlanServiceRow[] = fixedServices.map((service) => {
    if (service.configuration.configuration_type !== "Fixed") {
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
      configuration_quantity: service.quantity,
      service_base_rate: service.configuration.base_rate,
    };
  });

  const { effectiveCustomRate, customRateSource } = resolveEffectiveCustomRate(
    scenario.pricing_schedules,
    line,
    timing,
  );

  const { charges, explanations } = calculateContractCharge({
    kind: "fixed",
    executionMode: "simulate",
    inputs: {
      clientId: client.client_id,
      billingPeriod,
      clientContractLine,
      timing,
      client,
      contractLineDetails: {
        contract_line_type: line.contract_line_type,
        custom_rate: line.custom_rate,
        enable_proration: line.enable_proration,
      },
      effectiveCustomRate,
      customRateSource,
      planServices,
      // The scenario carries the full service list; there is no separate
      // catalog fallback row to load for a hypothetical line.
      fallbackService: null,
    },
    taxContext: taxPorts,
  });
  // advanceGuard is intentionally ignored: it exists to suppress
  // double-billing against persisted charges, and a simulation persists
  // nothing.

  for (const charge of charges) {
    const explanation = findContractChargeExplanation(
      "fixed",
      charge,
      explanations,
      clientContractLine.client_contract_line_id,
    );
    pushChargeLine({
      accumulator,
      lineKey: line.key,
      lineCycle,
      billingTiming: line.billing_timing,
      charge: {
        serviceId: charge.serviceId ?? null,
        serviceName: charge.serviceName,
        chargeType: charge.type,
        quantityLabel: cadenceQuantityLabel(lineCycle),
        quantity: charge.quantity ?? 1,
        rate: charge.rate ?? 0,
        net: charge.total ?? 0,
        tax: charge.tax_amount ?? 0,
        servicePeriodStart: charge.servicePeriodStart,
        servicePeriodEnd: charge.servicePeriodEnd,
      },
      currencyCode,
      explanation,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Hourly charges                                                     */
/* ------------------------------------------------------------------ */

async function simulateHourlyCharges(
  input: SimulateFamilyInput & {
    hourlyServices: ScenarioLineService[];
    diagnostics: SimulationDiagnostic[];
  },
): Promise<void> {
  const {
    scenario,
    line,
    hourlyServices,
    client,
    clientContractLine,
    billingPeriod,
    timing,
    taxPorts,
    currencyCode,
    lineCycle,
    accumulator,
    diagnostics,
  } = input;

  const periodIndex = accumulator.window.index;
  const timeEntries: TimeEntryComputeRow[] = [];

  for (const service of hourlyServices) {
    const assumedHours = resolveAssumedQuantity(
      scenario.assumptions,
      line.key,
      service.service_id,
      periodIndex,
    );
    if (!(assumedHours > 0)) {
      continue;
    }

    if (!hasResolvableHourlyRate(service)) {
      diagnostics.push({
        severity: "warning",
        line_key: line.key,
        message: `${service.service_name} has no ${currencyCode} hourly rate, so its hours were omitted from invoice ${periodIndex + 1}.`,
      });
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

  if (timeEntries.length === 0) {
    return;
  }

  const { charges, explanations } = calculateContractCharge({
    kind: "hourly",
    executionMode: "simulate",
    inputs: {
      billingPeriod,
      clientContractLine,
      timing,
      client,
      plan: {
        enable_overtime: line.enable_overtime,
        overtime_threshold: line.overtime_threshold ?? undefined,
        overtime_rate: line.overtime_rate ?? undefined,
      },
      serviceConfigMap: buildHourlyServiceConfigMap(line),
      timeEntries,
      contractCurrency: currencyCode,
      resolvePhaseRateOverride: null,
      getProjectChargeConfig: null,
    },
    taxContext: taxPorts,
  });

  for (const charge of charges) {
    const explanation = findContractChargeExplanation(
      "hourly",
      charge,
      explanations,
      clientContractLine.client_contract_line_id,
    );
    pushChargeLine({
      accumulator,
      lineKey: line.key,
      lineCycle,
      billingTiming: line.billing_timing,
      charge: {
        serviceId: charge.serviceId ?? null,
        serviceName: charge.serviceName,
        chargeType: charge.type,
        quantityLabel: `${formatHours(charge.duration ?? 0)} hrs`,
        quantity: charge.duration ?? 0,
        rate: charge.rate ?? 0,
        net: charge.total ?? 0,
        tax: charge.tax_amount ?? 0,
        servicePeriodStart: charge.servicePeriodStart,
        servicePeriodEnd: charge.servicePeriodEnd,
      },
      currencyCode,
      explanation,
    });
  }
}

function applyScenarioDiscountsAndAdjustments(
  accumulator: PeriodAccumulator,
  scenario: ContractScenario,
  tenant: string,
): void {
  const discountCandidates = (scenario.discounts ?? []).flatMap((discount) => {
    const lineKeys =
      discount.contract_line_keys.length > 0
        ? discount.contract_line_keys
        : [null];
    return lineKeys.map((lineKey) => ({
      discount_id: discount.discount_id,
      discount_name: discount.discount_name,
      discount_type: discount.discount_type,
      value: discount.value,
      start_date: discount.start_date,
      end_date: discount.end_date,
      contract_line_id: lineKey,
      tenant,
    }));
  });
  const adjustments = (scenario.adjustments ?? []).filter(
    (adjustment) =>
      adjustment.period_index == null ||
      adjustment.period_index === accumulator.window.index,
  );
  if (discountCandidates.length === 0 && adjustments.length === 0) {
    return;
  }

  const charges: IBillingCharge[] = accumulator.lines
    .filter(
      (line) =>
        line.charge_type !== "discount" && line.charge_type !== "adjustment",
    )
    .map((line) => ({
      type: "fixed",
      client_contract_line_id: line.line_key,
      serviceId: line.service_id ?? undefined,
      serviceName: line.service_name,
      quantity: 1,
      rate: line.net_amount,
      total: line.net_amount,
      tax_amount: line.tax_amount,
      tax_rate: 0,
      servicePeriodStart: line.service_period_start,
      servicePeriodEnd: line.service_period_end,
    }));
  const totalAmount = charges.reduce((sum, charge) => sum + charge.total, 0);
  const computed = calculateContractDiscountsAndAdjustments({
    billingResult: {
      tenant,
      charges,
      totalAmount,
      discounts: [],
      adjustments: [],
      finalAmount: totalAmount,
      currency_code: scenario.currency_code,
    },
    billingPeriod: {
      tenant,
      startDate: accumulator.window.startDate,
      endDate: accumulator.window.endDateExclusive,
    },
    discountCandidates,
    adjustments,
  });
  const explanationByKey = new Map(
    computed.explanations.map((explanation) => [
      explanation.chargeKey,
      explanation,
    ]),
  );

  for (const discount of computed.billingResult.discounts) {
    const amount = discount.amount ?? 0;
    accumulator.lines.push({
      line_key: `discount:${discount.discount_id}`,
      service_id: null,
      service_name: discount.discount_name,
      charge_type: "discount",
      quantity_label:
        discount.discount_type === "percentage"
          ? `${discount.value * 100}%`
          : "fixed",
      rate_label: `−${formatCents(amount, scenario.currency_code)}`,
      net_amount: -amount,
      tax_amount: 0,
      total: -amount,
      explanation:
        explanationByKey.get(`discount:${discount.discount_id}`) ?? null,
    });
  }
  for (const [
    index,
    adjustment,
  ] of computed.billingResult.adjustments.entries()) {
    const scenarioAdjustment = adjustments[index];
    accumulator.lines.push({
      line_key: `adjustment:${index}`,
      service_id: null,
      service_name: adjustment.description,
      charge_type: scenarioAdjustment?.one_time ? "one_time" : "adjustment",
      quantity_label: "adjustment",
      rate_label: formatCents(adjustment.amount, scenario.currency_code),
      net_amount: adjustment.amount,
      tax_amount: 0,
      total: adjustment.amount,
      explanation: explanationByKey.get(`adjustment:${index}`) ?? null,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Result assembly                                                    */
/* ------------------------------------------------------------------ */

function pushChargeLine(input: {
  accumulator: PeriodAccumulator;
  lineKey: string;
  lineCycle: string;
  billingTiming: "arrears" | "advance";
  charge: {
    serviceId: string | null;
    serviceName: string;
    chargeType: string;
    quantityLabel: string;
    quantity?: number;
    rate: number;
    net: number;
    tax: number;
    servicePeriodStart?: ISO8601String;
    servicePeriodEnd?: ISO8601String;
  };
  currencyCode: string;
  explanation: ChargeExplanation | null;
}): void {
  const {
    accumulator,
    lineKey,
    lineCycle,
    billingTiming,
    charge,
    currencyCode,
    explanation,
  } = input;

  accumulator.lines.push({
    line_key: lineKey,
    service_id: charge.serviceId,
    service_name: charge.serviceName,
    charge_type: charge.chargeType,
    quantity_label: charge.quantityLabel,
    rate_label: formatCents(charge.rate, currencyCode),
    quantity: charge.quantity ?? 1,
    unit_price: charge.rate,
    net_amount: charge.net,
    tax_amount: charge.tax,
    total: charge.net + charge.tax,
    explanation,
    billing_timing: billingTiming,
    service_period_start: charge.servicePeriodStart,
    service_period_end: charge.servicePeriodEnd,
  });
  accumulator.lineCycles.add(lineCycle);
  if (explanation?.markers.includes("proration")) {
    accumulator.prorated = true;
  }
}

function finalizePeriod(
  accumulator: PeriodAccumulator,
  scenario: ContractScenario,
  tenant: string,
  contractEndDate: ISO8601String | null,
  invoiceParties: SimulatorInvoiceParties,
): SimulatedPeriod {
  const { window, lines } = accumulator;
  // The simulator deliberately crosses the shared boundary in simulate mode.
  // It supplies already-resolved, tenant-scoped facts and never receives a
  // persistence capability.
  const calculation = calculateContractBilling({
    schemaVersion: 1,
    execution: {
      mode: "simulate",
      tenantId: tenant,
      calculationId: `${scenario.scenario_id}:${window.index}`,
      asOf: `${window.startDate}T00:00:00Z`,
    },
    document: {
      clientId:
        scenario.client_binding.kind === "client"
          ? scenario.client_binding.client_id
          : "simulated-client",
      currencyCode: scenario.currency_code || "USD",
      invoiceWindow: {
        start: window.startDate,
        endExclusive: window.endDateExclusive,
      },
    },
    obligations: lines.map((line, index) => ({
      obligationId: `${line.line_key}:${index}`,
      tenantId: tenant,
      contractLineId: line.line_key,
      chargeFamily: ([
        "fixed",
        "hourly",
        "usage",
        "bucket",
        "product",
        "license",
      ].includes(line.charge_type)
        ? line.charge_type
        : "other") as
        | "fixed"
        | "hourly"
        | "usage"
        | "bucket"
        | "product"
        | "license"
        | "other",
      lineKind:
        line.charge_type === "discount"
          ? ("discount" as const)
          : line.charge_type === "adjustment" || line.charge_type === "one_time"
            ? ("adjustment" as const)
            : ("charge" as const),
      line: {
        lineKey: line.line_key,
        serviceId: line.service_id,
        description: line.service_name,
        quantity: line.quantity ?? 1,
        unitRate: line.unit_price ?? line.net_amount,
        netAmount: line.net_amount,
        taxAmount: line.tax_amount,
        currencyCode: scenario.currency_code || "USD",
        servicePeriodStart: line.service_period_start,
        servicePeriodEnd: line.service_period_end,
        billingTiming: line.billing_timing,
        explanation: line.explanation,
        markers: line.explanation?.markers,
      },
    })),
  });
  // Presentation retains simulator-only labels, while every monetary and
  // correlation field comes back from the canonical document result.
  const presentationLines = calculation.lines.map((canonicalLine, index) => ({
    ...lines[index],
    line_key: canonicalLine.lineKey,
    service_id: canonicalLine.serviceId ?? null,
    service_name: canonicalLine.description,
    quantity: canonicalLine.quantity,
    unit_price: canonicalLine.unitRate,
    net_amount: canonicalLine.netAmount,
    tax_amount: canonicalLine.taxAmount,
    total: canonicalLine.grossAmount,
    service_period_start: canonicalLine.servicePeriodStart,
    service_period_end: canonicalLine.servicePeriodEnd,
    billing_timing: canonicalLine.billingTiming,
    explanation: canonicalLine.explanation as ChargeExplanation | null,
  }));
  const endInclusive = toISODate(
    toPlainDate(window.endDateExclusive).subtract({ days: 1 }),
  );

  const markers: SimulatedPeriodMarker[] = [];
  if (accumulator.prorated) {
    markers.push("prorated");
  }
  if (accumulator.lineCycles.size > 1) {
    markers.push("cadence_coincidence");
  }
  if (presentationLines.some((line) => line.charge_type === "bucket")) {
    markers.push("bucket_overage");
  }
  if (presentationLines.some((line) => line.charge_type === "one_time")) {
    markers.push("one_time");
  }
  if (
    contractEndDate &&
    Temporal.PlainDate.compare(
      toPlainDate(window.startDate),
      toPlainDate(contractEndDate),
    ) <= 0 &&
    Temporal.PlainDate.compare(
      toPlainDate(contractEndDate),
      toPlainDate(window.endDateExclusive),
    ) < 0
  ) {
    markers.push("contract_end");
  }

  const subtotal = calculation.subtotal;
  const tax = calculation.taxTotal;

  const period: SimulatedPeriod = {
    index: window.index,
    period_start: `${window.startDate}T00:00:00Z`,
    period_end: `${endInclusive}T00:00:00Z`,
    label: formatPeriodLabel(
      window.startDate,
      endInclusive,
      scenario.invoice_schedule.billing_cycle,
    ),
    lines: presentationLines,
    subtotal,
    tax,
    total: calculation.total,
    markers,
    invoice_view_model: enrichWithGroupedItems({
      invoiceNumber: `SIM-${scenario.scenario_id}-${window.index + 1}`,
      issueDate: window.startDate,
      dueDate: endInclusive,
      currencyCode: scenario.currency_code || "USD",
      poNumber: null,
      tenantClient: invoiceParties.tenantClient,
      customer: invoiceParties.customer,
      items: presentationLines.map((line, index) => ({
        id: `sim-${scenario.scenario_id}-${window.index}-${index}`,
        description: line.service_name,
        quantity: line.quantity ?? 1,
        unitPrice: line.unit_price ?? line.net_amount,
        total: line.net_amount,
        taxAmount: line.tax_amount,
        category: line.charge_type,
        itemType:
          line.charge_type === "product" || line.charge_type === "license"
            ? "product"
            : "service",
        servicePeriodStart: line.service_period_start ?? null,
        servicePeriodEnd: line.service_period_end ?? null,
        billingTiming: line.billing_timing ?? null,
      })),
      subtotal,
      tax,
      total: calculation.total,
    }),
  };
  return period;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                         */
/* ------------------------------------------------------------------ */

function formatCents(cents: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
  }).format(cents / 100);
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
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

function formatPeriodLabel(
  startDate: ISO8601String,
  endInclusive: ISO8601String,
  billingCycle: string,
): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const startLabel = formatter.format(new Date(`${startDate}T00:00:00Z`));
  if (billingCycle === "monthly") {
    return startLabel;
  }
  const endLabel = formatter.format(new Date(`${endInclusive}T00:00:00Z`));
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
}
