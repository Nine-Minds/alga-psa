// @ts-nocheck
// TODO: Invoice model missing getFullInvoiceById method, argument count issues
'use server';

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';
import {
  IInvoice,
  InvoiceViewModel,
  IInvoiceCharge
} from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { toPlainDate } from '@alga-psa/core';
import Invoice from '@alga-psa/billing/models/invoice';
import { getClientContractPurchaseOrderContext, getPurchaseOrderConsumedCents } from '@alga-psa/billing/services/purchaseOrderService';
import { withAuth } from '@alga-psa/auth';

// Types for paginated invoice fetching
export interface FetchInvoicesOptions {
  page?: number;
  pageSize?: number;
  searchTerm?: string;
  status?: 'draft' | 'finalized' | 'all';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedInvoicesResult {
  invoices: InvoiceViewModel[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Helper function to create basic invoice view model
async function getBasicInvoiceViewModel(invoice: IInvoice, client: any): Promise<InvoiceViewModel> {
  // Debug the invoice data, especially for the problematic invoice
  if (invoice.invoice_id === '758752dd-9aa4-43cb-945e-7232903f6615') {
    console.log('Processing problematic invoice:', {
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number,
      total_amount: invoice.total_amount,
      total_amount_type: typeof invoice.total_amount,
      subtotal: invoice.subtotal,
      tax: invoice.tax
    });
  }
  
  // Ensure total_amount is properly converted to a number
  const totalAmount = Number(invoice.total_amount);
  
  return {
    invoice_id: invoice.invoice_id,
    invoice_number: invoice.invoice_number,
    client_id: invoice.client_id,
    po_number: invoice.po_number ?? null,
    client_contract_id: invoice.client_contract_id ?? null,
    client: {
      name: client.client_name,
      logo: client.logo || '',
      address: client.address || ''
    },
    contact: {
      name: '',  // Contact info not stored in invoice
      address: ''
    },
    invoice_date: typeof invoice.invoice_date === 'string' ? toPlainDate(invoice.invoice_date) : invoice.invoice_date,
    due_date: typeof invoice.due_date === 'string' ? toPlainDate(invoice.due_date) : invoice.due_date,
    status: invoice.status,
    subtotal: Number(invoice.subtotal),
    tax: Number(invoice.tax),
    total: totalAmount, // Ensure it's a number
    total_amount: totalAmount, // Ensure it's a number
    credit_applied: Number(invoice.credit_applied || 0),
    is_manual: invoice.is_manual,
    finalized_at: invoice.finalized_at ? (typeof invoice.finalized_at === 'string' ? toPlainDate(invoice.finalized_at) : invoice.finalized_at) : undefined,
    invoice_charges: [], // Empty array initially
    currencyCode: invoice.currency_code || 'USD'
  };
}

/**
 * Fetch invoices with server-side pagination and search
 */
export const fetchInvoicesPaginated = withAuth(async (
  user,
  { tenant },
  options: FetchInvoicesOptions = {}
): Promise<PaginatedInvoicesResult> => {
  const {
    page = 1,
    pageSize = 10,
    searchTerm = '',
    status = 'all',
    sortBy = 'invoice_date',
    sortOrder = 'desc'
  } = options;

  try {
    console.log(`Fetching paginated invoices: page=${page}, pageSize=${pageSize}, status=${status}, search="${searchTerm}"`);

    const { knex } = await createTenantKnex();

    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Build base query for counting and fetching
      const buildBaseQuery = () => {
        const query = trx('invoices')
          .join('clients', function () {
            this.on('invoices.client_id', '=', 'clients.client_id')
              .andOn('invoices.tenant', '=', 'clients.tenant');
          })
          .where('invoices.tenant', tenant);

        // Apply status filter
        if (status === 'draft') {
          query.whereNull('invoices.finalized_at').andWhere('invoices.status', 'draft');
        } else if (status === 'finalized') {
          query.where(function() {
            this.whereNotNull('invoices.finalized_at').orWhereNot('invoices.status', 'draft');
          });
        }

        // Apply search filter
        if (searchTerm.trim()) {
          const searchPattern = `%${searchTerm.trim().toLowerCase()}%`;
          query.where(function() {
            this.whereRaw('LOWER(invoices.invoice_number) LIKE ?', [searchPattern])
              .orWhereRaw('LOWER(clients.client_name) LIKE ?', [searchPattern]);
          });
        }

        return query;
      };

      // Get total count first
      const countQuery = buildBaseQuery().count('invoices.invoice_id as count').first();
      const countResult = await countQuery;
      const total = parseInt(String(countResult?.count || '0'), 10);

      // If no results, return early
      if (total === 0) {
        return {
          invoices: [],
          total: 0,
          page,
          pageSize,
          totalPages: 0
        };
      }

      // Calculate offset
      const offset = (page - 1) * pageSize;
      const totalPages = Math.ceil(total / pageSize);

      // Build data query with pagination
      // Use a subquery to get distinct invoice IDs first, then join for full data
      const invoiceIdsQuery = trx('invoices')
        .join('clients', function () {
          this.on('invoices.client_id', '=', 'clients.client_id')
            .andOn('invoices.tenant', '=', 'clients.tenant');
        })
        .where('invoices.tenant', tenant)
        .select('invoices.invoice_id');

      // Apply status filter to subquery
      if (status === 'draft') {
        invoiceIdsQuery.whereNull('invoices.finalized_at').andWhere('invoices.status', 'draft');
      } else if (status === 'finalized') {
        invoiceIdsQuery.where(function() {
          this.whereNotNull('invoices.finalized_at').orWhereNot('invoices.status', 'draft');
        });
      }

      // Apply search filter to subquery
      if (searchTerm.trim()) {
        const searchPattern = `%${searchTerm.trim().toLowerCase()}%`;
        invoiceIdsQuery.where(function() {
          this.whereRaw('LOWER(invoices.invoice_number) LIKE ?', [searchPattern])
            .orWhereRaw('LOWER(clients.client_name) LIKE ?', [searchPattern]);
        });
      }

      // Apply sorting and pagination to get distinct invoice IDs
      const validSortColumns: Record<string, string> = {
        'invoice_date': 'invoices.invoice_date',
        'invoice_number': 'invoices.invoice_number',
        'total_amount': 'invoices.total_amount',
        'finalized_at': 'invoices.finalized_at',
        'due_date': 'invoices.due_date'
      };
      const sortColumn = validSortColumns[sortBy] || 'invoices.invoice_date';

      invoiceIdsQuery
        .orderBy(sortColumn, sortOrder)
        .limit(pageSize)
        .offset(offset);

      const invoiceIds = await invoiceIdsQuery;
      const ids = invoiceIds.map(row => row.invoice_id);

      if (ids.length === 0) {
        return {
          invoices: [],
          total,
          page,
          pageSize,
          totalPages
        };
      }

      // Now fetch full invoice data for the paginated IDs
      // IMPORTANT: Always include tenant filter for defense-in-depth security
      const invoices = await trx('invoices')
        .join('clients', function () {
          this.on('invoices.client_id', '=', 'clients.client_id')
            .andOn('invoices.tenant', '=', 'clients.tenant');
        })
        .leftJoin('client_locations', function () {
          this.on('clients.client_id', '=', 'client_locations.client_id')
            .andOn('clients.tenant', '=', 'client_locations.tenant')
            .andOn(function() {
              this.on('client_locations.is_billing_address', '=', trx.raw('true'))
                  .orOn('client_locations.is_default', '=', trx.raw('true'));
            });
        })
        .where('invoices.tenant', tenant)
        .whereIn('invoices.invoice_id', ids)
        .select(
          'invoices.invoice_id',
          'invoices.client_id',
          'invoices.invoice_number',
          'invoices.po_number',
          'invoices.client_contract_id',
          'invoices.invoice_date',
          'invoices.due_date',
          'invoices.status',
          'invoices.is_manual',
          'invoices.finalized_at',
          'invoices.billing_cycle_id',
          'invoices.currency_code',
          trx.raw('CAST(invoices.subtotal AS BIGINT) as subtotal'),
          trx.raw('CAST(invoices.tax AS BIGINT) as tax'),
          trx.raw('CAST(invoices.total_amount AS BIGINT) as total_amount'),
          trx.raw('CAST(invoices.credit_applied AS BIGINT) as credit_applied'),
          'clients.client_name',
          'clients.properties',
          'client_locations.address_line1',
          'client_locations.address_line2',
          'client_locations.city',
          'client_locations.state_province',
          'client_locations.postal_code',
          'client_locations.country_name',
          'client_locations.is_billing_address'
        )
        .orderBy([
          { column: 'invoices.invoice_id' },
          { column: 'client_locations.is_billing_address', order: 'desc', nulls: 'last' },
          { column: 'client_locations.is_default', order: 'desc', nulls: 'last' }
        ]);

      // Deduplicate by invoice_id (take first row per invoice which has best location)
      const seenIds = new Set<string>();
      const uniqueInvoices = invoices.filter(inv => {
        if (seenIds.has(inv.invoice_id)) return false;
        seenIds.add(inv.invoice_id);
        return true;
      });

      // Re-sort by the requested sort order after deduplication
      uniqueInvoices.sort((a, b) => {
        const aVal = a[sortBy] || a['invoice_date'];
        const bVal = b[sortBy] || b['invoice_date'];
        if (sortOrder === 'asc') {
          return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        }
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      });

      // Map to view models
      const invoiceViewModels = await Promise.all(uniqueInvoices.map(invoice => {
        const clientProperties = invoice.properties as { logo?: string } || {};

        // Format location address
        const addressParts: string[] = [];
        if (invoice.address_line1) addressParts.push(invoice.address_line1);
        if (invoice.address_line2) addressParts.push(invoice.address_line2);
        if (invoice.city || invoice.state_province || invoice.postal_code) {
          const cityStateZip = [invoice.city, invoice.state_province, invoice.postal_code].filter(Boolean).join(', ');
          addressParts.push(cityStateZip);
        }
        if (invoice.country_name) addressParts.push(invoice.country_name);

        return getBasicInvoiceViewModel(invoice, {
          client_name: invoice.client_name,
          logo: clientProperties.logo || '',
          address: addressParts.join(', ') || ''
        });
      }));

      return {
        invoices: invoiceViewModels,
        total,
        page,
        pageSize,
        totalPages
      };
    });

    console.log(`Fetched ${result.invoices.length} invoices (page ${page}/${result.totalPages}, total: ${result.total})`);
    return result;
  } catch (error) {
    console.error('Error fetching paginated invoices:', error);
    throw new Error('Error fetching paginated invoices');
  }
});

/**
 * Fetch invoices for a specific client
 * @param clientId The ID of the client to fetch invoices for
 * @returns Array of invoice view models
 */
export const fetchInvoicesByClient = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<InvoiceViewModel[]> => {
  try {
    console.log(`Fetching invoices for client: ${clientId}`);

    const { knex } = await createTenantKnex();
    
    // Get invoices with client info and location data in a single query, filtered by client_id
    const invoices = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .join('clients', function() {
          this.on('invoices.client_id', '=', 'clients.client_id')
              .andOn('invoices.tenant', '=', 'clients.tenant');
        })
        .leftJoin('client_locations', function () {
          this.on('clients.client_id', '=', 'client_locations.client_id')
            .andOn('clients.tenant', '=', 'client_locations.tenant')
            .andOn(function() {
              this.on('client_locations.is_billing_address', '=', trx.raw('true'))
                  .orOn('client_locations.is_default', '=', trx.raw('true'));
            });
        })
        .where({
          'invoices.client_id': clientId,
          'invoices.tenant': tenant
        })
        .select(
          'invoices.invoice_id',
          'invoices.client_id',
          'invoices.invoice_number',
          'invoices.invoice_date',
          'invoices.due_date',
          'invoices.status',
          'invoices.is_manual',
          'invoices.finalized_at',
          'invoices.billing_cycle_id',
          'invoices.currency_code',
          trx.raw('CAST(invoices.subtotal AS BIGINT) as subtotal'),
          trx.raw('CAST(invoices.tax AS BIGINT) as tax'),
          trx.raw('CAST(invoices.total_amount AS BIGINT) as total_amount'),
          trx.raw('CAST(invoices.credit_applied AS BIGINT) as credit_applied'),
          'clients.client_name',
          'clients.properties',
          // Location fields
          'client_locations.address_line1',
          'client_locations.address_line2',
          'client_locations.city',
          'client_locations.state_province',
          'client_locations.postal_code',
          'client_locations.country_name',
          'client_locations.is_billing_address'
        )
        .orderBy([
          { column: 'invoices.invoice_id' },
          { column: 'client_locations.is_billing_address', order: 'desc', nulls: 'last' },
          { column: 'client_locations.is_default', order: 'desc', nulls: 'last' }
        ]);
    });

