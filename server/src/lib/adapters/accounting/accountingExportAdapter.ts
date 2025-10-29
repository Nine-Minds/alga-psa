import { AccountingExportBatch, AccountingExportLine } from '../../../interfaces/accountingExport.interfaces';

export interface AccountingExportAdapterCapabilities {
  deliveryMode: 'api' | 'file';
  supportsPartialRetry: boolean;
  supportsInvoiceUpdates: boolean;
}

export interface AccountingExportAdapterContext {
  batch: AccountingExportBatch;
  lines: AccountingExportLine[];
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

export interface AccountingExportAdapter {
  readonly type: string;
  capabilities(): AccountingExportAdapterCapabilities;
  transform(context: AccountingExportAdapterContext): Promise<AccountingExportTransformResult>;
  deliver(transformResult: AccountingExportTransformResult, context: AccountingExportAdapterContext): Promise<AccountingExportDeliveryResult>;
  postProcess?(deliveryResult: AccountingExportDeliveryResult, context: AccountingExportAdapterContext): Promise<void>;
}
