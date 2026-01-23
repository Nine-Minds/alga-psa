import { TenantEntity } from '.';
import { ISO8601String } from '@alga-psa/types';

/**
 * Interface for service rate tiers
 * Represents quantity-based pricing tiers for services
 */
export interface IServiceRateTier extends TenantEntity {
  tier_id: string;
  service_id: string;
  min_quantity: number;
  max_quantity: number | null;
  rate: number;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

/**
 * Interface for creating a new service rate tier
 */
export interface ICreateServiceRateTier extends Omit<IServiceRateTier, 'tier_id' | 'tenant' | 'created_at' | 'updated_at'> {
  // All required fields from IServiceRateTier except tier_id, tenant, created_at, and updated_at
}

/**
 * Interface for updating an existing service rate tier
 */
export interface IUpdateServiceRateTier extends Partial<Omit<IServiceRateTier, 'tier_id' | 'service_id' | 'tenant'>> {
  // Optional fields that can be updated
}