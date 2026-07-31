'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';

export interface SalesOrderInvoiceLink {
  invoice_id: string;
  invoice_number: string | null;
  status: string | null;
  total_amount: number; // cents
  currency_code: string | null;
  created_at: string; // ISO
}

export interface SalesOrderQuoteLink {
  so_id: string;
  so_number: string;
  status: string;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value as string | number).toISOString();
}

/**
 * Invoices generated from a sales order, via the invoice_charges.so_line_id backlink (F009).
 * Requires inventory:read.
 */
export const listSalesOrderInvoices = withAuth(async (
  user,
  { tenant },
  soId: string
): Promise<SalesOrderInvoiceLink[]> => {
  if (!(await hasPermission(user, 'inventory', 'read'))) {
    return [];
  }

  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const rows = await trx('sales_order_lines as sol')
      .join('invoice_charges as ic', function () {
        this.on('ic.so_line_id', '=', 'sol.so_line_id')
          .andOn('ic.tenant', '=', 'sol.tenant');
      })
      .join('invoices as i', function () {
        this.on('i.invoice_id', '=', 'ic.invoice_id')
          .andOn('i.tenant', '=', 'ic.tenant');
      })
      .where('sol.tenant', tenant)
      .andWhere('sol.so_id', soId)
      .distinct(
        'i.invoice_id',
        'i.invoice_number',
        'i.status',
        'i.finalized_at',
        'i.total_amount',
        'i.currency_code',
        'i.created_at'
      )
      .orderBy('i.created_at', 'desc');

    return rows.map((row) => ({
      invoice_id: row.invoice_id as string,
      invoice_number: (row.invoice_number as string | null) ?? null,
      // Canonical predicate (matches the billing Drafts/Finalized tabs): a row with
      // finalized_at set is finalized even if its status column still says 'draft'.
      status: row.finalized_at && row.status === 'draft'
        ? 'finalized'
        : ((row.status as string | null) ?? null),
      total_amount: Number(row.total_amount ?? 0),
      currency_code: (row.currency_code as string | null) ?? null,
      created_at: toIsoString(row.created_at),
    }));
  });
});

/** The sales order converted from a quote, if any (F010). Requires inventory:read. */
export const getSalesOrderForQuote = withAuth(async (
  user,
  { tenant },
  quoteId: string
): Promise<SalesOrderQuoteLink | null> => {
  if (!(await hasPermission(user, 'inventory', 'read'))) {
    return null;
  }

  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const row = await trx('sales_orders')
      .where({ tenant, quote_id: quoteId })
      .select('so_id', 'so_number', 'status')
      .orderBy('created_at', 'desc')
      .first();

    if (!row) {
      return null;
    }

    return {
      so_id: row.so_id as string,
      so_number: row.so_number as string,
      status: row.status as string,
    };
  });
});
