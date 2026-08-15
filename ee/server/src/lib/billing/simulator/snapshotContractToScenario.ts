/**
 * Loads a live contract's full billing configuration into an in-memory
 * ContractScenario the simulator workspace can mutate freely. Strictly
 * read-only: only SELECTs, no writes of any kind.
 */

import type { Knex } from "knex";
import { v4 as uuidv4 } from "uuid";
import { Temporal } from "@js-temporal/polyfill";
import type {
  ContractScenario,
  BillingCycleType,
  ISO8601String,
  ScenarioClientBinding,
  ScenarioDiscount,
  ScenarioAssumption,
  ScenarioLine,
  ScenarioLineService,
  ScenarioPricingSchedule,
  ScenarioBillingSchedule,
  ScenarioServiceConfig,
} from "@alga-psa/types";
import { toISODate, toPlainDate } from "@alga-psa/core";
import { tenantDb } from "@alga-psa/db";
import { resolveCadenceOwner } from "@alga-psa/shared/billingClients/recurringTiming";
import { getClientBillingCycleAnchor } from "@alga-psa/shared/billingClients/billingSchedule";
import { normalizeAnchorSettingsForCycle } from "@alga-psa/shared/billingClients/billingCycleAnchors";
import {
  ClientContractServiceConfigurationService,
  type ClientContractServiceConfigDetails,
} from "@alga-psa/billing/services/clientContractServiceConfigurationService";
import { assumptionKey } from "./syntheticActivity";

const DEFAULT_HORIZON_PERIOD_COUNT = 6;

export interface SnapshotContractToScenarioParams {
  contractId: string;
  clientContractId: string | null;
  clientId?: string | null;
  forceProfile?: boolean;
}

interface ContractRow {
  contract_id: string;
  contract_name: string;
  owner_client_id: string | null;
  billing_frequency: string;
  currency_code: string | null;
  is_system_managed_default: boolean | null;
}

interface ContractLineRow {
  contract_line_id: string;
  contract_line_name: string;
  contract_line_type: string;
  billing_frequency: string | null;
  billing_timing: "arrears" | "advance" | null;
  cadence_owner: string | null;
  custom_rate: number | string | null;
  enable_proration: boolean | null;
  location_id: string | null;
  enable_overtime: boolean | null;
  overtime_threshold: number | string | null;
  overtime_rate: number | string | null;
}

interface CatalogRateRow {
  service_id: string;
  service_name: string;
  default_rate: number | string | null;
  tax_rate_id: string | null;
  currency_rate: number | string | null;
  item_kind: string | null;
  is_license: boolean | null;
}

interface ContractLineServiceRow {
  contract_line_id: string;
  service_id: string;
  quantity: number | string | null;
  custom_rate: number | string | null;
}

interface TemplateServiceConfigRow {
  config_id: string;
  template_line_id: string;
  service_id: string;
  configuration_type: "Fixed" | "Hourly" | "Usage" | "Bucket";
  quantity: number | string | null;
  custom_rate: number | string | null;
}

interface TemplateHourlyConfigRow {
  config_id: string;
  hourly_rate: number | string | null;
  minimum_billable_time: number | string | null;
  round_up_to_nearest: number | string | null;
}

interface TemplateUsageConfigRow {
  config_id: string;
  unit_of_measure: string | null;
  enable_tiered_pricing: boolean | null;
  minimum_usage: number | string | null;
  base_rate: number | string | null;
}

interface TemplateBucketConfigRow {
  config_id: string;
  total_minutes: number | string | null;
  billing_period: string | null;
  overage_rate: number | string | null;
  allow_rollover: boolean | null;
}

/** A live or template pool row (weighted-burn model). */
interface PoolRow {
  bucket_id: string;
  template_line_id?: string | null;
  contract_line_id?: string | null;
  bucket_name: string | null;
  total_minutes: number | string | null;
  overage_rate: number | string | null;
  allow_rollover: boolean | null;
  billing_period: string | null;
  after_hours_multiplier: number | string | null;
  business_hours_schedule_id: string | null;
  covers_all_services: boolean | null;
}

