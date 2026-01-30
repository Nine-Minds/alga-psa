/**
 * @alga-psa/billing
 *
 * Billing module for Alga PSA.
 * Provides invoice management, payment processing, contract billing, and tax calculation.
 */

// Models
export { Invoice, Contract } from './models';

// Components
export { BillingDashboard, CreditsPage, TemplateRenderer, PurchaseOrderSummaryBanner, AutomaticInvoices, BillingCycles } from './components';

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

// Legacy accounting integration helpers (used by server adapters/workflows)
export { AccountingMappingResolver } from './services/accountingMappingResolver';
export type { MappingResolution } from './services/accountingMappingResolver';
export { KnexInvoiceMappingRepository } from './repositories/invoiceMappingRepository';
export {
  CompanyAccountingSyncService,
  KnexCompanyMappingRepository,
  buildNormalizedCompanyPayload,
  QuickBooksOnlineCompanyAdapter,
  XeroCompanyAdapter,
} from './services/companySync';
export type {
  AccountingAdapterType,
  ExternalCompanyRecord,
  NormalizedCompanyPayload,
} from './services/companySync';

// Note: This module contains:
// - Invoice CRUD operations (migrated)
// - Contract management (migrated)
// - Payment processing (pending migration)
// - Tax calculation service (pending migration)
// - Credit management (pending migration)
// - 120+ billing dashboard components (pending migration)
