import type { Knex } from "knex";
import type {
  ContractDraftBucketOverlayInput,
  ContractDraftSimulationInput,
  ContractScenario,
  ScenarioCatalogService,
  ScenarioLine,
  ScenarioLineService,
  ScenarioServiceConfig,
} from "@alga-psa/types";
import { tenantDb } from "@alga-psa/db";
import { toISODate, toPlainDate } from "@alga-psa/core";
import { getClientBillingCycleAnchor } from "@alga-psa/shared/billingClients/billingSchedule";
import { assumptionKey } from "./syntheticActivity";

const midnight = (value: string): string =>
  `${toISODate(toPlainDate(value))}T00:00:00Z`;

export async function draftContractToScenario(
  knex: Knex,
  tenant: string,
  draft: ContractDraftSimulationInput,
): Promise<ContractScenario> {
  if (!draft.client_id) throw new Error("Select a client before simulating");
  const db = tenantDb(knex, tenant);
  const client = await db
    .table("clients")
    .where({ client_id: draft.client_id })
    .first("client_id", "client_name");
  if (!client) throw new Error("Draft simulation client is not available");

  const currencyCode = draft.currency_code || "USD";
  const catalogQuery = db.table("service_catalog as sc");
  db.tenantJoin(
    catalogQuery,
    "service_prices as sp",
    "sp.service_id",
    "sc.service_id",
    {
      type: "left",
      on(join) {
        join.andOn("sp.currency_code", "=", knex.raw("?", [currencyCode]));
      },
    },
  );
  const catalogRows = await catalogQuery.select(
    "sc.service_id",
    "sc.service_name",
    "sc.default_rate",
    "sc.tax_rate_id",
    "sc.item_kind",
    "sc.is_license",
    "sp.rate as currency_rate",
  );
  const availableServices: ScenarioCatalogService[] = catalogRows.map(
    (row) => ({
      service_id: row.service_id,
      service_name: row.service_name,
      currency_rate:
        row.currency_rate == null
          ? null
          : Math.round(Number(row.currency_rate)),
      legacy_default_rate:
        row.default_rate == null ? null : Math.round(Number(row.default_rate)),
      tax_rate_id: row.tax_rate_id ?? null,
      item_kind: row.item_kind ?? null,
      is_license: Boolean(row.is_license),
    }),
  );
  const catalogById = new Map(
    availableServices.map((service) => [service.service_id, service]),
  );

  const service = (
    serviceId: string,
    quantity: number,
    customRate: number | null,
    configuration: ScenarioServiceConfig,
  ): ScenarioLineService => {
    const catalog = catalogById.get(serviceId);
    if (!catalog)
      throw new Error("Draft contains an invalid service reference");
    return {
      configuration_id: `draft-config-${serviceId}-${configuration.configuration_type}`,
      service_id: catalog.service_id,
      service_name: catalog.service_name,
      quantity: Math.max(1, Math.round(quantity || 1)),
      custom_rate: customRate,
      default_rate: catalog.currency_rate,
      legacy_default_rate: catalog.legacy_default_rate,
      service_quantity: quantity,
      service_custom_rate: customRate,
      configuration_quantity: quantity,
      configuration_custom_rate: customRate,
      tax_rate_id: catalog.tax_rate_id,
      item_kind: catalog.item_kind,
      is_license: catalog.is_license,
      configuration,
    };
  };
  const bucket = (
    primary: ScenarioLineService,
    overlay: ContractDraftBucketOverlayInput,
  ): ScenarioLineService => ({
    ...primary,
    configuration_id: `draft-bucket-${primary.service_id}`,
    configuration: {
      configuration_type: "Bucket",
      total_minutes: Number(overlay.total_minutes ?? 0),
      billing_period: overlay.billing_period ?? "monthly",
      overage_rate: Math.round(Number(overlay.overage_rate ?? 0)),
      allow_rollover: Boolean(overlay.allow_rollover),
    },
  });
  const cadenceOwner = draft.cadence_owner ?? "client";
  const timing = draft.billing_timing ?? "arrears";
  const line = (
    key: string,
    name: string,
    type: ScenarioLine["contract_line_type"],
    frequency: string,
    services: ScenarioLineService[],
    customRate: number | null = null,
  ): ScenarioLine => ({
    key,
    origin_contract_line_id: null,
    contract_line_name: name,
    contract_line_type: type,
    billing_frequency: frequency,
    billing_timing: timing,
    cadence_owner: cadenceOwner,
    custom_rate: customRate,
    enable_proration: draft.enable_proration,
    location_id: null,
    enable_overtime: false,
    overtime_threshold: null,
    overtime_rate: null,
    services,
  });

  const lines: ScenarioLine[] = [];
  if (draft.fixed_services.length > 0 || draft.fixed_base_rate != null) {
    const services = draft.fixed_services.flatMap((item) => {
      const primary = service(item.service_id, item.quantity, null, {
        configuration_type: "Fixed",
        base_rate: null,
      });
      return item.bucket_overlay
        ? [primary, bucket(primary, item.bucket_overlay)]
        : [primary];
    });
    lines.push(
      line(
        "draft-fixed",
        "Fixed services",
        "Fixed",
        draft.fixed_billing_frequency || draft.billing_frequency,
        services,
        draft.fixed_base_rate == null
          ? null
          : Math.round(draft.fixed_base_rate),
      ),
    );
  }
  if (draft.product_services.length > 0) {
    lines.push(
      line(
        "draft-products",
        "Products and licenses",
        "Fixed",
        draft.fixed_billing_frequency || draft.billing_frequency,
        draft.product_services.map((item) =>
          service(item.service_id, item.quantity, item.custom_rate ?? null, {
            configuration_type: "Fixed",
            base_rate: null,
          }),
        ),
      ),
    );
  }
  if (draft.hourly_services.length > 0) {
    const services = draft.hourly_services.flatMap((item) => {
      const primary = service(item.service_id, 1, item.hourly_rate ?? null, {
        configuration_type: "Hourly",
        hourly_rate: item.hourly_rate ?? null,
        minimum_billable_time: draft.minimum_billable_time ?? 0,
        round_up_to_nearest: draft.round_up_to_nearest ?? 0,
        user_type_rates: [],
      });
      return item.bucket_overlay
        ? [primary, bucket(primary, item.bucket_overlay)]
        : [primary];
    });
    lines.push(
      line(
        "draft-hourly",
        "Hourly services",
        "Hourly",
        draft.hourly_billing_frequency || draft.billing_frequency,
        services,
      ),
    );
  }
  if ((draft.usage_services ?? []).length > 0) {
    const services = (draft.usage_services ?? []).flatMap((item) => {
      const primary = service(item.service_id, 1, item.unit_rate ?? null, {
        configuration_type: "Usage",
        unit_of_measure: item.unit_of_measure || "unit",
        enable_tiered_pricing: false,
        minimum_usage: null,
        base_rate: item.unit_rate ?? null,
        tiers: [],
      });
      return item.bucket_overlay
        ? [primary, bucket(primary, item.bucket_overlay)]
        : [primary];
    });
    lines.push(
      line(
        "draft-usage",
        "Usage services",
        "Usage",
        draft.usage_billing_frequency || draft.billing_frequency,
        services,
      ),
    );
  }

  const schedule = await getClientBillingCycleAnchor(
    knex,
    tenant,
    client.client_id,
  );
  const assumptions: ContractScenario["assumptions"] = {};
  for (const scenarioLine of lines) {
    for (const scenarioService of scenarioLine.services) {
      if (
        scenarioService.item_kind !== "product" &&
        scenarioService.configuration.configuration_type !== "Fixed"
      ) {
        assumptions[
          assumptionKey(scenarioLine.key, scenarioService.service_id)
        ] = {
          flat: 0,
        };
      }
    }
  }

  return {
    scenario_id: `draft-${client.client_id}-${draft.contract_name}`,
    name: `${draft.contract_name || "Unsaved contract"} simulation`,
    contract_id: null,
    is_system_managed_default: false,
    client_binding: {
      kind: "client",
      client_id: client.client_id,
      client_name: client.client_name,
    },
    invoice_schedule: {
      billing_cycle: schedule.billingCycle,
      anchor: {
        day_of_month: schedule.anchor.dayOfMonth,
        month_of_year: schedule.anchor.monthOfYear,
        day_of_week: schedule.anchor.dayOfWeek,
        reference_date: schedule.anchor.referenceDate,
      },
    },
    billing_frequency: draft.billing_frequency,
    contract_start_date: draft.start_date ? midnight(draft.start_date) : null,
    contract_end_date: draft.end_date ? midnight(draft.end_date) : null,
    currency_code: currencyCode,
    available_services: availableServices,
    lines,
    pricing_schedules: [],
    discounts: [],
    adjustments: [],
    assumptions,
    horizon: {
      start_date: draft.start_date
        ? midnight(draft.start_date)
        : midnight(new Date().toISOString()),
      period_count: 6,
    },
  };
}
