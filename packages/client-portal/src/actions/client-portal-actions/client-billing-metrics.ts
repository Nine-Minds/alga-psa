'use server';

import { z } from 'zod';
import { createTenantKnex, withTransaction, tenantDb } from '@alga-psa/db';
import { Knex } from 'knex';
import { ITimeEntry } from '@alga-psa/types';
import {
  IClientContract,
} from '@alga-psa/types';
import { ITicket } from '@alga-psa/types';
import { IProjectTask } from '@alga-psa/types';
import { IUsageRecord } from '@alga-psa/types';
import { toPlainDate, formatDateOnly } from '@alga-psa/core';
import { withAuth } from '@alga-psa/auth';
import { clientPortalActionErrorFrom, type ClientPortalActionError } from './clientPortalActionErrors';

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
 * for the client's client within a given date range.
 *
 * @param input - Object containing startDate, endDate, and groupByServiceType flag.
 * @returns A promise that resolves to an array of aggregated hours by service.
 */
export const getClientHoursByService = withAuth(async (
  user,
  { tenant },
  input: z.infer<typeof HoursByServiceInputSchema>
): Promise<ClientHoursByServiceResult[] | ClientPortalActionError> => {
  // Validate input
  const validationResult = HoursByServiceInputSchema.safeParse(input);
  if (!validationResult.success) {
    const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    return clientPortalActionErrorFrom(new Error(`Validation Error: ${errorMessages}`))!;
  }
  const { startDate, endDate, groupByServiceType } = validationResult.data;

  const { knex } = await createTenantKnex();

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);

      // Get user's client_id
      const userRecord = await scopedDb.table('users')
        .where({
          user_id: user.user_id,
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const contact = await scopedDb.table('contacts')
        .where({
          contact_name_id: userRecord.contact_id,
        })
        .first();

      if (!contact?.client_id) {
        throw new Error('Contact not associated with a client');
      }

      const clientId = contact.client_id;

      console.log(`Fetching hours by service for client client ${clientId} in tenant ${tenant} from ${startDate} to ${endDate}`);

      // Base query for time entries within the date range and for the tenant
      const timeEntriesQuery = scopedDb.table<ITimeEntry>('time_entries')
      .where('time_entries.billable_duration', '>', 0)
      .where('start_time', '>=', startDate)
      .where('start_time', '<=', endDate);

    // --- Join Logic based on work_item_type ---
    // We need to join time_entries to either tickets or projects to filter by clientId

      // Subquery for tickets linked to the client
      const ticketClientSubquery = scopedDb.table<ITicket>('tickets')
      .select('ticket_id')
      .where({ client_id: clientId });

      // Subquery for project tasks linked to the client
      const projectTaskClientSubquery = scopedDb.table<IProjectTask>('project_tasks')
      .select('project_tasks.task_id')
      .where('projects.client_id', '=', clientId);
      scopedDb.tenantJoin(projectTaskClientSubquery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
      scopedDb.tenantJoin(projectTaskClientSubquery, 'projects', 'project_phases.project_id', 'projects.project_id');

    // Apply the client filter using the subqueries
    timeEntriesQuery.where(function() {
      this.where(function() {
        this.whereRaw('LOWER(work_item_type) = ?', ['ticket'])
            .whereIn('work_item_id', ticketClientSubquery);
      }).orWhere(function() {
        this.whereRaw('LOWER(work_item_type) = ?', ['project task'])
            .whereIn('work_item_id', projectTaskClientSubquery);
      });
    });

    // --- Join Service Catalog and Service Types ---
    scopedDb.tenantJoin(timeEntriesQuery, 'service_catalog as sc', 'time_entries.service_id', 'sc.service_id');
    scopedDb.tenantJoin(timeEntriesQuery, 'service_types as st', 'sc.custom_service_type_id', 'st.id', { type: 'left' });

    // --- Aggregation and Grouping ---
    const groupByColumn = groupByServiceType ? 'st.name' : 'sc.service_name';

    timeEntriesQuery
      .select(
        'sc.service_id',
        'sc.service_name',
        'sc.custom_service_type_id as service_type_id',
        knex.raw('st.name as service_type_name'),
        knex.raw('SUM(time_entries.billable_duration) as total_duration')
      )
        .groupBy('sc.service_id', 'sc.service_name', 'sc.custom_service_type_id', 'st.name', groupByColumn)
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

      console.log(`Found ${results.length} service groupings for client client ${clientId}`);
      return results;
    });

    return result;
  } catch (error) {
    const expected = clientPortalActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error(`Error fetching hours by service in tenant ${tenant}:`, error);
    throw error;
  }
});

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
 * Server action to fetch key usage data metrics for the client's client
 * within a given date range.
 *
 * @param input - Object containing startDate and endDate.
 * @returns A promise that resolves to an array of usage metrics.
 */
