/**
 * Row-loading companion to `resolveFixedLineRate` (plan §0.1).
 *
 * The resolver is pure over already-loaded rows so tests and callers can supply
 * fixtures. Production callers — the rate-review preview/apply and the rollout
 * preview — need a real loader; this is the one, batched by contract line so a
 * tenant-wide review is a bounded set of queries rather than N per line.
 */

import type { Knex } from "knex";
import { tenantDb } from "@alga-psa/db";
import type {
  ContractLineRateRow,
  PlanServiceRateRow,
  PricingScheduleRateRow,
  ResolveFixedLineRateInput,
  ServicePriceRateRow,
  UnitPricingRevisionRateRow,
} from "./resolveFixedLineRate";

export interface FixedLineRateInputBundle {
  contractLineId: string;
  contractId: string | null;
  contractName: string | null;
  clientId: string | null;
  currency: string;
  contractIsActive: boolean;
  contractHasEnded: boolean;
  lineIsActive: boolean;
  line: ContractLineRateRow;
  planServices: PlanServiceRateRow[];
  schedules: PricingScheduleRateRow[];
  revisions: UnitPricingRevisionRateRow[];
  catalogPrices: ServicePriceRateRow[];
  /** Distinct services referenced by the line's members. */
  serviceIds: string[];
  tenantDefaultCurrency: string;
}

export interface LoadFixedLineRateInputsOptions {
  /** Restrict lines to those whose `rate_provenance` is this value. */
  provenance?: "custom" | "inherited" | "unreviewed";
}

function calendarDate(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? ""));
  return match ? match[1] : null;
}

function todayCalendarDate(reference: Date = new Date()): string {
  return reference.toISOString().slice(0, 10);
}

/**
 * Load every resolver input for the given contract lines.
 *
 * Lines that do not exist (or are templates) are omitted. Callers that need
 * only the resolver input can pass `bundle` straight through as `resolver`.
 */
