/**
 * Quote API Schemas
 * Zod validation schemas for quote-related API operations
 */

import { z } from 'zod';
import {
  uuidSchema,
  booleanTransform,
} from './common';

// ============================================================================
// Enums
// ============================================================================

const quoteStatusSchema = z.enum([
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'converted',
  'cancelled',
  'superseded',
  'archived',
]);

const discountTypeSchema = z.enum(['percentage', 'fixed']);

const taxSourceSchema = z.enum(['internal', 'external', 'pending_external']);

const quoteDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ============================================================================
// Quote Item Schemas
// ============================================================================

export const createQuoteItemSchema = z.object({
  service_id: uuidSchema.optional().nullable(),
  description: z.string().min(1).max(1000),
  quantity: z.number().int().min(1),
  unit_price: z.number().int().min(0),
  unit_of_measure: z.string().max(100).optional().nullable(),
  phase: z.string().max(255).optional().nullable(),
  is_optional: z.boolean().default(false),
  is_selected: z.boolean().optional().nullable(),
  is_recurring: z.boolean().default(false),
  billing_frequency: z.string().max(50).optional().nullable(),
  billing_method: z.string().max(50).optional().nullable(),
  is_discount: z.boolean().default(false),
  discount_type: discountTypeSchema.optional().nullable(),
  discount_percentage: z.number().min(0).max(100).optional().nullable(),
  applies_to_item_id: uuidSchema.optional().nullable(),
  applies_to_service_id: uuidSchema.optional().nullable(),
  is_taxable: z.boolean().default(true),
  tax_region: z.string().max(100).optional().nullable(),
  tax_rate: z.number().min(0).optional().nullable(),
  service_name: z.string().max(255).optional().nullable(),
  service_sku: z.string().max(100).optional().nullable(),
  service_item_kind: z.string().max(50).optional().nullable(),
});

export const updateQuoteItemSchema = createQuoteItemSchema.partial();

// ============================================================================
// Quote Schemas
// ============================================================================

export const createQuoteApiSchema = z.object({
  client_id: uuidSchema.optional().nullable(),
  contact_id: uuidSchema.optional().nullable(),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().optional().nullable(),
  quote_date: quoteDateSchema.optional().nullable(),
  valid_until: quoteDateSchema.optional().nullable(),
  po_number: z.string().trim().max(255).optional().nullable(),
  opportunity_id: uuidSchema.optional().nullable(),
  internal_notes: z.string().optional().nullable(),
  client_notes: z.string().optional().nullable(),
  terms_and_conditions: z.string().optional().nullable(),
  currency_code: z.string().trim().length(3).default('USD'),
  tax_source: taxSourceSchema.default('internal'),
  is_template: z.boolean().default(false),
  template_id: uuidSchema.optional().nullable(),
  items: z.array(createQuoteItemSchema).optional(),
});

export const updateQuoteApiSchema = createQuoteApiSchema.partial().extend({
  status: quoteStatusSchema.optional().nullable(),
});

// ============================================================================
// Query / Filter Schemas
// ============================================================================

export const quoteListQuerySchema = z.object({
  page: z.string().optional().default('1').transform(v => parseInt(v)),
  limit: z.string().optional().default('25').transform(v => Math.min(parseInt(v), 100)),
  sort: z.string().optional().default('created_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  status: quoteStatusSchema.optional(),
  client_id: z.string().optional(),
  is_template: z.string().optional().transform(v => v === 'true'),
  search: z.string().optional(),
  include_items: z.string().optional().transform(v => v === 'true'),
  include_client: z.string().optional().transform(v => v === 'true'),
});

// ============================================================================
// Action Schemas
// ============================================================================

export const sendQuoteSchema = z.object({
  email_addresses: z.array(z.string().email()).optional(),
  subject: z.string().max(500).optional(),
  message: z.string().optional(),
});

export const approvalRequestChangesSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export const convertQuoteSchema = z.object({
  conversion_type: z.enum(['contract', 'invoice', 'both']),
});

export const reorderQuoteItemsSchema = z.object({
  item_ids: z.array(uuidSchema).min(1),
});

// ============================================================================
// Inferred Types
// ============================================================================

export type CreateQuoteApi = z.infer<typeof createQuoteApiSchema>;
export type UpdateQuoteApi = z.infer<typeof updateQuoteApiSchema>;
export type CreateQuoteItemApi = z.infer<typeof createQuoteItemSchema>;
export type UpdateQuoteItemApi = z.infer<typeof updateQuoteItemSchema>;
export type QuoteListQuery = z.infer<typeof quoteListQuerySchema>;
export type SendQuoteApi = z.infer<typeof sendQuoteSchema>;
export type ConvertQuoteApi = z.infer<typeof convertQuoteSchema>;
