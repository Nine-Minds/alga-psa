/**
 * Canonical Company Interfaces
 * These are the canonical definitions for company-related types used across the codebase.
 * All references should use these definitions unless there's a specific reason not to.
 */

/**
 * Core company entity interface
 */
export interface ICompany {
  company_id: string;
  company_name: string;
  client_type?: 'company' | 'individual' | null;
  tenant?: string;
  url?: string | null;
  phone_no?: string | null;
  email?: string | null;
  address?: string | null;
  address_2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  notes?: string | null;
  is_inactive?: boolean | null;
  created_at: string;
  updated_at: string;
  properties?: Record<string, any> | null;
  parent_company_id?: string | null;
  plan_id?: string | null;
  is_default?: boolean | null;
  [key: string]: any; // Allow additional properties for database fields
}

/**
 * Input type for creating a new company
 */
export interface CreateCompanyInput {
  company_name: string;
  client_type?: 'company' | 'individual';
  url?: string;
  phone_no?: string;
  email?: string;
  address?: string;
  address_2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  notes?: string;
  properties?: Record<string, any>;
  parent_company_id?: string;
  plan_id?: string;
  is_default?: boolean;
}

/**
 * Input type for updating an existing company
 */
export interface UpdateCompanyInput {
  company_name?: string;
  client_type?: 'company' | 'individual';
  url?: string;
  phone_no?: string;
  email?: string;
  address?: string;
  address_2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  notes?: string;
  is_inactive?: boolean;
  properties?: Record<string, any>;
  parent_company_id?: string;
  plan_id?: string;
}

/**
 * Options for company creation process
 */
export interface CompanyCreationOptions {
  skipTaxSettings?: boolean;
  skipEmailSuffix?: boolean;
}