import { Knex } from 'knex';

import { createTenantKnex } from '@alga-psa/db';
import { AccountingExportService } from './accountingExportService';
import { AccountingExportBatch, AccountingExportServicePeriodSource } from '@alga-psa/types';
import { AppError } from '@alga-psa/core';

type Nullable<T> = T | null | undefined;

export interface InvoiceSelectionFilters {
  startDate?: Nullable<string>;
  endDate?: Nullable<string>;
  invoiceStatuses?: string[];
  clientIds?: string[];
  clientSearch?: string;
  adapterType?: string;
  targetRealm?: Nullable<string>;
  excludeSyncedInvoices?: boolean;
}

export interface InvoicePreviewLine {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceStatus: string;
  clientId: string | null;
  clientName: string | null;
  chargeId: string;
  amountCents: number;
  currencyCode: string;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
  recurringDetailPeriods?: Array<{
    service_period_start?: string | null;
    service_period_end?: string | null;
    billing_timing?: 'arrears' | 'advance' | null;
  }>;
  servicePeriodSource: AccountingExportServicePeriodSource;
  isManualInvoice: boolean;
  isManualCharge: boolean;
  isMultiPeriod: boolean;
  isCredit: boolean;
  isZeroAmount: boolean;
  transactionIds: string[];
}

type InvoicePreviewSelectionRow = {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string | Date;
  invoice_status: string;
  tax_source?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  currency_code?: string | null;
  invoice_is_manual?: boolean | null;
  billing_period_start?: string | Date | null;
  billing_period_end?: string | Date | null;
  total_amount?: number | string | null;
  item_id: string;
  total_price: number | string;
  charge_is_manual?: boolean | null;
  detail_service_period_start?: string | Date | null;
  detail_service_period_end?: string | Date | null;
  detail_billing_timing?: 'arrears' | 'advance' | null;
};

interface CreateBatchOptions {
  adapterType: string;
  targetRealm?: Nullable<string>;
  notes?: Nullable<string>;
  createdBy?: Nullable<string>;
  filters: InvoiceSelectionFilters;
}

export class AccountingExportInvoiceSelector {
  constructor(private readonly knex: Knex, private readonly tenantId: string) {}

