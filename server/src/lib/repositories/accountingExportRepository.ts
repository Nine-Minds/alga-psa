import { Knex } from 'knex';
import { createTenantKnex } from '../../lib/db';
import {
  AccountingExportBatch,
  AccountingExportLine,
  AccountingExportError,
  AccountingExportStatus,
  AccountingExportLineStatus,
  AccountingExportErrorResolutionState
} from '../../interfaces/accountingExport.interfaces';

type Nullable<T> = T | null | undefined;

export interface CreateExportBatchInput {
  adapter_type: string;
  target_realm?: Nullable<string>;
  export_type: string;
  filters?: Record<string, unknown> | null;
  created_by?: Nullable<string>;
  notes?: Nullable<string>;
}

export interface UpdateExportBatchStatusInput {
  status: AccountingExportStatus;
  validated_at?: Nullable<string>;
  delivered_at?: Nullable<string>;
  posted_at?: Nullable<string>;
  last_updated_by?: Nullable<string>;
  notes?: Nullable<string>;
}

export interface CreateExportLineInput {
  batch_id: string;
  invoice_id: string;
  invoice_charge_id?: Nullable<string>;
  client_id?: Nullable<string>;
  amount_cents: number;
  currency_code: string;
  exchange_rate_basis_points?: Nullable<number>;
  service_period_start?: Nullable<string>;
  service_period_end?: Nullable<string>;
  mapping_resolution?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  status?: AccountingExportLineStatus;
  external_document_ref?: Nullable<string>;
  notes?: Nullable<string>;
}

export interface CreateExportErrorInput {
  batch_id: string;
  line_id?: Nullable<string>;
  code: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  resolution_state?: AccountingExportErrorResolutionState;
}

export class AccountingExportRepository {
  constructor(private readonly knex: Knex) {}

  static async create(): Promise<AccountingExportRepository> {
    const { knex } = await createTenantKnex();
    return new AccountingExportRepository(knex);
  }

  async createBatch(input: CreateExportBatchInput): Promise<AccountingExportBatch> {
    const [batch] = await this.knex<AccountingExportBatch>('accounting_export_batches')
      .insert({
        ...input,
        status: 'pending'
      })
      .returning('*');

    return batch;
  }

  async getBatch(batchId: string): Promise<AccountingExportBatch | null> {
    const batch = await this.knex<AccountingExportBatch>('accounting_export_batches')
      .where({ batch_id: batchId })
      .first();

    return batch || null;
  }

  async listBatches(params: { status?: AccountingExportStatus; adapter_type?: string } = {}): Promise<AccountingExportBatch[]> {
    const query = this.knex<AccountingExportBatch>('accounting_export_batches').orderBy('created_at', 'desc');
    if (params.status) {
      query.where({ status: params.status });
    }
    if (params.adapter_type) {
      query.where({ adapter_type: params.adapter_type });
    }
    return query;
  }

  async updateBatch(batchId: string, updates: Partial<AccountingExportBatch>): Promise<AccountingExportBatch | null> {
    const [batch] = await this.knex<AccountingExportBatch>('accounting_export_batches')
      .where({ batch_id: batchId })
      .update(updates)
      .returning('*');
    return batch || null;
  }

  async updateBatchStatus(batchId: string, updates: UpdateExportBatchStatusInput): Promise<AccountingExportBatch | null> {
    return this.updateBatch(batchId, {
      status: updates.status,
      validated_at: updates.validated_at ?? null,
      delivered_at: updates.delivered_at ?? null,
      posted_at: updates.posted_at ?? null,
      last_updated_by: updates.last_updated_by ?? null,
      notes: updates.notes ?? null,
      updated_at: new Date().toISOString()
    });
  }

  async addLine(input: CreateExportLineInput): Promise<AccountingExportLine> {
    const [line] = await this.knex<AccountingExportLine>('accounting_export_lines')
      .insert({
        ...input,
        status: input.status ?? 'pending'
      })
      .returning('*');
    return line;
  }

  async listLines(batchId: string): Promise<AccountingExportLine[]> {
    return this.knex<AccountingExportLine>('accounting_export_lines')
      .where({ batch_id: batchId })
      .orderBy('created_at');
  }

  async updateLine(lineId: string, updates: Partial<AccountingExportLine>): Promise<AccountingExportLine | null> {
    const [line] = await this.knex<AccountingExportLine>('accounting_export_lines')
      .where({ line_id: lineId })
      .update({ ...updates, updated_at: new Date().toISOString() })
      .returning('*');
    return line || null;
  }

  async addError(input: CreateExportErrorInput): Promise<AccountingExportError> {
    const [error] = await this.knex<AccountingExportError>('accounting_export_errors')
      .insert({
        ...input,
        resolution_state: input.resolution_state ?? 'open'
      })
      .returning('*');
    return error;
  }

  async listErrors(batchId: string): Promise<AccountingExportError[]> {
    return this.knex<AccountingExportError>('accounting_export_errors')
      .where({ batch_id: batchId })
      .orderBy('created_at');
  }

  async updateError(errorId: string, updates: Partial<AccountingExportError>): Promise<AccountingExportError | null> {
    const [error] = await this.knex<AccountingExportError>('accounting_export_errors')
      .where({ error_id: errorId })
      .update({ ...updates, resolved_at: updates.resolved_at ?? null })
      .returning('*');
    return error || null;
  }
}
