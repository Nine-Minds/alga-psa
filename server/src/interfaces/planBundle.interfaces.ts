import { TenantEntity } from './index';
import { ISO8601String } from '../types/types.d';

/**
 * Interface for a Plan Bundle
 * Represents a collection of billing plans that can be assigned to clients
 */
export interface IPlanBundle extends TenantEntity {
  bundle_id: string;
  bundle_name: string;
  bundle_description?: string; // Renamed from description to match DB schema
  is_active: boolean;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

/**
 * Interface for mapping billing plans to bundles
 * Represents the many-to-many relationship between plans and bundles
 */
export interface IBundleBillingPlan extends TenantEntity {
  bundle_id: string;
  plan_id: string;
  display_order?: number;
  custom_rate?: number;
  created_at?: ISO8601String;
}

/**
 * Interface for associating bundles with clients
 * Represents the assignment of a bundle to a client
 */
export interface IClientPlanBundle extends TenantEntity {
  client_bundle_id: string;
  client_id: string;
  bundle_id: string;
  start_date: ISO8601String;
  end_date: ISO8601String | null;
  is_active: boolean;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}