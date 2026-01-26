/**
 * @alga-psa/billing
 *
 * Billing module for Alga PSA.
 * Provides invoice management, payment processing, contract billing, and tax calculation.
 *
 * BUILDABLE EXPORTS ONLY (no 'use server' or 'use client' directives)
 *
 * For runtime code, use direct imports:
 * - Actions: import { ... } from '@alga-psa/billing/actions'
 * - Actions (specific): import { ... } from '@alga-psa/billing/actions/invoiceActions'
 * - Components: import { ... } from '@alga-psa/billing/components'
 * - Components (specific): import { BillingDashboard } from '@alga-psa/billing/components/billing-dashboard/BillingDashboard'
 */

// Models
export { default as Invoice } from './models/invoice';
export { default as Contract } from './models/contract';
export { default as ClientTaxSettings } from './models/clientTaxSettings';

// Re-export invoice types from @alga-psa/types
export type {
  IInvoice,
  IInvoiceCharge,
  IInvoiceItem,
  IInvoiceTemplate,
  IInvoiceAnnotation,
  ICustomField,
  IConditionalRule,
  InvoiceStatus,
  InvoiceViewModel,
  TaxSource,
  TaxImportState,
  DiscountType,
  InvoiceTemplateSource,
  ICreditAllocation,
} from '@alga-psa/types';

// Re-export contract types from @alga-psa/types
export type {
  IContract,
  IContractWithClient,
  IClientContract,
  IContractLine,
  IContractLineMapping,
  IContractAssignmentSummary,
  IContractPricingSchedule,
  ContractStatus,
} from '@alga-psa/types';

// Re-export invoice constants
export {
  INVOICE_STATUS_METADATA,
  INVOICE_STATUS_DISPLAY_ORDER,
  DEFAULT_ACCOUNTING_EXPORT_STATUSES,
  getTaxImportState,
} from '@alga-psa/types';

// Constants
export {
  CONTRACT_LINE_TYPE_DISPLAY,
  CONTRACT_LINE_TYPE_OPTIONS,
  PLAN_TYPE_DISPLAY,
  PLAN_TYPE_OPTIONS,
  BILLING_FREQUENCY_DISPLAY,
  BILLING_FREQUENCY_OPTIONS,
} from './constants/billing';

// Services
export { TaxService } from './services/taxService';
export { AccountingMappingResolver } from './services/accountingMappingResolver';
export type { MappingResolution } from './services/accountingMappingResolver';

// Company sync services
export {
  CompanyAccountingSyncService,
  KnexCompanyMappingRepository,
  buildNormalizedCompanyPayload,
  QuickBooksOnlineCompanyAdapter,
  XeroCompanyAdapter
} from './services/companySync';
export type {
  CompanyMappingRepository,
  AccountingCompanyAdapter,
  NormalizedCompanyPayload,
  ExternalCompanyRecord
} from './services/companySync';

// Repositories
export { KnexInvoiceMappingRepository } from './repositories/invoiceMappingRepository';

// Validation
export { AccountingExportValidation } from './lib/validation/accountingExportValidation';
