import type { ISO8601String } from '../lib/temporal';
import type { ITaggable } from './tag.interfaces';
import type { TenantEntity } from '.';
import type { BillingCycleType, IContractLine } from './billing.interfaces';

export interface IClientSummary extends TenantEntity {
    id: string;
    name: string;
    contractLine?: IContractLine;
}

export interface IClient extends TenantEntity, ITaggable {
  client_id: string;
  client_name: string;
  client_type?: 'company' | 'individual' | null;
  url: string;
  phone_no?: string | null;
  email?: string | null;
  address?: string | null;
  address_2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  default_currency_code?: string | null;
  notes?: string | null;
  is_inactive: boolean;
  created_at: string;
  updated_at: string;
  properties?: ({[key: string]: any} & {
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
    parent_client_id?: string;
    parent_client_name?: string;
    last_contact_date?: string;
    logo?: string;
  }) | null;
  parent_client_id?: string | null;
  contract_line_id?: string | null;
  is_default?: boolean | null;

  credit_balance: number;
  tax_id_number?: string;
  notes_document_id?: string | null;
  payment_terms?: string;
  billing_cycle: BillingCycleType;
  credit_limit?: number;
  preferred_payment_method?: string;
  auto_invoice?: boolean;
  invoice_delivery_method?: string;
  region_code?: string | null;
  tax_region?: string;
  is_tax_exempt: boolean;
  tax_exemption_certificate?: string;
  timezone?: string;
  invoice_template_id?: string;
  billing_contact_id?: string;
  billing_email?: string;
  account_manager_full_name?: string;
  account_manager_id?: string | null;
  logoUrl?: string | null;

  [key: string]: any;
}

export interface IClientLocation extends TenantEntity {
  location_id: string;
  client_id: string;
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

// Type for client with default location data joined
export interface IClientWithLocation extends IClient {
  location_email?: string;
  location_phone?: string;
  location_address?: string;
}

/**
 * Input type for creating a new client.
 */
export interface CreateClientInput {
  client_name: string;
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
  default_currency_code?: string;
  notes?: string;
  properties?: Record<string, any>;
  parent_client_id?: string;
  contract_line_id?: string;
  is_default?: boolean;
}

/**
 * Input type for updating an existing client.
 */
export interface UpdateClientInput {
  client_name?: string;
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
  default_currency_code?: string;
  notes?: string;
  is_inactive?: boolean;
  properties?: Record<string, any>;
  parent_client_id?: string;
  contract_line_id?: string;
}

export interface ClientCreationOptions {
  skipTaxSettings?: boolean;
  skipEmailSuffix?: boolean;
}
