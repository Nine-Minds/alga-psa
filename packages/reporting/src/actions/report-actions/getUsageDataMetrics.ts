'use server';

import { z } from 'zod';
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { IService, IUsageRecord } from '@alga-psa/types';
import { Knex } from 'knex'; // Import Knex type

// Define the schema for the input parameters
const InputSchema = z.object({
  clientId: z.string().uuid(),
  startDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid start date format (YYYY-MM-DD)",
  }),
  endDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid end date format (YYYY-MM-DD)",
  }),
});

// Define the structure for the returned data (Total Usage per Service)
export interface UsageMetricResult {
  service_id: string;
  service_name: string;
  unit_of_measure: string | null;
  total_quantity: number;
}

/**
 * Server action to fetch key usage data metrics for a specific client
 * within a given date range. Currently implements "Total Usage per Service".
 *
 * @param input - Object containing clientId, startDate, and endDate.
 * @returns A promise that resolves to an array of usage metrics.
 */
export const getUsageDataMetrics = withAuth(async (
  _user,
  { tenant },
  input: z.infer<typeof InputSchema>
): Promise<UsageMetricResult[]> => {
  // Validate input
  const validationResult = InputSchema.safeParse(input);
  if (!validationResult.success) {
    const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Validation Error: ${errorMessages}`);
  }
  const { clientId, startDate, endDate } = validationResult.data;

  const { knex } = await createTenantKnex();

  console.log(`Fetching usage metrics for client ${clientId} in tenant ${tenant} from ${startDate} to ${endDate}`);

  try {
    const results: UsageMetricResult[] = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const query = trx<IUsageRecord>('usage_tracking as ut')
        .join<IService>('service_catalog as sc', function() {
          this.on('ut.service_id', '=', 'sc.service_id')
              .andOn('ut.tenant', '=', 'sc.tenant');
        })
        .where('ut.client_id', clientId)
        .andWhere('ut.tenant', tenant)
        .andWhere('ut.usage_date', '>=', startDate)
        .andWhere('ut.usage_date', '<=', endDate)
        .select(
          'ut.service_id',
          'sc.service_name',
          'sc.unit_of_measure',
          trx.raw('SUM(ut.quantity) as total_quantity')
        )
        .groupBy('ut.service_id', 'sc.service_name', 'sc.unit_of_measure')
        .orderBy('sc.service_name');

      const rawResults: any[] = await query;

      // Map results, ensuring total_quantity is a number
      return rawResults.map(row => ({
        service_id: row.service_id,
        service_name: row.service_name,
        unit_of_measure: row.unit_of_measure,
        total_quantity: typeof row.total_quantity === 'string' ? parseFloat(row.total_quantity) : row.total_quantity,
      }));
    });

    console.log(`Found ${results.length} usage metric groupings for client ${clientId}`);
    return results;

  } catch (error) {
    console.error(`Error fetching usage metrics for client ${clientId} in tenant ${tenant}:`, error);
    throw new Error(`Failed to fetch usage metrics: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});
