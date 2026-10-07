import { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  AccountingExportBatch,
  AccountingExportError,
  AccountingExportErrorResolutionState,
  AccountingExportLine,
  AccountingExportLinePayload,
  AccountingExportLineStatus,
  AccountingExportServicePeriodSource,
  AccountingExportStatus
} from '@alga-psa/types';
import { normalizeAccountingExportCalendarDate } from '../services/accountingExportDateUtils';

type Nullable<T> = T | null | undefined;

interface InvoiceTaxSourceProjection {
  tenant: string;
  invoice_id: string;
  tax_source: string | null;
}

const ACCOUNTING_EXPORT_SERVICE_PERIOD_SOURCES = new Set<AccountingExportServicePeriodSource>([
  'canonical_detail_periods',
  'invoice_header_fallback',
  'financial_document_fallback'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeServicePeriodSource(
  value: unknown
): AccountingExportServicePeriodSource | null | undefined {
  if (value === null || value === undefined) {
    return value as null | undefined;
  }

  return ACCOUNTING_EXPORT_SERVICE_PERIOD_SOURCES.has(value as AccountingExportServicePeriodSource)
    ? (value as AccountingExportServicePeriodSource)
    : undefined;
}

function normalizeRecurringDetailPeriods(
  value: unknown
): AccountingExportLinePayload['recurring_detail_periods'] {
  if (value === null || value === undefined) {
    return value as null | undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .filter(isRecord)
    .map((period) => {
      const billingTiming: 'advance' | 'arrears' | null =
        period.billing_timing === 'advance' || period.billing_timing === 'arrears'
          ? period.billing_timing
          : null;

      return {
        service_period_start:
          typeof period.service_period_start === 'string' ? period.service_period_start : null,
        service_period_end:
          typeof period.service_period_end === 'string' ? period.service_period_end : null,
        billing_timing: billingTiming
      };
    })
    .filter((period) => period.service_period_start || period.service_period_end);
}

function normalizeIsoDateField(value: unknown): string | null | undefined {
  return normalizeAccountingExportCalendarDate(value);
}

function normalizeLinePayload(payload: unknown): AccountingExportLinePayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const metadata = isRecord(payload.metadata)
    ? {
        manual_invoice: payload.metadata.manual_invoice === true ? true : undefined,
        manual_charge: payload.metadata.manual_charge === true ? true : undefined,
        multi_period: payload.metadata.multi_period === true ? true : undefined,
        credit_memo: payload.metadata.credit_memo === true ? true : undefined,
        zero_amount: payload.metadata.zero_amount === true ? true : undefined
      }
    : null;

  const normalized: AccountingExportLinePayload = {
    invoice_number: typeof payload.invoice_number === 'string' ? payload.invoice_number : undefined,
    invoice_status: typeof payload.invoice_status === 'string' ? payload.invoice_status : undefined,
    document_number: typeof payload.document_number === 'string' ? payload.document_number : undefined,
    document_kind: typeof payload.document_kind === 'string' ? payload.document_kind : undefined,
    client_name:
      typeof payload.client_name === 'string'
        ? payload.client_name
        : payload.client_name === null
          ? null
          : undefined,
    service_period_source: normalizeServicePeriodSource(payload.service_period_source),
    recurring_detail_periods: normalizeRecurringDetailPeriods(payload.recurring_detail_periods),
    metadata,
    transaction_ids: Array.isArray(payload.transaction_ids)
      ? payload.transaction_ids.filter((value): value is string => typeof value === 'string')
      : undefined
  };

  return Object.values(normalized).some((value) => value !== undefined) ? normalized : null;
}

function normalizeExportLine(line: AccountingExportLine): AccountingExportLine {
  return {
    ...line,
    service_period_start: normalizeIsoDateField(line.service_period_start),
    service_period_end: normalizeIsoDateField(line.service_period_end),
    payload: normalizeLinePayload(line.payload)
  };
}

export interface CreateExportBatchInput {
  adapter_type: string;
  target_realm?: Nullable<string>;
  export_type: string;
  filters?: Record<string, unknown> | null;
  created_by?: Nullable<string>;
  notes?: Nullable<string>;
  origin?: 'manual' | 'scheduled';
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
  document_id: string;
  document_line_id?: Nullable<string>;
  client_id?: Nullable<string>;
  amount_cents: number;
  currency_code: string;
  exchange_rate_basis_points?: Nullable<number>;
  service_period_start?: Nullable<string>;
  service_period_end?: Nullable<string>;
  mapping_resolution?: Record<string, unknown> | null;
  payload?: AccountingExportLinePayload | null;
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

  static async createForTenant(tenantId: string): Promise<AccountingExportRepository> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    return new AccountingExportRepository(knex, tenant ?? null);
  }

  getTenantId(): string | null {
    return this.tenantId;
  }

  async reserveInvoicesForExport(batchId: string, invoiceIds: string[], expectedStatus: AccountingExportStatus, validatedAt: string, executionId: string): Promise<void> {
    const tenant = this.requireTenant();
    const uniqueIds = [...new Set(invoiceIds)].sort();
    await this.knex.transaction(async (trx) => {
      const batch = await tenantDb(trx, tenant).table('accounting_export_batches')
        .where({ tenant, batch_id: batchId, status: expectedStatus }).forUpdate().first('batch_id');
      if (!batch) throw new Error('Export batch changed before execution could reserve its invoices');
      const actualRows = await tenantDb(trx, tenant).table('accounting_export_lines').where({ tenant, batch_id: batchId }).select('document_id');
      const actualIds = [...new Set(actualRows.map((row: { document_id: string }) => row.document_id))].sort();
      if (JSON.stringify(actualIds) !== JSON.stringify(uniqueIds)) throw new Error('Export batch membership changed before execution');
      if (uniqueIds.length) {
        await tenantDb(trx, tenant).table('invoices').where({ tenant }).whereIn('invoice_id', uniqueIds).orderBy('invoice_id').forUpdate().select('invoice_id');
        const conflict = await tenantDb(trx, tenant).table('accounting_export_lines as line')
          .join('accounting_export_batches as active_batch', function joinBatch() {
            this.on('active_batch.tenant', '=', 'line.tenant').andOn('active_batch.batch_id', '=', 'line.batch_id');
          }).where({ 'line.tenant': tenant, 'active_batch.tenant': tenant, 'active_batch.status': 'validating' })
          .whereIn('line.document_id', uniqueIds).whereNot('line.batch_id', batchId).first('line.line_id');
        if (conflict) throw new Error('An export is already being prepared for one of these invoices');
      }
      await tenantDb(trx, tenant).table('accounting_export_batches')
        .where({ tenant, batch_id: batchId, status: expectedStatus }).update({ status: 'validating', validated_at: validatedAt, updated_at: validatedAt, execution_id: executionId });
    });
  }

  getConnection(): Knex {
    return this.knex;
  }

  /** The row lock fences the entire attempt, including artifact publication.
   * Recovery skips a live transaction; a resumed older worker must match its ID.
   */
  async withExecution<T>(batchId: string, executionId: string, work: (repository: AccountingExportRepository) => Promise<T>): Promise<T> {
    const tenant = this.requireTenant();
    return this.knex.transaction(async (trx) => {
      const batch = await tenantDb(trx, tenant).table('accounting_export_batches')
        .where({ tenant, batch_id: batchId, status: 'validating', execution_id: executionId })
        .forNoKeyUpdate().first('batch_id');
      if (!batch) throw new Error('Accounting export execution no longer owns this reservation');
      return work(new AccountingExportRepository(trx, tenant));
    });
  }

  async failExecution(batchId: string, executionId: string, notes: string): Promise<void> {
    const tenant = this.requireTenant();
    await this.table('accounting_export_batches', tenant)
      .where({ batch_id: batchId, status: 'validating', execution_id: executionId })
      .update({ status: 'failed', notes, updated_at: new Date().toISOString() });
  }

  async recoverExpiredExecution(batchId: string, expiredBefore: string): Promise<boolean> {
    const tenant = this.requireTenant();
    return this.knex.transaction(async (trx) => {
      const query = tenantDb(trx, tenant).table('accounting_export_batches')
        .where({ tenant, batch_id: batchId, status: 'validating' }).andWhere('updated_at', '<', expiredBefore);
      const abandoned = await query.clone().forUpdate().skipLocked().first('batch_id');
      if (!abandoned) return false;
      await query.update({ status: 'failed', execution_id: null,
        notes: 'Export reservation expired after an interrupted execution.', updated_at: new Date().toISOString() });
      return true;
    });
  }

  private requireTenant(): string {
    if (!this.tenantId) {
      throw new Error('AccountingExportRepository requires tenant context');
    }
    return this.tenantId;
  }

  private table<Row extends object = Record<string, unknown>>(tableExpression: string, tenant = this.requireTenant()) {
    return tenantDb(this.knex, tenant).table<Row>(tableExpression);
  }

  async createBatch(input: CreateExportBatchInput): Promise<AccountingExportBatch> {
    const tenant = this.requireTenant();
    const normalizedFilters = input.filters && Object.keys(input.filters).length > 0 ? input.filters : null;

    const [batch] = await this.table<AccountingExportBatch>('accounting_export_batches', tenant)
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
    const batch = await this.table<AccountingExportBatch>('accounting_export_batches', tenant)
      .where({ batch_id: batchId })
      .first();

    return batch || null;
  }

  async listBatches(params: { status?: AccountingExportStatus; adapter_type?: string } = {}): Promise<AccountingExportBatch[]> {
    const tenant = this.requireTenant();
    const query = this.table<AccountingExportBatch>('accounting_export_batches', tenant)
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
    const [batch] = await this.table<AccountingExportBatch>('accounting_export_batches', tenant)
      .where({ batch_id: batchId })
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

  async transitionBatchStatus(
    batchId: string,
    allowedStatuses: AccountingExportStatus[],
    updates: UpdateExportBatchStatusInput
  ): Promise<AccountingExportBatch | null> {
    const tenant = this.requireTenant();
    const updatePayload: Partial<AccountingExportBatch> = { ...updates, updated_at: new Date().toISOString() };
    const [batch] = await this.table<AccountingExportBatch>('accounting_export_batches', tenant)
      .where({ batch_id: batchId }).whereIn('status', allowedStatuses).update(updatePayload).returning('*');
    return batch || null;
  }

  async listArtifacts(batchId: string): Promise<Array<{ artifact_id: string; filename: string; content_type: string; storage_fallback: boolean }>> {
    const tenant = this.requireTenant();
    return this.table<{ artifact_id: string; filename: string; content_type: string; storage_fallback: boolean }>('accounting_export_artifacts', tenant).where('batch_id', batchId).andWhere('committed', true)
      .select('artifact_id', 'filename', 'content_type', 'storage_fallback').orderBy('filename');
  }

  async addLine(input: CreateExportLineInput): Promise<AccountingExportLine> {
    const tenant = this.requireTenant();
    const line = await this.knex.transaction(async (trx) => {
      const batch = await tenantDb(trx, tenant).table('accounting_export_batches')
        .where({ tenant, batch_id: input.batch_id }).forUpdate().first('status');
      if (!batch || batch.status === 'validating' || ['delivered', 'posted', 'cancelled'].includes(batch.status)) {
        throw new Error(`Cannot append lines to export batch in status ${batch?.status ?? 'missing'}`);
      }
      const [inserted] = await tenantDb(trx, tenant).table<AccountingExportLine>('accounting_export_lines')
        .insert({ ...input, tenant, status: input.status ?? 'pending' }).returning('*');
      return inserted;
    });
    return normalizeExportLine(line);
  }

  async listLines(batchId: string): Promise<AccountingExportLine[]> {
    const tenant = this.requireTenant();
    const lines = await this.table<AccountingExportLine>('accounting_export_lines', tenant)
      .where({ batch_id: batchId })
      .orderBy('created_at');
    return lines.map(normalizeExportLine);
  }

  async updateLine(lineId: string, updates: Partial<AccountingExportLine>): Promise<AccountingExportLine | null> {
    const tenant = this.requireTenant();
    const [line] = await this.table<AccountingExportLine>('accounting_export_lines', tenant)
      .where({ line_id: lineId })
      .update({ ...updates, updated_at: new Date().toISOString() })
      .returning('*');
    return line ? normalizeExportLine(line) : null;
  }

  async addError(input: CreateExportErrorInput): Promise<AccountingExportError> {
    const tenant = this.requireTenant();
    const [error] = await this.table<AccountingExportError>('accounting_export_errors', tenant)
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
    return this.table<AccountingExportError>('accounting_export_errors', tenant)
      .where({ batch_id: batchId })
      .orderBy('created_at');
  }

  async updateError(errorId: string, updates: Partial<AccountingExportError>): Promise<AccountingExportError | null> {
    const tenant = this.requireTenant();
    const [error] = await this.table<AccountingExportError>('accounting_export_errors', tenant)
      .where({ error_id: errorId })
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
    const query = this.table<AccountingExportBatch>('accounting_export_batches', tenant)
      .where({ adapter_type: params.adapterType, export_type: params.exportType })
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

    const updated = await this.table('transactions', tenant)
      .whereIn('transaction_id', uniqueIds)
      .update({
        accounting_export_batch_id: batchId
      });

    return typeof updated === 'number' ? updated : uniqueIds.length;
  }

  /**
   * Get tax_source for a list of invoices.
   * Used to determine if tax delegation is needed during export.
   */
  async getInvoicesTaxSource(invoiceIds: string[]): Promise<Array<{ invoice_id: string; tax_source: string | null }>> {
    const tenant = this.requireTenant();
    if (invoiceIds.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(invoiceIds));
    const invoices = await this.table<InvoiceTaxSourceProjection>('invoices', tenant)
      .whereIn('invoice_id', uniqueIds)
      .select('invoice_id', 'tax_source');

    return invoices;
  }
}
