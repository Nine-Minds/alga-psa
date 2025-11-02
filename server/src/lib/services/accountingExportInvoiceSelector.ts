import { Knex } from 'knex';

import { createTenantKnex } from '../db';
import { AccountingExportService } from './accountingExportService';
import { AccountingExportBatch } from '../../interfaces/accountingExport.interfaces';

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
  isManualInvoice: boolean;
  isManualCharge: boolean;
  isMultiPeriod: boolean;
  isCredit: boolean;
  isZeroAmount: boolean;
  transactionIds: string[];
}

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

  async previewInvoiceLines(filters: InvoiceSelectionFilters): Promise<InvoicePreviewLine[]> {
    const tenantId = this.tenantId;
    const query = this.knex('invoices as inv')
      .join('invoice_charges as ch', function joinCharges() {
        this.on('inv.invoice_id', '=', 'ch.invoice_id').andOn('inv.tenant', '=', 'ch.tenant');
      })
      .leftJoin('clients as cli', function joinClients() {
        this.on('inv.client_id', '=', 'cli.client_id').andOn('inv.tenant', '=', 'cli.tenant');
      })
      .select([
        'inv.invoice_id',
        'inv.invoice_number',
        'inv.invoice_date',
        'inv.status as invoice_status',
        'inv.client_id',
        'cli.client_name',
        'inv.currency_code',
        'inv.is_manual as invoice_is_manual',
        'inv.billing_period_start',
        'inv.billing_period_end',
        'inv.total_amount',
        'ch.item_id',
        'ch.total_price',
        'ch.is_manual as charge_is_manual'
      ])
      .where('inv.tenant', this.tenantId)
      .andWhere('ch.tenant', this.tenantId);

    if (filters.startDate) {
      query.andWhere('inv.invoice_date', '>=', filters.startDate);
    }

    if (filters.endDate) {
      query.andWhere('inv.invoice_date', '<=', filters.endDate);
    }

    if (filters.invoiceStatuses && filters.invoiceStatuses.length > 0) {
      query.andWhere((builder) => builder.whereIn('inv.status', filters.invoiceStatuses!));
    }

    if (filters.clientIds && filters.clientIds.length > 0) {
      query.andWhere((builder) => builder.whereIn('inv.client_id', filters.clientIds!));
    } else if (filters.clientSearch && filters.clientSearch.trim().length > 0) {
      const searchValue = `%${filters.clientSearch.trim().toLowerCase()}%`;
      query.andWhereRaw('LOWER(cli.client_name) LIKE ?', [searchValue]);
    }

    const adapterType = filters.adapterType?.trim() ?? '';
    const targetRealm = filters.targetRealm ? String(filters.targetRealm).trim() : null;
    const shouldExcludeSynced = Boolean(filters.excludeSyncedInvoices !== false && adapterType);

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
          this.andWhereNull('map.external_realm_id');
        }
      });
    }

    const rows = await query.orderBy('inv.invoice_date', 'asc').orderBy('inv.invoice_number', 'asc');

    if (rows.length === 0) {
      return [];
    }

    const invoiceIds = Array.from(new Set(rows.map((row) => row.invoice_id))).filter(Boolean);
    const transactionMap = await this.fetchTransactions(invoiceIds);

    return rows.map((row) => {
      const amountCents = toInteger(row.total_price);
      const totalAmountCents = toInteger(row.total_amount);
      const servicePeriodStart = row.billing_period_start ? new Date(row.billing_period_start).toISOString() : null;
      const servicePeriodEnd = row.billing_period_end ? new Date(row.billing_period_end).toISOString() : null;
      const isMultiPeriod = Boolean(servicePeriodStart && servicePeriodEnd && servicePeriodStart !== servicePeriodEnd);

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

    const exportService = await AccountingExportService.create();
    const batch = await exportService.createBatch({
      adapter_type: options.adapterType,
      export_type: 'invoice',
      target_realm: options.targetRealm ?? null,
      filters: normalizeFilters(options.filters),
      notes: options.notes ?? null,
      created_by: options.createdBy ?? null
    });

    if (preview.length === 0) {
      return { batch, lines: [] };
    }

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
