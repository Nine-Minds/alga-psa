import type { AccountingExportBatch, AccountingExportLine } from './accountingExport.interfaces';

export interface AccountingExportAdapterCapabilities {
  deliveryMode: 'api' | 'file';
  supportedExportTypes: readonly string[];
  supportsPartialRetry: boolean;
  supportsInvoiceUpdates: boolean;
  /** Whether this adapter supports external tax calculation (tax delegation) */
  supportsTaxDelegation?: boolean;
  /** Whether this adapter can fetch invoice data including tax amounts from external system */
  supportsInvoiceFetch?: boolean;
  /** Whether this adapter supports importing individual tax components */
  supportsTaxComponentImport?: boolean;
  /** Whether this adapter can report entities changed in the external system since a timestamp */
  supportsChangePolling?: boolean;
  /** Whether this adapter can record payments in the external system */
  supportsPaymentRecording?: boolean;
  /** Whether this adapter can push a received payment to the external system */
  supportsOutboundPayment?: boolean;
  /** Whether this adapter can apply an issued credit to an invoice in the external system */
  supportsOutboundCredit?: boolean;
  /** Whether this adapter can void/delete an exported document in the external system */
  supportsOutboundVoid?: boolean;
}

/** Entity kinds reported by change polling */
export type AccountingExternalChangeEntity = 'Customer' | 'Payment' | 'Invoice' | 'CreditMemo' | 'RefundReceipt';

/** Provider-neutral allocation of an external payment/credit to an invoice. */
export interface NormalizedExternalPaymentAllocation {
  externalInvoiceId: string;
  amountCents: number;
}

/**
 * Provider-neutral payment / credit-application payload. Adapters translate
 * their own payload shape into this contract so shared reconciliation logic
 * never branches on provider field names.
 */
export interface NormalizedExternalPaymentPayload {
  reference: string;
  currency?: string;
  /** Bookkeeping date recorded by the provider (ISO 8601). */
  txnDate?: string;
  totalCents?: number;
  unappliedCents?: number;
  allocations: NormalizedExternalPaymentAllocation[];
  /** True when the provider records this as a credit application rather than cash. */
  isCreditApplication: boolean;
  /** Opaque provider fields preserved for diagnostics and historical metadata. */
  providerMetadata?: Record<string, unknown>;
}

/** Provider-neutral document payload used for drift/void reconciliation. */
export interface NormalizedExternalDocumentPayload {
  totalAmount: number | null;
  docNumber: string | null;
  /** True when the provider reports the document as voided/deleted in place. */
  isVoided: boolean;
  providerMetadata?: Record<string, unknown>;
}

export type NormalizedExternalChangePayload =
  | NormalizedExternalPaymentPayload
  | NormalizedExternalDocumentPayload;

/** One changed entity in the external accounting system */
export interface AccountingExternalChange {
  entityType: AccountingExternalChangeEntity;
  externalId: string;
  syncToken?: string;
  deleted: boolean;
  updatedAt?: string;
  /** Raw entity payload as returned by the external system (absent for deletions) */
  payload?: Record<string, unknown>;
  /**
   * Provider-neutral view of the same change. Present for adapters that
   * normalize at the boundary; shared appliers prefer it and only fall back to
   * the legacy QBO payload shape when it is absent.
   */
  normalized?: NormalizedExternalChangePayload;
}

/** Provider-neutral snapshot of an external document used before a remote write. */
export interface ProviderDocumentSnapshot {
  externalId: string;
  externalEntityType?: string;
  syncToken?: string | null;
  totalAmount?: number | null;
  docNumber?: string | null;
  customerExternalId?: string | null;
}

export interface ProviderPaymentRequest {
  externalInvoiceId: string;
  externalCustomerId?: string | null;
  amountCents: number;
  reference: string;
  currency?: string;
  depositAccountRef?: { value: string; name?: string } | null;
}

export interface ProviderPaymentResult {
  externalPaymentId: string;
  syncToken?: string;
  /** Amount the provider booked as unapplied customer credit, when reported. */
  unappliedCents?: number;
}

export interface ProviderCreditApplicationRequest {
  externalCreditNoteId: string;
  externalInvoiceId: string;
  externalCustomerId?: string | null;
  amountCents: number;
}

export interface ProviderCreditApplicationResult {
  externalPaymentId: string;
  syncToken?: string;
}

export interface ProviderVoidDocumentRequest {
  externalId: string;
  externalEntityType?: string;
}

/**
 * Remote accounting operations exposed by an adapter once it has resolved a
 * tenant + organisation. Capability flags gate whether a given operation may
 * be attempted; the appliers never construct a provider client directly.
 */
export interface AccountingProviderOperations {
  readDocument(entityType: string, externalId: string): Promise<ProviderDocumentSnapshot | null>;
  /** Remaining credit on an external credit note, or null when it is gone. */
  getCreditRemainingCents(externalCreditNoteId: string): Promise<number | null>;
  recordPayment(request: ProviderPaymentRequest): Promise<ProviderPaymentResult>;
  applyCredit(request: ProviderCreditApplicationRequest): Promise<ProviderCreditApplicationResult>;
  voidDocument(request: ProviderVoidDocumentRequest): Promise<void>;
}

export interface AccountingChangeSet {
  changes: AccountingExternalChange[];
  /** True when the source truncated results; the next poll should resume from `nextCursor`. */
  truncated: boolean;
  /** Timestamp the changes were fetched (next cycle's cursor basis) */
  fetchedAt: string;
  /**
   * @deprecated Not populated by the shipping adapters and not used to advance
   * the cursor. A single stored timestamp cannot safely describe an unfinished
   * feed (mixed truncated/complete feeds, identical timestamps spanning pages),
   * so a truncated poll leaves the cursor untouched and re-polls the same
   * window. Retained only for interface compatibility.
   */
  nextCursor?: string;
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
  /** Adapter-specific settings (e.g., date format for CSV adapters) */
  adapterSettings?: Record<string, unknown>;
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

/**
 * A document that could not be delivered while the rest of the batch continued.
 * API adapters report these instead of throwing so one rejected invoice does not
 * abort delivery of the remaining documents.
 */
export interface AccountingExportDeliveryDocumentFailure {
  documentId: string;
  lineIds: string[];
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AccountingExportDeliveryResult {
  deliveredLines: AccountingExportDeliveryLineResult[];
  failedDocuments?: AccountingExportDeliveryDocumentFailure[];
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
   * Report entities changed in the external system since the given ISO timestamp.
   * Only available when capabilities().supportsChangePolling is true.
   */
  fetchChanges?(
    tenantId: string,
    since: string,
    targetRealm?: string | null
  ): Promise<AccountingChangeSet>;

  /**
   * Resolve remote operations for a tenant + organisation. Only present for
   * adapters that expose at least one outbound operation; callers gate on the
   * matching capability flag first.
   */
  providerOperations?(
    tenantId: string,
    targetRealm: string
  ): Promise<AccountingProviderOperations>;

  /**
   * Called after export when tax delegation is enabled.
   * Records pending tax imports for invoices exported without tax.
   */
  onTaxDelegationExport?(
    deliveryResult: AccountingExportDeliveryResult,
    context: AccountingExportAdapterContext
  ): Promise<PendingTaxImportRecord[]>;
}
