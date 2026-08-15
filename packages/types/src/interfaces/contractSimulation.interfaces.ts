import type { ISO8601String } from "../lib/temporal";
import type { CadenceOwner } from "./recurringTiming.interfaces";
import type { ChargeExplanation } from "./billingCompute.interfaces";
import type { BillingCycleType } from "./billing.interfaces";
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
  /** Cents. Null falls back to the service catalog default rate. */
  base_rate: number | null;
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
  services: ScenarioLineService[];
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
  fixed_base_rate?: number;
  fixed_billing_frequency?: string;
  fixed_services: Array<{
    service_id: string;
    service_name?: string;
    quantity: number;
    bucket_overlay?: ContractDraftBucketOverlayInput | null;
  }>;
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

export interface SimulationDiagnostic {
  severity: "info" | "warning";
  message: string;
  line_key?: string;
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
