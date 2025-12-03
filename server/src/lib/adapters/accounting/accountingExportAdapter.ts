import { AccountingExportBatch, AccountingExportLine } from '../../../interfaces/accountingExport.interfaces';
import { TaxSource } from '../../../interfaces/tax.interfaces';

export interface AccountingExportAdapterCapabilities {
  deliveryMode: 'api' | 'file';
  supportsPartialRetry: boolean;
  supportsInvoiceUpdates: boolean;
  /** Whether this adapter supports external tax calculation (tax delegation) */
  supportsTaxDelegation?: boolean;
  /** Whether this adapter can fetch invoice data including tax amounts from external system */
  supportsInvoiceFetch?: boolean;
  /** Whether this adapter supports importing individual tax components */
  supportsTaxComponentImport?: boolean;
}

/** Tax delegation mode for the export */
export type TaxDelegationMode = 'none' | 'delegate' | 'import_pending';

export interface AccountingExportAdapterContext {
  batch: AccountingExportBatch;
  lines: AccountingExportLine[];
  /** Tax delegation mode for this export batch */
  taxDelegationMode?: TaxDelegationMode;
  /** If true, tax amounts should be omitted from exported invoices */
  excludeTaxFromExport?: boolean;
}

export interface AccountingExportDocument {
  documentId: string;
  lineIds: string[];
  payload: Record<string, unknown>;
}

export interface AccountingExportFileAttachment {
  filename: string;
  contentType: string;
  content: string;
}

export interface AccountingExportTransformResult {
  documents: AccountingExportDocument[];
  files?: AccountingExportFileAttachment[];
  metadata?: Record<string, unknown>;
}

export interface AccountingExportDeliveryLineResult {
  lineId: string;
  externalDocumentRef?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AccountingExportDeliveryResult {
  deliveredLines: AccountingExportDeliveryLineResult[];
  artifacts?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** External invoice charge with tax data from accounting system */
export interface ExternalInvoiceChargeTax {
  lineId: string;
  externalLineId?: string;
  taxAmount: number;
  taxCode?: string;
  taxRate?: number;
  taxComponents?: ExternalTaxComponent[];
}

/** Tax component from external system */
export interface ExternalTaxComponent {
  name: string;
  rate: number;
  amount: number;
}

/** External invoice data fetched from accounting system */
export interface ExternalInvoiceData {
  externalInvoiceId: string;
  externalInvoiceRef?: string;
  status?: string;
  totalTax: number;
  totalAmount: number;
  currency?: string;
  charges: ExternalInvoiceChargeTax[];
  metadata?: Record<string, unknown>;
}

/** Result from fetching external invoice data */
export interface ExternalInvoiceFetchResult {
  success: boolean;
  invoice?: ExternalInvoiceData;
  error?: string;
}

/** Pending tax import record for post-export callback */
export interface PendingTaxImportRecord {
  invoiceId: string;
  externalInvoiceRef: string;
  adapterType: string;
  targetRealm?: string;
  exportedAt: string;
}

export interface AccountingExportAdapter {
  readonly type: string;
  capabilities(): AccountingExportAdapterCapabilities;
  transform(context: AccountingExportAdapterContext): Promise<AccountingExportTransformResult>;
  deliver(transformResult: AccountingExportTransformResult, context: AccountingExportAdapterContext): Promise<AccountingExportDeliveryResult>;
  postProcess?(deliveryResult: AccountingExportDeliveryResult, context: AccountingExportAdapterContext): Promise<void>;

  /**
   * Fetch invoice data including tax amounts from external accounting system.
   * Only available when capabilities().supportsInvoiceFetch is true.
   */
  fetchExternalInvoice?(
    externalInvoiceRef: string,
    targetRealm?: string
  ): Promise<ExternalInvoiceFetchResult>;

  /**
   * Called after export when tax delegation is enabled.
   * Records pending tax imports for invoices exported without tax.
   */
  onTaxDelegationExport?(
    deliveryResult: AccountingExportDeliveryResult,
    context: AccountingExportAdapterContext
  ): Promise<PendingTaxImportRecord[]>;
}
