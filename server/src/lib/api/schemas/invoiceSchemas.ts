/**
 * Invoice API Schemas
 * Comprehensive Zod validation schemas for all invoice-related operations
 */

import { z } from 'zod';
import {
  uuidSchema,
  dateSchema,
  isoDateSchema,
  paginationQuerySchema,
  baseFilterSchema,
  successResponseSchema,
  paginatedResponseSchema,
  errorResponseSchema,
  bulkDeleteSchema,
  bulkUpdateSchema,
  createListQuerySchema,
  createUpdateSchema,
  baseEntitySchema,
  addressSchema,
  booleanTransform,
  numberTransform
} from './common';

// ============================================================================
// Base Invoice Schemas
// ============================================================================

// Invoice status enum
const invoiceStatusSchema = z.enum([
  'draft',
  'sent', 
  'paid',
  'overdue',
  'cancelled',
  'pending',
  'prepayment',
  'partially_applied'
]);

// Discount type enum
const discountTypeSchema = z.enum(['percentage', 'fixed']);

// Tax region schema
const taxRegionSchema = z.string().min(1).max(50);

// Monetary amount schema (stored as integers for precision)
const monetaryAmountSchema = z.number().int().min(0);

// Invoice date schemas
const invoiceDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ============================================================================
// Invoice Item Schemas
// ============================================================================

// Base invoice item schema
const baseInvoiceItemSchema = z.object({
  item_id: uuidSchema,
  invoice_id: uuidSchema,
  service_id: uuidSchema.optional(),
  contract_line_id: uuidSchema.optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().min(0),
  unit_price: monetaryAmountSchema,
  total_price: monetaryAmountSchema,
  tax_amount: monetaryAmountSchema,
  net_amount: monetaryAmountSchema,
  tax_region: taxRegionSchema.optional(),
  tax_rate: z.number().min(0).max(1).optional(),
  is_manual: z.boolean().default(false),
  is_taxable: z.boolean().optional(),
  is_discount: z.boolean().default(false),
  discount_type: discountTypeSchema.optional(),
  discount_percentage: z.number().min(0).max(100).optional(),
  applies_to_item_id: uuidSchema.optional(),
  applies_to_service_id: uuidSchema.optional(),
  client_contract_id: uuidSchema.optional(),
  contract_name: z.string().optional(),
  // Accept both names during transition
  is_bundle_header: z.boolean().optional().default(false),
  parent_item_id: uuidSchema.optional(),
  rate: z.number().min(0)
});

// Create invoice item schema
const createInvoiceItemSchema = baseInvoiceItemSchema.omit({
  item_id: true
}).extend({
  tenant: uuidSchema.optional()
});

// Update invoice item schema
const updateInvoiceItemSchema = createUpdateSchema(createInvoiceItemSchema);

// Manual invoice item schema (for manual invoice creation)
const manualInvoiceItemSchema = z.object({
  service_id: uuidSchema,
  quantity: z.number().min(0),
  description: z.string().min(1).max(500),
  rate: z.number().min(0),
  is_discount: z.boolean().default(false),
  discount_type: discountTypeSchema.optional(),
  applies_to_item_id: uuidSchema.optional(),
  applies_to_service_id: uuidSchema.optional(),
  tenant: uuidSchema.optional()
});

// Invoice item response schema
const invoiceItemResponseSchema = baseInvoiceItemSchema.merge(baseEntitySchema);

// ============================================================================
// Main Invoice Schemas
// ============================================================================

// Base invoice schema
const baseInvoiceSchema = z.object({
  invoice_id: uuidSchema,
  client_id: uuidSchema,
  invoice_date: invoiceDateSchema,
  due_date: dueDateSchema,
  subtotal: monetaryAmountSchema,
  tax: monetaryAmountSchema,
  total_amount: monetaryAmountSchema,
  status: invoiceStatusSchema,
  invoice_number: z.string().min(1).max(50),
  finalized_at: invoiceDateSchema.optional(),
  credit_applied: monetaryAmountSchema.default(0),
  billing_cycle_id: uuidSchema.optional(),
  is_manual: z.boolean().default(false),
  is_prepayment: z.boolean().default(false),
  billing_period_start: invoiceDateSchema.optional(),
  billing_period_end: invoiceDateSchema.optional()
});