export const getClientUsageMetrics = withAuth(async (
  user,
  { tenant },
  input: z.infer<typeof UsageMetricsInputSchema>
): Promise<ClientUsageMetricResult[] | ClientPortalActionError> => {
  // Validate input
  const validationResult = UsageMetricsInputSchema.safeParse(input);
  if (!validationResult.success) {
    const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    return clientPortalActionErrorFrom(new Error(`Validation Error: ${errorMessages}`))!;
  }
  const { startDate, endDate } = validationResult.data;

  const { knex } = await createTenantKnex();

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);

      // Get user's client_id
      const userRecord = await scopedDb.table('users')
        .where({
          user_id: user.user_id,
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const contact = await scopedDb.table('contacts')
        .where({
          contact_name_id: userRecord.contact_id,
        })
        .first();

      if (!contact?.client_id) {
        throw new Error('Contact not associated with a client');
      }

      const clientId = contact.client_id;

      // No permission check needed for usage metrics - all users can access

      console.log(`Fetching usage metrics for client client ${clientId} in tenant ${tenant} from ${startDate} to ${endDate}`);

      const query = scopedDb.table<IUsageRecord>('usage_tracking as ut')
      .where('ut.client_id', clientId)
        .andWhere(trx.raw('ut.usage_date::date'), '>=', startDate)
        .andWhere(trx.raw('ut.usage_date::date'), '<=', endDate)
        .select(
          'ut.service_id',
          'sc.service_name',
          'sc.unit_of_measure',
          trx.raw('SUM(ut.quantity) as total_quantity')
        )
        .groupBy('ut.service_id', 'sc.service_name', 'sc.unit_of_measure')
        .orderBy('sc.service_name');
      scopedDb.tenantJoin(query, 'service_catalog as sc', 'ut.service_id', 'sc.service_id');

      const rawResults: any[] = await query;

      // Map results, ensuring total_quantity is a number
      const results: ClientUsageMetricResult[] = rawResults.map(row => ({
        service_id: row.service_id,
        service_name: row.service_name,
        unit_of_measure: row.unit_of_measure,
        total_quantity: typeof row.total_quantity === 'string' ? parseFloat(row.total_quantity) : row.total_quantity,
      }));

      console.log(`Found ${results.length} usage metric groupings for client client ${clientId}`);
      return results;
    });

    return result;
  } catch (error) {
    const expected = clientPortalActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error(`Error fetching usage metrics in tenant ${tenant}:`, error);
    throw error;
  }
});

// Define the structure for the bucket usage returned data
export interface ClientBucketUsageResult {
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
  percentage_used: number;
  percentage_remaining: number;
  hours_total: number;
  hours_used: number;
  hours_remaining: number;
}

/**
 * Server action to fetch historical bucket usage across multiple periods for the client's account.
 *
 * @param serviceId - Optional service ID to filter by specific service
 * @returns Array of historical bucket usage data grouped by service
 */
