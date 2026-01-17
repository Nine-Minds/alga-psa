'use server';

import { z } from 'zod';
import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { ITimeEntry } from '../../../interfaces/timeEntry.interfaces';
import { IService, IServiceType } from '../../../interfaces/billing.interfaces';
import { ITicket } from '../../../interfaces/ticket.interfaces'; // Removed .tsx extension
import { IProjectTask, IProject, IProjectPhase } from '../../../interfaces/project.interfaces';
import { toPlainDate } from '../../utils/dateTimeUtils'; // Assuming this utility exists for date handling

// Define the schema for the input parameters
const InputSchema = z.object({
  clientId: z.string().uuid(),
  startDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid start date format",
  }),
  endDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid end date format",
  }),
  groupByServiceType: z.boolean().optional().default(false), // Option to group by Service Type instead of Service Name
});

// Define the structure for the returned data
export interface HoursByServiceResult {
  service_id: string;
  service_name: string;
  service_type_id?: string | null; // From service_catalog join
  service_type_name?: string | null; // From service_types join
  total_duration: number; // Sum of durations in minutes
}

/**
 * Server action to fetch total billable hours grouped by service type or service name
 * for a specific client within a given date range.
 *
 * @param input - Object containing clientId, startDate, endDate, and groupByServiceType flag.
 * @returns A promise that resolves to an array of aggregated hours by service.
 */
export async function getHoursByServiceType(
  input: z.infer<typeof InputSchema>
): Promise<HoursByServiceResult[]> {
  // Validate input
  const validationResult = InputSchema.safeParse(input);
  if (!validationResult.success) {
    const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Validation Error: ${errorMessages}`);
  }
  const { clientId, startDate, endDate, groupByServiceType } = validationResult.data;

  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant context is required.');
  }

  console.log(`Fetching hours by service for client ${clientId} in tenant ${tenant} from ${startDate} to ${endDate}`);

  try {
    const results: HoursByServiceResult[] = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Base query for time entries within the date range and for the tenant
      const timeEntriesQuery = trx<ITimeEntry>('time_entries')
      .where('time_entries.tenant', tenant) // Separate where clauses
      .where('time_entries.billable_duration', '>', 0) // Use billable_duration to determine billable hours
      .where('start_time', '>=', startDate)
      .where('start_time', '<=', endDate); // Use start_time for date filtering

    // --- Join Logic based on work_item_type ---
    // We need to join time_entries to either tickets or projects to filter by clientId

      // Subquery for tickets linked to the client
      const ticketClientSubquery = trx<ITicket>('tickets')
        .select('ticket_id')
        .where({ client_id: clientId, tenant: tenant });

      // Subquery for project tasks linked to the client
      const projectTaskClientSubquery = trx<IProjectTask>('project_tasks')
      .join<IProjectPhase>('project_phases', function() {
        this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
            .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
      })
      .join<IProject>('projects', function() {
        this.on('project_phases.project_id', '=', 'projects.project_id')
            .andOn('project_phases.tenant', '=', 'projects.tenant');
      })
      .select('project_tasks.task_id')
      .where('projects.client_id', '=', clientId)
      .andWhere('project_tasks.tenant', '=', tenant); // Ensure tenant filter on subquery joins

      // Apply the client filter using the subqueries
      timeEntriesQuery.where(function() {
      this.where(function() {
        this.where('work_item_type', '=', 'Ticket')
            .whereIn('work_item_id', ticketClientSubquery);
      }).orWhere(function() {
        this.where('work_item_type', '=', 'Project Task')
            .whereIn('work_item_id', projectTaskClientSubquery);
      });
      // Note: Add other work_item_types if they can be linked to a client
    });

      // --- Join Service Catalog and Service Types ---
      timeEntriesQuery
      .join<IService>('service_catalog as sc', function() {
        this.on('time_entries.service_id', '=', 'sc.service_id')
            .andOn('time_entries.tenant', '=', 'sc.tenant');
      })
      .leftJoin<IServiceType>('service_types as st', function() { // Left join in case service type is null
        this.on('sc.custom_service_type_id', '=', 'st.id')
            .andOn('sc.tenant', '=', 'st.tenant');
      });

      // --- Aggregation and Grouping ---
      const groupByColumn = groupByServiceType ? 'st.name' : 'sc.service_name';
      const groupBySelect = groupByServiceType ? 'st.name as service_type_name' : 'sc.service_name';

      timeEntriesQuery
        .select(
          'sc.service_id',
          'sc.service_name',
          'sc.custom_service_type_id as service_type_id',
          trx.raw(`${groupBySelect}`), // Select either service_name or service_type_name based on flag
          trx.raw('SUM(time_entries.billable_duration) as total_duration') // Summing billable_duration (assuming it's in minutes)
        )
        .groupBy('sc.service_id', 'sc.service_name', 'sc.custom_service_type_id', groupByColumn) // Group by selected columns
        .orderBy(groupByColumn); // Order by the grouped column

      // Knex type inference might not capture the aggregated structure, so treat as 'any' initially
      const rawResults: any[] = await timeEntriesQuery;

      // Manually map and validate the structure
      return rawResults.map(row => ({
        service_id: row.service_id,
        service_name: row.service_name,
        service_type_id: row.service_type_id,
        service_type_name: row.service_type_name, // This might be null depending on the join/grouping
        // Ensure total_duration is treated as a number (SUM might return string in some DBs)
        total_duration: typeof row.total_duration === 'string' ? parseInt(row.total_duration, 10) : row.total_duration,
      }));
    });


    console.log(`Found ${results.length} service groupings for client ${clientId}`);
    return results;

  } catch (error) {
    console.error(`Error fetching hours by service for client ${clientId} in tenant ${tenant}:`, error);
    throw new Error(`Failed to fetch hours by service: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