// Create invoice schema
const createInvoiceSchema = baseInvoiceSchema.omit({
  invoice_id: true,
  invoice_number: true,
  finalized_at: true
}).extend({
  tenant: uuidSchema.optional(),
  items: z.array(createInvoiceItemSchema).optional()
});

// Update invoice schema
const updateInvoiceSchema = createUpdateSchema(createInvoiceSchema);

// Invoice response schema
const invoiceResponseSchema = baseInvoiceSchema.merge(baseEntitySchema).extend({
  invoice_items: z.array(invoiceItemResponseSchema).optional()
});

// ============================================================================
// Invoice View Model Schemas
// ============================================================================

// Client info schema for invoice view model
const invoiceClientSchema = z.object({
  name: z.string(),
  logo: z.string().optional(),
  address: z.string().optional()
});

// Contact info schema for invoice view model
const invoiceContactSchema = z.object({
  name: z.string(),
  address: z.string().optional()
});

// Invoice view model schema
const invoiceViewModelSchema = z.object({
  invoice_id: uuidSchema,
  invoice_number: z.string(),
  client_id: uuidSchema,
  client: invoiceClientSchema,
  contact: invoiceContactSchema,
  invoice_date: z.string(),
  due_date: z.string(),
  status: invoiceStatusSchema,
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
  total_amount: z.number(),
  invoice_items: z.array(invoiceItemResponseSchema),
  custom_fields: z.record(z.any()).optional(),
  finalized_at: z.string().optional(),
  credit_applied: z.number().default(0),
  billing_cycle_id: uuidSchema.optional(),
  is_manual: z.boolean().default(false)
});

// ============================================================================
// Invoice Template Schemas
// ============================================================================

// Block type enum for invoice templates
const blockTypeSchema = z.enum(['text', 'dynamic', 'image']);

// Layout block schema
const layoutBlockSchema = z.object({
  block_id: uuidSchema,
  type: blockTypeSchema,
  content: z.string(),
  grid_column: z.number().min(1),
  grid_row: z.number().min(1),
  grid_column_span: z.number().min(1),
  grid_row_span: z.number().min(1),
  styles: z.record(z.string())
});

// Template element schemas
const templateElementSchema = z.object({
  type: z.string(),
  position: z.object({
    column: z.number(),
    row: z.number()
  }).optional(),
  span: z.object({
    columnSpan: z.number(),
    rowSpan: z.number()
  }).optional()
});

// Invoice template schema
const invoiceTemplateSchema = z.object({
  template_id: uuidSchema,
  name: z.string().min(1).max(100),
  version: z.number().min(1).default(1),
  assemblyScriptSource: z.string(),
  wasmBinary: z.instanceof(Buffer).optional(),
  isStandard: z.boolean().default(false),
  isClone: z.boolean().default(false),
  is_default: z.boolean().default(false)
}).merge(baseEntitySchema);

// Create invoice template schema
const createInvoiceTemplateSchema = invoiceTemplateSchema.omit({
  template_id: true
});

// Update invoice template schema
const updateInvoiceTemplateSchema = createUpdateSchema(createInvoiceTemplateSchema);

// ============================================================================
// Invoice Operation Schemas
// ============================================================================

// Generate invoice schema
const generateInvoiceSchema = z.object({
  billing_cycle_id: uuidSchema
});

// Generate invoice number schema
const generateInvoiceNumberSchema = z.object({});

// Generate invoice PDF schema
const generateInvoicePDFSchema = z.object({
  invoice_id: uuidSchema
});