  static async create(): Promise<AccountingExportInvoiceSelector> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('AccountingExportInvoiceSelector requires tenant context');
    }
    return new AccountingExportInvoiceSelector(knex, tenant);
  }

  static async createForTenant(tenantId: string): Promise<AccountingExportInvoiceSelector> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('AccountingExportInvoiceSelector requires tenant context');
    }
    return new AccountingExportInvoiceSelector(knex, tenant);
  }

  async previewInvoiceLines(filters: InvoiceSelectionFilters): Promise<InvoicePreviewLine[]> {
    const tenantId = this.tenantId;
    const adapterType = filters.adapterType?.trim() ?? '';
    const invoiceStatusesForQuery = expandInvoiceStatuses(filters.invoiceStatuses);
    const includePendingExternalDrafts =
      shouldIncludePendingExternalDrafts(adapterType, invoiceStatusesForQuery);

    const query = this.knex('invoices as inv')
      .join('invoice_charges as ch', function joinCharges() {
        this.on('inv.invoice_id', '=', 'ch.invoice_id').andOn('inv.tenant', '=', 'ch.tenant');
      })
      .leftJoin('invoice_charge_details as iid', function joinChargeDetails() {
        this.on('ch.item_id', '=', 'iid.item_id').andOn('ch.tenant', '=', 'iid.tenant');
      })
      .leftJoin('clients as cli', function joinClients() {
        this.on('inv.client_id', '=', 'cli.client_id').andOn('inv.tenant', '=', 'cli.tenant');
      })
      .select([
        'inv.invoice_id',
        'inv.invoice_number',
        'inv.invoice_date',
        'inv.status as invoice_status',
        'inv.tax_source',
        'inv.client_id',
        'cli.client_name',
        'inv.currency_code',
        'inv.is_manual as invoice_is_manual',
        'inv.billing_period_start',
        'inv.billing_period_end',
        'inv.total_amount',
        'ch.item_id',
        'ch.total_price',
        'ch.is_manual as charge_is_manual',
        'iid.service_period_start as detail_service_period_start',
        'iid.service_period_end as detail_service_period_end',
        'iid.billing_timing as detail_billing_timing'
      ])
      .where('inv.tenant', this.tenantId)
      .andWhere('ch.tenant', this.tenantId);

    if (filters.startDate) {
      query.andWhere('inv.invoice_date', '>=', filters.startDate);
    }

    if (filters.endDate) {
      query.andWhere('inv.invoice_date', '<=', filters.endDate);
    }

    if (invoiceStatusesForQuery && invoiceStatusesForQuery.length > 0) {
      query.andWhere((builder) => {
        builder.whereIn('inv.status', invoiceStatusesForQuery);
        if (includePendingExternalDrafts) {
          builder.orWhere((orBuilder) =>
            orBuilder.where('inv.status', 'draft').andWhere('inv.tax_source', 'pending_external')
          );
        }
      });
    }

    if (filters.clientIds && filters.clientIds.length > 0) {
      query.andWhere((builder) => builder.whereIn('inv.client_id', filters.clientIds!));
    } else if (filters.clientSearch && filters.clientSearch.trim().length > 0) {
      const searchValue = `%${filters.clientSearch.trim().toLowerCase()}%`;
      query.andWhereRaw('LOWER(cli.client_name) LIKE ?', [searchValue]);
    }

    const targetRealm = filters.targetRealm ? String(filters.targetRealm).trim() : null;
    // Immutability rule: once an invoice is synced for an adapter+realm, it should not be selected again.
    const shouldExcludeSynced = Boolean(adapterType);

    if (shouldExcludeSynced) {
      const knex = this.knex;
      query.whereNotExists(function () {
        this.select(knex.raw('1'))
          .from('tenant_external_entity_mappings as map')
          .where('map.tenant', tenantId)
          .andWhere('map.integration_type', adapterType)
          .andWhere('map.alga_entity_type', 'invoice')
          .andWhereRaw('map.alga_entity_id = inv.invoice_id::text');

        if (targetRealm) {
          this.andWhere(function () {
            this.where('map.external_realm_id', targetRealm).orWhereNull('map.external_realm_id');
          });
        } else {
          this.whereNull('map.external_realm_id');
        }
      });
    }

    const rows = (await query.orderBy('inv.invoice_date', 'asc').orderBy('inv.invoice_number', 'asc')) as InvoicePreviewSelectionRow[];

    if (rows.length === 0) {
      return [];
    }

    const invoiceIds = Array.from(new Set(rows.map((row) => row.invoice_id))).filter(Boolean);
    const transactionMap = await this.fetchTransactions(invoiceIds);

    const rowsByChargeId = new Map<string, InvoicePreviewSelectionRow[]>();
    for (const row of rows) {
      const existing = rowsByChargeId.get(row.item_id) ?? [];
      existing.push(row);
      rowsByChargeId.set(row.item_id, existing);
    }

    return Array.from(rowsByChargeId.values()).map((chargeRows) => {
      const row = chargeRows[0];
      const amountCents = toInteger(row.total_price);
      const totalAmountCents = toInteger(row.total_amount);
      const detailServicePeriodStarts = chargeRows
        .map((detailRow) => detailRow.detail_service_period_start)
        .filter((value): value is string | Date => value !== null && value !== undefined)
        .map(toIsoString)
        .filter((value): value is string => value !== null)
        .sort();
      const detailServicePeriodEnds = chargeRows
        .map((detailRow) => detailRow.detail_service_period_end)
        .filter((value): value is string | Date => value !== null && value !== undefined)
        .map(toIsoString)
        .filter((value): value is string => value !== null)
        .sort();
      const recurringDetailPeriodsByKey = new Map<
        string,
        {
          service_period_start: string | null;
          service_period_end: string | null;
          billing_timing: 'arrears' | 'advance' | null;
        }
      >();
      for (const detailRow of chargeRows) {
        const start = toIsoString(detailRow.detail_service_period_start);
        const end = toIsoString(detailRow.detail_service_period_end);
        const billingTiming =
          detailRow.detail_billing_timing === 'advance' || detailRow.detail_billing_timing === 'arrears'
            ? detailRow.detail_billing_timing
            : null;
        if (!start && !end) {
          continue;
        }
        recurringDetailPeriodsByKey.set(`${start ?? ''}|${end ?? ''}|${billingTiming ?? ''}`, {
          service_period_start: start,
          service_period_end: end,
          billing_timing: billingTiming,
        });
      }
      const recurringDetailPeriods = Array.from(recurringDetailPeriodsByKey.values()).sort((left, right) => {
        if (left.service_period_start !== right.service_period_start) {
          return String(left.service_period_start ?? '').localeCompare(String(right.service_period_start ?? ''));
        }
        return String(left.service_period_end ?? '').localeCompare(String(right.service_period_end ?? ''));
      });
      const hasCanonicalDetailPeriods = recurringDetailPeriods.length > 0;
      const servicePeriodStart = hasCanonicalDetailPeriods
        ? recurringDetailPeriods[0]?.service_period_start ?? detailServicePeriodStarts[0] ?? null
        : null;
      const servicePeriodEnd = hasCanonicalDetailPeriods
        ? recurringDetailPeriods[recurringDetailPeriods.length - 1]?.service_period_end ??
          detailServicePeriodEnds[detailServicePeriodEnds.length - 1] ??
          null
        : null;
      const servicePeriodSource = resolveServicePeriodSource({
        hasCanonicalDetailPeriods,
        servicePeriodStart,
        servicePeriodEnd
      });
      const distinctDetailPeriods = new Set(
        recurringDetailPeriods.map((period) => `${period.service_period_start ?? ''}|${period.service_period_end ?? ''}`)
      );
      const isMultiPeriod =
        distinctDetailPeriods.size > 1 ||
        Boolean(servicePeriodStart && servicePeriodEnd && servicePeriodStart !== servicePeriodEnd);

      return {
        invoiceId: row.invoice_id,
        invoiceNumber: row.invoice_number,
        invoiceDate: new Date(row.invoice_date).toISOString(),
        invoiceStatus: row.invoice_status,
        clientId: row.client_id ?? null,
        clientName: row.client_name ?? null,
        chargeId: row.item_id,
        amountCents,
        currencyCode: row.currency_code ?? 'USD',
        servicePeriodStart,
        servicePeriodEnd,
        recurringDetailPeriods: recurringDetailPeriods.length > 0 ? recurringDetailPeriods : undefined,
        servicePeriodSource,
        isManualInvoice: Boolean(row.invoice_is_manual),
        isManualCharge: Boolean(row.charge_is_manual),
        isMultiPeriod,
        isCredit: amountCents < 0 || totalAmountCents < 0,
        isZeroAmount: amountCents === 0,
        transactionIds: transactionMap.get(row.invoice_id) ?? []
      } satisfies InvoicePreviewLine;
    });
  }

  async createBatchFromFilters(options: CreateBatchOptions): Promise<{ batch: AccountingExportBatch; lines: InvoicePreviewLine[] }> {
    const preview = await this.previewInvoiceLines({
      ...options.filters,
      adapterType: options.adapterType,
      targetRealm: options.targetRealm ?? null,
      excludeSyncedInvoices: options.filters.excludeSyncedInvoices ?? true
    });

    if (preview.length === 0) {
      throw new AppError(
        'ACCOUNTING_EXPORT_EMPTY_BATCH',
        'No invoices match the selected filters (or all matching invoices have already been exported).',
        { filters: normalizeFilters(options.filters) }
      );
    }

    const exportService = await AccountingExportService.createForTenant(this.tenantId);
    const batch = await exportService.createBatch({
      adapter_type: options.adapterType,
      export_type: 'invoice',
      target_realm: options.targetRealm ?? null,
      filters: normalizeFilters(options.filters),
      notes: options.notes ?? null,
      created_by: options.createdBy ?? null
    });

    const lineInputs = preview.map((line) => ({
      batch_id: batch.batch_id,
      invoice_id: line.invoiceId,
      invoice_charge_id: line.chargeId,
      client_id: line.clientId,
      amount_cents: line.amountCents,
      currency_code: line.currencyCode,
      service_period_start: line.servicePeriodStart ?? null,
      service_period_end: line.servicePeriodEnd ?? null,
      payload: {
        invoice_number: line.invoiceNumber,
        invoice_status: line.invoiceStatus,
        client_name: line.clientName,
        service_period_source: line.servicePeriodSource,
        recurring_detail_periods: line.recurringDetailPeriods ?? null,
        metadata: {
          manual_invoice: line.isManualInvoice,
          manual_charge: line.isManualCharge,
          multi_period: line.isMultiPeriod,
          credit_memo: line.isCredit,
          zero_amount: line.isZeroAmount
        },
        transaction_ids: line.transactionIds
      }
    }));

    await exportService.appendLines(batch.batch_id, { lines: lineInputs });

    return { batch, lines: preview };
  }

  private async fetchTransactions(invoiceIds: string[]): Promise<Map<string, string[]>> {
    if (invoiceIds.length === 0) {
      return new Map();
    }

    const rows = await this.knex('transactions')
      .select('invoice_id', 'transaction_id')
      .where('tenant', this.tenantId)
      .whereIn('invoice_id', invoiceIds);

    const map = new Map<string, string[]>();
    for (const row of rows) {
      const list = map.get(row.invoice_id) ?? [];
      list.push(row.transaction_id);
      map.set(row.invoice_id, list);
    }
    return map;
  }
}

