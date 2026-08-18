import { Knex } from "knex";
import { createTenantKnex, tenantDb, withTransaction } from "@alga-psa/db";
import {
  IBillingPeriod,
  IBillingResult,
  IBillingCharge,
  IClientContractLine,
  IBucketUsage,
  IBucketCharge,
  IDiscount,
  IAdjustment,
  IUsageBasedCharge,
  ITimeBasedCharge,
  IFixedPriceCharge,
  IProductCharge,
  ILicenseCharge,
  IHourBlockCharge,
  IProjectBillingConfig,
  IProjectBillingScheduleEntry,
  IProjectPhaseRateOverride,
  IProjectBillingCapUsage,
  IProjectMilestoneCharge,
  IProjectDepositCharge,
  IProject,
  IClientContractLineCycle,
  IRecurringServicePeriod,
  IRecurringServicePeriodRecord,
  BillingCycleType,
  DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES,
  RECURRING_RANGE_SEMANTICS,
} from "@alga-psa/types";
import {
  IContractLineServiceConfiguration,
  IContractLineServiceFixedConfig,
  IContractLineServiceHourlyConfig,
  IContractLineServiceUsageConfig,
  IContractLineServiceBucketConfig,
  IContractLineServiceRateTier,
} from "@alga-psa/types";
// Use the Temporal polyfill for all date arithmetic and plain‐date handling
import { Temporal } from "@js-temporal/polyfill";
import type {
  ISO8601String,
  IClient,
  IRecurringObligationRef,
} from "@alga-psa/types";
import {
  toPlainDate,
  toISODate,
  toISOTimestamp,
  getCurrencySymbol,
} from "@alga-psa/core";
import { getClientDefaultTaxRegionCode as getClientDefaultTaxRegionCodeShared } from "@alga-psa/shared/billingClients";
import { computePoolContributionsByService } from "@alga-psa/shared/billingClients/bucketUsageService";
import {
  calculateServicePeriodCoverage,
  resolveCadenceOwner,
  resolveRecurringSettlementsForInvoiceWindow,
} from "@alga-psa/shared/billingClients/recurringTiming";
import {
  generateAnnualContractCadenceServicePeriods,
  generateMonthlyContractCadenceServicePeriods,
  generateQuarterlyContractCadenceServicePeriods,
  generateSemiAnnualContractCadenceServicePeriods,
  resolveContractCadenceAnchorDate,
  resolveContractCadenceInvoiceWindowForServicePeriod,
} from "@alga-psa/shared/billingClients/contractCadenceServicePeriods";
import {
  buildPostDropRecurringObligationCandidates,
  buildClientCadencePostDropObligationRef,
  CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE,
  POST_DROP_RECURRING_OBLIGATION_TYPES,
} from "@alga-psa/shared/billingClients/postDropRecurringObligationIdentity";
// Removed TaxService import as it's no longer directly used here
// Import necessary functions from invoiceService
import {
  calculateAndDistributeTax,
  updateInvoiceTotalsAndRecordTransaction,
  getClientDetails,
} from "../../services/invoiceService";
import { v4 as uuidv4 } from "uuid";
import ContractLineFixedConfig from "../../models/contractLineFixedConfig"; // Added import for new model
import contractLine from "../../models/contractLine";
import service from "../../models/service";
import { TaxService } from "../../services/taxService";
import {
  computeFixedCharges,
  computeTimeBasedCharges,
  computeUsageBasedCharges,
  computeBucketCharges,
  computeRecurringQuantityCharges,
  computeDiscountsAndAdjustments,
  filterApplicableDiscounts,
  buildChargeComputeTaxContext,
  type ChargeComputeClient,
  type ChargeComputeTaxContext,
  type LoadedChargeTaxRate,
  type UsageServiceConfigEntry,
} from "./compute";
import { ClientContractServiceConfigurationService } from "../../services/clientContractServiceConfigurationService";
import {
  computeCapWriteDown,
  computeDepositReconciliation,
  computeEntryAmounts,
  detectThresholdCrossings,
} from "../../services/projectBillingService";
import {
  normalizeProjectBillingCapUsage,
  normalizeProjectBillingConfig,
  normalizeProjectBillingScheduleEntry,
  normalizeProjectPhaseRateOverride,
} from "../../models/projectBillingModelUtils";
import { isProjectMaterialEligible } from "@alga-psa/inventory/lib";
// Workflow imports removed as event emission is moved back to the calling action

type DiscountQueryRow = IDiscount & {
  contract_line_id?: string | null;
  start_date: ISO8601String;
  end_date?: ISO8601String | null;
};

type ResolvedRecurringChargeTiming = {
  servicePeriodRecordId: string | null;
  duePosition: "arrears" | "advance";
  servicePeriodStart: ISO8601String;
  servicePeriodEnd: ISO8601String;
  servicePeriodStartExclusive: ISO8601String;
  servicePeriodEndExclusive: ISO8601String;
  coverageRatio: number;
};

type RecurringChargeTimingSelections = Record<
  string,
  ResolvedRecurringChargeTiming
>;

type CalculateBillingOptions = {
  recurringTimingSelections?: RecurringChargeTimingSelections;
  recurringTimingSelectionSource?: "derived" | "persisted";
  nonContractSelection?: {
    include: boolean;
    timeEntryIds?: string[];
    usageRecordIds?: string[];
  };
  projectTarget?: {
    projectId: string;
    entryIds?: string[];
    projectClosed?: boolean;
    materialMode?: "project_invoice" | "separate_invoice";
    selectedMaterialIds?: string[];
  };
};

type ProjectBillingConfigWithProject = IProjectBillingConfig & {
  project_name: string;
  project_number: string;
};

type ProjectBillingTarget = Pick<
  IProject,
  "project_id" | "client_id" | "start_date" | "created_at" | "is_closed"
>;

type ProjectPhaseRateOverrideWithService = IProjectPhaseRateOverride & {
  override_service_name: string | null;
  override_tax_rate_id: string | null;
  override_default_rate: number | null;
};

type ProjectBillingContext = {
  configs: ProjectBillingConfigWithProject[];
  configsById: Map<string, ProjectBillingConfigWithProject>;
  configsByProjectId: Map<string, ProjectBillingConfigWithProject>;
  entriesByConfigId: Map<string, IProjectBillingScheduleEntry[]>;
  computedAmountsByEntryId: Map<string, number>;
  phaseNamesByEntryId: Map<string, string | null>;
  overridesByPhaseId: Map<string, ProjectPhaseRateOverrideWithService[]>;
  capUsageByConfigId: Map<string, IProjectBillingCapUsage>;
};

export type ProjectCapThresholdCrossing = {
  configId: string;
  projectId: string;
  threshold: number;
  previousBilled: number;
  newBilled: number;
};

export type ProjectBillingEngineResult = IBillingResult & {
  error?: string;
  projectCapThresholdCrossings?: ProjectCapThresholdCrossing[];
  warnings?: string[];
};

type ProjectAnnotatedCharge = IBillingCharge & {
  project_id: string;
  project_name: string;
  project_number: string;
  project_billing_config_id: string;
  project_cap_original_amount?: number;
  project_cap_original_tax_amount?: number;
  write_down_amount?: number;
  write_down_reason?: "project_cap";
};

type ProjectScheduleCharge = (
  | IProjectMilestoneCharge
  | IProjectDepositCharge
) & {
  project_name: string;
  project_number: string;
  phase_name: string | null;
  project_billing_config_id: string;
  deposit_treatment: IProjectBillingConfig["deposit_treatment"];
};

type PersistedRecurringTimingSelectionRecord = Pick<
  IRecurringServicePeriodRecord,
  | "recordId"
  | "sourceObligation"
  | "cadenceOwner"
  | "duePosition"
  | "servicePeriod"
  | "activityWindow"
>;

type ContractCadenceGenerator =
  typeof generateMonthlyContractCadenceServicePeriods;

const RECURRING_TIMING_ROLLOUT_GUARD_PREFIX =
  "Recurring timing rollout guard blocked mixed legacy/canonical timing state";

/**
 * Window-independent load inputs for one fixed contract line: the same rows are
 * valid for every invoice window the line is priced in.
 */
type FixedChargeLineStaticInputs = {
  contractLineDetails: any;
  planServices: any[];
  fallbackService: any | null;
  /**
   * True when no base rate resolves from any source, which makes the line
   * price to nothing in EVERY window (see computeFixedCharges' base-rate
   * resolution). Such lines are skipped instead of recomputed per window.
   */
  unpriceable: boolean;
};

/**
 * Per-request cache of fixed-line static inputs, keyed by contract line id.
 * Callers pricing several invoice windows in one request share one session so
 * each line is loaded — and rejected as unpriceable — at most once.
 */
export type FixedChargePreviewSession = Map<string, FixedChargeLineStaticInputs>;

export const createFixedChargePreviewSession = (): FixedChargePreviewSession =>
  new Map();

/** Everything calculateFixedPriceCharges would otherwise query per line. */
type PreloadedFixedChargeInputs = FixedChargeLineStaticInputs & {
  client: IClient;
  /** Schedules for the line's contract, ordered by effective_date desc. */
  pricingSchedules: any[];
  taxContext: ChargeComputeTaxContext;
};

const normalizeScheduleDate = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return toISODate(toPlainDate(value as any));
  } catch {
    return null;
  }
};

/**
 * In-memory equivalent of the per-line active-pricing-schedule query:
 * [start, end) overlap against the service period, newest effective_date first.
 */
const selectActivePricingSchedule = (
  schedules: any[],
  servicePeriodStartExclusive: ISO8601String,
  servicePeriodEndExclusive: ISO8601String,
): any | undefined =>
  schedules.find((schedule) => {
    const effectiveDate = normalizeScheduleDate(schedule.effective_date);
    if (effectiveDate === null || effectiveDate >= servicePeriodEndExclusive) {
      return false;
    }
    const endDate = normalizeScheduleDate(schedule.end_date);
    return endDate === null || endDate > servicePeriodStartExclusive;
  });

/**
 * Mirrors computeFixedCharges' base-rate resolution order (plan custom rate →
 * assignment custom rate → service base rates → catalog default rates) so a
 * line that resolves to nothing can be skipped before the compute call.
 * Pricing-schedule overrides are deliberately not consulted: they never feed
 * planLevelBaseRate, so they cannot rescue a line the compute layer rejects.
 */
const isFixedLineUnpriceable = (
  clientContractLine: IClientContractLine,
  contractLineDetails: any,
  planServices: any[],
): boolean => {
  if (contractLineDetails?.contract_line_type !== "Fixed") {
    return false;
  }

  const parseRate = (value: unknown): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = typeof value === "string" ? parseFloat(value) : Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  };

  if (parseRate(contractLineDetails.custom_rate) !== null) {
    return false;
  }
  if (parseRate(clientContractLine.custom_rate) !== null) {
    return false;
  }
  if (
    planServices.some(
      (service) => parseRate(service.service_base_rate) !== null,
    )
  ) {
    return false;
  }

  const totalDefaultRateCents = planServices.reduce((sum, service) => {
    const rate = Number(service.default_rate ?? 0);
    const quantity =
      Number(service.configuration_quantity ?? service.service_quantity ?? 1) ||
      1;
    return sum + rate * quantity;
  }, 0);

  return totalDefaultRateCents === 0;
};

export class BillingEngine {
  private knex: Knex;
  private tenant: string | null;
  private readonly clientDefaultTaxRegionCodeCache = new Map<
    string,
    string | null
  >();
  private readonly locationTaxRegionCodeCache = new Map<
    string,
    string | null
  >();

  constructor() {
    this.knex = null as any;
    this.tenant = null;
  }

