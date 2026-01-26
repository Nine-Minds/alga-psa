/**
 * @alga-psa/integrations
 *
 * External integrations module for Alga PSA.
 * Provides connections to third-party services including
 * email providers, cloud storage, and external APIs.
 *
 * Main entry point exports buildable lib/models/services code only.
 * For runtime code, use:
 * - '@alga-psa/integrations/actions' for server actions
 * - '@alga-psa/integrations/components' for React components
 */

// Lib utilities (buildable)
export * from './lib/externalMappingWorkflowEvents';

// QBO client service (buildable)
export { QboClientService, getQboClient } from './lib/qbo/qboClientService';
export type {
  QboRef,
  QboAddress,
  QboEmailAddr,
  QboPhoneNumber,
  QboMetaData,
  QboCustomer,
  QboTxnTaxDetail,
  QboTaxLine,
  QboSalesItemLineDetail,
  QboDiscountLineDetail,
  QboInvoiceLine,
  QboInvoice,
  QboItem,
  QboTaxCode,
  QboTaxRateDetail,
  QboTerm,
  QboInnerQueryResponse,
  QboQueryResponse,
  QboEntityResponse,
  QboErrorDetail,
  QboFault,
  QboApiErrorResponse,
  QboTenantCredentials,
} from './lib/qbo/types';

// Xero client service (buildable)
export {
  XeroClientService,
  getXeroConnectionSummaries,
  getStoredXeroConnections,
  upsertStoredXeroConnections,
  getXeroClientId,
  getXeroClientSecret,
  XERO_TOKEN_URL,
  XERO_CREDENTIALS_SECRET_NAME,
  XERO_CLIENT_ID_SECRET_NAME,
  XERO_CLIENT_SECRET_SECRET_NAME,
} from './lib/xero/xeroClientService';
export type {
  XeroTrackingCategoryOption,
  XeroTaxComponentPayload,
  XeroInvoiceLinePayload,
  XeroInvoicePayload,
  XeroInvoiceCreateSuccess,
  XeroInvoiceCreateFailure,
  XeroAccount,
  XeroItem,
  XeroTaxRate,
  XeroTrackingOption,
  XeroTrackingCategory,
  XeroConnectionSummary,
  XeroConnectionsStore,
  XeroLineItemTaxComponent,
  XeroLineItemDetails,
  XeroInvoiceDetails,
  XeroStoredConnection,
  ExternalCompanyRecord,
  NormalizedCompanyPayload,
} from './lib/xero/xeroClientService';

// Email domains (buildable)
export * from './email';

// Component types (buildable - no 'use client')
export type {
  EmailProvider,
  MicrosoftEmailProviderConfig,
  GoogleEmailProviderConfig,
  ImapEmailProviderConfig,
} from './components/email/types';
export {
  INBOUND_DEFAULTS_WARNING,
  providerNeedsInboundDefaults,
} from './components/email/emailProviderDefaults';
export {
  baseGmailProviderSchema,
} from './components/email/providers/gmail/schemas';
export type {
  BaseGmailProviderFormData,
  CEGmailProviderFormData,
} from './components/email/providers/gmail/schemas';
export type {
  AccountingMappingContext,
  AccountingMappingModule,
  AccountingMappingLoadResult,
} from './components/accounting-mappings/types';
