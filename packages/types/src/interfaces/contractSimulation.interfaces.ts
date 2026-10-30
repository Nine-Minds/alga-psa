import type { ISO8601String } from "../lib/temporal";
import type { CadenceOwner } from "./recurringTiming.interfaces";
import type { ChargeExplanation } from "./billingCompute.interfaces";
import type { BillingCycleType } from "./billing.interfaces";
import type { FixedPricingBasis } from "./contractLineServiceConfiguration.interfaces";
import type { WasmInvoiceViewModel } from "../lib/invoice-renderer/types";

/**
 * Contract simulator scenario model (EE feature; types are shared so CE code
 * can typecheck the guarded actions). A scenario is a self-contained,
 * serializable draft of everything billing-relevant about a contract: the
 * simulator prices it through the shared pure compute layer without touching
 * the live contract or writing any rows.
 *
 * All monetary values are integer minor units (cents) unless noted.
 */

export type ScenarioConfigurationType = "Fixed" | "Hourly" | "Usage" | "Bucket";

export interface ScenarioRateTier {
  min_quantity: number;
  max_quantity: number | null;
  /** Cents per unit. */
  rate: number;
}

/**
 * Weighted-burn pool preservation, shared by every service config type. When
 * the source (line, service) resolves to a pool (explicit membership, else the
 * line catch-all), the snapshot carries the pool's own identity and full
 * configuration so a snapshot → restore round-trip faithfully reproduces the
 * line-owned shared pool — including on Hourly and Usage services, where the
 * pool is a sibling row rather than the service's own Bucket config. All
 * fields optional so draft-shaped scenarios (which only know per-service
 * totals) still typecheck.
 */
export interface ScenarioPoolRef {
  pool_id?: string | null;
  pool_name?: string | null;
  covers_all_services?: boolean;
  /** True = the service has an explicit membership row in the pool (a
   * multiplier override, even at 1x); false = the service draws from the pool
   * only via the line catch-all as a non-member. Required so snapshot →
   * restore does not confuse a 1x catch-all non-member with a 1x explicit
   * member. */
  is_pool_member?: boolean;
  burn_multiplier?: number;
  after_hours_multiplier?: number | null;
  business_hours_schedule_id?: string | null;
}

export interface ScenarioFixedConfig {
  configuration_type: "Fixed";
  /**
   * Cents. Null falls back to the service catalog default rate. For a
   * 'unit' member this is the operator's unit-rate override (the same value a
   * persisted unit configuration stores in `base_rate`).
   */
  base_rate: number | null;
  /**
   * What `base_rate` means: 'per_unit' (× quantity) or 'share' (the member's
   * slice of the line fee, as-is). Absent on a non-null rate reads as per_unit.
   * Interpreted by `fixedMemberRate` in shared/billingClients.
   */
  base_rate_basis?: "per_unit" | "share" | null;
  /**
   * 'unit' bills quantity × unit rate (zero bills zero) through the shared
   * fixed-charge path; absent/'bundle' keeps allocation semantics.
   */
  pricing_basis?: FixedPricingBasis | null;
}

export interface ScenarioHourlyConfig extends ScenarioPoolRef {
  configuration_type: "Hourly";
  /** Cents per hour. */
  hourly_rate: number | null;
  minimum_billable_time: number;
  round_up_to_nearest: number;
  user_type_rates: Array<{ user_type: string; rate: number }>;
}

export interface ScenarioUsageConfig extends ScenarioPoolRef {
  configuration_type: "Usage";
  unit_of_measure: string;
  enable_tiered_pricing: boolean;
  minimum_usage: number | null;
  /** Cents per unit. */
  base_rate: number | null;
  tiers: ScenarioRateTier[];
}

export interface ScenarioBucketConfig extends ScenarioPoolRef {
  configuration_type: "Bucket";
  total_minutes: number;
  billing_period: string;
  /** Cents per hour of overage. */
  overage_rate: number;
  allow_rollover: boolean;
}

export type ScenarioServiceConfig =
  | ScenarioFixedConfig
  | ScenarioHourlyConfig
  | ScenarioUsageConfig
  | ScenarioBucketConfig;

