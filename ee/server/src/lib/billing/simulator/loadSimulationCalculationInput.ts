
import { resolveUnitOfMeasure } from '@alga-psa/core/unitOfMeasure';
/**
 * EE contract simulation orchestrator: prices a ContractScenario over its
 * horizon through the shared pure billing compute layer.
 *
 * Strictly read-only against the database. This module must never import
 * BillingEngine, invoice generation/numbering, or TaxService (whose
 * calculateTax provisions default client tax settings); all tax/region
 * lookups flow through the read-only ports in ./readOnlyTaxPorts.
 *
 * Which charges a line produces is decided by the shared resolver
 * (billing/chargeResolution) that the billing engine also calls; the scenario
 * source (./scenarioChargeSource) only supplies data. Pool allowance state is
 * simulated and threaded in memory across the horizon.
 */

import type { Knex } from "knex";
import { Temporal } from "@js-temporal/polyfill";
import type {
  ChargeExplanation,
  ContractScenario,
  IBillingCharge,
  IBillingPeriod,
  IBucketCharge,
  IHourBlockCharge,
  IPrepaidBlockCharge,
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
  assignServicePeriodsToInvoicePeriods,
  buildInvoicePeriods,
  generateLineServicePeriods,
  isSupportedBillingFrequency,
  monthsPerCycle,
  normalizeBillingCycle,
  type SimulatedInvoicePeriodWindow,
} from "./hypotheticalPeriods";
import { resolveContractLineCharges } from "@alga-psa/billing/lib/billing/chargeResolution";
import {
  ScenarioChargeSource,
  createScenarioRunState,
  hasRecurringQuantityPrice,
  uniqueProductServices,
} from "./scenarioChargeSource";
import { resolveAssumedQuantity } from "./syntheticActivity";
import { createReadOnlyTaxPorts } from "./readOnlyTaxPorts";
import { simulatePrepaidBlockTimeline } from "./prepaidBlockTimeline";
import { validateScenarioTenantScope } from "./validateScenarioTenantScope";
import {
  loadSimulatorInvoiceParties,
  type SimulatorInvoiceParties,
} from "./invoicePreviewContext";
import { enrichWithGroupedItems } from "@alga-psa/billing/lib/adapters/invoiceAdapters";
import {
  type ContractBillingCalculationResult,
  type ResolvedContractLineFacts,
  type ResolvedContractBillingChargeFacts,
  type UnpricedContractBillingObligation,
  type ResolvedBillingTiming,
  type ResolvedChargeTaxPolicy,
  calculateContractBucketPeriodState,
} from "@alga-psa/billing/lib/billing/domain";
import { simulationRefusal } from "./simulationRefusal";

interface SimulationBillingClient {
  client_id: string;
  is_tax_exempt?: boolean | null;
}

export interface SimulationCalculationPeriodInput {
  window: SimulatedInvoicePeriodWindow;
  obligations: UnpricedContractBillingObligation[];
  taxContexts: Record<string, ResolvedChargeTaxPolicy>;
  /**
   * Dated one-off charges that are not recurring-service-period obligations:
   * the Prepaid Block issuance (`prepaid_block`) and its $0 consumption lines
   * (`hour_block`). Passed to the domain as its supplemental carve-out.
   */
  supplementalCharges: IBillingCharge[];
}

export interface SimulationCalculationInput {
  scenario: ContractScenario;
  tenant: string;
  currencyCode: string;
  contractEndDate: ISO8601String | null;
  invoiceParties: SimulatorInvoiceParties;
  diagnostics: SimulationDiagnostic[];
  periods: SimulationCalculationPeriodInput[];
}

/**
 * Read-only scenario adapter. It resolves scenario/storage facts into unpriced
 * domain obligations; financial dispatch belongs exclusively to the domain.
 */
