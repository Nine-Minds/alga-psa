/**
 * Financial Management API Schemas
 * Comprehensive Zod validation schemas for financial operations including:
 * - Payment processing and tracking
 * - Credit management and applications
 * - Financial adjustments and corrections
 * - Account balances and aging reports
 * - Tax management and calculations
 * - Financial reporting and analytics
 * - Payment method management
 * - Transaction history and auditing
 * - Financial reconciliation
 * - Bulk financial operations
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
  baseEntitySchema,
  idParamSchema,
  numberTransform,
  booleanTransform,
  dateTransform
} from './common';

// ============================================================================
// ENUMS AND CONSTANTS
// ============================================================================

export const transactionTypeSchema = z.enum([
  'credit_application',
  'credit_issuance',
  'credit_adjustment',
  'credit_expiration',
  'credit_transfer',
  'credit_issuance_from_negative_invoice',
  'payment',
  'partial_payment',
  'prepayment',
  'payment_reversal',
  'payment_failed',
  'invoice_generated',
  'invoice_adjustment',
  'invoice_cancelled',
  'late_fee',
  'early_payment_discount',
  'refund_full',
  'refund_partial',
  'refund_reversal',
  'service_credit',
  'price_adjustment',
  'service_adjustment',
  'billing_cycle_adjustment',
  'currency_adjustment',
  'tax_adjustment'
]);

export const chargeTypeSchema = z.enum(['fixed', 'time', 'usage', 'bucket', 'product', 'license']);

export const billingCycleTypeSchema = z.enum([
  'weekly', 
  'bi-weekly', 
  'monthly', 
  'quarterly', 
  'semi-annually', 
  'annually'
]);

export const invoiceStatusSchema = z.enum([
  'draft', 
  'sent', 
  'paid', 
  'overdue', 
  'cancelled', 
  'pending', 
  'prepayment', 
  'partially_applied'
]);

export const transactionStatusSchema = z.enum(['pending', 'completed', 'failed']);

export const discountTypeSchema = z.enum(['percentage', 'fixed']);

export const paymentMethodTypeSchema = z.enum(['credit_card', 'bank_account']);

export const reconciliationStatusSchema = z.enum(['open', 'in_review', 'resolved']);

export const taxTypeSchema = z.enum(['VAT', 'GST', 'Sales Tax']);

export const planTypeSchema = z.enum(['Fixed', 'Hourly', 'Usage']);

export const billingMethodSchema = z.enum(['fixed', 'hourly', 'usage']);

export const billingCycleAlignmentSchema = z.enum(['start', 'end', 'prorated']);

export const zeroInvoiceHandlingSchema = z.enum(['normal', 'finalized']);

// ============================================================================
// BASE FINANCIAL SCHEMAS
// ============================================================================

export const amountSchema = z.number().min(0);
export const monetaryAmountSchema = z.number().int().min(0); // For cent-based amounts
export const percentageSchema = z.number().min(0).max(100);
export const taxRateSchema = z.number().min(0).max(1);

// ============================================================================
// TRANSACTION SCHEMAS
// ============================================================================

export const transactionBaseSchema = z.object({
  transaction_id: uuidSchema.optional(),
  client_id: uuidSchema,
  invoice_id: uuidSchema.optional(),
  amount: z.number(),
  type: transactionTypeSchema,
  status: transactionStatusSchema.optional().default('completed'),
  parent_transaction_id: uuidSchema.optional(),
  description: z.string().optional(),
  reference_number: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  balance_after: z.number(),
  expiration_date: dateSchema.optional(),
  related_transaction_id: uuidSchema.optional()
});

export const createTransactionSchema = transactionBaseSchema.extend({
  tenant: uuidSchema
});

export const updateTransactionSchema = transactionBaseSchema.partial();

export const transactionResponseSchema = transactionBaseSchema.merge(baseEntitySchema);

export const transactionListQuerySchema = paginationQuerySchema.merge(baseFilterSchema).extend({
  client_id: uuidSchema.optional(),
  type: transactionTypeSchema.optional(),
  status: transactionStatusSchema.optional(),
  amount_min: numberTransform.optional(),
  amount_max: numberTransform.optional(),
  has_expiration: booleanTransform.optional()
});

// ============================================================================
// CREDIT MANAGEMENT SCHEMAS
// ============================================================================

export const creditTrackingBaseSchema = z.object({
  credit_id: uuidSchema.optional(),
  client_id: uuidSchema,
  transaction_id: uuidSchema,
  amount: amountSchema,
  remaining_amount: amountSchema,
  expiration_date: dateSchema.optional(),
  is_expired: z.boolean().default(false)
});

export const createCreditTrackingSchema = creditTrackingBaseSchema.extend({
  tenant: uuidSchema
});

export const updateCreditTrackingSchema = creditTrackingBaseSchema.partial();

export const creditTrackingResponseSchema = creditTrackingBaseSchema.merge(baseEntitySchema);

export const creditListQuerySchema = paginationQuerySchema.merge(baseFilterSchema).extend({
  client_id: uuidSchema.optional(),
  include_expired: booleanTransform.optional().default("false"),
  expiring_soon: booleanTransform.optional(),
  has_remaining: booleanTransform.optional()
});

// Credit application schemas
export const applyCreditToInvoiceSchema = z.object({
  client_id: uuidSchema,
  invoice_id: uuidSchema,
  requested_amount: amountSchema
});

export const createPrepaymentInvoiceSchema = z.object({
  client_id: uuidSchema,
  amount: amountSchema,
  manual_expiration_date: dateSchema.optional()
});

export const updateCreditExpirationSchema = z.object({
  credit_id: uuidSchema,
  new_expiration_date: dateSchema.nullable(),
  user_id: uuidSchema
});

export const manuallyExpireCreditSchema = z.object({
  credit_id: uuidSchema,
  user_id: uuidSchema,
  reason: z.string().optional()
});

export const transferCreditSchema = z.object({
  source_credit_id: uuidSchema,
  target_client_id: uuidSchema,
  amount: amountSchema,
  user_id: uuidSchema,
  reason: z.string().optional()
});

// Credit allocation schemas
export const creditAllocationBaseSchema = z.object({
  allocation_id: uuidSchema.optional(),
  transaction_id: uuidSchema,
  invoice_id: uuidSchema,
  amount: amountSchema
});

export const createCreditAllocationSchema = creditAllocationBaseSchema.extend({
  tenant: uuidSchema
});

export const creditAllocationResponseSchema = creditAllocationBaseSchema.merge(baseEntitySchema);

// ============================================================================
// PAYMENT METHOD SCHEMAS
// ============================================================================

export const paymentMethodBaseSchema = z.object({
  payment_method_id: uuidSchema.optional(),
  client_id: uuidSchema,
  type: paymentMethodTypeSchema,
  last4: z.string().length(4),
  exp_month: z.string().length(2).optional(),
  exp_year: z.string().length(4).optional(),
  is_default: z.boolean().default(false),
  is_deleted: z.boolean().default(false)
});

export const createPaymentMethodSchema = paymentMethodBaseSchema.extend({
  tenant: uuidSchema
});

export const updatePaymentMethodSchema = paymentMethodBaseSchema.partial();

export const paymentMethodResponseSchema = paymentMethodBaseSchema.merge(baseEntitySchema);

export const paymentMethodListQuerySchema = paginationQuerySchema.merge(baseFilterSchema).extend({
  client_id: uuidSchema.optional(),
  type: paymentMethodTypeSchema.optional(),
  is_default: booleanTransform.optional(),
  exclude_deleted: booleanTransform.optional().default("true")
});

// ============================================================================
// BILLING CHARGE SCHEMAS
// ============================================================================

export const billingChargeBaseSchema = z.object({
  type: chargeTypeSchema,
  service_id: uuidSchema.optional(),
  client_contract_line_id: uuidSchema.optional(),
  service_name: z.string(),
  rate: z.number(),
  total: z.number(),
  quantity: z.number().optional(),
  duration: z.number().optional(),
  user_id: uuidSchema.optional(),
  tax_amount: z.number().default(0),
  tax_rate: z.number().default(0),
  tax_region: z.string().optional(),
  is_taxable: z.boolean().optional().default(true),
  client_contract_id: uuidSchema.optional(),
  contract_name: z.string().optional()
});

export const fixedPriceChargeSchema = billingChargeBaseSchema.extend({
  type: z.literal('fixed'),
  service_id: uuidSchema.optional(),
  quantity: z.number(),
  enable_proration: z.boolean().optional(),
  billing_cycle_alignment: billingCycleAlignmentSchema.optional(),
  config_id: uuidSchema.optional(),
  base_rate: z.number().optional(),
  fmv: z.number().optional(),
  proportion: z.number().optional(),
  allocated_amount: z.number().optional()
});

export const timeBasedChargeSchema = billingChargeBaseSchema.extend({
  type: z.literal('time'),
  service_id: uuidSchema,
  user_id: uuidSchema,
  duration: z.number(),
  entry_id: uuidSchema
});

export const usageBasedChargeSchema = billingChargeBaseSchema.extend({
  type: z.literal('usage'),
  service_id: uuidSchema,
  quantity: z.number(),
  usage_id: uuidSchema
});

export const bucketChargeSchema = billingChargeBaseSchema.extend({
  type: z.literal('bucket'),
  hours_used: z.number(),
  overage_hours: z.number(),
  overage_rate: z.number(),
  service_catalog_id: uuidSchema
});

export const productChargeSchema = billingChargeBaseSchema.extend({
  type: z.literal('product'),
  service_id: uuidSchema,
  quantity: z.number()
});

export const licenseChargeSchema = billingChargeBaseSchema.extend({
  type: z.literal('license'),
  service_id: uuidSchema,
  quantity: z.number(),
  period_start: dateSchema.optional(),
  period_end: dateSchema.optional()
});

// ============================================================================
// DISCOUNT AND ADJUSTMENT SCHEMAS
// ============================================================================

export const discountBaseSchema = z.object({
  discount_id: uuidSchema,
  discount_name: z.string(),
  discount_type: discountTypeSchema,
  value: z.number(),
  amount: z.number().optional()
});

export const createDiscountSchema = discountBaseSchema.extend({
  tenant: uuidSchema
});

export const discountResponseSchema = discountBaseSchema.merge(baseEntitySchema);

export const adjustmentBaseSchema = z.object({
  description: z.string(),
  amount: z.number()
});

export const createAdjustmentSchema = adjustmentBaseSchema.extend({
  tenant: uuidSchema
});

export const adjustmentResponseSchema = adjustmentBaseSchema.merge(baseEntitySchema);

// ============================================================================
// BILLING RESULT SCHEMAS
// ============================================================================

export const billingResultSchema = z.object({
  charges: z.array(billingChargeBaseSchema),
  total_amount: z.number(),
  discounts: z.array(discountResponseSchema),
  adjustments: z.array(adjustmentResponseSchema),
  final_amount: z.number()
}).merge(baseEntitySchema);

// ============================================================================
// INVOICE SCHEMAS
// ============================================================================

export const invoiceBaseSchema = z.object({
  invoice_id: uuidSchema.optional(),
  client_id: uuidSchema,
  invoice_date: isoDateSchema,
  due_date: isoDateSchema,
  subtotal: z.number(),
  tax: z.number(),
  total_amount: z.number(),
  status: invoiceStatusSchema,
  invoice_number: z.string(),
  finalized_at: isoDateSchema.optional(),
  credit_applied: z.number().default(0),
  billing_cycle_id: uuidSchema.optional(),
  is_manual: z.boolean().default(false)
});

export const createInvoiceSchema = invoiceBaseSchema.extend({
  tenant: uuidSchema
});

export const updateInvoiceSchema = invoiceBaseSchema.partial();

export const invoiceResponseSchema = invoiceBaseSchema.merge(baseEntitySchema);

export const invoiceListQuerySchema = paginationQuerySchema.merge(baseFilterSchema).extend({
  client_id: uuidSchema.optional(),
  status: invoiceStatusSchema.optional(),
  billing_cycle_id: uuidSchema.optional(),
  due_date_from: dateSchema.optional(),
  due_date_to: dateSchema.optional(),
  amount_min: numberTransform.optional(),
  amount_max: numberTransform.optional(),
  is_manual: booleanTransform.optional(),
  has_credit_applied: booleanTransform.optional()
});

// Invoice item schemas
export const invoiceItemBaseSchema = z.object({
  item_id: uuidSchema.optional(),
  invoice_id: uuidSchema,
  service_id: uuidSchema.optional(),
  contract_line_id: uuidSchema.optional(),
  description: z.string(),
  quantity: z.number(),
  unit_price: z.number(),
  total_price: z.number(),
  tax_amount: z.number().default(0),
  net_amount: z.number(),
  tax_region: z.string().optional(),
  tax_rate: z.number().optional(),
  is_manual: z.boolean().default(false),
  is_taxable: z.boolean().optional().default(true),
  is_discount: z.boolean().optional().default(false),
  discount_type: discountTypeSchema.optional(),
  discount_percentage: z.number().optional(),
  applies_to_item_id: uuidSchema.optional(),
  applies_to_service_id: uuidSchema.optional(),
  client_contract_id: uuidSchema.optional(),
  contract_name: z.string().optional(),
  // Accept legacy and new alias; default both to false
  is_bundle_header: z.boolean().optional().default(false),
  parent_item_id: uuidSchema.optional(),
  created_by: uuidSchema.optional(),
  updated_by: uuidSchema.optional()
});

export const createInvoiceItemSchema = invoiceItemBaseSchema.extend({
  tenant: uuidSchema
});

export const updateInvoiceItemSchema = invoiceItemBaseSchema.partial();

export const invoiceItemResponseSchema = invoiceItemBaseSchema.merge(baseEntitySchema);

export const addManualItemsSchema = z.object({
  invoice_id: uuidSchema,
  items: z.array(createInvoiceItemSchema)
});

// ============================================================================
// TAX MANAGEMENT SCHEMAS
// ============================================================================

export const taxRateBaseSchema = z.object({
  tax_rate_id: uuidSchema.optional(),
  region_code: z.string(),
  tax_percentage: z.number(),
  description: z.string().optional(),
  start_date: dateSchema,
  end_date: dateSchema.optional()
});

export const createTaxRateSchema = taxRateBaseSchema.extend({
  tenant: uuidSchema
});

export const updateTaxRateSchema = taxRateBaseSchema.partial();

export const taxRateResponseSchema = taxRateBaseSchema.merge(baseEntitySchema);

export const taxRateListQuerySchema = paginationQuerySchema.merge(baseFilterSchema).extend({
  region_code: z.string().optional(),
  effective_date: dateSchema.optional(),
  is_active: booleanTransform.optional()
});

// Advanced tax schemas
export const taxRateAdvancedSchema = z.object({
  tax_rate_id: uuidSchema.optional(),
  tax_type: taxTypeSchema,
  country_code: z.string(),
  tax_percentage: z.number(),
  is_reverse_charge_applicable: z.boolean().default(false),
  is_composite: z.boolean().default(false),
  start_date: dateSchema,
  end_date: dateSchema.optional(),
  is_active: z.boolean().default(true),
  conditions: z.record(z.any()).optional(),
  description: z.string().nullable().optional(),
  region_code: z.string()
});

export const taxComponentSchema = z.object({
  tax_component_id: uuidSchema.optional(),
  tax_rate_id: uuidSchema,
  name: z.string(),
  rate: z.number(),
  sequence: z.number(),
  is_compound: z.boolean().default(false),
  start_date: dateSchema.optional(),
  end_date: dateSchema.optional(),
  conditions: z.record(z.any()).optional()
});

export const taxCalculationResultSchema = z.object({
  tax_amount: z.number(),
  tax_rate: z.number(),
  tax_components: z.array(taxComponentSchema).optional(),
  applied_thresholds: z.array(z.any()).optional(),
  applied_holidays: z.array(z.any()).optional()
});

export const clientTaxSettingsSchema = z.object({
  client_id: uuidSchema,
  is_reverse_charge_applicable: z.boolean().default(false),
  tax_components: z.array(taxComponentSchema).optional(),
  tax_rate_thresholds: z.array(z.any()).optional(),
  tax_holidays: z.array(z.any()).optional()
}).merge(baseEntitySchema);

// ============================================================================
// CONTRACT LINE SCHEMAS
// ============================================================================

export const contractLineBaseSchema = z.object({
  contract_line_id: uuidSchema.optional(),
  contract_line_name: z.string(),
  billing_frequency: billingCycleTypeSchema,
  is_custom: z.boolean().default(false),
  service_category: z.string().optional(),
  contract_line_type: planTypeSchema,
  hourly_rate: z.number().nullable().optional(),
  minimum_billable_time: z.number().nullable().optional(),
  round_up_to_nearest: z.number().nullable().optional(),
  enable_overtime: z.boolean().nullable().optional(),
  overtime_rate: z.number().nullable().optional(),
  overtime_threshold: z.number().nullable().optional(),
  enable_after_hours_rate: z.boolean().nullable().optional(),
  after_hours_multiplier: z.number().nullable().optional()
});

export const createContractLineSchema = contractLineBaseSchema.extend({
  tenant: uuidSchema
});

export const updateContractLineSchema = contractLineBaseSchema.partial();

export const contractLineResponseSchema = contractLineBaseSchema.merge(baseEntitySchema);

export const contractLineListQuerySchema = paginationQuerySchema.merge(baseFilterSchema).extend({
  contract_line_type: planTypeSchema.optional(),
  billing_frequency: billingCycleTypeSchema.optional(),
  is_custom: booleanTransform.optional(),
  service_category: z.string().optional()
});

// Client contract line schemas
export const clientContractLineBaseSchema = z.object({
  client_contract_line_id: uuidSchema.optional(),
  client_id: uuidSchema,
  contract_line_id: uuidSchema,
  service_category: z.string().optional(),
  service_category_name: z.string().optional(),
  start_date: dateSchema,
  end_date: dateSchema.nullable().optional(),
  is_active: z.boolean().default(true),
  custom_rate: z.number().optional(),
  client_contract_id: uuidSchema.optional(),
  contract_line_name: z.string().optional(),
  billing_frequency: billingCycleTypeSchema.optional(),
  contract_name: z.string().optional()
});

export const createClientContractLineSchema = clientContractLineBaseSchema.extend({
  tenant: uuidSchema
});

export const updateClientContractLineSchema = clientContractLineBaseSchema.partial();

export const clientContractLineResponseSchema = clientContractLineBaseSchema.merge(baseEntitySchema);

// ============================================================================
// BILLING CYCLE SCHEMAS
// ============================================================================

export const clientContractLineCycleBaseSchema = z.object({
  billing_cycle_id: uuidSchema.optional(),
  client_id: uuidSchema,
  billing_cycle: billingCycleTypeSchema,
  effective_date: dateSchema,
  period_start_date: dateSchema,
  period_end_date: dateSchema
});

export const createClientContractLineCycleSchema = clientContractLineCycleBaseSchema.extend({
  tenant: uuidSchema
});

export const updateClientContractLineCycleSchema = clientContractLineCycleBaseSchema.partial();

export const clientContractLineCycleResponseSchema = clientContractLineCycleBaseSchema.merge(baseEntitySchema);

export const billingCycleInvoiceRequestSchema = z.object({
  billing_cycle_id: uuidSchema
});

// ============================================================================
// FINANCIAL RECONCILIATION SCHEMAS
// ============================================================================

export const creditReconciliationReportBaseSchema = z.object({
  report_id: uuidSchema.optional(),
  client_id: uuidSchema,
  expected_balance: z.number(),
  actual_balance: z.number(),
  difference: z.number(),
  detection_date: dateSchema,
  status: reconciliationStatusSchema,
  resolution_date: dateSchema.optional(),
  resolution_user: uuidSchema.optional(),
  resolution_notes: z.string().optional(),
  resolution_transaction_id: uuidSchema.optional(),
  metadata: z.record(z.any()).optional()
});

export const createCreditReconciliationReportSchema = creditReconciliationReportBaseSchema.extend({
  tenant: uuidSchema
});

export const updateCreditReconciliationReportSchema = creditReconciliationReportBaseSchema.partial();

export const creditReconciliationReportResponseSchema = creditReconciliationReportBaseSchema.merge(baseEntitySchema);

export const reconciliationListQuerySchema = paginationQuerySchema.merge(baseFilterSchema).extend({
  client_id: uuidSchema.optional(),
  status: reconciliationStatusSchema.optional(),
  detection_date_from: dateSchema.optional(),
  detection_date_to: dateSchema.optional(),
  difference_min: numberTransform.optional(),
  difference_max: numberTransform.optional()
});

// ============================================================================
// BILLING SETTINGS SCHEMAS
// ============================================================================

export const defaultBillingSettingsSchema = z.object({
  zero_dollar_invoice_handling: zeroInvoiceHandlingSchema,
  suppress_zero_dollar_invoices: z.boolean(),
  enable_credit_expiration: z.boolean(),
  credit_expiration_days: z.number().int().min(1),
  credit_expiration_notification_days: z.array(z.number().int().min(1))
}).merge(baseEntitySchema);

export const clientContractLineSettingsSchema = z.object({
  client_id: uuidSchema,
  zero_dollar_invoice_handling: zeroInvoiceHandlingSchema,
  suppress_zero_dollar_invoices: z.boolean(),
  enable_credit_expiration: z.boolean().optional(),
  credit_expiration_days: z.number().int().min(1).optional(),
  credit_expiration_notification_days: z.array(z.number().int().min(1)).optional()
}).merge(baseEntitySchema);

export const updateBillingSettingsSchema = z.object({
  zero_dollar_invoice_handling: zeroInvoiceHandlingSchema.optional(),
  suppress_zero_dollar_invoices: z.boolean().optional(),
  enable_credit_expiration: z.boolean().optional(),
  credit_expiration_days: z.number().int().min(1).optional(),
  credit_expiration_notification_days: z.array(z.number().int().min(1)).optional()
});

// ============================================================================
// FINANCIAL REPORTING SCHEMAS
// ============================================================================

export const accountBalanceReportSchema = z.object({
  client_id: uuidSchema,
  current_balance: z.number(),
  available_credit: z.number(),
  expired_credit: z.number(),
  pending_invoices: z.number(),
  overdue_amount: z.number(),
  last_payment_date: dateSchema.optional(),
  last_payment_amount: z.number().optional(),
  as_of_date: dateSchema
});

export const agingReportItemSchema = z.object({
  client_id: uuidSchema,
  client_name: z.string(),
  current: z.number(),
  days_30: z.number(),
  days_60: z.number(),
  days_90: z.number(),
  days_over_90: z.number(),
  total_outstanding: z.number()
});

export const agingReportSchema = z.object({
  report_date: dateSchema,
  summary: z.object({
    total_current: z.number(),
    total_30_days: z.number(),
    total_60_days: z.number(),
    total_90_days: z.number(),
    total_over_90_days: z.number(),
    grand_total: z.number()
  }),
  clients: z.array(agingReportItemSchema)
});

export const financialAnalyticsQuerySchema = z.object({
  client_id: uuidSchema.optional(),
  date_from: dateSchema,
  date_to: dateSchema,
  group_by: z.enum(['day', 'week', 'month']).optional().default('month'),
  include_projections: booleanTransform.optional().default("false")
});

export const revenueAnalyticsSchema = z.object({
  period: z.string(),
  total_revenue: z.number(),
  recurring_revenue: z.number(),
  one_time_revenue: z.number(),
  credit_applied: z.number(),
  net_revenue: z.number(),
  invoice_count: z.number(),
  average_invoice_value: z.number()
});

export const creditAnalyticsSchema = z.object({
  period: z.string(),
  credits_issued: z.number(),
  credits_applied: z.number(),
  credits_expired: z.number(),
  credit_balance: z.number(),
  utilization_rate: z.number(),
  average_credit_age: z.number()
});

// ============================================================================
// BULK OPERATIONS SCHEMAS
// ============================================================================

export const bulkInvoiceOperationSchema = z.object({
  invoice_ids: z.array(uuidSchema).min(1).max(50),
  operation: z.enum(['finalize', 'send', 'cancel', 'apply_credit']),
  parameters: z.record(z.any()).optional()
});

export const bulkTransactionOperationSchema = z.object({
  transaction_ids: z.array(uuidSchema).min(1).max(100),
  operation: z.enum(['approve', 'reject', 'reverse']),
  reason: z.string().optional()
});

export const bulkCreditOperationSchema = z.object({
  credit_ids: z.array(uuidSchema).min(1).max(100),
  operation: z.enum(['expire', 'extend_expiration', 'transfer']),
  parameters: z.object({
    expiration_date: dateSchema.optional(),
    target_client_id: uuidSchema.optional(),
    reason: z.string().optional()
  }).optional()
});

export const bulkOperationResultSchema = z.object({
  total_requested: z.number(),
  successful: z.number(),
  failed: z.number(),
  results: z.array(z.object({
    id: uuidSchema,
    success: z.boolean(),
    error: z.string().optional(),
    result: z.any().optional()
  }))
});

// ============================================================================
// PAYMENT TERM SCHEMAS
// ============================================================================

export const paymentTermSchema = z.object({
  id: z.string(),
  name: z.string()
});

export const paymentTermsListResponseSchema = z.array(paymentTermSchema);

// ============================================================================
// SERVICE AND CATALOG SCHEMAS
// ============================================================================

export const serviceBaseSchema = z.object({
  service_id: uuidSchema.optional(),
  service_name: z.string(),
  custom_service_type_id: uuidSchema,
  billing_method: billingMethodSchema,
  default_rate: z.number(),
  category_id: uuidSchema.nullable().optional(),
  unit_of_measure: z.string(),
  tax_rate_id: uuidSchema.nullable().optional(),
  description: z.string().nullable().optional(),
  service_type_name: z.string().optional()
});

export const createServiceSchema = serviceBaseSchema.extend({
  tenant: uuidSchema
});

export const updateServiceSchema = serviceBaseSchema.partial();

export const serviceResponseSchema = serviceBaseSchema.merge(baseEntitySchema);

export const serviceCategorySchema = z.object({
  category_id: uuidSchema.nullable().optional(),
  category_name: z.string(),
  description: z.string().optional()
}).merge(baseEntitySchema);

export const bucketUsageSchema = z.object({
  usage_id: uuidSchema.optional(),
  contract_line_id: uuidSchema.optional(),
  client_id: uuidSchema,
  period_start: dateSchema,
  period_end: dateSchema,
  minutes_used: z.number(),
  overage_minutes: z.number(),
  service_catalog_id: uuidSchema,
  rolled_over_minutes: z.number()
}).merge(baseEntitySchema);

// ============================================================================
// REQUEST/RESPONSE WRAPPERS
// ============================================================================

// Success responses
export const transactionSuccessResponseSchema = successResponseSchema.extend({
  data: transactionResponseSchema
});

export const transactionListResponseSchema = paginatedResponseSchema.extend({
  data: z.array(transactionResponseSchema)
});

export const creditSuccessResponseSchema = successResponseSchema.extend({
  data: creditTrackingResponseSchema
});

export const creditListResponseSchema = paginatedResponseSchema.extend({
  data: z.array(creditTrackingResponseSchema)
});

export const invoiceSuccessResponseSchema = successResponseSchema.extend({
  data: invoiceResponseSchema
});

export const invoiceListResponseSchema = paginatedResponseSchema.extend({
  data: z.array(invoiceResponseSchema)
});

export const contractLineSuccessResponseSchema = successResponseSchema.extend({
  data: contractLineResponseSchema
});

export const contractLineListResponseSchema = paginatedResponseSchema.extend({
  data: z.array(contractLineResponseSchema)
});

export const paymentMethodSuccessResponseSchema = successResponseSchema.extend({
  data: paymentMethodResponseSchema
});

export const paymentMethodListResponseSchema = paginatedResponseSchema.extend({
  data: z.array(paymentMethodResponseSchema)
});

export const taxRateSuccessResponseSchema = successResponseSchema.extend({
  data: taxRateResponseSchema
});

export const taxRateListResponseSchema = paginatedResponseSchema.extend({
  data: z.array(taxRateResponseSchema)
});

export const reconciliationSuccessResponseSchema = successResponseSchema.extend({
  data: creditReconciliationReportResponseSchema
});

export const reconciliationListResponseSchema = paginatedResponseSchema.extend({
  data: z.array(creditReconciliationReportResponseSchema)
});

export const accountBalanceSuccessResponseSchema = successResponseSchema.extend({
  data: accountBalanceReportSchema
});

export const agingReportSuccessResponseSchema = successResponseSchema.extend({
  data: agingReportSchema
});

export const bulkOperationSuccessResponseSchema = successResponseSchema.extend({
  data: bulkOperationResultSchema
});

// ============================================================================
// UTILITY SCHEMAS FOR COMPLEX OPERATIONS
// ============================================================================

export const validateCreditBalanceSchema = z.object({
  client_id: uuidSchema,
  expected_balance: z.number().optional()
});

export const creditValidationResultSchema = z.object({
  is_valid: z.boolean(),
  actual_balance: z.number(),
  expected_balance: z.number(),
  difference: z.number(),
  last_transaction: transactionResponseSchema.optional(),
  report_id: uuidSchema.optional()
});

export const calculateBillingSchema = z.object({
  client_id: uuidSchema,
  period_start: dateSchema,
  period_end: dateSchema,
  billing_cycle_id: uuidSchema.optional()
});

export const billingCalculationResultSchema = z.object({
  charges: z.array(billingChargeBaseSchema),
  total_amount: z.number(),
  tax_amount: z.number(),
  discounts: z.array(discountResponseSchema),
  adjustments: z.array(adjustmentResponseSchema),
  final_amount: z.number(),
  period_start: dateSchema,
  period_end: dateSchema
});

// ============================================================================
// EXPORT ALL SCHEMA TYPES
// ============================================================================

export type TransactionType = z.infer<typeof transactionTypeSchema>;
export type ChargeType = z.infer<typeof chargeTypeSchema>;
export type BillingCycleType = z.infer<typeof billingCycleTypeSchema>;
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export type TransactionStatus = z.infer<typeof transactionStatusSchema>;
export type DiscountType = z.infer<typeof discountTypeSchema>;
export type PaymentMethodType = z.infer<typeof paymentMethodTypeSchema>;
export type ReconciliationStatus = z.infer<typeof reconciliationStatusSchema>;
export type TaxType = z.infer<typeof taxTypeSchema>;
export type PlanType = z.infer<typeof planTypeSchema>;
export type BillingMethod = z.infer<typeof billingMethodSchema>;

export type CreateTransactionRequest = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionRequest = z.infer<typeof updateTransactionSchema>;
export type TransactionResponse = z.infer<typeof transactionResponseSchema>;
export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;

export type CreateCreditTrackingRequest = z.infer<typeof createCreditTrackingSchema>;
export type UpdateCreditTrackingRequest = z.infer<typeof updateCreditTrackingSchema>;
export type CreditTrackingResponse = z.infer<typeof creditTrackingResponseSchema>;
export type CreditListQuery = z.infer<typeof creditListQuerySchema>;

export type ApplyCreditToInvoiceRequest = z.infer<typeof applyCreditToInvoiceSchema>;
export type CreatePrepaymentInvoiceRequest = z.infer<typeof createPrepaymentInvoiceSchema>;
export type TransferCreditRequest = z.infer<typeof transferCreditSchema>;

export type CreateInvoiceRequest = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceRequest = z.infer<typeof updateInvoiceSchema>;
export type InvoiceResponse = z.infer<typeof invoiceResponseSchema>;
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export type CreatePaymentMethodRequest = z.infer<typeof createPaymentMethodSchema>;
export type UpdatePaymentMethodRequest = z.infer<typeof updatePaymentMethodSchema>;
export type PaymentMethodResponse = z.infer<typeof paymentMethodResponseSchema>;

export type CreateContractLineRequest = z.infer<typeof createContractLineSchema>;
export type UpdateContractLineRequest = z.infer<typeof updateContractLineSchema>;
export type ContractLineResponse = z.infer<typeof contractLineResponseSchema>;

export type CreateTaxRateRequest = z.infer<typeof createTaxRateSchema>;
export type UpdateTaxRateRequest = z.infer<typeof updateTaxRateSchema>;
export type TaxRateResponse = z.infer<typeof taxRateResponseSchema>;

export type CreateCreditReconciliationReportRequest = z.infer<typeof createCreditReconciliationReportSchema>;
export type CreditReconciliationReportResponse = z.infer<typeof creditReconciliationReportResponseSchema>;

export type AccountBalanceReport = z.infer<typeof accountBalanceReportSchema>;
export type AgingReport = z.infer<typeof agingReportSchema>;
export type FinancialAnalyticsQuery = z.infer<typeof financialAnalyticsQuerySchema>;

export type BulkInvoiceOperation = z.infer<typeof bulkInvoiceOperationSchema>;
export type BulkTransactionOperation = z.infer<typeof bulkTransactionOperationSchema>;
export type BulkCreditOperation = z.infer<typeof bulkCreditOperationSchema>;
export type BulkOperationResult = z.infer<typeof bulkOperationResultSchema>;

export type CreditValidationResult = z.infer<typeof creditValidationResultSchema>;
export type BillingCalculationResult = z.infer<typeof billingCalculationResultSchema>;
