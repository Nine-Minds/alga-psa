/**
 * @alga-psa/clients - Client Schemas
 *
 * Zod validation schemas for client data.
 */

import { z } from 'zod';

/**
 * Schema for client properties (JSON field)
 */
export const ClientPropertiesSchema = z.object({
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
  parent_client_id: z.string().optional(),
  parent_client_name: z.string().optional(),
  last_contact_date: z.string().optional(),
  logo: z.string().optional(),
}).optional();

/**
 * Full client schema for validation
 */
export const ClientSchema = z.object({
  tenant: z.string().optional(),
  client_id: z.string(),
  client_name: z.string(),
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
  properties: ClientPropertiesSchema,
  payment_terms: z.string().optional(),
  billing_cycle: z.string(),
  credit_limit: z.number().optional(),
  preferred_payment_method: z.string().optional(),
  auto_invoice: z.boolean().default(false),
  invoice_delivery_method: z.string().optional(),
  tax_region: z.string().optional(),
  is_tax_exempt: z.boolean(),
  tax_exemption_certificate: z.string().optional(),
});

/**
 * Schema for creating a new client
 */
export const CreateClientSchema = z.object({
  client_name: z.string().min(1, 'Client name is required'),
  client_type: z.enum(['company', 'individual']).optional(),
  url: z.string().url().optional().or(z.literal('')),
  phone_no: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  address_2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  default_currency_code: z.string().optional(),
  notes: z.string().optional(),
  properties: ClientPropertiesSchema,
  parent_client_id: z.string().uuid().optional(),
  contract_line_id: z.string().uuid().optional(),
  is_default: z.boolean().optional(),
});

/**
 * Schema for updating an existing client
 */
export const UpdateClientSchema = CreateClientSchema.partial().extend({
  is_inactive: z.boolean().optional(),
});

/**
 * Inferred types from schemas
 */
export type Client = z.infer<typeof ClientSchema>;
export type CreateClientInput = z.infer<typeof CreateClientSchema>;
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;
