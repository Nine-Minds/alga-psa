/**
 * Database-backed ContractChargeSource: the billing engine's side of the port.
 *
 * Supplies data only. Which charges a line produces, in what order, and which
 * services a pool absorbs is decided by resolveContractLineCharges; this class
 * answers "what does the database say" for one live client contract line.
 *
 * The per-family loaders (fixed, hourly, usage, product/license) still live in
 * billingEngine.ts next to the helpers they share; they are reached through
 * `DatabaseChargeLoaders`, called with the timing the resolver already settled.
 * Pool definitions and per-window pool state (`bucket_usage`) are read here.
 */

import type { Knex } from "knex";
import { tenantDb } from "@alga-psa/db";
import { toISODate, toPlainDate } from "@alga-psa/core";
import type { IBillingPeriod, IClientContractLine } from "@alga-psa/types";
import { computePoolContributionsByService } from "@alga-psa/shared/billingClients/bucketUsageService";
import type {
  ChargeComputeClient,
  ChargeComputeTaxContext,
} from "../compute";
import type {
  ResolvedBillingProfileAssignments,
  ResolvedBillingTiming,
  ResolvedContractLineFacts,
  UnpricedContractBillingObligation,
} from "../domain";
import { lineFacts } from "../domain/calculateContractCharge";
import type {
  ChargeFamily,
  CadencePrepaidBlockSupply,
  ConfiguredService,
  ContractChargeSource,
  FactsOf,
  HourBlockDrawSupply,
  HourBlockDrawSupplyRow,
  PrepaidCoverageRow,
  PoolDefinition,
  PoolPeriodState,
  PooledTimeExclusion,
  PrepaidBlockIssuanceSupply,
  StreamTimings,
  SuppliedCharge,
  TaxContextDemand,
  TimingRequest,
  TimingResolution,
} from "./types";

/** Where a family loader leaves what it loaded (one obligation at most). */
export interface ContractObligationSink {
  obligations: UnpricedContractBillingObligation[];
  taxContexts: Record<string, ChargeComputeTaxContext>;
  /**
   * Usage-billed services whose due service period has no eligible
   * usage_tracking record. Usage billing is record-driven; these statuses let
   * callers surface "missing usage" instead of a silent empty result.
   */
  usageStatuses?: Array<unknown>;
}

/** The engine's family loaders, each already bound to this line and window. */
export interface DatabaseChargeLoaders {
  fixed(timing: ResolvedBillingTiming, sink: ContractObligationSink): Promise<void>;
  hourly(
    timing: ResolvedBillingTiming,
    exclusion: PooledTimeExclusion | null,
    sink: ContractObligationSink,
  ): Promise<void>;
  usage(timing: ResolvedBillingTiming, sink: ContractObligationSink): Promise<void>;
  recurringQuantity(
    kind: "product" | "license",
    timing: ResolvedBillingTiming,
    sink: ContractObligationSink,
  ): Promise<void>;
  /** Raw issuance rows for the named ids; throws if one is not the client's. */
  prepaidBlockIssuances(
    issuanceIds: string[],
  ): Promise<PrepaidBlockIssuanceSupply[]>;
  /** The line's cadence-mode Prepaid Block terms, or null if it has none. */
  cadencePrepaidBlock(): Promise<CadencePrepaidBlockSupply | null>;
  /** The line's block draws on these time entries (raw rows, no decisions). */
  prepaidCoverage(entryIds: string[]): Promise<PrepaidCoverageRow[]>;
  /** Allocation rows of the line's blocks inside the service period, FIFO. */
  hourBlockDraws(
    timing: ResolvedBillingTiming,
  ): Promise<HourBlockDrawSupplyRow[]>;
}