export interface ScenarioLineService {
  /** Stable configuration row identity; distinguishes a primary config from a Bucket overlay. */
  configuration_id?: string;
  service_id: string;
  service_name: string;
  /** Effective quantity (configuration override -> service row -> 1). */
  quantity: number;
  /** Effective service override (configuration override -> service row). */
  custom_rate: number | null;
  /** Currency-specific service_prices rate in cents; null means unpriceable without an override. */
  default_rate: number | null;
  /** Currency-agnostic legacy catalog rate, retained for display/audit only. */
  legacy_default_rate?: number | null;
  service_quantity?: number | null;
  service_custom_rate?: number | null;
  configuration_quantity?: number | null;
  configuration_custom_rate?: number | null;
  tax_rate_id: string | null;
  item_kind: string | null;
  is_license: boolean;
  configuration: ScenarioServiceConfig;
}

export interface ScenarioCatalogService {
  service_id: string;
  service_name: string;
  currency_rate: number | null;
  legacy_default_rate: number | null;
  tax_rate_id: string | null;
  item_kind: string | null;
  is_license: boolean;
}

/**
 * A line-owned allowance pool (`contract_line_buckets` /
 * `contract_template_line_buckets`) with its members. Carried on the line so a
 * pool is simulated whether or not any service holds a Bucket config: the
 * allowance lives here, the scenario's services only reference it through
 * ScenarioPoolRef. Optional: scenarios without it fall back to the pools their
 * Bucket-config services describe (legacy service bucket config, drafts).
 */
export interface ScenarioPool {
  pool_id: string;
  pool_name: string | null;
  covers_all_services: boolean;
  total_minutes: number;
  billing_period: string;
  /** Cents per hour (or per unit on a Usage line) of overage. */
  overage_rate: number;
  allow_rollover: boolean;
  after_hours_multiplier: number | null;
  business_hours_schedule_id: string | null;
  /** Explicit members with their burn multipliers. */
  members: Array<{ service_id: string; burn_multiplier: number }>;
}

/**
 * Prepaid Block overlay on an Hourly scenario line (contract_line_prepaid_blocks).
 * Present only on block lines; the line stays contract_line_type "Hourly".
 */
export interface ScenarioPrepaidBlockConfig {
  /** Block size in minutes. */
  block_minutes: number;
  /** Cents, in the scenario currency. */
  block_price: number;
  /** Catalog service the block invoice line is sold as (tax, GL, export mapping). */
  sold_as_service_id: string | null;
  /** Null = never expires. */
  expiry_months: number | null;
  trigger_on_exhaustion: boolean;
  /** 1-99, or null when no usage threshold is configured. */
  trigger_threshold_percent: number | null;
  trigger_on_expiry: boolean;
  /** Carried for display; renewal issuance is not simulated. */
  trigger_on_renewal: boolean;
  replenishment_tier: "draft" | "auto_issue";
  /** Defaults to 'consumption'. 'cadence' issues one block per service period, billed in advance. */
  issue_mode?: "consumption" | "cadence";
  /** Cadence mode: further periods an unused block stays valid (0..12). Defaults to 0. */
  rollover_periods?: number;
}

export interface ScenarioLine {
  /** Stable key inside the scenario: live contract_line_id or `scenario-<n>`. */
  key: string;
  /** Live row this line originated from; null for scenario-added lines. */
  origin_contract_line_id: string | null;
  contract_line_name: string;
  contract_line_type: "Fixed" | "Hourly" | "Usage";
  billing_frequency: string;
  billing_timing: "arrears" | "advance";
  cadence_owner: CadenceOwner;
  /** Cents; line-level custom rate (Fixed lines). */
  custom_rate: number | null;
  enable_proration: boolean;
  location_id: string | null;
  enable_overtime: boolean;
  overtime_threshold: number | null;
  /** Cents per hour. */
  overtime_rate: number | null;
  /** Prepaid Block config when this Hourly line sells prepaid blocks. */
  prepaid_block?: ScenarioPrepaidBlockConfig | null;
  services: ScenarioLineService[];
  /** Line-owned pools; see ScenarioPool. */
  pools?: ScenarioPool[];
}

export interface ScenarioPricingSchedule {
  effective_date: ISO8601String;
  end_date: ISO8601String | null;
  /** Cents. */
  custom_rate: number | null;
}

export interface ScenarioDiscount {
  discount_id: string;
  discount_name: string;
  discount_type: "percentage" | "fixed";
  value: number;
  start_date: ISO8601String;
  end_date: ISO8601String | null;
  /** Scenario line keys this discount is linked to. */
  contract_line_keys: string[];
}

