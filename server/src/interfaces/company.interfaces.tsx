import { BillingCycleType, TenantEntity } from './index';
import { ISO8601String } from 'server/src/types/types.d';

export interface ICompany extends TenantEntity {
  company_id: string;
  company_name: string;
  phone_no: string;
  credit_balance: number;
  email: string;
  url: string;
  address?: string;
  created_at: string;
  updated_at: string;
  is_inactive: boolean;
  client_type?: string;
  tax_id_number?: string; 
  notes?: string;
  notes_document_id?: string | null;
  properties?: {
    industry?: string;
    company_size?: string;
    annual_revenue?: string;
    primary_contact_id?: string;
    primary_contact_name?: string;
    status?: string;
    type?: string;
    billing_address?: string;
    tax_id?: string;
    notes?: string;
    payment_terms?: string;
    website?: string;
    parent_company_id?: string;
    parent_company_name?: string;
    last_contact_date?: string;
    logo?: string;
  };
  payment_terms?: string;
  billing_cycle: BillingCycleType;
  credit_limit?: number;
  preferred_payment_method?: string;
  auto_invoice?: boolean;
  invoice_delivery_method?: string;  
  region_code?: string | null; // Replaced tax_region with region_code FK
  is_tax_exempt: boolean;
  tax_exemption_certificate?: string;
  timezone?: string;
  invoice_template_id?: string;
  billing_contact_id?: string;
  billing_email?: string;
  account_manager_full_name?: string;
  account_manager_id?: string | null;
  logoUrl?: string | null;
}

export interface ICompanyLocation extends TenantEntity {
  location_id: string;
  company_id: string;
  location_name?: string;
  address_line1: string;
  address_line2?: string;
  address_line3?: string;
  city: string;
  state_province?: string;
  postal_code?: string;
  country_code: string;
  country_name: string;
  region_code?: string | null;
  is_billing_address?: boolean;
  is_shipping_address?: boolean;
  is_default?: boolean;
  phone?: string;
  fax?: string;
  email?: string;
  notes?: string;
  is_active?: boolean;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

export interface ICompanyEmailSettings extends TenantEntity {
  company_id: string;
  email_suffix: string;
  self_registration_enabled: boolean;
  user_id: string;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}