function toCents(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function toMidnightIso(value: unknown): ISO8601String {
  return `${toISODate(toPlainDate(value as string | Date))}T00:00:00Z`;
}

export async function snapshotContractToScenario(
  knex: Knex,
  tenant: string,
  params: SnapshotContractToScenarioParams,
): Promise<ContractScenario> {
  if (!tenant) {
    throw new Error(
      "Tenant context is required to snapshot a contract scenario",
    );
  }
  if (!params?.contractId) {
    throw new Error("contractId is required to snapshot a contract scenario");
  }

  const db = tenantDb(knex, tenant);

  let contract = (await db
    .table("contracts")
    .where({ contract_id: params.contractId })
    .first(
      "contract_id",
      "contract_name",
      "owner_client_id",
      "billing_frequency",
      "currency_code",
      "is_system_managed_default",
    )) as ContractRow | undefined;

  let isTemplate = false;
  if (!contract) {
    const template = await db
      .table("contract_templates")
      .where({ template_id: params.contractId })
      .first(
        "template_id",
        "template_name",
        "default_billing_frequency",
      );
    if (template) {
      isTemplate = true;
      contract = {
        contract_id: template.template_id,
        contract_name: template.template_name,
        owner_client_id: null,
        billing_frequency: template.default_billing_frequency || "monthly",
        currency_code: "USD",
        is_system_managed_default: false,
      };
    }
  }

  if (!contract) {
    throw new Error(
      `Contract ${params.contractId} not found in tenant ${tenant}`,
    );
  }

  const currencyCode = contract.currency_code || "USD";

  let lineRows: ContractLineRow[];
  if (isTemplate) {
    const query = db.table("contract_template_lines as lines");
    db.tenantJoin(
      query,
      "contract_template_line_fixed_config as fixed",
      "fixed.template_line_id",
      "lines.template_line_id",
      { type: "left" },
    );
    const rows = await query
      .where({ "lines.template_id": params.contractId })
      .orderBy("lines.display_order", "asc")
      .orderBy("lines.template_line_name", "asc")
      .select(
        "lines.template_line_id",
        "lines.template_line_name",
        "lines.line_type",
        "lines.billing_frequency",
        "lines.billing_timing",
        "lines.cadence_owner",
        "lines.custom_rate",
        "fixed.base_rate",
        "fixed.enable_proration",
        "lines.enable_overtime",
        "lines.overtime_threshold",
        "lines.overtime_rate",
      );
    lineRows = rows.map((row) => ({
      contract_line_id: row.template_line_id,
      contract_line_name: row.template_line_name,
      contract_line_type: row.line_type || "Fixed",
      billing_frequency: row.billing_frequency,
      billing_timing: row.billing_timing,
      cadence_owner: row.cadence_owner,
      custom_rate: row.custom_rate ?? row.base_rate,
      enable_proration: row.enable_proration,
      location_id: null,
      enable_overtime: row.enable_overtime,
      overtime_threshold: row.overtime_threshold,
      overtime_rate: row.overtime_rate,
    }));
  } else {
    lineRows = (await db
      .table("contract_lines")
      .where({ contract_id: params.contractId })
      .orderBy("display_order", "asc")
      .orderBy("contract_line_name", "asc")
      .select(
        "contract_line_id",
        "contract_line_name",
        "contract_line_type",
        "billing_frequency",
        "billing_timing",
        "cadence_owner",
        "custom_rate",
        "enable_proration",
        "location_id",
        "enable_overtime",
        "overtime_threshold",
        "overtime_rate",
      )) as ContractLineRow[];
  }

  const configsByLine = new Map<string, ClientContractServiceConfigDetails[]>();
  if (!isTemplate) {
    const configService = new ClientContractServiceConfigurationService(
      knex,
      tenant,
    );
    for (const lineRow of lineRows) {
      configsByLine.set(
        lineRow.contract_line_id,
        await configService.getConfigurationsForClientContractLine(
          lineRow.contract_line_id,
        ),
      );
    }
  }

  const contractLineServiceRows =
    lineRows.length > 0
      ? ((await db
          .table(
            isTemplate
              ? "contract_template_line_services"
              : "contract_line_services",
          )
          .whereIn(
            isTemplate ? "template_line_id" : "contract_line_id",
            lineRows.map((line) => line.contract_line_id),
          )
          .select(
            isTemplate
              ? "template_line_id as contract_line_id"
              : "contract_line_id",
            "service_id",
            "quantity",
            "custom_rate",
          )) as ContractLineServiceRow[])
      : [];
  const contractLineServiceByKey = new Map(
    contractLineServiceRows.map((row) => [
      `${row.contract_line_id}:${row.service_id}`,
      row,
    ]),
  );

  // Weighted-burn pool preservation: load the line's pools (with members) so
  // the scenario snapshot carries scope, membership, multipliers, schedule,
  // and after-hours settings instead of dropping them. Live contracts read
  // contract_line_buckets; template contracts read the template pool tables.
  const poolRows = lineRows.length > 0
    ? ((await db
        .table(isTemplate ? "contract_template_line_buckets" : "contract_line_buckets")
        .whereIn(
          isTemplate ? "template_line_id" : "contract_line_id",
          lineRows.map((line) => line.contract_line_id),
        )
        .select("*")) as PoolRow[])
    : [];
  const poolRowsByLine = new Map<string, PoolRow[]>();
  for (const row of poolRows) {
    const lineId = String(row.template_line_id ?? row.contract_line_id ?? "");
    const existing = poolRowsByLine.get(lineId) ?? [];
    existing.push(row);
    poolRowsByLine.set(lineId, existing);
  }
  const poolMemberRows = poolRows.length > 0
    ? ((await db
        .table(isTemplate ? "contract_template_line_bucket_services" : "contract_line_bucket_services")
        .whereIn(
          "bucket_id",
          poolRows.map((row) => row.bucket_id),
        )
        .select(
          "bucket_id",
          "service_id",
          "burn_multiplier",
          isTemplate ? "template_line_id as contract_line_id" : "contract_line_id",
        )) as Array<{ bucket_id: string; service_id: string; burn_multiplier: number | string | null; contract_line_id: string | null }>)
    : [];
  const poolMembersByBucket = new Map<string, Array<{ service_id: string; burn_multiplier: number }>>();
  for (const member of poolMemberRows) {
    const existing = poolMembersByBucket.get(member.bucket_id) ?? [];
    existing.push({
      service_id: member.service_id,
      burn_multiplier: Number(member.burn_multiplier) || 1,
    });
    poolMembersByBucket.set(member.bucket_id, existing);
  }
  const templatePoolRowsByLine = isTemplate ? poolRowsByLine : new Map<string, PoolRow[]>();

  const templateConfigs = isTemplate
    ? ((await db
        .table("contract_template_line_service_configuration")
        .whereIn(
          "template_line_id",
          lineRows.map((line) => line.contract_line_id),
        )
        .select(
          "config_id",
          "template_line_id",
          "service_id",
          "configuration_type",
          "quantity",
          "custom_rate",
        )) as TemplateServiceConfigRow[])
    : [];
  const templateConfigIds = templateConfigs.map((config) => config.config_id);
  const [templateHourlyConfigs, templateUsageConfigs, templateBucketConfigs] =
    templateConfigIds.length > 0
      ? await Promise.all([
          db
            .table("contract_template_line_service_hourly_config")
            .whereIn("config_id", templateConfigIds)
            .select(
              "config_id",
              "hourly_rate",
              "minimum_billable_time",
              "round_up_to_nearest",
            ) as Promise<TemplateHourlyConfigRow[]>,
          db
            .table("contract_template_line_service_usage_config")
            .whereIn("config_id", templateConfigIds)
            .select(
              "config_id",
              "unit_of_measure",
              "enable_tiered_pricing",
              "minimum_usage",
              "base_rate",
            ) as Promise<TemplateUsageConfigRow[]>,
          db
            .table("contract_template_line_service_bucket_config")
            .whereIn("config_id", templateConfigIds)
            .select(
              "config_id",
              "total_minutes",
              "billing_period",
              "overage_rate",
              "allow_rollover",
            ) as Promise<TemplateBucketConfigRow[]>,
        ])
      : [[], [], []];

  // Catalog names/rates for every referenced service, with the contract
  // currency's service_prices row preferred over the currency-untagged legacy
  // service_catalog.default_rate — the same resolution production time-based
  // and usage rate lookups use.
  const catalogByServiceId = new Map<string, CatalogRateRow>();
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
  const catalogRows = (await catalogQuery.select(
    "sc.service_id",
    "sc.service_name",
    "sc.default_rate",
    "sc.tax_rate_id",
    "sp.rate as currency_rate",
    "sc.item_kind",
    "sc.is_license",
  )) as CatalogRateRow[];
  for (const row of catalogRows) {
    catalogByServiceId.set(row.service_id, row);
  }

  const lines: ScenarioLine[] = await Promise.all(
    lineRows.map(async (lineRow) =>
      isTemplate
        ? buildTemplateScenarioLine(
            lineRow,
            contract,
            templateConfigs.filter(
              (config) => config.template_line_id === lineRow.contract_line_id,
            ),
            catalogByServiceId,
            contractLineServiceByKey,
            new Map(templateHourlyConfigs.map((row) => [row.config_id, row])),
            new Map(templateUsageConfigs.map((row) => [row.config_id, row])),
            new Map(templateBucketConfigs.map((row) => [row.config_id, row])),
            templatePoolRowsByLine.get(lineRow.contract_line_id) ?? [],
            db,
            tenant,
            poolMembersByBucket,
          )
        : buildScenarioLine(
            lineRow,
            contract,
            configsByLine.get(lineRow.contract_line_id) ?? [],
            catalogByServiceId,
            contractLineServiceByKey,
            db,
            tenant,
            poolRowsByLine,
            poolMembersByBucket,
          ),
    ),
  );

  const pricingSchedules = await loadPricingSchedules(
    db,
    params.contractId,
    isTemplate,
  );
  const discounts = isTemplate
    ? []
    : await loadScenarioDiscounts(db, params.contractId);

  const { clientBinding, contractStartDate, contractEndDate, invoiceSchedule } =
    await resolveClientBinding(
      knex,
      db,
      tenant,
      params,
      contract,
      currencyCode,
    );

  const assumptions: Record<string, ScenarioAssumption> = {};
  for (const line of lines) {
    for (const service of line.services) {
      const configType = service.configuration.configuration_type;
      if (
        configType === "Hourly" ||
        configType === "Usage" ||
        configType === "Bucket"
      ) {
        assumptions[assumptionKey(line.key, service.service_id)] = { flat: 0 };
      }
    }
  }

  const today = Temporal.Now.plainDateISO("UTC");

  return {
    scenario_id: uuidv4(),
    name: `${contract.contract_name} scenario`,
    contract_id: contract.contract_id,
    is_system_managed_default: Boolean(contract.is_system_managed_default),
    client_binding: clientBinding,
    invoice_schedule: invoiceSchedule,
    billing_frequency: contract.billing_frequency,
    contract_start_date: contractStartDate,
    contract_end_date: contractEndDate,
    currency_code: currencyCode,
    available_services: catalogRows.map((catalog) => ({
      service_id: catalog.service_id,
      service_name: catalog.service_name,
      currency_rate: toCents(catalog.currency_rate),
      legacy_default_rate: toCents(catalog.default_rate),
      tax_rate_id: catalog.tax_rate_id ?? null,
      item_kind: catalog.item_kind ?? null,
      is_license: Boolean(catalog.is_license),
    })),
    lines,
    pricing_schedules: pricingSchedules,
    discounts,
    // Production invoice generation intentionally does not consume the
    // legacy client adjustments table. Draft scenarios can add explicit
    // adjustments in memory without changing that production behavior.
    adjustments: [],
    assumptions,
    horizon: {
      start_date: `${toISODate(today)}T00:00:00Z`,
      period_count: DEFAULT_HORIZON_PERIOD_COUNT,
    },
  };
}

async function buildScenarioLine(
  lineRow: ContractLineRow,
  contract: ContractRow,
  configs: ClientContractServiceConfigDetails[],
  catalogByServiceId: Map<string, CatalogRateRow>,
  contractLineServiceByKey: Map<string, ContractLineServiceRow>,
  db: ReturnType<typeof tenantDb>,
  tenant: string,
  poolRowsByLine: Map<string, PoolRow[]>,
  poolMembersByBucket: Map<string, Array<{ service_id: string; burn_multiplier: number }>>,
): Promise<ScenarioLine> {
  const contractLineType = lineRow.contract_line_type;
  if (
    contractLineType !== "Fixed" &&
    contractLineType !== "Hourly" &&
    contractLineType !== "Usage"
  ) {
    throw new Error(
      `Contract line ${lineRow.contract_line_id} ("${lineRow.contract_line_name}") ` +
        `has unsupported contract_line_type "${contractLineType}"; expected Fixed, Hourly, or Usage`,
    );
  }

  const services: ScenarioLineService[] = await Promise.all(
    configs.map(async (configDetails) => {
      const catalog = catalogByServiceId.get(configDetails.serviceId);
      if (!catalog) {
        throw new Error(
          `Service ${configDetails.serviceId} referenced by contract line ` +
            `${lineRow.contract_line_id} ("${lineRow.contract_line_name}") is missing from service_catalog`,
        );
      }

      const serviceRow = contractLineServiceByKey.get(
        `${lineRow.contract_line_id}:${configDetails.serviceId}`,
      );
      const configurationQuantity =
        configDetails.baseConfig.quantity != null
          ? Number(configDetails.baseConfig.quantity)
          : null;
      const serviceQuantity =
        serviceRow?.quantity != null ? Number(serviceRow.quantity) : null;
      const configurationCustomRate = toCents(
        configDetails.baseConfig.custom_rate ?? null,
      );
      const serviceCustomRate = toCents(serviceRow?.custom_rate ?? null);

      return {
        configuration_id: configDetails.baseConfig.config_id,
        service_id: configDetails.serviceId,
        service_name: catalog.service_name,
        quantity: Math.max(
          1,
          Math.round(configurationQuantity ?? serviceQuantity ?? 1),
        ),
        custom_rate: configurationCustomRate ?? serviceCustomRate,
        default_rate: toCents(catalog.currency_rate),
        legacy_default_rate: toCents(catalog.default_rate),
        service_quantity: serviceQuantity,
        service_custom_rate: serviceCustomRate,
        configuration_quantity: configurationQuantity,
        configuration_custom_rate: configurationCustomRate,
        tax_rate_id: catalog.tax_rate_id ?? null,
        item_kind: catalog.item_kind ?? null,
        is_license: Boolean(catalog.is_license),
        configuration: await buildScenarioServiceConfig(configDetails, {
          db,
          tenant,
          contractLineId: lineRow.contract_line_id,
          poolRowsByLine,
          poolMembersByBucket,
        }),
      };
    }),
  );

  return {
    key: lineRow.contract_line_id,
    origin_contract_line_id: lineRow.contract_line_id,
    contract_line_name: lineRow.contract_line_name,
    contract_line_type: contractLineType,
    billing_frequency: lineRow.billing_frequency || contract.billing_frequency,
    billing_timing: lineRow.billing_timing ?? "arrears",
    cadence_owner: resolveCadenceOwner(
      (lineRow.cadence_owner as "client" | "contract" | null) ?? null,
    ),
    custom_rate: toCents(lineRow.custom_rate),
    enable_proration: Boolean(lineRow.enable_proration),
    location_id: lineRow.location_id ?? null,
    enable_overtime: Boolean(lineRow.enable_overtime),
    overtime_threshold:
      lineRow.overtime_threshold != null
        ? Number(lineRow.overtime_threshold)
        : null,
    overtime_rate: toCents(lineRow.overtime_rate),
    services,
  };
}

function buildTemplateScenarioLine(
  lineRow: ContractLineRow,
  contract: ContractRow,
  configs: TemplateServiceConfigRow[],
  catalogByServiceId: Map<string, CatalogRateRow>,
  serviceByKey: Map<string, ContractLineServiceRow>,
  hourlyByConfigId: Map<string, TemplateHourlyConfigRow>,
  usageByConfigId: Map<string, TemplateUsageConfigRow>,
  bucketByConfigId: Map<string, TemplateBucketConfigRow>,
  templatePoolRows: PoolRow[],
  db: ReturnType<typeof tenantDb>,
  tenant: string,
  poolMembersByBucket: Map<string, Array<{ service_id: string; burn_multiplier: number }>>,
): ScenarioLine {
  const lineType = lineRow.contract_line_type;
  if (lineType !== "Fixed" && lineType !== "Hourly" && lineType !== "Usage") {
    throw new Error(
      `Template line ${lineRow.contract_line_id} ("${lineRow.contract_line_name}") ` +
        `has unsupported line_type "${lineType}"; expected Fixed, Hourly, or Usage`,
    );
  }

  const memberships = Array.from(serviceByKey.values()).filter(
    (service) => service.contract_line_id === lineRow.contract_line_id,
  );
  const services = memberships.flatMap((membership): ScenarioLineService[] => {
    const catalog = catalogByServiceId.get(membership.service_id);
    if (!catalog) {
      throw new Error(
        `Service ${membership.service_id} referenced by template line ` +
          `${lineRow.contract_line_id} ("${lineRow.contract_line_name}") is missing from service_catalog`,
      );
    }

    const config =
      configs.find((candidate) => candidate.service_id === membership.service_id) ??
      null;
    const configurationType = config?.configuration_type ?? lineType;
    const configurationId =
      config?.config_id ??
      `template-${lineRow.contract_line_id}-${membership.service_id}-${configurationType}`;
    const serviceQuantity =
      membership.quantity != null ? Number(membership.quantity) : null;
    const configurationQuantity =
      config?.quantity != null ? Number(config.quantity) : null;
    const serviceCustomRate = toCents(membership.custom_rate);
    const configurationCustomRate = toCents(config?.custom_rate);
    const customRate = configurationCustomRate ?? serviceCustomRate;

    let configuration: ScenarioServiceConfig;
    if (configurationType === "Hourly") {
      const hourly = config ? hourlyByConfigId.get(config.config_id) : undefined;
      configuration = {
        configuration_type: "Hourly",
        hourly_rate: toCents(hourly?.hourly_rate) ?? customRate,
        minimum_billable_time:
          Number(hourly?.minimum_billable_time ?? 0) || 0,
        round_up_to_nearest:
          Number(hourly?.round_up_to_nearest ?? 0) || 0,
        user_type_rates: [],
      };
    } else if (configurationType === "Usage") {
      const usage = config ? usageByConfigId.get(config.config_id) : undefined;
      configuration = {
        configuration_type: "Usage",
        unit_of_measure: usage?.unit_of_measure || "unit",
        enable_tiered_pricing: Boolean(usage?.enable_tiered_pricing),
        minimum_usage:
          usage?.minimum_usage != null ? Number(usage.minimum_usage) : null,
        base_rate: toCents(usage?.base_rate) ?? customRate,
        tiers: [],
      };
    } else if (configurationType === "Bucket") {
      const bucket = config ? bucketByConfigId.get(config.config_id) : undefined;
      // A template pool row keyed by the legacy config_id (migrated templates
      // reuse the pool id) carries the full pool config; preserve it.
      const pool =
        templatePoolRows.find((row) => row.bucket_id === config?.config_id) ??
        null;
      configuration = {
        configuration_type: "Bucket",
        total_minutes: Number(bucket?.total_minutes ?? pool?.total_minutes ?? 0),
        billing_period: bucket?.billing_period || pool?.billing_period || "monthly",
        overage_rate: toCents(bucket?.overage_rate ?? pool?.overage_rate) ?? 0,
        allow_rollover: Boolean(bucket?.allow_rollover ?? pool?.allow_rollover),
        pool_id: pool?.bucket_id ?? null,
        pool_name: pool?.bucket_name ?? null,
        covers_all_services: Boolean(pool?.covers_all_services),
        after_hours_multiplier:
          pool?.after_hours_multiplier != null
            ? Number(pool.after_hours_multiplier)
            : null,
        business_hours_schedule_id: pool?.business_hours_schedule_id ?? null,
        burn_multiplier: pool
          ? Number(
              poolMembersByBucket.get(pool.bucket_id)?.find(
                (member) => member.service_id === membership.service_id,
              )?.burn_multiplier ?? 1,
            )
          : 1,
      };
    } else {
      configuration = {
        configuration_type: "Fixed",
        base_rate: null,
      };
    }

    const primary: ScenarioLineService = {
      configuration_id: configurationId,
      service_id: membership.service_id,
      service_name: catalog.service_name,
      quantity: Math.max(
        1,
        Math.round(configurationQuantity ?? serviceQuantity ?? 1),
      ),
      custom_rate: customRate,
      default_rate: toCents(catalog.currency_rate),
      legacy_default_rate: toCents(catalog.default_rate),
      service_quantity: serviceQuantity,
      service_custom_rate: serviceCustomRate,
      configuration_quantity: configurationQuantity,
      configuration_custom_rate: configurationCustomRate,
      tax_rate_id: catalog.tax_rate_id ?? null,
      item_kind: catalog.item_kind ?? null,
      is_license: Boolean(catalog.is_license),
      configuration,
    };

    const overlay = config ? bucketByConfigId.get(config.config_id) : undefined;
    if (!overlay || configurationType === "Bucket") return [primary];
    return [
      primary,
      {
        ...primary,
        configuration_id: `${configurationId}:bucket`,
        configuration: {
          configuration_type: "Bucket",
          total_minutes: Number(overlay.total_minutes ?? 0),
          billing_period: overlay.billing_period || "monthly",
          overage_rate: toCents(overlay.overage_rate) ?? 0,
          allow_rollover: Boolean(overlay.allow_rollover),
        },
      },
    ];
  });

  return {
    key: lineRow.contract_line_id,
    origin_contract_line_id: lineRow.contract_line_id,
    contract_line_name: lineRow.contract_line_name,
    contract_line_type: lineType,
    billing_frequency: lineRow.billing_frequency || contract.billing_frequency,
    billing_timing: lineRow.billing_timing ?? "arrears",
    cadence_owner: resolveCadenceOwner(
      (lineRow.cadence_owner as "client" | "contract" | null) ?? null,
    ),
    custom_rate: toCents(lineRow.custom_rate),
    enable_proration: Boolean(lineRow.enable_proration),
    location_id: null,
    enable_overtime: Boolean(lineRow.enable_overtime),
    overtime_threshold:
      lineRow.overtime_threshold != null
        ? Number(lineRow.overtime_threshold)
        : null,
    overtime_rate: toCents(lineRow.overtime_rate),
    services,
  };
}

async function buildScenarioServiceConfig(
  configDetails: ClientContractServiceConfigDetails,
  poolContext: {
    db: ReturnType<typeof tenantDb>;
    tenant: string;
    contractLineId: string;
    poolRowsByLine: Map<string, PoolRow[]>;
    poolMembersByBucket: Map<string, Array<{ service_id: string; burn_multiplier: number }>>;
  },
): Promise<ScenarioServiceConfig> {
  const configurationType = configDetails.baseConfig.configuration_type;

  switch (configurationType) {
    case "Fixed": {
      const fixed = configDetails.typeConfig as {
        base_rate?: number | null;
      } | null;
      return {
        configuration_type: "Fixed",
        base_rate: toCents(fixed?.base_rate ?? null),
      };
    }
    case "Hourly": {
      const hourly = configDetails.typeConfig as {
        hourly_rate?: number | null;
        minimum_billable_time?: number | null;
        round_up_to_nearest?: number | null;
      } | null;
      return {
        configuration_type: "Hourly",
        hourly_rate: toCents(hourly?.hourly_rate ?? null),
        minimum_billable_time: Number(hourly?.minimum_billable_time ?? 0) || 0,
        round_up_to_nearest: Number(hourly?.round_up_to_nearest ?? 0) || 0,
        user_type_rates: (configDetails.userTypeRates ?? []).map((rate) => ({
          user_type: rate.user_type,
          rate: Number(rate.rate),
        })),
      };
    }
    case "Usage": {
      const usage = configDetails.typeConfig as {
        unit_of_measure?: string;
        enable_tiered_pricing?: boolean;
        minimum_usage?: number | string | null;
        base_rate?: number | null;
      } | null;
      return {
        configuration_type: "Usage",
        unit_of_measure: usage?.unit_of_measure ?? "unit",
        enable_tiered_pricing: Boolean(usage?.enable_tiered_pricing),
        minimum_usage:
          usage?.minimum_usage != null ? Number(usage.minimum_usage) : null,
        base_rate: toCents(usage?.base_rate ?? null),
        tiers: (configDetails.rateTiers ?? []).map((tier) => ({
          min_quantity: Number(tier.min_quantity),
          max_quantity:
            tier.max_quantity != null ? Number(tier.max_quantity) : null,
          rate: Number(tier.rate),
        })),
      };
    }
    case "Bucket": {
      const bucket = configDetails.typeConfig as {
        config_id?: string;
        total_minutes?: number;
        billing_period?: string;
        overage_rate?: number;
        allow_rollover?: boolean;
      } | null;
      if (!bucket) {
        throw new Error(
          `Bucket configuration ${configDetails.baseConfig.config_id} for service ` +
            `${configDetails.serviceId} has no bucket pool (contract_line_buckets) row`,
        );
      }
      // Preserve the weighted-burn pool configuration: the pool for this
      // (line, service) via the scope rule (membership, else line catch-all).
      const linePools = poolContext.poolRowsByLine.get(poolContext.contractLineId) ?? [];
      const memberPool =
        linePools.find((pool) =>
          poolMembersByBucketGet(poolContext.poolMembersByBucket, pool.bucket_id)
            .some((member) => member.service_id === configDetails.serviceId),
        ) ?? null;
      const catchAllPool =
        linePools.find((pool) => pool.covers_all_services) ?? null;
      const pool = memberPool ?? catchAllPool ?? null;
      const memberMultiplier = pool
        ? poolMembersByBucketGet(poolContext.poolMembersByBucket, pool.bucket_id)
            .find((member) => member.service_id === configDetails.serviceId)
            ?.burn_multiplier ?? 1
        : 1;
      return {
        configuration_type: "Bucket",
        total_minutes: Number(bucket.total_minutes ?? 0),
        billing_period: bucket.billing_period ?? "monthly",
        overage_rate: toCents(bucket.overage_rate ?? 0) ?? 0,
        allow_rollover: Boolean(bucket.allow_rollover),
        pool_id: pool?.bucket_id ?? null,
        pool_name: pool?.bucket_name ?? null,
        covers_all_services: Boolean(pool?.covers_all_services),
        after_hours_multiplier:
          pool?.after_hours_multiplier != null
            ? Number(pool.after_hours_multiplier)
            : null,
        business_hours_schedule_id: pool?.business_hours_schedule_id ?? null,
        burn_multiplier: memberMultiplier,
      };
    }
    default:
      throw new Error(
        `Service ${configDetails.serviceId} has unsupported configuration_type ` +
          `"${configurationType}" (config ${configDetails.baseConfig.config_id})`,
      );
  }
}

function poolMembersByBucketGet(
  map: Map<string, Array<{ service_id: string; burn_multiplier: number }>>,
  bucketId: string,
): Array<{ service_id: string; burn_multiplier: number }> {
  return map.get(bucketId) ?? [];
}

async function loadPricingSchedules(
  db: ReturnType<typeof tenantDb>,
  contractId: string,
  isTemplate = false,
): Promise<ScenarioPricingSchedule[]> {
  const rows = await db
    .table(
      isTemplate
        ? "contract_template_pricing_schedules"
        : "contract_pricing_schedules",
    )
    .where({ [isTemplate ? "template_id" : "contract_id"]: contractId })
    .orderBy("effective_date", "asc")
    .select("effective_date", "end_date", "custom_rate");

  return rows.map(
    (row: {
      effective_date: unknown;
      end_date: unknown;
      custom_rate: number | string | null;
    }) => ({
      effective_date: toMidnightIso(row.effective_date),
      end_date: row.end_date ? toMidnightIso(row.end_date) : null,
      custom_rate: toCents(row.custom_rate),
    }),
  );
}

async function loadScenarioDiscounts(
  db: ReturnType<typeof tenantDb>,
  contractId: string,
): Promise<ScenarioDiscount[]> {
  const query = db.table("discounts as d");
  db.tenantJoin(
    query,
    "contract_line_discounts as cld",
    "cld.discount_id",
    "d.discount_id",
  );
  db.tenantJoin(
    query,
    "contract_lines as cl",
    "cl.contract_line_id",
    "cld.contract_line_id",
  );
  const rows = (await query
    .where({ "cl.contract_id": contractId, "d.is_active": true })
    .select(
      "d.discount_id",
      "d.discount_name",
      "d.discount_type",
      "d.value",
      "d.start_date",
      "d.end_date",
      "cl.contract_line_id",
    )) as Array<{
    discount_id: string;
    discount_name: string;
    discount_type: "percentage" | "fixed";
    value: number | string;
    start_date: ISO8601String;
    end_date: ISO8601String | null;
    contract_line_id: string;
  }>;

  const grouped = new Map<string, ScenarioDiscount>();
  for (const row of rows) {
    const existing = grouped.get(row.discount_id);
    if (existing) {
      if (!existing.contract_line_keys.includes(row.contract_line_id)) {
        existing.contract_line_keys.push(row.contract_line_id);
      }
      continue;
    }
    grouped.set(row.discount_id, {
      discount_id: row.discount_id,
      discount_name: row.discount_name,
      discount_type: row.discount_type,
      value: Number(row.value),
      start_date: toMidnightIso(row.start_date),
      end_date: row.end_date ? toMidnightIso(row.end_date) : null,
      contract_line_keys: [row.contract_line_id],
    });
  }
  return Array.from(grouped.values());
}

async function resolveClientBinding(
  knex: Knex,
  db: ReturnType<typeof tenantDb>,
  tenant: string,
  params: SnapshotContractToScenarioParams,
  contract: ContractRow,
  currencyCode: string,
): Promise<{
  clientBinding: ScenarioClientBinding;
  contractStartDate: ISO8601String | null;
  contractEndDate: ISO8601String | null;
  invoiceSchedule: ScenarioBillingSchedule;
}> {
  if (params.clientContractId) {
    const clientContract = await db
      .table("client_contracts")
      .where({ client_contract_id: params.clientContractId })
      .first(
        "client_contract_id",
        "client_id",
        "contract_id",
        "start_date",
        "end_date",
      );
    if (!clientContract) {
      throw new Error(
        `Client contract ${params.clientContractId} not found in tenant ${tenant}`,
      );
    }
    if (clientContract.contract_id !== params.contractId) {
      throw new Error(
        `Client contract ${params.clientContractId} belongs to contract ` +
          `${clientContract.contract_id}, not ${params.contractId}`,
      );
    }

    const client = await db
      .table("clients")
      .where({ client_id: clientContract.client_id })
      .first("client_id", "client_name");
    if (!client) {
      throw new Error(
        `Client ${clientContract.client_id} referenced by client contract ` +
          `${params.clientContractId} not found in tenant ${tenant}`,
      );
    }

    return {
      clientBinding: {
        kind: "client",
        client_id: client.client_id,
        client_name: client.client_name,
      },
      contractStartDate: clientContract.start_date
        ? toMidnightIso(clientContract.start_date)
        : null,
      contractEndDate: clientContract.end_date
        ? toMidnightIso(clientContract.end_date)
        : null,
      invoiceSchedule: await loadClientInvoiceSchedule(
        knex,
        tenant,
        client.client_id,
      ),
    };
  }

  if (params.clientId) {
    const client = await db
      .table("clients")
      .where({ client_id: params.clientId })
      .first("client_id", "client_name");
    if (!client) throw new Error("Simulation client is not available");
    return {
      clientBinding: {
        kind: "client",
        client_id: client.client_id,
        client_name: client.client_name,
      },
      contractStartDate: null,
      contractEndDate: null,
      invoiceSchedule: await loadClientInvoiceSchedule(
        knex,
        tenant,
        client.client_id,
      ),
    };
  }

  if (params.forceProfile) {
    return {
      clientBinding: {
        kind: "profile",
        tax_region: null,
        currency_code: currencyCode,
      },
      contractStartDate: null,
      contractEndDate: null,
      invoiceSchedule: buildDefaultInvoiceSchedule(contract.billing_frequency),
    };
  }

  if (contract.owner_client_id) {
    const client = await db
      .table("clients")
      .where({ client_id: contract.owner_client_id })
      .first("client_id", "client_name");
    if (!client) {
      throw new Error(
        `Owner client ${contract.owner_client_id} of contract ` +
          `${contract.contract_id} not found in tenant ${tenant}`,
      );
    }

    return {
      clientBinding: {
        kind: "client",
        client_id: client.client_id,
        client_name: client.client_name,
      },
      contractStartDate: null,
      contractEndDate: null,
      invoiceSchedule: await loadClientInvoiceSchedule(
        knex,
        tenant,
        client.client_id,
      ),
    };
  }

  // Template-style contract with no client attached: simulate against a
  // hypothetical client profile in the contract currency.
  return {
    clientBinding: {
      kind: "profile",
      tax_region: null,
      currency_code: currencyCode,
    },
    contractStartDate: null,
    contractEndDate: null,
    invoiceSchedule: buildDefaultInvoiceSchedule(contract.billing_frequency),
  };
}

async function loadClientInvoiceSchedule(
  knex: Knex,
  tenant: string,
  clientId: string,
): Promise<ScenarioBillingSchedule> {
  const schedule = await getClientBillingCycleAnchor(knex, tenant, clientId);
  return {
    billing_cycle: schedule.billingCycle,
    anchor: {
      day_of_month: schedule.anchor.dayOfMonth,
      month_of_year: schedule.anchor.monthOfYear,
      day_of_week: schedule.anchor.dayOfWeek,
      reference_date: schedule.anchor.referenceDate,
    },
  };
}

function buildDefaultInvoiceSchedule(
  frequency: string,
): ScenarioBillingSchedule {
  const billingCycle = normalizeScenarioBillingCycle(frequency);
  const anchor = normalizeAnchorSettingsForCycle(billingCycle, {});
  return {
    billing_cycle: billingCycle,
    anchor: {
      day_of_month: anchor.dayOfMonth,
      month_of_year: anchor.monthOfYear,
      day_of_week: anchor.dayOfWeek,
      reference_date: anchor.referenceDate,
    },
  };
}

function normalizeScenarioBillingCycle(frequency: string): BillingCycleType {
  switch (frequency.trim().toLowerCase()) {
    case "weekly":
      return "weekly";
    case "bi-weekly":
    case "biweekly":
      return "bi-weekly";
    case "quarterly":
      return "quarterly";
    case "semi-annually":
    case "semi-annual":
    case "semiannually":
      return "semi-annually";
    case "annually":
    case "annual":
    case "yearly":
      return "annually";
    default:
      return "monthly";
  }
}
