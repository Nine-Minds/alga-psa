import {
  AccountingExportBatch,
  AccountingExportError,
  AccountingExportLine,
  AccountingExportStatus
} from '../../interfaces/accountingExport.interfaces';
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
  AccountingExportDeliveryResult
} from '../adapters/accounting/accountingExportAdapter';
import { AccountingExportValidation } from '../validation/accountingExportValidation';
import { publishEvent } from '../eventBus/publishers';

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
    return this.repository.createBatch(input);
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
    const { batch, lines } = await this.getBatchWithDetails(batchId);
    if (!batch) {
      throw new Error(`Export batch ${batchId} not found`);
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

    const context: AccountingExportAdapterContext = {
      batch: normalizedBatch,
      lines: refreshed.lines
    };

    try {
      const transformResult = await adapter.transform(context);
      const deliveryResult = await adapter.deliver(transformResult, context);

      for (const delivered of deliveryResult.deliveredLines) {
        await this.repository.updateLine(delivered.lineId, {
          status: 'delivered',
          external_document_ref: delivered.externalDocumentRef ?? null
        });
      }

      await this.repository.updateBatchStatus(batchId, {
        status: 'delivered',
        delivered_at: new Date().toISOString()
      });

      if (typeof adapter.postProcess === 'function') {
        await adapter.postProcess(deliveryResult, context);
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
}
