/**
 * Quote API Schemas
 * Zod validation schemas for quote-related API operations
 */

import { z } from 'zod';
import {
  uuidSchema,
  booleanTransform,
} from './common';
import { partialWithoutDefaults } from '@alga-psa/validation/lib/partialWithoutDefaults';
import { isUnitOfMeasureCode } from '@alga-psa/core/unitOfMeasure';

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

/**
 * Fixed discounts are stored as a POSITIVE amount on a line flagged
 * `is_discount` (see packages/core/src/lib/quoteDiscountAllocation.ts), so a
 * negative unit_price is always a caller mistake. Spell the convention out in
 * the validation message: alga-2026-0002902 was a caller who hit the bare
 * min-0 error and had no way to learn it.
 */
export const UNIT_PRICE_MESSAGE =
  'unit_price must be an integer >= 0 in minor units. For a fixed discount send a positive unit_price with is_discount: true and discount_type: "fixed" (optionally applies_to_item_id).';

export const createQuoteItemSchema = z.object({
  service_id: uuidSchema.optional().nullable(),
  description: z.string().min(1).max(1000),
  quantity: z.number().int().min(1),
  unit_price: z.number().int(UNIT_PRICE_MESSAGE).min(0, UNIT_PRICE_MESSAGE),
  unit_of_measure: z.string().max(100).optional().nullable(),
  unit_code: z.string().refine(isUnitOfMeasureCode, 'Unknown unit of measure code').optional().nullable(),
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
  // No default: "not sent" must stay distinguishable from an explicit `true`
  // so the model can derive the treatment from the service's tax configuration.
  is_taxable: z.boolean().optional(),
  tax_region: z.string().max(100).optional().nullable(),
  tax_rate: z.number().min(0).optional().nullable(),
  service_name: z.string().max(255).optional().nullable(),
  service_sku: z.string().max(100).optional().nullable(),
  service_item_kind: z.string().max(50).optional().nullable(),
  // alga-2026-0002902: these were missing, so zod stripped them and the column
  // stayed null however often the caller sent it. The model persists all three.
  location_id: uuidSchema.optional().nullable(),
  cost: z.number().int().min(0).optional().nullable(),
  cost_currency: z.string().trim().length(3).optional().nullable(),
  // The catalog-description snapshot is intentionally absent from this input
  // shape: it is a server-captured, tenant-scoped snapshot of the catalog row,
  // authoritative and immutable from the caller's perspective. Zod strips
  // unknown keys, so any caller-supplied value is dropped here and never
  // reaches the model.
});

export const updateQuoteItemSchema = partialWithoutDefaults(createQuoteItemSchema);

// ============================================================================
// Quote Schemas
// ============================================================================

const quoteApiBaseSchema = z.object({
  client_id: uuidSchema.optional().nullable(),
  contact_id: uuidSchema.optional().nullable(),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().optional().nullable(),
  quote_date: quoteDateSchema.optional().nullable(),
  valid_until: quoteDateSchema.optional().nullable(),
  po_number: z.string().trim().max(255).optional().nullable(),
  recurring_section_title: z.string().trim().max(255).optional().nullable().transform((value) => value || null),
  onetime_section_title: z.string().trim().max(255).optional().nullable().transform((value) => value || null),
  opportunity_id: uuidSchema.optional().nullable(),
  internal_notes: z.string().optional().nullable(),
  client_notes: z.string().optional().nullable(),
  terms_and_conditions: z.string().optional().nullable(),
  // DD-2/F-2: no static 'USD' default. When omitted, QuoteService.create
  // resolves the currency from the client's default_currency_code, then the
  // tenant's default_billing_settings.default_currency_code, and sets it
  // explicitly before insert (the quotes.currency_code DB column is NOT NULL
  // DEFAULT 'USD', so an unset value would otherwise silently become USD).
  currency_code: z.string().trim().length(3).optional(),
  tax_source: taxSourceSchema.default('internal'),
  is_template: z.boolean().default(false),
  template_id: uuidSchema.optional().nullable(),
  items: z.array(createQuoteItemSchema).optional(),
});

/**
 * Strict on purpose (alga-2026-0002902): the published create body named
 * `notes`/`terms`, which zod silently stripped, so callers believed they had
 * saved text that was never persisted. Unknown top-level keys are now a 400.
 * `items` entries stay non-strict so the deliberate catalog_description strip
 * above keeps working. The deprecated `notes`/`terms`/`quote_number` aliases are
 * folded onto their real names in ApiQuoteController.create() before this parse.
 */
export const createQuoteApiSchema = quoteApiBaseSchema.strict();

// `status` is deliberately NOT an update field: every quote lifecycle transition goes through a
// named command (submit-for-approval, approve, send, cancel) that owns its permission, lock and
// audit row. `.strict()` makes a PUT carrying `status` fail with 400 instead of being silently
// stripped (zod objects strip unknown keys by default), and QuoteService.update also rejects
// `status` at runtime for callers that bypass the schema. (alga-2026-0003002)
export const updateQuoteApiSchema = partialWithoutDefaults(createQuoteApiSchema).strict();

export const cancelQuoteSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});

// ============================================================================
// Query / Filter Schemas
// ============================================================================

/**
 * Allow-list for the list `sort` parameter. QuoteService.list interpolates it
 * into `orderBy('q.' + sortBy)`, so an unknown value used to reach Postgres and
 * come back as a 500 (alga-2026-0002902).
 */
export const QUOTE_SORT_FIELDS = [
  'created_at',
  'updated_at',
  'quote_date',
  'valid_until',
  'total_amount',
  'status',
  'quote_number',
  'title',
] as const;

export const quoteListQuerySchema = z.object({
  page: z.string().optional().default('1').transform(v => parseInt(v)),
  limit: z.string().optional().default('25').transform(v => Math.min(parseInt(v), 100)),
  sort: z.enum(QUOTE_SORT_FIELDS).optional().default('created_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  status: quoteStatusSchema.optional(),
  client_id: z.string().optional(),
  is_template: z.string().optional().transform(v => v === 'true'),
  search: z.string().optional(),
  include_items: z.string().optional().transform(v => v === 'true'),
  // Defaults to true when the key is absent, matching the long-standing
  // controller behaviour (`include_client !== 'false'`).
  include_client: z.string().optional().transform(v => v !== 'false'),
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
  reason: z.string().trim().min(1, 'reason is required').max(2000),
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
export type CancelQuoteApi = z.infer<typeof cancelQuoteSchema>;
export type CreateQuoteItemApi = z.infer<typeof createQuoteItemSchema>;
export type UpdateQuoteItemApi = z.infer<typeof updateQuoteItemSchema>;
export type QuoteListQuery = z.infer<typeof quoteListQuerySchema>;
export type SendQuoteApi = z.infer<typeof sendQuoteSchema>;
export type ConvertQuoteApi = z.infer<typeof convertQuoteSchema>;