function shouldIncludePendingExternalDrafts(
  adapterType: string,
  invoiceStatusesForQuery: string[] | null | undefined
): boolean {
  if (!adapterType) {
    return false;
  }

  const adapterSupportsTaxDelegation =
    adapterType === 'quickbooks_csv' ||
    adapterType === 'quickbooks_online' ||
    adapterType === 'quickbooks_desktop' ||
    adapterType === 'xero' ||
    adapterType === 'xero_csv';

  if (!adapterSupportsTaxDelegation) {
    return false;
  }

  if (!invoiceStatusesForQuery || invoiceStatusesForQuery.length === 0) {
    return false;
  }

  const includesDraft = invoiceStatusesForQuery.some(
    (status) => String(status).toLowerCase() === 'draft'
  );
  if (includesDraft) {
    return false;
  }

  // Draft invoices awaiting external tax import are effectively "blocked" and should be exportable
  // without requiring users to manually include all draft invoices.
  return true;
}

function toInteger(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }
  return 0;
}

function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined) {
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
  }

  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function expandInvoiceStatuses(input?: string[]): string[] | undefined {
  if (!input || input.length === 0) {
    return undefined;
  }

  const normalized = new Set(input.map((s) => String(s).trim()).filter(Boolean));
  if (normalized.size === 0) {
    return undefined;
  }

  // Backward compatibility: some tenants store invoice statuses in legacy Title Case forms
  // (e.g. "Unpaid") while the UI uses canonical status keys (e.g. "sent", "overdue").
  const lower = new Set(Array.from(normalized).map((s) => s.toLowerCase()));
  const includesAny = (values: string[]) => values.some((v) => lower.has(v));

  if (includesAny(['sent', 'overdue', 'pending', 'prepayment', 'partially_applied'])) {
    normalized.add('Unpaid');
  }
  if (lower.has('paid')) {
    normalized.add('Paid');
  }
  if (lower.has('draft')) {
    normalized.add('Draft');
  }
  if (includesAny(['cancelled', 'canceled'])) {
    normalized.add('Cancelled');
  }

  return Array.from(normalized);
}

function normalizeFilters(filters: InvoiceSelectionFilters): Record<string, unknown> | null {
  const normalized: Record<string, unknown> = {};

  if (filters.startDate) {
    normalized.start_date = filters.startDate;
  }

  if (filters.endDate) {
    normalized.end_date = filters.endDate;
  }

  if (filters.invoiceStatuses && filters.invoiceStatuses.length > 0) {
    normalized.invoice_statuses = Array.from(new Set(filters.invoiceStatuses));
  }

  if (filters.clientIds && filters.clientIds.length > 0) {
    normalized.client_ids = Array.from(new Set(filters.clientIds));
  }

  if (filters.clientSearch && filters.clientSearch.trim().length > 0) {
    normalized.client_search = filters.clientSearch.trim();
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function resolveServicePeriodSource(params: {
  hasCanonicalDetailPeriods: boolean;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
}): AccountingExportServicePeriodSource {
  if (params.hasCanonicalDetailPeriods) {
    return 'canonical_detail_periods';
  }

  return 'financial_document_fallback';
}
