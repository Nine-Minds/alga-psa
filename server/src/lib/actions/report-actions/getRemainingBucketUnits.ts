'use server';

import { z } from 'zod';
import { createTenantKnex } from '../../db';
// Import interfaces from correct files
import {
  ICompanyBillingPlan,
  IBillingPlan,
  IBucketUsage,
  IPlanService,
  IService // Added IService for service_catalog join
} from '../../../interfaces/billing.interfaces';
import {
  IPlanServiceConfiguration,
  IPlanServiceBucketConfig
} from '../../../interfaces/planServiceConfiguration.interfaces'; // Corrected import path
import { Knex } from 'knex'; // Import Knex type for query builder

// Define the schema for the input parameters
const InputSchema = z.object({
  companyId: z.string().uuid(),
  currentDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid current date format (YYYY-MM-DD)",
  }),
});

// Define the structure for the returned data
export interface RemainingBucketUnitsResult {
  plan_id: string;
  plan_name: string;
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
 * associated with a specific company for the current period.
 *
 * @param input - Object containing companyId and currentDate.
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
  const { companyId, currentDate } = validationResult.data;

  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant context is required.');
  }

  console.log(`Fetching remaining bucket units for company ${companyId} in tenant ${tenant} as of ${currentDate}`);

  try {
    const query = knex<ICompanyBillingPlan>('company_billing_plans as cbp')
      .join<IBillingPlan>('billing_plans as bp', function() {
        this.on('cbp.plan_id', '=', 'bp.plan_id')
            .andOn('cbp.tenant', '=', 'bp.tenant');
      })
      // Removed join to bucket_plans
      // Add joins for new configuration structure
      .join<IPlanService>('plan_services as ps', function() {
        this.on('bp.plan_id', '=', 'ps.plan_id')
            .andOn('bp.tenant', '=', 'ps.tenant');
      })
      // Join to service_catalog to get service_name
      .join<IService>('service_catalog as sc', function() {
        this.on('ps.service_id', '=', 'sc.service_id')
            .andOn('ps.tenant', '=', 'sc.tenant');
      })
      .join<IPlanServiceConfiguration>('plan_service_configuration as psc', function() { 
        this.on('ps.plan_id', '=', 'psc.plan_id')
            .andOn('ps.service_id', '=', 'psc.service_id') // Need service_id for the join
            .andOn('ps.tenant', '=', 'psc.tenant');
      })
      .join<IPlanServiceBucketConfig>('plan_service_bucket_config as psbc', function() {
        this.on('psc.config_id', '=', 'psbc.config_id')
            .andOn('psc.tenant', '=', 'psbc.tenant');
      })
      .leftJoin<IBucketUsage>('bucket_usage as bu', function() {
        // Update join condition to use bp.plan_id AND ps.service_id
        // Assuming bucket_usage might need service context if a plan has multiple bucket services
        // If bucket_usage only stores plan-level usage, joining on plan_id is sufficient.
        // Sticking with plan_id only for now based on previous structure.
        // If issues arise, consider adding service_id to bucket_usage table and join condition.
        this.on('bp.plan_id', '=', 'bu.plan_id')
            .andOn('cbp.company_id', '=', 'bu.company_id') // Join on company_id as well
            .andOn('cbp.tenant', '=', 'bu.tenant')
            // Filter bucket_usage for the period containing currentDate
            .andOn('bu.period_start', '<=', knex.raw('?', [currentDate]))
            .andOn('bu.period_end', '>', knex.raw('?', [currentDate]));
      })
      .where('cbp.company_id', companyId)
      .andWhere('cbp.tenant', tenant)
      .andWhere('bp.plan_type', 'Bucket') // Filter for Bucket plans
      .andWhere('cbp.is_active', true) // Only active company plans
      // Ensure the plan itself is active based on start/end dates relative to currentDate
      .andWhere('cbp.start_date', '<=', knex.raw('?', [currentDate]))
      .andWhere(function() {
        this.whereNull('cbp.end_date')
            .orWhere('cbp.end_date', '>', knex.raw('?', [currentDate]));
      })
      .select(
        'bp.plan_id',
        'bp.plan_name',
        'ps.service_id',
        'sc.service_name',
        'psbc.total_minutes',
        knex.raw('COALESCE(bu.minutes_used, 0) as minutes_used'),
        knex.raw('COALESCE(bu.rolled_over_minutes, 0) as rolled_over_minutes'),
        'bu.period_start',
        'bu.period_end'
      );
      
      console.log('Generated SQL:', query.toString());
      
      const rawResults: any[] = await query;
      
      const results: RemainingBucketUnitsResult[] = rawResults.map(row => {
        const totalMinutes = typeof row.total_minutes === 'string' ? parseFloat(row.total_minutes) : row.total_minutes;
        const minutesUsed = typeof row.minutes_used === 'string' ? parseFloat(row.minutes_used) : row.minutes_used;
        const rolledOverMinutes = typeof row.rolled_over_minutes === 'string' ? parseFloat(row.rolled_over_minutes) : row.rolled_over_minutes;
        const remainingMinutes = totalMinutes + rolledOverMinutes - minutesUsed;
        const displayLabel = `${row.plan_name} - ${row.service_name}`;
      
        return {
          plan_id: row.plan_id,
          plan_name: row.plan_name,
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
      
      console.log(`Found ${results.length} active bucket plans for company ${companyId}`);
      return results;

  } catch (error) {
    console.error(`Error fetching remaining bucket units for company ${companyId} in tenant ${tenant}:`, error);
    throw new Error(`Failed to fetch remaining bucket units: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
