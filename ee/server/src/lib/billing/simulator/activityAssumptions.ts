import type { Knex } from "knex";
import { Temporal } from "@js-temporal/polyfill";
import type {
  ContractScenario,
  ISO8601String,
  ScenarioAssumption,
  ScenarioAssumptionPrefill,
  ScenarioLine,
  ScenarioReplayInvoice,
  SimulatedInvoiceLine,
} from "@alga-psa/types";
import { tenantDb } from "@alga-psa/db";
import { toISODate, toPlainDate } from "@alga-psa/core";
import { assumptionKey } from "./syntheticActivity";
import {
  assignServicePeriodsToInvoicePeriods,
  generateLineServicePeriods,
  listInvoiceWindows,
} from "./hypotheticalPeriods";
import { validateScenarioTenantScope } from "./validateScenarioTenantScope";
import { loadSimulatorInvoiceParties } from "./invoicePreviewContext";
import { enrichWithGroupedItems } from "@alga-psa/billing/lib/adapters/invoiceAdapters";
import { simulationRefusal } from "./simulationRefusal";

export interface AssumptionPeriodWindow {
  start: ISO8601String;
  endExclusive: ISO8601String;
}

export interface HistoricalTimeActivityRow {
  contract_line_id?: string | null;
  service_id: string;
  entry_date: ISO8601String;
  billable_duration?: number | string | null;
  start_time?: ISO8601String | Date | null;
  end_time?: ISO8601String | Date | null;
}

export interface HistoricalUsageActivityRow {
  contract_line_id?: string | null;
  service_id: string;
  usage_date: ISO8601String;
  quantity: number | string;
}

function periodContaining(
  scenario: ContractScenario,
  date: ISO8601String,
): AssumptionPeriodWindow {
  const [period] = listInvoiceWindows(
    scenario.invoice_schedule,
    toISODate(toPlainDate(date)),
    1,
  );
  return {
    start: `${period.start}T00:00:00Z`,
    endExclusive: `${period.end}T00:00:00Z`,
  };
}

export function buildRecentAssumptionPeriods(
  scenario: ContractScenario,
  count = 3,
): AssumptionPeriodWindow[] {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(
      "Recent assumption period count must be a positive integer",
    );
  }
  const current = periodContaining(scenario, scenario.horizon.start_date);
  const periods: AssumptionPeriodWindow[] = [];
  let cursor = toPlainDate(current.start).subtract({ days: 1 });
  for (let index = 0; index < count; index += 1) {
    const period = periodContaining(scenario, `${toISODate(cursor)}T00:00:00Z`);
    periods.unshift(period);
    cursor = toPlainDate(period.start).subtract({ days: 1 });
  }
  return periods;
}

export function buildReplayAssumptionPeriods(
  scenario: ContractScenario,
  startDate: ISO8601String,
  endDateExclusive: ISO8601String,
): AssumptionPeriodWindow[] {
  const requestedEnd = toPlainDate(endDateExclusive);
  if (Temporal.PlainDate.compare(toPlainDate(startDate), requestedEnd) >= 0) {
    throw simulationRefusal(
      "CONTRACT_SIMULATION_INVALID_REPLAY_RANGE",
      "The replay range must end after it starts and cover no more than 120 billing periods.",
    );
  }
  let period = periodContaining(scenario, startDate);
  const periods: AssumptionPeriodWindow[] = [];
  while (
    Temporal.PlainDate.compare(toPlainDate(period.start), requestedEnd) < 0
  ) {
    periods.push(period);
    period = periodContaining(scenario, period.endExclusive);
    if (periods.length > 120) {
      throw simulationRefusal(
        "CONTRACT_SIMULATION_INVALID_REPLAY_RANGE",
        "The replay range must end after it starts and cover no more than 120 billing periods.",
      );
    }
  }
  return periods;
}

