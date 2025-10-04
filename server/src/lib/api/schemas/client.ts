/**
 * Client API Schemas
 * Validation schemas for client-related API endpoints
 *
 * Note: This schema replaces client.ts as part of the client → client migration.
 * Legacy client.ts exports are maintained for backward compatibility.
 */

import { z } from 'zod';
import {
  uuidSchema,
  emailSchema,
  urlSchema,
  phoneSchema,
  createListQuerySchema,
  createUpdateSchema,
  baseFilterSchema,
  metadataSchema,
  booleanTransform
} from './common';

// Client properties schema
const clientPropertiesSchema = z.object({
  industry: z.string().optional(),
  company_size: z.string().optional(),
  annual_revenue: z.string().optional(),
  primary_contact_id: uuidSchema.optional(),
  primary_contact_name: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  billing_address: z.string().optional(),
  tax_id: z.string().optional(),
  notes: z.string().optional(),
  payment_terms: z.string().optional(),
  website: urlSchema,
  parent_client_id: uuidSchema.optional(),
  parent_client_name: z.string().optional(),
  last_contact_date: z.string().datetime().optional(),
  logo: z.string().optional()
}).optional();

// Create client schema
export const createClientSchema = z.object({
  client_name: z.string().min(1, 'Client name is required').max(255),
  phone_no: phoneSchema,
  email: emailSchema.optional(),
  url: urlSchema,
  address: z.string().optional(),
  client_type: z.string().optional(),
  tax_id_number: z.string().optional(),
  notes: z.string().optional(),
  properties: clientPropertiesSchema,
  payment_terms: z.string().optional(),
  billing_cycle: z.enum(['weekly', 'bi-weekly', 'monthly', 'quarterly', 'semi-annually', 'annually']),
  credit_limit: z.number().min(0).optional(),
  preferred_payment_method: z.string().optional(),
  auto_invoice: z.boolean().optional().default(false),
  invoice_delivery_method: z.enum(['email', 'mail', 'portal']).optional(),
  region_code: z.string().optional(),
  is_tax_exempt: z.boolean().optional().default(false),
  tax_exemption_certificate: z.string().optional(),
  timezone: z.string().optional(),
  invoice_template_id: uuidSchema.optional(),
  billing_contact_id: uuidSchema.optional(),
  billing_email: emailSchema.optional(),
  account_manager_id: uuidSchema.optional(),
  is_inactive: z.boolean().optional().default(false),
  tags: z.array(z.string()).optional()
});

// Update client schema (all fields optional)
export const updateClientSchema = createUpdateSchema(createClientSchema);

// Client filter schema
export const clientFilterSchema = baseFilterSchema.extend({
  client_name: z.string().optional(),
  email: z.string().optional(),
  client_type: z.string().optional(),
  billing_cycle: z.enum(['weekly', 'bi-weekly', 'monthly', 'quarterly', 'semi-annually', 'annually']).optional(),
  is_inactive: z.string().transform(val => val === 'true').optional(),
  is_tax_exempt: z.string().transform(val => val === 'true').optional(),
  account_manager_id: uuidSchema.optional(),
  region_code: z.string().optional(),
  credit_balance_min: z.string().transform(val => parseFloat(val)).optional(),
  credit_balance_max: z.string().transform(val => parseFloat(val)).optional(),
  has_credit_limit: booleanTransform.optional(),
  industry: z.string().optional(),
  company_size: z.string().optional()
});

// Client list query schema
export const clientListQuerySchema = createListQuerySchema(clientFilterSchema);

