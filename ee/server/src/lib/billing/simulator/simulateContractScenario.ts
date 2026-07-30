/**
 * EE contract simulation orchestrator: prices a ContractScenario over its
 * horizon through the shared pure billing compute layer.
 *
 * Strictly read-only against the database. This module must never import
 * BillingEngine, invoice generation/numbering, or TaxService (whose
 * calculateTax provisions default client tax settings); all tax/region
 * lookups flow through the read-only ports in ./readOnlyTaxPorts.
 *
 * v1 scope: Fixed and Hourly service families are priced. Usage and Bucket
 * configurations emit diagnostics and are excluded from totals.
 */

import type { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';
import type {
  ChargeExplanation,
  ContractScenario,
  ContractSimulationResult,
  IBillingPeriod,
  IClientContractLine,
  IFixedPriceCharge,
  IRecurringActivityWindow,
  IRecurringServicePeriod,
  IRecurringServicePeriodRecord,
  ISO8601String,
  ITimeBasedCharge,
  ScenarioLine,
  ScenarioLineService,
  ScenarioPricingSchedule,
  SimulatedInvoiceLine,
  SimulatedPeriod,
  SimulatedPeriodMarker,
  SimulationDiagnostic,
} from '@alga-psa/types';
import { RECURRING_RANGE_SEMANTICS } from '@alga-psa/types';
import { toISODate, toPlainDate } from '@alga-psa/core';
import { tenantDb } from '@alga-psa/db';
import {
  calculateServicePeriodCoverage,
  intersectActivityWindow,
} from '@alga-psa/shared/billingClients/recurringTiming';
import {
  computeFixedCharges,
  computeTimeBasedCharges,
  type ChargeComputeClient,
  type ChargeComputeTaxPorts,
  type ChargeComputeTiming,
  type FixedPlanServiceRow,
  type TimeEntryComputeRow,
} from '@alga-psa/billing/lib/billing/compute';
import {
  assignServicePeriodsToInvoicePeriods,
  buildInvoicePeriods,
  generateLineServicePeriods,
  isSupportedBillingFrequency,
  monthsPerCycle,
  normalizeBillingCycle,
  type SimulatedInvoicePeriodWindow,
} from './hypotheticalPeriods';
import {
  buildHourlyServiceConfigMap,
  buildSyntheticTimeEntry,
  hasResolvableHourlyRate,
  resolveAssumedQuantity,
  syntheticConfigId,
} from './syntheticActivity';
import { createReadOnlyTaxPorts } from './readOnlyTaxPorts';

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
    throw new Error('Tenant context is required to simulate a contract scenario');
  }
  if (!scenario) {
    throw new Error('A contract scenario is required to run a simulation');
  }
  if (!Array.isArray(scenario.lines)) {
    throw new Error(
      `Scenario ${scenario.scenario_id ?? '(unknown)'} has no lines array`,
    );
  }

  const db = tenantDb(knex, tenant);
  const diagnostics: SimulationDiagnostic[] = [];
  const currencyCode = scenario.currency_code || 'USD';

  // --- Client context (read-only) ---
  let client: ChargeComputeClient;
  let profileBinding: { tax_region: string | null; currency_code: string } | null =
    null;
  if (scenario.client_binding.kind === 'client') {
    const clientRow = await db
      .table('clients')
      .where({ client_id: scenario.client_binding.client_id })
      .first('client_id', 'is_tax_exempt');
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
    client = { client_id: 'simulated-client', is_tax_exempt: false };
  }

  const taxPorts = createReadOnlyTaxPorts(knex, tenant, {
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

  await emitLiveOvertimeDiagnostics(db, scenario, diagnostics);

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
    simulateLineDiagnostics(line, diagnostics);

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
        severity: 'warning',
        line_key: line.key,
        message:
          `Contract line "${line.contract_line_name}" never bills within the ` +
          `simulation horizon (${lineCycle} cadence, billed ${line.billing_timing}).`,
      });
      continue;
    }

    const fixedServices = line.services.filter(
      (service) => service.configuration.configuration_type === 'Fixed',
    );
    const hourlyServices = line.services.filter(
      (service) => service.configuration.configuration_type === 'Hourly',
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

      if (fixedServices.length > 0 || line.contract_line_type === 'Fixed') {
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
    }
  }

  const periods: SimulatedPeriod[] = periodAccumulators.map((accumulator) =>
    finalizePeriod(accumulator, scenario, contractEndDate),
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
): void {
  if (!isSupportedBillingFrequency(line.billing_frequency)) {
    diagnostics.push({
      severity: 'info',
      line_key: line.key,
      message:
        `Billing frequency "${line.billing_frequency}" on line ` +
        `"${line.contract_line_name}" is not supported by the simulator; treated as monthly.`,
    });
  }

  if (line.services.length === 0) {
    diagnostics.push({
      severity: 'info',
      line_key: line.key,
      message: `Contract line "${line.contract_line_name}" has no services; nothing to bill.`,
    });
  }

  for (const service of line.services) {
    const configType = service.configuration.configuration_type;
    if (configType === 'Usage' || configType === 'Bucket') {
      diagnostics.push({
        severity: 'info',
        line_key: line.key,
        message:
          `${configType} simulation is not yet supported in this draft; service ` +
          `"${service.service_name}" on line "${line.contract_line_name}" is excluded from totals.`,
      });
    }
  }
}

