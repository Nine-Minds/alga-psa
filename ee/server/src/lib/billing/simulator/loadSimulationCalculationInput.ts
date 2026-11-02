
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
  ITimeBasedCharge,
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
import {
  orderChargesForInvoice,
  resolveContractLineCharges,
  TIMED_CHARGE_FAMILIES,
  WINDOW_DRIVEN_CHARGE_FAMILIES,
  type ResolvedLineCharge,
  type StreamTimings,
} from "@alga-psa/billing/lib/billing/chargeResolution";
import {
  ScenarioChargeSource,
  createScenarioRunState,
  hasRecurringQuantityPrice,
  uniqueProductServices,
} from "./scenarioChargeSource";
import { createReadOnlyTaxPorts } from "./readOnlyTaxPorts";
import { buildCadencePrepaidBlockLedger, buildPrepaidBlockLedger } from "./prepaidBlockLedger";
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
import {
  overPrepaidBlockDescription,
  prepaidBlockFeeDescription,
} from "@alga-psa/billing/lib/billing/compute/prepaidBlockDescriptions";
import { simulationRefusal } from "./simulationRefusal";

interface SimulationBillingClient {
  client_id: string;
  is_tax_exempt?: boolean | null;
}

export interface SimulationCalculationPeriodInput {
  window: SimulatedInvoicePeriodWindow;
  obligations: UnpricedContractBillingObligation[];
  taxContexts: Record<string, ResolvedChargeTaxPolicy>;
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
  const currencyCode = scenario.currency_code;
  if (!currencyCode) {
    throw simulationRefusal(
      "CONTRACT_SIMULATION_SCENARIO_INVALID",
      "This scenario has no currency. Set the contract's currency, then simulate again.",
    );
  }

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
    }));
  const run = createScenarioRunState();
  // Resolved charges collected per invoice period, ordered once at the end.
  const resolvedByPeriod = new Map<number, ResolvedLineCharge[]>();
  const collect = (periodIndex: number, charges: ResolvedLineCharge[]) => {
    const bucket = resolvedByPeriod.get(periodIndex) ?? [];
    bucket.push(...charges);
    resolvedByPeriod.set(periodIndex, bucket);
  };

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

    const lineFacts = buildResolvedContractLineFacts(
      tenant,
      scenario,
      line,
      client.client_id,
      contractEndDate,
    );

    const streamPeriods = generateLineServicePeriods({
      line,
      horizon: scenario.horizon,
      invoiceSchedule: scenario.invoice_schedule,
      contractStartDate: scenario.contract_start_date,
      scenarioId: scenario.scenario_id,
    });

    // Per invoice window, the line's due timing per stream. A window normally
    // holds one period per stream; when a finer line cadence lands several in
    // one window they become further "rounds" (the engine refuses that case, the
    // projection has always priced each period).
    const roundsByWindow = new Map<number, StreamTimings[]>();
    let assignedPeriods = 0;
    for (const { stream, records } of streamPeriods) {
      const countByWindow = new Map<number, number>();
      for (const { periodIndex, record } of assignServicePeriodsToInvoicePeriods(
        records,
        invoicePeriods,
      )) {
        assignedPeriods += 1;
        const timing = buildChargeTiming(record, activityWindow);
        if (!timing) {
          // Service period falls entirely outside the contract's active window;
          // production settlement drops it the same way.
          continue;
        }
        const round = countByWindow.get(periodIndex) ?? 0;
        countByWindow.set(periodIndex, round + 1);
        const rounds = roundsByWindow.get(periodIndex) ?? [];
        rounds[round] = { ...rounds[round], [stream]: timing };
        roundsByWindow.set(periodIndex, rounds);
      }
    }

    // Prepaid Block lines. Consumption blocks: issuance and draws are dated
    // one-offs, not service periods, so the scenario source answers for each
    // invoice window itself (window-driven families). Cadence blocks: one block
    // per due block period, so the ledger is built from the periods above. The
    // hourly charge then prices only the demand no block absorbed.
    const dueTimings = (stream: "line" | "prepaid_block") =>
      Array.from(roundsByWindow, ([periodIndex, rounds]) =>
        rounds.flatMap((round) =>
          round[stream] ? [{ periodIndex, timing: round[stream]! }] : [],
        ),
      ).flat();
    const ledger =
      line.prepaid_block?.issue_mode === "cadence"
        ? buildCadencePrepaidBlockLedger({
            scenario,
            line,
            blockTimings: dueTimings("prepaid_block"),
            hourlyTimings: dueTimings("line"),
            diagnostics,
          })
        : buildPrepaidBlockLedger({
            scenario,
            line,
            invoicePeriods,
            contractStartDate,
            contractEndDate,
            diagnostics,
          });
    if (ledger) {
      run.prepaidLedgers.set(line.key, ledger);
    }

    if (assignedPeriods === 0) {
      diagnostics.push({
        severity: "warning",
        line_key: line.key,
        message: `Does not appear in the next ${scenario.horizon.period_count} invoices because it uses a ${lineCycle} schedule and bills in ${line.billing_timing}.`,
      });
    }

    // One source per (line, invoice window), carrying the stream -> timing map.
    for (const accumulator of periodAccumulators) {
      const index = accumulator.window.index;
      const windowDriven =
        Boolean(ledger) &&
        (ledger!.issuesByPeriod.has(index) || ledger.drawsByPeriod.has(index));
      const rounds = roundsByWindow.get(index) ?? [];
      if (!windowDriven && rounds.length === 0) continue;

      const billingPeriod: IBillingPeriod = {
        tenant,
        startDate: accumulator.window.startDate,
        endDate: accumulator.window.endDateExclusive,
      };
      const sourceFor = (timings: StreamTimings) =>
        new ScenarioChargeSource({
          scenario,
          line,
          lineFacts,
          client,
          billingPeriod,
          timings,
          periodIndex: index,
          taxPorts,
          currencyCode,
          lineCycle,
          diagnostics,
          run,
        });

      if (windowDriven) {
        collect(
          index,
          await resolveContractLineCharges(sourceFor(rounds[0] ?? {}), {
            families: WINDOW_DRIVEN_CHARGE_FAMILIES,
            pools: "ignore",
          }),
        );
      }
      // Which charges the line produces is decided by the shared resolver, the
      // same one the billing engine calls; this loop only supplies scenario data.
      for (const timings of rounds) {
        collect(
          index,
          await resolveContractLineCharges(sourceFor(timings), {
            families: TIMED_CHARGE_FAMILIES,
          }),
        );
      }
    }
  }

  for (const accumulator of periodAccumulators) {
    for (const charge of orderChargesForInvoice(
      resolvedByPeriod.get(accumulator.window.index) ?? [],
    )) {
      accumulator.obligations.push(charge.obligation);
      accumulator.taxContexts[charge.obligation.taxContextKey] =
        charge.taxContext;
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
/**
 * The wording the engine persists for the prepaid-block family (block fee and
 * the time billed over a cadence block), from the one shared helper, so
 * "Compare with past invoices" pairs simulated lines with issued ones.
 */
function presentedBlockDescription(
  description: string,
  sourceCharge: IBillingCharge | undefined,
): string {
  if (sourceCharge?.type === "prepaid_block") {
    return prepaidBlockFeeDescription({
      name: sourceCharge.serviceName,
      hours: (sourceCharge as IPrepaidBlockCharge).quantity,
    });
  }
  if (
    sourceCharge?.type === "time" &&
    (sourceCharge as ITimeBasedCharge).overPrepaidBlock
  ) {
    return overPrepaidBlockDescription(sourceCharge.serviceName);
  }
  return description;
}

function presentedQuantity(
  canonicalLine: { chargeFamily: string; quantity: number },
  sourceCharge: IBillingCharge | undefined,
): number {
  if (
    canonicalLine.chargeFamily === "hourBlockDraw" &&
    sourceCharge?.type === "hour_block"
  ) {
    return (sourceCharge as IHourBlockCharge).hoursUsed;
  }
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
  // The resolver's canonical line carries the scenario line (contractLineId);
  // comparison pairs on the saved contract line that scenario line came from.
  const originByScenarioLine = new Map(
    (scenario.lines ?? []).map((scenarioLine) => [
      scenarioLine.key,
      scenarioLine.origin_contract_line_id ?? null,
    ]),
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
      const blockLine =
        canonicalLine.chargeFamily === "prepaidBlock" ||
        canonicalLine.chargeFamily === "cadencePrepaidBlock"
          ? ("prepaid_block" as const)
          : canonicalLine.chargeFamily === "hourBlockDraw"
            ? ("block_draw" as const)
            : null;
      const quantityLabel = blockLine
        ? `${formatHours(displayQuantity)} hrs`
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
        origin_contract_line_id: canonicalLine.contractLineId
          ? (originByScenarioLine.get(canonicalLine.contractLineId) ?? null)
          : null,
        service_id: canonicalLine.serviceId ?? null,
        service_name:
          blockLine === "block_draw"
            ? `Block draw - ${canonicalLine.description}`
            : presentedBlockDescription(
                canonicalLine.description,
                calculation.sourceCharges[lineIndex],
              ),
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
      currencyCode: scenario.currency_code,
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

/** Minor units in the currency's own digits (JPY has none, KWD has three). */
function formatCents(minorUnits: number, currencyCode: string): string {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minorUnits / 10 ** digits);
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