// Client response schema
export const clientResponseSchema = z.object({
  client_id: uuidSchema,
  client_name: z.string(),
  phone_no: z.string().nullable(),
  credit_balance: z.number(),
  email: z.string().nullable(),
  url: z.string().nullable(),
  address: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  is_inactive: z.boolean(),
  client_type: z.string().nullable(),
  tax_id_number: z.string().nullable(),
  notes: z.string().nullable(),
  properties: clientPropertiesSchema,
  payment_terms: z.string().nullable(),
  billing_cycle: z.enum(['weekly', 'bi-weekly', 'monthly', 'quarterly', 'semi-annually', 'annually']),
  credit_limit: z.number().nullable(),
  preferred_payment_method: z.string().nullable(),
  auto_invoice: z.boolean(),
  invoice_delivery_method: z.string().nullable(),
  region_code: z.string().nullable(),
  is_tax_exempt: z.boolean(),
  tax_exemption_certificate: z.string().nullable(),
  timezone: z.string().nullable(),
  invoice_template_id: uuidSchema.nullable(),
  billing_contact_id: uuidSchema.nullable(),
  billing_email: z.string().nullable(),
  account_manager_id: uuidSchema.nullable(),
  account_manager_full_name: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  tenant: uuidSchema,
  tags: z.array(z.string()).optional()
});

// Client location schemas
export const createClientLocationSchema = z.object({
  location_name: z.string().optional(),
  address_line1: z.string().min(1, 'Address line 1 is required'),
  address_line2: z.string().optional(),
  address_line3: z.string().optional(),
  city: z.string().min(1, 'City is required'),
  state_province: z.string().optional(),
  postal_code: z.string().optional(),
  country_code: z.string().min(2).max(3),
  country_name: z.string().min(1, 'Country name is required'),
  region_code: z.string().optional(),
  is_billing_address: z.boolean().optional().default(false),
  is_shipping_address: z.boolean().optional().default(false),
  is_default: z.boolean().optional().default(false),
  phone: phoneSchema,
  fax: phoneSchema,
  email: emailSchema.optional(),
  notes: z.string().optional(),
  is_active: z.boolean().optional().default(true)
});

export const updateClientLocationSchema = createUpdateSchema(createClientLocationSchema);

export const clientLocationResponseSchema = z.object({
  location_id: uuidSchema,
  client_id: uuidSchema,
  location_name: z.string().nullable(),
  address_line1: z.string(),
  address_line2: z.string().nullable(),
  address_line3: z.string().nullable(),
  city: z.string(),
  state_province: z.string().nullable(),
  postal_code: z.string().nullable(),
  country_code: z.string(),
  country_name: z.string(),
  region_code: z.string().nullable(),
  is_billing_address: z.boolean(),
  is_shipping_address: z.boolean(),
  is_default: z.boolean(),
  phone: z.string().nullable(),
  fax: z.string().nullable(),
  email: z.string().nullable(),
  notes: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema
});

// Client with locations response
export const clientWithLocationsResponseSchema = clientResponseSchema.extend({
  locations: z.array(clientLocationResponseSchema).optional()
});

// Bulk operations schemas
export const bulkUpdateClientSchema = z.object({
  clients: z.array(z.object({
    client_id: uuidSchema,
    data: updateClientSchema
  })).min(1).max(100)
});

export const bulkDeleteClientSchema = z.object({
  client_ids: z.array(uuidSchema).min(1).max(100)
});

// Client stats schema
export const clientStatsResponseSchema = z.object({
  total_clients: z.number(),
  active_clients: z.number(),
  inactive_clients: z.number(),
  clients_by_billing_cycle: z.record(z.number()),
  clients_by_client_type: z.record(z.number()),
  total_credit_balance: z.number(),
  average_credit_balance: z.number()
});

// Export types for TypeScript
export type CreateClientData = z.infer<typeof createClientSchema>;
export type UpdateClientData = z.infer<typeof updateClientSchema>;
export type ClientFilterData = z.infer<typeof clientFilterSchema>;
export type ClientResponse = z.infer<typeof clientResponseSchema>;
export type CreateClientLocationData = z.infer<typeof createClientLocationSchema>;
export type UpdateClientLocationData = z.infer<typeof updateClientLocationSchema>;
export type ClientLocationResponse = z.infer<typeof clientLocationResponseSchema>;
