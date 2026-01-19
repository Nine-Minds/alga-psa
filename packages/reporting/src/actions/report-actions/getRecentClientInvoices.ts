'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { IInvoice } from '../../../interfaces/invoice.interfaces';
import { z } from 'zod';
import { Knex } from 'knex';
// Removed safe-action import as it's not the standard pattern here
// Define the schema for the input parameters
const InputSchema = z.object({
  clientId: z.string().uuid(),
  limit: z.number().int().positive().optional().default(10),
});

// Define the type for the returned invoice data, selecting only necessary fields
export type RecentInvoice = Pick<IInvoice, 'invoice_id' | 'invoice_number' | 'invoice_date' | 'due_date' | 'total_amount' | 'status'>;

/**
 * Server action to fetch recent invoices for a specific client.
 *
 * @param clientId - The UUID of the client.
 * @param limit - The maximum number of invoices to return (default: 10).
 * @returns A promise that resolves to an array of recent invoices or throws an error.
 */
export async function getRecentClientInvoices(input: { clientId: string; limit?: number }): Promise<RecentInvoice[]> {
  // Validate input
  const validationResult = InputSchema.safeParse(input);
  if (!validationResult.success) {
    const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Validation Error: ${errorMessages}`);
  }
  const { clientId, limit } = validationResult.data;

  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant context is required.');
  }

  console.log(`Fetching recent invoices for client ${clientId} in tenant ${tenant}, limit ${limit}`);

  try {
    const invoices: RecentInvoice[] = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .select(
          'invoice_id',
          'invoice_number',
          'invoice_date',
          'due_date',
          'total_amount',
          'status'
          // 'currency_code' // Not included as it's not in IInvoice interface
        )
        .where({
          client_id: clientId,
          tenant: tenant,
        })
        .orderBy('invoice_date', 'desc')
        .limit(limit);
    });

    console.log(`Found ${invoices.length} recent invoices for client ${clientId}`);
    return invoices;
  } catch (error) {
    console.error(`Error fetching recent invoices for client ${clientId} in tenant ${tenant}:`, error);
    throw new Error(`Failed to fetch recent invoices: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}