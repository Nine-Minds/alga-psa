'use server'

import { Knex } from 'knex'; // Import Knex type
import { createTenantKnex } from '@alga-psa/db';
import { TaxRegion } from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';
interface DefaultTaxRateInfo {
  tax_rate_id: string;
  tax_percentage: number;
  region_code: string | null; // Expect region_code
}

export const fetchTaxRegions = withAuth(async (
  user,
  { tenant }
): Promise<TaxRegion[]> => {
  const {knex: db} = await createTenantKnex();

  // Check permission for time entry reading (reading tax regions for time entries)
  if (!await hasPermission(user, 'timeentry', 'read', db)) {
    throw new Error('Permission denied: Cannot read tax regions for time entries');
  }

  const regions = await db('tax_regions')
    .where({ tenant, is_active: true })
    .select('region_code as id', 'region_name as name')
    .orderBy('region_name');
  return regions;
});

// Phase 1.2: Fetch the default tax rate percentage for the client associated with the work item.
export const fetchClientTaxRateForWorkItem = withAuth(async (
  user,
  { tenant },
  workItemId: string,
  workItemType: string
): Promise<number | undefined> => {
  const {knex: db} = await createTenantKnex();

  // Check permission for time entry reading (reading tax rates for time entries)
  if (!await hasPermission(user, 'timeentry', 'read', db)) {
    throw new Error('Permission denied: Cannot read tax rates for time entries');
  }

  console.log(`Fetching default tax rate percentage for work item ${workItemId} of type ${workItemType}`);

  try {
    let query;

    if (workItemType === 'ticket') {
      query = db('tickets')
        .where({
          'tickets.ticket_id': workItemId,
          'tickets.tenant': tenant
        })
        .join('clients', function(this: Knex.JoinClause) {
          this.on('tickets.client_id', '=', 'clients.client_id')
              .andOn('tickets.tenant', '=', 'clients.tenant');
        });
    } else if (workItemType === 'project_task') {
      query = db('project_tasks')
        .where({
          'project_tasks.task_id': workItemId,
          'project_tasks.tenant': tenant
        })
        .join('project_phases', function(this: Knex.JoinClause) {
          this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
              .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
        })
        .join('projects', function(this: Knex.JoinClause) {
          this.on('project_phases.project_id', '=', 'projects.project_id')
              .andOn('project_phases.tenant', '=', 'projects.tenant');
        })
        .join('clients', function(this: Knex.JoinClause) {
          this.on('projects.client_id', '=', 'clients.client_id')
              .andOn('projects.tenant', '=', 'clients.tenant');
        });
    } else {
      console.log(`Unsupported work item type: ${workItemType}`);
      return undefined;
    }

    query = query
      .join('client_tax_rates', function(this: Knex.JoinClause) {
        this.on('clients.client_id', '=', 'client_tax_rates.client_id');
        this.andOn('clients.tenant', '=', 'client_tax_rates.tenant');
      })
      .join('tax_rates', function(this: Knex.JoinClause) {
        this.on('client_tax_rates.tax_rate_id', '=', 'tax_rates.tax_rate_id')
            .andOn('client_tax_rates.tenant', '=', 'tax_rates.tenant');
      })
      // Phase 1.2: Filter for the default rate AFTER the join
      .where('client_tax_rates.is_default', true)
      .whereNull('client_tax_rates.location_id')
      .select('tax_rates.tax_percentage'); // Select the percentage

    console.log('Executing query:', query.toString());

    const result = await query.first();

    if (result) {
      console.log(`Found default tax percentage: ${result.tax_percentage}`);
      return result.tax_percentage; // Return the percentage
    } else {
      console.log('No default tax rate found for the client associated with this work item.');
      return undefined; // Return undefined if no default rate is found
    }
  } catch (error) {
    console.error('Error fetching tax rate:', error);
    return undefined;
  }
});

