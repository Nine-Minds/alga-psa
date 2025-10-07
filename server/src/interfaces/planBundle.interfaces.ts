import { TenantEntity } from './index';
import { ISO8601String } from '../types/types.d';

/**
 * Interface for a Plan Bundle
 * Represents a collection of billing plans that can be assigned to companies
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
  po_number?: string | null; // Purchase Order number
  po_amount?: number | null; // Purchase Order amount in cents
  po_required?: boolean; // Whether PO is required for invoicing
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

/**
 * Interface for contract pricing schedules
 * Represents time-based pricing changes for a contract
 */
export interface IContractPricingSchedule extends TenantEntity {
  schedule_id: string;
  bundle_id: string;
  effective_date: ISO8601String;
  end_date?: ISO8601String | null;
  duration_value?: number; // e.g., 6 for "6 months"
  duration_unit?: 'days' | 'weeks' | 'months' | 'years'; // Unit for duration
  custom_rate?: number; // Rate in cents, nullable means use default
  notes?: string;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
  created_by?: string;
  updated_by?: string;
}