export interface ScenarioAdjustment {
  description: string;
  /** Signed minor-unit amount; negative values are credits. */
  amount: number;
  /** Optional zero-based invoice period target. */
  period_index?: number | null;
  /** One-time adjustments produce a timeline marker. */
  one_time?: boolean;
}

export type ScenarioClientBinding =
  | { kind: "client"; client_id: string; client_name: string }
  | { kind: "profile"; tax_region: string | null; currency_code: string };

/**
 * Per activity-driven line service: flat per-period value with sparse
 * per-period overrides (period index -> value). Hours for hourly/bucket
 * services, units for usage services.
 */
export interface ScenarioAssumption {
  flat: number;
  overrides?: Record<number, number>;
}

export interface SimulationHorizon {
  start_date: ISO8601String;
  period_count: number;
}

export interface ScenarioAssumptionPrefill {
  assumptions: Record<string, ScenarioAssumption>;
  horizon?: SimulationHorizon;
  period_labels: string[];
  actual_invoices?: ScenarioReplayInvoice[];
}

export interface ScenarioReplayInvoice {
  invoice_id: string;
  invoice_number: string;
  status: string;
  period_start: ISO8601String;
  period_end: ISO8601String;
  lines: SimulatedInvoiceLine[];
  subtotal: number;
  tax: number;
  total: number;
  invoice_view_model: WasmInvoiceViewModel;
}

export interface ScenarioBillingSchedule {
  billing_cycle: BillingCycleType;
  anchor: {
    day_of_month: number | null;
    month_of_year: number | null;
    day_of_week: number | null;
    reference_date: ISO8601String | null;
  };
  /**
   * The client's persisted (active) billing-cycle windows, [start, end). A
   * client that changed billing cycle was billed under the old cycle for these
   * windows; the simulator takes them verbatim and applies `billing_cycle` /
   * `anchor` (the current schedule) only outside them. Absent for a schedule
   * with no client (template contracts).
   */
  history?: Array<{
    start_date: ISO8601String;
    end_date: ISO8601String;
  }>;
}

export interface ContractScenario {
  scenario_id: string;
  name: string;
  contract_id: string | null;
  is_system_managed_default: boolean;
  client_binding: ScenarioClientBinding;
  invoice_schedule: ScenarioBillingSchedule;
  billing_frequency: string;
  contract_start_date: ISO8601String | null;
  contract_end_date: ISO8601String | null;
  currency_code: string;
  available_services?: ScenarioCatalogService[];
  lines: ScenarioLine[];
  pricing_schedules: ScenarioPricingSchedule[];
  discounts?: ScenarioDiscount[];
  adjustments?: ScenarioAdjustment[];
  /** Keyed `${line.key}:${service_id}`. */
  assumptions: Record<string, ScenarioAssumption>;
  horizon: SimulationHorizon;
}

export interface ContractDraftBucketOverlayInput {
  total_minutes?: number;
  overage_rate?: number;
  allow_rollover?: boolean;
  billing_period?: "monthly" | "weekly";
}

/** One fixed-line service member in the contract wizard (shared by wizard, resume, template snapshot and simulator). */
export interface ContractWizardFixedService {
  service_id: string;
  service_name?: string;
  /** Allocation quantity for 'bundle'; recurring seats/units (whole number >= 0) for 'unit'. */
  quantity: number;
  /** 'bundle' shares the line base rate; 'unit' bills quantity × unit_rate. */
  pricing_basis: FixedPricingBasis;
  /** Minor units of the contract currency. Only used when pricing_basis is 'unit'. */
  unit_rate?: number | null;
  bucket_overlay?: ContractDraftBucketOverlayInput | null;
  /** Draft-only resolved catalog rate in minor units. Never submitted. */
  resolved_rate?: number | null;
  /** Draft-only provenance for the resolved rate. Never submitted. */
  resolved_rate_source?: "currency-price" | "catalog-default" | "none";
}

/** One recurring Fixed contract line as the wizard holds it. */
export interface ContractWizardFixedLine {
  /** Stable client key (uuid); the source contract_line_id on resume. */
  line_key: string;
  /** Informational; finalize does not reuse ids. */
  source_contract_line_id?: string;
  /** Template line this fixed line was opened from; maps template line-scoped discounts. */
  source_template_line_id?: string;
  contract_line_name?: string;
  description?: string | null;
  location_id?: string | null;
  /** Falls back to the contract billing_frequency. */
  billing_frequency?: string;
  /** Falls back to the contract billing_timing. */
  billing_timing?: "arrears" | "advance";
  enable_proration: boolean;
  /** Bundle total in minor units; null/undefined follows the catalog. */
  base_rate?: number | null;
  services: ContractWizardFixedService[];
}

