import type { Knex } from "knex";
import type {
  ContractDraftBucketOverlayInput,
  ContractDraftBucketPoolInput,
  ContractDraftDiscount,
  ContractDraftSimulationInput,
  ContractScenario,
  ScenarioCatalogService,
  ScenarioDiscount,
  ScenarioLine,
  ScenarioLineService,
  ScenarioPool,
  ScenarioServiceConfig,
} from "@alga-psa/types";
import { tenantDb } from "@alga-psa/db";
import { toISODate, toPlainDate } from "@alga-psa/core";
import { loadClientInvoiceSchedule } from "./clientInvoiceSchedule";
import { resolveUnitOfMeasure } from "@alga-psa/core/unitOfMeasure";
import { resolveEffectiveBillingTiming } from "@alga-psa/shared/billingClients/contractLineTimingRule";
import { assumptionKey } from "./syntheticActivity";
import { simulationRefusal } from "./simulationRefusal";

const midnight = (value: string): string =>
  `${toISODate(toPlainDate(value))}T00:00:00Z`;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Wizard discounts are authored in percent units / decimal currency; the
 * scenario model carries the evaluator's units — a fraction for a percentage,
 * integer minor units for a fixed amount. An empty `contract_line_keys` is the
 * contract-wide settlement: every eligible charge in the period.
 */
export function draftDiscountsToScenario(
  discounts: ContractDraftDiscount[] | undefined,
): ScenarioDiscount[] {
  return (discounts ?? [])
    .filter(
      (discount) =>
        discount &&
        typeof discount.discount_name === "string" &&
        discount.discount_name.trim().length > 0 &&
        Number.isFinite(Number(discount.value)) &&
        Number(discount.value) > 0 &&
        DATE_ONLY.test(String(discount.start_date ?? "")),
    )
    .map((discount, index) => {
      const value = Number(discount.value);
      const endDate =
        discount.end_date && DATE_ONLY.test(discount.end_date)
          ? midnight(discount.end_date)
          : null;
      return {
        discount_id: discount.draft_key || `draft-discount-${index + 1}`,
        discount_name: discount.discount_name.trim(),
        discount_type: discount.discount_type === "fixed" ? "fixed" : "percentage",
        value:
          discount.discount_type === "fixed" ? Math.round(value * 100) : value / 100,
        start_date: midnight(discount.start_date),
        end_date: endDate,
        contract_line_keys: [],
      };
    });
}

/**
 * Wizard pool drafts as the scenario pool model snapshotContractToScenario
 * builds from `contract_line_buckets` (ScenarioPool: allowance, members with
 * burn multipliers, after-hours rule), so ScenarioChargeSource.pools() has one
 * pool path. Drafts whose line is not simulated are skipped, as the wizard
 * submission skips them.
 */
export function draftPoolsToScenario(
  pools: ContractDraftBucketPoolInput[] | undefined,
  lineKey: "hourly" | "usage",
  services: ScenarioLineService[],
): ScenarioPool[] {
  const lineServiceIds = new Set(services.map((service) => service.service_id));
  return (pools ?? [])
    .filter((pool) => (pool.line_key ?? "hourly") === lineKey)
    .map((pool, index) => ({
      pool_id: `draft-pool-${lineKey}-${index + 1}`,
      pool_name: pool.bucket_name ?? null,
      covers_all_services: Boolean(pool.covers_all_services),
      total_minutes: Math.max(0, Math.round(Number(pool.total_minutes ?? 0))),
      billing_period: "monthly",
      overage_rate: Math.max(0, Math.round(Number(pool.overage_rate ?? 0))),
      allow_rollover: Boolean(pool.allow_rollover),
      after_hours_multiplier:
        pool.after_hours_multiplier != null
          ? Number(pool.after_hours_multiplier)
          : null,
      business_hours_schedule_id: pool.business_hours_schedule_id ?? null,
      members: (pool.members ?? [])
        .filter((member) => lineServiceIds.has(member.service_id))
        .map((member) => ({
          service_id: member.service_id,
          burn_multiplier: Number(member.burn_multiplier ?? 1),
        })),
    }));
}