/** Engine helpers the source needs; thin and structural so tests can stub them. */
export interface DatabaseChargeHost {
  readonly knex: Knex;
  readonly tenant: string;
  getBillingCycle(clientId: string, date: string): Promise<string>;
  buildRecurringChargeTimingSelection(
    billingPeriod: IBillingPeriod,
    line: IClientContractLine,
    billingCycle: string,
  ): ResolvedBillingTiming | null;
  loadChargeProfileAssignments(
    clientId: string,
    line: IClientContractLine,
  ): Promise<ResolvedBillingProfileAssignments>;
  loadChargeComputeTaxContext(input: {
    client: ChargeComputeClient;
    locationId: string | null | undefined;
    services: Array<{ tax_rate_id?: string | null }>;
    billingProfileIds?: Array<string | null | undefined>;
  }): Promise<ChargeComputeTaxContext>;
}

export interface DatabaseChargeSourceInput {
  clientId: string;
  billingPeriod: IBillingPeriod;
  clientContractLine: IClientContractLine;
  /** Client billing cycle rule, when the caller already knows it. */
  billingCycle?: string;
  /** The per-stream timings the caller already selected for this line, if any. */
  recurringTimingSelections?: StreamTimings;
  recurringTimingSelectionSource?: "derived" | "persisted";
  /** Project-driven runs are not cadence-driven (see resolveTiming). */
  projectTarget?: boolean;
  /**
   * Legacy isolated pool callers have no cadence information; they price the
   * usage rows that fall inside the billing period. Live recurring generation
   * never sets this.
   */
  untimedWithoutCadence?: boolean;
  /**
   * Prepaid-block issuances the caller selected for this invoice. They belong
   * to the client's document, not to a line's service period, so only a
   * document-scope source (see documentScope) is given them.
   */
  prepaidBlockIssuanceIds?: string[];
  /**
   * The source answers for the client's document rather than a contract line:
   * `clientContractLine` is a placeholder for the document and its facts carry
   * no currency, so they are not checked against a line's currency.
   */
  documentScope?: boolean;
  loaders: DatabaseChargeLoaders;
}

interface PoolRow {
  bucket_id: string;
  bucket_name?: string | null;
  contract_line_id: string;
  total_minutes: number;
  overage_rate: number;
  allow_rollover: boolean;
  covers_all_services: boolean;
  after_hours_multiplier?: number | string | null;
}

type ClientRow = ChargeComputeClient & {
  client_id: string;
  tenant: string;
  is_tax_exempt?: boolean | null;
};

type ServiceMetadata = {
  service_name: string;
  tax_rate_id: string | null;
  unit_of_measure: string | null;
  unit_code: string | null;
  billing_method: string | null;
};

export class DatabaseChargeSource implements ContractChargeSource {
  readonly line: ResolvedContractLineFacts;
  readonly billingPeriod: IBillingPeriod;

  private readonly poolRows = new Map<string, PoolRow>();
  /** "Missing usage" statuses gathered while loading; read by the engine afterwards. */
  readonly usageStatuses: Array<unknown> = [];
  private clientRowPromise?: Promise<ClientRow>;
  private loadedServices: ConfiguredService[] | null = null;

  constructor(
    private readonly host: DatabaseChargeHost,
    private readonly input: DatabaseChargeSourceInput,
  ) {
    const facts = lineFacts(input.clientContractLine, host.tenant);
    this.line = input.documentScope ? { ...facts, currencyCode: "" } : facts;
    this.billingPeriod = input.billingPeriod;
  }

  /** Loaded on first use: families that never need the client row never query it. */
  private clientRow(): Promise<ClientRow> {
    this.clientRowPromise ??= (async () => {
      const db = tenantDb(this.host.knex, this.host.tenant);
      const row = await db
        .table("clients")
        .where({ client_id: this.input.clientId, tenant: this.host.tenant })
        .first();
      if (!row) {
        throw new Error(
          `Client ${this.input.clientId} not found in tenant ${this.host.tenant}`,
        );
      }
      return row as ClientRow;
    })();
    return this.clientRowPromise;
  }

  async client() {
    const row = await this.clientRow();
    return { clientId: row.client_id, isTaxExempt: row.is_tax_exempt };
  }

  /* -------------------------------------------------------------- */
  /* Timing                                                         */
  /* -------------------------------------------------------------- */

