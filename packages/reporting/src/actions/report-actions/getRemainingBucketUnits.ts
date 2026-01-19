'use server';

import { z } from 'zod';
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
// Import interfaces from correct files
import {
  IContractLine,
  IBucketUsage,
  IContractLineService,
  IService // Added IService for service_catalog join
} from '../../../interfaces/billing.interfaces';
import {
  IContractLineServiceConfiguration,
  IContractLineServiceBucketConfig
} from '../../../interfaces/contractLineServiceConfiguration.interfaces';
import { Knex } from 'knex'; // Import Knex type for query builder

// Define the schema for the input parameters
const InputSchema = z.object({
  clientId: z.string().uuid(),
  currentDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid current date format (YYYY-MM-DD)",
  }),
});

// Define the structure for the returned data
export interface RemainingBucketUnitsResult {
  contract_line_id: string;
  contract_line_name: string;
  service_id: string;
  service_name: string;
  display_label: string;
  total_minutes: number;
  minutes_used: number;
  rolled_over_minutes: number;
  remaining_minutes: number;
  period_start?: string;
  period_end?: string;
}

/**
 * Server action to fetch remaining units (hours) for active bucket plans
 * associated with a specific client for the current period.
 *
 * @param input - Object containing clientId and currentDate.
 * @returns A promise that resolves to an array of bucket plan usage details.
 */
export async function getRemainingBucketUnits(
  input: z.infer<typeof InputSchema>
): Promise<RemainingBucketUnitsResult[]> {
  // Validate input
  const validationResult = InputSchema.safeParse(input);
  if (!validationResult.success) {
    const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Validation Error: ${errorMessages}`);
  }
  const { clientId, currentDate } = validationResult.data;

  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant context is required.');
  }

  console.log(`Fetching remaining bucket units for client ${clientId} in tenant ${tenant} as of ${currentDate}`);

  try {
    const results: RemainingBucketUnitsResult[] = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Query contract lines via client_contracts -> contracts -> contract_lines
      // This replaces the old client_contract_lines-based query
      const query = trx('client_contracts as cc')
      .join('contracts as c', function() {
        this.on('c.contract_id', '=', trx.raw('coalesce(cc.template_contract_id, cc.contract_id)'))
            .andOn('c.tenant', '=', 'cc.tenant');
      })
      .join<IContractLine>('contract_lines as cl', function() {
        this.on('cl.contract_id', '=', 'c.contract_id')
            .andOn('cl.tenant', '=', 'c.tenant');
      })
      // Add joins for configuration structure
      .join<IContractLineService>('contract_line_services as ps', function() {
        this.on('cl.contract_line_id', '=', 'ps.contract_line_id')
            .andOn('cl.tenant', '=', 'ps.tenant');
      })
      // Join to service_catalog to get service_name
      .join<IService>('service_catalog as sc', function() {
        this.on('ps.service_id', '=', 'sc.service_id')
            .andOn('ps.tenant', '=', 'sc.tenant');
      })
      .join<IContractLineServiceConfiguration>('contract_line_service_configuration as psc', function() {
        this.on('ps.contract_line_id', '=', 'psc.contract_line_id')
            .andOn('ps.service_id', '=', 'psc.service_id')
            .andOn('ps.tenant', '=', 'psc.tenant');
      })
      .join<IContractLineServiceBucketConfig>('contract_line_service_bucket_config as psbc', function() {
        this.on('psc.config_id', '=', 'psbc.config_id')
            .andOn('psc.tenant', '=', 'psbc.tenant');
      })
      .leftJoin<IBucketUsage>('bucket_usage as bu', function() {
        this.on('cl.contract_line_id', '=', 'bu.contract_line_id')
            .andOn('cc.client_id', '=', 'bu.client_id')
            .andOn('cc.tenant', '=', 'bu.tenant')
            // Filter bucket_usage for the period containing currentDate
            .andOn('bu.period_start', '<=', trx.raw('?', [currentDate]))
            .andOn('bu.period_end', '>', trx.raw('?', [currentDate]));
      })
      .where('cc.client_id', clientId)
      .andWhere('cc.tenant', tenant)
      .andWhere('cc.is_active', true)
      .andWhere('cc.start_date', '<=', trx.raw('?', [currentDate]))
      .andWhere(function() {
        this.whereNull('cc.end_date')
            .orWhere('cc.end_date', '>', trx.raw('?', [currentDate]));
      })
      .select(
        'cl.contract_line_id',
        'cl.contract_line_name',
        'ps.service_id',
        'sc.service_name',
        'psbc.total_minutes',
        trx.raw('COALESCE(bu.minutes_used, 0) as minutes_used'),
        trx.raw('COALESCE(bu.rolled_over_minutes, 0) as rolled_over_minutes'),
        'bu.period_start',
        'bu.period_end'
      );
      
      console.log('Generated SQL:', query.toString());
      
      const rawResults: any[] = await query;
      
      return rawResults.map(row => {
        const totalMinutes = typeof row.total_minutes === 'string' ? parseFloat(row.total_minutes) : row.total_minutes;
        const minutesUsed = typeof row.minutes_used === 'string' ? parseFloat(row.minutes_used) : row.minutes_used;
        const rolledOverMinutes = typeof row.rolled_over_minutes === 'string' ? parseFloat(row.rolled_over_minutes) : row.rolled_over_minutes;
        const remainingMinutes = totalMinutes + rolledOverMinutes - minutesUsed;
        const displayLabel = `${row.contract_line_name} - ${row.service_name}`;
      
        return {
          contract_line_id: row.contract_line_id,
          contract_line_name: row.contract_line_name,
          service_id: row.service_id,
          service_name: row.service_name,
          display_label: displayLabel,
          total_minutes: totalMinutes,
          minutes_used: minutesUsed,
          rolled_over_minutes: rolledOverMinutes,
          remaining_minutes: remainingMinutes,
          period_start: row.period_start ? row.period_start.toISOString().split('T')[0] : undefined,
          period_end: row.period_end ? row.period_end.toISOString().split('T')[0] : undefined,
        };
      });
    });
      
    console.log(`Found ${results.length} active bucket plans for client ${clientId}`);
    return results;

  } catch (error) {
    console.error(`Error fetching remaining bucket units for client ${clientId} in tenant ${tenant}:`, error);
    throw new Error(`Failed to fetch remaining bucket units: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