    console.log(`Got ${invoices.length} invoices for client ${clientId}`);

    // Map to view models without line items
    return Promise.all(invoices.map(invoice => {
      const clientProperties = invoice.properties as { logo?: string } || {};
      
      // Format location address
      const addressParts: string[] = [];
      if (invoice.address_line1) addressParts.push(invoice.address_line1);
      if (invoice.address_line2) addressParts.push(invoice.address_line2);
      if (invoice.city || invoice.state_province || invoice.postal_code) {
        const cityStateZip = [invoice.city, invoice.state_province, invoice.postal_code].filter(Boolean).join(', ');
        addressParts.push(cityStateZip);
      }
      if (invoice.country_name) addressParts.push(invoice.country_name);
      
      return getBasicInvoiceViewModel(invoice, {
        client_name: invoice.client_name,
        logo: clientProperties.logo || '',
        address: addressParts.join(', ') || ''
      });
    }));
  } catch (error) {
    console.error(`Error fetching invoices for client ${clientId}:`, error);
    throw new Error('Error fetching client invoices');
  }
});

export const getInvoiceForRendering = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<InvoiceViewModel> => {
  try {
    console.log('Fetching full invoice details for rendering:', invoiceId);

    const { knex } = await createTenantKnex();

    return Invoice.getFullInvoiceById(knex, invoiceId);
  } catch (error) {
    console.error('Error fetching invoice for rendering:', error);
    throw new Error('Error fetching invoice for rendering');
  }
});

