import { TenantEntity } from ".";

import { ISO8601String } from '../types/types.d';

export interface IClientTaxSettings extends TenantEntity {
  client_id: string;
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
  tax_rate_id: string;
  tax_component_id?: string; // Optional - for per-component holidays (future feature)
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

// Represents an entry in the client_tax_rates table
export interface IClientTaxRateAssociation extends TenantEntity {
  client_tax_rates_id: string; // Corrected column name (plural rates)
  client_id: string;
  tax_rate_id: string;
  is_default: boolean;
  location_id: string | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

// Tax source types for external tax delegation
export type TaxSource = 'internal' | 'external' | 'pending_external';
export type ExternalTaxAdapter = 'xero' | 'quickbooks' | 'sage' | null;

// Tenant-level tax delegation settings
export interface ITenantTaxSettings {
  /** Default tax calculation source for new invoices */
  default_tax_source: TaxSource;
  /** Whether clients can override the default tax source */
  allow_external_tax_override: boolean;
  /** Default external accounting adapter for tax calculation */
  external_tax_adapter?: ExternalTaxAdapter;
}

// Client-level tax source override (extends IClientTaxSettings)
export interface IClientTaxSourceSettings {
  /** Per-client override of tenant tax source setting */
  tax_source_override?: TaxSource;
  /** Per-client override of external tax adapter */
  external_tax_adapter_override?: ExternalTaxAdapter;
}

// External tax import tracking
export interface IExternalTaxImport extends TenantEntity {
  import_id: string;
  invoice_id: string;
  adapter_type: string;
  external_invoice_ref?: string;
  imported_at: ISO8601String;
  imported_by?: string;
  import_status: 'success' | 'failed' | 'partial';
  original_internal_tax?: number;
  imported_external_tax?: number;
  tax_difference?: number;
  metadata?: Record<string, unknown>;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

// Result of importing tax from external system
export interface IExternalTaxImportResult {
  success: boolean;
  import_id?: string;
  invoice_id: string;
  original_tax: number;
  imported_tax: number;
  difference: number;
  charges_updated: number;
  error?: string;
}