  private async initKnex() {
    if (!this.knex) {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error("tenant context not found");
      }
      this.knex = knex;
      this.tenant = tenant;
    }
  }

  private isTransactionKnex(
    knex: Knex | Knex.Transaction,
  ): knex is Knex.Transaction {
    return (
      typeof (knex as Knex.Transaction).commit === "function" &&
      typeof (knex as Knex.Transaction).rollback === "function"
    );
  }

  private async withPinnedTransaction<T>(
    callback: (trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    await this.initKnex();

    if (this.isTransactionKnex(this.knex)) {
      return callback(this.knex);
    }

    return withTransaction(this.knex, async (trx) => {
      const previousKnex = this.knex;
      this.knex = trx;
      try {
        return await callback(trx);
      } finally {
        this.knex = previousKnex;
      }
    });
  }

  private async loadProjectBillingContext(
    clientId: string,
    projectId?: string,
  ): Promise<ProjectBillingContext | null> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const db = tenantDb(this.knex, this.tenant);
    const configsQuery = db.table<any>("project_billing_configs as config");
    db.tenantJoin(
      configsQuery,
      "projects as project",
      "config.project_id",
      "project.project_id",
    );
    configsQuery
      .where("project.client_id", clientId)
      .select("config.*", "project.project_name", "project.project_number");
    if (projectId) {
      configsQuery.where("project.project_id", projectId);
    }

    const configRows = await configsQuery;
    if (configRows.length === 0) {
      return null;
    }

    const configs = configRows.map(
      (row): ProjectBillingConfigWithProject => ({
        ...normalizeProjectBillingConfig(row as Record<string, unknown>),
        project_name: String(row.project_name),
        project_number: String(row.project_number ?? ""),
      }),
    );
    const configIds = configs.map((config) => config.config_id);
    const configsById = new Map(
      configs.map((config) => [config.config_id, config]),
    );
    const configsByProjectId = new Map(
      configs.map((config) => [config.project_id, config]),
    );

    const entriesQuery = db.table<any>(
      "project_billing_schedule_entries as entry",
    );
    db.tenantJoin(
      entriesQuery,
      "project_phases as phase",
      "entry.phase_id",
      "phase.phase_id",
      { type: "left" },
    );
    const entryRows = await entriesQuery
      .whereIn("entry.config_id", configIds)
      .select("entry.*", "phase.phase_name")
      .orderBy("entry.display_order", "asc")
      .orderBy("entry.created_at", "asc")
      .orderBy("entry.schedule_entry_id", "asc");

    const entriesByConfigId = new Map<string, IProjectBillingScheduleEntry[]>();
    const phaseNamesByEntryId = new Map<string, string | null>();
    for (const row of entryRows) {
      const entry = normalizeProjectBillingScheduleEntry(
        row as Record<string, unknown>,
      );
      const entries = entriesByConfigId.get(entry.config_id) ?? [];
      entries.push(entry);
      entriesByConfigId.set(entry.config_id, entries);
      phaseNamesByEntryId.set(
        entry.schedule_entry_id,
        typeof row.phase_name === "string" ? row.phase_name : null,
      );
    }

    const computedAmountsByEntryId = new Map<string, number>();
    for (const config of configs) {
      const entries = entriesByConfigId.get(config.config_id) ?? [];
      const amounts = computeEntryAmounts(config, entries);
      entries.forEach((entry, index) => {
        computedAmountsByEntryId.set(entry.schedule_entry_id, amounts[index]);
      });
    }

    const tmConfigIds = configs
      .filter((config) => config.billing_model === "time_and_materials")
      .map((config) => config.config_id);
    const overridesByPhaseId = new Map<
      string,
      ProjectPhaseRateOverrideWithService[]
    >();
    if (tmConfigIds.length > 0) {
      const overridesQuery = db.table<any>(
        "project_phase_rate_overrides as rate_override",
      );
      db.tenantJoin(
        overridesQuery,
        "project_phases as phase",
        "rate_override.phase_id",
        "phase.phase_id",
      );
      db.tenantJoin(
        overridesQuery,
        "projects as project",
        "phase.project_id",
        "project.project_id",
      );
      db.tenantJoin(
        overridesQuery,
        "project_billing_configs as config",
        "project.project_id",
        "config.project_id",
      );
      db.tenantJoin(
        overridesQuery,
        "service_catalog as override_service",
        "rate_override.override_service_id",
        "override_service.service_id",
        { type: "left" },
      );
      const overrideRows = await overridesQuery
        .whereIn("config.config_id", tmConfigIds)
        .select(
          "rate_override.*",
          "override_service.service_name as override_service_name",
          "override_service.tax_rate_id as override_tax_rate_id",
          "override_service.default_rate as override_default_rate",
        )
        .orderBy("rate_override.created_at", "asc")
        .orderBy("rate_override.rate_override_id", "asc");

      for (const row of overrideRows) {
        const normalized = normalizeProjectPhaseRateOverride(
          row as Record<string, unknown>,
        );
        const override: ProjectPhaseRateOverrideWithService = {
          ...normalized,
          override_service_name:
            typeof row.override_service_name === "string"
              ? row.override_service_name
              : null,
          override_tax_rate_id:
            typeof row.override_tax_rate_id === "string"
              ? row.override_tax_rate_id
              : null,
          override_default_rate:
            row.override_default_rate === null ||
            row.override_default_rate === undefined
              ? null
              : Number(row.override_default_rate),
        };
        const overrides = overridesByPhaseId.get(override.phase_id) ?? [];
        overrides.push(override);
        overridesByPhaseId.set(override.phase_id, overrides);
      }
    }

    const capUsageRows =
      tmConfigIds.length === 0
        ? []
        : await db
            .table("project_billing_cap_usage")
            .whereIn("config_id", tmConfigIds);
    const capUsageByConfigId = new Map(
      capUsageRows.map((row) => {
        const usage = normalizeProjectBillingCapUsage(
          row as Record<string, unknown>,
        );
        return [usage.config_id, usage] as const;
      }),
    );

    return {
      configs,
      configsById,
      configsByProjectId,
      entriesByConfigId,
      computedAmountsByEntryId,
      phaseNamesByEntryId,
      overridesByPhaseId,
      capUsageByConfigId,
    };
  }

  private resolveProjectPhaseRateOverride(
    context: ProjectBillingContext | null,
    phaseId: string | null | undefined,
    serviceId: string,
  ): ProjectPhaseRateOverrideWithService | null {
    if (!context || !phaseId) {
      return null;
    }

    const overrides = context.overridesByPhaseId.get(phaseId) ?? [];
    return (
      overrides.find((override) => override.service_id === serviceId) ??
      overrides.find((override) => override.service_id === null) ??
      null
    );
  }

  private getNextBillingDateForCycle(
    currentEndDate: ISO8601String,
    billingCycle: BillingCycleType,
  ): ISO8601String {
    const currentDate = toPlainDate(currentEndDate);
    let nextDate: Temporal.PlainDate;

    switch (billingCycle) {
      case "weekly":
        nextDate = currentDate.add({ days: 7 });
        break;
      case "bi-weekly":
        nextDate = currentDate.add({ days: 14 });
        break;
      case "monthly":
        nextDate = currentDate.add({ months: 1 });
        break;
      case "quarterly":
        nextDate = currentDate.add({ months: 3 });
        break;
      case "semi-annually":
        nextDate = currentDate.add({ months: 6 });
        break;
      case "annually":
        nextDate = currentDate.add({ years: 1 });
        break;
      default:
        nextDate = currentDate.add({ months: 1 });
        break;
    }

    return toISODate(nextDate);
  }

  private async getClientDefaultTaxRegionCode(
    clientId: string,
  ): Promise<string | null> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const cacheKey = `${this.tenant}:${clientId}`;
    if (this.clientDefaultTaxRegionCodeCache.has(cacheKey)) {
      return this.clientDefaultTaxRegionCodeCache.get(cacheKey) ?? null;
    }

    const taxRegionCode = await getClientDefaultTaxRegionCodeShared(
      this.knex,
      this.tenant,
      clientId,
    );
    this.clientDefaultTaxRegionCodeCache.set(cacheKey, taxRegionCode);
    return taxRegionCode;
  }

  /**
   * Determines the tax region and taxability based on a service's tax_rate_id.
   * @param service - The service object, expected to have service_id and tax_rate_id.
   * @returns An object containing the taxRegion (string | null) and isTaxable (boolean).
   */
  private async getTaxInfoFromService(
    service: any,
  ): Promise<{ taxRegion: string | null; isTaxable: boolean }> {
    if (!this.knex || !this.tenant) {
      await this.initKnex(); // Ensure Knex is initialized
      if (!this.tenant)
        throw new Error("Tenant context not found in getTaxInfoFromService");
    }

    // Default values if no service is provided or found
    if (!service) {
      console.warn("[getTaxInfoFromService] No service object provided.");
      return { taxRegion: null, isTaxable: false }; // Assuming non-taxable if no service context
    }

    if (service.tax_rate_id) {
      try {
        const db = tenantDb(this.knex, this.tenant);
        const taxRateInfo = await db
          .table("tax_rates")
          .where({ tax_rate_id: service.tax_rate_id })
          // TODO: Add validity checks if needed (e.g., is_active, date range matching billing period)
          .select("region_code")
          .first();

        if (taxRateInfo && taxRateInfo.region_code) {
          // Valid tax_rate_id found, service is taxable in this region
          return { taxRegion: taxRateInfo.region_code, isTaxable: true };
        } else {
          // tax_rate_id exists but doesn't link to a valid/active rate? Treat as non-taxable.
          console.warn(
            `[getTaxInfoFromService] Service ${service.service_id} has tax_rate_id ${service.tax_rate_id} but no matching/valid tax_rate found in tenant ${this.tenant}. Treating as non-taxable.`,
          );
          return { taxRegion: null, isTaxable: false };
        }
      } catch (error) {
        console.error(
          `[getTaxInfoFromService] Error fetching tax rate info for tax_rate_id ${service.tax_rate_id}:`,
          error,
        );
        return { taxRegion: null, isTaxable: false }; // Treat as non-taxable on error
      }
    } else {
      // Service exists but tax_rate_id is NULL, explicitly non-taxable
      return { taxRegion: null, isTaxable: false };
    }
  }

  /** Resolve tax region codes for many locations in one query (cached). */
  private async loadLocationTaxRegionCodes(
    locationIds: Array<string | null | undefined>,
  ): Promise<Map<string, string | null>> {
    const regions = new Map<string, string | null>();
    const missing: string[] = [];
    for (const locationId of locationIds) {
      if (!locationId || regions.has(locationId)) {
        continue;
      }
      const cacheKey = `${this.tenant}:${locationId}`;
      if (this.locationTaxRegionCodeCache.has(cacheKey)) {
        regions.set(
          locationId,
          this.locationTaxRegionCodeCache.get(cacheKey) ?? null,
        );
        continue;
      }
      missing.push(locationId);
    }

    if (missing.length > 0) {
      const db = tenantDb(this.knex, this.tenant!);
      const rows = await db
        .table("client_locations")
        .whereIn("location_id", missing)
        .select("location_id", "region_code");
      const regionByLocationId = new Map(
        rows.map((row: any) => [
          row.location_id,
          (row.region_code as string | null | undefined) ?? null,
        ]),
      );
      for (const locationId of missing) {
        const regionCode = regionByLocationId.get(locationId) ?? null;
        this.locationTaxRegionCodeCache.set(
          `${this.tenant}:${locationId}`,
          regionCode,
        );
        regions.set(locationId, regionCode);
      }
    }

    return regions;
  }

  /** Load every tax row needed by deterministic charge arithmetic. */
  private async loadChargeComputeTaxContext(input: {
    client: ChargeComputeClient;
    locationId: string | null | undefined;
    /** Preload several locations at once; defaults to just `locationId`. */
    locationIds?: Array<string | null | undefined>;
    services: Array<{ tax_rate_id?: string | null }>;
  }): Promise<ChargeComputeTaxContext> {
    await this.initKnex();
    if (!this.tenant) throw new Error("tenant context not found");
    const db = tenantDb(this.knex, this.tenant);
    const rateRows = await db
      .table("tax_rates")
      .select(
        "tax_rate_id",
        "region_code",
        "tax_percentage",
        "is_active",
        "start_date",
        "end_date",
        "currency_code",
      );
    const rates: LoadedChargeTaxRate[] = rateRows.map((rate) => ({
      taxRateId: rate.tax_rate_id,
      regionCode: rate.region_code ?? null,
      percentage: Number(rate.tax_percentage) || 0,
      isActive: Boolean(rate.is_active),
      startDate: toISODate(toPlainDate(rate.start_date)),
      endDate: rate.end_date ? toISODate(toPlainDate(rate.end_date)) : null,
      currencyCode: rate.currency_code ?? null,
    }));
    const rateById = new Map(rates.map((rate) => [rate.taxRateId, rate]));
    const hasTaxableService = input.services.some((service) => {
      const rate = service.tax_rate_id
        ? rateById.get(service.tax_rate_id)
        : undefined;
      return Boolean(rate?.regionCode);
    });

    let settings = await db
      .table("client_tax_settings")
      .where({ client_id: input.client.client_id })
      .select("is_reverse_charge_applicable")
      .first();
    // Preserve TaxService.calculateTax's production-only provisioning side
    // effect, but keep it in this load phase and only when tax would be read.
    if (!settings && !input.client.is_tax_exempt && hasTaxableService) {
      await new TaxService().createDefaultTaxSettings(input.client.client_id);
      settings = await db
        .table("client_tax_settings")
        .where({ client_id: input.client.client_id })
        .select("is_reverse_charge_applicable")
        .first();
    }

    const [locationRegions, clientDefaultRegion] = await Promise.all([
      this.loadLocationTaxRegionCodes(input.locationIds ?? [input.locationId]),
      this.getClientDefaultTaxRegionCode(input.client.client_id),
    ]);

    return buildChargeComputeTaxContext({
      clientId: input.client.client_id,
      clientIsTaxExempt: Boolean(input.client.is_tax_exempt),
      reverseCharge: Boolean(settings?.is_reverse_charge_applicable),
      clientDefaultRegion,
      locationRegions,
      rates,
    });
  }

  // Removed getDefaultTaxRatePercentage function as it uses outdated logic
  // and tax calculation is now delegated to invoiceService.

  private async hasExistingInvoiceForCycle(
    clientId: string,
    billingCycleId: string,
  ): Promise<boolean> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const db = tenantDb(this.knex, this.tenant);
    const client = await db
      .table("clients")
      .where({
        client_id: clientId,
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const existingInvoice = await db
      .table("invoices")
      .where({
        client_id: clientId,
        billing_cycle_id: billingCycleId,
        tenant: this.tenant,
      })
      .first();
    return !!existingInvoice;
  }

  async calculateBilling(
    clientId: string,
    startDate: ISO8601String,
    endDate: ISO8601String,
    billingCycleId: string,
    options: CalculateBillingOptions = {},
  ): Promise<IBillingResult & { error?: string }> {
    this.clientDefaultTaxRegionCodeCache.clear();
    this.locationTaxRegionCodeCache.clear();
    return this.withPinnedTransaction(async () => {
      return this.calculateBillingInternal(
        clientId,
        startDate,
        endDate,
        billingCycleId,
        options,
      );
    });
  }

  async calculateBillingForExecutionWindow(
    clientId: string,
    startDate: ISO8601String,
    endDate: ISO8601String,
    options: CalculateBillingOptions = {},
  ): Promise<IBillingResult & { error?: string }> {
    this.clientDefaultTaxRegionCodeCache.clear();
    this.locationTaxRegionCodeCache.clear();
    return this.withPinnedTransaction(async () => {
      await this.initKnex();
      const db = tenantDb(this.knex, this.tenant!);
      const client = await db
        .table<IClient>("clients")
        .where({ client_id: clientId })
        .first();

      const billingPeriod: IBillingPeriod = {
        startDate: toISODate(toPlainDate(startDate)),
        endDate: toISODate(toPlainDate(endDate)),
      };

      console.log(
        `Calculating billing for client ${client?.client_name} (${clientId}) using execution window: ${billingPeriod.startDate} to ${billingPeriod.endDate}`,
      );

      return this.calculateBillingForPreparedPeriod(
        clientId,
        billingPeriod,
        client,
        options,
      );
    });
  }

  async calculateProjectBilling(
    projectId: string,
    entryIds?: string[],
  ): Promise<ProjectBillingEngineResult> {
    this.clientDefaultTaxRegionCodeCache.clear();
    this.locationTaxRegionCodeCache.clear();
    return this.withPinnedTransaction(async () => {
      await this.initKnex();
      if (!this.tenant) {
        throw new Error("tenant context not found");
      }

      const db = tenantDb(this.knex, this.tenant);
      const project = await this.loadProjectBillingTarget(projectId);
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      const client = await db
        .table<IClient>("clients")
        .where({ client_id: project.client_id })
        .first();
      if (!client) {
        throw new Error(
          `Client ${project.client_id} not found for project ${projectId}`,
        );
      }

      const context = await this.loadProjectBillingContext(
        project.client_id,
        projectId,
      );
      if (!context) {
        throw new Error(
          `Project ${projectId} does not have project billing configured`,
        );
      }

      const startDate = toISODate(
        toPlainDate(project.start_date ?? project.created_at),
      );
      const endDate = toISODate(Temporal.Now.plainDateISO().add({ days: 1 }));
      return this.calculateBillingForPreparedPeriod(
        project.client_id,
        { startDate, endDate },
        client,
        {
          projectTarget: {
            projectId,
            entryIds,
            projectClosed: project.is_closed === true,
          },
        },
      );
    });
  }

  async calculateSeparateProjectProductBilling(
    projectId: string,
    materialIds: string[],
    currencyCode: string,
  ): Promise<IBillingResult> {
    this.clientDefaultTaxRegionCodeCache.clear();
    this.locationTaxRegionCodeCache.clear();
    return this.withPinnedTransaction(async () => {
      await this.initKnex();
      if (!this.tenant) {
        throw new Error("tenant context not found");
      }
      if (materialIds.length === 0) {
        throw new Error("At least one project product must be selected");
      }

      const project = await this.loadProjectBillingTarget(projectId);
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }
      const context = await this.loadProjectBillingContext(project.client_id, projectId);
      const billingPeriod: IBillingPeriod = {
        startDate: toISODate(toPlainDate(project.start_date ?? project.created_at)),
        endDate: toISODate(Temporal.Now.plainDateISO().add({ days: 1 })),
      };
      const charges = await this.calculateMaterialCharges(
        project.client_id,
        billingPeriod,
        currencyCode,
        projectId,
        context ?? undefined,
        {
          projectId,
          projectClosed: project.is_closed === true,
          materialMode: "separate_invoice",
          selectedMaterialIds: materialIds,
        },
      );
      const totalAmount = charges.reduce((sum, charge) => sum + charge.total, 0);
      return {
        tenant: this.tenant,
        charges,
        totalAmount,
        discounts: [],
        adjustments: [],
        finalAmount: totalAmount + charges.reduce((sum, charge) => sum + (charge.tax_amount || 0), 0),
        currency_code: currencyCode,
      };
    });
  }

  private async loadProjectBillingTarget(
    projectId: string,
  ): Promise<ProjectBillingTarget | undefined> {
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const db = tenantDb(this.knex, this.tenant);
    const query = db.table("projects as project")
      .where("project.project_id", projectId);
    db.tenantJoin(
      query,
      "statuses as project_status",
      "project.status",
      "project_status.status_id",
      { type: "left" },
    );

    return await query.first(
      "project.project_id",
      "project.client_id",
      "project.start_date",
      "project.created_at",
      "project_status.is_closed",
    ) as ProjectBillingTarget | undefined;
  }

  async selectDueRecurringServicePeriodsForBillingWindow(
    clientId: string,
    startDate: ISO8601String,
    endDate: ISO8601String,
  ): Promise<RecurringChargeTimingSelections> {
    this.clientDefaultTaxRegionCodeCache.clear();
    this.locationTaxRegionCodeCache.clear();
    return this.withPinnedTransaction(async () => {
      const billingPeriod: IBillingPeriod = {
        startDate: toISODate(toPlainDate(startDate)),
        endDate: toISODate(toPlainDate(endDate)),
      };
      const clientContractLines =
        await this.getClientContractLinesForBillingPeriod(
          clientId,
          billingPeriod,
        );
      const persistedSelections =
        await this.loadPersistedRecurringTimingSelections(
          billingPeriod,
          clientContractLines,
        );

      if (persistedSelections === null) {
        throw new Error(
          `Recurring service periods have not been materialized for client ${clientId} in execution window ${billingPeriod.startDate} to ${billingPeriod.endDate}`,
        );
      }

      return persistedSelections;
    });
  }

  private async loadPersistedRecurringTimingSelections(
    billingPeriod: IBillingPeriod,
    clientContractLines: IClientContractLine[],
  ): Promise<RecurringChargeTimingSelections | null> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const eligibleLineIds = [
      ...new Set(
        clientContractLines.map((line) => line.client_contract_line_id),
      ),
    ];

    if (eligibleLineIds.length === 0) {
      return {};
    }

    const db = tenantDb(this.knex, this.tenant);
    const dueRows = await db
      .table("recurring_service_periods")
      .whereIn("obligation_id", eligibleLineIds)
      .whereIn("obligation_type", [...POST_DROP_RECURRING_OBLIGATION_TYPES])
      .whereIn("lifecycle_state", [
        ...DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES,
      ])
      .where("invoice_window_start", billingPeriod.startDate)
      .where("invoice_window_end", billingPeriod.endDate)
      .whereNull("invoice_charge_detail_id")
      .orderBy("obligation_id", "asc")
      .orderBy("service_period_start", "asc")
      .orderBy("revision", "asc")
      .select(
        "record_id",
        "obligation_id",
        "obligation_type",
        "charge_family",
        "cadence_owner",
        "due_position",
        "service_period_start",
        "service_period_end",
        "activity_window_start",
        "activity_window_end",
      );

    if (dueRows.length === 0) {
      const existingMaterializedRow = await db
        .table("recurring_service_periods")
        .whereIn("obligation_id", eligibleLineIds)
        .whereIn("obligation_type", [...POST_DROP_RECURRING_OBLIGATION_TYPES])
        .whereNotIn("lifecycle_state", ["archived", "superseded"])
        .first("record_id");

      return existingMaterializedRow ? {} : null;
    }

    return this.buildRecurringTimingSelectionsFromPersistedRecords(
      dueRows.map((row) => ({
        recordId: row.record_id,
        sourceObligation: {
          tenant: this.tenant!,
          obligationId: row.obligation_id,
          obligationType: row.obligation_type,
          chargeFamily: row.charge_family,
        },
        cadenceOwner: row.cadence_owner,
        duePosition: row.due_position,
        servicePeriod: {
          start: toISODate(toPlainDate(row.service_period_start)),
          end: toISODate(toPlainDate(row.service_period_end)),
          semantics: RECURRING_RANGE_SEMANTICS,
        },
        activityWindow:
          row.activity_window_start && row.activity_window_end
            ? {
                start: toISODate(toPlainDate(row.activity_window_start)),
                end: toISODate(toPlainDate(row.activity_window_end)),
                semantics: RECURRING_RANGE_SEMANTICS,
              }
            : null,
      })),
    );
  }

  private async calculateBillingInternal(
    clientId: string,
    startDate: ISO8601String,
    endDate: ISO8601String,
    billingCycleId: string,
    options: CalculateBillingOptions = {},
  ): Promise<IBillingResult & { error?: string }> {
    try {
      await this.initKnex();
      if (!this.tenant) {
        throw new Error("tenant context not found");
      }
      const db = tenantDb(this.knex, this.tenant);
      const client = await db
        .table<IClient>("clients")
        .where({ client_id: clientId })
        .first();
      console.log(
        `Calculating billing for client ${client?.client_name} (${clientId}) using billingCycleId: ${billingCycleId}`,
      );

      // Fetch the specific billing cycle record
      const cycleRecord = await db
        .table("client_billing_cycles")
        .where({
          billing_cycle_id: billingCycleId,
          client_id: clientId, // Ensure it matches the client
        })
        .first();

      if (!cycleRecord) {
        return {
          charges: [],
          totalAmount: 0,
          discounts: [],
          adjustments: [],
          finalAmount: 0,
          currency_code: client?.default_currency_code || "USD",
          error: `Billing cycle ${billingCycleId} not found for client ${clientId}`,
        };
      }

      // Check for existing invoice in this billing cycle (using the fetched cycleRecord)
      const hasExistingInvoice = await this.hasExistingInvoiceForCycle(
        clientId,
        cycleRecord.billing_cycle_id,
      );
      if (hasExistingInvoice) {
        // Return zero-amount billing result if already invoiced
        return {
          charges: [],
          totalAmount: 0,
          discounts: [],
          adjustments: [],
          finalAmount: 0,
          currency_code: client?.default_currency_code || "USD",
        };
      }

      // Determine billing period dates CONSISTENTLY
      let periodStartDate: ISO8601String;
      let periodEndDate: ISO8601String;

      if (cycleRecord.period_start_date && cycleRecord.period_end_date) {
        console.log(
          `Using period dates from cycle record: ${cycleRecord.period_start_date} to ${cycleRecord.period_end_date}`,
        );
        // Ensure dates are in the correct plain date format before converting
        periodStartDate = toISODate(toPlainDate(cycleRecord.period_start_date));
        periodEndDate = toISODate(toPlainDate(cycleRecord.period_end_date));
      } else if (cycleRecord.effective_date) {
        console.log(
          `Calculating period dates from effective date: ${cycleRecord.effective_date}`,
        );
        // Ensure effective_date is in the correct plain date format
        const effectivePlainDate = toPlainDate(cycleRecord.effective_date);
        periodStartDate = toISODate(effectivePlainDate); // Start date is the effective date
        // Need client billing frequency to calculate end date accurately
        // Use the cycle's effective date to determine the relevant frequency
        const clientBillingCycle = (await this.getBillingCycle(
          clientId,
          periodStartDate,
        )) as BillingCycleType;
        const nextBillingDate = this.getNextBillingDateForCycle(
          periodStartDate,
          clientBillingCycle,
        );
        // Billing periods are treated as [start, end) (end exclusive).
        // The end date is the start of the next cycle.
        periodEndDate = toISODate(toPlainDate(nextBillingDate));
        console.log(
          `Calculated period: ${periodStartDate} to ${periodEndDate}`,
        );
      } else {
        return {
          charges: [],
          totalAmount: 0,
          discounts: [],
          adjustments: [],
          finalAmount: 0,
          currency_code: client?.default_currency_code || "USD",
          error: `Billing cycle ${billingCycleId} has invalid dates (no period dates or effective date)`,
        };
      }

      const billingPeriod: IBillingPeriod = {
        startDate: periodStartDate,
        endDate: periodEndDate,
      };
      console.log(
        `Consistent billing period: ${billingPeriod.startDate} to ${billingPeriod.endDate}`,
      );

      return this.calculateBillingForPreparedPeriod(
        clientId,
        billingPeriod,
        client,
        options,
      );
    } catch (err) {
      console.error("Error in calculateBilling:", err);
      return {
        charges: [],
        totalAmount: 0,
        discounts: [],
        adjustments: [],
        finalAmount: 0,
        currency_code: "USD", // Default on error
        error:
          err instanceof Error
            ? err.message
            : "An error occurred while calculating billing",
      };
    }
  }

  private async calculateBillingForPreparedPeriod(
    clientId: string,
    billingPeriod: IBillingPeriod,
    client: IClient | undefined,
    options: CalculateBillingOptions = {},
  ): Promise<ProjectBillingEngineResult> {
    if (
      !options.projectTarget &&
      options.recurringTimingSelectionSource !== "persisted"
    ) {
      // Legacy cycle validation is still relevant for cycle-driven/manual runs.
      const validationResult = await this.validateBillingPeriod(
        clientId,
        billingPeriod.startDate,
        billingPeriod.endDate,
      );
      if (!validationResult.success) {
        return {
          charges: [],
          totalAmount: 0,
          discounts: [],
          adjustments: [],
          finalAmount: 0,
          currency_code: client?.default_currency_code || "USD",
          error: validationResult.error,
        };
      }
    }

    let totalCharges: IBillingCharge[] = [];
    let clientContractLines: IClientContractLine[] = [];
    let cycle: string | undefined;

    if (options.projectTarget) {
      clientContractLines = await this.getClientContractLinesForBillingPeriod(
        clientId,
        billingPeriod,
      );
    } else if (options.recurringTimingSelectionSource === "persisted") {
      clientContractLines = await this.getClientContractLinesForBillingPeriod(
        clientId,
        billingPeriod,
      );
    } else {
      const plansResult = await this.getClientContractLinesAndCycle(
        clientId,
        billingPeriod,
      );

      const {
        clientContractLines: loadedContractLines,
        billingCycle,
        error: plansError,
      } = plansResult as {
        clientContractLines: IClientContractLine[];
        billingCycle: string;
        error?: string;
      };

      if (plansError) {
        return {
          charges: [],
          totalAmount: 0,
          discounts: [],
          adjustments: [],
          finalAmount: 0,
          currency_code: client?.default_currency_code || "USD",
          error: plansError,
        };
      }

      clientContractLines = loadedContractLines;
      cycle = billingCycle;
    }

    const uniqueCurrencies = Array.from(
      new Set(
        clientContractLines
          .map((line) => line.currency_code)
          .filter((code): code is string => !!code),
      ),
    );

    if (uniqueCurrencies.length > 1) {
      return {
        charges: [],
        totalAmount: 0,
        discounts: [],
        adjustments: [],
        finalAmount: 0,
        currency_code: client?.default_currency_code || "USD",
        error: `Billing Error: Client ${clientId} has active contracts in multiple currencies (${uniqueCurrencies.join(", ")}). Mixed currency billing is not supported.`,
      };
    }

    const billingCurrency =
      uniqueCurrencies.length === 1
        ? uniqueCurrencies[0]
        : client?.default_currency_code || "USD";

    console.log(
      `[BillingEngine] Resolved billing currency: ${billingCurrency}`,
    );

    const projectBillingContext = await this.loadProjectBillingContext(
      clientId,
      options.projectTarget?.projectId,
    );
    const targetProjectConfig = options.projectTarget
      ? projectBillingContext?.configsByProjectId.get(
          options.projectTarget.projectId,
        )
      : undefined;

    const recurringTimingSelections = options.recurringTimingSelections
      ? options.recurringTimingSelectionSource === "persisted"
        ? this.assertPersistedRecurringTimingSelectionsReferenceEligibleLines(
            clientContractLines,
            options.recurringTimingSelections,
          )
        : this.assertRecurringTimingSelectionsMatchCanonical(
            this.buildRecurringTimingSelections(
              billingPeriod,
              clientContractLines,
              cycle!,
            ),
            options.recurringTimingSelections,
          )
      : cycle
        ? this.buildRecurringTimingSelections(
            billingPeriod,
            clientContractLines,
            cycle,
          )
        : {};
    const nonContractSelection = options.nonContractSelection;

    const materialCharges = projectBillingContext
      ? await this.calculateMaterialCharges(
          clientId,
          billingPeriod,
          billingCurrency,
          options.projectTarget?.projectId,
          projectBillingContext,
          options.projectTarget,
        )
      : await this.calculateMaterialCharges(
          clientId,
          billingPeriod,
          billingCurrency,
        );
    const projectMaterialWarnings = options.projectTarget
      ? await this.getProjectMaterialCurrencyWarnings(
          clientId,
          options.projectTarget.projectId,
          billingCurrency,
        )
      : [];

    if (clientContractLines.length === 0 && !nonContractSelection?.include) {
      if (materialCharges.length === 0 && !projectBillingContext) {
        return {
          charges: [],
          totalAmount: 0,
          discounts: [],
          adjustments: [],
          finalAmount: 0,
          currency_code: billingCurrency,
          warnings: projectMaterialWarnings,
          error:
            "No active contract lines found for this client in the selected billing period.",
        };
      }

      totalCharges = totalCharges.concat(materialCharges);
    }

    console.log(
      `Found ${clientContractLines.length} active contract line(s) for client ${clientId}`,
    );
    if (cycle) {
      console.log(`Billing cycle: ${cycle}`);
    } else if (options.recurringTimingSelectionSource === "persisted") {
      console.log(
        "[BillingEngine] Using persisted recurring service-period timing without client billing cycle lookup",
      );
    }

    for (const clientContractLine of clientContractLines) {
      console.log(
        `Processing contract line: ${clientContractLine.contract_line_name}`,
      );
      const [
        fixedPriceCharges,
        timeBasedCharges,
        usageBasedCharges,
        bucketPlanCharges,
        productCharges,
        licenseCharges,
      ] = await Promise.all([
        options.projectTarget
          ? Promise.resolve([] as IFixedPriceCharge[])
          : this.calculateFixedPriceCharges(
              clientId,
              billingPeriod,
              clientContractLine,
              cycle,
              recurringTimingSelections[
                clientContractLine.client_contract_line_id
              ],
              options.recurringTimingSelectionSource,
            ),
        targetProjectConfig?.billing_model === "fixed_price"
          ? Promise.resolve([] as ITimeBasedCharge[])
          : projectBillingContext || options.projectTarget
            ? this.calculateTimeBasedCharges(
                clientId,
                billingPeriod,
                clientContractLine,
                cycle,
                recurringTimingSelections[
                  clientContractLine.client_contract_line_id
                ],
                options.recurringTimingSelectionSource,
                projectBillingContext,
                options.projectTarget,
              )
            : this.calculateTimeBasedCharges(
                clientId,
                billingPeriod,
                clientContractLine,
                cycle,
                recurringTimingSelections[
                  clientContractLine.client_contract_line_id
                ],
                options.recurringTimingSelectionSource,
              ),
        options.projectTarget
          ? Promise.resolve([] as IUsageBasedCharge[])
          : this.calculateUsageBasedCharges(
              clientId,
              billingPeriod,
              clientContractLine,
              cycle,
              recurringTimingSelections[
                clientContractLine.client_contract_line_id
              ],
              options.recurringTimingSelectionSource,
            ),
        options.projectTarget
          ? Promise.resolve([] as IBucketCharge[])
          : this.calculateBucketPlanCharges(
              clientId,
              billingPeriod,
              clientContractLine,
            ),
        options.projectTarget
          ? Promise.resolve([] as IProductCharge[])
          : this.calculateProductCharges(
              clientId,
              billingPeriod,
              clientContractLine,
              cycle,
              recurringTimingSelections[
                clientContractLine.client_contract_line_id
              ],
              options.recurringTimingSelectionSource,
            ),
        options.projectTarget
          ? Promise.resolve([] as ILicenseCharge[])
          : this.calculateLicenseCharges(
              clientId,
              billingPeriod,
              clientContractLine,
              cycle,
              recurringTimingSelections[
                clientContractLine.client_contract_line_id
              ],
              options.recurringTimingSelectionSource,
            ),
      ]);

      console.log(`Fixed price charges: ${fixedPriceCharges.length}`);
      console.log(`Time-based charges: ${timeBasedCharges.length}`);
      console.log(`Usage-based charges: ${usageBasedCharges.length}`);
      console.log(`Bucket plan charges: ${bucketPlanCharges.length}`);
      console.log(`Product charges: ${productCharges.length}`);
      console.log(`License charges: ${licenseCharges.length}`);

      const totalFixedCharges = fixedPriceCharges.reduce(
        (sum: number, charge: IFixedPriceCharge) => sum + charge.total,
        0,
      );
      console.log(
        `Total fixed charges: ${getCurrencySymbol(billingCurrency)}${(totalFixedCharges / 100).toFixed(2)} (${totalFixedCharges} cents)`,
      );

      totalCharges = totalCharges.concat(
        fixedPriceCharges,
        timeBasedCharges,
        usageBasedCharges,
        bucketPlanCharges,
        productCharges,
        licenseCharges,
      );

      console.log("Total charges breakdown:");
      const currencySymbol = getCurrencySymbol(billingCurrency);
      fixedPriceCharges.forEach((charge: IBillingCharge) => {
        console.log(
          `fixed - ${charge.serviceName}: ${currencySymbol}${(charge.total / 100).toFixed(2)}`,
        );
      });
      timeBasedCharges.forEach((charge: ITimeBasedCharge) => {
        console.log(
          `hourly - ${charge.serviceName}: ${currencySymbol}${(charge.total / 100).toFixed(2)}`,
        );
      });
      usageBasedCharges.forEach((charge: IUsageBasedCharge) => {
        console.log(
          `usage - ${charge.serviceName}: ${currencySymbol}${(charge.total / 100).toFixed(2)}`,
        );
      });
      bucketPlanCharges.forEach((charge: IBucketCharge) => {
        console.log(
          `bucket - ${charge.serviceName}: ${currencySymbol}${(charge.total / 100).toFixed(2)}`,
        );
      });
      productCharges.forEach((charge: IProductCharge) => {
        console.log(
          `product - ${charge.serviceName}: ${currencySymbol}${(charge.total / 100).toFixed(2)}`,
        );
      });
      licenseCharges.forEach((charge: ILicenseCharge) => {
        console.log(
          `license - ${charge.serviceName}: ${currencySymbol}${(charge.total / 100).toFixed(2)}`,
        );
      });

      console.log("Total charges:", totalCharges);
    }

    if (clientContractLines.length > 0 && materialCharges.length > 0) {
      totalCharges = totalCharges.concat(materialCharges);
    }

    if (projectBillingContext) {
      const [milestoneCharges, depositCharges] = await Promise.all([
        this.calculateProjectMilestoneCharges(
          projectBillingContext,
          client,
          billingPeriod,
          billingCurrency,
          options.projectTarget,
        ),
        this.calculateProjectDepositCharges(
          projectBillingContext,
          client,
          billingPeriod,
          billingCurrency,
          options.projectTarget,
        ),
      ]);
      totalCharges = totalCharges.concat(milestoneCharges, depositCharges);
    }

    const includeTargetProjectActivity =
      options.projectTarget &&
      targetProjectConfig?.billing_model === "time_and_materials";
    if (nonContractSelection?.include || includeTargetProjectActivity) {
      const selection = includeTargetProjectActivity
        ? {
            timeEntryIds: nonContractSelection?.timeEntryIds,
            usageRecordIds: nonContractSelection?.usageRecordIds,
            excludeTimeEntryIds: totalCharges
              .filter(
                (charge): charge is ITimeBasedCharge => charge.type === "time",
              )
              .map((charge) => charge.entryId),
          }
        : {
            timeEntryIds: nonContractSelection?.timeEntryIds,
            usageRecordIds: nonContractSelection?.usageRecordIds,
          };
      const nonContractCharges =
        projectBillingContext || options.projectTarget
          ? await this.calculateUnresolvedNonContractCharges(
              clientId,
              billingPeriod,
              selection,
              projectBillingContext,
              options.projectTarget,
            )
          : await this.calculateUnresolvedNonContractCharges(
              clientId,
              billingPeriod,
              selection,
            );
      totalCharges = totalCharges.concat(nonContractCharges);

      // Zero-dollar prepaid-hour-block informational lines. Emitted alongside
      // the non-contract billing they offset so covered time is marked
      // invoiced; fully-covered entries therefore produce no hourly charge.
      if (!options.projectTarget) {
        const hourBlockCharges = await this.calculateHourBlockUsageCharges(
          clientId,
          billingPeriod,
        );
        totalCharges = totalCharges.concat(hourBlockCharges);
      }
    }

    const capResult = projectBillingContext
      ? this.applyProjectCapAdjustments(totalCharges, projectBillingContext)
      : { charges: totalCharges, thresholdCrossings: [] };
    totalCharges = capResult.charges;

    const totalAmount = totalCharges.reduce(
      (sum: number, charge: IBillingCharge) => sum + charge.total,
      0,
    );

    const finalCharges = await this.applyDiscountsAndAdjustments(
      {
        charges: totalCharges,
        totalAmount,
        discounts: [],
        adjustments: [],
        finalAmount: totalAmount,
        currency_code: billingCurrency,
      },
      clientId,
      billingPeriod,
    );

    console.log(`Discounts applied: ${finalCharges.discounts.length}`);
    console.log(`Adjustments applied: ${finalCharges.adjustments.length}`);
    console.log(
      `Final amount after discounts and adjustments: ${getCurrencySymbol(billingCurrency)}${(finalCharges.finalAmount / 100).toFixed(2)} (${finalCharges.finalAmount} cents)`,
    );

    return projectBillingContext
      ? {
          ...finalCharges,
          projectCapThresholdCrossings: capResult.thresholdCrossings,
          warnings: projectMaterialWarnings,
        }
      : finalCharges;
  }

  private async getProjectMaterialCurrencyWarnings(
    clientId: string,
    projectId: string,
    invoiceCurrency: string,
  ): Promise<string[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const rows = await tenantDb(this.knex, this.tenant)
      .table("project_materials")
      .where({
        client_id: clientId,
        project_id: projectId,
        is_billed: false,
      })
      .whereNot("currency_code", invoiceCurrency)
      .groupBy("currency_code")
      .select("currency_code")
      .count<{ currency_code: string; count: string }[]>({ count: "*" });

    return rows.map(
      (row) =>
        `${Number(row.count)} materials in ${row.currency_code} were skipped — invoice currency is ${invoiceCurrency}`,
    );
  }

  private async calculateProjectMilestoneCharges(
    context: ProjectBillingContext,
    client: IClient | undefined,
    billingPeriod: IBillingPeriod,
    billingCurrency: string,
    target?: CalculateBillingOptions["projectTarget"],
  ): Promise<ProjectScheduleCharge[]> {
    return this.calculateProjectScheduleCharges(
      "milestone",
      context,
      client,
      billingPeriod,
      billingCurrency,
      target,
    );
  }

  private async calculateProjectDepositCharges(
    context: ProjectBillingContext,
    client: IClient | undefined,
    billingPeriod: IBillingPeriod,
    billingCurrency: string,
    target?: CalculateBillingOptions["projectTarget"],
  ): Promise<ProjectScheduleCharge[]> {
    return this.calculateProjectScheduleCharges(
      "deposit",
      context,
      client,
      billingPeriod,
      billingCurrency,
      target,
    );
  }

  private async calculateProjectScheduleCharges(
    entryType: "milestone" | "deposit",
    context: ProjectBillingContext,
    client: IClient | undefined,
    billingPeriod: IBillingPeriod,
    billingCurrency: string,
    target?: CalculateBillingOptions["projectTarget"],
  ): Promise<ProjectScheduleCharge[]> {
    if (!client) {
      return [];
    }

    const selectedEntryIds = target?.entryIds ? new Set(target.entryIds) : null;
    const charges: ProjectScheduleCharge[] = [];

    for (const config of context.configs) {
      if (target) {
        if (config.project_id !== target.projectId) {
          continue;
        }
      } else if (config.invoice_mode !== "recurring") {
        continue;
      }

      const entries = context.entriesByConfigId.get(config.config_id) ?? [];
      const finalMilestone = entries.findLast(
        (entry) =>
          entry.entry_type === "milestone" && entry.status !== "canceled",
      );
      const depositReconciliation =
        entryType === "milestone" && finalMilestone
          ? computeDepositReconciliation(
              entries.map((entry) => ({
                entry_type: entry.entry_type,
                status: entry.status,
                computed_amount:
                  context.computedAmountsByEntryId.get(
                    entry.schedule_entry_id,
                  ) ?? 0,
              })),
              config.deposit_treatment,
            )
          : 0;

      for (const entry of entries) {
        if (
          entry.entry_type !== entryType ||
          entry.status !== "approved" ||
          (selectedEntryIds && !selectedEntryIds.has(entry.schedule_entry_id))
        ) {
          continue;
        }

        if (entry.frozen_amount === null) {
          throw new Error(
            `Approved project billing schedule entry ${entry.schedule_entry_id} has no frozen amount`,
          );
        }
        const computedAmount = entry.frozen_amount;
        const amount =
          entryType === "milestone" &&
          finalMilestone?.schedule_entry_id === entry.schedule_entry_id
            ? Math.max(0, computedAmount - depositReconciliation)
            : computedAmount;
        const effectiveTaxRegion =
          config.tax_region ??
          (await this.getClientDefaultTaxRegionCode(client.client_id)) ??
          undefined;
        let taxAmount = 0;
        let taxRate = 0;
        if (
          !client.is_tax_exempt &&
          config.is_taxable &&
          effectiveTaxRegion &&
          amount > 0
        ) {
          const taxResult = await new TaxService().calculateTax(
            client.client_id,
            amount,
            billingPeriod.endDate,
            effectiveTaxRegion,
            true,
            config.currency ?? billingCurrency,
          );
          taxAmount = taxResult.taxAmount;
          taxRate = taxResult.taxRate;
        }

        charges.push({
          type:
            entryType === "milestone" ? "project_milestone" : "project_deposit",
          project_id: config.project_id,
          schedule_entry_id: entry.schedule_entry_id,
          project_name: config.project_name,
          project_number: config.project_number,
          phase_name:
            context.phaseNamesByEntryId.get(entry.schedule_entry_id) ?? null,
          project_billing_config_id: config.config_id,
          deposit_treatment: config.deposit_treatment,
          serviceName: entry.description,
          quantity: 1,
          rate: amount,
          total: amount,
          tax_amount: taxAmount,
          tax_rate: taxRate,
          tax_region: effectiveTaxRegion,
          is_taxable: config.is_taxable,
        } as ProjectScheduleCharge);
      }
    }

    return charges;
  }

  private applyProjectCapAdjustments(
    charges: IBillingCharge[],
    context: ProjectBillingContext,
  ): {
    charges: IBillingCharge[];
    thresholdCrossings: ProjectCapThresholdCrossing[];
  } {
    const projectCharges = new Map<string, ProjectAnnotatedCharge[]>();
    for (const charge of charges) {
      if (
        !("project_billing_config_id" in charge) ||
        typeof charge.project_billing_config_id !== "string"
      ) {
        continue;
      }
      const projectCharge = charge as ProjectAnnotatedCharge;
      const grouped =
        projectCharges.get(projectCharge.project_billing_config_id) ?? [];
      grouped.push(projectCharge);
      projectCharges.set(projectCharge.project_billing_config_id, grouped);
    }

    const thresholdCrossings: ProjectCapThresholdCrossing[] = [];
    for (const [configId, configCharges] of projectCharges) {
      const config = context.configsById.get(configId);
      if (!config || config.cap_amount === null) {
        continue;
      }

      const usage = context.capUsageByConfigId.get(configId);
      const previousBilled = usage?.billed_amount ?? 0;
      let runningBilled = previousBilled;

      for (const charge of configCharges) {
        const originalAmount = charge.total;
        const originalTaxAmount = charge.tax_amount ?? 0;
        charge.project_cap_original_amount = originalAmount;
        charge.project_cap_original_tax_amount = originalTaxAmount;
        const writeDown = computeCapWriteDown(
          config.cap_amount,
          runningBilled,
          originalAmount,
        );
        charge.total = writeDown.billable;
        charge.write_down_amount = writeDown.writtenDown;
        if (writeDown.writtenDown > 0) {
          charge.write_down_reason = "project_cap";
        }
        if (originalAmount > 0 && originalTaxAmount > 0) {
          charge.tax_amount = Math.round(
            originalTaxAmount * (writeDown.billable / originalAmount),
          );
        }
        runningBilled += writeDown.billable;
      }

      const crossed = detectThresholdCrossings(
        config.cap_amount,
        previousBilled,
        runningBilled,
        config.cap_notify_thresholds,
        usage?.notified_thresholds ?? [],
      );
      thresholdCrossings.push(
        ...crossed.map((threshold) => ({
          configId,
          projectId: config.project_id,
          threshold,
          previousBilled,
          newBilled: runningBilled,
        })),
      );
    }

    return { charges, thresholdCrossings };
  }

  async calculateUnresolvedNonContractChargesForExecutionWindow(input: {
    clientId: string;
    windowStart: ISO8601String;
    windowEnd: ISO8601String;
    selectedTimeEntryIds?: string[];
    selectedUsageRecordIds?: string[];
  }): Promise<IBillingCharge[]> {
    return this.withPinnedTransaction(async () => {
      const billingPeriod: IBillingPeriod = {
        startDate: toISODate(toPlainDate(input.windowStart)),
        endDate: toISODate(toPlainDate(input.windowEnd)),
      };
      const context = await this.loadProjectBillingContext(input.clientId);
      const selection = {
        timeEntryIds: input.selectedTimeEntryIds,
        usageRecordIds: input.selectedUsageRecordIds,
      };
      const charges = context
        ? await this.calculateUnresolvedNonContractCharges(
            input.clientId,
            billingPeriod,
            selection,
            context,
          )
        : await this.calculateUnresolvedNonContractCharges(
            input.clientId,
            billingPeriod,
            selection,
          );
      return context
        ? this.applyProjectCapAdjustments(charges, context).charges
        : charges;
    });
  }

  private async getEligibleContractLineIdsForServiceAtDate(input: {
    clientId: string;
    serviceId: string;
    workDate: ISO8601String;
  }): Promise<string[]> {
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const db = tenantDb(this.knex, this.tenant);
    const eligibleLinesQuery = db.table("client_contracts as cc");
    db.tenantJoin(
      eligibleLinesQuery,
      "contracts as c",
      "c.contract_id",
      "cc.contract_id",
    );
    db.tenantJoin(
      eligibleLinesQuery,
      "contract_lines as cl",
      "cl.contract_id",
      "c.contract_id",
    );
    db.tenantJoin(
      eligibleLinesQuery,
      "contract_line_services as cls",
      "cls.contract_line_id",
      "cl.contract_line_id",
    );

    const rows = await eligibleLinesQuery
      .where({
        "cc.client_id": input.clientId,
        "cc.is_active": true,
        "cls.service_id": input.serviceId,
      })
      .where("cc.start_date", "<=", input.workDate)
      .where(function (this: Knex.QueryBuilder) {
        this.whereNull("cc.end_date").orWhere(
          "cc.end_date",
          ">=",
          input.workDate,
        );
      })
      .distinct("cl.contract_line_id")
      .select("cl.contract_line_id");

    return rows
      .map((row: any) => row.contract_line_id)
      .filter(
        (lineId: unknown): lineId is string =>
          typeof lineId === "string" && lineId.length > 0,
      );
  }

  private async calculateUnresolvedNonContractCharges(
    clientId: string,
    billingPeriod: IBillingPeriod,
    selection?: {
      timeEntryIds?: string[];
      usageRecordIds?: string[];
      excludeTimeEntryIds?: string[];
    },
    projectBillingContext?: ProjectBillingContext | null,
    projectTarget?: CalculateBillingOptions["projectTarget"],
  ): Promise<IBillingCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const selectedTimeEntryIds =
      selection?.timeEntryIds && selection.timeEntryIds.length > 0
        ? new Set(selection.timeEntryIds)
        : null;
    const selectedUsageRecordIds =
      selection?.usageRecordIds && selection.usageRecordIds.length > 0
        ? new Set(selection.usageRecordIds)
        : null;
    const excludedTimeEntryIds = new Set(selection?.excludeTimeEntryIds ?? []);

    const db = tenantDb(this.knex, this.tenant);
    const client = await db
      .table("clients")
      .where({
        client_id: clientId,
        tenant: this.tenant,
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const unresolvedCharges: Array<ITimeBasedCharge | IUsageBasedCharge> = [];
    const defaultTaxRegion = await this.getClientDefaultTaxRegionCode(clientId);

    const timeEntriesQuery = db.table<any>("time_entries");
    db.tenantJoin(
      timeEntriesQuery,
      "users",
      "time_entries.user_id",
      "users.user_id",
    );
    db.tenantJoin(
      timeEntriesQuery,
      "service_catalog",
      "service_catalog.service_id",
      "time_entries.service_id",
      { type: "left" },
    );
    db.tenantJoin(
      timeEntriesQuery,
      "project_ticket_links",
      "time_entries.work_item_id",
      "project_ticket_links.ticket_id",
      { type: "left" },
    );
    db.tenantJoin(
      timeEntriesQuery,
      "project_tasks",
      "time_entries.work_item_id",
      "project_tasks.task_id",
      { type: "left" },
    );
    db.tenantJoin(
      timeEntriesQuery,
      "project_phases",
      "project_tasks.phase_id",
      "project_phases.phase_id",
      { type: "left" },
    );
    db.tenantJoin(
      timeEntriesQuery,
      "projects",
      "project_phases.project_id",
      "projects.project_id",
      { type: "left" },
    );
    db.tenantJoin(
      timeEntriesQuery,
      "tickets",
      "time_entries.work_item_id",
      "tickets.ticket_id",
      { type: "left" },
    );

    timeEntriesQuery
      .where({
        "time_entries.tenant": this.tenant,
      })
      .where("time_entries.invoiced", false)
      .whereNull("time_entries.contract_line_id")
      .whereNotNull("time_entries.service_id")
      .where("time_entries.approval_status", "APPROVED")
      .where("time_entries.billable_duration", ">", 0)
      .where(function (this: Knex.QueryBuilder) {
        this.where("projects.client_id", clientId).orWhere(
          "tickets.client_id",
          clientId,
        );
      });

    if (projectTarget) {
      timeEntriesQuery.where("projects.project_id", projectTarget.projectId);
    } else {
      timeEntriesQuery
        .where("time_entries.start_time", ">=", billingPeriod.startDate)
        .where("time_entries.end_time", "<", billingPeriod.endDate);
    }

    const fixedPriceProjectIds =
      projectBillingContext?.configs
        .filter((config) => config.billing_model === "fixed_price")
        .map((config) => config.project_id) ?? [];
    if (fixedPriceProjectIds.length > 0) {
      timeEntriesQuery.where(function (this: Knex.QueryBuilder) {
        this.whereNull("projects.project_id").orWhereNotIn(
          "projects.project_id",
          fixedPriceProjectIds,
        );
      });
    }

    const timeEntries = await timeEntriesQuery.select(
      "time_entries.*",
      "service_catalog.service_name",
      "service_catalog.default_rate",
      "service_catalog.tax_rate_id",
      "project_phases.phase_id as project_phase_id",
      "projects.project_id as project_id",
      this.knex.raw(
        "COALESCE((SELECT SUM(a.minutes) FROM hour_block_time_allocations a " +
        "WHERE a.tenant = time_entries.tenant AND a.time_entry_id = time_entries.entry_id), 0) " +
        "as block_allocated_minutes"
      ),
    );

    for (const entry of timeEntries) {
      if (excludedTimeEntryIds.has(entry.entry_id)) {
        continue;
      }
      if (selectedTimeEntryIds && !selectedTimeEntryIds.has(entry.entry_id)) {
        continue;
      }
      if (!entry.service_id) {
        continue;
      }
      if (!projectTarget) {
        const workDate = toISODate(toPlainDate(entry.start_time));
        const eligibleLineIds =
          await this.getEligibleContractLineIdsForServiceAtDate({
            clientId,
            serviceId: entry.service_id,
            workDate,
          });
        if (eligibleLineIds.length === 1) {
          const updatedCount = await db
            .table("time_entries")
            .where({
              tenant: this.tenant,
              entry_id: entry.entry_id,
            })
            .whereNull("contract_line_id")
            .update({
              contract_line_id: eligibleLineIds[0],
              updated_at: this.knex.fn.now(),
            });
          console.info("[billing_engine.reconcile.unresolved]", {
            event: "billing_engine.reconcile.unresolved",
            recordType: "time_entry",
            tenant: this.tenant,
            clientId,
            recordId: entry.entry_id,
            decision: "deterministic_single_match",
            selectedContractLineId: eligibleLineIds[0],
            eligibleLineCount: eligibleLineIds.length,
            persisted: updatedCount > 0,
            metric: { name: "unmatched_resolved_deterministically", value: 1 },
          });
          continue;
        }
        console.info("[billing_engine.reconcile.unresolved]", {
          event: "billing_engine.reconcile.unresolved",
          recordType: "time_entry",
          tenant: this.tenant,
          clientId,
          recordId: entry.entry_id,
          decision: eligibleLineIds.length > 1 ? "ambiguous" : "no_match",
          selectedContractLineId: null,
          eligibleLineCount: eligibleLineIds.length,
          persisted: false,
          metric:
            eligibleLineIds.length > 1
              ? { name: "unresolved_ambiguous_count", value: 1 }
              : undefined,
        });
      }

      // Bill the positive billable minutes; zero-billable entries are filtered
      // out of the loader, so the authoritative quantity can never be zero.
      // Unresolved (non-contract) entries have no contract-line rounding
      // config, so fall back to exact time rather than Math.ceil to a whole
      // hour, which overbilled every partial-hour entry.
      //
      // Prepaid hour blocks offset this bucket: minutes the entry burned from
      // an hour block (hour_block_time_allocations) were already paid for and
      // must not be billed here. Fully covered entries produce no charge; the
      // zero-dollar hour_block info line marks them invoiced downstream.
      const blockAllocatedMinutes = Math.max(
        0,
        Number(entry.block_allocated_minutes ?? 0),
      );
      const billableMinutes = Math.max(
        0,
        Number(entry.billable_duration) - blockAllocatedMinutes,
      );
      if (billableMinutes <= 0) {
        continue;
      }
      const duration = billableMinutes / 60;
      const phaseOverride = this.resolveProjectPhaseRateOverride(
        projectBillingContext ?? null,
        entry.project_phase_id,
        entry.service_id,
      );
      const effectiveServiceId =
        phaseOverride?.override_service_id ?? entry.service_id;
      const effectiveServiceName =
        phaseOverride?.override_service_name ?? entry.service_name;
      const effectiveTaxRateId =
        phaseOverride?.override_tax_rate_id ?? entry.tax_rate_id;
      const rate = Math.ceil(
        phaseOverride?.rate ??
          entry.custom_rate ??
          phaseOverride?.override_default_rate ??
          entry.default_rate ??
          0,
      );
      const total = Math.round(duration * rate);
      const { taxRegion: serviceTaxRegion, isTaxable } =
        await this.getTaxInfoFromService({
          service_id: effectiveServiceId,
          tax_rate_id: effectiveTaxRateId,
        });

      let taxAmount = 0;
      let taxRate = 0;
      const effectiveTaxRegion =
        serviceTaxRegion ?? defaultTaxRegion ?? undefined;
      if (!client.is_tax_exempt && isTaxable && effectiveTaxRegion) {
        try {
          const taxServiceInstance = new TaxService();
          const taxResult = await taxServiceInstance.calculateTax(
            client.client_id,
            total,
            billingPeriod.endDate,
            effectiveTaxRegion,
            true,
            client.default_currency_code || "USD",
          );
          taxRate = taxResult.taxRate;
          taxAmount = taxResult.taxAmount;
        } catch (error) {
          console.error(
            `Error calculating tax for unresolved time entry ${entry.entry_id}:`,
            error,
          );
        }
      }

      const projectConfig = entry.project_id
        ? projectBillingContext?.configsByProjectId.get(entry.project_id)
        : undefined;
      unresolvedCharges.push({
        type: "time",
        serviceId: effectiveServiceId,
        serviceName: effectiveServiceName,
        userId: entry.user_id,
        duration,
        quantity: duration,
        rate,
        total,
        tax_amount: taxAmount,
        tax_rate: taxRate,
        tax_region: effectiveTaxRegion,
        entryId: entry.entry_id,
        is_taxable: isTaxable,
        servicePeriodStart: billingPeriod.startDate,
        servicePeriodEnd: billingPeriod.endDate,
        billingTiming: "arrears",
        ...(projectConfig?.billing_model === "time_and_materials"
          ? {
              project_id: projectConfig.project_id,
              project_name: projectConfig.project_name,
              project_number: projectConfig.project_number,
              project_billing_config_id: projectConfig.config_id,
            }
          : {}),
      } satisfies ITimeBasedCharge);
    }

    if (projectTarget) {
      return unresolvedCharges;
    }

    const usageRecordsQuery = db.table<any>("usage_tracking");
    db.tenantJoin(
      usageRecordsQuery,
      "service_catalog",
      "service_catalog.service_id",
      "usage_tracking.service_id",
      { type: "left" },
    );

    const usageRecords = await usageRecordsQuery
      .where({
        "usage_tracking.client_id": clientId,
        "usage_tracking.tenant": this.tenant,
        "usage_tracking.invoiced": false,
      })
      .where("usage_tracking.usage_date", ">=", billingPeriod.startDate)
      .where("usage_tracking.usage_date", "<", billingPeriod.endDate)
      .whereNull("usage_tracking.contract_line_id")
      .whereNotNull("usage_tracking.service_id")
      .select(
        "usage_tracking.*",
        "service_catalog.service_name",
        "service_catalog.default_rate",
        "service_catalog.tax_rate_id",
      );

    for (const record of usageRecords) {
      if (
        selectedUsageRecordIds &&
        !selectedUsageRecordIds.has(record.usage_id)
      ) {
        continue;
      }
      if (!record.service_id) {
        continue;
      }
      const workDate = toISODate(toPlainDate(record.usage_date));
      const eligibleLineIds =
        await this.getEligibleContractLineIdsForServiceAtDate({
          clientId,
          serviceId: record.service_id,
          workDate,
        });
      if (eligibleLineIds.length === 1) {
        const updatedCount = await db
          .table("usage_tracking")
          .where({
            tenant: this.tenant,
            usage_id: record.usage_id,
          })
          .whereNull("contract_line_id")
          .update({
            contract_line_id: eligibleLineIds[0],
            updated_at: this.knex.fn.now(),
          });
        console.info("[billing_engine.reconcile.unresolved]", {
          event: "billing_engine.reconcile.unresolved",
          recordType: "usage_record",
          tenant: this.tenant,
          clientId,
          recordId: record.usage_id,
          decision: "deterministic_single_match",
          selectedContractLineId: eligibleLineIds[0],
          eligibleLineCount: eligibleLineIds.length,
          persisted: updatedCount > 0,
          metric: { name: "unmatched_resolved_deterministically", value: 1 },
        });
        continue;
      }
      console.info("[billing_engine.reconcile.unresolved]", {
        event: "billing_engine.reconcile.unresolved",
        recordType: "usage_record",
        tenant: this.tenant,
        clientId,
        recordId: record.usage_id,
        decision: eligibleLineIds.length > 1 ? "ambiguous" : "no_match",
        selectedContractLineId: null,
        eligibleLineCount: eligibleLineIds.length,
        persisted: false,
        metric:
          eligibleLineIds.length > 1
            ? { name: "unresolved_ambiguous_count", value: 1 }
            : undefined,
      });

      const quantity = Math.max(0, Number(record.quantity ?? 0));
      const rate = Math.ceil(record.custom_rate ?? record.default_rate ?? 0);
      const total = Math.ceil(quantity * rate);
      const { taxRegion: serviceTaxRegion, isTaxable } =
        await this.getTaxInfoFromService({
          service_id: record.service_id,
          tax_rate_id: record.tax_rate_id,
        });

      let taxAmount = 0;
      let taxRate = 0;
      const effectiveTaxRegion =
        serviceTaxRegion ?? defaultTaxRegion ?? undefined;
      if (!client.is_tax_exempt && isTaxable && effectiveTaxRegion) {
        try {
          const taxServiceInstance = new TaxService();
          const taxResult = await taxServiceInstance.calculateTax(
            client.client_id,
            total,
            billingPeriod.endDate,
            effectiveTaxRegion,
            true,
            client.default_currency_code || "USD",
          );
          taxRate = taxResult.taxRate;
          taxAmount = taxResult.taxAmount;
        } catch (error) {
          console.error(
            `Error calculating tax for unresolved usage record ${record.usage_id}:`,
            error,
          );
        }
      }

      unresolvedCharges.push({
        type: "usage",
        serviceId: record.service_id,
        serviceName: record.service_name,
        quantity,
        rate,
        total,
        tax_amount: taxAmount,
        tax_rate: taxRate,
        tax_region: effectiveTaxRegion,
        usageId: record.usage_id,
        is_taxable: isTaxable,
        servicePeriodStart: billingPeriod.startDate,
        servicePeriodEnd: billingPeriod.endDate,
        billingTiming: "arrears",
      } satisfies IUsageBasedCharge);
    }

    return unresolvedCharges;
  }

  /**
   * Zero-dollar informational lines for prepaid-hour-block consumption in the
   * invoice window: one `hour_block` charge per block with burn, carrying the
   * fully-covered entry ids so invoiceService marks them invoiced. Burns only
   * ever come from non-contract (block-eligible) entries, so a covered entry
   * is by construction never billed hourly — no double-billing.
   */
  private async calculateHourBlockUsageCharges(
    clientId: string,
    billingPeriod: IBillingPeriod,
  ): Promise<IHourBlockCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const db = tenantDb(this.knex, this.tenant);
    const query = db.table("hour_block_time_allocations as hba");
    db.tenantJoin(query, "hour_blocks as hb", "hba.block_id", "hb.block_id");
    db.tenantJoin(query, "time_entries as te", "hba.time_entry_id", "te.entry_id");
    db.tenantJoin(query, "service_catalog as sc", "hb.service_id", "sc.service_id", {
      type: "left",
    });

    const rows = await query
      .where({
        "hb.client_id": clientId,
        "te.invoiced": false,
      })
      .whereNull("te.contract_line_id")
      .where("te.approval_status", "APPROVED")
      .where("te.start_time", ">=", billingPeriod.startDate)
      .where("te.end_time", "<", billingPeriod.endDate)
      .select(
        "hb.block_id",
        "hb.remaining_minutes",
        "hb.service_id",
        "sc.service_name as service_name",
        "hba.time_entry_id",
        "hba.minutes",
        "te.billable_duration",
      );

    const { aggregateHourBlockBurnRows, computeHourBlockCharges } = await import(
      "./compute/computeHourBlockCharges"
    );
    const blocks = aggregateHourBlockBurnRows(rows);

    return computeHourBlockCharges({ billingPeriod, blocks }).charges;
  }

  private async getClientContractLinesForBillingPeriod(
    clientId: string,
    billingPeriod: IBillingPeriod,
  ): Promise<IClientContractLine[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }
    const knex = this.knex;
    if (!knex) {
      throw new Error("Database connection not initialized");
    }

    const db = tenantDb(knex, this.tenant);
    const client = await db
      .table("clients")
      .where({
        client_id: clientId,
        tenant: this.tenant,
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    console.log(
      `[BillingEngine] Loading contract lines for client ${clientId}, period: ${billingPeriod.startDate} to ${billingPeriod.endDate}`,
    );

    // Query contract lines via client-owned client_contracts -> contracts -> contract_lines.
    // template_contract_id is provenance for draft/review flows only; live billing must
    // read the cloned lines from cc.contract_id.
    const clientContractLinesQuery = db.table<any>("client_contracts as cc");
    db.tenantJoin(
      clientContractLinesQuery,
      "contracts as c",
      "c.contract_id",
      "cc.contract_id",
    );
    db.tenantJoin(
      clientContractLinesQuery,
      "contract_lines as cl",
      "cl.contract_id",
      "c.contract_id",
    );

    const clientContractLines = await clientContractLinesQuery
      .where({
        "cc.client_id": clientId,
        "cc.is_active": true,
        "cc.tenant": this.tenant,
      })
      // [start, end) semantics: a contract starting exactly on period end is not active within the period.
      .where("cc.start_date", "<", billingPeriod.endDate)
      .where(function (this: any) {
        this.where("cc.end_date", ">=", billingPeriod.startDate).orWhereNull(
          "cc.end_date",
        );
      })
      .select(
        // Map to IClientContractLine interface
        "cl.contract_line_id as client_contract_line_id", // Use contract_line_id as the identifier
        "cc.client_id",
        "cl.contract_line_id",
        "cl.service_category",
        "cc.start_date",
        "cc.end_date",
        "cc.is_active",
        "cc.client_contract_id",
        "cc.template_contract_id",
        "c.contract_id",
        "c.contract_name",
        "c.is_system_managed_default",
        "c.currency_code",
        "cl.contract_line_name",
        "cl.contract_line_type",
        "cl.billing_frequency",
        "cl.billing_timing",
        "cl.cadence_owner",
        "cl.custom_rate",
        "cl.enable_proration",
        "cl.location_id",
        knex.raw("cc.tenant as tenant"),
      );

    console.log(
      `[BillingEngine] Found ${clientContractLines.length} contract lines for client ${clientId}:`,
      JSON.stringify(clientContractLines, null, 2),
    );

    // Convert dates from the DB into plain ISO strings and normalize values
    clientContractLines.forEach((plan: any) => {
      plan.start_date = toISODate(toPlainDate(plan.start_date));
      plan.end_date = plan.end_date
        ? toISODate(toPlainDate(plan.end_date))
        : null;

      // Normalize billing_timing default
      plan.billing_timing = (plan.billing_timing ?? "arrears") as
        | "arrears"
        | "advance";
      plan.cadence_owner = resolveCadenceOwner(plan.cadence_owner);
      plan.is_system_managed_default = plan.is_system_managed_default === true;

      // custom_rate is already stored in cents in the database, just parse it
      if (plan.custom_rate !== null && plan.custom_rate !== undefined) {
        const parsedRate =
          typeof plan.custom_rate === "string"
            ? parseFloat(plan.custom_rate)
            : Number(plan.custom_rate);
        plan.custom_rate = Number.isFinite(parsedRate)
          ? Math.round(parsedRate)
          : null;
      }

      // Set defaults for recurring coverage settlement.
      plan.enable_proration = plan.enable_proration ?? false;
    });

    return clientContractLines;
  }

  private async getClientContractLinesAndCycle(
    clientId: string,
    billingPeriod: IBillingPeriod,
  ): Promise<{
    clientContractLines: IClientContractLine[];
    billingCycle: string;
  }> {
    const clientContractLines =
      await this.getClientContractLinesForBillingPeriod(
        clientId,
        billingPeriod,
      );
    const billingCycle = await this.getBillingCycle(
      clientId,
      billingPeriod.startDate,
    );

    return { clientContractLines, billingCycle };
  }

  private async getBillingCycle(
    clientId: string,
    date: ISO8601String = toISODate(Temporal.Now.plainDateISO()),
  ): Promise<string> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const db = tenantDb(this.knex, this.tenant);
    const client = await db
      .table("clients")
      .where({
        client_id: clientId,
        tenant: this.tenant,
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const result = (await db
      .table("client_billing_cycles")
      .where({
        client_id: clientId,
        tenant: this.tenant,
      })
      .where("effective_date", "<=", date)
      .orderBy("effective_date", "desc")
      .first()) as IClientContractLineCycle | undefined;

    if (!result) {
      // Check again for existing cycle to handle race conditions
      const existingCycle = await db
        .table("client_billing_cycles")
        .where({
          client_id: clientId,
          tenant: this.tenant,
        })
        .first();

      if (existingCycle) {
        return existingCycle.billing_cycle;
      }

      try {
        const defaultCycle: Partial<IClientContractLineCycle> = {
          client_id: clientId,
          billing_cycle: "monthly",
          effective_date: "2023-01-01T00:00:00Z",
          tenant: this.tenant,
        };

        await db.table("client_billing_cycles").insert(defaultCycle);
      } catch (error) {
        // If insert fails due to race condition, get the existing record
        const cycle = await db
          .table("client_billing_cycles")
          .where({
            client_id: clientId,
            tenant: this.tenant,
          })
          .first();

        if (!cycle) {
          throw new Error(
            `Failed to create or retrieve billing cycle for client ${clientId} in tenant ${this.tenant}`,
          );
        }

        return cycle.billing_cycle;
      }
      return "monthly" as BillingCycleType;
    }

    return result.billing_cycle as BillingCycleType;
  }

  private async validateBillingPeriod(
    clientId: string,
    startDate: ISO8601String,
    endDate: ISO8601String,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.initKnex();
      if (!this.tenant) {
        return {
          success: false,
          error: "tenant context not found",
        };
      }

      const db = tenantDb(this.knex, this.tenant);
      const client = await db
        .table("clients")
        .where({
          client_id: clientId,
          tenant: this.tenant,
        })
        .first();
      if (!client) {
        return {
          success: false,
          error: `Client ${clientId} not found in tenant ${this.tenant}`,
        };
      }

      const cycles = await db
        .table("client_billing_cycles")
        .where({
          client_id: clientId,
          tenant: this.tenant,
        })
        // [start, end) semantics: a cycle starting exactly on endDate is not inside the period.
        .where("effective_date", "<", endDate)
        .orderBy("effective_date", "asc");

      let currentCycle = null;
      for (const cycle of cycles) {
        const cycleDate = toPlainDate(cycle.effective_date);
        const start = toPlainDate(startDate);
        const end = toPlainDate(endDate);
        if (Temporal.PlainDate.compare(cycleDate, start) <= 0) {
          currentCycle = cycle;
        } else if (
          Temporal.PlainDate.compare(cycleDate, start) > 0 &&
          Temporal.PlainDate.compare(cycleDate, end) < 0
        ) {
          return {
            success: false,
            error: "Invoice period cannot span billing cycle change",
          };
        }
      }

      if (!currentCycle) {
        // If no cycle found, create default monthly cycle
        await this.getBillingCycle(clientId, startDate);
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "Failed to validate billing period",
      };
    }
  }
  /**
   * Preview the fixed-price charge total (pre-tax cents) for each Fixed contract
   * line whose persisted recurring service period settles within the given
   * INVOICE WINDOW, reusing the EXACT path generation uses for persisted
   * recurring timing: getClientContractLinesForBillingPeriod(invoiceWindow) +
   * loadPersistedRecurringTimingSelections + calculateFixedPriceCharges with
   * recurringTimingSelectionSource='persisted'. The recurring due-work listing
   * uses this to show confirmed fixed amounts instead of "calculated at
   * generation".
   *
   * The invoice window — not the service period — is the engine's billing-period
   * axis here: for arrears/advance lines the engine derives the covered service
   * period from the window, and clamps coverage to the line's activity window.
   * Passing the service period directly would shift the derivation by one cycle
   * and zero out coverage for a line's first/last period (its true cause of
   * "calculated at generation" on otherwise-ready fixed rows).
   *
   * Returns a map keyed by BOTH contract_line_id and client_contract_line_id so
   * callers can match on either id. Best-effort: anything not materialized or not
   * priceable is omitted (caller falls back to "calculated at generation").
   *
   * The load phase is batched across the whole window (line details, plan
   * services, pricing schedules, client, tax context) instead of running per
   * line, and `session` carries the window-independent parts across windows in
   * the same request.
   */
  public async previewFixedChargeAmountsForInvoiceWindow(
    clientId: string,
    invoiceWindowStart: ISO8601String,
    invoiceWindowEnd: ISO8601String,
    session?: FixedChargePreviewSession,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    await this.initKnex();
    if (!this.tenant) {
      return result;
    }
    const billingPeriod = {
      tenant: this.tenant,
      startDate: invoiceWindowStart,
      endDate: invoiceWindowEnd,
    } as IBillingPeriod;
    let lines: IClientContractLine[];
    try {
      lines = await this.getClientContractLinesForBillingPeriod(
        clientId,
        billingPeriod,
      );
    } catch {
      return result;
    }
    let persistedSelections: RecurringChargeTimingSelections | null;
    try {
      persistedSelections = await this.loadPersistedRecurringTimingSelections(
        billingPeriod,
        lines,
      );
    } catch {
      return result;
    }
    if (!persistedSelections) {
      // Service periods are not materialized for this window; defer to generation.
      return result;
    }

    const dueFixedLines = lines.filter(
      (line) =>
        String(line.contract_line_type ?? "").toLowerCase() === "fixed" &&
        Boolean(persistedSelections![line.client_contract_line_id]),
    );
    if (dueFixedLines.length === 0) {
      return result;
    }

    let priceableLines: IClientContractLine[];
    let staticInputsByLineId: Map<string, FixedChargeLineStaticInputs>;
    try {
      staticInputsByLineId = await this.loadFixedChargeLineStaticInputs(
        dueFixedLines,
        session,
      );
      priceableLines = dueFixedLines.filter(
        (line) =>
          staticInputsByLineId.get(line.client_contract_line_id)?.unpriceable ===
          false,
      );
    } catch {
      return result;
    }
    if (priceableLines.length === 0) {
      return result;
    }

    let client: IClient;
    let pricingSchedulesByContractId: Map<string, any[]>;
    let taxContext: ChargeComputeTaxContext;
    try {
      const db = tenantDb(this.knex, this.tenant);
      client = (await db
        .table("clients")
        .where({ client_id: clientId, tenant: this.tenant })
        .first()) as IClient;
      if (!client) {
        return result;
      }
      pricingSchedulesByContractId =
        await this.loadFixedChargePricingSchedules(priceableLines);
      // One tax context for the whole window: the compute layer only reads its
      // own line's location, and the taxable-service probe that provisions
      // default tax settings sees the same services it would have line by line.
      taxContext = await this.loadChargeComputeTaxContext({
        client,
        locationId: null,
        locationIds: priceableLines.map((line) => line.location_id),
        services: priceableLines.flatMap((line) => {
          const inputs = staticInputsByLineId.get(line.client_contract_line_id)!;
          return inputs.fallbackService
            ? [...inputs.planServices, inputs.fallbackService]
            : inputs.planServices;
        }),
      });
    } catch {
      return result;
    }

    for (const line of priceableLines) {
      const selection = persistedSelections[line.client_contract_line_id];
      let charges: IFixedPriceCharge[] = [];
      try {
        charges = await this.calculateFixedPriceCharges(
          clientId,
          billingPeriod,
          line,
          undefined,
          selection,
          "persisted",
          {
            ...staticInputsByLineId.get(line.client_contract_line_id)!,
            client,
            pricingSchedules:
              pricingSchedulesByContractId.get(String(line.contract_id ?? "")) ??
              [],
            taxContext,
          },
        );
      } catch {
        continue;
      }
      if (charges.length === 0) {
        continue;
      }
      const total = charges.reduce(
        (sum, charge) =>
          sum +
          (typeof charge.total === "number" && Number.isFinite(charge.total)
            ? charge.total
            : 0),
        0,
      );
      if (line.contract_line_id) {
        result.set(String(line.contract_line_id), total);
      }
      if (line.client_contract_line_id) {
        result.set(String(line.client_contract_line_id), total);
      }
    }
    return result;
  }

  /**
   * Batched twin of calculateFixedPriceCharges' per-line load phase: contract
   * line details and plan services (plus the product-only fallback service) for
   * every line in one invoice window, in three queries instead of three per
   * line. Lines already resolved in `session` are reused as-is.
   */
  private async loadFixedChargeLineStaticInputs(
    clientContractLines: IClientContractLine[],
    session?: FixedChargePreviewSession,
  ): Promise<Map<string, FixedChargeLineStaticInputs>> {
    const staticInputsByLineId = new Map<string, FixedChargeLineStaticInputs>();
    const pendingLines: IClientContractLine[] = [];
    for (const line of clientContractLines) {
      const cached = session?.get(line.client_contract_line_id);
      if (cached) {
        staticInputsByLineId.set(line.client_contract_line_id, cached);
        continue;
      }
      pendingLines.push(line);
    }
    if (pendingLines.length === 0) {
      return staticInputsByLineId;
    }

    const db = tenantDb(this.knex, this.tenant!);
    const detailIds = [
      ...new Set(
        pendingLines
          .map((line) => line.contract_line_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const serviceLineIds = [
      ...new Set(pendingLines.map((line) => line.client_contract_line_id)),
    ];

    const detailRows =
      detailIds.length > 0
        ? await db
            .table("contract_lines")
            .where({ tenant: this.tenant })
            .whereIn("contract_line_id", detailIds)
        : [];
    const detailsByLineId = new Map(
      detailRows.map((row: any) => [row.contract_line_id, row]),
    );

    const planServicesQuery = db.table<any>("contract_line_services as cls");
    db.tenantJoin(
      planServicesQuery,
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
      planServicesQuery,
      "contract_line_service_fixed_config as clsfc",
      "clsfc.config_id",
      "clsc.config_id",
      { type: "left" },
    );
    db.tenantJoin(
      planServicesQuery,
      "service_catalog as sc",
      "sc.service_id",
      "cls.service_id",
    );

    const planServiceRows = await planServicesQuery
      .whereIn("cls.contract_line_id", serviceLineIds)
      .where({
        "cls.tenant": this.tenant,
        "clsc.configuration_type": "Fixed",
      })
      .whereNot("sc.item_kind", "product")
      .select(
        "cls.contract_line_id as batched_contract_line_id",
        "sc.service_id",
        "sc.service_name",
        "sc.default_rate",
        "sc.tax_rate_id",
        "cls.quantity as service_quantity",
        "cls.custom_rate as service_line_custom_rate",
        "clsc.quantity as configuration_quantity",
        "clsc.custom_rate as configuration_custom_rate",
        "clsc.config_id",
        "clsfc.base_rate as service_base_rate",
      );

    const planServicesByLineId = new Map<string, any[]>();
    for (const row of planServiceRows) {
      const { batched_contract_line_id: lineId, ...planService } = row as any;
      const planServices = planServicesByLineId.get(lineId) ?? [];
      planServices.push(planService);
      planServicesByLineId.set(lineId, planServices);
    }

    const fallbackLineIds = serviceLineIds.filter(
      (lineId) => (planServicesByLineId.get(lineId) ?? []).length === 0,
    );
    const fallbackServiceByLineId = new Map<string, any>();
    if (fallbackLineIds.length > 0) {
      const fallbackServiceQuery = db.table<any>(
        "contract_line_services as cls_fallback",
      );
      db.tenantJoin(
        fallbackServiceQuery,
        "contract_line_service_configuration as clsc_fallback",
        "clsc_fallback.contract_line_id",
        "cls_fallback.contract_line_id",
        {
          on(join) {
            join.andOn(
              "clsc_fallback.service_id",
              "=",
              "cls_fallback.service_id",
            );
          },
        },
      );
      db.tenantJoin(
        fallbackServiceQuery,
        "service_catalog as sc",
        "sc.service_id",
        "cls_fallback.service_id",
      );

      const fallbackRows = await fallbackServiceQuery
        .whereIn("cls_fallback.contract_line_id", fallbackLineIds)
        .where({ "cls_fallback.tenant": this.tenant })
        .whereNot("sc.item_kind", "product")
        .orderBy("sc.service_id", "asc")
        .select(
          "cls_fallback.contract_line_id as batched_contract_line_id",
          "sc.service_id",
          "sc.service_name",
          "sc.tax_rate_id",
          "clsc_fallback.config_id",
        );

      for (const row of fallbackRows) {
        const { batched_contract_line_id: lineId, ...fallbackService } =
          row as any;
        // Rows arrive ordered by service_id, so the first per line matches the
        // per-line query's `.orderBy(service_id).first()`.
        if (!fallbackServiceByLineId.has(lineId)) {
          fallbackServiceByLineId.set(lineId, fallbackService);
        }
      }
    }

    for (const line of pendingLines) {
      const contractLineDetails = line.contract_line_id
        ? detailsByLineId.get(line.contract_line_id)
        : undefined;
      const planServices =
        planServicesByLineId.get(line.client_contract_line_id) ?? [];
      const staticInputs: FixedChargeLineStaticInputs = {
        contractLineDetails,
        planServices,
        fallbackService:
          planServices.length === 0
            ? (fallbackServiceByLineId.get(line.client_contract_line_id) ?? null)
            : null,
        unpriceable: isFixedLineUnpriceable(
          line,
          contractLineDetails,
          planServices,
        ),
      };
      staticInputsByLineId.set(line.client_contract_line_id, staticInputs);
      session?.set(line.client_contract_line_id, staticInputs);
    }

    return staticInputsByLineId;
  }

  /** Per-line plan services (and product-only fallback) for the generation path. */
  private async queryFixedChargeLineServices(
    clientContractLine: IClientContractLine,
  ): Promise<{ planServices: any[]; fallbackService: any | null }> {
    const db = tenantDb(this.knex, this.tenant!);
    const tenant = this.tenant;

    // Query services from contract_line_services (the contract definition)
    // Note: client_contract_line_id is actually a contract_line_id value (see getClientContractLinesAndCycle)
    const planServicesQuery = db.table<any>("contract_line_services as cls");
    db.tenantJoin(
      planServicesQuery,
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
      planServicesQuery,
      "contract_line_service_fixed_config as clsfc",
      "clsfc.config_id",
      "clsc.config_id",
      { type: "left" },
    );
    db.tenantJoin(
      planServicesQuery,
      "service_catalog as sc",
      "sc.service_id",
      "cls.service_id",
    );

    const planServices = await planServicesQuery
      .where({
        "cls.contract_line_id": clientContractLine.client_contract_line_id,
        "cls.tenant": tenant,
        "clsc.configuration_type": "Fixed",
      })
      .whereNot("sc.item_kind", "product")
      .select(
        "sc.service_id",
        "sc.service_name",
        "sc.default_rate",
        "sc.tax_rate_id",
        "cls.quantity as service_quantity",
        "cls.custom_rate as service_line_custom_rate",
        "clsc.quantity as configuration_quantity",
        "clsc.custom_rate as configuration_custom_rate",
        "clsc.config_id",
        "clsfc.base_rate as service_base_rate",
        // Note: enable_proration is on contract_lines, not service config
      );

    let fallbackService = null;
    if (planServices.length === 0) {
      // config_id lives on contract_line_service_configuration, not on
      // contract_line_services; selecting it from cls_fallback raised
      // "column cls_fallback.config_id does not exist" and aborted billing
      // for any fixed line whose catalog items are all products/licenses.
      const fallbackServiceQuery = db.table<any>(
        "contract_line_services as cls_fallback",
      );
      db.tenantJoin(
        fallbackServiceQuery,
        "contract_line_service_configuration as clsc_fallback",
        "clsc_fallback.contract_line_id",
        "cls_fallback.contract_line_id",
        {
          on(join) {
            join.andOn(
              "clsc_fallback.service_id",
              "=",
              "cls_fallback.service_id",
            );
          },
        },
      );
      db.tenantJoin(
        fallbackServiceQuery,
        "service_catalog as sc",
        "sc.service_id",
        "cls_fallback.service_id",
      );

      fallbackService =
        (await fallbackServiceQuery
          .where({
            "cls_fallback.contract_line_id":
              clientContractLine.client_contract_line_id,
            "cls_fallback.tenant": tenant,
          })
          .whereNot("sc.item_kind", "product")
          .orderBy("sc.service_id", "asc")
          .first(
            "sc.service_id",
            "sc.service_name",
            "sc.tax_rate_id",
            "clsc_fallback.config_id",
          )) ?? null;
    }

    return { planServices, fallbackService };
  }

  /** Load every pricing schedule for the window's contracts in one query. */
  private async loadFixedChargePricingSchedules(
    clientContractLines: IClientContractLine[],
  ): Promise<Map<string, any[]>> {
    const schedulesByContractId = new Map<string, any[]>();
    const contractIds = [
      ...new Set(
        clientContractLines
          .map((line) => line.contract_id)
          .filter((contractId): contractId is string => Boolean(contractId)),
      ),
    ];
    if (contractIds.length === 0) {
      return schedulesByContractId;
    }

    try {
      const db = tenantDb(this.knex, this.tenant!);
      const scheduleRows = await db
        .table("contract_pricing_schedules")
        .where({ tenant: this.tenant })
        .whereIn("contract_id", contractIds)
        .orderBy("effective_date", "desc");
      for (const row of scheduleRows as any[]) {
        const schedules = schedulesByContractId.get(row.contract_id) ?? [];
        schedules.push(row);
        schedulesByContractId.set(row.contract_id, schedules);
      }
    } catch (error) {
      console.warn(
        `[PRICING_SCHEDULE] Error loading pricing schedules for contracts ${contractIds.join(", ")}:`,
        error,
      );
    }

    return schedulesByContractId;
  }

  private async calculateFixedPriceCharges(
    clientId: string,
    billingPeriod: IBillingPeriod,
    clientContractLine: IClientContractLine,
    billingCycle?: string,
    recurringTimingSelection?: ResolvedRecurringChargeTiming,
    recurringTimingSelectionSource?: CalculateBillingOptions["recurringTimingSelectionSource"],
    /** Batched load-phase rows; when absent every row is queried per line. */
    preloaded?: PreloadedFixedChargeInputs,
  ): Promise<IFixedPriceCharge[]> {
    // Note: Fixed plan rates are stored as dollars (decimal) in the database,
    // but need to be converted to cents (integer) for consistency with other monetary values in the system.
    // Custom contract-level rates are assumed to be in cents already.
    // Load phase only: gather the rows the pure compute layer needs, then
    // delegate the charge math to computeFixedCharges (lib/billing/compute/).
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }
    const db = tenantDb(this.knex, this.tenant);

    const resolvedBillingCycle =
      billingCycle ??
      (!recurringTimingSelection &&
      recurringTimingSelectionSource !== "persisted"
        ? await this.getBillingCycle(clientId, billingPeriod.startDate)
        : undefined);

    const timingResolution = this.resolveFixedRecurringChargeTiming(
      billingPeriod,
      clientContractLine,
      resolvedBillingCycle,
      recurringTimingSelection,
      recurringTimingSelectionSource,
    );
    if (!timingResolution) {
      return [];
    }

    const {
      servicePeriodStart,
      servicePeriodEnd,
      servicePeriodStartExclusive,
      servicePeriodEndExclusive,
    } = timingResolution;

    // --- Custom Rate Check (Contracts & Pricing Schedules) ---
    // Check if a custom rate is defined for this plan assignment (provided via contract association)
    // or if an active pricing schedule overrides the rate for this billing period.
    // Pricing schedules take precedence over contract-level custom rates.
    // Ensure custom_rate is not null and not undefined before using it.

    let effectiveCustomRate = clientContractLine.custom_rate;
    let customRateSource: "pricing_schedule" | "assignment" | null =
      effectiveCustomRate !== null && effectiveCustomRate !== undefined
        ? "assignment"
        : null;

    // Check for an active pricing schedule that overlaps the due service period.
    if (clientContractLine.contract_id) {
      try {
        const activePricingSchedule = preloaded
          ? selectActivePricingSchedule(
              preloaded.pricingSchedules,
              servicePeriodStartExclusive,
              servicePeriodEndExclusive,
            )
          : await db
              .table("contract_pricing_schedules")
              .where({
                tenant: this.tenant,
                contract_id: clientContractLine.contract_id,
              })
              // [start, end) semantics: schedule starting exactly on service-period end does not apply.
              .where("effective_date", "<", servicePeriodEndExclusive)
              .where(function (builder) {
                builder
                  .whereNull("end_date")
                  .orWhere("end_date", ">", servicePeriodStartExclusive);
              })
              .orderBy("effective_date", "desc")
              .first();

        if (
          activePricingSchedule &&
          activePricingSchedule.custom_rate !== null &&
          activePricingSchedule.custom_rate !== undefined
        ) {
          effectiveCustomRate = activePricingSchedule.custom_rate;
          customRateSource = "pricing_schedule";
          console.log(
            `[PRICING_SCHEDULE] Using pricing schedule rate ${activePricingSchedule.custom_rate} cents for contract ${clientContractLine.contract_id} during service period ${servicePeriodStart} to ${servicePeriodEnd}. Schedule ID: ${activePricingSchedule.schedule_id}`,
          );
        }
      } catch (error) {
        console.warn(
          `[PRICING_SCHEDULE] Error checking for active pricing schedule for contract ${clientContractLine.contract_id}:`,
          error,
        );
      }
    }

    const client =
      preloaded?.client ??
      ((await db
        .table("clients")
        .where({
          client_id: clientId,
          tenant: this.tenant,
        })
        .first()) as IClient);

    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    // Get the contract line details to determine if this is a fixed fee plan
    const contractLineDetails = preloaded
      ? preloaded.contractLineDetails
      : await db
          .table("contract_lines")
          .where({
            contract_line_id: clientContractLine.contract_line_id,
            tenant: client.tenant,
          })
          .first();

    const { planServices, fallbackService } =
      preloaded ?? (await this.queryFixedChargeLineServices(clientContractLine));

    const { charges, advanceGuard } = await computeFixedCharges(
      {
        clientId,
        billingPeriod,
        clientContractLine,
        timing: timingResolution,
        client,
        contractLineDetails,
        effectiveCustomRate,
        customRateSource,
        planServices,
        fallbackService,
      },
      preloaded?.taxContext ??
        (await this.loadChargeComputeTaxContext({
          client,
          locationId: clientContractLine.location_id,
          services: fallbackService
            ? [...planServices, fallbackService]
            : planServices,
        })),
    );

    if (advanceGuard) {
      const existingAdvance = await this.hasExistingServicePeriodCharge(
        clientContractLine.client_contract_line_id,
        advanceGuard.servicePeriodStart,
        advanceGuard.servicePeriodEnd,
        "advance",
      );
      if (existingAdvance) {
        console.log(
          `[BillingEngine] Skipping advance billing for contract line ${clientContractLine.contract_line_id}: charge already persisted for service period`,
        );
        return [];
      }
    }

    return charges;
  }

  private resolveFixedRecurringChargeTiming(
    billingPeriod: IBillingPeriod,
    clientContractLine: IClientContractLine,
    billingCycle?: string,
    recurringTimingSelection?: ResolvedRecurringChargeTiming,
    recurringTimingSelectionSource?: CalculateBillingOptions["recurringTimingSelectionSource"],
  ): ResolvedRecurringChargeTiming | null {
    return this.resolveRecurringChargeTiming(
      billingPeriod,
      clientContractLine,
      billingCycle,
      recurringTimingSelection,
      recurringTimingSelectionSource,
    );
  }

  private resolveRecurringChargeTiming(
    billingPeriod: IBillingPeriod,
    clientContractLine: IClientContractLine,
    billingCycle?: string,
    recurringTimingSelection?: ResolvedRecurringChargeTiming,
    recurringTimingSelectionSource?: CalculateBillingOptions["recurringTimingSelectionSource"],
  ): ResolvedRecurringChargeTiming | null {
    if (recurringTimingSelection) {
      return recurringTimingSelection;
    }
    if (recurringTimingSelectionSource === "persisted") {
      return null;
    }
    if (!billingCycle) {
      throw new Error(
        "Billing cycle source rule is required when deriving recurring timing outside persisted service periods",
      );
    }
    return this.buildRecurringChargeTimingSelection(
      billingPeriod,
      clientContractLine,
      billingCycle,
    );
  }

  private resolveServiceDrivenChargeTiming(
    billingPeriod: IBillingPeriod,
    clientContractLine: IClientContractLine,
    billingCycle: string | undefined,
    recurringTimingSelection?: ResolvedRecurringChargeTiming,
    recurringTimingSelectionSource?: CalculateBillingOptions["recurringTimingSelectionSource"],
  ): ResolvedRecurringChargeTiming | null {
    if (recurringTimingSelection) {
      return recurringTimingSelection;
    }
    if (recurringTimingSelectionSource === "persisted") {
      return null;
    }
    if (!billingCycle) {
      throw new Error(
        "Billing cycle source rule is required when deriving recurring timing outside persisted service periods",
      );
    }

    return this.buildRecurringChargeTimingSelection(
      billingPeriod,
      clientContractLine,
      billingCycle,
    );
  }

  private buildRecurringTimingSelections(
    billingPeriod: IBillingPeriod,
    clientContractLines: IClientContractLine[],
    billingCycle: string,
  ): RecurringChargeTimingSelections {
    const recurringTimingSelections: RecurringChargeTimingSelections = {};

    for (const clientContractLine of [...clientContractLines].sort(
      (left, right) =>
        left.client_contract_line_id.localeCompare(
          right.client_contract_line_id,
        ),
    )) {
      if (!this.isRecurringTimingEligibleContractLine(clientContractLine)) {
        continue;
      }
      const timingSelection = this.buildRecurringChargeTimingSelection(
        billingPeriod,
        clientContractLine,
        billingCycle,
      );
      if (!timingSelection) {
        continue;
      }
      recurringTimingSelections[clientContractLine.client_contract_line_id] =
        timingSelection;
    }

    return recurringTimingSelections;
  }

  private buildRecurringTimingSelectionsFromPersistedRecords(
    records: PersistedRecurringTimingSelectionRecord[],
  ): RecurringChargeTimingSelections {
    const recurringTimingSelections: RecurringChargeTimingSelections = {};

    for (const record of records) {
      const lineId = record.sourceObligation.obligationId;
      if (recurringTimingSelections[lineId]) {
        throw new Error(
          `${RECURRING_TIMING_ROLLOUT_GUARD_PREFIX}: ${lineId}: multiple persisted due periods matched one runtime obligation`,
        );
      }

      const coveragePeriod =
        record.activityWindow?.start && record.activityWindow?.end
          ? {
              start: record.activityWindow.start,
              end: record.activityWindow.end,
            }
          : {
              start: record.servicePeriod.start,
              end: record.servicePeriod.end,
            };

      const coverage = calculateServicePeriodCoverage(
        {
          kind: "service_period",
          cadenceOwner: record.cadenceOwner,
          duePosition: record.duePosition,
          sourceObligation: record.sourceObligation,
          start: record.servicePeriod.start,
          end: record.servicePeriod.end,
          semantics: RECURRING_RANGE_SEMANTICS,
        },
        coveragePeriod,
      );

      recurringTimingSelections[lineId] = {
        servicePeriodRecordId: record.recordId,
        duePosition: record.duePosition,
        servicePeriodStart: toISODate(
          toPlainDate(coverage.coveredPeriod.start),
        ),
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

    return recurringTimingSelections;
  }

  private assertPersistedRecurringTimingSelectionsReferenceEligibleLines(
    clientContractLines: IClientContractLine[],
    providedSelections: RecurringChargeTimingSelections,
  ): RecurringChargeTimingSelections {
    const eligibleLineIds = new Set(
      clientContractLines.map((line) => line.client_contract_line_id),
    );
    const unexpectedSelections = Object.keys(providedSelections)
      .filter((lineId) => !eligibleLineIds.has(lineId))
      .sort();

    if (unexpectedSelections.length > 0) {
      throw new Error(
        `${RECURRING_TIMING_ROLLOUT_GUARD_PREFIX}: ${unexpectedSelections
          .map((lineId) => `${lineId}: unexpected persisted selection`)
          .join("; ")}`,
      );
    }

    return providedSelections;
  }

  private assertRecurringTimingSelectionsMatchCanonical(
    canonicalSelections: RecurringChargeTimingSelections,
    providedSelections: RecurringChargeTimingSelections,
  ): RecurringChargeTimingSelections {
    const mismatches: string[] = [];
    const lineIds = Array.from(
      new Set([
        ...Object.keys(canonicalSelections),
        ...Object.keys(providedSelections),
      ]),
    ).sort();

    for (const lineId of lineIds) {
      const canonical = canonicalSelections[lineId];
      const provided = providedSelections[lineId];

      if (!canonical) {
        mismatches.push(`${lineId}: unexpected external selection`);
        continue;
      }

      if (!provided) {
        mismatches.push(`${lineId}: missing canonical selection`);
        continue;
      }

      if (!this.areRecurringChargeTimingsEquivalent(canonical, provided)) {
        mismatches.push(`${lineId}: selection diverged from canonical timing`);
      }
    }

    if (mismatches.length > 0) {
      throw new Error(
        `${RECURRING_TIMING_ROLLOUT_GUARD_PREFIX}: ${mismatches.join("; ")}`,
      );
    }

    return providedSelections;
  }

  private areRecurringChargeTimingsEquivalent(
    left: ResolvedRecurringChargeTiming,
    right: ResolvedRecurringChargeTiming,
  ): boolean {
    return (
      left.duePosition === right.duePosition &&
      left.servicePeriodStart === right.servicePeriodStart &&
      left.servicePeriodEnd === right.servicePeriodEnd &&
      left.servicePeriodStartExclusive === right.servicePeriodStartExclusive &&
      left.servicePeriodEndExclusive === right.servicePeriodEndExclusive &&
      Math.abs(left.coverageRatio - right.coverageRatio) < 1e-9
    );
  }

  private isRecurringTimingEligibleContractLine(
    clientContractLine: IClientContractLine & {
      contract_line_type?: "Fixed" | "Hourly" | "Usage" | string | null;
    },
  ): boolean {
    return (
      clientContractLine.contract_line_type !== "Hourly" &&
      clientContractLine.contract_line_type !== "Usage"
    );
  }

  private buildRecurringChargeTimingSelection(
    billingPeriod: IBillingPeriod,
    clientContractLine: IClientContractLine,
    billingCycle: string,
  ): ResolvedRecurringChargeTiming | null {
    const duePosition = (clientContractLine.billing_timing ?? "arrears") as
      | "arrears"
      | "advance";
    const currentStart = toISODate(toPlainDate(billingPeriod.startDate));
    const currentEndExclusive = toISODate(toPlainDate(billingPeriod.endDate));
    const isSystemManagedDefault =
      (clientContractLine as { is_system_managed_default?: boolean | null })
        .is_system_managed_default === true;
    const cadenceOwner = isSystemManagedDefault
      ? "client"
      : resolveCadenceOwner(clientContractLine.cadence_owner);
    const sourceObligation = buildClientCadencePostDropObligationRef({
      contractLineId: clientContractLine.client_contract_line_id,
      chargeFamily: "fixed",
      tenant: this.tenant ?? undefined,
    });
    const activityWindow = {
      start: clientContractLine.start_date
        ? toISODate(toPlainDate(clientContractLine.start_date))
        : undefined,
      end: clientContractLine.end_date
        ? toISODate(toPlainDate(clientContractLine.end_date).add({ days: 1 }))
        : undefined,
      semantics: RECURRING_RANGE_SEMANTICS,
    };

    const settlements =
      cadenceOwner === "contract"
        ? this.resolveContractCadenceSettlementsForInvoiceWindow({
            billingPeriod,
            clientContractLine,
            duePosition,
            sourceObligation,
            activityWindow,
            invoiceWindow: {
              kind: "invoice_window",
              cadenceOwner: "contract",
              duePosition,
              start: currentStart,
              end: currentEndExclusive,
              semantics: RECURRING_RANGE_SEMANTICS,
            },
          })
        : resolveRecurringSettlementsForInvoiceWindow({
            servicePeriods: [
              {
                kind: "service_period",
                cadenceOwner,
                duePosition,
                sourceObligation,
                start: this.getPreviousRecurringBoundaryStart(
                  currentStart,
                  currentEndExclusive,
                  billingCycle,
                ),
                end: currentStart,
                semantics: RECURRING_RANGE_SEMANTICS,
              },
              {
                kind: "service_period",
                cadenceOwner,
                duePosition,
                sourceObligation,
                start: currentStart,
                end: currentEndExclusive,
                semantics: RECURRING_RANGE_SEMANTICS,
              },
            ],
            invoiceWindow: {
              kind: "invoice_window",
              cadenceOwner,
              duePosition,
              start: currentStart,
              end: currentEndExclusive,
              semantics: RECURRING_RANGE_SEMANTICS,
            },
            activityWindow,
            duePosition,
          });

    const settlement = settlements[0];
    if (!settlement) {
      return null;
    }

    return {
      servicePeriodRecordId: null,
      duePosition,
      servicePeriodStart: toISODate(
        toPlainDate(settlement.coveredServicePeriod.start),
      ),
      servicePeriodEnd: toISODate(
        toPlainDate(settlement.coveredServicePeriod.end).subtract({ days: 1 }),
      ),
      servicePeriodStartExclusive: toISODate(
        toPlainDate(settlement.coveredServicePeriod.start),
      ),
      servicePeriodEndExclusive: toISODate(
        toPlainDate(settlement.coveredServicePeriod.end),
      ),
      coverageRatio: settlement.coverage.coverageRatio,
    };
  }

  private getPreviousRecurringBoundaryStart(
    currentStart: ISO8601String,
    currentEndExclusive: ISO8601String,
    billingCycle: string,
  ): ISO8601String {
    const currentStartDate = toPlainDate(currentStart);

    switch (billingCycle) {
      case "weekly":
        return toISODate(currentStartDate.subtract({ days: 7 }));
      case "bi-weekly":
        return toISODate(currentStartDate.subtract({ days: 14 }));
      case "monthly":
        return toISODate(currentStartDate.subtract({ months: 1 }));
      case "quarterly":
        return toISODate(currentStartDate.subtract({ months: 3 }));
      case "semi-annually":
        return toISODate(currentStartDate.subtract({ months: 6 }));
      case "annually":
        return toISODate(currentStartDate.subtract({ years: 1 }));
      default:
        return toISODate(
          currentStartDate.subtract({
            days: Math.max(
              toPlainDate(currentStart).until(
                toPlainDate(currentEndExclusive),
                { largestUnit: "days" },
              ).days,
              1,
            ),
          }),
        );
    }
  }

  private resolveContractCadenceSettlementsForInvoiceWindow(input: {
    billingPeriod: IBillingPeriod;
    clientContractLine: IClientContractLine;
    duePosition: "arrears" | "advance";
    sourceObligation: IRecurringObligationRef;
    activityWindow: {
      start?: ISO8601String;
      end?: ISO8601String;
      semantics: typeof RECURRING_RANGE_SEMANTICS;
    };
    invoiceWindow: {
      kind: "invoice_window";
      cadenceOwner: "contract";
      duePosition: "arrears" | "advance";
      start: ISO8601String;
      end: ISO8601String;
      semantics: typeof RECURRING_RANGE_SEMANTICS;
    };
  }) {
    const contractCadence = this.getContractCadenceDefinition(
      input.clientContractLine.billing_frequency,
    );

    if (!contractCadence) {
      throw new Error(
        `Unsupported contract cadence frequency "${input.clientContractLine.billing_frequency ?? "unknown"}" for contract line ${input.clientContractLine.client_contract_line_id}`,
      );
    }

    const anchorDate = resolveContractCadenceAnchorDate({
      assignmentStartDate: toISOTimestamp(
        toPlainDate(input.clientContractLine.start_date),
      ),
    });
    const rangeStart = toISOTimestamp(
      toPlainDate(input.billingPeriod.startDate).subtract({
        months: contractCadence.monthsPerPeriod,
      }),
    );
    const rangeEnd = toISOTimestamp(
      toPlainDate(input.billingPeriod.endDate).add({
        months: contractCadence.monthsPerPeriod,
      }),
    );
    const servicePeriods = contractCadence
      .generator({
        rangeStart,
        rangeEnd,
        sourceObligation: input.sourceObligation,
        duePosition: input.duePosition,
        anchorDate,
      })
      .filter((servicePeriod: IRecurringServicePeriod) => {
        const contractInvoiceWindow =
          resolveContractCadenceInvoiceWindowForServicePeriod({
            servicePeriod,
            anchorDate,
            monthsPerPeriod: contractCadence.monthsPerPeriod,
          });

        return (
          toISODate(toPlainDate(contractInvoiceWindow.start)) ===
            input.invoiceWindow.start &&
          toISODate(toPlainDate(contractInvoiceWindow.end)) ===
            input.invoiceWindow.end
        );
      });

    if (servicePeriods.length > 1) {
      throw new Error(
        `Contract cadence produced multiple due service periods for one invoice window on contract line ${input.clientContractLine.client_contract_line_id}`,
      );
    }

    return resolveRecurringSettlementsForInvoiceWindow({
      servicePeriods,
      invoiceWindow: input.invoiceWindow,
      activityWindow: input.activityWindow,
      duePosition: input.duePosition,
    });
  }

  private getContractCadenceDefinition(
    billingFrequency?: string | null,
  ): { monthsPerPeriod: number; generator: ContractCadenceGenerator } | null {
    switch (billingFrequency) {
      case "monthly":
        return {
          monthsPerPeriod: 1,
          generator: generateMonthlyContractCadenceServicePeriods,
        };
      case "quarterly":
        return {
          monthsPerPeriod: 3,
          generator: generateQuarterlyContractCadenceServicePeriods,
        };
      case "semi-annually":
        return {
          monthsPerPeriod: 6,
          generator: generateSemiAnnualContractCadenceServicePeriods,
        };
      case "annually":
        return {
          monthsPerPeriod: 12,
          generator: generateAnnualContractCadenceServicePeriods,
        };
      default:
        return null;
    }
  }

  private async calculateTimeBasedCharges(
    clientId: string,
    billingPeriod: IBillingPeriod,
    clientContractLine: IClientContractLine,
    billingCycle?: string,
    recurringTimingSelection?: ResolvedRecurringChargeTiming,
    recurringTimingSelectionSource?: CalculateBillingOptions["recurringTimingSelectionSource"],
    projectBillingContext?: ProjectBillingContext | null,
    projectTarget?: CalculateBillingOptions["projectTarget"],
  ): Promise<ITimeBasedCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const db = tenantDb(this.knex, this.tenant);
    const client = await db
      .table("clients")
      .where({
        client_id: clientId,
        tenant: this.tenant,
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    // Fetch the contract line details to get plan-wide settings
    const plan = await db
      .table("contract_lines")
      .where({
        contract_line_id: clientContractLine.contract_line_id,
        tenant: this.tenant,
      })
      .first();

    if (!plan) {
      throw new Error(
        `Contract Line ${clientContractLine.contract_line_id} not found for client ${clientId}`,
      );
    }

    const tenant = this.tenant; // Capture tenant value for joins
    const knexRef = this.knex; // Closure-friendly knex reference for join callbacks
    const contractCurrency = clientContractLine.currency_code || "USD";
    const clientConfigService = new ClientContractServiceConfigurationService(
      this.knex,
      tenant,
    );
    const clientServiceConfigs =
      await clientConfigService.getConfigurationsForClientContractLine(
        clientContractLine.client_contract_line_id,
      );

    const resolvedBillingCycle =
      billingCycle ??
      (!projectTarget &&
      !recurringTimingSelection &&
      recurringTimingSelectionSource !== "persisted"
        ? await this.getBillingCycle(clientId, billingPeriod.startDate)
        : undefined);

    const timingResolution: ResolvedRecurringChargeTiming | null = projectTarget
      ? {
          // Project-driven billing is not cadence-driven: there is no persisted
          // recurring service period record backing these charges.
          servicePeriodRecordId: null,
          duePosition: "arrears",
          servicePeriodStart: billingPeriod.startDate,
          servicePeriodEnd: billingPeriod.endDate,
          servicePeriodStartExclusive: billingPeriod.startDate,
          servicePeriodEndExclusive: billingPeriod.endDate,
          coverageRatio: 1,
        }
      : this.resolveServiceDrivenChargeTiming(
          billingPeriod,
          clientContractLine,
          resolvedBillingCycle,
          recurringTimingSelection,
          recurringTimingSelectionSource,
        );
    if (!timingResolution) {
      return [];
    }

    const servicePeriodStartExclusive =
      timingResolution.servicePeriodStartExclusive;
    const servicePeriodEndExclusive =
      timingResolution.servicePeriodEndExclusive;

    // Create a map of service IDs to their hourly configurations
    const serviceConfigMap = new Map<
      string,
      {
        config: IContractLineServiceConfiguration &
          IContractLineServiceHourlyConfig;
        userTypeRates: Map<string, number>;
      }
    >();

    for (const configDetails of clientServiceConfigs) {
      if (configDetails.baseConfig.configuration_type !== "Hourly") {
        continue;
      }
      const hourlyDetails = configDetails.typeConfig as
        | (IContractLineServiceHourlyConfig & { hourly_rate?: number | null })
        | null;
      if (!hourlyDetails) {
        continue;
      }

      const userTypeRates = configDetails.userTypeRates ?? [];
      const userRateMap = new Map<string, number>();
      for (const rate of userTypeRates) {
        userRateMap.set(rate.user_type, rate.rate);
      }

      const combinedConfig = {
        config_id: configDetails.baseConfig.config_id,
        contract_line_id: clientContractLine.contract_line_id,
        service_id: configDetails.serviceId,
        configuration_type: "Hourly",
        quantity: configDetails.baseConfig.quantity ?? null,
        custom_rate: configDetails.baseConfig.custom_rate ?? null,
        hourly_rate:
          hourlyDetails.hourly_rate != null
            ? Number(hourlyDetails.hourly_rate)
            : 0,
        minimum_billable_time: hourlyDetails.minimum_billable_time ?? 0,
        round_up_to_nearest: hourlyDetails.round_up_to_nearest ?? 0,
      } as IContractLineServiceConfiguration & IContractLineServiceHourlyConfig;

      serviceConfigMap.set(configDetails.serviceId, {
        config: combinedConfig,
        userTypeRates: userRateMap,
      });
    }
    let configuredServiceIds = Array.from(serviceConfigMap.keys());
    if (configuredServiceIds.length === 0) {
      configuredServiceIds = await this.getServiceIdsForContractLine(
        clientContractLine.contract_line_id,
      );
    }
    if (configuredServiceIds.length === 0) {
      return [];
    }
    const uniquelyAssignableServiceIds =
      await this.getUniquelyAssignableServiceIdsForLine({
        clientId,
        serviceIds: configuredServiceIds,
        contractLineId: clientContractLine.contract_line_id,
        servicePeriodStartExclusive,
        servicePeriodEndExclusive,
      });

    const query = db.table<any>("time_entries");
    db.tenantJoin(query, "users", "time_entries.user_id", "users.user_id");
    db.tenantJoin(
      query,
      "service_catalog",
      "service_catalog.service_id",
      "time_entries.service_id",
      { type: "left" },
    );
    db.tenantJoin(
      query,
      "service_prices as sp",
      "sp.service_id",
      "service_catalog.service_id",
      {
        type: "left",
        on(join) {
          join.andOn(
            "sp.currency_code",
            "=",
            knexRef.raw("?", [contractCurrency]),
          );
        },
      },
    );
    db.tenantJoin(
      query,
      "project_ticket_links",
      "time_entries.work_item_id",
      "project_ticket_links.ticket_id",
      { type: "left" },
    );
    db.tenantJoin(
      query,
      "project_tasks",
      "time_entries.work_item_id",
      "project_tasks.task_id",
      { type: "left" },
    );
    db.tenantJoin(
      query,
      "project_phases",
      "project_tasks.phase_id",
      "project_phases.phase_id",
      { type: "left" },
    );
    db.tenantJoin(
      query,
      "projects",
      "project_phases.project_id",
      "projects.project_id",
      { type: "left" },
    );
    db.tenantJoin(
      query,
      "tickets",
      "time_entries.work_item_id",
      "tickets.ticket_id",
      { type: "left" },
    );

    query
      .where({
        "time_entries.tenant": client.tenant,
      })
      .where("time_entries.invoiced", false)
      .whereIn("time_entries.service_id", configuredServiceIds)
      .where("time_entries.billable_duration", ">", 0)
      .where(function (this: Knex.QueryBuilder) {
        // Either the time entry has the specific contract line ID (use contract_line_id for contract associations)
        this.where(
          "time_entries.contract_line_id",
          clientContractLine.contract_line_id,
        );
        if (uniquelyAssignableServiceIds.length > 0) {
          // Unassigned time is allocatable only when service-to-line matching is unique.
          this.orWhere(function (this: Knex.QueryBuilder) {
            this.whereNull("time_entries.contract_line_id").whereIn(
              "time_entries.service_id",
              uniquelyAssignableServiceIds,
            );
          });
        }
      })
      .where(function (this: Knex.QueryBuilder) {
        this.where(function (this: Knex.QueryBuilder) {
          this.where(
            "time_entries.work_item_type",
            "=",
            "project_task",
          ).whereNotNull("project_tasks.task_id");
        }).orWhere(function (this: Knex.QueryBuilder) {
          this.where("time_entries.work_item_type", "=", "ticket").whereNotNull(
            "tickets.ticket_id",
          );
        });
      })
      .where(function (this: Knex.QueryBuilder) {
        this.where("projects.client_id", clientId).orWhere(
          "tickets.client_id",
          clientId,
        );
      })
      .where("time_entries.approval_status", "APPROVED");

    if (projectTarget) {
      query.where("projects.project_id", projectTarget.projectId);
    } else {
      query
        .where("time_entries.start_time", ">=", servicePeriodStartExclusive)
        .where("time_entries.end_time", "<", servicePeriodEndExclusive);
    }

    const fixedPriceProjectIds =
      projectBillingContext?.configs
        .filter((config) => config.billing_model === "fixed_price")
        .map((config) => config.project_id) ?? [];
    if (fixedPriceProjectIds.length > 0) {
      query.where(function (this: Knex.QueryBuilder) {
        this.whereNull("projects.project_id").orWhereNotIn(
          "projects.project_id",
          fixedPriceProjectIds,
        );
      });
    }

    query.select(
      "time_entries.*",
      "service_catalog.service_name",
      "service_catalog.default_rate",
      "service_catalog.tax_rate_id",
      "sp.rate as currency_rate",
      this.knex.raw(
        "COALESCE(project_tasks.task_name, tickets.title) as work_item_name",
      ),
      "project_phases.phase_id as project_phase_id",
      "projects.project_id as project_id",
    );

    const timeEntries = await query;

    const { charges } = await computeTimeBasedCharges(
      {
        billingPeriod,
        clientContractLine,
        timing: timingResolution,
        client,
        plan: {
          enable_overtime: plan.enable_overtime,
          overtime_threshold: plan.overtime_threshold,
          overtime_rate: plan.overtime_rate,
        },
        serviceConfigMap,
        timeEntries,
        contractCurrency,
        resolvePhaseRateOverride: (phaseId, serviceId) =>
          this.resolveProjectPhaseRateOverride(
            projectBillingContext ?? null,
            phaseId,
            serviceId,
          ),
        getProjectChargeConfig: (projectId) =>
          projectBillingContext?.configsByProjectId.get(projectId),
      },
      await this.loadChargeComputeTaxContext({
        client,
        locationId: clientContractLine.location_id,
        services: timeEntries.map(
          (entry: { tax_rate_id?: string | null }) => entry,
        ),
      }),
    );

    return charges;
  }

  private async calculateUsageBasedCharges(
    clientId: string,
    billingPeriod: IBillingPeriod,
    clientContractLine: IClientContractLine,
    billingCycle?: string,
    recurringTimingSelection?: ResolvedRecurringChargeTiming,
    recurringTimingSelectionSource?: CalculateBillingOptions["recurringTimingSelectionSource"],
  ): Promise<IUsageBasedCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const db = tenantDb(this.knex, this.tenant);
    const client = await db
      .table("clients")
      .where({
        client_id: clientId,
        tenant: this.tenant,
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const tenant = this.tenant; // Capture tenant value for joins
    const knexRef = this.knex; // Closure-friendly knex reference for join callbacks
    const contractCurrency = clientContractLine.currency_code || "USD";
    const clientConfigService = new ClientContractServiceConfigurationService(
      this.knex,
      tenant,
    );
    const clientServiceConfigs =
      await clientConfigService.getConfigurationsForClientContractLine(
        clientContractLine.client_contract_line_id,
      );

    const resolvedBillingCycle =
      billingCycle ??
      (!recurringTimingSelection &&
      recurringTimingSelectionSource !== "persisted"
        ? await this.getBillingCycle(clientId, billingPeriod.startDate)
        : undefined);

    const timingResolution = this.resolveServiceDrivenChargeTiming(
      billingPeriod,
      clientContractLine,
      resolvedBillingCycle,
      recurringTimingSelection,
      recurringTimingSelectionSource,
    );
    if (!timingResolution) {
      return [];
    }

    const servicePeriodStartExclusive =
      timingResolution.servicePeriodStartExclusive;
    const servicePeriodEndExclusive =
      timingResolution.servicePeriodEndExclusive;
    const servicePeriodStart = timingResolution.servicePeriodStart;
    const servicePeriodEnd = timingResolution.servicePeriodEnd;

    // Create a map of service IDs to their usage configurations and rate tiers
    const serviceConfigMap = new Map<
      string,
      {
        config: IContractLineServiceConfiguration &
          IContractLineServiceUsageConfig;
        rateTiers: IContractLineServiceRateTier[];
      }
    >();

    for (const configDetails of clientServiceConfigs) {
      if (configDetails.baseConfig.configuration_type !== "Usage") {
        continue;
      }
      const usageDetails = configDetails.typeConfig as
        | (IContractLineServiceUsageConfig & { base_rate?: number | null })
        | null;
      if (!usageDetails) {
        continue;
      }
      const rateTiers = configDetails.rateTiers ?? [];
      const normalizedConfig = {
        config_id: configDetails.baseConfig.config_id,
        contract_line_id: clientContractLine.contract_line_id,
        service_id: configDetails.serviceId,
        configuration_type: "Usage",
        quantity: configDetails.baseConfig.quantity ?? null,
        custom_rate:
          configDetails.baseConfig.custom_rate != null
            ? Number(configDetails.baseConfig.custom_rate)
            : null,
        unit_of_measure: usageDetails.unit_of_measure,
        enable_tiered_pricing: Boolean(usageDetails.enable_tiered_pricing),
        minimum_usage: usageDetails.minimum_usage ?? 0,
        base_rate:
          usageDetails.base_rate != null
            ? Number(usageDetails.base_rate)
            : null,
      } as IContractLineServiceConfiguration & IContractLineServiceUsageConfig;

      serviceConfigMap.set(configDetails.serviceId, {
        config: normalizedConfig,
        rateTiers,
      });
    }
    let configuredServiceIds = Array.from(serviceConfigMap.keys());
    if (configuredServiceIds.length === 0) {
      configuredServiceIds = await this.getServiceIdsForContractLine(
        clientContractLine.contract_line_id,
      );
    }
    if (configuredServiceIds.length === 0) {
      return [];
    }
    const uniquelyAssignableServiceIds =
      await this.getUniquelyAssignableServiceIdsForLine({
        clientId,
        serviceIds: configuredServiceIds,
        contractLineId: clientContractLine.contract_line_id,
        servicePeriodStartExclusive,
        servicePeriodEndExclusive,
      });

    const usageRecordQuery = db.table<any>("usage_tracking");
    db.tenantJoin(
      usageRecordQuery,
      "service_catalog",
      "service_catalog.service_id",
      "usage_tracking.service_id",
      { type: "left" },
    );
    db.tenantJoin(
      usageRecordQuery,
      "service_prices as sp",
      "sp.service_id",
      "service_catalog.service_id",
      {
        type: "left",
        on(join) {
          join.andOn(
            "sp.currency_code",
            "=",
            knexRef.raw("?", [contractCurrency]),
          );
        },
      },
    );

    usageRecordQuery
      .where({
        "usage_tracking.client_id": clientId,
        "usage_tracking.tenant": this.tenant,
        "usage_tracking.invoiced": false,
      })
      .whereIn("usage_tracking.service_id", configuredServiceIds)
      .where("usage_tracking.usage_date", ">=", servicePeriodStartExclusive)
      .where("usage_tracking.usage_date", "<", servicePeriodEndExclusive)
      .where(function (this: Knex.QueryBuilder) {
        // Either the usage record has the specific contract line ID (use contract_line_id for contract associations)
        this.where(
          "usage_tracking.contract_line_id",
          clientContractLine.contract_line_id,
        );
        if (uniquelyAssignableServiceIds.length > 0) {
          // Unassigned usage is allocatable only when service-to-line matching is unique.
          this.orWhere(function (this: Knex.QueryBuilder) {
            this.whereNull("usage_tracking.contract_line_id").whereIn(
              "usage_tracking.service_id",
              uniquelyAssignableServiceIds,
            );
          });
        }
      })
      .select(
        "usage_tracking.*",
        "service_catalog.service_name",
        "service_catalog.default_rate",
        "service_catalog.tax_rate_id",
        "sp.rate as currency_rate",
      ); // Fetch tax_rate_id

    const usageRecords = await usageRecordQuery;

    const { charges } = await computeUsageBasedCharges(
      {
        billingPeriod,
        clientContractLine,
        timing: timingResolution,
        client,
        serviceConfigMap: serviceConfigMap as Map<
          string,
          UsageServiceConfigEntry
        >,
        usageRecords,
        contractCurrency,
      },
      await this.loadChargeComputeTaxContext({
        client,
        locationId: clientContractLine.location_id,
        services: usageRecords,
      }),
    );

    return charges;
  }

  private async getUniquelyAssignableServiceIdsForLine(input: {
    clientId: string;
    serviceIds: string[];
    contractLineId: string;
    servicePeriodStartExclusive: ISO8601String;
    servicePeriodEndExclusive: ISO8601String;
  }): Promise<string[]> {
    if (!this.tenant || input.serviceIds.length === 0) {
      return [];
    }

    const db = tenantDb(this.knex, this.tenant);
    const uniqueAssignmentQuery = db.table("client_contracts as cc");
    db.tenantJoin(
      uniqueAssignmentQuery,
      "contracts as c",
      "c.contract_id",
      "cc.contract_id",
    );
    db.tenantJoin(
      uniqueAssignmentQuery,
      "contract_lines as cl",
      "cl.contract_id",
      "c.contract_id",
    );
    db.tenantJoin(
      uniqueAssignmentQuery,
      "contract_line_services as cls",
      "cls.contract_line_id",
      "cl.contract_line_id",
    );

    const rows = await uniqueAssignmentQuery
      .where({
        "cc.tenant": this.tenant,
        "cc.client_id": input.clientId,
      })
      .whereIn("cls.service_id", input.serviceIds)
      .where("cc.start_date", "<", input.servicePeriodEndExclusive)
      .where(function (this: Knex.QueryBuilder) {
        this.whereNull("cc.end_date").orWhere(
          "cc.end_date",
          ">=",
          input.servicePeriodStartExclusive,
        );
      })
      .groupBy("cls.service_id")
      .select(
        "cls.service_id",
        this.knex.raw("COUNT(DISTINCT cl.contract_line_id) as line_count"),
        this.knex.raw("MIN(cl.contract_line_id::text) as only_line_id"),
      );

    return rows
      .filter(
        (row: any) =>
          Number(row.line_count) === 1 &&
          row.only_line_id === input.contractLineId,
      )
      .map((row: any) => row.service_id);
  }

  private async getServiceIdsForContractLine(
    contractLineId: string,
  ): Promise<string[]> {
    if (!this.tenant) {
      return [];
    }

    const db = tenantDb(this.knex, this.tenant);
    const rows = await db
      .table("contract_line_services")
      .where({
        tenant: this.tenant,
        contract_line_id: contractLineId,
      })
      .select("service_id");

    return rows
      .map((row: any) => row.service_id)
      .filter(
        (serviceId: unknown): serviceId is string =>
          typeof serviceId === "string" && serviceId.length > 0,
      );
  }

  private async calculateRecurringQuantityCharges(
    clientId: string,
    billingPeriod: IBillingPeriod,
    clientContractLine: IClientContractLine,
    billingCycle: string | undefined,
    chargeType: "product" | "license",
    recurringTimingSelection?: ResolvedRecurringChargeTiming,
    recurringTimingSelectionSource?: CalculateBillingOptions["recurringTimingSelectionSource"],
  ): Promise<Array<IProductCharge | ILicenseCharge>> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const isLicenseCharge = chargeType === "license";

    const resolvedBillingCycle =
      billingCycle ??
      (!recurringTimingSelection &&
      recurringTimingSelectionSource !== "persisted"
        ? await this.getBillingCycle(clientId, billingPeriod.startDate)
        : undefined);

    const timingResolution = this.resolveRecurringChargeTiming(
      billingPeriod,
      clientContractLine,
      resolvedBillingCycle,
      recurringTimingSelection,
      recurringTimingSelectionSource,
    );
    if (!timingResolution) {
      return [];
    }

    const db = tenantDb(this.knex, this.tenant);
    const client = (await db
      .table("clients")
      .where({
        client_id: clientId,
        tenant: this.tenant,
      })
      .first()) as IClient;

    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const tenant = this.tenant; // Capture tenant value for joins
    let planServicesQuery = db.table<any>("contract_line_services as cls");
    db.tenantJoin(
      planServicesQuery,
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
      planServicesQuery,
      "service_catalog as sc",
      "sc.service_id",
      "cls.service_id",
    );
    db.tenantJoin(
      planServicesQuery,
      "service_prices as sp",
      "sp.service_id",
      "sc.service_id",
      {
        type: "left",
        on: (join) => {
          join.andOn(
            "sp.currency_code",
            "=",
            this.knex.raw("?", [clientContractLine.currency_code || "USD"]),
          );
        },
      },
    );

    planServicesQuery
      .where({
        "cls.contract_line_id": clientContractLine.client_contract_line_id,
        "cls.tenant": tenant,
      })
      .andWhere("sc.item_kind", "=", "product");

    if (isLicenseCharge) {
      planServicesQuery = planServicesQuery.andWhere("sc.is_license", true);
    } else {
      planServicesQuery = planServicesQuery.andWhere(function () {
        this.where("sc.is_license", false).orWhereNull("sc.is_license");
      });
    }

    const planServices = await planServicesQuery.select(
      "sc.service_id",
      "sc.service_name",
      "sc.default_rate",
      "sc.tax_rate_id",
      "clsc.config_id",
      "cls.quantity as service_quantity",
      "cls.custom_rate as service_line_custom_rate",
      "clsc.quantity as configuration_quantity",
      "clsc.custom_rate as configuration_custom_rate",
      "sp.rate as price_rate",
    );

    if (planServices.length === 0) {
      return [];
    }

    const { charges } = await computeRecurringQuantityCharges(
      {
        clientContractLine,
        client,
        timing: timingResolution,
        chargeType,
        services: planServices,
        contractCurrency: clientContractLine.currency_code || "USD",
      },
      await this.loadChargeComputeTaxContext({
        client,
        locationId: clientContractLine.location_id,
        services: planServices,
      }),
    );

    return charges;
  }

  private async calculateProductCharges(
    clientId: string,
    billingPeriod: IBillingPeriod,
    clientContractLine: IClientContractLine,
    billingCycle?: string,
    recurringTimingSelection?: ResolvedRecurringChargeTiming,
    recurringTimingSelectionSource?: CalculateBillingOptions["recurringTimingSelectionSource"],
  ): Promise<IProductCharge[]> {
    return (await this.calculateRecurringQuantityCharges(
      clientId,
      billingPeriod,
      clientContractLine,
      billingCycle,
      "product",
      recurringTimingSelection,
      recurringTimingSelectionSource,
    )) as IProductCharge[];
  }

  private async calculateLicenseCharges(
    clientId: string,
    billingPeriod: IBillingPeriod,
    clientContractLine: IClientContractLine,
    billingCycle?: string,
    recurringTimingSelection?: ResolvedRecurringChargeTiming,
    recurringTimingSelectionSource?: CalculateBillingOptions["recurringTimingSelectionSource"],
  ): Promise<ILicenseCharge[]> {
    return (await this.calculateRecurringQuantityCharges(
      clientId,
      billingPeriod,
      clientContractLine,
      billingCycle,
      "license",
      recurringTimingSelection,
      recurringTimingSelectionSource,
    )) as ILicenseCharge[];
  }

  private async calculateMaterialCharges(
    clientId: string,
    billingPeriod: IBillingPeriod,
    currencyCode: string,
    projectId?: string,
    projectBillingContext?: ProjectBillingContext,
    projectTarget?: CalculateBillingOptions["projectTarget"],
  ): Promise<IProductCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const tenant = this.tenant;
    const db = tenantDb(this.knex, tenant);
    const client = (await db
      .table("clients")
      .where({
        client_id: clientId,
        tenant,
      })
      .first()) as IClient;

    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    let materialRows: any[] = [];

    try {
      if (projectId) {
        const projectMaterialsQuery = db
          .table("project_materials as pm")
          .select([
            this.knex.raw(`'project' as source_type`),
            "pm.project_material_id as source_id",
            "pm.project_id",
            "pm.service_id",
            "pm.quantity",
            "pm.rate",
            "pm.currency_code",
            "pm.description",
            "pm.created_at",
            "pm.billing_destination",
            "pm.billing_schedule_entry_id",
            "sc.service_name",
            "sc.tax_rate_id",
          ]);
        db.tenantJoin(
          projectMaterialsQuery,
          "service_catalog as sc",
          "pm.service_id",
          "sc.service_id",
        );
        materialRows = await projectMaterialsQuery.where({
          "pm.tenant": tenant,
          "pm.client_id": clientId,
          "pm.project_id": projectId,
          "pm.is_billed": false,
        });
        const selectedScheduleEntryIds = new Set(projectTarget?.entryIds ?? []);
        const selectedMaterialIds = projectTarget?.selectedMaterialIds
          ? new Set(projectTarget.selectedMaterialIds)
          : null;
        materialRows = materialRows.filter((row) => {
          if (selectedMaterialIds && !selectedMaterialIds.has(row.source_id)) {
            return false;
          }
          const eligible = isProjectMaterialEligible(row, {
            mode: projectTarget?.materialMode ?? "project_invoice",
            selectedScheduleEntryIds,
            projectClosed: projectTarget?.projectClosed === true,
          });
          if (eligible && row.currency_code !== currencyCode) {
            throw new Error(
              `Project product ${row.source_id} is routed to this project invoice in ${row.currency_code}, `
              + `but the project bills in ${currencyCode}. Change it to Separate product invoice.`,
            );
          }
          return eligible;
        });
      } else {
        const ticketMaterialsQuery = db
          .table("ticket_materials as tm")
          .select([
            this.knex.raw(`'ticket' as source_type`),
            "tm.ticket_material_id as source_id",
            this.knex.raw("NULL as project_id"),
            "tm.service_id",
            "tm.quantity",
            "tm.rate",
            "tm.currency_code",
            "tm.description",
            "tm.created_at",
            "sc.service_name",
            "sc.tax_rate_id",
          ]);
        db.tenantJoin(
          ticketMaterialsQuery,
          "service_catalog as sc",
          "tm.service_id",
          "sc.service_id",
        );
        materialRows = await ticketMaterialsQuery
          .where({
            "tm.tenant": tenant,
            "tm.client_id": clientId,
            "tm.is_billed": false,
            "tm.currency_code": currencyCode,
          })
          .where("tm.created_at", ">=", billingPeriod.startDate)
          .andWhere("tm.created_at", "<", billingPeriod.endDate);
      }
    } catch (err: any) {
      if (err?.code === "42P01") {
        return [];
      }
      throw err;
    }

    const chargesPromises = (materialRows as any[]).map(
      async (row): Promise<IProductCharge> => {
        const quantity = Math.max(1, Number(row.quantity || 1));
        const rate = Math.round(Number(row.rate || 0));
        const total = rate * quantity;

        const { taxRegion: serviceTaxRegion, isTaxable } =
          await this.getTaxInfoFromService({
            service_id: row.service_id,
            tax_rate_id: row.tax_rate_id,
          });

        let taxAmount = 0;
        let taxRate = 0;
        const effectiveTaxRegion =
          serviceTaxRegion ??
          (await this.getClientDefaultTaxRegionCode(client.client_id)) ??
          undefined;

        if (!client.is_tax_exempt && isTaxable && effectiveTaxRegion) {
          try {
            const taxServiceInstance = new TaxService();
            const taxResult = await taxServiceInstance.calculateTax(
              client.client_id,
              total,
              billingPeriod.endDate,
              effectiveTaxRegion,
              true,
              currencyCode || "USD",
            );
            taxRate = taxResult.taxRate;
            taxAmount = taxResult.taxAmount;
          } catch (error) {
            console.error(
              `Error calculating initial tax for material ${row.source_type} ${row.source_id}:`,
              error,
            );
          }
        }

        const description = row.description || row.service_name || "Material";
        const projectConfig =
          row.source_type === "project" && row.project_id
            ? projectBillingContext?.configsByProjectId.get(row.project_id)
            : undefined;

        return {
          type: "product",
          serviceId: row.service_id,
          serviceName: description,
          quantity,
          rate,
          total,
          tax_amount: taxAmount,
          tax_rate: taxRate,
          tax_region: effectiveTaxRegion,
          is_taxable: isTaxable,
          servicePeriodStart: billingPeriod.startDate,
          servicePeriodEnd: billingPeriod.endDate,
          billingTiming: "arrears",
          ...(projectConfig?.billing_model === "time_and_materials"
            ? {
                project_id: projectConfig.project_id,
                project_name: projectConfig.project_name,
                project_number: projectConfig.project_number,
                project_billing_config_id: projectConfig.config_id,
              }
            : {}),
          material_source_type: row.source_type,
          material_source_id: row.source_id,
        };
      },
    );

    return Promise.all(chargesPromises);
  }

  private async calculateBucketPlanCharges(
    clientId: string,
    billingPeriod: IBillingPeriod,
    contractLine: IClientContractLine,
  ): Promise<IBucketCharge[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const db = tenantDb(this.knex, this.tenant);
    const client = await db
      .table("clients")
      .where({
        client_id: clientId,
        tenant: this.tenant,
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    // Get the line's bucket pools (weighted-burn model). A pool is line-owned
    // and holds its own totals/overage/rollover; member services draw from it
    // (member rows are multiplier overrides under a catch-all).
    const poolQuery = db.table<any>("contract_line_buckets as clb");

    const pools = await poolQuery
      .where({
        "clb.tenant": client.tenant,
        "clb.contract_line_id": contractLine.client_contract_line_id,
      })
      .select(
        "clb.*",
      );

    if (!pools || pools.length === 0) {
      return [];
    }

    // Load persisted allowance state here; deterministic aggregation, rollover
    // application, overage pricing, and explanations live in shared compute.
    // One charge per bucket per period, as today one-per-config.
    const bucketCharges = await Promise.all(
      pools.map(async (pool): Promise<IBucketCharge[]> => {
        const usageRecords = await db
          .table("bucket_usage")
          .where({
            tenant: client.tenant,
            client_id: clientId,
            bucket_id: pool.bucket_id,
          })
          .where("period_start", ">=", billingPeriod.startDate)
          .where("period_end", "<=", billingPeriod.endDate)
          .select("*");

        if (usageRecords.length === 0) return [];

        // Pool display name: bucket_name when set, else the member service name
        // (or the bucket's id as a last resort).
        const members = await db
          .table("contract_line_bucket_services as clbs")
          .where({ "clbs.tenant": client.tenant, "clbs.bucket_id": pool.bucket_id })
          .select(
            "clbs.service_id",
            "sc.service_name",
            "sc.tax_rate_id",
            "sc.unit_of_measure",
            "sc.billing_method",
          )
          .join("service_catalog as sc", function (this: any) {
            this.on("sc.service_id", "=", "clbs.service_id")
              .andOn("sc.tenant", "=", "clbs.tenant");
          })
          .orderBy("clbs.service_id", "asc");
        const memberMetadataByService = new Map(
          members.map((member) => [
            member.service_id,
            {
              service_name: member.service_name as string,
              tax_rate_id: (member.tax_rate_id as string | null) ?? null,
              unit_of_measure: (member.unit_of_measure as string | null) ?? null,
              billing_method: (member.billing_method as string | null) ?? null,
            },
          ]),
        );
        const serviceName = pool.bucket_name
          ? pool.bucket_name
          : members.length === 1
            ? members[0].service_name
            : `Bucket pool ${String(pool.bucket_id).slice(0, 8)}`;
        const firstMemberServiceId = members[0]?.service_id ?? null;
        const firstMemberTaxRateId = members[0]?.tax_rate_id ?? null;
        const firstMemberUnitOfMeasure = members[0]?.unit_of_measure ?? null;
        const firstMemberBillingMethod = members[0]?.billing_method ?? null;

        // Weighted when any member multiplier ≠ 1 or an after-hours rule exists.
        const memberMultipliers = await db
          .table("contract_line_bucket_services")
          .where({ tenant: client.tenant, bucket_id: pool.bucket_id })
          .select("burn_multiplier")
          .orderBy("service_id", "asc");
        const isWeighted =
          Number(pool.after_hours_multiplier) !== 0 ||
          memberMultipliers.some((member) => Number(member.burn_multiplier) !== 1);

        // A zero-member pool (dormant catch-all or emptied member-scoped pool)
        // still covers the line but has no member to key the charge on. The
        // pool identity is carried honestly in config_id (= bucket_id); the
        // service FK fields stay null so bucket_id NEVER masquerades as a
        // service_catalog id on invoice rows.
        const chargeServiceId = firstMemberServiceId;
        const chargeTaxRateId = members.length > 0 ? firstMemberTaxRateId : null;
        const chargeUnitOfMeasure = members.length > 0 ? firstMemberUnitOfMeasure : null;
        const chargeBillingMethod = members.length > 0 ? firstMemberBillingMethod : null;

        // Per-period weighted contributions: the SAME draw set and weighted math
        // the reconciliation uses. Overage is attributed to the services that
        // actually burned it (pro-rata by weighted minutes), never an arbitrary
        // member. A catch-all non-member contributor still earns its own
        // portion with its own catalog tax metadata.
        const contributionsByPeriod = new Map<
          string,
          Array<{ serviceId: string; weightedMinutes: number }>
        >();
        for (const usage of usageRecords) {
          const startIso = toISODate(toPlainDate(usage.period_start));
          const endIso = toISODate(toPlainDate(usage.period_end));
          const key = `${startIso}:${endIso}`;
          if (contributionsByPeriod.has(key)) continue;
          const endExclusive = new Date(`${endIso}T00:00:00.000Z`);
          endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
          const contributions = await computePoolContributionsByService(
            this.knex,
            client.tenant,
            {
              bucketId: pool.bucket_id,
              contractLineId: pool.contract_line_id,
              coversAllServices: Boolean(pool.covers_all_services),
              periodStart: new Date(`${startIso}T00:00:00.000Z`),
              periodEndExclusive: endExclusive,
            },
          );
          contributionsByPeriod.set(key, contributions);
        }

        // Catalog metadata for contributors that are not explicit members of the
        // pool (a catch-all non-member burns at 1x and still contributes).
        const contributorServiceIds = Array.from(contributionsByPeriod.values())
          .flat()
          .map((contribution) => contribution.serviceId);
        const catalogServiceIds = Array.from(new Set(
          contributorServiceIds.filter((id) => !memberMetadataByService.has(id)),
        ));
        const catalogMetadataByService = new Map<
          string,
          {
            service_name: string;
            tax_rate_id: string | null;
            unit_of_measure: string | null;
            billing_method: string | null;
          }
        >();
        if (catalogServiceIds.length > 0) {
          const catalogRows = await db
            .table("service_catalog as sc")
            .where({ "sc.tenant": client.tenant })
            .whereIn("sc.service_id", catalogServiceIds)
            .select(
              "sc.service_id",
              "sc.service_name",
              "sc.tax_rate_id",
              "sc.unit_of_measure",
              "sc.billing_method",
            );
          for (const row of catalogRows) {
            catalogMetadataByService.set(row.service_id, {
              service_name: row.service_name as string,
              tax_rate_id: (row.tax_rate_id as string | null) ?? null,
              unit_of_measure: (row.unit_of_measure as string | null) ?? null,
              billing_method: (row.billing_method as string | null) ?? null,
            });
          }
        }
        const metadataFor = (serviceId: string) =>
          memberMetadataByService.get(serviceId) ?? catalogMetadataByService.get(serviceId);

        const serviceContributions = Array.from(contributionsByPeriod.entries()).map(
          ([key, contributions]) => {
            const [periodStart, periodEnd] = key.split(":");
            return {
              periodStart,
              periodEnd,
              services: contributions.map((contribution) => {
                const metadata = metadataFor(contribution.serviceId);
                return {
                  service_id: contribution.serviceId,
                  service_name: pool.bucket_name ?? metadata?.service_name ?? undefined,
                  tax_rate_id: metadata?.tax_rate_id ?? null,
                  unit_of_measure: metadata?.unit_of_measure ?? null,
                  billing_method: metadata?.billing_method ?? null,
                  weightedMinutes: contribution.weightedMinutes,
                };
              }),
            };
          },
        );

        const result = await computeBucketCharges(
          {
            billingPeriod,
            clientContractLine: contractLine,
            client,
            config: {
              config_id: pool.bucket_id,
              service_id: chargeServiceId,
              service_name: serviceName,
              tax_rate_id: chargeTaxRateId,
              unit_of_measure: chargeUnitOfMeasure,
              billing_method: chargeBillingMethod,
              total_minutes: pool.total_minutes,
              overage_rate: pool.overage_rate,
              allow_rollover: pool.allow_rollover,
              isWeighted,
            },
            usageRecords,
            contractCurrency: contractLine.currency_code || "USD",
            serviceContributions,
          },
          await this.loadChargeComputeTaxContext({
            client,
            locationId: contractLine.location_id,
            services: [
              ...contributorServiceIds.map((serviceId) => ({
                tax_rate_id: metadataFor(serviceId)?.tax_rate_id ?? null,
              })),
              { tax_rate_id: chargeTaxRateId },
            ],
          }),
        );
        return result.charges;
      }),
    );

    return bucketCharges.flat();
  }

  private async hasExistingServicePeriodCharge(
    clientContractLineId: string,
    servicePeriodStart: ISO8601String,
    servicePeriodEnd: ISO8601String,
    billingTiming: "arrears" | "advance",
  ): Promise<boolean> {
    await this.initKnex();
    if (!this.knex || !this.tenant) {
      throw new Error("Database connection not initialized");
    }

    // Note: client_contract_line_id is actually a contract_line_id value (see getClientContractLinesAndCycle)
    const db = tenantDb(this.knex, this.tenant);
    const existingChargeQuery = db.table("invoice_charge_details as iid");
    db.tenantJoin(
      existingChargeQuery,
      "contract_line_service_configuration as clsc",
      "iid.config_id",
      "clsc.config_id",
    );

    const existing = await existingChargeQuery
      .where("clsc.contract_line_id", clientContractLineId)
      .andWhere("iid.service_period_start", servicePeriodStart)
      .andWhere("iid.service_period_end", servicePeriodEnd)
      .andWhere("iid.billing_timing", billingTiming)
      .first();

    if (existing) {
      return true;
    }

    const servicePeriodEndExclusive = toISODate(
      toPlainDate(servicePeriodEnd).add({ days: 1 }),
    );
    const obligationCandidates = buildPostDropRecurringObligationCandidates({
      contractLineId: clientContractLineId,
      chargeFamily: "fixed",
    });

    const recurringLinkedCharge = await db
      .table("recurring_service_periods")
      .where("charge_family", "fixed")
      .where("due_position", billingTiming)
      .whereNotNull("invoice_id")
      .where(function matchObligationCandidates() {
        for (const [index, candidate] of obligationCandidates.entries()) {
          if (index === 0) {
            this.where(function matchCandidate() {
              this.where("obligation_type", candidate.obligationType).andWhere(
                "obligation_id",
                candidate.obligationId,
              );
            });
            continue;
          }

          this.orWhere(function matchCandidate() {
            this.where("obligation_type", candidate.obligationType).andWhere(
              "obligation_id",
              candidate.obligationId,
            );
          });
        }
      })
      .where("service_period_start", servicePeriodStart)
      .where(function matchServicePeriodEnd() {
        this.where("service_period_end", servicePeriodEnd).orWhere(
          "service_period_end",
          servicePeriodEndExclusive,
        );
      })
      .first("record_id");

    return Boolean(recurringLinkedCharge);
  }

  private calculatePeriodDaysExclusive(
    start: ISO8601String,
    end: ISO8601String,
  ): number {
    const startPlain = toPlainDate(start);
    const endPlain = toPlainDate(end);
    if (Temporal.PlainDate.compare(endPlain, startPlain) <= 0) {
      return 0;
    }
    return startPlain.until(endPlain, { largestUnit: "days" }).days;
  }

  private async applyDiscountsAndAdjustments(
    billingResult: IBillingResult,
    clientId: string,
    billingPeriod: IBillingPeriod,
  ): Promise<IBillingResult> {
    // Fetch applicable discounts within the billing period
    const discounts = await this.fetchDiscounts(
      clientId,
      billingPeriod,
      billingResult.charges,
    );

    return computeDiscountsAndAdjustments({
      billingResult,
      billingPeriod,
      // fetchDiscounts already performed canonical service-period filtering.
      // Give shared compute an always-overlapping window so it owns amount and
      // ordering arithmetic without repeating database resolution.
      discountCandidates: discounts.map((discount) => ({
        ...discount,
        start_date: billingPeriod.startDate,
        end_date: null,
      })),
      // Production has never applied the legacy client adjustments table in
      // invoice generation; preserve that behavior while shared compute can
      // evaluate explicit simulator adjustments.
      adjustments: [],
    }).billingResult;
  }

  private async fetchDiscounts(
    clientId: string,
    billingPeriod: IBillingPeriod,
    charges: IBillingCharge[] = [],
  ): Promise<IDiscount[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const db = tenantDb(this.knex, this.tenant);
    const client = await db
      .table("clients")
      .where({
        client_id: clientId,
        tenant: this.tenant,
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const discountWindowsByContractLine =
      this.buildDiscountEvaluationWindowsByContractLine(charges);
    const { start: candidateStart, endInclusive: candidateEnd } =
      this.getDiscountCandidateQueryBounds(
        billingPeriod,
        discountWindowsByContractLine,
      );

    // Query discounts via client_contracts -> contracts -> contract_lines
    // instead of the deprecated client_contract_lines table
    const discountRowsQuery = db.table("discounts");
    db.tenantJoin(
      discountRowsQuery,
      "contract_line_discounts",
      "discounts.discount_id",
      "contract_line_discounts.discount_id",
    );
    db.tenantJoin(
      discountRowsQuery,
      "contract_lines as cl",
      "cl.contract_line_id",
      "contract_line_discounts.contract_line_id",
    );
    db.tenantJoin(
      discountRowsQuery,
      "contracts as c",
      "c.contract_id",
      "cl.contract_id",
    );
    db.tenantJoin(
      discountRowsQuery,
      "client_contracts as cc",
      "cc.contract_id",
      "c.contract_id",
    );

    const discountRows = (await discountRowsQuery
      .where({
        "cc.client_id": clientId,
        "cc.tenant": client.tenant,
        "discounts.is_active": true,
      })
      .andWhere("discounts.start_date", "<=", candidateEnd)
      .andWhere(function (this: Knex.QueryBuilder) {
        this.whereNull("discounts.end_date").orWhere(
          "discounts.end_date",
          ">",
          candidateStart,
        );
      })
      .select(
        "discounts.*",
        "contract_line_discounts.contract_line_id",
      )) as DiscountQueryRow[];

    return filterApplicableDiscounts(discountRows, billingPeriod, charges);
  }

  private buildDiscountEvaluationWindowsByContractLine(
    charges: IBillingCharge[],
  ): Map<string, Array<{ start: ISO8601String; endInclusive: ISO8601String }>> {
    const windowsByContractLine = new Map<
      string,
      Array<{ start: ISO8601String; endInclusive: ISO8601String }>
    >();

    for (const charge of charges) {
      if (
        !charge.client_contract_line_id ||
        !charge.servicePeriodStart ||
        !charge.servicePeriodEnd
      ) {
        continue;
      }

      const contractLineId = charge.client_contract_line_id;
      const window = {
        start: toISODate(toPlainDate(charge.servicePeriodStart)),
        endInclusive: toISODate(toPlainDate(charge.servicePeriodEnd)),
      };
      const existingWindows = windowsByContractLine.get(contractLineId) ?? [];
      const alreadyPresent = existingWindows.some(
        (existingWindow) =>
          existingWindow.start === window.start &&
          existingWindow.endInclusive === window.endInclusive,
      );

      if (!alreadyPresent) {
        existingWindows.push(window);
        windowsByContractLine.set(contractLineId, existingWindows);
      }
    }

    return windowsByContractLine;
  }

  private getDiscountCandidateQueryBounds(
    billingPeriod: IBillingPeriod,
    discountWindowsByContractLine: Map<
      string,
      Array<{ start: ISO8601String; endInclusive: ISO8601String }>
    >,
  ): { start: ISO8601String; endInclusive: ISO8601String } {
    const invoiceWindow = {
      start: toISODate(toPlainDate(billingPeriod.startDate)),
      endInclusive: toISODate(toPlainDate(billingPeriod.endDate)),
    };

    const candidateWindows = [
      invoiceWindow,
      ...Array.from(discountWindowsByContractLine.values()).flat(),
    ];

    return candidateWindows.reduce(
      (bounds, window) => ({
        start: window.start < bounds.start ? window.start : bounds.start,
        endInclusive:
          window.endInclusive > bounds.endInclusive
            ? window.endInclusive
            : bounds.endInclusive,
      }),
      invoiceWindow,
    );
  }

  private discountMatchesEvaluationWindow(
    discount: DiscountQueryRow,
    billingPeriod: IBillingPeriod,
    discountWindowsByContractLine: Map<
      string,
      Array<{ start: ISO8601String; endInclusive: ISO8601String }>
    >,
  ): boolean {
    const invoiceWindow = {
      start: toISODate(toPlainDate(billingPeriod.startDate)),
      endInclusive: toISODate(toPlainDate(billingPeriod.endDate)),
    };
    const contractLineWindows = discount.contract_line_id
      ? discountWindowsByContractLine.get(discount.contract_line_id)
      : undefined;
    const evaluationWindows =
      contractLineWindows && contractLineWindows.length > 0
        ? contractLineWindows
        : [invoiceWindow];

    const discountStart = toISODate(toPlainDate(discount.start_date));
    const discountEndExclusive = discount.end_date
      ? toISODate(toPlainDate(discount.end_date))
      : null;

    return evaluationWindows.some(
      (window) =>
        discountStart <= window.endInclusive &&
        (discountEndExclusive == null || discountEndExclusive > window.start),
    );
  }

  private async fetchAdjustments(clientId: string): Promise<IAdjustment[]> {
    await this.initKnex();
    if (!this.tenant) {
      throw new Error("tenant context not found");
    }

    const db = tenantDb(this.knex, this.tenant);
    const client = await db
      .table("clients")
      .where({
        client_id: clientId,
        tenant: this.tenant,
      })
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${this.tenant}`);
    }

    const adjustments = await db
      .unscoped<any>(
        "adjustments",
        "legacy adjustments table is not schema-backed; scoped manually by validated client tenant",
      )
      .where({
        client_id: clientId,
        tenant: client.tenant,
      });
    return Array.isArray(adjustments) ? (adjustments as IAdjustment[]) : [];
  }

  /**
   * Recalculates an entire invoice, including tax amounts and totals.
   * This is used when updating manual items to ensure all calculations are consistent.
   */
  async recalculateInvoice(
    invoiceId: string,
    existingTransaction?: Knex.Transaction,
    existingTenant?: string,
  ): Promise<void> {
    if (!existingTransaction || (!this.tenant && !existingTenant)) {
      await this.initKnex();
    }

    const tenant = existingTenant ?? this.tenant;
    if (!tenant) {
      throw new Error("tenant context not found");
    }

    const connection = existingTransaction ?? this.knex;
    const db = tenantDb(connection, tenant);

    console.log(`Recalculating invoice ${invoiceId}`);

    const invoice = await db
      .table("invoices")
      .where({
        invoice_id: invoiceId,
        tenant,
      })
      .first();

    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found in tenant ${tenant}`);
    }

    const client = await db
      .table("clients")
      .where({
        client_id: invoice.client_id,
        tenant,
      })
      .first();

    if (!client) {
      throw new Error(
        `Client ${invoice.client_id} not found in tenant ${tenant}`,
      );
    }

    // Removed direct use of TaxService here.
    // Removed subtotal and totalTax accumulation logic.

    console.log("Starting invoice recalculation:", {
      invoiceId,
      client: {
        id: client.client_id,
        name: client.client_name,
        isTaxExempt: client.is_tax_exempt,
        // region_code is still on client table for default fallback, but not primary source for service tax
      },
    });

    // Recalculation is intentionally financial-only. Canonical recurring
    // invoice_charge_details rows remain the persisted source of service-period
    // truth after invoice creation; this path should only update tax and totals.
    const recalculate = async (trx: Knex.Transaction) => {
      // Step 1: Recalculate and distribute tax across all items using the service function
      console.log(
        `[recalculateInvoice] Calling calculateAndDistributeTax for invoice ${invoiceId}`,
      );
      const taxService = new TaxService(); // Instantiate TaxService here
      await calculateAndDistributeTax(
        trx,
        invoiceId,
        client,
        taxService,
        tenant,
      ); // Pass client object and taxService instance
      console.log(
        `[recalculateInvoice] Finished calculateAndDistributeTax for invoice ${invoiceId}`,
      );

      // Step 2: Update invoice totals and record the transaction using the service function
      console.log(
        `[recalculateInvoice] Calling updateInvoiceTotalsAndRecordTransaction for invoice ${invoiceId}`,
      );
      await updateInvoiceTotalsAndRecordTransaction(
        trx,
        invoiceId,
        client, // Pass client object
        tenant, // Pass tenant
        invoice.invoice_number, // Pass invoice number
        undefined,
        {
          transactionType: "invoice_adjustment",
          description: `Adjusted invoice ${invoice.invoice_number}`,
        },
      );
      console.log(
        `[recalculateInvoice] Finished updateInvoiceTotalsAndRecordTransaction for invoice ${invoiceId}`,
      );

      // Note: The original logic for processing discount items and updating their net_amount
      // based on percentages is removed. It's assumed that calculateAndDistributeTax
      // handles the correct net amounts and tax distribution, including discounts.
      // If discount amounts need recalculation based on the new subtotal *before* tax distribution,
      // that logic would need to be added back here or integrated into calculateAndDistributeTax.
      // For now, we follow the instruction to delegate fully.
    };

    if (existingTransaction) {
      await recalculate(existingTransaction);
    } else {
      await withTransaction(this.knex, recalculate);
    }

    // Removed console log referencing deleted variables subtotal/totalTax

    // Event emission removed - moved back to invoiceModification.ts
  }
}
