import { TenantEntity } from './index';
import type { ISO8601String } from '../lib/temporal';

/**
 * Base interface for all contract line service configurations
 */
export interface IContractLineServiceConfiguration extends TenantEntity {
  config_id: string;
  contract_line_id: string;
  service_id: string;
  configuration_type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';
  custom_rate?: number | null;
  quantity?: number;
  instance_name?: string;
  tenant: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Interface for fixed price service configuration
 */
export interface IContractLineServiceFixedConfig extends TenantEntity {
  effective_period_start?: string;
  config_id: string;
  base_rate?: number | null; // Added base_rate field
  /**
   * Explicit pricing basis for the fixed service configuration.
   *
   * - 'bundle' (legacy, also represented by NULL) — the fixed line carries a
   *   line-level total that is authoritative; member services are allocations
   *   (FMV split) and never individually unit-billed.
   * - 'unit' — recurring seats/units: this member bills configuration
   *   quantity × base_rate (unit rate, cents) with no hidden line-total
   *   precedence and no quantity fallback to 1 (zero means zero).
   */
  pricing_basis?: 'unit' | 'bundle' | null;
  // enable_proration: boolean; // Removed: Moved to contract_line_fixed_config
  // billing_cycle_alignment: 'start' | 'end' | 'prorated'; // Removed: Moved to contract_line_fixed_config
  tenant: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Interface for hourly service configuration
 */
export interface IContractLineServiceHourlyConfig extends TenantEntity {
  config_id: string;
  hourly_rate: number; // Added
  minimum_billable_time: number;
  round_up_to_nearest: number;
  // Removed contract-line-wide fields: enable_overtime, overtime_rate, overtime_threshold, enable_after_hours_rate, after_hours_multiplier
  tenant: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Interface for usage-based service configuration
 */
export interface IContractLineServiceUsageConfig extends TenantEntity {
  effective_period_start?: string;
  config_id: string;
  unit_of_measure: string;
  enable_tiered_pricing: boolean;
  minimum_usage?: number | null; // Make nullable to match DB and input
  base_rate?: number | null; // Add the new base_rate field
  /**
   * How this usage configuration is measured within a service period.
   *
   * - 'additive' (legacy) — dated consumption entries; each entry bills
   *   separately and minimums/tiers apply per entry.
   * - 'period_total' — one replaceable count for the whole service period;
   *   the reported count bills once and minimums/tiers apply once.
   */
  measurement_mode?: 'additive' | 'period_total' | null;
  tenant: string;
  created_at: Date;
  updated_at: Date;
}

export const USAGE_MEASUREMENT_MODES = ['additive', 'period_total'] as const;
export type UsageMeasurementMode = (typeof USAGE_MEASUREMENT_MODES)[number];

export const FIXED_PRICING_BASIS_VALUES = ['unit', 'bundle'] as const;
export type FixedPricingBasis = (typeof FIXED_PRICING_BASIS_VALUES)[number];

/**
 * Interface for bucket service configuration
 */
export interface IContractLineServiceBucketConfig extends TenantEntity {
  config_id: string;
  total_minutes: number;
  billing_period: string;
  overage_rate: number;
  allow_rollover: boolean;
  tenant: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Interface for rate tiers used in tiered pricing
 */
export interface IContractLineServiceRateTier extends TenantEntity {
  tier_id: string;
  config_id: string;
  min_quantity: number;
  max_quantity?: number;
  rate: number;
  tenant: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Input interface for creating/updating rate tiers (omits DB-generated fields)
 */
export interface IContractLineServiceRateTierInput {
  min_quantity: number;
  max_quantity?: number | null; // Allow null for the last tier
  rate: number;
}

/**
 * Interface for user type rates (optional)
 */
export interface IUserTypeRate extends TenantEntity {
  rate_id: string;
  config_id: string;
  user_type: string;
  rate: number;
  tenant: string;
  created_at: Date;
  updated_at: Date;
}

// -------------------------------------------------------------
// Back-compat aliases (prefer IContractLineService* going forward)
// -------------------------------------------------------------
// (Old IPlanService* names retired.)