export async function loadFixedLineRateInputs(
  trx: Knex | Knex.Transaction,
  tenant: string,
  contractLineIds: string[],
  options: LoadFixedLineRateInputsOptions = {},
): Promise<Map<string, FixedLineRateInputBundle>> {
  const result = new Map<string, FixedLineRateInputBundle>();
  const uniqueIds = [...new Set(contractLineIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return result;
  }

  const db = tenantDb(trx, tenant);

  const lineRows = await db
    .table<ContractLineRateRow & { contract_id: string | null; is_active: boolean | null }>(
      "contract_lines",
    )
    .whereIn("contract_line_id", uniqueIds)
    // Live lines are attached to a contract; template lines are not billed and
    // have no contract currency to compare against.
    .whereNotNull("contract_id")
    .modify((query) => {
      if (options.provenance) {
        query.where("rate_provenance", options.provenance);
      }
    })
    .select("contract_line_id", "custom_rate", "rate_provenance", "contract_id", "is_active");

  if (lineRows.length === 0) {
    return result;
  }

  const contractIds = [
    ...new Set(
      (lineRows as Array<{ contract_id: string | null }>)
        .map((row) => row.contract_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const contractRows =
    contractIds.length > 0
      ? await db
          .table("contracts")
          .whereIn("contract_id", contractIds)
          .select(
            "contract_id",
            "contract_name",
            "currency_code",
            "is_active",
            "status",
            "end_date",
          )
      : [];
  const contractById = new Map(
    (contractRows as any[]).map((row) => [String(row.contract_id), row]),
  );

  const assignmentRows =
    contractIds.length > 0
      ? await db
          .table("client_contracts")
          .whereIn("contract_id", contractIds)
          .select("contract_id", "client_id", "is_active", "start_date", "end_date")
      : [];
  const assignmentByContract = new Map<string, any>();
  for (const row of assignmentRows as any[]) {
    if (!assignmentByContract.has(String(row.contract_id))) {
      assignmentByContract.set(String(row.contract_id), row);
    }
  }

  const planServiceQuery = db.table<any>("contract_line_services as cls");
  db.tenantJoin(
    planServiceQuery,
    "contract_line_service_configuration as clsc",
    "clsc.contract_line_id",
    "cls.contract_line_id",
    {
      on(join) {
        join.andOn("clsc.service_id", "=", "cls.service_id");
      },
    },
  );
  db.tenantJoin(
    planServiceQuery,
    "contract_line_service_fixed_config as clsfc",
    "clsfc.config_id",
    "clsc.config_id",
    { type: "left" },
  );
  db.tenantJoin(planServiceQuery, "service_catalog as sc", "sc.service_id", "cls.service_id");

  const planServiceRows = await planServiceQuery
    .whereIn("cls.contract_line_id", uniqueIds)
    .whereNot("sc.item_kind", "product")
    .select(
      "cls.contract_line_id as source_contract_line_id",
      "sc.service_id",
      "sc.default_rate",
      "cls.quantity as service_quantity",
      "clsc.quantity as configuration_quantity",
      "clsc.custom_rate as configuration_custom_rate",
      "clsc.config_id",
      "clsfc.base_rate as service_base_rate",
      "clsfc.rate_provenance as base_rate_provenance",
    );

  const planServicesByLine = new Map<string, PlanServiceRateRow[]>();
  const serviceIdsByLine = new Map<string, Set<string>>();
  for (const row of planServiceRows as any[]) {
    const lineId = String(row.source_contract_line_id);
    const list = planServicesByLine.get(lineId) ?? [];
    list.push(row);
    planServicesByLine.set(lineId, list);
    const ids = serviceIdsByLine.get(lineId) ?? new Set<string>();
    ids.add(String(row.service_id));
    serviceIdsByLine.set(lineId, ids);
  }

  const scheduleRows =
    contractIds.length > 0
      ? await db
          .table("contract_pricing_schedules")
          .whereIn("contract_id", contractIds)
          .select(
            "schedule_id",
            "contract_id",
            "contract_line_id",
            "effective_date",
            "end_date",
            "custom_rate",
          )
      : [];
  const schedulesByContract = new Map<string, PricingScheduleRateRow[]>();
  for (const row of scheduleRows as any[]) {
    const key = String(row.contract_id);
    const list = schedulesByContract.get(key) ?? [];
    list.push(row);
    schedulesByContract.set(key, list);
  }

  const revisionRows = await db
    .table("contract_line_unit_pricing_revisions")
    .whereIn("contract_line_id", uniqueIds)
    .select(
      "revision_id",
      "contract_line_id",
      "service_id",
      "config_id",
      "effective_period_start",
      "unit_rate_cents",
      "created_at",
    );
  const revisionsByLine = new Map<string, UnitPricingRevisionRateRow[]>();
  for (const row of revisionRows as any[]) {
    const key = String(row.contract_line_id);
    const list = revisionsByLine.get(key) ?? [];
    list.push(row);
    revisionsByLine.set(key, list);
  }

  const allServiceIds = [
    ...new Set(
      [...serviceIdsByLine.values()].flatMap((set) => [...set]),
    ),
  ];
  const priceRows =
    allServiceIds.length > 0
      ? await db
          .table("service_prices")
          .whereIn("service_id", allServiceIds)
          .select("price_id", "service_id", "currency_code", "rate", "effective_date")
      : [];

  const tenantSettings = await db
    .table("default_billing_settings")
    .select("default_currency_code")
    .first();
  const tenantDefaultCurrency =
    (tenantSettings?.default_currency_code as string | undefined)?.trim() || "USD";

  const today = todayCalendarDate();

  for (const line of lineRows as any[]) {
    const lineId = String(line.contract_line_id);
    const contract = contractById.get(String(line.contract_id)) ?? null;
    const assignment = assignmentByContract.get(String(line.contract_id)) ?? null;

    const contractIsActive =
      contract?.is_active !== false &&
      String(contract?.status ?? "active").toLowerCase() !== "inactive" &&
      assignment?.is_active !== false;
    const contractEnd = calendarDate(
      assignment?.end_date ?? contract?.end_date ?? null,
    );
    const contractHasEnded = contractEnd !== null && contractEnd < today;

    const serviceIds = [...(serviceIdsByLine.get(lineId) ?? new Set<string>())];
    const currency =
      (contract?.currency_code as string | undefined)?.trim() || "USD";

    result.set(lineId, {
      contractLineId: lineId,
      contractId: line.contract_id ? String(line.contract_id) : null,
      contractName: contract?.contract_name ?? null,
      clientId: assignment?.client_id ? String(assignment.client_id) : null,
      currency,
      contractIsActive,
      contractHasEnded,
      lineIsActive: line.is_active !== false,
      line: {
        contract_line_id: lineId,
        custom_rate: line.custom_rate ?? null,
        rate_provenance: line.rate_provenance ?? null,
      },
      planServices: planServicesByLine.get(lineId) ?? [],
      schedules: schedulesByContract.get(String(line.contract_id)) ?? [],
      revisions: revisionsByLine.get(lineId) ?? [],
      catalogPrices: priceRows as ServicePriceRateRow[],
      serviceIds,
      tenantDefaultCurrency,
    });
  }

  return result;
}

export function toResolverInput(
  bundle: FixedLineRateInputBundle,
  period: { start: string; end: string },
): ResolveFixedLineRateInput {
  return {
    line: bundle.line,
    planServices: bundle.planServices,
    schedules: bundle.schedules,
    revisions: bundle.revisions,
    catalogPrices: bundle.catalogPrices,
    period,
    currency: bundle.currency,
    tenantDefaultCurrency: bundle.tenantDefaultCurrency,
  };
}
