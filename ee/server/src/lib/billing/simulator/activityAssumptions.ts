import type { Knex } from "knex";
import { Temporal } from "@js-temporal/polyfill";
import type {
  ContractScenario,
  ISO8601String,
  ScenarioAssumption,
  ScenarioAssumptionPrefill,
  ScenarioLine,
  ScenarioReplayInvoice,
} from "@alga-psa/types";
import { tenantDb } from "@alga-psa/db";
import { toISODate, toPlainDate } from "@alga-psa/core";
import {
  getBillingPeriodForDate,
  normalizeAnchorSettingsForCycle,
} from "@alga-psa/shared/billingClients/billingCycleAnchors";
import { assumptionKey } from "./syntheticActivity";
import { validateScenarioTenantScope } from "./validateScenarioTenantScope";
import { loadSimulatorInvoiceParties } from "./invoicePreviewContext";
import { enrichWithGroupedItems } from "@alga-psa/billing/lib/adapters/invoiceAdapters";

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

function normalizedAnchor(scenario: ContractScenario) {
  return normalizeAnchorSettingsForCycle(
    scenario.invoice_schedule.billing_cycle,
    {
      dayOfMonth: scenario.invoice_schedule.anchor.day_of_month,
      monthOfYear: scenario.invoice_schedule.anchor.month_of_year,
      dayOfWeek: scenario.invoice_schedule.anchor.day_of_week,
      referenceDate: scenario.invoice_schedule.anchor.reference_date,
    },
  );
}

function periodContaining(
  scenario: ContractScenario,
  date: ISO8601String,
): AssumptionPeriodWindow {
  const period = getBillingPeriodForDate(
    `${toISODate(toPlainDate(date))}T00:00:00Z`,
    scenario.invoice_schedule.billing_cycle,
    normalizedAnchor(scenario),
  );
  return {
    start: period.periodStartDate,
    endExclusive: period.periodEndDate,
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
    throw new Error("Replay end must be after replay start");
  }
  let period = periodContaining(scenario, startDate);
  const periods: AssumptionPeriodWindow[] = [];
  while (
    Temporal.PlainDate.compare(toPlainDate(period.start), requestedEnd) < 0
  ) {
    periods.push(period);
    period = periodContaining(scenario, period.endExclusive);
    if (periods.length > 120) {
      throw new Error("Replay range exceeds the 120-period safety limit");
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
      periodIndexForDate(periods, row.entry_date),
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
      periodIndexForDate(periods, row.usage_date),
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
    const lines = charges.map((charge: any, index: number) => {
      const itemDetails = detailsByItem.get(charge.item_id) ?? [];
      const detail = itemDetails[0];
      const chargeType = charge.is_discount
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
      return {
        line_key: detail?.contract_line_id ?? `actual:${charge.item_id}`,
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
    });
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
    throw new Error(
      "Historical assumptions require a scenario bound to a real client",
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
