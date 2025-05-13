'use server';

import { z } from 'zod';
import { createTenantKnex } from '../../db';
import { getServerSession } from 'next-auth';
import { options } from 'server/src/app/api/auth/[...nextauth]/options';
import { ITimeEntry } from 'server/src/interfaces/timeEntry.interfaces';
import { 
  IService, 
  IServiceType, 
  ICompanyBillingPlan,
  IBillingPlan,
  IBucketUsage,
  IPlanService
} from 'server/src/interfaces/billing.interfaces';
import { ITicket } from 'server/src/interfaces/ticket.interfaces';
import { IProjectTask, IProject, IProjectPhase } from 'server/src/interfaces/project.interfaces';
import { IUsageRecord } from 'server/src/interfaces/usage.interfaces';
import { 
  IPlanServiceConfiguration,
  IPlanServiceBucketConfig
} from 'server/src/interfaces/planServiceConfiguration.interfaces';
import { toPlainDate, formatDateOnly } from 'server/src/lib/utils/dateTimeUtils';
import { getUserRolesWithPermissions } from 'server/src/lib/actions/user-actions/userActions';

// Define the schema for the hours by service input parameters
const HoursByServiceInputSchema = z.object({
  startDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid start date format",
  }),
  endDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid end date format",
  }),
  groupByServiceType: z.boolean().optional().default(false),
});

// Define the structure for the hours by service returned data
export interface ClientHoursByServiceResult {
  service_id: string;
  service_name: string;
  service_type_id?: string | null;
  service_type_name?: string | null;
  total_duration: number; // Sum of durations in minutes
}

/**
 * Server action to fetch total billable hours grouped by service type or service name
 * for the client's company within a given date range.
 *
 * @param input - Object containing startDate, endDate, and groupByServiceType flag.
 * @returns A promise that resolves to an array of aggregated hours by service.
 */
export async function getClientHoursByService(
  input: z.infer<typeof HoursByServiceInputSchema>
): Promise<ClientHoursByServiceResult[]> {
  // Validate input
  const validationResult = HoursByServiceInputSchema.safeParse(input);
  if (!validationResult.success) {
    const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Validation Error: ${errorMessages}`);
  }
  const { startDate, endDate, groupByServiceType } = validationResult.data;

  // Get session and verify authentication
  const session = await getServerSession(options);
  if (!session?.user) {
    throw new Error('Not authenticated');
  }

  // Get tenant and company ID from session
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant context is required.');
  }

  // Get user's company_id
  const user = await knex('users')
    .where({
      user_id: session.user.id,
      tenant
    })
    .first();

  if (!user?.contact_id) {
    throw new Error('User not associated with a contact');
  }

  const contact = await knex('contacts')
    .where({
      contact_name_id: user.contact_id,
      tenant
    })
    .first();

  if (!contact?.company_id) {
    throw new Error('Contact not associated with a company');
  }

  const companyId = contact.company_id;

  console.log(`Fetching hours by service for client company ${companyId} in tenant ${tenant} from ${startDate} to ${endDate}`);

  try {
    // Base query for time entries within the date range and for the tenant
    const timeEntriesQuery = knex<ITimeEntry>('time_entries')
      .where('time_entries.tenant', tenant)
      .where('time_entries.billable_duration', '>', 0)
      .where('start_time', '>=', startDate)
      .where('start_time', '<=', endDate);

    // --- Join Logic based on work_item_type ---
    // We need to join time_entries to either tickets or projects to filter by companyId

    // Subquery for tickets linked to the company
    const ticketCompanySubquery = knex<ITicket>('tickets')
      .select('ticket_id')
      .where({ company_id: companyId, tenant: tenant });

    // Subquery for project tasks linked to the company
    const projectTaskCompanySubquery = knex<IProjectTask>('project_tasks')
      .join<IProjectPhase>('project_phases', function() {
        this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
            .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
      })
      .join<IProject>('projects', function() {
        this.on('project_phases.project_id', '=', 'projects.project_id')
            .andOn('project_phases.tenant', '=', 'projects.tenant');
      })
      .select('project_tasks.task_id')
      .where('projects.company_id', '=', companyId)
      .andWhere('project_tasks.tenant', '=', tenant);

    // Apply the company filter using the subqueries
    timeEntriesQuery.where(function() {
      this.where(function() {
        this.whereRaw('LOWER(work_item_type) = ?', ['ticket'])
            .whereIn('work_item_id', ticketCompanySubquery);
      }).orWhere(function() {
        this.whereRaw('LOWER(work_item_type) = ?', ['project task'])
            .whereIn('work_item_id', projectTaskCompanySubquery);
      });
    });

    // --- Join Service Catalog and Service Types ---
    timeEntriesQuery
      .join<IService>('service_catalog as sc', function() {
        this.on('time_entries.service_id', '=', 'sc.service_id')
            .andOn('time_entries.tenant', '=', 'sc.tenant');
      })
      .leftJoin<IServiceType>('service_types as st', function() {
        this.on('sc.custom_service_type_id', '=', 'st.id')
            .andOn('sc.tenant', '=', 'st.tenant');
      });

    // --- Aggregation and Grouping ---
    const groupByColumn = groupByServiceType ? 'st.name' : 'sc.service_name';
    
    timeEntriesQuery
      .select(
        'sc.service_id',
        'sc.service_name',
        knex.raw('COALESCE(sc.standard_service_type_id, sc.custom_service_type_id) as service_type_id'),
        knex.raw('st.name as service_type_name'), 
        knex.raw('SUM(time_entries.billable_duration) as total_duration')
      )
      .groupBy('sc.service_id', 'sc.service_name', knex.raw('COALESCE(sc.standard_service_type_id, sc.custom_service_type_id)'), 'st.name', groupByColumn)
      .orderBy(groupByColumn);

    const rawResults: any[] = await timeEntriesQuery;

    // Manually map and validate the structure
    const results: ClientHoursByServiceResult[] = rawResults.map(row => ({
      service_id: row.service_id,
      service_name: row.service_name,
      service_type_id: row.service_type_id,
      service_type_name: row.service_type_name,
      total_duration: typeof row.total_duration === 'string' ? parseInt(row.total_duration, 10) : row.total_duration,
    }));

    console.log(`Found ${results.length} service groupings for client company ${companyId}`);
    return results;

  } catch (error) {
    console.error(`Error fetching hours by service for client company ${companyId} in tenant ${tenant}:`, error);
    throw new Error(`Failed to fetch hours by service: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Define the schema for the usage metrics input parameters
const UsageMetricsInputSchema = z.object({
  startDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid start date format (YYYY-MM-DD)",
  }),
  endDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid end date format (YYYY-MM-DD)",
  }),
});

