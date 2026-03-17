import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
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

type Nullable<T> = T | null | undefined;

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
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    const isLocalMidnight =
      value.getHours() === 0 &&
      value.getMinutes() === 0 &&
      value.getSeconds() === 0 &&
      value.getMilliseconds() === 0;
    const isUtcMidnight =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0;

    const year = isLocalMidnight ? value.getFullYear() : value.getUTCFullYear();
    const month = isLocalMidnight ? value.getMonth() + 1 : value.getUTCMonth() + 1;
    const day = isLocalMidnight ? value.getDate() : value.getUTCDate();

    if (isLocalMidnight || isUtcMidnight) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00.000Z`;
    }

    return value.toISOString();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return `${trimmed}T00:00:00.000Z`;
    }

    return trimmed;
  }

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
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
    return normalizeExportLine(line);
  }

  async listLines(batchId: string): Promise<AccountingExportLine[]> {
    const tenant = this.requireTenant();
    const lines = await this.knex<AccountingExportLine>('accounting_export_lines')
      .where({ batch_id: batchId, tenant })
      .orderBy('created_at');
    return lines.map(normalizeExportLine);
  }

  async updateLine(lineId: string, updates: Partial<AccountingExportLine>): Promise<AccountingExportLine | null> {
    const tenant = this.requireTenant();
    const [line] = await this.knex<AccountingExportLine>('accounting_export_lines')
      .where({ line_id: lineId, tenant })
      .update({ ...updates, updated_at: new Date().toISOString() })
      .returning('*');
    return line ? normalizeExportLine(line) : null;
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
    const invoices = await this.knex('invoices')
      .where({ tenant })
      .whereIn('invoice_id', uniqueIds)
      .select('invoice_id', 'tax_source');

    return invoices;
  }
}
