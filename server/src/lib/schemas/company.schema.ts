import { z } from 'zod';
import { BillingCycleSchema } from './billing.schema';

export const CompanyPropertiesSchema = z.object({
  industry: z.string().optional(),
  company_size: z.string().optional(),
  annual_revenue: z.string().optional(),
  primary_contact_id: z.string().optional(),
  primary_contact_name: z.string().optional(),
  account_manager_id: z.string().optional(),
  account_manager_name: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  billing_address: z.string().optional(),
  tax_id: z.string().optional(),
  notes: z.string().optional(),
  timezone: z.string().optional(),
  payment_terms: z.string().optional(),
  website: z.string().optional(),
  parent_company_id: z.string().optional(),
  parent_company_name: z.string().optional(),
  last_contact_date: z.string().optional(),
  logo: z.string().optional(),
}).optional();

export const CompanySchema = z.object({
  tenant: z.string().optional(),
  company_id: z.string(),
  company_name: z.string(),
  phone_no: z.string(),
  credit_balance: z.number().default(0),
  email: z.string().email(),
  url: z.string().url(),
  address: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  is_inactive: z.boolean(),
  client_type: z.string().optional(),
  tax_id_number: z.string().optional(),
  notes: z.string().optional(),
  properties: CompanyPropertiesSchema,
  payment_terms: z.string().optional(),
  billing_cycle: BillingCycleSchema,
  credit_limit: z.number().optional(),
  preferred_payment_method: z.string().optional(),
  auto_invoice: z.boolean().default(false),
  invoice_delivery_method: z.string().optional(),
  tax_region: z.string().optional(),
  is_tax_exempt: z.boolean(),
  tax_exemption_certificate: z.string().optional(),
});

export type Company = z.infer<typeof CompanySchema>;