// Define the structure for the usage metrics returned data
export interface ClientUsageMetricResult {
  service_id: string;
  service_name: string;
  unit_of_measure: string | null;
  total_quantity: number;
}

/**
 * Server action to fetch key usage data metrics for the client's company
 * within a given date range.
 *
 * @param input - Object containing startDate and endDate.
 * @returns A promise that resolves to an array of usage metrics.
 */
export async function getClientUsageMetrics(
  input: z.infer<typeof UsageMetricsInputSchema>
): Promise<ClientUsageMetricResult[]> {
  // Validate input
  const validationResult = UsageMetricsInputSchema.safeParse(input);
  if (!validationResult.success) {
    const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Validation Error: ${errorMessages}`);
  }
  const { startDate, endDate } = validationResult.data;

  // Get session and verify authentication
  const session = await getServerSession(options);
  if (!session?.user) {
    throw new Error('Not authenticated');
  }

  // Get tenant and company ID from session
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant context is required.');
  }

  // Get user's company_id
  const user = await knex('users')
    .where({
      user_id: session.user.id,
      tenant
    })
    .first();

  if (!user?.contact_id) {
    throw new Error('User not associated with a contact');
  }

  const contact = await knex('contacts')
    .where({
      contact_name_id: user.contact_id,
      tenant
    })
    .first();

  if (!contact?.company_id) {
    throw new Error('Contact not associated with a company');
  }

  const companyId = contact.company_id;

  // No permission check needed for usage metrics - all users can access

  console.log(`Fetching usage metrics for client company ${companyId} in tenant ${tenant} from ${startDate} to ${endDate}`);

  try {
    const query = knex<IUsageRecord>('usage_tracking as ut')
      .join<IService>('service_catalog as sc', function() {
        this.on('ut.service_id', '=', 'sc.service_id')
            .andOn('ut.tenant', '=', 'sc.tenant');
      })
      .where('ut.company_id', companyId)
      .andWhere('ut.tenant', tenant)
      .andWhere(knex.raw('ut.usage_date::date'), '>=', startDate)
      .andWhere(knex.raw('ut.usage_date::date'), '<=', endDate)
      .select(
        'ut.service_id',
        'sc.service_name',
        'sc.unit_of_measure',
        knex.raw('SUM(ut.quantity) as total_quantity')
      )
      .groupBy('ut.service_id', 'sc.service_name', 'sc.unit_of_measure')
      .orderBy('sc.service_name');

    const rawResults: any[] = await query;

    // Map results, ensuring total_quantity is a number
    const results: ClientUsageMetricResult[] = rawResults.map(row => ({
      service_id: row.service_id,
      service_name: row.service_name,
      unit_of_measure: row.unit_of_measure,
      total_quantity: typeof row.total_quantity === 'string' ? parseFloat(row.total_quantity) : row.total_quantity,
    }));

    console.log(`Found ${results.length} usage metric groupings for client company ${companyId}`);
    return results;

  } catch (error) {
    console.error(`Error fetching usage metrics for client company ${companyId} in tenant ${tenant}:`, error);
    throw new Error(`Failed to fetch usage metrics: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Define the structure for the bucket usage returned data
export interface ClientBucketUsageResult {
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
  percentage_used: number;
  percentage_remaining: number;
  hours_total: number;
  hours_used: number;
  hours_remaining: number;
}

/**
 * Server action to fetch enhanced bucket usage details for the client's company.
 * This provides more detailed information than the basic getCurrentUsage function.
 *
 * @returns A promise that resolves to an array of detailed bucket usage information.
 */
export async function getClientBucketUsage(): Promise<ClientBucketUsageResult[]> {
  // Get session and verify authentication
  const session = await getServerSession(options);
  if (!session?.user) {
    throw new Error('Not authenticated');
  }

  // Get tenant and company ID from session
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant context is required.');
  }

  // Get user's company_id
  const user = await knex('users')
    .where({
      user_id: session.user.id,
      tenant
    })
    .first();

  if (!user?.contact_id) {
    throw new Error('User not associated with a contact');
  }

  const contact = await knex('contacts')
    .where({
      contact_name_id: user.contact_id,
      tenant
    })
    .first();

  if (!contact?.company_id) {
    throw new Error('Contact not associated with a company');
  }

  const companyId = contact.company_id;

  // No permission check needed for bucket usage - all users can access

  const currentDate = new Date().toISOString().split('T')[0]; // Format as YYYY-MM-DD
  console.log(`Fetching bucket usage for client company ${companyId} in tenant ${tenant} as of ${currentDate}`);

  try {
    const query = knex<ICompanyBillingPlan>('company_billing_plans as cbp')
      .join<IBillingPlan>('billing_plans as bp', function() {
        this.on('cbp.plan_id', '=', 'bp.plan_id')
            .andOn('cbp.tenant', '=', 'bp.tenant');
      })
      .join<IPlanService>('plan_services as ps', function() {
        this.on('bp.plan_id', '=', 'ps.plan_id')
            .andOn('bp.tenant', '=', 'ps.tenant');
      })
      .join<IService>('service_catalog as sc', function() {
        this.on('ps.service_id', '=', 'sc.service_id')
            .andOn('ps.tenant', '=', 'sc.tenant');
      })
      .join<IPlanServiceConfiguration>('plan_service_configuration as psc', function() { 
        this.on('ps.plan_id', '=', 'psc.plan_id')
            .andOn('ps.service_id', '=', 'psc.service_id')
            .andOn('ps.tenant', '=', 'psc.tenant');
      })
      .join<IPlanServiceBucketConfig>('plan_service_bucket_config as psbc', function() {
        this.on('psc.config_id', '=', 'psbc.config_id')
            .andOn('psc.tenant', '=', 'psbc.tenant');
      })
      .leftJoin<IBucketUsage>('bucket_usage as bu', function() {
        this.on('bp.plan_id', '=', 'bu.plan_id')
            .andOn('cbp.company_id', '=', 'bu.company_id')
            .andOn('cbp.tenant', '=', 'bu.tenant')
            .andOn('bu.period_start', '<=', knex.raw('?', [currentDate]))
            .andOn('bu.period_end', '>', knex.raw('?', [currentDate]));
      })
      .where('cbp.company_id', companyId)
      .andWhere('cbp.tenant', tenant)
      .andWhere('bp.plan_type', 'Bucket')
      .andWhere('cbp.is_active', true)
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
      
    const rawResults: any[] = await query;
      
    const results: ClientBucketUsageResult[] = rawResults.map(row => {
      const totalMinutes = typeof row.total_minutes === 'string' ? parseFloat(row.total_minutes) : row.total_minutes;
      const minutesUsed = typeof row.minutes_used === 'string' ? parseFloat(row.minutes_used) : row.minutes_used;
      const rolledOverMinutes = typeof row.rolled_over_minutes === 'string' ? parseFloat(row.rolled_over_minutes) : row.rolled_over_minutes;
      const remainingMinutes = totalMinutes + rolledOverMinutes - minutesUsed;
      const displayLabel = `${row.plan_name} - ${row.service_name}`;
      
      // Calculate additional metrics for enhanced display
      const totalWithRollover = totalMinutes + rolledOverMinutes;
      const percentageUsed = totalWithRollover > 0 ? (minutesUsed / totalWithRollover) * 100 : 0;
      const percentageRemaining = totalWithRollover > 0 ? (remainingMinutes / totalWithRollover) * 100 : 0;
      
      // Convert minutes to hours for easier reading
      const hoursTotal = totalWithRollover / 60;
      const hoursUsed = minutesUsed / 60;
      const hoursRemaining = remainingMinutes / 60;
      
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
        percentage_used: Math.round(percentageUsed * 100) / 100, // Round to 2 decimal places
        percentage_remaining: Math.round(percentageRemaining * 100) / 100,
        hours_total: Math.round(hoursTotal * 100) / 100,
        hours_used: Math.round(hoursUsed * 100) / 100,
        hours_remaining: Math.round(hoursRemaining * 100) / 100
      };
    });
      
    console.log(`Found ${results.length} active bucket plans for client company ${companyId}`);
    return results;

  } catch (error) {
    console.error(`Error fetching bucket usage for client company ${companyId} in tenant ${tenant}:`, error);
    throw new Error(`Failed to fetch bucket usage: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
