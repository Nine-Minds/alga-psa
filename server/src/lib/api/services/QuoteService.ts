/**
 * Quote API Service
 * Service layer for quote-related API operations.
 * Delegates to existing billing package models and services.
 */

import type { Knex } from 'knex';
import { BaseService, ServiceContext, ListOptions, ListResult } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { hasPermission } from '../../auth/rbac';
import { Quote, QuoteItem, QuoteActivity } from '@alga-psa/billing/models';
import {
  buildQuoteConversionPreview,
  convertQuoteToDraftContract,
  convertQuoteToDraftInvoice,
  convertQuoteToDraftContractAndInvoice,
} from '@alga-psa/billing/services';

import type {
  IQuote,
  IQuoteItem,
  IQuoteListItem,
  QuoteConversionPreview,
} from '@alga-psa/types';

import type {
  CreateQuoteApi,
  UpdateQuoteApi,
  CreateQuoteItemApi,
  UpdateQuoteItemApi,
  SendQuoteApi,
  ConvertQuoteApi,
} from '../schemas/quoteSchemas';

export interface QuoteListOptions extends ListOptions {
  include_items?: boolean;
  include_client?: boolean;
  status?: string;
  client_id?: string;
  is_template?: boolean;
  search?: string;
}

export class QuoteService extends BaseService<IQuote> {
  constructor() {
    super({
      tableName: 'quotes',
      primaryKey: 'quote_id',
      tenantColumn: 'tenant',
      auditFields: {
        createdBy: 'created_by',
        updatedBy: 'updated_by',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      searchableFields: ['title', 'quote_number'],
      defaultSort: 'created_at',
      defaultOrder: 'desc',
    });
  }

  private async validateBillingPermission(context: ServiceContext, action: string): Promise<void> {
    const hasAccess = await hasPermission(context.user, 'billing', action);
    if (!hasAccess) {
      throw new Error(`Permission denied: Cannot ${action} quotes`);
    }
  }

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  async list(
    options: QuoteListOptions,
    context: ServiceContext,
    filters?: Record<string, any>
  ): Promise<ListResult<IQuoteListItem>> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const page = options.page ?? 1;
      const limit = options.limit ?? 25;
      const sortBy = options.sort ?? 'created_at';
      const sortOrder = options.order ?? 'desc';
      const isTemplate = options.is_template ?? filters?.is_template ?? false;

      const baseQuery = trx('quotes as q')
        .where('q.tenant', context.tenant)
        .andWhere('q.is_template', isTemplate);

      if (options.status || filters?.status) {
        baseQuery.andWhere('q.status', options.status || filters?.status);
      }

      if (options.client_id || filters?.client_id) {
        baseQuery.andWhere('q.client_id', options.client_id || filters?.client_id);
      }

      if (options.search || filters?.search) {
        const term = `%${options.search || filters?.search}%`;
        baseQuery.andWhere(function (this: Knex.QueryBuilder) {
          this.whereILike('q.title', term)
            .orWhereILike('q.quote_number', term);
        });
      }

      if (options.include_client !== false) {
        baseQuery.leftJoin('clients as c', function () {
          this.on('q.client_id', '=', 'c.client_id').andOn('q.tenant', '=', 'c.tenant');
        });
      }

      const totalResult = await baseQuery.clone().count<{ count: string }>('q.quote_id as count').first();
      const total = Number(totalResult?.count ?? 0);

      const selectColumns = options.include_client !== false
        ? ['q.*', 'c.client_name']
        : ['q.*'];

      const rows = await baseQuery.clone()
        .select(...selectColumns)
        .orderBy(`q.${sortBy}`, sortOrder)
        .limit(limit)
        .offset((page - 1) * limit);

      const data: IQuoteListItem[] = rows.map((row: any) => ({
        ...row,
        display_quote_number: row.quote_number
          ? (row.version > 1 ? `${row.quote_number} v${row.version}` : row.quote_number)
          : `Draft ${row.quote_id}`,
      }));

      // Optionally include items
      if (options.include_items) {
        for (const quote of data) {
          quote.quote_items = await QuoteItem.listByQuoteId(trx, context.tenant, quote.quote_id);
        }
      }

      return { data, total };
    });
  }

  async getById(id: string, context: ServiceContext, options?: { include_items?: boolean }): Promise<IQuote | null> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      return Quote.getById(trx, context.tenant, id);
    });
  }

  async create(data: CreateQuoteApi, context: ServiceContext): Promise<IQuote> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const { items, ...quoteData } = data;

      const quote = await Quote.create(trx, context.tenant, {
        ...quoteData,
        subtotal: 0,
        discount_total: 0,
        tax: 0,
        total_amount: 0,
        created_by: context.userId,
        updated_by: context.userId,
      });

      if (items?.length) {
        for (let i = 0; i < items.length; i++) {
          // QuoteItem.create handles total_price/net_amount/tax_amount and recalculation internally
          await QuoteItem.create(trx, context.tenant, {
            ...items[i],
            billing_method: (items[i].billing_method as IQuoteItem['billing_method']) ?? null,
            service_item_kind: (items[i].service_item_kind as IQuoteItem['service_item_kind']) ?? null,
            is_selected: items[i].is_selected ?? true,
            quote_id: quote.quote_id,
            display_order: i + 1,
            created_by: context.userId,
            updated_by: context.userId,
          });
        }
      }

      return (await Quote.getById(trx, context.tenant, quote.quote_id))!;
    });
  }

  async update(id: string, data: UpdateQuoteApi, context: ServiceContext): Promise<IQuote> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const updated = await Quote.update(trx, context.tenant, id, {
        ...data,
        updated_by: context.userId,
      } as Partial<IQuote>);

      return updated;
    });
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      await Quote.delete(trx, context.tenant, id);
    });
  }

  // ============================================================================
  // Quote Items
  // ============================================================================

  async listItems(quoteId: string, context: ServiceContext): Promise<IQuoteItem[]> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      return QuoteItem.listByQuoteId(trx, context.tenant, quoteId);
    });
  }

  async addItem(quoteId: string, data: CreateQuoteItemApi, context: ServiceContext): Promise<IQuoteItem> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // QuoteItem.create handles display_order, totals, and recalculation internally
      const item = await QuoteItem.create(trx, context.tenant, {
        ...data,
        billing_method: (data.billing_method as IQuoteItem['billing_method']) ?? null,
        service_item_kind: (data.service_item_kind as IQuoteItem['service_item_kind']) ?? null,
        is_selected: data.is_selected ?? true,
        quote_id: quoteId,
        created_by: context.userId,
        updated_by: context.userId,
      });

      return item;
    });
  }

  async updateItem(quoteId: string, itemId: string, data: UpdateQuoteItemApi, context: ServiceContext): Promise<IQuoteItem> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // QuoteItem.update handles recalculation internally
      return QuoteItem.update(trx, context.tenant, itemId, {
        ...data,
        updated_by: context.userId,
      } as Partial<IQuoteItem>);
    });
  }

  async removeItem(quoteId: string, itemId: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();

    await withTransaction(knex, async (trx) => {
      // QuoteItem.delete handles reordering and recalculation internally
      await QuoteItem.delete(trx, context.tenant, itemId);
    });
  }

  async reorderItems(quoteId: string, itemIds: string[], context: ServiceContext): Promise<IQuoteItem[]> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      return QuoteItem.reorder(trx, context.tenant, quoteId, itemIds);
    });
  }

  // ============================================================================
  // Lifecycle / Workflow
  // ============================================================================

  async submitForApproval(quoteId: string, context: ServiceContext): Promise<IQuote> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      return Quote.update(trx, context.tenant, quoteId, {
        status: 'pending_approval',
        updated_by: context.userId,
      } as Partial<IQuote>);
    });
  }

  async approve(quoteId: string, context: ServiceContext): Promise<IQuote> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      return Quote.update(trx, context.tenant, quoteId, {
        status: 'approved',
        updated_by: context.userId,
      } as Partial<IQuote>);
    });
  }

  async requestChanges(quoteId: string, reason: string, context: ServiceContext): Promise<IQuote> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const quote = await Quote.update(trx, context.tenant, quoteId, {
        status: 'draft',
        updated_by: context.userId,
      } as Partial<IQuote>);

      await QuoteActivity.create(trx, context.tenant, {
        quote_id: quoteId,
        activity_type: 'changes_requested',
        description: reason,
        performed_by: context.userId,
        metadata: {},
      });

      return quote;
    });
  }

  async send(quoteId: string, data: SendQuoteApi, context: ServiceContext): Promise<IQuote> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const quote = await Quote.getById(trx, context.tenant, quoteId);
      if (!quote) {
        throw new Error(`Quote ${quoteId} not found`);
      }

      const updated = await Quote.update(trx, context.tenant, quoteId, {
        status: 'sent',
        sent_at: new Date().toISOString(),
        updated_by: context.userId,
      } as Partial<IQuote>);

      return updated;
    });
  }

  async sendReminder(quoteId: string, context: ServiceContext): Promise<IQuote> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const quote = await Quote.getById(trx, context.tenant, quoteId);
      if (!quote) {
        throw new Error(`Quote ${quoteId} not found`);
      }

      await QuoteActivity.create(trx, context.tenant, {
        quote_id: quoteId,
        activity_type: 'reminder_sent',
        description: 'Quote reminder sent',
        performed_by: context.userId,
        metadata: {},
      });

      return quote;
    });
  }

  // ============================================================================
  // Conversion
  // ============================================================================

  async getConversionPreview(quoteId: string, context: ServiceContext): Promise<QuoteConversionPreview> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const quote = await Quote.getById(trx, context.tenant, quoteId);
      if (!quote) throw new Error(`Quote ${quoteId} not found`);
      return buildQuoteConversionPreview(quote);
    });
  }

  async convert(quoteId: string, data: ConvertQuoteApi, context: ServiceContext): Promise<{ contract_id?: string; invoice_id?: string }> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      switch (data.conversion_type) {
        case 'contract': {
          const result = await convertQuoteToDraftContract(trx, context.tenant, quoteId, context.userId);
          return { contract_id: result.contract.contract_id };
        }
        case 'invoice': {
          const result = await convertQuoteToDraftInvoice(trx, context.tenant, quoteId, context.userId);
          return { invoice_id: result.invoice.invoice_id };
        }
        case 'both': {
          const result = await convertQuoteToDraftContractAndInvoice(trx, context.tenant, quoteId, context.userId);
          return { contract_id: result.contract.contract_id, invoice_id: result.invoice.invoice_id };
        }
      }
    });
  }

  // ============================================================================
  // Versioning
  // ============================================================================

  async createRevision(quoteId: string, context: ServiceContext): Promise<IQuote> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      return Quote.createRevision(trx, context.tenant, quoteId, context.userId);
    });
  }

  async listVersions(quoteId: string, context: ServiceContext): Promise<IQuote[]> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      return Quote.listVersions(trx, context.tenant, quoteId);
    });
  }

  // ============================================================================
  // Activities
  // ============================================================================

  async listActivities(quoteId: string, context: ServiceContext): Promise<any[]> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      return QuoteActivity.listByQuoteId(trx, context.tenant, quoteId);
    });
  }
}
