import { BillingCycleType, TenantEntity } from './index';
import { ISO8601String } from 'server/src/types/types.d';
import { ITaggable } from './tag.interfaces';
import { IClient as SharedIClient } from '@alga-psa/shared/interfaces/client.interfaces';
import { IContractLine } from './billing.interfaces';

export interface IClientSummary extends TenantEntity {
    id: string;
    name: string;
    contractLine?: IContractLine;
}

// Extend the shared IClient interface with server-specific fields
// We need to merge SharedIClient with TenantEntity and ITaggable
export interface IClient extends SharedIClient, TenantEntity, ITaggable {
  // Override shared fields to match server expectations (non-nullable)
  url: string;
  is_inactive: boolean;

  // Additional server-specific fields
  credit_balance: number;
  tax_id_number?: string;
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
    parent_client_id?: string;
    parent_client_name?: string;
    last_contact_date?: string;
    logo?: string;
  };
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