export async function draftContractToScenario(
  knex: Knex,
  tenant: string,
  draft: ContractDraftSimulationInput,
): Promise<ContractScenario> {
  if (!draft.client_id) {
    throw simulationRefusal(
      "CONTRACT_SIMULATION_CLIENT_REQUIRED",
      "Select a client before simulating.",
    );
  }
  const db = tenantDb(knex, tenant);
  const client = await db
    .table("clients")
    .where({ client_id: draft.client_id })
    .first("client_id", "client_name");
  if (!client) {
    throw simulationRefusal(
      "CONTRACT_SIMULATION_CLIENT_NOT_AVAILABLE",
      "The client this simulation uses is not available. It may have been deleted; choose another client.",
    );
  }

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
      throw simulationRefusal(
        "CONTRACT_SIMULATION_SCENARIO_REFERENCE_INVALID",
        "This draft refers to a service that is no longer available. Remove it from the contract, then simulate again.",
      );
    return {
      configuration_id: `draft-config-${serviceId}-${configuration.configuration_type}`,
      service_id: catalog.service_id,
      service_name: catalog.service_name,
      // Clamp to >= 1 for allocation/hourly/usage/products. Per-unit Fixed
      // members read the raw configuration_quantity instead, where 0 is an
      // explicit zero.
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
    overrides: {
      billing_timing?: "arrears" | "advance";
      enable_proration?: boolean;
    } = {},
  ): ScenarioLine => ({
    key,
    origin_contract_line_id: null,
    contract_line_name: name,
    contract_line_type: type,
    billing_frequency: frequency,
    // Only Fixed lines may bill in advance; Hourly and Usage are always arrears.
    billing_timing: resolveEffectiveBillingTiming(type, overrides.billing_timing ?? timing),
    cadence_owner: cadenceOwner,
    custom_rate: customRate,
    enable_proration: overrides.enable_proration ?? draft.enable_proration,
    location_id: null,
    enable_overtime: false,
    overtime_threshold: null,
    overtime_rate: null,
    services,
  });

  const lines: ScenarioLine[] = [];
  const withDraftPools = (scenarioLine: ScenarioLine, lineKey: "hourly" | "usage") => {
    const pools = draftPoolsToScenario(draft.bucket_pools, lineKey, scenarioLine.services);
    if (pools.length > 0) scenarioLine.pools = pools;
  };
  // One scenario line per wizard fixed line. A line with no service cannot be
  // billed (the engine rejects a rate with no members), so it is not simulated.
  const simulatedFixedLines = draft.fixed_lines.filter((fixedLine) => fixedLine.services.length > 0);
  simulatedFixedLines.forEach((fixedLine, lineIndex) => {
    const services = fixedLine.services.flatMap((item) => {
      const isUnit = item.pricing_basis === "unit";
      const primary = service(item.service_id, item.quantity, null, {
        configuration_type: "Fixed",
        // A unit member's base_rate is its unit-rate override; null follows
        // the catalog price in the draft currency (resolved by the shared
        // fixed-charge path, not here).
        base_rate:
          isUnit && item.unit_rate != null ? Math.round(item.unit_rate) : null,
        base_rate_basis: isUnit && item.unit_rate != null ? "per_unit" : null,
        ...(isUnit ? { pricing_basis: "unit" as const } : {}),
      });
      return item.bucket_overlay
        ? [primary, bucket(primary, item.bucket_overlay)]
        : [primary];
    });
    lines.push(
      line(
        simulatedFixedLines.length === 1 ? "draft-fixed" : `draft-fixed-${lineIndex + 1}`,
        fixedLine.contract_line_name?.trim() ||
          (simulatedFixedLines.length === 1 ? "Fixed services" : `Fixed services ${lineIndex + 1}`),
        "Fixed",
        fixedLine.billing_frequency || draft.billing_frequency,
        services,
        fixedLine.base_rate == null ? null : Math.round(fixedLine.base_rate),
        {
          billing_timing: fixedLine.billing_timing,
          enable_proration: fixedLine.enable_proration,
        },
      ),
    );
  });
  if (draft.product_services.length > 0) {
    lines.push(
      line(
        "draft-products",
        "Products and licenses",
        "Fixed",
        draft.billing_frequency,
        draft.product_services.map((item) =>
          service(item.service_id, item.quantity, item.custom_rate ?? null, {
            configuration_type: "Fixed",
            base_rate: null,
          }),
        ),
        null,
        { billing_timing: draft.product_billing_timing },
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
    withDraftPools(lines[lines.length - 1], "hourly");
  }
  if ((draft.usage_services ?? []).length > 0) {
    const services = (draft.usage_services ?? []).flatMap((item) => {
      const primary = service(item.service_id, 1, item.unit_rate ?? null, {
        configuration_type: "Usage",
        unit_of_measure: item.unit_of_measure || resolveUnitOfMeasure({ fallback: 'C62' }).label,
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
    withDraftPools(lines[lines.length - 1], "usage");
  }

  // Prepaid Block lines: each is its own Hourly line carrying the block config, exactly the shape the
  // saved-contract snapshot produces, so simulatePrepaidBlockTimeline prices the block issue.
  const prepaidBlockLines = draft.prepaid_block_lines ?? [];
  prepaidBlockLines.forEach((prepaidLine, lineIndex) => {
    const services = prepaidLine.services
      .filter((item) => item.service_id)
      .map((item) =>
        service(item.service_id, 1, item.hourly_rate ?? null, {
          configuration_type: "Hourly",
          hourly_rate: item.hourly_rate ?? null,
          minimum_billable_time: draft.minimum_billable_time ?? 0,
          round_up_to_nearest: draft.round_up_to_nearest ?? 0,
          user_type_rates: [],
        }),
      );
    if (services.length === 0) return;
    const block = prepaidLine.block;
    const expiryMonths = block.expiry_months ?? null;
    lines.push({
      ...line(
        prepaidBlockLines.length === 1 ? "draft-prepaid" : `draft-prepaid-${lineIndex + 1}`,
        prepaidLine.name?.trim() ||
          (prepaidBlockLines.length === 1 ? "Prepaid block" : `Prepaid block ${lineIndex + 1}`),
        "Hourly",
        draft.hourly_billing_frequency || draft.billing_frequency,
        services,
      ),
      prepaid_block: {
        block_minutes: Number(block.block_minutes),
        block_price: Math.round(Number(block.block_price)),
        sold_as_service_id: block.sold_as_service_id ?? services[0].service_id,
        expiry_months: expiryMonths,
        trigger_on_exhaustion: Boolean(block.trigger_on_exhaustion),
        trigger_threshold_percent: block.trigger_threshold_percent ?? null,
        trigger_on_expiry: expiryMonths === null ? false : Boolean(block.trigger_on_expiry),
        trigger_on_renewal: Boolean(block.trigger_on_renewal),
        replenishment_tier: block.replenishment_tier === "auto_issue" ? "auto_issue" : "draft",
        issue_mode: block.issue_mode === "cadence" ? "cadence" : "consumption",
        rollover_periods: block.rollover_periods ?? 0,
      },
    });
  });

  const invoiceSchedule = await loadClientInvoiceSchedule(
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
    invoice_schedule: invoiceSchedule,
    billing_frequency: draft.billing_frequency,
    contract_start_date: draft.start_date ? midnight(draft.start_date) : null,
    contract_end_date: draft.end_date ? midnight(draft.end_date) : null,
    currency_code: currencyCode,
    available_services: availableServices,
    lines,
    pricing_schedules: [],
    discounts: draftDiscountsToScenario(draft.discounts),
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
