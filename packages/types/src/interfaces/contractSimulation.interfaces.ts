import type { ISO8601String } from '../lib/temporal';
import type { CadenceOwner } from './recurringTiming.interfaces';
import type { ChargeExplanation } from './billingCompute.interfaces';

/**
 * Contract simulator scenario model (EE feature; types are shared so CE code
 * can typecheck the guarded actions). A scenario is a self-contained,
 * serializable draft of everything billing-relevant about a contract: the
 * simulator prices it through the shared pure compute layer without touching
 * the live contract or writing any rows.
 *
 * All monetary values are integer minor units (cents) unless noted.
 */

export type ScenarioConfigurationType = 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';

export interface ScenarioRateTier {
  min_quantity: number;
  max_quantity: number | null;
  /** Cents per unit. */
  rate: number;
}

export interface ScenarioFixedConfig {
  configuration_type: 'Fixed';
  /** Cents. Null falls back to the service catalog default rate. */
  base_rate: number | null;
}

export interface ScenarioHourlyConfig {
  configuration_type: 'Hourly';
  /** Cents per hour. */
  hourly_rate: number | null;
  minimum_billable_time: number;
  round_up_to_nearest: number;
  user_type_rates: Array<{ user_type: string; rate: number }>;
}

export interface ScenarioUsageConfig {
  configuration_type: 'Usage';
  unit_of_measure: string;
  enable_tiered_pricing: boolean;
  minimum_usage: number | null;
  /** Cents per unit. */
  base_rate: number | null;
  tiers: ScenarioRateTier[];
}

export interface ScenarioBucketConfig {
  configuration_type: 'Bucket';
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
  service_id: string;
  service_name: string;
  quantity: number;
  /** Cents; overrides catalog/config rates when set. */
  custom_rate: number | null;
  /** Catalog default rate in cents (currency-resolved), for rate fallback. */
  default_rate: number | null;
  tax_rate_id: string | null;
  configuration: ScenarioServiceConfig;
}

export interface ScenarioLine {
  /** Stable key inside the scenario: live contract_line_id or `scenario-<n>`. */
  key: string;
  /** Live row this line originated from; null for scenario-added lines. */
  origin_contract_line_id: string | null;
  contract_line_name: string;
  contract_line_type: 'Fixed' | 'Hourly' | 'Usage';
  billing_frequency: string;
  billing_timing: 'arrears' | 'advance';
  cadence_owner: CadenceOwner;
  /** Cents; line-level custom rate (Fixed lines). */
  custom_rate: number | null;
  enable_proration: boolean;
  services: ScenarioLineService[];
}

export interface ScenarioPricingSchedule {
  effective_date: ISO8601String;
  end_date: ISO8601String | null;
  /** Cents. */
  custom_rate: number | null;
}

export type ScenarioClientBinding =
  | { kind: 'client'; client_id: string; client_name: string }
  | { kind: 'profile'; tax_region: string | null; currency_code: string };

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

export interface ContractScenario {
  scenario_id: string;
  name: string;
  contract_id: string | null;
  client_binding: ScenarioClientBinding;
  billing_frequency: string;
  contract_start_date: ISO8601String | null;
  contract_end_date: ISO8601String | null;
  currency_code: string;
  lines: ScenarioLine[];
  pricing_schedules: ScenarioPricingSchedule[];
  /** Keyed `${line.key}:${service_id}`. */
  assumptions: Record<string, ScenarioAssumption>;
  horizon: SimulationHorizon;
}

/* ----------------------------- results ----------------------------- */

export type SimulatedPeriodMarker =
  | 'prorated'
  | 'bucket_overage'
  | 'one_time'
  | 'cadence_coincidence'
  | 'contract_end';

export interface SimulatedInvoiceLine {
  line_key: string;
  service_id: string | null;
  service_name: string;
  charge_type: string;
  quantity_label: string;
  rate_label: string;
  /** Cents. */
  net_amount: number;
  /** Cents. */
  tax_amount: number;
  /** Cents. */
  total: number;
  explanation: ChargeExplanation | null;
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
}

export interface SimulationDiagnostic {
  severity: 'info' | 'warning';
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
  service_name: string;
  kind: 'added' | 'removed' | 'changed';
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
  reason: 'not_enterprise';
}

export function isContractSimulationUnavailable(
  value: unknown
): value is ContractSimulationUnavailable {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ContractSimulationUnavailable).available === false
  );
}