// Fetch the default tax rate ID and percentage for the client associated with the work item.
export const fetchDefaultClientTaxRateInfoForWorkItem = withAuth(async (
  user,
  { tenant },
  workItemId: string,
  workItemType: string
): Promise<DefaultTaxRateInfo | null> => {
  const {knex: db} = await createTenantKnex();

  // Check permission for time entry reading (reading tax rate info for time entries)
  if (!await hasPermission(user, 'timeentry', 'read', db)) {
    throw new Error('Permission denied: Cannot read tax rate info for time entries');
  }

  console.log(`Fetching default tax rate info for work item ${workItemId} of type ${workItemType}`);

  try {
    let query;

    if (workItemType === 'ticket') {
      query = db('tickets')
        .where({
          'tickets.ticket_id': workItemId,
          'tickets.tenant': tenant
        })
        .join('clients', function(this: Knex.JoinClause) {
          this.on('tickets.client_id', '=', 'clients.client_id')
              .andOn('tickets.tenant', '=', 'clients.tenant');
        });
    } else if (workItemType === 'project_task') {
      query = db('project_tasks')
        .where({
          'project_tasks.task_id': workItemId,
          'project_tasks.tenant': tenant
        })
        .join('project_phases', function(this: Knex.JoinClause) {
          this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
              .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
        })
        .join('projects', function(this: Knex.JoinClause) {
          this.on('project_phases.project_id', '=', 'projects.project_id')
              .andOn('project_phases.tenant', '=', 'projects.tenant');
        })
        .join('clients', function(this: Knex.JoinClause) {
          this.on('projects.client_id', '=', 'clients.client_id')
              .andOn('projects.tenant', '=', 'clients.tenant');
        });
    } else {
      console.log(`Unsupported work item type: ${workItemType}`);
      return null;
    }

    query = query
      .join('client_tax_rates', function(this: Knex.JoinClause) {
        this.on('clients.client_id', '=', 'client_tax_rates.client_id');
        this.andOn('clients.tenant', '=', 'client_tax_rates.tenant');
      })
      .join('tax_rates', function(this: Knex.JoinClause) {
        this.on('client_tax_rates.tax_rate_id', '=', 'tax_rates.tax_rate_id')
            .andOn('client_tax_rates.tenant', '=', 'tax_rates.tenant');
      })
      // Filter for the default rate AFTER the join
      .where('client_tax_rates.is_default', true)
      .whereNull('client_tax_rates.location_id')
      .select(
        'tax_rates.tax_rate_id', // Select the ID
        'tax_rates.tax_percentage', // Select the percentage
        'tax_rates.region_code' // Select the correct 'region_code' column
      );

    console.log('Executing query for default tax info:', query.toString());

    const result = await query.first();

    if (result) {
      console.log(`Found default tax info: ID=${result.tax_rate_id}, Percentage=${result.tax_percentage}`);
      return {
        tax_rate_id: result.tax_rate_id,
        tax_percentage: result.tax_percentage,
        region_code: result.region_code // Use the correct column name
      };
    } else {
      console.log('No default tax rate info found for the client associated with this work item.');
      return null; // Return null if no default rate is found
    }
  } catch (error) {
    console.error('Error fetching default tax rate info:', error);
    return null;
  }
});

export const fetchServicesForTimeEntry = withAuth(async (
  user,
  { tenant },
  workItemType?: string
): Promise<{ id: string; name: string; type: string; tax_rate_id: string | null; tax_percentage: number | null }[]> => {
  const {knex: db} = await createTenantKnex();

  // Check permission for time entry reading (reading services for time entries)
  if (!await hasPermission(user, 'timeentry', 'read', db)) {
    throw new Error('Permission denied: Cannot read services for time entries');
  }

  let query = db('service_catalog as sc')
    .leftJoin('service_types as st', function() {
      this.on('sc.custom_service_type_id', '=', 'st.id')
          .andOn('sc.tenant', '=', 'st.tenant');
    })
    .leftJoin('tax_rates as tr', function() {
      this.on('sc.tax_rate_id', '=', 'tr.tax_rate_id')
          .andOn('sc.tenant', '=', 'tr.tenant');
    })
    .where({ 'sc.tenant': tenant })
    .select(
      'sc.service_id as id',
      'sc.service_name as name',
      'sc.billing_method as type',
      'sc.tax_rate_id',
      'tr.tax_percentage'
    );

  // For ad_hoc entries, only show Time-based services
  if (workItemType === 'ad_hoc') {
    // Assuming 'Time' service type maps to 'usage' billing method based on migrations
    query = query.where('sc.billing_method', 'usage');
  }

  const services = await query;
  return services;
});

/**
 * Fetches schedule entry information for a work item
 * @param workItemId The work item ID
 * @returns The schedule entry information or null if not found
 */
export const fetchScheduleEntryForWorkItem = withAuth(async (
  user,
  { tenant },
  workItemId: string
): Promise<{
  scheduled_start: string;
  scheduled_end: string
} | null> => {
  const { knex } = await createTenantKnex();

  // Check permission for time entry reading (reading schedule entries for time entries)
  if (!await hasPermission(user, 'timeentry', 'read', knex)) {
    throw new Error('Permission denied: Cannot read schedule entries for time entries');
  }

  try {
    const scheduleEntry = await knex('schedule_entries')
      .where('entry_id', workItemId)
      .select('scheduled_start', 'scheduled_end')
      .first();

    return scheduleEntry || null;
  } catch (error) {
    console.error('Error fetching schedule entry for work item:', error);
    return null;
  }
});