export const getClientBucketUsageHistory = withAuth(async (
  user,
  { tenant },
  serviceId?: string
): Promise<{
  service_id: string;
  service_name: string;
  history: Array<{
    period_start: string;
    period_end: string;
    percentage_used: number;
    hours_used: number;
    hours_total: number;
  }>;
}[] | ClientPortalActionError> => {
  const { knex } = await createTenantKnex();

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);

      const userRecord = await scopedDb.table('users').where({ user_id: user.user_id }).first();
      if (!userRecord?.contact_id) throw new Error('User not associated with a contact');

      const contact = await scopedDb.table('contacts').where({ contact_name_id: userRecord.contact_id }).first();
      if (!contact?.client_id) throw new Error('Contact not associated with a client');

      const clientId = contact.client_id;

      let query: any = scopedDb.table('bucket_usage as bu')
        .where('bu.client_id', clientId)
      scopedDb.tenantJoin(query, 'contract_line_service_configuration as clsc', 'bu.contract_line_id', 'clsc.contract_line_id', {
        on(join) {
          join.andOn('bu.service_catalog_id', '=', 'clsc.service_id')
            .andOnVal('clsc.configuration_type', 'Bucket');
        },
      });
      scopedDb.tenantJoin(query, 'contract_line_service_bucket_config as clsb', 'clsc.config_id', 'clsb.config_id');
      scopedDb.tenantJoin(query, 'contract_lines as cl', 'clsc.contract_line_id', 'cl.contract_line_id');
      scopedDb.tenantJoin(query, 'service_catalog as sc', 'clsc.service_id', 'sc.service_id');

      if (serviceId) {
        query = query.andWhere('clsc.service_id', serviceId);
      }

      query = query
        .select(
          'clsc.service_id',
          'sc.service_name',
          'cl.contract_line_id',
          'cl.contract_line_name',
          'bu.period_start',
          'bu.period_end',
          'bu.minutes_used',
          'bu.rolled_over_minutes',
          'clsb.total_minutes'
        )
        .orderBy('clsc.service_id')
        .orderBy('bu.period_start', 'desc');

      const rawResults: any[] = await query;

      const serviceMap = new Map<string, { service_id: string; service_name: string; history: Array<{ period_start: string; period_end: string; percentage_used: number; hours_used: number; hours_total: number; }>; }>();

      rawResults.forEach(row => {
        const totalMinutes = typeof row.total_minutes === 'string' ? parseFloat(row.total_minutes) : row.total_minutes;
        const minutesUsed = typeof row.minutes_used === 'string' ? parseFloat(row.minutes_used) : row.minutes_used;
        const rolledOverMinutes = typeof row.rolled_over_minutes === 'string' ? parseFloat(row.rolled_over_minutes) : row.rolled_over_minutes;
        const totalWithRollover = totalMinutes + rolledOverMinutes;
        const percentageUsed = totalWithRollover > 0 ? (minutesUsed / totalWithRollover) * 100 : 0;
        const hoursUsed = minutesUsed / 60;
        const hoursTotal = totalWithRollover / 60;

        if (!serviceMap.has(row.service_id)) {
          serviceMap.set(row.service_id, { service_id: row.service_id, service_name: row.service_name, history: [] });
        }

        serviceMap.get(row.service_id)!.history.push({
          period_start: row.period_start.toISOString().split('T')[0],
          period_end: row.period_end.toISOString().split('T')[0],
          percentage_used: Math.round(percentageUsed * 100) / 100,
          hours_used: Math.round(hoursUsed * 100) / 100,
          hours_total: Math.round(hoursTotal * 100) / 100,
        });
      });

      return Array.from(serviceMap.values());
    });

    return result;
  } catch (error) {
    const expected = clientPortalActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error(`Error fetching bucket usage history in tenant ${tenant}:`, error);
    throw error;
  }
});

/**
 * This provides more detailed information than the basic getCurrentUsage function.
 *
 * @returns A promise that resolves to an array of detailed bucket usage information.
 */
