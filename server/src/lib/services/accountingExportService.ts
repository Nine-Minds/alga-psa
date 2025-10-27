import { createTenantKnex } from '../db';
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

export interface CreateExportBatchOptions extends CreateExportBatchInput {}

export interface AppendLinesOptions {
  lines: CreateExportLineInput[];
}

export interface AppendErrorsOptions {
  errors: CreateExportErrorInput[];
}

export class AccountingExportService {
  constructor(private readonly repository: AccountingExportRepository) {}

  static async create(): Promise<AccountingExportService> {
    const repository = await AccountingExportRepository.create();
    return new AccountingExportService(repository);
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
}