// Manual invoice request schema
const manualInvoiceRequestSchema = z.object({
  clientId: uuidSchema,
  items: z.array(manualInvoiceItemSchema).min(1),
  expirationDate: z.string().optional(),
  isPrepayment: z.boolean().default(false)
});

// Update manual invoice schema
const updateManualInvoiceSchema = z.object({
  invoice_id: uuidSchema,
  request: manualInvoiceRequestSchema
});

// Finalize invoice schema
const finalizeInvoiceSchema = z.object({
  invoice_id: uuidSchema,
  finalized_at: invoiceDateSchema.optional()
});

// Send invoice schema
const sendInvoiceSchema = z.object({
  invoice_id: uuidSchema,
  email_addresses: z.array(z.string().email()).min(1),
  subject: z.string().optional(),
  message: z.string().optional(),
  include_pdf: z.boolean().default(true)
});

// Apply credit to invoice schema
const applyCreditSchema = z.object({
  invoice_id: uuidSchema,
  credit_amount: monetaryAmountSchema,
  transaction_id: uuidSchema.optional()
});

// Invoice payment schema
const invoicePaymentSchema = z.object({
  invoice_id: uuidSchema,
  payment_amount: monetaryAmountSchema,
  payment_method: z.string(),
  payment_date: invoiceDateSchema.optional(),
  reference_number: z.string().optional(),
  notes: z.string().optional()
});

// ============================================================================
// Invoice Search and Filter Schemas
// ============================================================================

// Invoice status filter
const invoiceStatusFilterSchema = z.object({
  status: z.array(invoiceStatusSchema).optional(),
  exclude_status: z.array(invoiceStatusSchema).optional()
});

// Invoice date range filter
const invoiceDateRangeSchema = z.object({
  invoice_date_from: invoiceDateSchema.optional(),
  invoice_date_to: invoiceDateSchema.optional(),
  due_date_from: invoiceDateSchema.optional(),
  due_date_to: invoiceDateSchema.optional(),
  finalized_date_from: invoiceDateSchema.optional(),
  finalized_date_to: invoiceDateSchema.optional()
});

// Invoice amount filter
const invoiceAmountFilterSchema = z.object({
  min_amount: z.number().min(0).optional(),
  max_amount: z.number().min(0).optional(),
  has_credit_applied: z.boolean().optional()
});

// Invoice client filter
const invoiceClientFilterSchema = z.object({
  client_id: z.array(uuidSchema).optional(),
  client_name: z.string().optional()
});

// Invoice type filter
const invoiceTypeFilterSchema = z.object({
  is_manual: z.boolean().optional(),
  is_prepayment: z.boolean().optional(),
  has_billing_cycle: z.boolean().optional()
});

// Comprehensive invoice filter schema
const invoiceFilterSchema = baseFilterSchema
  .merge(invoiceStatusFilterSchema)
  .merge(invoiceDateRangeSchema)
  .merge(invoiceAmountFilterSchema)
  .merge(invoiceClientFilterSchema)
  .merge(invoiceTypeFilterSchema)
  .extend({
    invoice_number: z.string().optional(),
    billing_cycle_id: uuidSchema.optional()
  });

// Invoice list query schema
const invoiceListQuerySchema = createListQuerySchema(invoiceFilterSchema);

// ============================================================================
// Invoice Annotation Schemas
// ============================================================================

// Invoice annotation schema
const invoiceAnnotationSchema = z.object({
  annotation_id: uuidSchema,
  invoice_id: uuidSchema,
  user_id: uuidSchema,
  content: z.string().min(1).max(1000),
  is_internal: z.boolean().default(false),
  created_at: dateSchema
});

// Create invoice annotation schema
const createInvoiceAnnotationSchema = invoiceAnnotationSchema.omit({
  annotation_id: true,
  created_at: true
});

// Update invoice annotation schema
const updateInvoiceAnnotationSchema = createUpdateSchema(createInvoiceAnnotationSchema);

// ============================================================================
// Bulk Operation Schemas
// ============================================================================