/**
 * A contract-wide automatic discount authored in the wizard, before the
 * contract (and therefore any discount row) exists. Values stay in the
 * authoring units the discount editor uses — percent units (`10` = 10%) or
 * decimal currency (`50` = $50.00) — and are converted once where they are
 * stored (`toStoredDiscountValue`) or simulated.
 */
export interface ContractDraftDiscount {
  /** Stable client-side key for list editing; never persisted. */
  draft_key: string;
  discount_name: string;
  discount_type: "percentage" | "fixed";
  value: number;
  /** Date-only (YYYY-MM-DD). */
  start_date: string;
  /** Date-only (YYYY-MM-DD); null/absent never expires. */
  end_date?: string | null;
}

/**
 * A line-level bucket pool authored in the wizard (structurally the wizard's
 * `BucketPoolDraft`). Units match what the wizard submits: minutes and cents.
 */
export interface ContractDraftBucketPoolInput {
  /** Which wizard line the pool belongs to; absent means 'hourly'. */
  line_key?: "hourly" | "usage";
  bucket_name?: string | null;
  total_minutes: number;
  overage_rate: number;
  allow_rollover: boolean;
  covers_all_services: boolean;
  after_hours_multiplier?: number | null;
  business_hours_schedule_id?: string | null;
  members: Array<{
    service_id: string;
    service_name?: string;
    burn_multiplier: number;
  }>;
}

/** A wizard Prepaid Block line: its own Hourly services plus the block config (minor units of the draft currency). */
export interface ContractDraftPrepaidBlockLine {
  name?: string;
  services: Array<{ service_id: string; service_name?: string; hourly_rate?: number }>;
  block: {
    block_minutes: number;
    block_price: number;
    sold_as_service_id?: string | null;
    expiry_months?: number | null;
    trigger_on_exhaustion?: boolean;
    trigger_threshold_percent?: number | null;
    trigger_on_expiry?: boolean;
    trigger_on_renewal?: boolean;
    replenishment_tier?: "draft" | "auto_issue";
    issue_mode?: "consumption" | "cadence";
    rollover_periods?: number;
  };
}

/** Minimal unsaved ContractWizard state accepted by the EE scenario hydrator. */
export interface ContractDraftSimulationInput {
  client_id: string;
  contract_name: string;
  start_date: ISO8601String;
  end_date?: ISO8601String;
  billing_frequency: string;
  currency_code: string;
  cadence_owner?: CadenceOwner;
  billing_timing?: "arrears" | "advance";
  enable_proration: boolean;
  fixed_lines: ContractWizardFixedLine[];
  /** Products line's own timing; undefined inherits `billing_timing`. */
  product_billing_timing?: "arrears" | "advance";
  product_services: Array<{
    service_id: string;
    service_name?: string;
    quantity: number;
    custom_rate?: number;
  }>;
  hourly_services: Array<{
    service_id: string;
    service_name?: string;
    hourly_rate?: number;
    bucket_overlay?: ContractDraftBucketOverlayInput | null;
  }>;
  hourly_billing_frequency?: string;
  minimum_billable_time?: number;
  round_up_to_nearest?: number;
  usage_services?: Array<{
    service_id: string;
    service_name?: string;
    unit_rate?: number;
    unit_of_measure?: string;
    bucket_overlay?: ContractDraftBucketOverlayInput | null;
  }>;
  usage_billing_frequency?: string;
  /** Line-level pools (members + burn multipliers); same model as saved pools. */
  bucket_pools?: ContractDraftBucketPoolInput[];
  /** Contract-wide discounts authored in the wizard, priced by the simulator. */
  discounts?: ContractDraftDiscount[];
  /** Prepaid Block lines (validated wizard drafts); each simulates its block issue like a saved block line. */
  prepaid_block_lines?: ContractDraftPrepaidBlockLine[];
}

/* ----------------------------- results ----------------------------- */

export type SimulatedPeriodMarker =
  | "prorated"
  | "bucket_overage"
  | "one_time"
  | "cadence_coincidence"
  | "contract_end";

