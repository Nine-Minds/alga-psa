import { TenantEntity } from ".";

import { ISO8601String } from '../types/types.d';

export interface ICompanyTaxSettings extends TenantEntity {
  company_id: string;
  tax_rate_id?: string; // Made optional for backward compatibility with tests
  is_reverse_charge_applicable: boolean;
  tax_components?: ITaxComponent[];
  tax_rate_thresholds?: ITaxRateThreshold[];
  tax_holidays?: ITaxHoliday[];
}

export interface ITaxRate extends TenantEntity {
  tax_rate_id: string;
  tax_type: 'VAT' | 'GST' | 'Sales Tax';
  country_code: string;
  tax_percentage: number;
  is_reverse_charge_applicable: boolean;
  is_composite: boolean;
  start_date: ISO8601String;
  end_date?: ISO8601String;
  is_active: boolean;
  conditions?: Record<string, any>;
  description: string | null; // Added description field from tax_rates table
  region_code: string; // Added region_code field from tax_rates table
  name?: string; // Made optional for backward compatibility with tests
}

// Removed ITaxRateWithDetails as fields are now in ITaxRate

export interface ITaxComponent extends TenantEntity {
  tax_component_id: string;
  tax_rate_id: string; // Added this line
  name: string;
  rate: number;
  sequence: number;
  is_compound: boolean;
  start_date?: ISO8601String;
  end_date?: ISO8601String;
  conditions?: Record<string, any>;
}

export interface ICompositeTaxMapping extends TenantEntity {
  composite_tax_id: string;
  tax_component_id: string;
  sequence: number;
}

export interface ITaxRateThreshold extends TenantEntity {
  tax_rate_threshold_id: string;
  tax_rate_id: string;
  min_amount: number;
  max_amount?: number;
  rate: number;
}

export interface ITaxHoliday extends TenantEntity {
  tax_holiday_id: string;
  tax_component_id: string;
  start_date: ISO8601String;
  end_date: ISO8601String;
  description?: string;
}

export interface ITaxCalculationResult {
  taxAmount: number;
  taxRate: number;
  taxComponents?: ITaxComponent[];
  appliedThresholds?: ITaxRateThreshold[];
  appliedHolidays?: ITaxHoliday[];
}

export interface ITaxRegion extends TenantEntity {
  region_code: string;
  region_name: string;
  is_active: boolean;
}

// Represents an entry in the company_tax_rates table
export interface ICompanyTaxRateAssociation extends TenantEntity {
 company_tax_rates_id: string; // Corrected column name (plural rates)
  company_id: string;
  tax_rate_id: string;
  is_default: boolean;
  location_id: string | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}