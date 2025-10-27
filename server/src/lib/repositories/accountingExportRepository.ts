import { Knex } from 'knex';
import { createTenantKnex } from '../../lib/db';
import {
  AccountingExportBatch,
  AccountingExportError,
  AccountingExportErrorResolutionState,
  AccountingExportLine,
  AccountingExportLineStatus,
  AccountingExportStatus
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
  constructor(private readonly knex: Knex, private readonly tenantId: string | null) {}

  static async create(): Promise<AccountingExportRepository> {
    const { knex, tenant } = await createTenantKnex();
    return new AccountingExportRepository(knex, tenant ?? null);
  }

  getTenantId(): string | null {
    return this.tenantId;
  }

  private requireTenant(): string {
    if (!this.tenantId) {
      throw new Error('AccountingExportRepository requires tenant context');
    }
    return this.tenantId;
  }

  async createBatch(input: CreateExportBatchInput): Promise<AccountingExportBatch> {
    const tenant = this.requireTenant();
    const normalizedFilters = input.filters && Object.keys(input.filters).length > 0 ? input.filters : null;

    const [batch] = await this.knex<AccountingExportBatch>('accounting_export_batches')
      .insert({
        ...input,
        tenant,
        filters: normalizedFilters,
        status: 'pending'
      })
      .returning('*');

    return batch;
  }

  async getBatch(batchId: string): Promise<AccountingExportBatch | null> {
    const tenant = this.requireTenant();
    const batch = await this.knex<AccountingExportBatch>('accounting_export_batches')
      .where({ batch_id: batchId, tenant })
      .first();

    return batch || null;
  }

  async listBatches(params: { status?: AccountingExportStatus; adapter_type?: string } = {}): Promise<AccountingExportBatch[]> {
    const tenant = this.requireTenant();
    const query = this.knex<AccountingExportBatch>('accounting_export_batches')
      .where({ tenant })
      .orderBy('created_at', 'desc');

    if (params.status) {
      query.where({ status: params.status });
    }
    if (params.adapter_type) {
      query.where({ adapter_type: params.adapter_type });
    }
    return query;
  }

  async updateBatch(batchId: string, updates: Partial<AccountingExportBatch>): Promise<AccountingExportBatch | null> {
    const tenant = this.requireTenant();
    const [batch] = await this.knex<AccountingExportBatch>('accounting_export_batches')
      .where({ batch_id: batchId, tenant })
      .update(updates)
      .returning('*');
    return batch || null;
  }

  async updateBatchStatus(batchId: string, updates: UpdateExportBatchStatusInput): Promise<AccountingExportBatch | null> {
    const updatePayload: Partial<AccountingExportBatch> = {
      status: updates.status,
      updated_at: new Date().toISOString()
    };

    if (updates.validated_at !== undefined) {
      updatePayload.validated_at = updates.validated_at;
    }
    if (updates.delivered_at !== undefined) {
      updatePayload.delivered_at = updates.delivered_at;
    }
    if (updates.posted_at !== undefined) {
      updatePayload.posted_at = updates.posted_at;
    }
    if (updates.last_updated_by !== undefined) {
      updatePayload.last_updated_by = updates.last_updated_by;
    }
    if (updates.notes !== undefined) {
      updatePayload.notes = updates.notes;
    }

    return this.updateBatch(batchId, updatePayload);
  }

  async addLine(input: CreateExportLineInput): Promise<AccountingExportLine> {
    const tenant = this.requireTenant();
    const [line] = await this.knex<AccountingExportLine>('accounting_export_lines')
      .insert({
        ...input,
        tenant,
        status: input.status ?? 'pending'
      })
      .returning('*');
    return line;
  }

  async listLines(batchId: string): Promise<AccountingExportLine[]> {
    const tenant = this.requireTenant();
    return this.knex<AccountingExportLine>('accounting_export_lines')
      .where({ batch_id: batchId, tenant })
      .orderBy('created_at');
  }

  async updateLine(lineId: string, updates: Partial<AccountingExportLine>): Promise<AccountingExportLine | null> {
    const tenant = this.requireTenant();
    const [line] = await this.knex<AccountingExportLine>('accounting_export_lines')
      .where({ line_id: lineId, tenant })
      .update({ ...updates, updated_at: new Date().toISOString() })
      .returning('*');
    return line || null;
  }

  async addError(input: CreateExportErrorInput): Promise<AccountingExportError> {
    const tenant = this.requireTenant();
    const [error] = await this.knex<AccountingExportError>('accounting_export_errors')
      .insert({
        ...input,
        tenant,
        resolution_state: input.resolution_state ?? 'open'
      })
      .returning('*');
    return error;
  }

  async listErrors(batchId: string): Promise<AccountingExportError[]> {
    const tenant = this.requireTenant();
    return this.knex<AccountingExportError>('accounting_export_errors')
      .where({ batch_id: batchId, tenant })
      .orderBy('created_at');
  }

  async updateError(errorId: string, updates: Partial<AccountingExportError>): Promise<AccountingExportError | null> {
    const tenant = this.requireTenant();
    const [error] = await this.knex<AccountingExportError>('accounting_export_errors')
      .where({ error_id: errorId, tenant })
      .update({ ...updates, resolved_at: updates.resolved_at ?? null })
      .returning('*');
    return error || null;
  }

  async findActiveBatchByFilters(params: {
    adapterType: string;
    exportType: string;
    filters: Record<string, unknown> | null;
    blockingStatuses: AccountingExportStatus[];
  }): Promise<AccountingExportBatch | null> {
    const tenant = this.requireTenant();
    const query = this.knex<AccountingExportBatch>('accounting_export_batches')
      .where({ tenant, adapter_type: params.adapterType, export_type: params.exportType })
      .whereIn('status', params.blockingStatuses)
      .orderBy('created_at', 'desc');

    if (!params.filters) {
      query.whereNull('filters');
    } else {
      query.whereRaw('filters::jsonb = ?::jsonb', [JSON.stringify(params.filters)]);
    }

    const existing = await query.first();
    return existing ?? null;
  }

  async attachTransactionsToBatch(transactionIds: string[], batchId: string): Promise<number> {
    const tenant = this.requireTenant();
    if (transactionIds.length === 0) {
      return 0;
    }

    const uniqueIds = Array.from(new Set(transactionIds.filter((id): id is string => Boolean(id))));
    if (uniqueIds.length === 0) {
      return 0;
    }

    const updated = await this.knex('transactions')
      .where({ tenant })
      .whereIn('transaction_id', uniqueIds)
      .update({
        accounting_export_batch_id: batchId
      });

    return typeof updated === 'number' ? updated : uniqueIds.length;
  }
}
