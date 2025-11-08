/**
 * QuickBooks Online Integration API Schemas
 * Comprehensive Zod validation schemas for all QBO integration operations
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
  contactInfoSchema,
  booleanTransform,
  numberTransform,
  emailSchema,
  urlSchema
} from './common';

// ============================================================================
// Base QBO Schemas
// ============================================================================

// QBO Reference schema - core building block for QBO objects
const qboRefSchema = z.object({
  value: z.string().min(1),
  name: z.string().optional()
});

// QBO Address schema
const qboAddressSchema = z.object({
  Id: z.string().optional(),
  Line1: z.string().optional(),
  Line2: z.string().optional(),
  Line3: z.string().optional(),
  Line4: z.string().optional(),
  Line5: z.string().optional(),
  City: z.string().optional(),
  Country: z.string().optional(),
  CountrySubDivisionCode: z.string().optional(), // State/Province
  PostalCode: z.string().optional(),
  Lat: z.string().optional(),
  Long: z.string().optional()
});

// QBO Email Address schema
const qboEmailAddrSchema = z.object({
  Address: z.string().email()
});

// QBO Phone Number schema
const qboPhoneNumberSchema = z.object({
  FreeFormNumber: z.string().min(1)
});

// QBO Metadata schema
const qboMetaDataSchema = z.object({
  CreateTime: z.string().datetime(),
  LastUpdatedTime: z.string().datetime()
});

// QBO monetary amount schema (handles decimal precision)
const qboMonetaryAmountSchema = z.number().min(0);

// QBO date schema (YYYY-MM-DD format)
const qboDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ============================================================================
// Connection Management Schemas
// ============================================================================

// OAuth connection status schema
const qboConnectionSummaryStatusSchema = z.enum(['active', 'expired', 'error']);

const qboConnectionSummarySchema = z.object({
  realmId: z.string().min(1),
  displayName: z.string().min(1),
  status: qboConnectionSummaryStatusSchema,
  lastValidatedAt: z.string().datetime().nullable().optional(),
  error: z.string().nullable().optional()
});

const qboConnectionStatusSchema = z.object({
  connected: z.boolean(),
  connections: z.array(qboConnectionSummarySchema),
  defaultRealmId: z.string().nullable().optional(),
  error: z.string().optional()
});

// QBO Credentials schema
const qboCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  realmId: z.string().min(1),
  accessTokenExpiresAt: z.string().datetime(),
  refreshTokenExpiresAt: z.string().datetime()
});

// OAuth authorization request schema
const qboOAuthRequestSchema = z.object({
  state: z.string().min(1),
  redirect_uri: urlSchema.optional(),
  scope: z.string().optional().default('com.intuit.quickbooks.accounting')
});

// OAuth callback schema
const qboOAuthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  realmId: z.string().min(1),
  error: z.string().optional(),
  error_description: z.string().optional()
});

// Connection status response schema
const qboConnectionStatusResponseSchema = qboConnectionStatusSchema;

// Connection test schema
const qboConnectionTestSchema = z.object({
  testType: z.enum(['clientInfo', 'items', 'customers', 'full']).default('clientInfo'),
  forceRefresh: z.boolean().default(false)
});

// ============================================================================
// Customer Synchronization Schemas
// ============================================================================

// QBO Customer schema
const qboCustomerSchema = z.object({
  Id: z.string().optional(),
  SyncToken: z.string().optional(),
  DisplayName: z.string().optional(),
  GivenName: z.string().optional(),
  MiddleName: z.string().optional(),
  FamilyName: z.string().optional(),
  ClientName: z.string().optional(),
  PrimaryEmailAddr: qboEmailAddrSchema.optional(),
  BillAddr: qboAddressSchema.optional(),
  ShipAddr: qboAddressSchema.optional(),
  PrimaryPhone: qboPhoneNumberSchema.optional(),
  SalesTermRef: qboRefSchema.optional(),
  MetaData: qboMetaDataSchema.optional(),
  Active: z.boolean().optional().default(true)
});

// Customer sync request schema
const customerSyncRequestSchema = z.object({
  client_id: uuidSchema.optional(), // Sync specific client, or all if omitted
  sync_type: z.enum(['create', 'update', 'bidirectional']).default('bidirectional'),
  force_update: z.boolean().default(false),
  include_inactive: z.boolean().default(false)
});

// Customer sync response schema
const customerSyncResponseSchema = z.object({
  success: z.boolean(),
  synced_customers: z.number().min(0),
  created_customers: z.number().min(0),
  updated_customers: z.number().min(0),
  failed_customers: z.number().min(0),
  errors: z.array(z.object({
    client_id: uuidSchema.optional(),
    qbo_customer_id: z.string().optional(),
    error_message: z.string(),
    error_code: z.string().optional()
  })),
  sync_duration_ms: z.number().min(0),
  last_sync_date: z.string().datetime()
});

// Customer mapping schema
const customerMappingSchema = z.object({
  client_id: uuidSchema,
  qbo_customer_id: z.string(),
  display_name: z.string(),
  sync_status: z.enum(['synced', 'pending', 'error', 'conflict']),
  last_synced_at: z.string().datetime().optional(),
  sync_error: z.string().optional(),
  field_mappings: z.record(z.any()).optional()
});

// ============================================================================
// Invoice Export and Import Schemas
// ============================================================================

// QBO Tax Line Detail schema
const qboTaxLineDetailSchema = z.object({
  Amount: qboMonetaryAmountSchema.optional(),
  TaxLineDetailType: z.literal('TaxLineDetail').optional(),
  TaxRateRef: qboRefSchema.optional(),
  PercentBased: z.boolean().optional(),
  TaxPercent: z.number().min(0).max(100).optional(),
  NetAmountTaxable: qboMonetaryAmountSchema.optional()
});

// QBO Transaction Tax Detail schema
const qboTxnTaxDetailSchema = z.object({
  TxnTaxCodeRef: qboRefSchema.optional(),
  TotalTax: qboMonetaryAmountSchema.optional(),
  TaxLine: z.array(qboTaxLineDetailSchema).optional()
});

// QBO Sales Item Line Detail schema
const qboSalesItemLineDetailSchema = z.object({
  ItemRef: qboRefSchema,
  Qty: z.number().min(0).optional(),
  UnitPrice: qboMonetaryAmountSchema.optional(),
  TaxCodeRef: qboRefSchema.optional(),
  ServiceDate: qboDateSchema.optional(),
  TaxInclusiveAmt: z.boolean().optional(),
  ClassRef: qboRefSchema.optional()
});

// QBO Discount Line Detail schema
const qboDiscountLineDetailSchema = z.object({
  DiscountAccountRef: qboRefSchema.optional(),
  PercentBased: z.boolean().optional(),
  DiscountPercent: z.number().min(0).max(100).optional(),
  DiscountAmount: qboMonetaryAmountSchema.optional(),
  TaxCodeRef: qboRefSchema.optional(),
  ClassRef: qboRefSchema.optional()
});

// QBO Invoice Line schema
const qboInvoiceLineSchema = z.object({
  Id: z.string().optional(),
  LineNum: z.number().min(1).optional(),
  Description: z.string().optional(),
  Amount: qboMonetaryAmountSchema,
  DetailType: z.enum(['SalesItemLineDetail', 'DiscountLineDetail', 'DescriptionOnly', 'SubTotalLineDetail', 'GroupLineDetail']),
  SalesItemLineDetail: qboSalesItemLineDetailSchema.optional(),
  DiscountLineDetail: qboDiscountLineDetailSchema.optional()
});

// QBO Invoice schema
const qboInvoiceSchema = z.object({
  Id: z.string().optional(),
  SyncToken: z.string().optional(),
  DocNumber: z.string().optional(),
  TxnDate: qboDateSchema.optional(),
  CustomerRef: qboRefSchema,
  Line: z.array(qboInvoiceLineSchema).min(1),
  DueDate: qboDateSchema.optional(),
  TotalAmt: qboMonetaryAmountSchema.optional(),
  ApplyTaxAfterDiscount: z.boolean().optional(),
  TxnTaxDetail: qboTxnTaxDetailSchema.optional(),
  BillEmail: qboEmailAddrSchema.optional(),
  BillAddr: qboAddressSchema.optional(),
  ShipAddr: qboAddressSchema.optional(),
  SalesTermRef: qboRefSchema.optional(),
  PrivateNote: z.string().optional(),
  MetaData: qboMetaDataSchema.optional()
});

// Invoice export request schema
const invoiceExportRequestSchema = z.object({
  invoice_id: uuidSchema.optional(), // Export specific invoice, or all if omitted
  date_range: z.object({
    start_date: qboDateSchema,
    end_date: qboDateSchema
  }).optional(),
  status_filter: z.array(z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled'])).optional(),
  client_id: uuidSchema.optional(),
  export_format: z.enum(['qbo', 'json']).default('qbo'),
  include_line_items: z.boolean().default(true),
  auto_create_items: z.boolean().default(true),
  skip_existing: z.boolean().default(false)
});

// Invoice export response schema
const invoiceExportResponseSchema = z.object({
  success: z.boolean(),
  exported_invoices: z.number().min(0),
  created_invoices: z.number().min(0),
  updated_invoices: z.number().min(0),
  failed_invoices: z.number().min(0),
  errors: z.array(z.object({
    invoice_id: uuidSchema.optional(),
    qbo_invoice_id: z.string().optional(),
    error_message: z.string(),
    error_code: z.string().optional()
  })),
  export_duration_ms: z.number().min(0),
  last_export_date: z.string().datetime()
});

// Invoice import request schema
const invoiceImportRequestSchema = z.object({
  qbo_invoice_id: z.string().optional(), // Import specific invoice, or all recent if omitted
  date_range: z.object({
    start_date: qboDateSchema,
    end_date: qboDateSchema
  }).optional(),
  import_payments: z.boolean().default(true),
  auto_create_clients: z.boolean().default(false),
  update_existing: z.boolean().default(true)
});

// ============================================================================
// Chart of Accounts Mapping Schemas
// ============================================================================

// QBO Account schema
const qboAccountSchema = z.object({
  Id: z.string(),
  SyncToken: z.string().optional(),
  Name: z.string(),
  Description: z.string().optional(),
  FullyQualifiedName: z.string().optional(),
  AccountType: z.enum([
    'Income', 'Expense', 'Cost of Goods Sold', 'Other Income', 'Other Expense',
    'Bank', 'Accounts Receivable', 'Other Current Asset', 'Fixed Asset', 'Other Asset',
    'Accounts Payable', 'Credit Card', 'Other Current Liability', 'Long Term Liability', 'Equity'
  ]),
  AccountSubType: z.string().optional(),
  CurrentBalance: qboMonetaryAmountSchema.optional(),
  Active: z.boolean().optional().default(true),
  ParentRef: qboRefSchema.optional(),
  MetaData: qboMetaDataSchema.optional()
});

// Account mapping configuration schema
const accountMappingConfigSchema = z.object({
  mapping_id: uuidSchema,
  account_type: z.enum(['income', 'expense', 'asset', 'liability', 'equity']),
  alga_account_name: z.string(),
  qbo_account_id: z.string(),
  qbo_account_name: z.string(),
  qbo_account_type: z.string(),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true)
}).merge(baseEntitySchema);

// Account mapping request schema
const accountMappingRequestSchema = z.object({
  mappings: z.array(z.object({
    account_type: z.enum(['income', 'expense', 'asset', 'liability', 'equity']),
    alga_account_name: z.string(),
    qbo_account_id: z.string(),
    is_default: z.boolean().default(false)
  })).min(1),
  replace_existing: z.boolean().default(false)
});

// ============================================================================
// Payment Synchronization Schemas
// ============================================================================

// QBO Payment schema
const qboPaymentSchema = z.object({
  Id: z.string().optional(),
  SyncToken: z.string().optional(),
  CustomerRef: qboRefSchema,
  TotalAmt: qboMonetaryAmountSchema,
  TxnDate: qboDateSchema,
  PaymentRefNum: z.string().optional(),
  PaymentMethodRef: qboRefSchema.optional(),
  DepositToAccountRef: qboRefSchema.optional(),
  Line: z.array(z.object({
    Amount: qboMonetaryAmountSchema,
    LinkedTxn: z.array(z.object({
      TxnId: z.string(),
      TxnType: z.literal('Invoice')
    }))
  })),
  PrivateNote: z.string().optional(),
  MetaData: qboMetaDataSchema.optional()
});

// Payment sync request schema
const paymentSyncRequestSchema = z.object({
  payment_id: uuidSchema.optional(), // Sync specific payment, or all if omitted
  invoice_id: uuidSchema.optional(), // Sync payments for specific invoice
  date_range: z.object({
    start_date: qboDateSchema,
    end_date: qboDateSchema
  }).optional(),
  sync_type: z.enum(['create', 'update', 'bidirectional']).default('bidirectional'),
  include_unapplied: z.boolean().default(false)
});

// Payment sync response schema
const paymentSyncResponseSchema = z.object({
  success: z.boolean(),
  synced_payments: z.number().min(0),
  created_payments: z.number().min(0),
  updated_payments: z.number().min(0),
  failed_payments: z.number().min(0),
  errors: z.array(z.object({
    payment_id: uuidSchema.optional(),
    qbo_payment_id: z.string().optional(),
    error_message: z.string(),
    error_code: z.string().optional()
  })),
  sync_duration_ms: z.number().min(0)
});

// ============================================================================
// Tax Mapping and Configuration Schemas
// ============================================================================

// QBO Tax Code schema
const qboTaxCodeSchema = z.object({
  Id: z.string(),
  SyncToken: z.string().optional(),
  Name: z.string(),
  Description: z.string().optional(),
  Taxable: z.boolean(),
  TaxGroup: z.boolean(),
  SalesTaxRateList: z.object({
    TaxRateDetail: z.array(z.object({
      TaxRateRef: qboRefSchema,
      TaxTypeApplicable: z.string().optional(),
      TaxOrder: z.number().optional()
    }))
  }).optional(),
  PurchaseTaxRateList: z.object({
    TaxRateDetail: z.array(z.object({
      TaxRateRef: qboRefSchema,
      TaxTypeApplicable: z.string().optional(),
      TaxOrder: z.number().optional()
    }))
  }).optional(),
  Active: z.boolean().optional().default(true),
  MetaData: qboMetaDataSchema.optional()
});

// QBO Tax Rate schema
const qboTaxRateSchema = z.object({
  Id: z.string(),
  SyncToken: z.string().optional(),
  Name: z.string(),
  Description: z.string().optional(),
  RateValue: z.number().min(0).max(100),
  AgencyRef: qboRefSchema.optional(),
  TaxReturnLineRef: qboRefSchema.optional(),
  Active: z.boolean().optional().default(true),
  MetaData: qboMetaDataSchema.optional()
});

// Tax mapping configuration schema
const taxMappingConfigSchema = z.object({
  mapping_id: uuidSchema,
  alga_tax_region: z.string(),
  qbo_tax_code_id: z.string(),
  qbo_tax_code_name: z.string(),
  tax_rate: z.number().min(0).max(100),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
  description: z.string().optional()
}).merge(baseEntitySchema);

// Tax mapping request schema
const taxMappingRequestSchema = z.object({
  mappings: z.array(z.object({
    alga_tax_region: z.string(),
    qbo_tax_code_id: z.string(),
    is_default: z.boolean().default(false)
  })).min(1),
  replace_existing: z.boolean().default(false)
});

// ============================================================================
// Sync Status Tracking and Error Handling Schemas
// ============================================================================

// Sync status enum
const syncStatusSchema = z.enum([
  'pending',
  'in_progress', 
  'completed',
  'failed',
  'cancelled',
  'partial'
]);

// Sync operation type enum
const syncOperationTypeSchema = z.enum([
  'customer_sync',
  'invoice_export',
  'invoice_import',
  'payment_sync',
  'item_sync',
  'tax_sync',
  'full_sync',
  'test_connection'
]);

// Sync status record schema
const syncStatusRecordSchema = z.object({
  sync_id: uuidSchema,
  operation_type: syncOperationTypeSchema,
  status: syncStatusSchema,
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  duration_ms: z.number().min(0).optional(),
  records_processed: z.number().min(0).default(0),
  records_successful: z.number().min(0).default(0),
  records_failed: z.number().min(0).default(0),
  error_message: z.string().optional(),
  error_details: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional()
}).merge(baseEntitySchema);

// Sync status query schema
const syncStatusQuerySchema = z.object({
  operation_type: syncOperationTypeSchema.optional(),
  status: syncStatusSchema.optional(),
  date_range: z.object({
    start_date: z.string().datetime(),
    end_date: z.string().datetime()
  }).optional(),
  limit: z.number().min(1).max(100).default(25)
});

// Error handling configuration schema
const errorHandlingConfigSchema = z.object({
  config_id: uuidSchema,
  operation_type: syncOperationTypeSchema,
  retry_attempts: z.number().min(0).max(10).default(3),
  retry_delay_ms: z.number().min(1000).default(5000),
  backoff_multiplier: z.number().min(1).default(2),
  max_retry_delay_ms: z.number().min(1000).default(300000),
  fail_on_first_error: z.boolean().default(false),
  notification_on_failure: z.boolean().default(true),
  auto_disable_on_failure: z.boolean().default(false)
}).merge(baseEntitySchema);

// ============================================================================
// Data Mapping Configuration Schemas
// ============================================================================

// Field mapping schema
const fieldMappingSchema = z.object({
  alga_field: z.string(),
  qbo_field: z.string(),
  transform_function: z.string().optional(),
  is_required: z.boolean().default(false),
  default_value: z.any().optional(),
  validation_rule: z.string().optional()
});

// Entity mapping configuration schema
const entityMappingConfigSchema = z.object({
  mapping_id: uuidSchema,
  entity_type: z.enum(['customer', 'invoice', 'payment', 'item', 'tax_code']),
  mapping_name: z.string(),
  field_mappings: z.array(fieldMappingSchema),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
  description: z.string().optional()
}).merge(baseEntitySchema);

// Mapping configuration request schema
const mappingConfigRequestSchema = z.object({
  entity_type: z.enum(['customer', 'invoice', 'payment', 'item', 'tax_code']),
  mapping_name: z.string(),
  field_mappings: z.array(fieldMappingSchema).min(1),
  is_default: z.boolean().default(false),
  description: z.string().optional()
});

// ============================================================================
// Bulk Synchronization Schemas
// ============================================================================

// Bulk sync request schema
const bulkSyncRequestSchema = z.object({
  operations: z.array(z.object({
    operation_type: syncOperationTypeSchema,
    entity_ids: z.array(uuidSchema).optional(),
    qbo_entity_ids: z.array(z.string()).optional(),
    date_range: z.object({
      start_date: qboDateSchema,
      end_date: qboDateSchema
    }).optional(),
    parameters: z.record(z.any()).optional()
  })).min(1).max(10),
  execution_mode: z.enum(['sequential', 'parallel']).default('sequential'),
  stop_on_error: z.boolean().default(false),
  notification_email: emailSchema.optional()
});

// Bulk sync response schema
const bulkSyncResponseSchema = z.object({
  bulk_sync_id: uuidSchema,
  status: syncStatusSchema,
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  total_operations: z.number().min(1),
  completed_operations: z.number().min(0),
  failed_operations: z.number().min(0),
  operation_results: z.array(z.object({
    operation_type: syncOperationTypeSchema,
    status: syncStatusSchema,
    records_processed: z.number().min(0),
    records_successful: z.number().min(0),
    records_failed: z.number().min(0),
    error_message: z.string().optional(),
    duration_ms: z.number().min(0).optional()
  })),
  total_duration_ms: z.number().min(0).optional()
});

// ============================================================================
// Integration Health Monitoring Schemas
// ============================================================================

// Health check type enum
const healthCheckTypeSchema = z.enum([
  'connection',
  'authentication',
  'api_limits',
  'sync_status',
  'data_integrity',
  'performance',
  'full'
]);

// Health status enum
const healthStatusSchema = z.enum([
  'healthy',
  'warning',
  'critical',
  'unknown'
]);

// Health check result schema
const healthCheckResultSchema = z.object({
  check_type: healthCheckTypeSchema,
  status: healthStatusSchema,
  message: z.string(),
  details: z.record(z.any()).optional(),
  checked_at: z.string().datetime(),
  response_time_ms: z.number().min(0).optional()
});

// Integration health response schema
const integrationHealthResponseSchema = z.object({
  overall_status: healthStatusSchema,
  last_health_check: z.string().datetime(),
  connection_status: qboConnectionStatusSchema,
  api_limits: z.object({
    daily_limit: z.number().min(0),
    daily_used: z.number().min(0),
    remaining: z.number().min(0),
    reset_time: z.string().datetime().optional()
  }).optional(),
  sync_statistics: z.object({
    last_sync_date: z.string().datetime().optional(),
    successful_syncs_24h: z.number().min(0),
    failed_syncs_24h: z.number().min(0),
    avg_sync_duration_ms: z.number().min(0).optional()
  }),
  health_checks: z.array(healthCheckResultSchema),
  recommendations: z.array(z.object({
    type: z.enum(['warning', 'action_required', 'optimization']),
    message: z.string(),
    details: z.string().optional()
  })).optional()
});

// Health monitoring configuration schema
const healthMonitoringConfigSchema = z.object({
  config_id: uuidSchema,
  check_interval_minutes: z.number().min(1).max(1440).default(15),
  enabled_checks: z.array(healthCheckTypeSchema),
  alert_thresholds: z.object({
    sync_failure_rate: z.number().min(0).max(1).default(0.1),
    api_limit_threshold: z.number().min(0).max(1).default(0.8),
    response_time_threshold_ms: z.number().min(100).default(5000)
  }),
  notification_settings: z.object({
    email_alerts: z.boolean().default(true),
    email_recipients: z.array(emailSchema).optional(),
    slack_webhook: urlSchema.optional(),
    alert_frequency: z.enum(['immediate', 'hourly', 'daily']).default('immediate')
  }),
  is_active: z.boolean().default(true)
}).merge(baseEntitySchema);

// ============================================================================
// Lookup and Reference Data Schemas
// ============================================================================

// QBO Item schema
const qboItemSchema = z.object({
  Id: z.string(),
  SyncToken: z.string().optional(),
  Name: z.string(),
  Description: z.string().optional(),
  Type: z.enum(['Service', 'Inventory', 'NonInventory', 'Category']),
  IncomeAccountRef: qboRefSchema.optional(),
  ExpenseAccountRef: qboRefSchema.optional(),
  AssetAccountRef: qboRefSchema.optional(),
  UnitPrice: qboMonetaryAmountSchema.optional(),
  Taxable: z.boolean().optional(),
  Active: z.boolean().optional().default(true),
  MetaData: qboMetaDataSchema.optional()
});

// QBO Term schema
const qboTermSchema = z.object({
  Id: z.string(),
  SyncToken: z.string().optional(),
  Name: z.string(),
  Active: z.boolean().optional().default(true),
  Type: z.enum(['STANDARD', 'DATE_DRIVEN']).optional(),
  DueDays: z.number().min(0).optional(),
  DiscountDays: z.number().min(0).optional(),
  DiscountPercent: z.number().min(0).max(100).optional(),
  MetaData: qboMetaDataSchema.optional()
});

// QBO Payment Method schema
const qboPaymentMethodSchema = z.object({
  Id: z.string(),
  SyncToken: z.string().optional(),
  Name: z.string(),
  Type: z.enum(['CREDIT_CARD', 'CHECK', 'CASH', 'OTHER']).optional(),
  Active: z.boolean().optional().default(true),
  MetaData: qboMetaDataSchema.optional()
});

// ============================================================================
// Filter and Query Schemas
// ============================================================================

// QBO entity filter schema
const qboEntityFilterSchema = z.object({
  entity_type: z.enum(['customer', 'invoice', 'payment', 'item', 'account', 'tax_code', 'term']),
  active_only: z.boolean().default(true),
  modified_since: z.string().datetime().optional(),
  name_contains: z.string().optional(),
  max_results: z.number().min(1).max(1000).default(100)
});

// Sync history filter schema
const syncHistoryFilterSchema = baseFilterSchema.extend({
  operation_type: syncOperationTypeSchema.optional(),
  status: syncStatusSchema.optional(),
  date_range: z.object({
    start_date: z.string().datetime(),
    end_date: z.string().datetime()
  }).optional()
});

// ============================================================================
// Response Schemas
// ============================================================================

// QBO entity list response schema
const qboEntityListResponseSchema = successResponseSchema.extend({
  data: z.array(z.any()),
  metadata: z.object({
    entity_type: z.string(),
    total_count: z.number().min(0),
    last_updated: z.string().datetime().optional()
  })
});

// Sync status list response schema
const syncStatusListResponseSchema = paginatedResponseSchema.extend({
  data: z.array(syncStatusRecordSchema)
});

// Mapping configuration list response schema
const mappingConfigListResponseSchema = paginatedResponseSchema.extend({
  data: z.array(entityMappingConfigSchema)
});

// ============================================================================
// Route Parameter Schemas
// ============================================================================

// QBO entity ID parameter schema
const qboEntityIdParamSchema = z.object({
  entity_id: z.string().min(1)
});

// Sync ID parameter schema
const syncIdParamSchema = z.object({
  sync_id: uuidSchema
});

// Mapping ID parameter schema
const mappingIdParamSchema = z.object({
  mapping_id: uuidSchema
});

// ============================================================================
// Validation Helpers
// ============================================================================

// Validate QBO entity ID format
export function validateQboEntityId(value: string): boolean {
  return /^\d+$/.test(value);
}

// Validate QBO realm ID format
export function validateQboRealmId(value: string): boolean {
  return /^\d+$/.test(value);
}

// Validate QBO date format
export function validateQboDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Validate monetary amount precision
export function validateMonetaryAmount(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && Number((value * 100).toFixed(0)) / 100 === value;
}

// ============================================================================
// Export Schema Types
// ============================================================================

// Connection and OAuth types
export type QboConnectionStatus = z.infer<typeof qboConnectionStatusSchema>;
export type QboCredentials = z.infer<typeof qboCredentialsSchema>;
export type QboOAuthRequest = z.infer<typeof qboOAuthRequestSchema>;
export type QboOAuthCallback = z.infer<typeof qboOAuthCallbackSchema>;
export type QboConnectionStatusResponse = z.infer<typeof qboConnectionStatusResponseSchema>;
export type QboConnectionTest = z.infer<typeof qboConnectionTestSchema>;

// Customer sync types
export type QboCustomer = z.infer<typeof qboCustomerSchema>;
export type CustomerSyncRequest = z.infer<typeof customerSyncRequestSchema>;
export type CustomerSyncResponse = z.infer<typeof customerSyncResponseSchema>;
export type CustomerMapping = z.infer<typeof customerMappingSchema>;

// Invoice sync types
export type QboInvoice = z.infer<typeof qboInvoiceSchema>;
export type InvoiceExportRequest = z.infer<typeof invoiceExportRequestSchema>;
export type InvoiceExportResponse = z.infer<typeof invoiceExportResponseSchema>;
export type InvoiceImportRequest = z.infer<typeof invoiceImportRequestSchema>;

// Payment sync types
export type QboPayment = z.infer<typeof qboPaymentSchema>;
export type PaymentSyncRequest = z.infer<typeof paymentSyncRequestSchema>;
export type PaymentSyncResponse = z.infer<typeof paymentSyncResponseSchema>;

// Tax and account mapping types
export type QboTaxCode = z.infer<typeof qboTaxCodeSchema>;
export type QboAccount = z.infer<typeof qboAccountSchema>;
export type AccountMappingConfig = z.infer<typeof accountMappingConfigSchema>;
export type TaxMappingConfig = z.infer<typeof taxMappingConfigSchema>;
export type AccountMappingRequest = z.infer<typeof accountMappingRequestSchema>;
export type TaxMappingRequest = z.infer<typeof taxMappingRequestSchema>;

// Sync status and monitoring types
export type SyncStatus = z.infer<typeof syncStatusSchema>;
export type SyncOperationType = z.infer<typeof syncOperationTypeSchema>;
export type SyncStatusRecord = z.infer<typeof syncStatusRecordSchema>;
export type SyncStatusQuery = z.infer<typeof syncStatusQuerySchema>;
export type ErrorHandlingConfig = z.infer<typeof errorHandlingConfigSchema>;

// Data mapping types
export type FieldMapping = z.infer<typeof fieldMappingSchema>;
export type EntityMappingConfig = z.infer<typeof entityMappingConfigSchema>;
export type MappingConfigRequest = z.infer<typeof mappingConfigRequestSchema>;

// Bulk operations types
export type BulkSyncRequest = z.infer<typeof bulkSyncRequestSchema>;
export type BulkSyncResponse = z.infer<typeof bulkSyncResponseSchema>;

// Health monitoring types
export type HealthCheckType = z.infer<typeof healthCheckTypeSchema>;
export type HealthStatus = z.infer<typeof healthStatusSchema>;
export type HealthCheckResult = z.infer<typeof healthCheckResultSchema>;
export type IntegrationHealthResponse = z.infer<typeof integrationHealthResponseSchema>;
export type HealthMonitoringConfig = z.infer<typeof healthMonitoringConfigSchema>;

// Lookup data types
export type QboItem = z.infer<typeof qboItemSchema>;
export type QboTerm = z.infer<typeof qboTermSchema>;
export type QboPaymentMethod = z.infer<typeof qboPaymentMethodSchema>;

// ============================================================================
// Export All Schemas
// ============================================================================

export {
  // Base QBO schemas
  qboRefSchema,
  qboAddressSchema,
  qboEmailAddrSchema,
  qboPhoneNumberSchema,
  qboMetaDataSchema,
  qboMonetaryAmountSchema,
  qboDateSchema,
  
  // Connection management schemas
  qboConnectionStatusSchema,
  qboCredentialsSchema,
  qboOAuthRequestSchema,
  qboOAuthCallbackSchema,
  qboConnectionStatusResponseSchema,
  qboConnectionTestSchema,
  
  // Customer synchronization schemas
  qboCustomerSchema,
  customerSyncRequestSchema,
  customerSyncResponseSchema,
  customerMappingSchema,
  
  // Invoice schemas
  qboTaxLineDetailSchema,
  qboTxnTaxDetailSchema,
  qboSalesItemLineDetailSchema,
  qboDiscountLineDetailSchema,
  qboInvoiceLineSchema,
  qboInvoiceSchema,
  invoiceExportRequestSchema,
  invoiceExportResponseSchema,
  invoiceImportRequestSchema,
  
  // Account and tax schemas
  qboAccountSchema,
  accountMappingConfigSchema,
  accountMappingRequestSchema,
  qboTaxCodeSchema,
  qboTaxRateSchema,
  taxMappingConfigSchema,
  taxMappingRequestSchema,
  
  // Payment schemas
  qboPaymentSchema,
  paymentSyncRequestSchema,
  paymentSyncResponseSchema,
  
  // Sync status schemas
  syncStatusSchema,
  syncOperationTypeSchema,
  syncStatusRecordSchema,
  syncStatusQuerySchema,
  errorHandlingConfigSchema,
  
  // Data mapping schemas
  fieldMappingSchema,
  entityMappingConfigSchema,
  mappingConfigRequestSchema,
  
  // Bulk operation schemas
  bulkSyncRequestSchema,
  bulkSyncResponseSchema,
  
  // Health monitoring schemas
  healthCheckTypeSchema,
  healthStatusSchema,
  healthCheckResultSchema,
  integrationHealthResponseSchema,
  healthMonitoringConfigSchema,
  
  // Lookup schemas
  qboItemSchema,
  qboTermSchema,
  qboPaymentMethodSchema,
  
  // Filter and query schemas
  qboEntityFilterSchema,
  syncHistoryFilterSchema,
  
  // Response schemas
  qboEntityListResponseSchema,
  syncStatusListResponseSchema,
  mappingConfigListResponseSchema,
  
  // Parameter schemas
  qboEntityIdParamSchema,
  syncIdParamSchema,
  mappingIdParamSchema
};