export const getClientBucketUsage = withAuth(async (user, { tenant }): Promise<ClientBucketUsageResult[] | ClientPortalActionError> => {
  const { knex } = await createTenantKnex();

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);

      // Get user's client_id
      const userRecord = await scopedDb.table('users')
        .where({
          user_id: user.user_id,
        })
        .first();

      if (!userRecord?.contact_id) {
        throw new Error('User not associated with a contact');
      }

      const contact = await scopedDb.table('contacts')
        .where({
          contact_name_id: userRecord.contact_id,
        })
        .first();

      if (!contact?.client_id) {
        throw new Error('Contact not associated with a client');
      }

      const clientId = contact.client_id;

      // No permission check needed for bucket usage - all users can access

      const currentDate = new Date().toISOString().split('T')[0]; // Format as YYYY-MM-DD
      console.log(`Fetching bucket usage for client client ${clientId} in tenant ${tenant} as of ${currentDate}`);

      const query = scopedDb.table<IClientContract>('client_contracts as cc')
      .where('cc.client_id', clientId)
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
      scopedDb.tenantJoin(query, 'contract_lines as cl', 'cc.contract_id', 'cl.contract_id');
      scopedDb.tenantJoin(query, 'contract_line_services as ps', 'cl.contract_line_id', 'ps.contract_line_id');
      scopedDb.tenantJoin(query, 'service_catalog as sc', 'ps.service_id', 'sc.service_id');
      scopedDb.tenantJoin(query, 'contract_line_service_configuration as psc', 'ps.contract_line_id', 'psc.contract_line_id', {
        on(join) {
          join.andOn('ps.service_id', '=', 'psc.service_id');
        },
      });
      scopedDb.tenantJoin(query, 'contract_line_service_bucket_config as psbc', 'psc.config_id', 'psbc.config_id');
      scopedDb.tenantJoin(query, 'bucket_usage as bu', 'cl.contract_line_id', 'bu.contract_line_id', {
        type: 'left',
        on(join) {
          join.andOn('cc.client_id', '=', 'bu.client_id')
            .andOn('bu.period_start', '<=', trx.raw('?', [currentDate]))
            .andOn('bu.period_end', '>', trx.raw('?', [currentDate]));
        },
      });

      const rawResults: any[] = await query;

      const results: ClientBucketUsageResult[] = rawResults.map(row => {
      const totalMinutes = typeof row.total_minutes === 'string' ? parseFloat(row.total_minutes) : row.total_minutes;
      const minutesUsed = typeof row.minutes_used === 'string' ? parseFloat(row.minutes_used) : row.minutes_used;
      const rolledOverMinutes = typeof row.rolled_over_minutes === 'string' ? parseFloat(row.rolled_over_minutes) : row.rolled_over_minutes;
      const remainingMinutes = totalMinutes + rolledOverMinutes - minutesUsed;
      const displayLabel = `${row.contract_line_name} - ${row.service_name}`;

      // Calculate additional metrics for enhanced display
      const totalWithRollover = totalMinutes + rolledOverMinutes;
      const percentageUsed = totalWithRollover > 0 ? (minutesUsed / totalWithRollover) * 100 : 0;
      const percentageRemaining = totalWithRollover > 0 ? (remainingMinutes / totalWithRollover) * 100 : 0;

      // Convert minutes to hours for easier reading
      const hoursTotal = totalWithRollover / 60;
      const hoursUsed = minutesUsed / 60;
      const hoursRemaining = remainingMinutes / 60;

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
          percentage_used: Math.round(percentageUsed * 100) / 100, // Round to 2 decimal places
          percentage_remaining: Math.round(percentageRemaining * 100) / 100,
          hours_total: Math.round(hoursTotal * 100) / 100,
          hours_used: Math.round(hoursUsed * 100) / 100,
          hours_remaining: Math.round(hoursRemaining * 100) / 100
        };
      });

      console.log(`Found ${results.length} active bucket plans for client client ${clientId}`);
      return results;
    });

    return result;
  } catch (error) {
    const expected = clientPortalActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error(`Error fetching bucket usage in tenant ${tenant}:`, error);
    throw error;
  }
});