export type InvoicePurchaseOrderSummary = {
  invoice_id: string;
  client_contract_id: string;
  po_number: string | null;
  po_amount_cents: number | null;
  consumed_cents: number | null;
  remaining_cents: number | null;
};

export const getInvoicePurchaseOrderSummary = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<InvoicePurchaseOrderSummary | null> => {
  const { knex } = await createTenantKnex();

  const invoice = await knex('invoices')
    .where({ tenant, invoice_id: invoiceId })
    .select('invoice_id', 'client_contract_id', 'po_number')
    .first();

  const clientContractId = invoice?.client_contract_id ?? null;
  if (!invoice || !clientContractId) {
    return null;
  }

  const poContext = await getClientContractPurchaseOrderContext({
    knex,
    tenant,
    clientContractId,
  });

  if (poContext.po_amount == null) {
    return {
      invoice_id: invoice.invoice_id,
      client_contract_id: clientContractId,
      po_number: invoice.po_number ?? poContext.po_number,
      po_amount_cents: null,
      consumed_cents: null,
      remaining_cents: null,
    };
  }

  const consumed = await getPurchaseOrderConsumedCents({ knex, tenant, clientContractId });
  const remaining = poContext.po_amount - consumed;

  return {
    invoice_id: invoice.invoice_id,
    client_contract_id: clientContractId,
    po_number: invoice.po_number ?? poContext.po_number,
    po_amount_cents: poContext.po_amount,
    consumed_cents: consumed,
    remaining_cents: remaining,
  };
});

// New function to get invoice items on demand
export const getInvoiceLineItems = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<IInvoiceCharge[]> => {
  try {
    const { knex } = await createTenantKnex();
    console.log('Fetching line items for invoice:', invoiceId);
    const items = await Invoice.getInvoiceItems(knex, invoiceId);
    console.log(`Got ${items.length} line items`);
    return items;
  } catch (error) {
    console.error('Error fetching invoice items:', error);
    throw new Error('Error fetching invoice items');
  }
});