// Bulk invoice status update
const bulkInvoiceStatusUpdateSchema = z.object({
  invoice_ids: z.array(uuidSchema).min(1).max(100),
  status: invoiceStatusSchema,
  finalized_at: invoiceDateSchema.optional()
});

// Bulk invoice send
const bulkInvoiceSendSchema = z.object({
  invoice_ids: z.array(uuidSchema).min(1).max(50),
  email_template: z.string().optional(),
  include_pdf: z.boolean().default(true)
});

// Bulk invoice delete
const bulkInvoiceDeleteSchema = bulkDeleteSchema;

// Bulk invoice credit application
const bulkInvoiceCreditSchema = z.object({
  invoice_ids: z.array(uuidSchema).min(1).max(100),
  credit_amount_per_invoice: monetaryAmountSchema
});

// ============================================================================
// Tax Calculation Schemas
// ============================================================================

// Tax calculation request
const taxCalculationRequestSchema = z.object({
  client_id: uuidSchema,
  amount: monetaryAmountSchema,
  tax_region: taxRegionSchema,
  calculation_date: invoiceDateSchema.optional()
});

// Tax calculation response
const taxCalculationResponseSchema = z.object({
  tax_amount: monetaryAmountSchema,
  tax_rate: z.number().min(0).max(1),
  tax_region: taxRegionSchema,
  calculation_date: invoiceDateSchema
});

// ============================================================================
// Recurring Invoice Schemas
// ============================================================================

// Recurrence frequency enum
const recurrenceFrequencySchema = z.enum([
  'daily',
  'weekly', 
  'monthly',
  'quarterly',
  'annually'
]);

// Recurring invoice template schema
const recurringInvoiceTemplateSchema = z.object({
  template_id: uuidSchema,
  client_id: uuidSchema,
  name: z.string().min(1).max(100),
  frequency: recurrenceFrequencySchema,
  start_date: invoiceDateSchema,
  end_date: invoiceDateSchema.optional(),
  next_generation_date: invoiceDateSchema,
  is_active: z.boolean().default(true),
  invoice_template: createInvoiceSchema,
  max_generations: z.number().min(1).optional()
}).merge(baseEntitySchema);

// Create recurring invoice template
const createRecurringInvoiceTemplateSchema = recurringInvoiceTemplateSchema.omit({
  template_id: true,
  next_generation_date: true
});

// Update recurring invoice template
const updateRecurringInvoiceTemplateSchema = createUpdateSchema(createRecurringInvoiceTemplateSchema);

// ============================================================================
// Invoice Preview Schemas
// ============================================================================

// Invoice preview request
const invoicePreviewRequestSchema = z.object({
  billing_cycle_id: uuidSchema
});

// Invoice preview response
const invoicePreviewResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    data: z.object({
      invoiceNumber: z.string(),
      issueDate: z.string(),
      dueDate: z.string(), 
      customer: z.object({
        name: z.string(),
        address: z.string()
      }),
      tenantClient: z.object({
        name: z.string(),
        address: z.string(),
        logoUrl: z.string().nullable()
      }).nullable(),
      items: z.array(z.object({
        id: z.string(),
        description: z.string(),
        quantity: z.number(),
        unitPrice: z.number(),
        total: z.number()
      })),
      subtotal: z.number(),
      tax: z.number(),
      total: z.number()
    })
  }),
  z.object({
    success: z.literal(false),
    error: z.string()
  })
]);

// ============================================================================
// Response Schemas
// ============================================================================

// Invoice list response
const invoiceListResponseSchema = paginatedResponseSchema.extend({
  data: z.array(invoiceResponseSchema)
});

// Single invoice response
const singleInvoiceResponseSchema = successResponseSchema.extend({
  data: invoiceResponseSchema
});

// Invoice view model response
const invoiceViewModelResponseSchema = successResponseSchema.extend({
  data: invoiceViewModelSchema
});

// Invoice PDF generation response
const invoicePDFResponseSchema = successResponseSchema.extend({
  data: z.object({
    file_id: uuidSchema,
    download_url: z.string().url().optional()
  })
});

