import { TenantEntity } from './index';
import { ISO8601String } from '../types/types.d';

/**
 * Interface for a Plan Bundle
 * Represents a collection of billing plans that can be assigned to companies
 */
export interface IPlanBundle extends TenantEntity {
  bundle_id: string;
  bundle_name: string;
  description?: string;
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
 * Interface for associating bundles with companies
 * Represents the assignment of a bundle to a company
 */
export interface ICompanyPlanBundle extends TenantEntity {
  company_bundle_id: string;
  company_id: string;
  bundle_id: string;
  start_date: ISO8601String;
  end_date: ISO8601String | null;
  is_active: boolean;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}