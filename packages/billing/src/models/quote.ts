import type { Knex } from 'knex';
import type { IQuote, IQuoteListItem, IQuoteWithClient, PaginatedResult, QuoteStatus } from '@alga-psa/types';
import { SharedNumberingService } from '@shared/services/numberingService';
import { deleteEntityWithValidation } from '@alga-psa/core';
import QuoteItem from './quoteItem';
import QuoteActivity from './quoteActivity';
import { canTransitionQuoteStatus } from '../schemas/quoteSchemas';
import { recalculateQuoteFinancials } from '../services/quoteCalculationService';

function formatDisplayQuoteNumber(quote: Pick<IQuote, 'quote_number' | 'quote_id' | 'version'>): string {
  const baseNumber = quote.quote_number ?? `Draft ${quote.quote_id}`;
  return quote.version && quote.version > 1 ? `${baseNumber} v${quote.version}` : baseNumber;
}

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
  resolvedQuote.quote_activities = await QuoteActivity.listByQuoteId(knexOrTrx, tenant, resolvedQuote.quote_id);
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
      display_quote_number: formatDisplayQuoteNumber(row)
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

    if (!updatedQuote.is_template) {
      await recalculateQuoteFinancials(knexOrTrx, tenant, quoteId);
      const recalculatedQuote = await knexOrTrx('quotes')
        .where({ tenant, quote_id: quoteId })
        .first();
      return recalculatedQuote ?? updatedQuote;
    }

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
  },

  async createRevision(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quoteId: string,
    performedBy?: string | null
  ): Promise<IQuote> {
    if (!tenant) {
      throw new Error('Tenant context is required for revising quote');
    }

    const sourceQuote = await Quote.getById(knexOrTrx, tenant, quoteId);
    if (!sourceQuote) {
      throw new Error(`Quote ${quoteId} not found in tenant ${tenant}`);
    }

    if (sourceQuote.is_template) {
      throw new Error('Quote templates cannot be revised');
    }

    if (!sourceQuote.status || !['sent', 'rejected'].includes(sourceQuote.status)) {
      throw new Error('Only sent or rejected quotes can be revised');
    }

    const rootQuoteId = sourceQuote.parent_quote_id ?? sourceQuote.quote_id;
    const versionRows = await knexOrTrx('quotes')
      .where({ tenant })
      .andWhere((builder) => {
        builder.where('quote_id', rootQuoteId).orWhere('parent_quote_id', rootQuoteId);
      })
      .select('version');

    const nextVersion = Math.max(sourceQuote.version, ...versionRows.map((row) => Number(row.version ?? 0))) + 1;

    const [revisedQuote] = await knexOrTrx('quotes')
      .insert({
        tenant,
        client_id: sourceQuote.client_id ?? null,
        contact_id: sourceQuote.contact_id ?? null,
        title: sourceQuote.title,
        description: sourceQuote.description ?? null,
        quote_date: sourceQuote.quote_date ?? null,
        valid_until: sourceQuote.valid_until ?? null,
        status: 'draft',
        version: nextVersion,
        parent_quote_id: rootQuoteId,
        po_number: sourceQuote.po_number ?? null,
        subtotal: 0,
        discount_total: 0,
        tax: 0,
        total_amount: 0,
        currency_code: sourceQuote.currency_code,
        tax_source: sourceQuote.tax_source ?? 'internal',
        internal_notes: sourceQuote.internal_notes ?? null,
        client_notes: sourceQuote.client_notes ?? null,
        terms_and_conditions: sourceQuote.terms_and_conditions ?? null,
        is_template: false,
        template_id: sourceQuote.template_id ?? null,
        quote_number: sourceQuote.quote_number,
        created_by: performedBy ?? sourceQuote.updated_by ?? sourceQuote.created_by ?? null,
        updated_by: performedBy ?? sourceQuote.updated_by ?? sourceQuote.created_by ?? null,
      })
      .returning('*');

    for (const item of sourceQuote.quote_items ?? []) {
      const { quote_item_id, tenant: _itemTenant, created_at, updated_at, ...itemData } = item;
      await knexOrTrx('quote_items')
        .insert({
          tenant,
          ...itemData,
          quote_id: revisedQuote.quote_id,
        });
    }

    await knexOrTrx('quotes')
      .where({ tenant, quote_id: sourceQuote.quote_id })
      .update({
        status: 'superseded',
        updated_at: knexOrTrx.fn.now(),
        updated_by: performedBy ?? sourceQuote.updated_by ?? sourceQuote.created_by ?? null,
      });

    await QuoteActivity.create(knexOrTrx, tenant, {
      quote_id: sourceQuote.quote_id,
      activity_type: 'superseded',
      description: `Quote superseded by version ${nextVersion}`,
      performed_by: performedBy ?? null,
      metadata: { next_version: nextVersion, revised_quote_id: revisedQuote.quote_id }
    });

    await QuoteActivity.create(knexOrTrx, tenant, {
      quote_id: revisedQuote.quote_id,
      activity_type: 'created_revision',
      description: `Quote revision created from version ${sourceQuote.version}`,
      performed_by: performedBy ?? null,
      metadata: { source_quote_id: sourceQuote.quote_id, source_version: sourceQuote.version }
    });

    await recalculateQuoteFinancials(knexOrTrx, tenant, revisedQuote.quote_id);

    return await Quote.getById(knexOrTrx, tenant, revisedQuote.quote_id) as IQuote;
  },

  async listVersions(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    quoteId: string
  ): Promise<IQuote[]> {
    if (!tenant) {
      throw new Error('Tenant context is required for listing quote versions');
    }

    const sourceQuote = await knexOrTrx('quotes')
      .where({ tenant, quote_id: quoteId })
      .first();

    if (!sourceQuote) {
      throw new Error(`Quote ${quoteId} not found in tenant ${tenant}`);
    }

    const rootQuoteId = sourceQuote.parent_quote_id ?? sourceQuote.quote_id;
    const versions = await knexOrTrx('quotes')
      .where({ tenant })
      .andWhere((builder) => {
        builder.where('quote_id', rootQuoteId).orWhere('parent_quote_id', rootQuoteId);
      })
      .orderBy('version', 'asc');

    return Promise.all(versions.map((version) => mapQuoteRecord(knexOrTrx, tenant, version))) as Promise<IQuote[]>;
  }
};

export default Quote;
