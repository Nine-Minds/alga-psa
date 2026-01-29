import type {
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
import { AccountingAdapterRegistry } from '../lib/adapters/accounting/registry';
import {
  AccountingExportAdapterContext,
  AccountingExportDeliveryResult,
  AccountingExportTransformResult,
  AccountingExportDocument,
  TaxDelegationMode
} from '../lib/adapters/accounting/accountingExportAdapter';
import { AccountingExportValidation } from '../lib/validation/accountingExportValidation';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { AppError } from '@alga-psa/core';
import { getExternalTaxImportService } from './externalTaxImportService';
import { getXeroCsvSettings } from '../actions';
import logger from '@alga-psa/core/logger';

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
    private readonly adapterRegistry: AccountingAdapterRegistry
  ) {}

  static async create(): Promise<AccountingExportService> {
    const [repository, registry] = await Promise.all([
      AccountingExportRepository.create(),
      AccountingAdapterRegistry.createDefault()
    ]);
    return new AccountingExportService(repository, registry);
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

  async getBatchWithDetails(batchId: string): Promise<{
    batch: AccountingExportBatch | null;
    lines: AccountingExportLine[];
    errors: AccountingExportError[];
  }> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) {
      return { batch: null, lines: [], errors: [] };
    }
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
      await this.repository.updateBatchStatus(batchId, {
        status: 'needs_attention',
        validated_at: now,
        notes: 'No invoices match the selected filters (or all matching invoices have already been exported).'
      });
      await this.repository.addError({
        batch_id: batchId,
        code: 'ACCOUNTING_EXPORT_EMPTY_BATCH',
        message: 'No invoices match the selected filters (or all matching invoices have already been exported).',
        metadata: { adapterType: batch.adapter_type, exportType: batch.export_type }
      });
      throw new AppError(
        'ACCOUNTING_EXPORT_EMPTY_BATCH',
        'No invoices match the selected filters (or all matching invoices have already been exported).',
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
      throw new Error(`Export batch ${batchId} is not ready for delivery (status ${refreshed.batch.status})`);
    }

    const normalizedBatch: AccountingExportBatch = {
      ...refreshed.batch,
      validated_at: now
    };

    // Determine tax delegation mode from invoice tax_source values
    const taxDelegationMode = await this.determineTaxDelegationMode(refreshed.lines);
    const excludeTaxFromExport = taxDelegationMode === 'delegate';

    // Load adapter-specific settings
    let adapterSettings: Record<string, unknown> | undefined;
    if (normalizedBatch.adapter_type === 'xero_csv') {
      try {
        const xeroCsvSettings = await getXeroCsvSettings();
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

      for (const delivered of deliveryResult.deliveredLines) {
        await this.repository.updateLine(delivered.lineId, {
          status: 'delivered',
          external_document_ref: delivered.externalDocumentRef ?? null
        });
      }

      const transactionIds = collectTransactionIds(context.lines);
      if (transactionIds.length > 0) {
        await this.repository.attachTransactionsToBatch(transactionIds, batchId);
      }

      await this.repository.updateBatchStatus(batchId, {
        status: 'delivered',
        delivered_at: new Date().toISOString()
      });

      if (typeof adapter.postProcess === 'function') {
        await adapter.postProcess(deliveryResult, context);
      }

      // Automatically import external tax after successful delivery with tax delegation
      if (context.taxDelegationMode === 'delegate') {
        await this.importExternalTaxAfterDelivery(deliveryResult, context, adapter);
      }

      await publishEvent({
        eventType: 'ACCOUNTING_EXPORT_COMPLETED',
        payload: {
          tenantId: context.batch.tenant,
          batchId: context.batch.batch_id,
          adapterType: adapter.type,
          deliveredLineIds: deliveryResult.deliveredLines.map((item) => item.lineId)
        }
      });

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
  private async determineTaxDelegationMode(lines: AccountingExportLine[]): Promise<TaxDelegationMode> {
    // Extract invoice IDs from the export lines
    const invoiceIds = lines
      .filter(line => line.invoice_id)
      .map(line => line.invoice_id)
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
    // Extract unique invoice IDs from the exported lines
    const invoiceIds = [...new Set(
      context.lines
        .filter(line => line.invoice_id)
        .map(line => line.invoice_id as string)
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

    const taxImportService = getExternalTaxImportService();

    for (const invoiceId of invoiceIds) {
      try {
        const result = await taxImportService.importTaxForInvoice(invoiceId);

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