export interface SimulatedInvoiceLine {
  line_key: string;
  /**
   * The saved contract line this charge came from. Issued and simulated lines
   * both carry it, so past-invoice comparison pairs on (origin line, charge
   * type, service) instead of on resolver keys or description text. Null for
   * lines with no saved origin (draft contracts, actual lines that are not
   * contract charges).
   */
  origin_contract_line_id?: string | null;
  service_id: string | null;
  service_name: string;
  charge_type: string;
  quantity_label: string;
  rate_label: string;
  quantity?: number;
  /** Integer minor-unit unit price. */
  unit_price?: number;
  /** Cents. */
  net_amount: number;
  /** Cents. */
  tax_amount: number;
  /** Cents. */
  total: number;
  explanation: ChargeExplanation | null;
  billing_timing?: "arrears" | "advance";
  service_period_start?: ISO8601String;
  service_period_end?: ISO8601String;
}

export interface SimulatedPeriod {
  index: number;
  period_start: ISO8601String;
  period_end: ISO8601String;
  label: string;
  lines: SimulatedInvoiceLine[];
  /** Cents. */
  subtotal: number;
  /** Cents. */
  tax: number;
  /** Cents. */
  total: number;
  markers: SimulatedPeriodMarker[];
  invoice_view_model: WasmInvoiceViewModel;
}

/**
 * A note on a simulation run. `info` and `warning` accompany priced periods.
 *
 * `error` is BLOCKING: the simulator refused to run (for example a service has
 * a configuration type it can't price). A result that carries any `error`
 * diagnostic has `periods: []` and therefore no totals; consumers must test
 * with {@link isSimulationBlocked} and show the diagnostic instead of totals,
 * and must not compare a blocked result (a blocked side has no figures, so a
 * delta against it would read as a misleading $0 change).
 *
 * `message` is the English text. `message_key` plus `message_params` is the
 * localized form (i18next `{{placeholders}}`); the structured fields name the
 * offending contract line, service and configuration type when known.
 */
export interface SimulationDiagnostic {
  severity: "info" | "warning" | "error";
  message: string;
  line_key?: string;
  code?: ContractSimulationErrorCode;
  message_key?: string;
  message_params?: Record<string, string | number>;
  line_name?: string;
  service_id?: string;
  service_name?: string;
  configuration_type?: string;
}

export interface ContractSimulationResult {
  scenario_id: string;
  currency_code: string;
  horizon: SimulationHorizon;
  periods: SimulatedPeriod[];
  diagnostics: SimulationDiagnostic[];
}

/* ----------------------------- compare ----------------------------- */

export interface SimulationLineDelta {
  line_key: string;
  service_id?: string | null;
  charge_type?: string;
  service_name: string;
  kind: "added" | "removed" | "changed";
  /** Cents; positive means the scenario bills more than the baseline. */
  delta: number;
}

export interface SimulationPeriodDelta {
  index: number;
  /** Cents. */
  total_delta: number;
  lines: SimulationLineDelta[];
}

export interface SimulationComparison {
  periods: SimulationPeriodDelta[];
  /** Cents. */
  horizon_total_delta: number;
}

/* ----------------------------- refusals ----------------------------- */

/**
 * Why the simulator refused to run, carried as the `code` of the coded error
 * the simulator throws internally and as the `code` of the resulting blocking
 * diagnostic. Each one is something the user can act on (fix the contract's
 * configuration, pick a client, change the replay range). The simulator entry
 * points convert these into a blocking result or a typed refusal; the action
 * boundary does the same as a backstop. Any error without one of these codes
 * is unexpected and is logged.
 */
export const CONTRACT_SIMULATION_ERROR_CODES = [
  "CONTRACT_SIMULATION_UNSUPPORTED_LINE_TYPE",
  "CONTRACT_SIMULATION_UNSUPPORTED_SERVICE_CONFIGURATION",
  "CONTRACT_SIMULATION_SERVICE_NOT_IN_CATALOG",
  "CONTRACT_SIMULATION_POOL_MISSING",
  "CONTRACT_SIMULATION_CONTRACT_NOT_FOUND",
  "CONTRACT_SIMULATION_CLIENT_NOT_AVAILABLE",
  "CONTRACT_SIMULATION_CLIENT_REQUIRED",
  "CONTRACT_SIMULATION_HISTORY_REQUIRES_CLIENT",
  "CONTRACT_SIMULATION_INVALID_REPLAY_RANGE",
  "CONTRACT_SIMULATION_SCENARIO_INVALID",
  "CONTRACT_SIMULATION_SCENARIO_REFERENCE_INVALID",
  /** Not a refusal the simulator chose: an unexpected failure the action boundary logged. */
  "CONTRACT_SIMULATION_UNEXPECTED",
] as const;