// Invoice template list response
const invoiceTemplateListResponseSchema = paginatedResponseSchema.extend({
  data: z.array(invoiceTemplateSchema)
});

// Invoice annotation list response  
const invoiceAnnotationListResponseSchema = paginatedResponseSchema.extend({
  data: z.array(invoiceAnnotationSchema)
});

// Tax calculation list response
const taxCalculationListResponseSchema = successResponseSchema.extend({
  data: z.array(taxCalculationResponseSchema)
});

// ============================================================================
// Route Parameter Schemas
// ============================================================================

// Invoice ID parameter
const invoiceIdParamSchema = z.object({
  invoice_id: uuidSchema
});

// Invoice item ID parameter
const invoiceItemIdParamSchema = z.object({
  item_id: uuidSchema
});

// Template ID parameter
const templateIdParamSchema = z.object({
  template_id: uuidSchema
});

// Annotation ID parameter
const annotationIdParamSchema = z.object({
  annotation_id: uuidSchema
});

// ============================================================================
// Validation Helpers
// ============================================================================

// Validate invoice number format
export function validateInvoiceNumber(value: string): boolean {
  // Customize based on your invoice numbering scheme
  const invoiceNumberRegex = /^[A-Z]{2,5}-\d{4,8}$/;
  return invoiceNumberRegex.test(value);
}

// Validate monetary amounts
export function validateMonetaryAmount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

// Validate tax rate
export function validateTaxRate(value: number): boolean {
  return value >= 0 && value <= 1;
}

// Validate discount percentage
export function validateDiscountPercentage(value: number): boolean {
  return value >= 0 && value <= 100;
}

// ============================================================================
// Export Schema Types
// ============================================================================

// Export all schema types for TypeScript integration
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export type DiscountType = z.infer<typeof discountTypeSchema>;
export type InvoiceItem = z.infer<typeof baseInvoiceItemSchema>;
export type CreateInvoiceItem = z.infer<typeof createInvoiceItemSchema>;
export type UpdateInvoiceItem = z.infer<typeof updateInvoiceItemSchema>;
export type ManualInvoiceItem = z.infer<typeof manualInvoiceItemSchema>;
export type Invoice = z.infer<typeof baseInvoiceSchema>;
export type CreateInvoice = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoice = z.infer<typeof updateInvoiceSchema>;
export type InvoiceResponse = z.infer<typeof invoiceResponseSchema>;
export type InvoiceViewModel = z.infer<typeof invoiceViewModelSchema>;
export type InvoiceTemplate = z.infer<typeof invoiceTemplateSchema>;
export type CreateInvoiceTemplate = z.infer<typeof createInvoiceTemplateSchema>;
export type UpdateInvoiceTemplate = z.infer<typeof updateInvoiceTemplateSchema>;
export type GenerateInvoice = z.infer<typeof generateInvoiceSchema>;
export type ManualInvoiceRequest = z.infer<typeof manualInvoiceRequestSchema>;
export type UpdateManualInvoice = z.infer<typeof updateManualInvoiceSchema>;
export type FinalizeInvoice = z.infer<typeof finalizeInvoiceSchema>;
export type SendInvoice = z.infer<typeof sendInvoiceSchema>;
export type ApplyCredit = z.infer<typeof applyCreditSchema>;
export type InvoicePayment = z.infer<typeof invoicePaymentSchema>;
export type InvoiceFilter = z.infer<typeof invoiceFilterSchema>;
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;
export type InvoiceAnnotation = z.infer<typeof invoiceAnnotationSchema>;
export type CreateInvoiceAnnotation = z.infer<typeof createInvoiceAnnotationSchema>;
export type UpdateInvoiceAnnotation = z.infer<typeof updateInvoiceAnnotationSchema>;
export type BulkInvoiceStatusUpdate = z.infer<typeof bulkInvoiceStatusUpdateSchema>;
export type BulkInvoiceSend = z.infer<typeof bulkInvoiceSendSchema>;
export type BulkInvoiceDelete = z.infer<typeof bulkInvoiceDeleteSchema>;
export type BulkInvoiceCredit = z.infer<typeof bulkInvoiceCreditSchema>;
export type TaxCalculationRequest = z.infer<typeof taxCalculationRequestSchema>;
export type TaxCalculationResponse = z.infer<typeof taxCalculationResponseSchema>;
export type RecurringInvoiceTemplate = z.infer<typeof recurringInvoiceTemplateSchema>;
export type CreateRecurringInvoiceTemplate = z.infer<typeof createRecurringInvoiceTemplateSchema>;
export type UpdateRecurringInvoiceTemplate = z.infer<typeof updateRecurringInvoiceTemplateSchema>;
export type InvoicePreviewRequest = z.infer<typeof invoicePreviewRequestSchema>;
export type InvoicePreviewResponse = z.infer<typeof invoicePreviewResponseSchema>;

