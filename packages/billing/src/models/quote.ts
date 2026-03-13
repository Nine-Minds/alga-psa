import type { Knex } from 'knex';
import type { IQuote, IQuoteListItem, IQuoteWithClient, PaginatedResult, QuoteStatus } from '@alga-psa/types';
import { SharedNumberingService } from '@shared/services/numberingService';
import { deleteEntityWithValidation } from '@alga-psa/core';
import QuoteItem from './quoteItem';
import QuoteActivity from './quoteActivity';
import { canTransitionQuoteStatus } from '../schemas/quoteSchemas';

export interface QuoteListOptions {
  page?: number;
  pageSize?: number;
  status?: QuoteStatus;
  client_id?: string;
  sortBy?: 'quote_date' | 'total_amount' | 'status' | 'created_at';
  sortOrder?: 'asc' | 'desc';
  is_template?: boolean;
}

function getTodayStart(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function isExpiredOnAccess(quote: Pick<IQuote, 'status' | 'valid_until'>): boolean {
  if (quote.status !== 'sent' || !quote.valid_until) {
    return false;
  }

  return new Date(quote.valid_until) < getTodayStart();
}

async function expireQuoteIfNeeded(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quote: IQuote | null
): Promise<IQuote | null> {
  if (!quote || !isExpiredOnAccess(quote)) {
    return quote;
  }

  const [expiredQuote] = await knexOrTrx('quotes')
    .where({ tenant, quote_id: quote.quote_id })
    .update({
      status: 'expired',
      expired_at: knexOrTrx.fn.now(),
      updated_at: knexOrTrx.fn.now()
    })
    .returning('*');

  await QuoteActivity.create(knexOrTrx, tenant, {
    quote_id: quote.quote_id,
    activity_type: 'expired',
    description: 'Quote automatically expired on access',
    performed_by: null,
    metadata: { previous_status: quote.status }
  });

  return expiredQuote;
}

async function mapQuoteRecord(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quote: IQuote | null
): Promise<IQuote | null> {
  const resolvedQuote = await expireQuoteIfNeeded(knexOrTrx, tenant, quote);
  if (!resolvedQuote) {
    return null;
  }

  resolvedQuote.quote_items = await QuoteItem.listByQuoteId(knexOrTrx, tenant, resolvedQuote.quote_id);
  return resolvedQuote;
}

const Quote = {
  async getById(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quoteId: string
  ): Promise<IQuote | null> {
    if (!tenant) {
      throw new Error('Tenant context is required for getting quote');
    }

    const quote = await knexOrTrx('quotes')
      .where({ tenant, quote_id: quoteId })
      .first();

    return mapQuoteRecord(knexOrTrx, tenant, quote ?? null);
  },

  async getByNumber(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quoteNumber: string
  ): Promise<IQuote | null> {
    if (!tenant) {
      throw new Error('Tenant context is required for getting quote by number');
    }

    const quote = await knexOrTrx('quotes')
      .where({ tenant, quote_number: quoteNumber })
      .first();

    return mapQuoteRecord(knexOrTrx, tenant, quote ?? null);
  },

  async listByTenant(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    options: QuoteListOptions = {}
  ): Promise<PaginatedResult<IQuoteListItem>> {
    if (!tenant) {
      throw new Error('Tenant context is required for listing quotes');
    }

    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 25;
    const sortBy = options.sortBy ?? 'quote_date';
    const sortOrder = options.sortOrder ?? 'desc';

    const baseQuery = knexOrTrx('quotes as q')
      .leftJoin('clients as c', function joinClients() {
        this.on('q.client_id', '=', 'c.client_id').andOn('q.tenant', '=', 'c.tenant');
      })
      .where('q.tenant', tenant)
      .andWhere('q.is_template', options.is_template ?? false);

    if (options.status) {
      baseQuery.andWhere('q.status', options.status);
    }

    if (options.client_id) {
      baseQuery.andWhere('q.client_id', options.client_id);
    }

    const totalResult = await baseQuery.clone().count<{ count: string }>('q.quote_id as count').first();
    const total = Number(totalResult?.count ?? 0);
    const totalPages = Math.ceil(total / pageSize) || 1;

    const rows = await baseQuery.clone()
      .select('q.*', 'c.client_name')
      .orderBy(`q.${sortBy}`, sortOrder)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const data = rows.map((row) => ({
      ...row,
      display_quote_number: row.quote_number ?? `Draft ${row.quote_id}`
    })) as IQuoteListItem[];

    return {
      data,
      total,
      page,
      pageSize,
      totalPages
    };
  },

  async listByClient(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    clientId: string
  ): Promise<IQuoteWithClient[]> {
    if (!tenant) {
      throw new Error('Tenant context is required for listing client quotes');
    }

    return knexOrTrx('quotes as q')
      .leftJoin('clients as c', function joinClients() {
        this.on('q.client_id', '=', 'c.client_id').andOn('q.tenant', '=', 'c.tenant');
      })
      .where({ 'q.tenant': tenant, 'q.client_id': clientId, 'q.is_template': false })
      .select('q.*', 'c.client_name')
      .orderBy('q.quote_date', 'desc') as Promise<IQuoteWithClient[]>;
  },

  async create(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quote: Omit<IQuote, 'quote_id' | 'tenant' | 'quote_number' | 'quote_items' | 'quote_activities' | 'created_at' | 'updated_at' | 'status' | 'version'> & Partial<Pick<IQuote, 'status' | 'version'>>
  ): Promise<IQuote> {
    if (!tenant) {
      throw new Error('Tenant context is required for creating quote');
    }

    const quoteNumber = quote.is_template
      ? null
      : await SharedNumberingService.getNextNumber('QUOTE', { knex: knexOrTrx, tenant });

    const [createdQuote] = await knexOrTrx('quotes')
      .insert({
        tenant,
        ...quote,
        quote_number: quoteNumber,
        status: quote.is_template ? null : (quote.status ?? 'draft'),
        version: quote.version ?? 1,
      })
      .returning('*');

    await QuoteActivity.create(knexOrTrx, tenant, {
      quote_id: createdQuote.quote_id,
      activity_type: 'created',
      description: quote.is_template ? 'Quote template created' : 'Quote created',
      performed_by: createdQuote.created_by ?? null,
      metadata: { is_template: createdQuote.is_template }
    });

    return createdQuote;
  },

  async update(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quoteId: string,
    updateData: Partial<IQuote>
  ): Promise<IQuote> {
    if (!tenant) {
      throw new Error('Tenant context is required for updating quote');
    }

    const existingQuote = await knexOrTrx('quotes')
      .where({ tenant, quote_id: quoteId })
      .first();

    if (!existingQuote) {
      throw new Error(`Quote ${quoteId} not found in tenant ${tenant}`);
    }

    if (existingQuote.is_template && updateData.status !== undefined && updateData.status !== null) {
      throw new Error('Quote templates do not participate in status transitions');
    }

    if (updateData.status && existingQuote.status && !canTransitionQuoteStatus(existingQuote.status, updateData.status)) {
      throw new Error(`Invalid quote status transition from ${existingQuote.status} to ${updateData.status}`);
    }

    const [updatedQuote] = await knexOrTrx('quotes')
      .where({ tenant, quote_id: quoteId })
      .update({ ...updateData, updated_at: knexOrTrx.fn.now() })
      .returning('*');

    await QuoteActivity.create(knexOrTrx, tenant, {
      quote_id: quoteId,
      activity_type: updateData.status && updateData.status !== existingQuote.status ? 'status_changed' : 'updated',
      description: updateData.status && updateData.status !== existingQuote.status
        ? `Quote status changed from ${existingQuote.status} to ${updateData.status}`
        : 'Quote updated',
      performed_by: updatedQuote.updated_by ?? null,
      metadata: updateData.status && updateData.status !== existingQuote.status
        ? { previous_status: existingQuote.status, next_status: updateData.status }
        : {}
    });

    return updatedQuote;
  },

  async delete(
    knexOrTrx: Knex,
    tenant: string,
    quoteId: string
  ) {
    if (!tenant) {
      throw new Error('Tenant context is required for deleting quote');
    }

    return deleteEntityWithValidation('quote', quoteId, knexOrTrx, tenant, async (trx, tenantId) => {
      await trx('quotes')
        .where({ tenant: tenantId, quote_id: quoteId })
        .del();
    });
  }
};

export default Quote;
