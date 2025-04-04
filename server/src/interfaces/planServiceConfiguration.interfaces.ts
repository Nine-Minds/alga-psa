import { TenantEntity } from './index';
import { ISO8601String } from '../types/types.d';

/**
 * Base interface for all plan service configurations
 */
export interface IPlanServiceConfiguration extends TenantEntity {
  config_id: string;
  plan_id: string;
  service_id: string;
  configuration_type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';
  custom_rate?: number;
  quantity?: number;
  instance_name?: string;
  tenant: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Interface for fixed price service configuration
 */
export interface IPlanServiceFixedConfig extends TenantEntity {
  config_id: string;
  base_rate?: number | null; // Added base_rate field
  enable_proration: boolean;
  billing_cycle_alignment: 'start' | 'end' | 'prorated';
  tenant: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Interface for hourly service configuration
 */
export interface IPlanServiceHourlyConfig extends TenantEntity {
  config_id: string;
  hourly_rate: number; // Added
  minimum_billable_time: number;
  round_up_to_nearest: number;
  // Removed plan-wide fields: enable_overtime, overtime_rate, overtime_threshold, enable_after_hours_rate, after_hours_multiplier
  tenant: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Interface for usage-based service configuration
 */
export interface IPlanServiceUsageConfig extends TenantEntity {
  config_id: string;
  unit_of_measure: string;
  enable_tiered_pricing: boolean;
  minimum_usage?: number | null; // Make nullable to match DB and input
  base_rate?: number | null; // Add the new base_rate field
  tenant: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Interface for bucket service configuration
 */
export interface IPlanServiceBucketConfig extends TenantEntity {
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
export interface IPlanServiceRateTier extends TenantEntity {
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
export interface IPlanServiceRateTierInput {
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