  async resolveTiming(request: TimingRequest): Promise<TimingResolution> {
    const {
      projectTarget,
      recurringTimingSelections,
      recurringTimingSelectionSource,
      billingPeriod,
      clientContractLine,
    } = this.input;

    if (projectTarget && request.policy === "service-driven") {
      // Project-driven billing is not cadence-driven: there is no persisted
      // recurring service period record backing these charges.
      return {
        status: "due",
        timing: {
          servicePeriodRecordId: null,
          duePosition: "arrears",
          servicePeriodStart: billingPeriod.startDate,
          servicePeriodEnd: billingPeriod.endDate,
          servicePeriodStartExclusive: billingPeriod.startDate,
          servicePeriodEndExclusive: billingPeriod.endDate,
          coverageRatio: 1,
        },
      };
    }
    const recurringTimingSelection = recurringTimingSelections?.[request.stream];
    if (recurringTimingSelection) {
      return { status: "due", timing: recurringTimingSelection };
    }
    if (recurringTimingSelectionSource === "persisted") {
      return { status: "not-due" };
    }
    // A stream other than the line's own (a cadence block fee) is due only by
    // its persisted service period; there is no derived timing to fall back on.
    if (request.stream !== "line") {
      return { status: "not-due" };
    }

    const legacyUntimed =
      this.input.untimedWithoutCadence &&
      request.policy === "recurring" &&
      !this.input.billingCycle &&
      !recurringTimingSelectionSource;
    if (legacyUntimed) return { status: "untimed" };

    const cycle =
      this.input.billingCycle ??
      (await this.host.getBillingCycle(this.input.clientId, billingPeriod.startDate));
    if (!cycle) {
      throw new Error(
        "Billing cycle source rule is required when deriving recurring timing outside persisted service periods",
      );
    }
    const timing = this.host.buildRecurringChargeTimingSelection(
      billingPeriod,
      clientContractLine,
      cycle,
    );
    return timing ? { status: "due", timing } : { status: "not-due" };
  }

  /* -------------------------------------------------------------- */
  /* Tax / profile                                                  */
  /* -------------------------------------------------------------- */

  async taxContext(demand: TaxContextDemand): Promise<ChargeComputeTaxContext> {
    return this.host.loadChargeComputeTaxContext({
      client: await this.clientRow(),
      locationId: demand.locationId,
      services: demand.taxRateIds.map((taxRateId) => ({ tax_rate_id: taxRateId })),
      billingProfileIds: demand.billingProfileIds,
    });
  }

  billingProfile(): Promise<ResolvedBillingProfileAssignments | null> {
    return this.host.loadChargeProfileAssignments(
      this.input.clientId,
      this.input.clientContractLine,
    );
  }

  /* -------------------------------------------------------------- */
  /* Pools                                                          */
  /* -------------------------------------------------------------- */

  async pools(): Promise<PoolDefinition[]> {
    const db = tenantDb(this.host.knex, this.host.tenant);
    // Pools are keyed by the owning contract line (contract_lines.contract_line_id),
    // not by the client_contract_line alias the engine's line query also exposes.
    const rows: PoolRow[] = await db
      .table<any>("contract_line_buckets as clb")
      .where({
        "clb.tenant": this.host.tenant,
        "clb.contract_line_id": this.input.clientContractLine.contract_line_id,
      })
      .select("clb.*");
    if (rows.length === 0) return [];
    // Stable order: multi-pool charges were previously emitted in query
    // completion order.
    rows.sort((left, right) => left.bucket_id.localeCompare(right.bucket_id));

    const members = await db
      .table<any>("contract_line_bucket_services")
      .where({ tenant: this.host.tenant })
      .whereIn(
        "bucket_id",
        rows.map((row) => row.bucket_id),
      )
      .select("bucket_id", "service_id")
      .orderBy("service_id", "asc");

    return rows.map((row) => {
      this.poolRows.set(row.bucket_id, row);
      return {
        poolId: row.bucket_id,
        contractLineId: row.contract_line_id,
        coversAllServices: Boolean(row.covers_all_services),
        memberServiceIds: members
          .filter((member) => member.bucket_id === row.bucket_id)
          .map((member) => member.service_id as string),
      };
    });
  }

