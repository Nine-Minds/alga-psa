/**
 * Shared contract charge resolution: the port (what a source must supply) and
 * the values that cross it.
 *
 * The resolver (resolveContractLineCharges.ts) holds every rule about WHICH
 * unpriced charges a contract line produces for a service period. A source only
 * supplies data: the database source (engine, live contracts) and the scenario
 * source (simulator: saved contracts, templates, drafts). Pricing is a separate
 * layer (domain/calculateContractBilling) and never appears here.
 */

import type { IBillingPeriod } from "@alga-psa/types";
import type {
  ChargeComputeTaxContext,
  HourBlockDrawRow,
  PrepaidBlockIssuanceInput,
} from "../compute";
import type {
  ResolvedBillingProfileAssignments,
  ResolvedBillingTiming,
  ResolvedContractBillingChargeFacts,
  ResolvedContractLineFacts,
  UnpricedContractBillingObligation,
} from "../domain";

export type ChargeFamily = ResolvedContractBillingChargeFacts["kind"];

export type FactsOf<F extends ChargeFamily> = Extract<
  ResolvedContractBillingChargeFacts,
  { kind: F }
>;

/* ------------------------------------------------------------------ */
/* Timing                                                             */
/* ------------------------------------------------------------------ */

/**
 * What one demand asks of the source's timing rule. `policy` names the existing
 * timing resolver the family uses today; `duePosition` lets a demand ask for a
 * position other than the line's own (e.g. a fee in advance and its overage in
 * arrears on one line). Only `line` is implemented: sources reject the others
 * explicitly rather than silently falling back to the line's position.
 */
export interface TimingRequest {
  policy: "fixed-recurring" | "service-driven" | "recurring";
  duePosition: "line" | "advance" | "arrears";
}

export type TimingResolution =
  /** The line is due for this window; charges are priced against `timing`. */
  | { status: "due"; timing: ResolvedBillingTiming }
  /** The line has no service period due here (or none persisted): no charge. */
  | { status: "not-due" }
  /**
   * Legacy isolated callers with no cadence information. Only the pool family
   * tolerates this (it prices whatever usage rows fall in the billing period).
   */
  | { status: "untimed" };

/* ------------------------------------------------------------------ */
/* Pools                                                              */
/* ------------------------------------------------------------------ */

export interface PoolDefinition {
  /** `contract_line_buckets.bucket_id` (live) or the scenario's pool identity. */
  poolId: string;
  /** The `contract_lines.contract_line_id` that owns the pool. */
  contractLineId: string;
  /** Catch-all: absorbs every service the line configures that no pool names. */
  coversAllServices: boolean;
  /** Services with an explicit membership row (a multiplier override, even at 1x). */
  memberServiceIds: string[];
}

/**
 * A source-supplied value: one pool's allowance state for one service period.
 * The resolver never computes pool state; the database source reads
 * `bucket_usage`, the scenario source simulates it (assumed hours, rollover
 * threaded across periods).
 */
export interface PoolPeriodState {
  pool: PoolDefinition;
  /** Everything the shared bucket compute needs, minus line/client/timing. */
  configuration: FactsOf<"bucket">["configuration"];
  periods: FactsOf<"bucket">["periods"];
  periodContributions?: FactsOf<"bucket">["periodContributions"];
  /** Tax rates of every service the pool charge may be attributed to. */
  taxRateIds: Array<string | null>;
  /** Identifies the charge inside the period; stable per (line, pool). */
  metadata?: UnpricedContractBillingObligation["metadata"];
}

/**
 * Time the resolver asks a source to leave out of plain hourly pricing because
 * a pool prices it. `attributedOnly` keeps today's rule: only time explicitly
 * attributed to the line is hidden; unassigned time keeps its existing
 * attribution path.
 */
export interface PooledTimeExclusion {
  serviceIds: string[];
  attributedOnly: true;
}

/* ------------------------------------------------------------------ */
/* Source output                                                      */
/* ------------------------------------------------------------------ */

/** One unpriced charge as a source supplies it (resolver assigns identity). */
export interface SuppliedCharge<F extends ChargeFamily = ChargeFamily> {
  facts: FactsOf<F>;
  taxContext: ChargeComputeTaxContext;
  metadata?: UnpricedContractBillingObligation["metadata"];
}

export interface TaxContextDemand {
  taxRateIds: Array<string | null>;
  billingProfileIds: Array<string | null | undefined>;
  locationId?: string | null;
}

/**
 * One block issuance as a source supplies it, before the resolver's checks
 * (see prepaidBlockRules.ts): the raw status, due date and sold-as/currency
 * configuration, and the business date it is judged against.
 */
export interface PrepaidBlockIssuanceSupply
  extends Omit<PrepaidBlockIssuanceInput, "soldAsServiceId" | "currencyCode"> {
  soldAsServiceId: string | null;
  currencyCode: string | null;
  /** `contract_line_block_issuances.status`. */
  status: string;
  /** ISO date the issuance falls due. */
  dueDate: string;
  /** The business date the source judges readiness on (ISO date). */
  readyAsOf: string;
  /** The issuance line's own profile assignments; null leaves the profile off. */
  billingProfile: ResolvedBillingProfileAssignments | null;
}