function activityLine(
  scenario: ContractScenario,
  serviceId: string,
  contractLineId: string | null | undefined,
  kind: "time" | "usage",
): ScenarioLine | null {
  const candidates = scenario.lines.filter((line) => {
    if (
      contractLineId &&
      line.key !== contractLineId &&
      line.origin_contract_line_id !== contractLineId
    ) {
      return false;
    }
    if (kind === "usage" && line.contract_line_type !== "Usage") return false;
    if (kind === "time" && line.contract_line_type === "Usage") return false;
    return line.services.some(
      (service) =>
        service.service_id === serviceId && service.item_kind !== "product",
    );
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function periodIndexForDate(
  periods: AssumptionPeriodWindow[],
  value: ISO8601String,
): number {
  const date = toISODate(toPlainDate(value));
  return periods.findIndex(
    (period) =>
      date >= toISODate(toPlainDate(period.start)) &&
      date < toISODate(toPlainDate(period.endExclusive)),
  );
}

/**
 * Replay stores activity at the invoice index that BILLS it, because that is the
 * index the simulator reads overrides at (ScenarioChargeSource and the prepaid
 * block ledger both resolve the assumed quantity per invoice window). An
 * arrears stream's invoice N bills service period N-1, so work done in
 * service period P belongs on the invoice whose window contains P's closing
 * boundary; an advance stream bills the period's own opening window. Work
 * whose invoice falls past the replay is dropped, and the first replayed
 * invoice shows no arrears activity (the simulator generates no service period
 * before its first window). The
 * assignment is the simulator's own (generateLineServicePeriods +
 * assignServicePeriodsToInvoicePeriods), so the two cannot drift.
 */
export function buildReplayActivityIndexer(
  scenario: ContractScenario,
  periods: AssumptionPeriodWindow[],
): {
  /** Invoice index billing the line's service period containing the date; -1 when none in the replay. */
  indexFor: (line: ScenarioLine, date: ISO8601String) => number;
} {
  const horizon = {
    start_date: periods[0]?.start ?? scenario.horizon.start_date,
    period_count: Math.max(1, periods.length),
  };
  const windows = periods.map((period, index) => ({
    index,
    startDate: toISODate(toPlainDate(period.start)),
    endDateExclusive: toISODate(toPlainDate(period.endExclusive)),
  }));
  const byLine = new Map<
    string,
    Array<{ start: string; end: string; index: number }> | null
  >();
  const lineRanges = (line: ScenarioLine) => {
    if (byLine.has(line.key)) return byLine.get(line.key)!;
    const own = generateLineServicePeriods({
      line,
      horizon,
      invoiceSchedule: scenario.invoice_schedule,
      contractStartDate: scenario.contract_start_date,
      scenarioId: scenario.scenario_id,
    }).find((entry) => entry.stream === "line");
    const ranges = own
      ? assignServicePeriodsToInvoicePeriods(own.records, windows).map(
          ({ periodIndex, record }) => ({
            start: toISODate(toPlainDate(record.servicePeriod.start)),
            end: toISODate(toPlainDate(record.servicePeriod.end)),
            index: periodIndex,
          }),
        )
      : null;
    byLine.set(line.key, ranges);
    return ranges;
  };
  for (const line of scenario.lines) lineRanges(line);
  return {
    indexFor: (line, date) => {
      const day = toISODate(toPlainDate(date));
      const range = lineRanges(line)?.find(
        (candidate) => day >= candidate.start && day < candidate.end,
      );
      return range ? range.index : -1;
    },
  };
}

function durationMinutes(row: HistoricalTimeActivityRow): number {
  const persisted = Number(row.billable_duration ?? 0);
  if (Number.isFinite(persisted) && persisted > 0) return persisted;
  if (row.start_time && row.end_time) {
    return Math.max(
      0,
      (new Date(row.end_time).getTime() - new Date(row.start_time).getTime()) /
        60_000,
    );
  }
  return 0;
}

export function aggregateActivityAssumptions(input: {
  scenario: ContractScenario;
  periods: AssumptionPeriodWindow[];
  timeRows: HistoricalTimeActivityRow[];
  usageRows: HistoricalUsageActivityRow[];
  mode: "average" | "replay";
}): Record<string, ScenarioAssumption> {
  const { scenario, periods, timeRows, usageRows, mode } = input;
  const replayIndexer =
    mode === "replay" ? buildReplayActivityIndexer(scenario, periods) : null;
  // Replay: the invoice that bills the work. Average: the window it falls in
  // (only the per-window total matters for a flat average).
  const indexOf = (line: ScenarioLine, date: ISO8601String) =>
    replayIndexer
      ? replayIndexer.indexFor(line, date)
      : periodIndexForDate(periods, date);
  const values = new Map<string, number[]>();
  const add = (key: string, periodIndex: number, value: number) => {
    if (periodIndex < 0 || !Number.isFinite(value)) return;
    const perPeriod = values.get(key) ?? Array(periods.length).fill(0);
    perPeriod[periodIndex] += value;
    values.set(key, perPeriod);
  };

  for (const row of timeRows) {
    const line = activityLine(
      scenario,
      row.service_id,
      row.contract_line_id,
      "time",
    );
    if (!line) continue;
    add(
      assumptionKey(line.key, row.service_id),
      indexOf(line, row.entry_date),
      durationMinutes(row) / 60,
    );
  }
  for (const row of usageRows) {
    const line = activityLine(
      scenario,
      row.service_id,
      row.contract_line_id,
      "usage",
    );
    if (!line) continue;
    add(
      assumptionKey(line.key, row.service_id),
      indexOf(line, row.usage_date),
      Number(row.quantity) || 0,
    );
  }

  const assumptions: Record<string, ScenarioAssumption> = {};
  for (const [key, perPeriod] of values) {
    assumptions[key] =
      mode === "average"
        ? {
            flat:
              perPeriod.reduce((sum, value) => sum + value, 0) /
              Math.max(1, periods.length),
          }
        : {
            flat: 0,
            overrides: Object.fromEntries(
              perPeriod.map((value, index) => [index, value]),
            ),
          };
  }
  return assumptions;
}

async function loadActivityRows(
  knex: Knex,
  tenant: string,
  clientId: string,
  scenario: ContractScenario,
  periods: AssumptionPeriodWindow[],
): Promise<{
  timeRows: HistoricalTimeActivityRow[];
  usageRows: HistoricalUsageActivityRow[];
}> {
  if (periods.length === 0) return { timeRows: [], usageRows: [] };
  const db = tenantDb(knex, tenant);
  const start = periods[0].start;
  const end = periods[periods.length - 1].endExclusive;
  const contractLineIds = Array.from(
    new Set(
      scenario.lines.flatMap((line) =>
        line.origin_contract_line_id ? [line.origin_contract_line_id] : [],
      ),
    ),
  );
  const [timeRows, usageRows] = await Promise.all([
    contractLineIds.length > 0
      ? db
          .table("time_entries")
          .where({ approval_status: "APPROVED" })
          .whereIn("contract_line_id", contractLineIds)
          .where("work_date", ">=", start)
          .where("work_date", "<", end)
          .select(
            "contract_line_id",
            "service_id",
            { entry_date: "work_date" },
            "billable_duration",
            "start_time",
            "end_time",
          )
      : Promise.resolve([]),
    contractLineIds.length > 0
      ? db
          .table("usage_tracking")
          .where({ client_id: clientId })
          .whereIn("contract_line_id", contractLineIds)
          .where("usage_date", ">=", start)
          .where("usage_date", "<", end)
          .select("contract_line_id", "service_id", "usage_date", "quantity")
      : Promise.resolve([]),
  ]);
  return { timeRows, usageRows };
}

/**
 * The saved Prepaid Block line that sells/covers a service, when exactly one
 * does. $0 draw lines are persisted without a detail row, so the contract's own
 * structure is the only attribution available.
 */
function blockLineForService(
  scenario: ContractScenario,
  serviceId: string | null | undefined,
): string | null {
  if (!serviceId) return null;
  const candidates = scenario.lines.filter(
    (line) =>
      line.prepaid_block &&
      line.origin_contract_line_id &&
      line.services.some((service) => service.service_id === serviceId),
  );
  return candidates.length === 1 ? candidates[0].origin_contract_line_id : null;
}

export interface ReplayChargeRow {
  item_id: string;
  service_id?: string | null;
  billing_charge_type?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  net_amount?: number | string | null;
  tax_amount?: number | string | null;
  total_price?: number | string | null;
  is_discount?: boolean | null;
  item_kind?: string | null;
  is_license?: boolean | null;
}

export interface ReplayChargeDetailRow {
  service_period_start?: ISO8601String | null;
  service_period_end?: ISO8601String | null;
  contract_line_id?: string | null;
  configuration_type?: string | null;
}

/** Maps one issued invoice charge (and its detail) to a comparable line. */
// LEVERAGE: pattern charge-stream-to-type — second copy of the billing_charge_type -> stream/charge_type mapping (see SimulatedInvoiceLine builders); a shared stream vocabulary below would remove it.
export function buildReplayInvoiceLine(input: {
  charge: ReplayChargeRow;
  detail?: ReplayChargeDetailRow;
  /** contract_lines row that invoice_charge_details.config_id points at (block fees). */
  blockLineId: string | null;
  scenario: ContractScenario;
}): SimulatedInvoiceLine {
  const { charge, detail, blockLineId, scenario } = input;
  // billing_charge_type is the engine's own record of the charge stream;
  // it is what tells a block fee and a $0 draw line from fixed/hourly lines.
  const blockStream =
    charge.billing_charge_type === "prepaid_block"
      ? ("prepaid_block" as const)
      : charge.billing_charge_type === "hour_block"
        ? ("block_draw" as const)
        : null;
  const chargeType = blockStream
    ? blockStream
    : charge.is_discount
    ? "discount"
    : charge.item_kind === "product"
      ? charge.is_license
        ? "license"
        : "product"
      : detail?.configuration_type === "Hourly"
        ? "time"
        : detail?.configuration_type === "Usage"
          ? "usage"
          : detail?.configuration_type === "Bucket"
            ? "bucket"
            : "fixed";
  const net = Number(charge.net_amount ?? charge.total_price ?? 0);
  const tax = Number(charge.tax_amount ?? 0);
  // Origin contract line: the service configuration's line, else the block
  // line the fee detail points at, else (a $0 draw line has no detail row)
  // the one block line that sells this service.
  const originContractLineId =
    detail?.contract_line_id ??
    blockLineId ??
    (blockStream === "block_draw"
      ? blockLineForService(scenario, charge.service_id)
      : null);
  return {
    line_key: originContractLineId ?? `actual:${charge.item_id}`,
    origin_contract_line_id: originContractLineId,
    service_id: charge.service_id ?? null,
    service_name: charge.description || "Invoice line",
    charge_type: chargeType,
    quantity_label: String(Number(charge.quantity ?? 1)),
    rate_label: String(Number(charge.unit_price ?? 0)),
    net_amount: net,
    tax_amount: tax,
    total: net + tax,
    explanation: null,
    service_period_start: detail?.service_period_start ?? undefined,
    service_period_end: detail?.service_period_end ?? undefined,
  };
}

async function loadReplayInvoices(
  knex: Knex,
  tenant: string,
  clientId: string,
  scenario: ContractScenario,
  periods: AssumptionPeriodWindow[],
): Promise<ScenarioReplayInvoice[]> {
  if (periods.length === 0) return [];
  const db = tenantDb(knex, tenant);
  const invoiceParties = await loadSimulatorInvoiceParties(
    knex,
    tenant,
    scenario.client_binding,
  );
  const invoices = await db
    .table("invoices")
    .where({ client_id: clientId })
    .whereIn("status", ["sent", "paid", "overdue"])
    .where("billing_period_start", ">=", periods[0].start)
    .where(
      "billing_period_start",
      "<",
      periods[periods.length - 1].endExclusive,
    )
    .orderBy("billing_period_start", "asc")
    .select(
      "invoice_id",
      "invoice_number",
      "status",
      "invoice_date",
      "due_date",
      "billing_period_start",
      "billing_period_end",
      "subtotal",
      "tax",
      "total_amount",
      "currency_code",
      "po_number",
    );
  const replayInvoices: ScenarioReplayInvoice[] = [];

  for (const invoice of invoices) {
    const chargeQuery = db.table("invoice_charges as ic");
    db.tenantJoin(
      chargeQuery,
      "service_catalog as sc",
      "sc.service_id",
      "ic.service_id",
      {
        type: "left",
      },
    );
    const charges = await chargeQuery
      .where({ "ic.invoice_id": invoice.invoice_id })
      .orderBy("ic.item_id", "asc")
      .select(
        "ic.item_id",
        "ic.service_id",
        "ic.billing_charge_type",
        "ic.description",
        "ic.quantity",
        "ic.unit_price",
        "ic.net_amount",
        "ic.tax_amount",
        "ic.total_price",
        "ic.is_discount",
        "sc.item_kind",
        "sc.is_license",
      );
    const detailQuery = db.table("invoice_charge_details as iid");
    db.tenantJoin(
      detailQuery,
      "contract_line_service_configuration as clsc",
      "clsc.config_id",
      "iid.config_id",
      { type: "left" },
    );
    // Engine-written prepaid-block fee details carry config_id = the block
    // line's contract_line_id (there is no service configuration row), so the
    // configuration join above misses them; resolve that id directly.
    const blockLineQuery = db.table("invoice_charge_details as iid");
    db.tenantJoin(
      blockLineQuery,
      "contract_lines as cl",
      "cl.contract_line_id",
      "iid.config_id",
      { type: "inner" },
    );
    const blockLineByItem = new Map<string, string>();
    if (charges.length > 0) {
      const blockLineRows = await blockLineQuery
        .whereIn(
          "iid.item_id",
          charges.map((charge: { item_id: string }) => charge.item_id),
        )
        .select("iid.item_id", "cl.contract_line_id");
      for (const row of blockLineRows) {
        blockLineByItem.set(row.item_id, row.contract_line_id);
      }
    }
    const details =
      charges.length > 0
        ? await detailQuery
            .whereIn(
              "iid.item_id",
              charges.map((charge: { item_id: string }) => charge.item_id),
            )
            .select(
              "iid.item_id",
              "iid.service_period_start",
              "iid.service_period_end",
              "clsc.contract_line_id",
              "clsc.configuration_type",
            )
        : [];
    const detailsByItem = new Map<string, typeof details>();
    for (const detail of details) {
      const itemDetails = detailsByItem.get(detail.item_id) ?? [];
      itemDetails.push(detail);
      detailsByItem.set(detail.item_id, itemDetails);
    }
    const lines = charges.map((charge: any) =>
      buildReplayInvoiceLine({
        charge,
        detail: (detailsByItem.get(charge.item_id) ?? [])[0],
        blockLineId: blockLineByItem.get(charge.item_id) ?? null,
        scenario,
      }),
    );
    const subtotal = Number(invoice.subtotal ?? 0);
    const tax = Number(invoice.tax ?? 0);
    const total = Number(invoice.total_amount ?? subtotal + tax);
    const periodStart = `${toISODate(toPlainDate(invoice.billing_period_start))}T00:00:00Z`;
    const periodEnd = `${toISODate(toPlainDate(invoice.billing_period_end))}T00:00:00Z`;
    replayInvoices.push({
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number,
      status: invoice.status,
      period_start: periodStart,
      period_end: periodEnd,
      lines,
      subtotal,
      tax,
      total,
      invoice_view_model: enrichWithGroupedItems({
        invoiceNumber: invoice.invoice_number,
        issueDate: toISODate(toPlainDate(invoice.invoice_date)),
        dueDate: toISODate(toPlainDate(invoice.due_date)),
        poNumber: invoice.po_number ?? null,
        tenantClient: invoiceParties.tenantClient,
        customer: invoiceParties.customer,
        items: lines.map((line, index) => ({
          id: `actual-${invoice.invoice_id}-${index}`,
          description: line.service_name,
          quantity: Number(charges[index]?.quantity ?? 1),
          unitPrice: Number(charges[index]?.unit_price ?? line.net_amount),
          total: line.net_amount,
          taxAmount: line.tax_amount,
          category: line.charge_type,
          itemType:
            line.charge_type === "product" || line.charge_type === "license"
              ? "product"
              : "service",
          servicePeriodStart: line.service_period_start ?? null,
          servicePeriodEnd: line.service_period_end ?? null,
          billingTiming: null,
        })),
        subtotal,
        tax,
        total,
        currencyCode: invoice.currency_code || scenario.currency_code,
      }),
    });
  }
  return replayInvoices;
}

function requireClientBinding(scenario: ContractScenario): string {
  if (scenario.client_binding.kind !== "client") {
    throw simulationRefusal(
      "CONTRACT_SIMULATION_HISTORY_REQUIRES_CLIENT",
      "Historical assumptions need a scenario bound to a real client. Choose a client for this simulation, then try again.",
    );
  }
  return scenario.client_binding.client_id;
}

export async function loadRecentAverageAssumptions(
  knex: Knex,
  tenant: string,
  scenario: ContractScenario,
  periodCount = 3,
): Promise<ScenarioAssumptionPrefill> {
  await validateScenarioTenantScope(knex, tenant, scenario);
  const periods = buildRecentAssumptionPeriods(scenario, periodCount);
  const rows = await loadActivityRows(
    knex,
    tenant,
    requireClientBinding(scenario),
    scenario,
    periods,
  );
  return {
    assumptions: aggregateActivityAssumptions({
      scenario,
      periods,
      ...rows,
      mode: "average",
    }),
    period_labels: periods.map(
      (period) =>
        `${toISODate(toPlainDate(period.start))} – ${toISODate(toPlainDate(period.endExclusive).subtract({ days: 1 }))}`,
    ),
  };
}

export async function loadReplayAssumptions(
  knex: Knex,
  tenant: string,
  scenario: ContractScenario,
  startDate: ISO8601String,
  endDateExclusive: ISO8601String,
): Promise<ScenarioAssumptionPrefill> {
  await validateScenarioTenantScope(knex, tenant, scenario);
  const periods = buildReplayAssumptionPeriods(
    scenario,
    startDate,
    endDateExclusive,
  );
  const rows = await loadActivityRows(
    knex,
    tenant,
    requireClientBinding(scenario),
    scenario,
    periods,
  );
  const actualInvoices = await loadReplayInvoices(
    knex,
    tenant,
    requireClientBinding(scenario),
    scenario,
    periods,
  );
  return {
    assumptions: aggregateActivityAssumptions({
      scenario,
      periods,
      ...rows,
      mode: "replay",
    }),
    horizon: {
      start_date: periods[0]?.start ?? startDate,
      period_count: periods.length,
    },
    period_labels: periods.map(
      (period) =>
        `${toISODate(toPlainDate(period.start))} – ${toISODate(toPlainDate(period.endExclusive).subtract({ days: 1 }))}`,
    ),
    actual_invoices: actualInvoices,
  };
}