  async configuredServiceIds(): Promise<string[]> {
    const db = tenantDb(this.host.knex, this.host.tenant);
    const rows = await db
      .table<any>("contract_line_service_configuration")
      .where({
        tenant: this.host.tenant,
        contract_line_id: this.input.clientContractLine.contract_line_id,
      })
      .select("service_id", "configuration_type");
    this.loadedServices = rows.map((row) => ({
      serviceId: row.service_id as string,
      configurationType: (row.configuration_type as string | null) ?? null,
    }));
    return Array.from(new Set(rows.map((row) => row.service_id as string)));
  }

  /** Only what configuredServiceIds() already read; never a new query. */
  async configuredServices(): Promise<ConfiguredService[] | null> {
    return this.loadedServices;
  }

  async poolPeriodState(
    pool: PoolDefinition,
    timing: ResolvedBillingTiming | undefined,
  ): Promise<PoolPeriodState> {
    const { host } = this;
    const tenant = host.tenant;
    const db = tenantDb(host.knex, tenant);
    const clientId = this.input.clientId;
    const poolRow = this.poolRows.get(pool.poolId);
    if (!poolRow) {
      throw new Error(`Pool ${pool.poolId} was not loaded by pools()`);
    }

    const emptyState = (): PoolPeriodState => ({
      pool,
      configuration: {
        configurationId: pool.poolId,
        serviceId: null,
        serviceName: "",
        taxRateId: null,
        unitOfMeasure: null,
        billingMethod: null,
        includedMinutes: Number(poolRow.total_minutes),
        overageRate: Number(poolRow.overage_rate),
        allowRollover: Boolean(poolRow.allow_rollover),
        weighted: false,
      },
      periods: [],
      taxRateIds: [],
    });

    const usageRecords = await db
      .table("bucket_usage")
      .where({ tenant, client_id: clientId, bucket_id: pool.poolId })
      .where(
        "period_start",
        ">=",
        timing?.servicePeriodStartExclusive ?? this.input.billingPeriod.startDate,
      )
      .where(
        "period_end",
        "<=",
        timing?.servicePeriodEnd ?? this.input.billingPeriod.endDate,
      )
      .select("*");
    if (usageRecords.length === 0) return emptyState();

    // Pool display name: bucket_name when set, else the member service name
    // (or the bucket's id as a last resort).
    const members = await db
      .table("contract_line_bucket_services as clbs")
      .where({ "clbs.tenant": tenant, "clbs.bucket_id": pool.poolId })
      .select(
        "clbs.service_id",
        "sc.service_name",
        "sc.tax_rate_id",
        "sc.unit_of_measure",
        "sc.unit_code",
        "sc.billing_method",
      )
      .join("service_catalog as sc", function (this: any) {
        this.on("sc.service_id", "=", "clbs.service_id").andOn(
          "sc.tenant",
          "=",
          "clbs.tenant",
        );
      })
      .orderBy("clbs.service_id", "asc");
    const memberMetadataByService = new Map<string, ServiceMetadata>(
      members.map((member) => [
        member.service_id as string,
        {
          service_name: member.service_name as string,
          tax_rate_id: (member.tax_rate_id as string | null) ?? null,
          unit_of_measure: (member.unit_of_measure as string | null) ?? null,
          unit_code: (member.unit_code as string | null) ?? null,
          billing_method: (member.billing_method as string | null) ?? null,
        },
      ]),
    );
    const serviceName = poolRow.bucket_name
      ? poolRow.bucket_name
      : members.length === 1
        ? (members[0].service_name as string)
        : `Bucket pool ${String(pool.poolId).slice(0, 8)}`;

    // Weighted when any member multiplier != 1 or an after-hours rule exists.
    const memberMultipliers = await db
      .table("contract_line_bucket_services")
      .where({ tenant, bucket_id: pool.poolId })
      .select("burn_multiplier")
      .orderBy("service_id", "asc");
    const weighted =
      Number(poolRow.after_hours_multiplier) !== 0 ||
      memberMultipliers.some((member) => Number(member.burn_multiplier) !== 1);

    // A zero-member pool (dormant catch-all or emptied member-scoped pool)
    // still covers the line but has no member to key the charge on. The pool
    // identity is carried honestly in configurationId (= bucket_id); the service
    // FK fields stay null so bucket_id NEVER masquerades as a service_catalog id
    // on invoice rows.
    const first = members[0];
    const hasMembers = members.length > 0;

    // Per-period weighted contributions: the SAME draw set and weighted math
    // the reconciliation uses. Overage is attributed to the services that
    // actually burned it (pro-rata by weighted minutes), never an arbitrary
    // member. A catch-all non-member contributor still earns its own portion
    // with its own catalog tax metadata.
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
      contributionsByPeriod.set(
        key,
        await computePoolContributionsByService(host.knex, tenant, {
          bucketId: pool.poolId,
          contractLineId: poolRow.contract_line_id,
          coversAllServices: pool.coversAllServices,
          periodStart: new Date(`${startIso}T00:00:00.000Z`),
          periodEndExclusive: endExclusive,
        }),
      );
    }

