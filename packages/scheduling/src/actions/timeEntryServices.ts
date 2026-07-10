'use server'

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { TaxRegion } from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';
import {
  timeSheetActionErrorFrom,
  type TimeSheetActionError,
} from './timeSheetActionErrors';
interface DefaultTaxRateInfo {
  tax_rate_id: string;
  tax_percentage: number;
  region_code: string | null; // Expect region_code
}

export const fetchTaxRegions = withAuth(async (
  user,
  { tenant }
): Promise<TaxRegion[] | TimeSheetActionError> => {
  try {
    const {knex: db} = await createTenantKnex();
    const scopedDb = tenantDb(db, tenant) as any;

    // Check permission for time entry reading (reading tax regions for time entries)
    if (!await hasPermission(user, 'timeentry', 'read', db)) {
      throw new Error('Permission denied: Cannot read tax regions for time entries');
    }

    const regions = await scopedDb.table('tax_regions')
      .where({ is_active: true })
      .select('region_code as id', 'region_name as name')
      .orderBy('region_name');
    return regions;
  } catch (error) {
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

// Phase 1.2: Fetch the default tax rate percentage for the client associated with the work item.
export const fetchClientTaxRateForWorkItem = withAuth(async (
  user,
  { tenant },
  workItemId: string,
  workItemType: string
): Promise<number | undefined | TimeSheetActionError> => {
  try {
    const {knex: db} = await createTenantKnex();
    const scopedDb = tenantDb(db, tenant) as any;

    // Check permission for time entry reading (reading tax rates for time entries)
    if (!await hasPermission(user, 'timeentry', 'read', db)) {
      throw new Error('Permission denied: Cannot read tax rates for time entries');
    }

    console.log(`Fetching default tax rate percentage for work item ${workItemId} of type ${workItemType}`);

    let query;

    if (workItemType === 'ticket') {
      query = scopedDb.table('tickets')
        .where({
          'tickets.ticket_id': workItemId
        });
      scopedDb.tenantJoin(query, 'clients', 'tickets.client_id', 'clients.client_id');
    } else if (workItemType === 'project_task') {
      query = scopedDb.table('project_tasks')
        .where({
          'project_tasks.task_id': workItemId
        });
      scopedDb.tenantJoin(query, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
      scopedDb.tenantJoin(query, 'projects', 'project_phases.project_id', 'projects.project_id');
      scopedDb.tenantJoin(query, 'clients', 'projects.client_id', 'clients.client_id');
    } else {
      console.log(`Unsupported work item type: ${workItemType}`);
      return undefined;
    }

    scopedDb.tenantJoin(query, 'client_tax_rates', 'clients.client_id', 'client_tax_rates.client_id');
    scopedDb.tenantJoin(query, 'tax_rates', 'client_tax_rates.tax_rate_id', 'tax_rates.tax_rate_id');

    query = query
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
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    return undefined;
  }
});

// Fetch the default tax rate ID and percentage for the client associated with the work item.
export const fetchDefaultClientTaxRateInfoForWorkItem = withAuth(async (
  user,
  { tenant },
  workItemId: string,
  workItemType: string
): Promise<DefaultTaxRateInfo | null | TimeSheetActionError> => {
  try {
    const {knex: db} = await createTenantKnex();
    const scopedDb = tenantDb(db, tenant) as any;

    // Check permission for time entry reading (reading tax rate info for time entries)
    if (!await hasPermission(user, 'timeentry', 'read', db)) {
      throw new Error('Permission denied: Cannot read tax rate info for time entries');
    }

    console.log(`Fetching default tax rate info for work item ${workItemId} of type ${workItemType}`);

    let query;

    if (workItemType === 'ticket') {
      query = scopedDb.table('tickets')
        .where({
          'tickets.ticket_id': workItemId
        });
      scopedDb.tenantJoin(query, 'clients', 'tickets.client_id', 'clients.client_id');
    } else if (workItemType === 'project_task') {
      query = scopedDb.table('project_tasks')
        .where({
          'project_tasks.task_id': workItemId
        });
      scopedDb.tenantJoin(query, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
      scopedDb.tenantJoin(query, 'projects', 'project_phases.project_id', 'projects.project_id');
      scopedDb.tenantJoin(query, 'clients', 'projects.client_id', 'clients.client_id');
    } else {
      console.log(`Unsupported work item type: ${workItemType}`);
      return null;
    }

    scopedDb.tenantJoin(query, 'client_tax_rates', 'clients.client_id', 'client_tax_rates.client_id');
    scopedDb.tenantJoin(query, 'tax_rates', 'client_tax_rates.tax_rate_id', 'tax_rates.tax_rate_id');

    query = query
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
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    return null;
  }
});

export const fetchServicesForTimeEntry = withAuth(async (
  user,
  { tenant },
  _workItemType?: string
): Promise<{ id: string; name: string; type: string; tax_rate_id: string | null; tax_percentage: number | null }[] | TimeSheetActionError> => {
  try {
    const {knex: db} = await createTenantKnex();
    const scopedDb = tenantDb(db, tenant) as any;

    // Check permission for time entry reading (reading services for time entries)
    if (!await hasPermission(user, 'timeentry', 'read', db)) {
      throw new Error('Permission denied: Cannot read services for time entries');
    }

    const servicesQuery = scopedDb.table('service_catalog as sc')
      .where({
        'sc.item_kind': 'service',
        'sc.billing_method': 'hourly'
      });
    scopedDb.tenantJoin(servicesQuery, 'tax_rates as tr', 'sc.tax_rate_id', 'tr.tax_rate_id', { type: 'left' });

    const services = await servicesQuery
      .select(
        'sc.service_id as id',
        'sc.service_name as name',
        'sc.billing_method as type',
        'sc.tax_rate_id',
        'tr.tax_percentage'
      );

    return services;
  } catch (error) {
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
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
} | null | TimeSheetActionError> => {
  try {
    const { knex } = await createTenantKnex();
    const scopedDb = tenantDb(knex, tenant) as any;

    // Check permission for time entry reading (reading schedule entries for time entries)
    if (!await hasPermission(user, 'timeentry', 'read', knex)) {
      throw new Error('Permission denied: Cannot read schedule entries for time entries');
    }

    const scheduleEntry = await scopedDb.table('schedule_entries')
      .where('entry_id', workItemId)
      .select('scheduled_start', 'scheduled_end')
      .first();

    return scheduleEntry || null;
  } catch (error) {
    console.error('Error fetching schedule entry for work item:', error);
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    return null;
  }
});
