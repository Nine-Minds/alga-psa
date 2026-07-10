/* eslint-disable custom-rules/no-feature-to-feature-imports -- Accounting export orchestration - requires integration-specific tenant settings for adapter configuration */
import {
  AccountingExportBatch,
  AccountingExportError,
  AccountingExportLine,
  AccountingExportStatus
} from '@alga-psa/types';
import {
  AccountingExportRepository,
  CreateExportBatchInput,
  CreateExportLineInput,
  CreateExportErrorInput,
  UpdateExportBatchStatusInput
} from '../repositories/accountingExportRepository';
import { AccountingAdapterRegistry } from '../adapters/accounting/registry';
import {
  AccountingExportAdapterContext,
  AccountingExportDeliveryDocumentFailure,
  AccountingExportDeliveryResult,
  AccountingExportTransformResult,
  AccountingExportDocument,
  TaxDelegationMode
} from '@alga-psa/types';
import { AccountingExportValidation } from './accountingExportValidation';
import { getExternalTaxImportService } from './externalTaxImportService';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { AppError } from '@alga-psa/core';
import { getXeroCsvSettingsForTenant } from '@alga-psa/integrations/runtime';
import logger from '@alga-psa/core/logger';

export interface ExternalTaxImporter {
  importTaxForInvoice(invoiceId: string): Promise<{ success: boolean; importedTax?: number; chargesUpdated?: number; error?: string }>;
}

export interface CreateExportBatchOptions extends CreateExportBatchInput {}

export interface AppendLinesOptions {
  lines: CreateExportLineInput[];
}

export interface AppendErrorsOptions {
  errors: CreateExportErrorInput[];
}

export class AccountingExportService {
  constructor(
    private readonly repository: AccountingExportRepository,
    private readonly adapterRegistry: AccountingAdapterRegistry,
    private readonly taxImporter?: ExternalTaxImporter
  ) {}

  static async create(taxImporter?: ExternalTaxImporter): Promise<AccountingExportService> {
    const [repository, registry] = await Promise.all([
      AccountingExportRepository.create(),
      AccountingAdapterRegistry.createDefault()
    ]);
    return new AccountingExportService(repository, registry, taxImporter ?? getExternalTaxImportService());
  }

  static async createForTenant(
    tenantId: string,
    taxImporter?: ExternalTaxImporter
  ): Promise<AccountingExportService> {
    const [repository, registry] = await Promise.all([
      AccountingExportRepository.createForTenant(tenantId),
      AccountingAdapterRegistry.createDefault()
    ]);
    return new AccountingExportService(repository, registry, taxImporter ?? getExternalTaxImportService());
  }

  async createBatch(input: CreateExportBatchOptions): Promise<AccountingExportBatch> {
    const exportType = input.export_type ?? 'invoice';
    const normalizedFilters = input.filters && Object.keys(input.filters).length > 0 ? input.filters : null;

    // Only block duplicates when a batch is still actionable. Delivered/posted/failed/cancelled
    // batches are historical records, and users may legitimately need to run another export later
    // (e.g. after clearing an export lock or changing mappings).
    const blockingStatuses: AccountingExportStatus[] = ['pending', 'validating', 'needs_attention', 'ready'];
    const existing = await this.repository.findActiveBatchByFilters({
      adapterType: input.adapter_type,
      exportType,
      filters: normalizedFilters,
      blockingStatuses
    });

    if (existing) {
      throw new AppError('ACCOUNTING_EXPORT_DUPLICATE', 'An export batch already exists for this filter selection', {
        batchId: existing.batch_id,
        status: existing.status
      });
    }

    return this.repository.createBatch({
      ...input,
      export_type: exportType,
      filters: normalizedFilters
    });
  }

  async appendLines(batchId: string, options: AppendLinesOptions): Promise<AccountingExportLine[]> {
    const results: AccountingExportLine[] = [];
    for (const line of options.lines) {
      results.push(await this.repository.addLine({ ...line, batch_id: batchId }));
    }
    return results;
  }

  async appendErrors(batchId: string, options: AppendErrorsOptions): Promise<AccountingExportError[]> {
    const results: AccountingExportError[] = [];
    for (const error of options.errors) {
      results.push(await this.repository.addError({ ...error, batch_id: batchId }));
    }
    return results;
  }

  async updateBatchStatus(batchId: string, updates: UpdateExportBatchStatusInput): Promise<AccountingExportBatch | null> {
    return this.repository.updateBatchStatus(batchId, updates);
  }

