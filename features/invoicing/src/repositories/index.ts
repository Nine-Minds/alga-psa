/**
 * Invoice repository - data access layer for invoices
 *
 * This repository provides database operations for invoices and invoice items.
 * It uses the @alga-psa/database package for connection management.
 */

import type { Knex } from 'knex';
import type {
  Invoice,
  InvoiceItem,
  InvoiceFilters,
  InvoiceListResponse,
  InvoiceWithItems,
  CreateInvoiceItemInput,
  InvoiceStatus,
} from '../types/index.js';

const INVOICES_TABLE = 'invoices';
const INVOICE_ITEMS_TABLE = 'invoice_items';

/**
 * Create the invoice repository with database connection
 */
export function createInvoiceRepository(knex: Knex) {
  return {
    /**
     * Find an invoice by ID
     */
    async findById(
      tenantId: string,
      invoiceId: string
    ): Promise<Invoice | null> {
      const result = await knex(INVOICES_TABLE)
        .where({ tenant: tenantId, invoice_id: invoiceId })
        .first();
      return result || null;
    },

    /**
     * Find an invoice with its items
     */
    async findByIdWithItems(
      tenantId: string,
      invoiceId: string
    ): Promise<InvoiceWithItems | null> {
      const invoice = await this.findById(tenantId, invoiceId);
      if (!invoice) {
        return null;
      }

      const items = await knex(INVOICE_ITEMS_TABLE)
        .where({ tenant: tenantId, invoice_id: invoiceId })
        .orderBy('created_at', 'asc');

      return {
        ...invoice,
        items,
      };
    },

    /**
     * Find invoices matching filters
     */
    async findMany(
      tenantId: string,
      filters: InvoiceFilters = {}
    ): Promise<InvoiceListResponse> {
      const {
        search,
        client_id,
        status,
        from_date,
        to_date,
        is_manual,
        billing_cycle_id,
        limit = 50,
        offset = 0,
        orderBy = 'invoice_date',
        orderDirection = 'desc',
      } = filters;

      let query = knex(INVOICES_TABLE).where({ tenant: tenantId });

      // Apply search filter
      if (search) {
        query = query.where((builder) => {
          builder
            .whereILike('invoice_number', `%${search}%`)
            .orWhere((subBuilder) => {
              subBuilder
                .join('companies', 'invoices.client_id', 'companies.company_id')
                .whereILike('companies.company_name', `%${search}%`);
            });
        });
      }

      // Apply client filter
      if (client_id) {
        query = query.where({ client_id });
      }

      // Apply status filter
      if (status) {
        if (Array.isArray(status)) {
          query = query.whereIn('status', status);
        } else {
          query = query.where({ status });
        }
      }

      // Apply date range filters
      if (from_date) {
        query = query.where('invoice_date', '>=', from_date);
      }
      if (to_date) {
        query = query.where('invoice_date', '<=', to_date);
      }

      // Apply manual filter
      if (is_manual !== undefined) {
        query = query.where({ is_manual });
      }

      // Apply billing cycle filter
      if (billing_cycle_id) {
        query = query.where({ billing_cycle_id });
      }

      // Get total count
      const countResult = await query.clone().count('* as count').first();
      const total = Number(countResult?.count || 0);

      // Apply ordering and pagination
      const invoices = await query
        .orderBy(orderBy, orderDirection)
        .limit(limit)
        .offset(offset);

      return { invoices, total, limit, offset };
    },

    /**
     * Create a new invoice
     */
    async create(
      tenantId: string,
      invoiceData: Partial<Invoice>
    ): Promise<Invoice> {
      const [invoice] = await knex(INVOICES_TABLE)
        .insert({
          ...invoiceData,
          tenant: tenantId,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');

      return invoice;
    },

    /**
     * Update an existing invoice
     */
    async update(
      tenantId: string,
      invoiceId: string,
      updateData: Partial<Invoice>
    ): Promise<Invoice | null> {
      const [invoice] = await knex(INVOICES_TABLE)
        .where({ tenant: tenantId, invoice_id: invoiceId })
        .update({
          ...updateData,
          updated_at: new Date(),
        })
        .returning('*');

      return invoice || null;
    },

    /**
     * Delete an invoice (soft delete by marking as cancelled)
     */
    async delete(tenantId: string, invoiceId: string): Promise<boolean> {
      const result = await knex(INVOICES_TABLE)
        .where({ tenant: tenantId, invoice_id: invoiceId })
        .update({
          status: 'cancelled' as InvoiceStatus,
          updated_at: new Date(),
        });

      return result > 0;
    },

    /**
     * Hard delete an invoice (permanent)
     */
    async hardDelete(tenantId: string, invoiceId: string): Promise<boolean> {
      // Delete items first
      await knex(INVOICE_ITEMS_TABLE)
        .where({ tenant: tenantId, invoice_id: invoiceId })
        .delete();

      const result = await knex(INVOICES_TABLE)
        .where({ tenant: tenantId, invoice_id: invoiceId })
        .delete();

      return result > 0;
    },

    /**
     * Add items to an invoice
     */
    async addItems(
      tenantId: string,
      invoiceId: string,
      items: CreateInvoiceItemInput[],
      userId?: string
    ): Promise<InvoiceItem[]> {
      const itemsToInsert = items.map((item) => ({
        ...item,
        invoice_id: invoiceId,
        tenant: tenantId,
        is_manual: true,
        total_price: item.quantity * item.unit_price,
        net_amount: item.quantity * item.unit_price,
        tax_amount: 0, // Tax will be calculated separately
        created_by: userId,
        updated_by: userId,
        created_at: new Date(),
        updated_at: new Date(),
      }));

      const insertedItems = await knex(INVOICE_ITEMS_TABLE)
        .insert(itemsToInsert)
        .returning('*');

      return insertedItems;
    },

    /**
     * Update invoice totals
     */
    async updateTotals(
      tenantId: string,
      invoiceId: string,
      totals: {
        subtotal: number;
        tax: number;
        total_amount: number;
      }
    ): Promise<Invoice | null> {
      return this.update(tenantId, invoiceId, totals);
    },

    /**
     * Finalize an invoice
     */
    async finalize(
      tenantId: string,
      invoiceId: string
    ): Promise<Invoice | null> {
      return this.update(tenantId, invoiceId, {
        status: 'sent' as InvoiceStatus,
        finalized_at: new Date().toISOString(),
      });
    },

    /**
     * Get invoice items
     */
    async getItems(
      tenantId: string,
      invoiceId: string
    ): Promise<InvoiceItem[]> {
      return knex(INVOICE_ITEMS_TABLE)
        .where({ tenant: tenantId, invoice_id: invoiceId })
        .orderBy('created_at', 'asc');
    },

    /**
     * Delete an invoice item
     */
    async deleteItem(
      tenantId: string,
      itemId: string
    ): Promise<boolean> {
      const result = await knex(INVOICE_ITEMS_TABLE)
        .where({ tenant: tenantId, item_id: itemId })
        .delete();

      return result > 0;
    },
  };
}

// Default export for convenience when used with dependency injection
export const invoiceRepository = {
  create: createInvoiceRepository,
};