export async function loadSimulationCalculationInput(
  knex: Knex,
  tenant: string,
  scenario: ContractScenario,
): Promise<SimulationCalculationInput> {
  if (!tenant) {
    throw new Error(
      "Tenant context is required to simulate a contract scenario",
    );
  }
  if (!scenario) {
    throw simulationRefusal(
      "CONTRACT_SIMULATION_SCENARIO_INVALID",
      "There is no scenario to simulate. Reload the page and try again.",
    );
  }
  if (!Array.isArray(scenario.lines)) {
    throw simulationRefusal(
      "CONTRACT_SIMULATION_SCENARIO_INVALID",
      "This scenario has no contract lines to simulate. Reload the page and try again.",
    );
  }

  const db = tenantDb(knex, tenant);
  await validateScenarioTenantScope(knex, tenant, scenario);
  const diagnostics: SimulationDiagnostic[] = [];
  const currencyCode = scenario.currency_code || "USD";

  // --- Client context (read-only) ---
  let client: SimulationBillingClient;
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
      throw simulationRefusal(
        "CONTRACT_SIMULATION_CLIENT_NOT_AVAILABLE",
        "The client this simulation uses is not available. It may have been deleted; choose another client.",
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

  const periodAccumulators: SimulationCalculationPeriodInput[] =
    invoicePeriods.map((window) => ({
      window,
      obligations: [],
      taxContexts: {},
      supplementalCharges: [],
    }));
  const run = createScenarioRunState();

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

    // Prepaid Block lines: issuance and consumption are dated one-offs, not
    // service periods, so they are simulated on the invoice timeline before
    // (and independently of) the line's own arrears assignments. The hourly
    // charge below then prices only the demand no block absorbed.
    const blockResult = line.prepaid_block
      ? simulatePrepaidBlockLine({
          tenant,
          scenario,
          line,
          client,
          taxPorts,
          currencyCode,
          invoicePeriods,
          periodAccumulators,
          contractStartDate,
          contractEndDate,
          diagnostics,
        })
      : null;

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

    const lineFacts = buildResolvedContractLineFacts(
      tenant,
      scenario,
      line,
      client.client_id,
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

      // Which charges the line produces is decided by the shared resolver, the
      // same one the billing engine calls; this loop only supplies scenario data.
      const resolved = await resolveContractLineCharges(
        new ScenarioChargeSource({
          scenario,
          line,
          lineFacts,
          client,
          billingPeriod,
          timing,
          periodIndex: accumulator.window.index,
          taxPorts,
          currencyCode,
          lineCycle,
          diagnostics,
          run,
          coveredByBlock: blockResult?.demandCoverage.get(periodIndex) ?? null,
        }),
      );
      for (const charge of resolved) {
        accumulator.obligations.push(charge.obligation);
        accumulator.taxContexts[charge.obligation.taxContextKey] =
          charge.taxContext;
      }
    }
  }

  return {
    scenario,
    tenant,
    currencyCode,
    contractEndDate,
    invoiceParties,
    diagnostics,
    periods: periodAccumulators,
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
): ResolvedBillingTiming | null {
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

function buildResolvedContractLineFacts(
  tenant: string,
  scenario: ContractScenario,
  line: ScenarioLine,
  clientId: string,
  contractEndDate: ISO8601String | null,
): ResolvedContractLineFacts {
  return {
    tenantId: tenant,
    clientId,
    clientContractId: scenario.contract_id,
    clientContractLineId: line.key,
    contractLineId: line.key,
    contractName: scenario.name,
    contractLineName: line.contract_line_name,
    contractLineType: line.contract_line_type,
    billingTiming: line.billing_timing,
    currencyCode: scenario.currency_code,
    locationId: line.location_id,
    customRate: line.custom_rate,
    endDate: contractEndDate,
    enableProration: line.enable_proration,
    isSystemManagedDefault: scenario.is_system_managed_default,
  };
}

/* ------------------------------------------------------------------ */
/* Result assembly                                                    */
/* ------------------------------------------------------------------ */

/**
 * The quantity an invoice line shows. Bucket charges leave `quantity`
 * undefined for hour pools (canonical quantity 1), so the displayed quantity
 * comes from the bucket facts with the rule invoices use
 * (invoiceGeneration getChargeQuantity). Presentation only: the canonical
 * line and the engine's output are untouched.
 */
function presentedQuantity(
  canonicalLine: { chargeFamily: string; quantity: number },
  sourceCharge: IBillingCharge | undefined,
): number {
  if (canonicalLine.chargeFamily !== "bucket" || sourceCharge?.type !== "bucket") {
    return canonicalLine.quantity;
  }
  const bucket = sourceCharge as IBucketCharge;
  return bucket.isUsageBucket
    ? (bucket.overageUnits ?? bucket.quantity ?? 0)
    : bucket.overageHours;
}

export function buildSimulatedPeriod(
  accumulator: SimulationCalculationPeriodInput,
  scenario: ContractScenario,
  contractEndDate: ISO8601String | null,
  invoiceParties: SimulatorInvoiceParties,
  calculation: ContractBillingCalculationResult,
): SimulatedPeriod {
  const { window, obligations } = accumulator;
  const obligationById = new Map(
    obligations.map((obligation) => [obligation.obligationId, obligation]),
  );
  const presentationLines: SimulatedInvoiceLine[] = calculation.lines.map(
    (canonicalLine, lineIndex) => {
      const obligation = obligationById.get(canonicalLine.obligationId);
      const unit = obligation?.metadata?.quantityLabel;
      const displayQuantity = presentedQuantity(
        canonicalLine,
        // sourceCharges and lines keep the same order (calculateContractBilling).
        calculation.sourceCharges[lineIndex],
      );
      const supplemental = canonicalLine.obligationId.startsWith("supplemental:")
        ? accumulator.supplementalCharges[
            Number(canonicalLine.obligationId.split(":")[1])
          ]
        : undefined;
      const blockLine =
        supplemental?.type === "prepaid_block"
          ? ("prepaid_block" as const)
          : supplemental?.type === "hour_block"
            ? ("block_draw" as const)
            : null;
      const quantityLabel = blockLine
        ? `${formatHours(canonicalLine.quantity)} hrs`
        : canonicalLine.chargeFamily === "discount"
          ? "discount"
          : canonicalLine.chargeFamily === "adjustment"
            ? "adjustment"
            : unit?.includes("month")
              ? unit
              : `${formatHours(displayQuantity)} ${unit ?? resolveUnitOfMeasure({ fallback: 'C62' }).pluralLabel}`;
      const adjustmentIndex =
        canonicalLine.chargeFamily === "adjustment" && !blockLine
          ? Number(canonicalLine.lineKey.split(":")[1])
          : -1;
      const chargeType =
        blockLine ??
        (canonicalLine.chargeFamily === "hourly"
          ? "time"
          : canonicalLine.chargeFamily === "adjustment" &&
              (scenario.adjustments ?? []).filter(
                (adjustment) =>
                  adjustment.period_index == null ||
                  adjustment.period_index === window.index,
              )[adjustmentIndex]?.one_time
            ? "one_time"
            : canonicalLine.chargeFamily);
      return {
        line_key: canonicalLine.lineKey,
        service_id: canonicalLine.serviceId ?? null,
        service_name: blockLine
          ? blockLine === "prepaid_block"
            ? `Prepaid block issued - ${canonicalLine.description}`
            : `Block draw - ${canonicalLine.description}`
          : canonicalLine.description,
        charge_type: chargeType,
        quantity_label: quantityLabel,
        rate_label: formatCents(canonicalLine.unitRate, scenario.currency_code),
        quantity: displayQuantity,
        unit_price: canonicalLine.unitRate,
        net_amount: canonicalLine.netAmount,
        tax_amount: canonicalLine.taxAmount,
        total: canonicalLine.grossAmount,
        service_period_start: canonicalLine.servicePeriodStart,
        service_period_end: canonicalLine.servicePeriodEnd,
        billing_timing: canonicalLine.billingTiming,
        explanation: canonicalLine.explanation as ChargeExplanation | null,
      };
    },
  );
  const endInclusive = toISODate(
    toPlainDate(window.endDateExclusive).subtract({ days: 1 }),
  );

  const markers: SimulatedPeriodMarker[] = [];
  if (calculation.lines.some((line) => line.markers?.includes("proration"))) {
    markers.push("prorated");
  }
  if (
    new Set(
      obligations
        .map((obligation) => obligation.metadata?.lineCycle)
        .filter(Boolean),
    ).size > 1
  ) {
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
/* Prepaid Block lines                                                */
/* ------------------------------------------------------------------ */

/**
 * Simulates one Prepaid Block line over the horizon and appends the dated
 * `prepaid_block` issuance charges and $0 `hour_block` consumption lines to the
 * owning invoice periods. Returns, per period index, the share of assumed
 * hourly demand that blocks absorbed so the line's hourly charge can bill only
 * the remainder at the overage (hourly) rate.
 */
function simulatePrepaidBlockLine(input: {
  tenant: string;
  scenario: ContractScenario;
  line: ScenarioLine;
  client: SimulationBillingClient;
  taxPorts: ResolvedChargeTaxPolicy;
  currencyCode: string;
  invoicePeriods: SimulatedInvoicePeriodWindow[];
  periodAccumulators: SimulationCalculationPeriodInput[];
  contractStartDate: string | null;
  contractEndDate: string | null;
  diagnostics: SimulationDiagnostic[];
}): { demandCoverage: Map<number, number> } {
  const {
    tenant,
    scenario,
    line,
    client,
    taxPorts,
    currencyCode,
    invoicePeriods,
    periodAccumulators,
    contractStartDate,
    contractEndDate,
    diagnostics,
  } = input;
  const config = line.prepaid_block!;
  const demandCoverage = new Map<number, number>();

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
    return { demandCoverage };
  }
  if (!soldAs) {
    diagnostics.push({
      severity: "warning",
      line_key: line.key,
      message:
        "Prepaid block has no service to sell the block as, so no blocks are simulated.",
    });
    return { demandCoverage };
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

  for (const [periodIndex, demand] of demandMinutesByPeriod) {
    const overage = timeline.overageMinutesByPeriod.get(periodIndex) ?? 0;
    demandCoverage.set(
      periodIndex,
      demand > 0 ? Math.max(0, Math.min(1, (demand - overage) / demand)) : 0,
    );
  }

  const hours = config.block_minutes / 60;
  const rate = Math.round(config.block_price / hours);
  const taxInfo = taxPorts.getTaxInfoFromService({
    service_id: soldAs.service_id,
    tax_rate_id: soldAs.tax_rate_id,
  });
  const taxRegion =
    taxInfo.taxRegion ?? taxPorts.getClientDefaultTaxRegionCode(client.client_id);

  for (const issue of timeline.issues) {
    const accumulator = periodAccumulators[issue.periodIndex];
    let taxAmount = 0;
    let taxRate = 0;
    if (!client.is_tax_exempt && taxInfo.isTaxable && taxRegion) {
      const result = taxPorts.calculateTax(
        client.client_id,
        config.block_price,
        issue.issueDate,
        taxRegion,
        true,
        currencyCode,
      );
      taxAmount = result.taxAmount;
      taxRate = result.taxRate;
    }
    const blockCharge: IPrepaidBlockCharge = {
      type: "prepaid_block",
      tenant,
      issuance_id: `sim-issuance:${line.key}:${issue.blockOrdinal}`,
      contract_line_id: line.key,
      client_contract_line_id: line.key,
      client_contract_id: scenario.contract_id,
      contract_name: scenario.name,
      serviceId: soldAs.service_id,
      serviceName: `${soldAs.service_name} - prepaid block (${formatHours(hours)} h, ${issue.trigger.replace("_", " ")})`,
      block_minutes: config.block_minutes,
      block_price: config.block_price,
      currency_code: currencyCode,
      expiry_months: config.expiry_months,
      scope_service_ids: line.services.map((service) => service.service_id),
      quantity: hours,
      rate,
      total: config.block_price,
      tax_amount: taxAmount,
      tax_rate: taxRate,
      tax_region: taxRegion ?? undefined,
      is_taxable: taxInfo.isTaxable,
      servicePeriodStart: issue.issueDate,
      servicePeriodEnd: accumulator.window.endDateExclusive,
      billingTiming: "advance",
    };
    accumulator.supplementalCharges.push(blockCharge);
  }

  for (const draw of timeline.draws) {
    const accumulator = periodAccumulators[draw.periodIndex];
    const drawCharge: IHourBlockCharge = {
      type: "hour_block",
      tenant,
      block_id: `sim-block:${line.key}:${draw.blockOrdinal}`,
      client_contract_line_id: line.key,
      serviceId: soldAs.service_id,
      serviceName: `${soldAs.service_name} - block draw (block ${draw.blockOrdinal})`,
      hoursUsed: draw.minutes / 60,
      hoursRemaining: draw.remainingMinutes / 60,
      coveredEntryIds: [],
      quantity: draw.minutes / 60,
      rate: 0,
      total: 0,
      tax_amount: 0,
      tax_rate: 0,
      servicePeriodStart: accumulator.window.startDate,
      servicePeriodEnd: accumulator.window.endDateExclusive,
      billingTiming: "arrears",
    };
    accumulator.supplementalCharges.push(drawCharge);
  }

  for (const forfeiture of timeline.forfeitures) {
    diagnostics.push({
      severity: "info",
      line_key: line.key,
      message: `Block ${forfeiture.blockOrdinal} expires on ${forfeiture.date} with ${formatHours(forfeiture.minutes / 60)} h unused, which are forfeited.`,
    });
  }

  return { demandCoverage };
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