export type ContractSimulationErrorCode =
  (typeof CONTRACT_SIMULATION_ERROR_CODES)[number];

export function isContractSimulationErrorCode(
  value: unknown,
): value is ContractSimulationErrorCode {
  return (
    typeof value === "string" &&
    (CONTRACT_SIMULATION_ERROR_CODES as readonly string[]).includes(value)
  );
}

/** The shape of a thrown coded refusal (structurally a CodedError). */
export interface ContractSimulationRefusalError {
  message: string;
  code: string;
  messageKey?: string;
  messageParams?: Record<string, string | number>;
}

/** Whether `error` is a coded refusal from the simulator. */
export function isContractSimulationRefusalError(
  error: unknown,
): error is ContractSimulationRefusalError {
  return (
    error instanceof Error &&
    isContractSimulationErrorCode((error as { code?: unknown }).code)
  );
}

/**
 * The blocking diagnostic a refusal becomes. The structured fields come from
 * the refusal's params: lineKey, lineName, serviceId, serviceName,
 * configurationType.
 */
export function simulationRefusalToDiagnostic(
  error: ContractSimulationRefusalError,
): SimulationDiagnostic {
  const params = error.messageParams;
  const read = (name: string): string | undefined => {
    const value = params?.[name];
    return value === undefined || value === "" ? undefined : String(value);
  };
  const diagnostic: SimulationDiagnostic = {
    severity: "error",
    message: error.message,
    code: error.code as ContractSimulationErrorCode,
  };
  if (error.messageKey) diagnostic.message_key = error.messageKey;
  if (params) diagnostic.message_params = params;
  const lineKey = read("lineKey");
  const lineName = read("lineName");
  const serviceId = read("serviceId");
  const serviceName = read("serviceName");
  const configurationType = read("configurationType");
  if (lineKey) diagnostic.line_key = lineKey;
  if (lineName) diagnostic.line_name = lineName;
  if (serviceId) diagnostic.service_id = serviceId;
  if (serviceName) diagnostic.service_name = serviceName;
  if (configurationType) diagnostic.configuration_type = configurationType;
  return diagnostic;
}

/**
 * The result of a run the simulator refused: blocking diagnostics and no
 * periods, hence no totals.
 */
export function blockedSimulationResult(
  scenario:
    | Partial<Pick<ContractScenario, "scenario_id" | "currency_code" | "horizon">>
    | null
    | undefined,
  diagnostics: SimulationDiagnostic[],
): ContractSimulationResult {
  return {
    scenario_id: scenario?.scenario_id ?? "",
    currency_code: scenario?.currency_code || "USD",
    horizon: scenario?.horizon ?? { start_date: "", period_count: 0 },
    periods: [],
    diagnostics,
  };
}

/** True when the result carries a blocking diagnostic (and so has no totals). */
export function isSimulationBlocked(
  result: Pick<ContractSimulationResult, "diagnostics">,
): boolean {
  return result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

/** The blocking diagnostics of a result, in order. */
export function blockingDiagnostics(
  result: Pick<ContractSimulationResult, "diagnostics">,
): SimulationDiagnostic[] {
  return result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}

/**
 * Typed refusal for the actions that don't return a ContractSimulationResult
 * (snapshot, draft scenario, prefill). The UI renders `diagnostic` where the
 * scenario or prefill would have appeared.
 */
export interface ContractSimulationRefusal {
  refused: true;
  diagnostic: SimulationDiagnostic;
}

export function isContractSimulationRefusal(
  value: unknown,
): value is ContractSimulationRefusal {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ContractSimulationRefusal).refused === true
  );
}

/** Structured CE result for the EE-guarded simulator actions. */
export interface ContractSimulationUnavailable {
  available: false;
  reason: "not_enterprise";
}

export function isContractSimulationUnavailable(
  value: unknown,
): value is ContractSimulationUnavailable {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ContractSimulationUnavailable).available === false
  );
}
