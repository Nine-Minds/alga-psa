/**
 * Structured "why" emitted alongside each charge computed by the pure billing
 * compute layer (packages/billing/src/lib/billing/compute/). Production
 * callers may ignore explanations; the contract simulator surfaces them.
 */

export type ChargeComputeMarker =
  | 'proration'
  | 'bucket_overage'
  | 'one_time'
  | 'cadence_settlement'
  | 'minimum_applied'
  | 'rounding_applied'
  | 'overtime'
  | 'rate_tier'
  | 'pricing_schedule_override'
  | 'fmv_allocation';

export interface ChargeExplanationInput {
  label: string;
  /** Preformatted display value ("$2,400.00 / mo", "22 of 31 days"). */
  value: string;
}

export interface ChargeExplanation {
  /**
   * Correlates the explanation with its charge. Matches the charge's
   * config_id + serviceId where available, else the contract line id.
   */
  chargeKey: string;
  serviceName: string;
  chargeType: string;
  /** The inputs the arithmetic consumed, in display order. */
  inputs: ChargeExplanationInput[];
  /** Arithmetic, one step per entry, ending in the amount. */
  steps: string[];
  /** Optional plain-language remark ("Prorated — contract starts mid-period"). */
  note?: string;
  markers: ChargeComputeMarker[];
}
