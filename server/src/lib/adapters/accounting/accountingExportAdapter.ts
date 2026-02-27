// Re-export adapter types from @alga-psa/types (canonical location)
// This shim exists for backwards compatibility during migration.
export type {
  AccountingExportAdapter,
  AccountingExportAdapterCapabilities,
  AccountingExportAdapterContext,
  AccountingExportDocument,
  AccountingExportFileAttachment,
  AccountingExportTransformResult,
  AccountingExportDeliveryLineResult,
  AccountingExportDeliveryResult,
  ExternalInvoiceChargeTax,
  ExternalTaxComponent,
  ExternalInvoiceData,
  ExternalInvoiceFetchResult,
  PendingTaxImportRecord,
  TaxDelegationMode,
} from '@alga-psa/types';
