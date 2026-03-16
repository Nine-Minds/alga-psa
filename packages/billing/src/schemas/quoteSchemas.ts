import { z } from 'zod';
import type { QuoteStatus } from '@alga-psa/types';

export const quoteStatusSchema = z.enum([
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
  'archived'
]);

export const quoteItemBillingMethodSchema = z.enum(['fixed', 'hourly', 'usage', 'per_unit']);
export const quoteDiscountTypeSchema = z.enum(['percentage', 'fixed']);

const createQuoteBaseSchema = z.object({
  client_id: z.string().uuid().optional().nullable(),
  contact_id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  quote_date: z.coerce.date(),
  valid_until: z.coerce.date(),
  po_number: z.string().trim().max(255).optional().nullable(),
  internal_notes: z.string().optional().nullable(),
  client_notes: z.string().optional().nullable(),
  terms_and_conditions: z.string().optional().nullable(),
  currency_code: z.string().trim().length(3).default('USD'),
  tax_source: z.enum(['internal', 'external', 'pending_external']).default('internal'),
  is_template: z.boolean().default(false),
  created_by: z.string().uuid().optional().nullable(),
});

export const createQuoteSchema = createQuoteBaseSchema.superRefine((value, ctx) => {
  if (!value.is_template && !value.client_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'client_id is required for non-template quotes',
      path: ['client_id']
    });
  }

  if (value.valid_until < value.quote_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'valid_until must be on or after quote_date',
      path: ['valid_until']
    });
  }
});

export const updateQuoteSchema = createQuoteBaseSchema.partial().extend({
  status: quoteStatusSchema.optional().nullable(),
  updated_by: z.string().uuid().optional().nullable(),
  archived_at: z.coerce.date().optional().nullable(),
  sent_at: z.coerce.date().optional().nullable(),
  viewed_at: z.coerce.date().optional().nullable(),
  accepted_at: z.coerce.date().optional().nullable(),
  rejected_at: z.coerce.date().optional().nullable(),
  cancelled_at: z.coerce.date().optional().nullable(),
  expired_at: z.coerce.date().optional().nullable(),
  converted_at: z.coerce.date().optional().nullable(),
  converted_contract_id: z.string().uuid().optional().nullable(),
  converted_invoice_id: z.string().uuid().optional().nullable(),
});

const createQuoteItemBaseSchema = z.object({
  quote_id: z.string().uuid(),
  service_id: z.string().uuid().optional().nullable(),
  description: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  unit_price: z.number().int().min(0).optional(),
  unit_of_measure: z.string().trim().optional().nullable(),
  display_order: z.number().int().min(0).optional(),
  phase: z.string().trim().optional().nullable(),
  is_optional: z.boolean().default(false),
  is_selected: z.boolean().default(true),
  is_recurring: z.boolean().default(false),
  billing_frequency: z.string().trim().optional().nullable(),
  billing_method: quoteItemBillingMethodSchema.optional().nullable(),
  is_discount: z.boolean().default(false),
  discount_type: quoteDiscountTypeSchema.optional().nullable(),
  discount_percentage: z.number().int().min(0).max(100).optional().nullable(),
  applies_to_item_id: z.string().uuid().optional().nullable(),
  applies_to_service_id: z.string().uuid().optional().nullable(),
  is_taxable: z.boolean().default(true),
  tax_region: z.string().trim().optional().nullable(),
  tax_rate: z.number().int().min(0).optional().nullable(),
  created_by: z.string().uuid().optional().nullable(),
});

export const createQuoteItemSchema = createQuoteItemBaseSchema.superRefine((value, ctx) => {
  if (value.is_recurring && !value.billing_frequency) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'billing_frequency is required for recurring items',
      path: ['billing_frequency']
    });
  }

  if (value.is_discount && !value.discount_type) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'discount_type is required for discount items',
      path: ['discount_type']
    });
  }
});

export const updateQuoteItemSchema = createQuoteItemBaseSchema.partial().extend({
  updated_by: z.string().uuid().optional().nullable()
});

export const QUOTE_ALLOWED_STATUS_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ['pending_approval', 'sent', 'cancelled'],
  pending_approval: ['approved', 'cancelled'],
  approved: ['sent', 'cancelled'],
  sent: ['accepted', 'rejected', 'expired', 'cancelled'],
  accepted: ['converted', 'cancelled'],
  rejected: ['cancelled'],
  expired: ['cancelled'],
  converted: [],
  cancelled: [],
  superseded: [],
  archived: []
};

export function canTransitionQuoteStatus(currentStatus: QuoteStatus, nextStatus: QuoteStatus): boolean {
  if (currentStatus === nextStatus) {
    return true;
  }

  return QUOTE_ALLOWED_STATUS_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}

export const quoteStatusTransitionSchema = z.object({
  currentStatus: quoteStatusSchema,
  nextStatus: quoteStatusSchema,
}).superRefine((value, ctx) => {
  if (!canTransitionQuoteStatus(value.currentStatus, value.nextStatus)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid quote status transition from ${value.currentStatus} to ${value.nextStatus}`,
      path: ['nextStatus']
    });
  }
});
