'use server';

import { z } from 'zod';
import { createTenantKnex } from '../../db';
import { ICompanyBillingPlan, IBillingPlan, IBucketPlan, IBucketUsage } from '../../../interfaces/billing.interfaces';
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
  total_hours: number;
  hours_used: number;
  remaining_hours: number;
  period_start?: string; // Optional, from bucket_usage
  period_end?: string;   // Optional, from bucket_usage
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
      .join<IBucketPlan>('bucket_plans as bup', function() {
        this.on('bp.plan_id', '=', 'bup.plan_id')
            .andOn('bp.tenant', '=', 'bup.tenant'); // Assuming bucket_plans is also tenanted
      })
      .leftJoin<IBucketUsage>('bucket_usage as bu', function() {
        this.on('bup.bucket_plan_id', '=', 'bu.bucket_plan_id')
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
        'bup.total_hours',
        // Use COALESCE to default hours_used to 0 if no usage record found for the period
        knex.raw('COALESCE(bu.hours_used, 0) as hours_used'),
        'bu.period_start', // Include period from usage record if found
        'bu.period_end'    // Include period from usage record if found
      );

    const rawResults: any[] = await query;

    // Calculate remaining hours and map to the final structure
    const results: RemainingBucketUnitsResult[] = rawResults.map(row => {
      const totalHours = typeof row.total_hours === 'string' ? parseFloat(row.total_hours) : row.total_hours;
      const hoursUsed = typeof row.hours_used === 'string' ? parseFloat(row.hours_used) : row.hours_used;
      const remainingHours = totalHours - hoursUsed;

      return {
        plan_id: row.plan_id,
        plan_name: row.plan_name,
        total_hours: totalHours,
        hours_used: hoursUsed,
        remaining_hours: remainingHours,
        period_start: row.period_start ? row.period_start.toISOString().split('T')[0] : undefined, // Format date if exists
        period_end: row.period_end ? row.period_end.toISOString().split('T')[0] : undefined,     // Format date if exists
      };
    });

    console.log(`Found ${results.length} active bucket plans for company ${companyId}`);
    return results;

  } catch (error) {
    console.error(`Error fetching remaining bucket units for company ${companyId} in tenant ${tenant}:`, error);
    throw new Error(`Failed to fetch remaining bucket units: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}