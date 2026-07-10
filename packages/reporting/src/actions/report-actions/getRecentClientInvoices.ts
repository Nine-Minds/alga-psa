'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import type { IInvoice } from '@alga-psa/types';
import { z } from 'zod';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { reportingActionErrorFrom, type ReportingActionError } from './reportingActionErrors';
// Removed safe-action import as it's not the standard pattern here
// Define the schema for the input parameters
const InputSchema = z.object({
  clientId: z.string().uuid(),
  limit: z.number().int().positive().optional().default(10),
});

// Define the type for the returned invoice data, selecting only necessary fields
export type RecentInvoice = Pick<IInvoice, 'invoice_id' | 'invoice_number' | 'invoice_date' | 'due_date' | 'total_amount' | 'status' | 'currency_code'> & {
  /** total − credit applied − completed payments; null for drafts (not yet owed). */
  balance_due: number | null;
};

/**
 * Server action to fetch recent invoices for a specific client.
 *
 * @param clientId - The UUID of the client.
 * @param limit - The maximum number of invoices to return (default: 10).
 * @returns A promise that resolves to an array of recent invoices or throws an error.
 */
export const getRecentClientInvoices = withAuth(async (
  _user,
  { tenant },
  input: { clientId: string; limit?: number }
): Promise<RecentInvoice[] | ReportingActionError> => {
  // Validate input
  const validationResult = InputSchema.safeParse(input);
  if (!validationResult.success) {
    return reportingActionErrorFrom(validationResult.error)!;
  }
  const { clientId, limit } = validationResult.data;

  const { knex } = await createTenantKnex();

  console.log(`Fetching recent invoices for client ${clientId} in tenant ${tenant}, limit ${limit}`);

  try {
    const invoices: RecentInvoice[] = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Same money math as the pulse's aging (D6): completed payments only.
      const completedPayments = trx('invoice_payments')
        .where({ tenant, status: 'completed' })
        .groupBy('invoice_id')
        .select('invoice_id')
        .sum({ paid_amount: 'amount' })
        .as('ip');

      const rows = await trx('invoices as i')
        .leftJoin(completedPayments, 'ip.invoice_id', 'i.invoice_id')
        .select(
          'i.invoice_id',
          'i.invoice_number',
          'i.invoice_date',
          'i.due_date',
          'i.total_amount',
          'i.status',
          'i.currency_code',
          'i.credit_applied',
          'i.finalized_at',
          'ip.paid_amount'
        )
        .where({
          'i.client_id': clientId,
          'i.tenant': tenant,
        })
        .orderBy('i.invoice_date', 'desc')
        .limit(limit);

      return rows.map((row: any): RecentInvoice => {
        const isDraft = row.finalized_at == null && row.status === 'draft';
        return {
          invoice_id: row.invoice_id,
          invoice_number: row.invoice_number,
          invoice_date: row.invoice_date,
          due_date: row.due_date,
          total_amount: row.total_amount,
          status: row.status,
          currency_code: row.currency_code,
          balance_due: isDraft
            ? null
            : Math.max(0, Number(row.total_amount ?? 0) - Number(row.credit_applied ?? 0) - Number(row.paid_amount ?? 0)),
        };
      });
    });

    console.log(`Found ${invoices.length} recent invoices for client ${clientId}`);
    return invoices;
  } catch (error) {
    const expected = reportingActionErrorFrom(error);
    if (expected) return expected;
    console.error(`Error fetching recent invoices for client ${clientId} in tenant ${tenant}:`, error);
    throw error;
  }
});