async function emitLiveOvertimeDiagnostics(
  db: ReturnType<typeof tenantDb>,
  scenario: ContractScenario,
  diagnostics: SimulationDiagnostic[],
): Promise<void> {
  const originByLineId = new Map<string, ScenarioLine>();
  for (const line of scenario.lines) {
    if (line.origin_contract_line_id) {
      originByLineId.set(line.origin_contract_line_id, line);
    }
  }
  if (originByLineId.size === 0) {
    return;
  }

  const overtimeLines = await db
    .table('contract_lines')
    .whereIn('contract_line_id', Array.from(originByLineId.keys()))
    .where('enable_overtime', true)
    .select('contract_line_id', 'contract_line_name');

  for (const row of overtimeLines) {
    const line = originByLineId.get(row.contract_line_id);
    diagnostics.push({
      severity: 'info',
      line_key: line?.key,
      message:
        `Live contract line "${row.contract_line_name}" has overtime enabled; ` +
        'the simulator does not model overtime in this draft.',
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
    kind: 'service_period',
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
  customRateSource: 'pricing_schedule' | 'assignment' | null;
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
      customRateSource: 'pricing_schedule',
    };
  }

  if (line.custom_rate != null) {
    return { effectiveCustomRate: line.custom_rate, customRateSource: 'assignment' };
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
    if (service.configuration.configuration_type !== 'Fixed') {
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

  const { charges, explanations } = await computeFixedCharges(
    {
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
    taxPorts,
  );
  // advanceGuard is intentionally ignored: it exists to suppress
  // double-billing against persisted charges, and a simulation persists
  // nothing.

  const explanationByKey = new Map(
    explanations.map((explanation) => [explanation.chargeKey, explanation]),
  );

  for (const charge of charges) {
    const explanation =
      explanationByKey.get(fixedChargeExplanationKey(charge)) ?? null;
    pushChargeLine({
      accumulator,
      lineKey: line.key,
      lineCycle,
      charge: {
        serviceId: charge.serviceId ?? null,
        serviceName: charge.serviceName,
        chargeType: charge.type,
        quantityLabel: cadenceQuantityLabel(lineCycle),
        rate: charge.rate ?? 0,
        net: charge.total ?? 0,
        tax: charge.tax_amount ?? 0,
      },
      currencyCode,
      explanation,
    });
  }
}

/** Replicates computeFixedCharges' internal chargeKey derivation. */
function fixedChargeExplanationKey(charge: IFixedPriceCharge): string {
  return `${charge.config_id ?? charge.client_contract_line_id ?? 'line'}:${charge.serviceId ?? 'service'}`;
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
        severity: 'warning',
        line_key: line.key,
        message:
          `Missing pricing for hourly service "${service.service_name}" on line ` +
          `"${line.contract_line_name}" in ${currencyCode}: no hourly rate, custom rate, ` +
          `or ${currencyCode} catalog price. Assumed hours for period ${periodIndex + 1} were not priced.`,
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

  const { charges, explanations } = await computeTimeBasedCharges(
    {
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
    taxPorts,
  );

  const explanationByKey = new Map(
    explanations.map((explanation) => [explanation.chargeKey, explanation]),
  );

  for (const charge of charges) {
    const explanation =
      explanationByKey.get(
        timeChargeExplanationKey(charge, clientContractLine),
      ) ?? null;
    pushChargeLine({
      accumulator,
      lineKey: line.key,
      lineCycle,
      charge: {
        serviceId: charge.serviceId ?? null,
        serviceName: charge.serviceName,
        chargeType: charge.type,
        quantityLabel: `${formatHours(charge.duration ?? 0)} hrs`,
        rate: charge.rate ?? 0,
        net: charge.total ?? 0,
        tax: charge.tax_amount ?? 0,
      },
      currencyCode,
      explanation,
    });
  }
}

/** Replicates computeTimeBasedCharges' internal chargeKey derivation. */
function timeChargeExplanationKey(
  charge: ITimeBasedCharge,
  clientContractLine: IClientContractLine,
): string {
  return `${charge.config_id ?? clientContractLine.client_contract_line_id}:${charge.serviceId}:${charge.entryId}`;
}

/* ------------------------------------------------------------------ */
/* Result assembly                                                    */
/* ------------------------------------------------------------------ */

function pushChargeLine(input: {
  accumulator: PeriodAccumulator;
  lineKey: string;
  lineCycle: string;
  charge: {
    serviceId: string | null;
    serviceName: string;
    chargeType: string;
    quantityLabel: string;
    rate: number;
    net: number;
    tax: number;
  };
  currencyCode: string;
  explanation: ChargeExplanation | null;
}): void {
  const { accumulator, lineKey, lineCycle, charge, currencyCode, explanation } =
    input;

  accumulator.lines.push({
    line_key: lineKey,
    service_id: charge.serviceId,
    service_name: charge.serviceName,
    charge_type: charge.chargeType,
    quantity_label: charge.quantityLabel,
    rate_label: formatCents(charge.rate, currencyCode),
    net_amount: charge.net,
    tax_amount: charge.tax,
    total: charge.net + charge.tax,
    explanation,
  });
  accumulator.lineCycles.add(lineCycle);
  if (explanation?.markers.includes('proration')) {
    accumulator.prorated = true;
  }
}

function finalizePeriod(
  accumulator: PeriodAccumulator,
  scenario: ContractScenario,
  contractEndDate: ISO8601String | null,
): SimulatedPeriod {
  const { window, lines } = accumulator;
  const endInclusive = toISODate(
    toPlainDate(window.endDateExclusive).subtract({ days: 1 }),
  );

  const markers: SimulatedPeriodMarker[] = [];
  if (accumulator.prorated) {
    markers.push('prorated');
  }
  if (accumulator.lineCycles.size > 1) {
    markers.push('cadence_coincidence');
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
    markers.push('contract_end');
  }

  const subtotal = lines.reduce((sum, invoiceLine) => sum + invoiceLine.net_amount, 0);
  const tax = lines.reduce((sum, invoiceLine) => sum + invoiceLine.tax_amount, 0);

  return {
    index: window.index,
    period_start: `${window.startDate}T00:00:00Z`,
    period_end: `${endInclusive}T00:00:00Z`,
    label: formatPeriodLabel(
      window.startDate,
      endInclusive,
      scenario.invoice_schedule.billing_cycle,
    ),
    lines,
    subtotal,
    tax,
    total: subtotal + tax,
    markers,
  };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                         */
/* ------------------------------------------------------------------ */

function formatCents(cents: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode || 'USD',
  }).format(cents / 100);
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
}

function cadenceQuantityLabel(lineCycle: string): string {
  switch (lineCycle) {
    case 'quarterly':
      return '3 months';
    case 'semi-annually':
      return '6 months';
    case 'annually':
      return '12 months';
    default:
      return '1 month';
  }
}

function formatPeriodLabel(
  startDate: ISO8601String,
  endInclusive: ISO8601String,
  billingCycle: string,
): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const startLabel = formatter.format(new Date(`${startDate}T00:00:00Z`));
  if (billingCycle === 'monthly') {
    return startLabel;
  }
  const endLabel = formatter.format(new Date(`${endInclusive}T00:00:00Z`));
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
}