  /**
   * Cancel a batch that has not been delivered. Cancelled batches stop
   * blocking the duplicate-selection guard, so this is the recovery path for
   * wedged selections (manual or scheduled) without touching SQL.
   */
  async cancelBatch(
    batchId: string,
    options: { cancelledBy?: string | null; reason?: string | null } = {}
  ): Promise<AccountingExportBatch> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) {
      throw new AppError('ACCOUNTING_EXPORT_NOT_FOUND', `Export batch ${batchId} not found`, { batchId });
    }

    const cancellable: AccountingExportStatus[] = ['pending', 'validating', 'ready', 'needs_attention', 'failed'];
    if (!cancellable.includes(batch.status)) {
      throw new AppError('ACCOUNTING_EXPORT_INVALID_STATE', `Cannot cancel batch in status ${batch.status}`, {
        batchId,
        status: batch.status
      });
    }

    const updated = await this.repository.updateBatchStatus(batchId, {
      status: 'cancelled',
      last_updated_by: options.cancelledBy ?? null,
      notes: options.reason ?? batch.notes ?? null
    });
    return updated ?? { ...batch, status: 'cancelled' };
  }

  async getBatchWithDetails(batchId: string): Promise<{
    batch: AccountingExportBatch | null;
    lines: AccountingExportLine[];
    errors: AccountingExportError[];
  }> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) {
      return { batch: null, lines: [], errors: [] };
    }
    // Mixed export batches are line-authoritative. Historical/header-fallback lines and
    // canonical detail-backed recurring lines may coexist in one stored batch, and rereads
    // must preserve each line's stored projection metadata instead of collapsing them to one
    // batch-wide service-period basis.
    const [lines, errors] = await Promise.all([
      this.repository.listLines(batchId),
      this.repository.listErrors(batchId)
    ]);
    return { batch, lines, errors };
  }

  async listBatches(params: { status?: AccountingExportStatus; adapter_type?: string } = {}): Promise<AccountingExportBatch[]> {
    return this.repository.listBatches(params);
  }

  async executeBatch(batchId: string): Promise<AccountingExportDeliveryResult> {
    const initial = await this.getBatchWithDetails(batchId);
    const batch = initial.batch;
    if (!batch) {
      throw new Error(`Export batch ${batchId} not found`);
    }

    if (initial.lines.length === 0) {
      const now = new Date().toISOString();
      const documentLabel = batch.export_type === 'invoice' ? 'invoices' : 'documents';
      await this.repository.updateBatchStatus(batchId, {
        status: 'needs_attention',
        validated_at: now,
        notes: `No ${documentLabel} match the selected filters (or all matching ${documentLabel} have already been exported).`
      });
      await this.repository.addError({
        batch_id: batchId,
        code: 'ACCOUNTING_EXPORT_EMPTY_BATCH',
        message: `No ${documentLabel} match the selected filters (or all matching ${documentLabel} have already been exported).`,
        metadata: { adapterType: batch.adapter_type, exportType: batch.export_type }
      });
      throw new AppError(
        'ACCOUNTING_EXPORT_EMPTY_BATCH',
        `No ${documentLabel} match the selected filters (or all matching ${documentLabel} have already been exported).`,
        { batchId }
      );
    }

    const nonExecutableStates: AccountingExportStatus[] = ['cancelled', 'posted', 'delivered', 'validating'];
    if (nonExecutableStates.includes(batch.status)) {
      throw new AppError('ACCOUNTING_EXPORT_INVALID_STATE', `Cannot execute batch in status ${batch.status}`, {
        status: batch.status,
        batchId
      });
    }

    const adapter = this.adapterRegistry.get(batch.adapter_type);
    if (!adapter) {
      throw new Error(`No accounting adapter registered for type ${batch.adapter_type}`);
    }
    if (!adapter.capabilities().supportedExportTypes.includes(batch.export_type)) {
      throw new AppError(
        'ACCOUNTING_EXPORT_UNSUPPORTED_TYPE',
        `Adapter ${batch.adapter_type} does not support ${batch.export_type} exports`,
        {
          adapterType: batch.adapter_type,
          exportType: batch.export_type
        }
      );
    }

    const now = new Date().toISOString();
    await this.repository.updateBatchStatus(batchId, {
      status: 'validating',
      validated_at: now
    });

    await AccountingExportValidation.ensureMappingsForBatch(batchId);
    const refreshed = await this.getBatchWithDetails(batchId);
    if (!refreshed.batch) {
      throw new Error(`Export batch ${batchId} was not found after validation`);
    }

    await this.repository.updateBatchStatus(batchId, {
      status: refreshed.batch.status,
      validated_at: now
    });

    if (refreshed.batch.status !== 'ready') {
      await publishEvent({
        eventType: 'ACCOUNTING_EXPORT_FAILED',
        payload: {
          tenantId: refreshed.batch.tenant,
          batchId,
          adapterType: adapter.type,
          error: {
            message: 'Batch not ready after validation',
            status: refreshed.batch.status
          }
        }
      });
      const openErrors = refreshed.errors.filter((item) => item.resolution_state === 'open');
      // Typed so callers (e.g. the scheduled drain) can tell deterministic
      // validation failures apart from transient transport errors.
      throw new AppError(
        'ACCOUNTING_EXPORT_VALIDATION_FAILED',
        `Export batch ${batchId} is not ready for delivery (status ${refreshed.batch.status})`,
        {
          batchId,
          status: refreshed.batch.status,
          validationErrors: openErrors.slice(0, 10).map((item) => ({ code: item.code, message: item.message }))
        }
      );
    }

    const normalizedBatch: AccountingExportBatch = {
      ...refreshed.batch,
      validated_at: now
    };

    // Determine tax delegation mode from invoice tax_source values
    const taxDelegationMode = await this.determineTaxDelegationMode(refreshed.batch, refreshed.lines);
    const excludeTaxFromExport = taxDelegationMode === 'delegate';

    // Load adapter-specific settings
    let adapterSettings: Record<string, unknown> | undefined;
    if (normalizedBatch.adapter_type === 'xero_csv' && normalizedBatch.tenant) {
      try {
        const xeroCsvSettings = await getXeroCsvSettingsForTenant(normalizedBatch.tenant);
        adapterSettings = {
          dateFormat: xeroCsvSettings.dateFormat,
          defaultCurrency: xeroCsvSettings.defaultCurrency
        };
      } catch (error) {
        logger.warn('[AccountingExportService] Failed to load Xero CSV settings, using defaults', {
          error: (error as Error).message
        });
      }
    }

    const context: AccountingExportAdapterContext = {
      batch: normalizedBatch,
      lines: refreshed.lines,
      taxDelegationMode,
      excludeTaxFromExport,
      adapterSettings
    };

    let transformResult: AccountingExportTransformResult | null = null;

    try {
      transformResult = await adapter.transform(context);
      const deliveryResult = await adapter.deliver(transformResult, context);
      const failedDocuments = deliveryResult.failedDocuments ?? [];

      for (const delivered of deliveryResult.deliveredLines) {
        // Delivery/retry transitions may change transport state, but the stored line-level
        // service-period projection stays immutable so replay, reread, and dashboard inspection
        // keep the original canonical-vs-fallback provenance for each exported line.
        await this.repository.updateLine(delivered.lineId, {
          status: 'delivered',
          external_document_ref: delivered.externalDocumentRef ?? null
        });
      }

      for (const failure of failedDocuments) {
        await this.persistDeliveryDocumentFailure(batchId, adapter.type, failure);
      }

      const deliveredLineIds = new Set(deliveryResult.deliveredLines.map((item) => item.lineId));
      const deliveredContextLines =
        failedDocuments.length > 0
          ? context.lines.filter((line) => deliveredLineIds.has(line.line_id))
          : context.lines;

      const transactionIds = collectTransactionIds(deliveredContextLines);
      if (transactionIds.length > 0) {
        await this.repository.attachTransactionsToBatch(transactionIds, batchId);
      }

      const hasDeliveredLines = deliveryResult.deliveredLines.length > 0;
      if (failedDocuments.length === 0) {
        await this.repository.updateBatchStatus(batchId, {
          status: 'delivered',
          delivered_at: new Date().toISOString()
        });
      } else {
        await this.repository.updateBatchStatus(batchId, {
          status: hasDeliveredLines ? 'needs_attention' : 'failed',
          delivered_at: hasDeliveredLines ? new Date().toISOString() : undefined,
          notes: `${failedDocuments.length} of ${transformResult.documents.length} document(s) failed to deliver. See batch errors for details.`
        });
      }

      if (failedDocuments.length === 0 || hasDeliveredLines) {
        if (typeof adapter.postProcess === 'function') {
          await adapter.postProcess(deliveryResult, context);
        }

        // Automatically import external tax after successful delivery with tax delegation
        if (context.taxDelegationMode === 'delegate') {
          await this.importExternalTaxAfterDelivery(
            deliveryResult,
            { ...context, lines: deliveredContextLines },
            adapter
          );
        }
      }

      if (failedDocuments.length === 0) {
        await publishEvent({
          eventType: 'ACCOUNTING_EXPORT_COMPLETED',
          payload: {
            tenantId: context.batch.tenant,
            batchId: context.batch.batch_id,
            adapterType: adapter.type,
            deliveredLineIds: deliveryResult.deliveredLines.map((item) => item.lineId)
          }
        });
      } else {
        await publishEvent({
          eventType: 'ACCOUNTING_EXPORT_FAILED',
          payload: {
            tenantId: context.batch.tenant,
            batchId: context.batch.batch_id,
            adapterType: adapter.type,
            deliveredLineIds: deliveryResult.deliveredLines.map((item) => item.lineId),
            error: {
              message: `${failedDocuments.length} of ${transformResult.documents.length} invoice(s) failed to deliver: ${failedDocuments
                .map((failure) => failure.message)
                .join(' | ')}`,
              code: failedDocuments[0].code
            }
          }
        });
      }

      return deliveryResult;
    } catch (error: any) {
      await this.persistAdapterFailure({
        batchId,
        adapterType: adapter.type,
        context,
        transformResult,
        error
      });

      await this.repository.updateBatchStatus(batchId, {
        status: 'failed',
        notes: error?.message ?? 'Accounting export failed'
      });

      await publishEvent({
        eventType: 'ACCOUNTING_EXPORT_FAILED',
        payload: {
          tenantId: context.batch.tenant,
          batchId: context.batch.batch_id,
          adapterType: adapter.type,
          error: {
            message: error?.message ?? 'Unknown accounting export failure'
          }
        }
      });
      throw error;
    }
  }

  /**
   * Determine tax delegation mode based on invoice tax_source values in the batch.
   * If any invoice has pending_external tax source, we delegate tax calculation.
   */
  private async determineTaxDelegationMode(batch: AccountingExportBatch, lines: AccountingExportLine[]): Promise<TaxDelegationMode> {
    if (batch.export_type !== 'invoice') {
      return 'none';
    }

    // Extract invoice IDs from the export lines
    const invoiceIds = lines
      .filter(line => line.document_id)
      .map(line => line.document_id)
      .filter((id): id is string => Boolean(id));

    if (invoiceIds.length === 0) {
      return 'none';
    }

    // Check invoice tax_source values
    const invoicesWithTaxSource = await this.repository.getInvoicesTaxSource(invoiceIds);

    const hasPendingExternalTax = invoicesWithTaxSource.some(
      inv => inv.tax_source === 'pending_external'
    );

    if (hasPendingExternalTax) {
      return 'delegate';
    }

    // Check if any invoices have external tax source (already imported)
    const hasExternalTax = invoicesWithTaxSource.some(
      inv => inv.tax_source === 'external'
    );

    if (hasExternalTax) {
      return 'import_pending';
    }

    return 'none';
  }

  private async persistDeliveryDocumentFailure(
    batchId: string,
    adapterType: string,
    failure: AccountingExportDeliveryDocumentFailure
  ): Promise<void> {
    const metadata = {
      adapterType,
      documentId: failure.documentId,
      ...(failure.metadata ?? {})
    };

    if (failure.lineIds.length === 0) {
      await this.repository.addError({
        batch_id: batchId,
        line_id: null,
        code: failure.code,
        message: failure.message,
        metadata
      });
      return;
    }

    for (const lineId of failure.lineIds) {
      await this.repository.updateLine(lineId, {
        status: 'failed',
        external_document_ref: null,
        notes: failure.message
      });
      await this.repository.addError({
        batch_id: batchId,
        line_id: lineId,
        code: failure.code,
        message: failure.message,
        metadata
      });
    }
  }

  private async persistAdapterFailure(params: {
    batchId: string;
    adapterType: string;
    context: AccountingExportAdapterContext;
    transformResult: AccountingExportTransformResult | null;
    error: unknown;
  }): Promise<void> {
    const { error, transformResult, context, batchId, adapterType } = params;
    if (!(error instanceof AppError)) {
      return;
    }

    const details = Array.isArray((error.details as any)?.errors)
      ? ((error.details as any).errors as Array<Record<string, any>>)
      : [];

    if (details.length === 0) {
      return;
    }

    const documentsById: Map<string, AccountingExportDocument> = new Map();
    if (transformResult) {
      for (const document of transformResult.documents) {
        documentsById.set(document.documentId, document);
      }
    }

    const correlationId =
      typeof (error.details as any)?.correlationId === 'string'
        ? (error.details as any).correlationId
        : undefined;

    for (const detail of details) {
      const documentId =
        typeof detail.documentId === 'string'
          ? detail.documentId
          : typeof detail.document_id === 'string'
            ? detail.document_id
            : undefined;

      const document = documentId ? documentsById.get(documentId) : undefined;
      const lineIds = document?.lineIds ?? [];

      const validationMessages = Array.isArray(detail.validationErrors)
        ? detail.validationErrors
            .map((item: any) => item?.message)
            .filter((message: unknown): message is string => typeof message === 'string' && message.trim().length > 0)
        : [];

      const detailMessageParts = [
        typeof detail.message === 'string' ? detail.message : undefined,
        ...validationMessages
      ].filter((part): part is string => Boolean(part));

      const detailMessage =
        detailMessageParts.length > 0 ? detailMessageParts.join(' | ') : error.message;

      const metadata = {
        adapterType,
        adapterCode: error.code,
        documentId: documentId ?? null,
        correlationId: correlationId ?? null,
        validationErrors: Array.isArray(detail.validationErrors) ? detail.validationErrors : undefined,
        raw: detail.raw ?? undefined
      };

      if (lineIds.length > 0) {
        for (const lineId of lineIds) {
          await this.repository.updateLine(lineId, {
            status: 'failed',
            external_document_ref: null,
            notes: detailMessage
          });
          await this.repository.addError({
            batch_id: batchId,
            line_id: lineId,
            code: error.code,
            message: detailMessage,
            metadata
          });
        }
      } else {
        await this.repository.addError({
          batch_id: batchId,
          line_id: null,
          code: error.code,
          message: detailMessage,
          metadata
        });
      }
    }
  }

  /**
   * Import external tax from the accounting system after successful export.
   * This is called automatically when taxDelegationMode is 'delegate'.
   */
  private async importExternalTaxAfterDelivery(
    deliveryResult: AccountingExportDeliveryResult,
    context: AccountingExportAdapterContext,
    adapter: any
  ): Promise<void> {
    if (!this.taxImporter) {
      logger.info('[AccountingExportService] No tax importer configured, skipping external tax import', {
        batchId: context.batch.batch_id
      });
      return;
    }

    // Automatic post-export tax import is invoice-centric. Canonical recurring
    // service-period detail on export lines can explain coverage, but it must not
    // fan one invoice out into multiple tax-import attempts.
    // Extract unique invoice IDs from the exported lines.
    const invoiceIds = [...new Set(
      context.lines
        .filter(line => line.document_id)
        .map(line => line.document_id as string)
    )];

    if (invoiceIds.length === 0) {
      logger.info('[AccountingExportService] No invoices to import tax for', {
        batchId: context.batch.batch_id
      });
      return;
    }

    logger.info('[AccountingExportService] Importing external tax after delivery', {
      batchId: context.batch.batch_id,
      invoiceCount: invoiceIds.length,
      adapterType: adapter.type
    });

    for (const invoiceId of invoiceIds) {
      try {
        const result = await this.taxImporter.importTaxForInvoice(invoiceId);

        if (result.success) {
          logger.info('[AccountingExportService] Successfully imported tax for invoice', {
            invoiceId,
            importedTax: result.importedTax,
            chargesUpdated: result.chargesUpdated
          });
        } else {
          logger.warn('[AccountingExportService] Failed to import tax for invoice', {
            invoiceId,
            error: result.error
          });
        }
      } catch (error: any) {
        logger.error('[AccountingExportService] Error importing tax for invoice', {
          invoiceId,
          error: error.message
        });
        // Continue with other invoices even if one fails
      }
    }
  }
}

function collectTransactionIds(lines: AccountingExportLine[]): string[] {
  const ids: string[] = [];
  for (const line of lines) {
    const payload = line.payload as Record<string, any> | null;
    if (!payload) continue;
    const txIds = Array.isArray(payload.transaction_ids) ? payload.transaction_ids : payload.transactionIds;
    if (Array.isArray(txIds)) {
      for (const id of txIds) {
        if (typeof id === 'string' && id.trim().length > 0) {
          ids.push(id);
        }
      }
    }
  }
  return ids;
}
