import { BillingCycleType, TenantEntity } from './index';

export interface ICompany extends TenantEntity {
  company_id: string;
  company_name: string;
  phone_no: string;
  credit_balance: number;
  email: string;
  url: string;
  address: string;
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
    account_manager_id?: string;
    account_manager_name?: string;
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
  tax_region?: string;
  is_tax_exempt: boolean;
  tax_exemption_certificate?: string;
  timezone?: string;
  invoice_template_id?: string;
}

export interface ICompanyLocation extends TenantEntity {
  location_id: string;
  company_id: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state?: string;
  postal_code?: string;
  country: string;
  tax_region: string;
  created_at?: Date;
  updated_at?: Date;
}