// ============================================================================
// Export All Schemas
// ============================================================================

export {
  // Base schemas
  invoiceStatusSchema,
  discountTypeSchema,
  taxRegionSchema,
  monetaryAmountSchema,
  invoiceDateSchema,
  dueDateSchema,
  
  // Invoice item schemas
  baseInvoiceItemSchema,
  createInvoiceItemSchema,
  updateInvoiceItemSchema,
  manualInvoiceItemSchema,
  invoiceItemResponseSchema,
  
  // Main invoice schemas
  baseInvoiceSchema,
  createInvoiceSchema,
  updateInvoiceSchema,
  invoiceResponseSchema,
  
  // View model schemas
  invoiceClientSchema,
  invoiceContactSchema,
  invoiceViewModelSchema,
  
  // Template schemas
  blockTypeSchema,
  layoutBlockSchema,
  templateElementSchema,
  invoiceTemplateSchema,
  createInvoiceTemplateSchema,
  updateInvoiceTemplateSchema,
  
  // Operation schemas
  generateInvoiceSchema,
  generateInvoiceNumberSchema,
  generateInvoicePDFSchema,
  manualInvoiceRequestSchema,
  updateManualInvoiceSchema,
  finalizeInvoiceSchema,
  sendInvoiceSchema,
  applyCreditSchema,
  invoicePaymentSchema,
  
  // Filter and search schemas
  invoiceStatusFilterSchema,
  invoiceDateRangeSchema,
  invoiceAmountFilterSchema,
  invoiceClientFilterSchema,
  invoiceTypeFilterSchema,
  invoiceFilterSchema,
  invoiceListQuerySchema,
  
  // Annotation schemas
  invoiceAnnotationSchema,
  createInvoiceAnnotationSchema,
  updateInvoiceAnnotationSchema,
  
  // Bulk operation schemas
  bulkInvoiceStatusUpdateSchema,
  bulkInvoiceSendSchema,
  bulkInvoiceDeleteSchema,
  bulkInvoiceCreditSchema,
  
  // Tax schemas
  taxCalculationRequestSchema,
  taxCalculationResponseSchema,
  
  // Recurring invoice schemas
  recurrenceFrequencySchema,
  recurringInvoiceTemplateSchema,
  createRecurringInvoiceTemplateSchema,
  updateRecurringInvoiceTemplateSchema,
  
  // Preview schemas
  invoicePreviewRequestSchema,
  invoicePreviewResponseSchema,
  
  // Response schemas
  invoiceListResponseSchema,
  singleInvoiceResponseSchema,
  invoiceViewModelResponseSchema,
  invoicePDFResponseSchema,
  invoiceTemplateListResponseSchema,
  invoiceAnnotationListResponseSchema,
  taxCalculationListResponseSchema,
  
  // Parameter schemas
  invoiceIdParamSchema,
  invoiceItemIdParamSchema,
  templateIdParamSchema,
  annotationIdParamSchema
};