    // Catalog metadata for contributors that are not explicit members of the
    // pool (a catch-all non-member burns at 1x and still contributes).
    const contributorServiceIds = Array.from(contributionsByPeriod.values())
      .flat()
      .map((contribution) => contribution.serviceId);
    const catalogServiceIds = Array.from(
      new Set(contributorServiceIds.filter((id) => !memberMetadataByService.has(id))),
    );
    const catalogMetadataByService = new Map<string, ServiceMetadata>();
    if (catalogServiceIds.length > 0) {
      const catalogRows = await db
        .table("service_catalog as sc")
        .where({ "sc.tenant": tenant })
        .whereIn("sc.service_id", catalogServiceIds)
        .select(
          "sc.service_id",
          "sc.service_name",
          "sc.tax_rate_id",
          "sc.unit_of_measure",
          "sc.unit_code",
          "sc.billing_method",
        );
      for (const row of catalogRows) {
        catalogMetadataByService.set(row.service_id as string, {
          service_name: row.service_name as string,
          tax_rate_id: (row.tax_rate_id as string | null) ?? null,
          unit_of_measure: (row.unit_of_measure as string | null) ?? null,
          unit_code: (row.unit_code as string | null) ?? null,
          billing_method: (row.billing_method as string | null) ?? null,
        });
      }
    }
    const metadataFor = (serviceId: string) =>
      memberMetadataByService.get(serviceId) ??
      catalogMetadataByService.get(serviceId);

    const chargeTaxRateId = hasMembers
      ? ((first.tax_rate_id as string | null) ?? null)
      : null;

    const periodContributions: FactsOf<"bucket">["periodContributions"] =
      Array.from(contributionsByPeriod.entries()).map(([key, contributions]) => {
        const [start, end] = key.split(":");
        return {
          start,
          end,
          services: contributions.map((contribution) => {
            const metadata = metadataFor(contribution.serviceId);
            return {
              serviceId: contribution.serviceId,
              serviceName: poolRow.bucket_name ?? metadata?.service_name ?? undefined,
              taxRateId: metadata?.tax_rate_id ?? null,
              unitOfMeasure: metadata?.unit_of_measure ?? null,
              billingMethod: metadata?.billing_method ?? null,
              weightedMinutes: contribution.weightedMinutes,
            };
          }),
        };
      });