/** An allocation row; `block_status` is the draw block's lifecycle status. */
export interface HourBlockDrawSupplyRow extends HourBlockDrawRow {
  block_status: string;
}

/**
 * The draws of a line's prepaid blocks inside the window the source chose,
 * oldest block first. `timing` is the line's service period when the source
 * derived the window from one (it feeds discount evaluation windows).
 */
export interface HourBlockDrawSupply {
  period: { startDate: string; endDate: string };
  timing?: ResolvedBillingTiming;
  allocations: HourBlockDrawSupplyRow[];
}

export interface ConfiguredService {
  serviceId: string;
  /** `contract_line_service_configuration.configuration_type`. */
  configurationType: string | null;
}

export interface ContractChargeSource {
  /** The line these charges belong to. */
  readonly line: ResolvedContractLineFacts;
  /** Async so a source can defer its client lookup until a family needs it. */
  client(): Promise<{ clientId: string; isTaxExempt?: boolean | null }>;
  /** Billing window the charges are priced inside (pool and tax context). */
  readonly billingPeriod?: IBillingPeriod;

  resolveTiming(request: TimingRequest): Promise<TimingResolution>;

  /** Tax context for charges the resolver itself assembles (pool charges). */
  taxContext(demand: TaxContextDemand): Promise<ChargeComputeTaxContext>;
  billingProfile(): Promise<ResolvedBillingProfileAssignments | null>;

  /** The line's pools, in a stable order. Static definitions only. */
  pools(): Promise<PoolDefinition[]>;
  /**
   * Services the line configures (any family). A catch-all pool absorbs only
   * these: "covers all line services", not "anything this client bills".
   */
  configuredServiceIds(): Promise<string[]>;
  /**
   * The same services with the kind each is configured as
   * (`configuration_type`), or `null` when the source has not loaded them.
   * Never issues a new query: it returns what the source already holds. The
   * resolver checks every kind against what the registry's families declare
   * they handle; it never interprets the kinds.
   */
  configuredServices(): Promise<ConfiguredService[] | null>;
  /**
   * Called when the line has something no family handles (see
   * ResolutionDiagnostics). Optional: a source that must fail loudly (the
   * simulator) throws here; the engine omits it and reports the returned
   * diagnostics instead.
   */
  reportUnhandled?(diagnostics: ResolutionDiagnostics): void;
  /**
   * One pool's allowance state for `timing` (see PoolPeriodState). `periods`
   * empty means the pool has nothing to charge for this window.
   */
  poolPeriodState(
    pool: PoolDefinition,
    timing: ResolvedBillingTiming | undefined,
  ): Promise<PoolPeriodState>;

  /**
   * The prepaid-block issuances this source selected for invoicing (the
   * engine: those named by the caller; the simulator: the block timeline's
   * issues for this window), in invoice order. Raw data: the resolver decides
   * which of them become charges.
   */
  prepaidBlockIssuances(): Promise<PrepaidBlockIssuanceSupply[]>;
  /**
   * Draws of the line's prepaid blocks in the source's window, or null when
   * the source has no window for the line (e.g. no service period due).
   */
  hourBlockDraws(): Promise<HourBlockDrawSupply | null>;

  fixed(timing: ResolvedBillingTiming): Promise<SuppliedCharge<"fixed"> | null>;
  hourly(
    timing: ResolvedBillingTiming,
    exclusion: PooledTimeExclusion | null,
  ): Promise<SuppliedCharge<"hourly"> | null>;
  usage(timing: ResolvedBillingTiming): Promise<SuppliedCharge<"usage"> | null>;
  recurringQuantity(
    kind: "product" | "license",
    timing: ResolvedBillingTiming,
  ): Promise<SuppliedCharge<"product" | "license"> | null>;
}

/* ------------------------------------------------------------------ */
/* Resolver output                                                    */
/* ------------------------------------------------------------------ */

export interface ResolvedLineCharge {
  family: ChargeFamily;
  obligation: UnpricedContractBillingObligation;
  taxContext: ChargeComputeTaxContext;
}

/** What a line configures that no registry family handles. */
export interface ResolutionDiagnostics {
  /** The line's `contract_line_type` when no family handles it, else null. */
  unhandledLineType: string | null;
  /** Configured services whose `configuration_type` no family handles. */
  unhandledServices: ConfiguredService[];
}

export interface ResolvedContractLineCharges {
  charges: ResolvedLineCharge[];
  diagnostics: ResolutionDiagnostics;
}

export interface ResolveContractLineChargesOptions {
  /** Families to emit, in registry order. Default: all. */
  families?: ReadonlySet<ChargeFamily>;
  /**
   * `ignore` skips pool lookups entirely: no pool charge, no pooled-time
   * exclusion. Used by project-driven runs, which are not pool-aware.
   */
  pools?: "apply" | "ignore";
}