    return {
      pool,
      configuration: {
        configurationId: pool.poolId,
        serviceId: (first?.service_id as string | undefined) ?? null,
        serviceName,
        taxRateId: chargeTaxRateId,
        unitOfMeasure: hasMembers
          ? ((first.unit_of_measure as string | null) ?? null)
          : null,
        billingMethod: hasMembers
          ? ((first.billing_method as string | null) ?? null)
          : null,
        includedMinutes: poolRow.total_minutes,
        overageRate: poolRow.overage_rate,
        allowRollover: poolRow.allow_rollover,
        weighted,
      },
      periodContributions,
      periods: usageRecords.map((period) => ({
        start:
          period.period_start instanceof Date
            ? period.period_start.toISOString()
            : period.period_start,
        end:
          period.period_end instanceof Date
            ? period.period_end.toISOString()
            : period.period_end,
        minutesUsed: period.minutes_used,
        hoursUsed: period.hours_used,
        overageMinutes: period.overage_minutes,
        overageHours: period.overage_hours,
        rolledOverMinutes: period.rolled_over_minutes,
      })),
      taxRateIds: [
        ...contributorServiceIds.map(
          (serviceId) => metadataFor(serviceId)?.tax_rate_id ?? null,
        ),
        chargeTaxRateId,
      ],
    };
  }

  /* -------------------------------------------------------------- */
  /* Families                                                       */
  /* -------------------------------------------------------------- */

  async fixed(timing: ResolvedBillingTiming) {
    return this.drain<"fixed">((sink) => this.input.loaders.fixed(timing, sink));
  }

  async hourly(timing: ResolvedBillingTiming, exclusion: PooledTimeExclusion | null) {
    return this.drain<"hourly">((sink) =>
      this.input.loaders.hourly(timing, exclusion, sink),
    );
  }

  async usage(timing: ResolvedBillingTiming) {
    return this.drain<"usage">((sink) => this.input.loaders.usage(timing, sink));
  }

  async recurringQuantity(kind: "product" | "license", timing: ResolvedBillingTiming) {
    return this.drain<"product" | "license">((sink) =>
      this.input.loaders.recurringQuantity(kind, timing, sink),
    );
  }

  async prepaidBlockIssuances(): Promise<PrepaidBlockIssuanceSupply[]> {
    const ids = this.input.prepaidBlockIssuanceIds ?? [];
    return ids.length > 0 ? this.input.loaders.prepaidBlockIssuances(ids) : [];
  }

  private cadenceBlock?: Promise<CadencePrepaidBlockSupply | null>;

  /** Memoized: the resolver asks once per stream and once for the overage flag. */
  cadencePrepaidBlock(): Promise<CadencePrepaidBlockSupply | null> {
    // Blocks belong to a line's service periods; the document-scope and
    // project-driven sources have no such line.
    if (this.input.documentScope || this.input.projectTarget) {
      return Promise.resolve(null);
    }
    this.cadenceBlock ??= this.input.loaders.cadencePrepaidBlock();
    return this.cadenceBlock;
  }

  async prepaidCoverage(entryIds: string[]): Promise<PrepaidCoverageRow[]> {
    // Project-driven runs price project work, not a line's service period.
    if (this.input.projectTarget || entryIds.length === 0) return [];
    return this.input.loaders.prepaidCoverage(entryIds);
  }

  async hourBlockDraws(): Promise<HourBlockDrawSupply | null> {
    const { recurringTimingSelections, recurringTimingSelectionSource, billingCycle } =
      this.input;
    // Without a cycle, a selected timing or persisted periods there is no
    // service period to read draws for.
    if (
      !billingCycle &&
      !recurringTimingSelections?.line &&
      recurringTimingSelectionSource !== "persisted"
    ) {
      return null;
    }
    const resolution = await this.resolveTiming({
      policy: "service-driven",
      stream: "line",
    });
    if (resolution.status !== "due") return null;
    const { timing } = resolution;
    return {
      period: { startDate: timing.servicePeriodStart, endDate: timing.servicePeriodEnd },
      timing,
      allocations: await this.input.loaders.hourBlockDraws(timing),
    };
  }

  private async drain<F extends ChargeFamily>(
    load: (sink: ContractObligationSink) => Promise<void>,
  ): Promise<SuppliedCharge<F> | null> {
    const sink: ContractObligationSink = { obligations: [], taxContexts: {} };
    await load(sink);
    // Usage statuses are reported even when no charge is produced ("no usage
    // reported" is exactly that case), so they ride on the source, not the charge.
    if (sink.usageStatuses) this.usageStatuses.push(...sink.usageStatuses);
    const [obligation, ...rest] = sink.obligations;
    if (!obligation) return null;
    if (rest.length > 0) {
      throw new Error("A family loader produced more than one obligation");
    }
    return {
      facts: obligation.facts as FactsOf<F>,
      taxContext: sink.taxContexts[obligation.taxContextKey],
      metadata: obligation.metadata,
    };
  }
}
