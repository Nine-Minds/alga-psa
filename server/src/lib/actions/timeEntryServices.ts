'use server'

import { Knex } from 'knex'; // Import Knex type
import { createTenantKnex } from 'server/src/lib/db';
import { TaxRegion } from 'server/src/types/types.d';

export async function fetchTaxRegions(): Promise<TaxRegion[]> {
  const {knex: db, tenant} = await createTenantKnex();
  const regions = await db('tax_regions')
    .where({ tenant, is_active: true })
    .select('region_code as id', 'region_name as name')
    .orderBy('region_name');
  return regions;
}

export async function fetchCompanyTaxRateForWorkItem(workItemId: string, workItemType: string): Promise<string | undefined> {
  console.log(`Fetching tax rate for work item ${workItemId} of type ${workItemType}`);

  const {knex: db, tenant} = await createTenantKnex();

  try {
    let query;

    if (workItemType === 'ticket') {
      query = db('tickets')
        .where({
          'tickets.ticket_id': workItemId,
          'tickets.tenant': tenant
        })
        .join('companies', function() {
          this.on('tickets.company_id', '=', 'companies.company_id')
              .andOn('tickets.tenant', '=', 'companies.tenant');
        });
    } else if (workItemType === 'project_task') {
      query = db('project_tasks')
        .where({
          'project_tasks.task_id': workItemId,
          'project_tasks.tenant': tenant
        })
        .join('project_phases', function() {
          this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
              .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
        })
        .join('projects', function() {
          this.on('project_phases.project_id', '=', 'projects.project_id')
              .andOn('project_phases.tenant', '=', 'projects.tenant');
        })
        .join('companies', function() {
          this.on('projects.company_id', '=', 'companies.company_id')
              .andOn('projects.tenant', '=', 'companies.tenant');
        });
    } else {
      console.log(`Unsupported work item type: ${workItemType}`);
      return undefined;
    }

    query = query
      .join('company_tax_rates', function() {
        this.on('companies.company_id', '=', 'company_tax_rates.company_id')
            .andOn('companies.tenant', '=', 'company_tax_rates.tenant');
      })
      .join('tax_rates', function() {
        this.on('company_tax_rates.tax_rate_id', '=', 'tax_rates.tax_rate_id')
            .andOn('company_tax_rates.tenant', '=', 'tax_rates.tenant');
      })
      .select('tax_rates.region_code'); // Corrected column name

    console.log('Executing query:', query.toString());

    const result = await query.first();

    if (result) {
      console.log(`Found tax region code: ${result.region_code}`);
      return result.region_code; // Use the corrected field name
    } else {
      console.log('No tax region found');
      return undefined;
    }
  } catch (error) {
    console.error('Error fetching tax rate:', error);
    return undefined;
  }
}

export async function fetchServicesForTimeEntry(workItemType?: string): Promise<{ id: string; name: string; type: string; is_taxable: boolean; region_code: string | null }[]> {
  const {knex: db, tenant} = await createTenantKnex();

  let query = db('service_catalog as sc')
    .leftJoin('standard_service_types as sst', 'sc.standard_service_type_id', 'sst.id')
    .leftJoin('service_types as tst', function() {
      this.on('sc.custom_service_type_id', '=', 'tst.id')
          .andOn('sc.tenant', '=', 'tst.tenant_id');
    })
    .where({ 'sc.tenant': tenant })
    .select(
      'sc.service_id as id',
      'sc.service_name as name',
      'sc.billing_method as type', // Use billing_method as type
      'sc.is_taxable',
      'sc.region_code' // Added region_code selection
    );

  // For ad_hoc entries, only show Time-based services
  if (workItemType === 'ad_hoc') {
    // Assuming 'Time' service type maps to 'per_unit' billing method based on migrations
    query = query.where('sc.billing_method', 'per_unit');
  }

  const services = await query;
  return services;
}

/**
 * Fetches schedule entry information for a work item
 * @param workItemId The work item ID
 * @returns The schedule entry information or null if not found
 */
export async function fetchScheduleEntryForWorkItem(workItemId: string): Promise<{
  scheduled_start: string;
  scheduled_end: string
} | null> {
  try {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error("Tenant context not found");
    }

    const scheduleEntry = await knex('schedule_entries')
      .where('entry_id', workItemId)
      .select('scheduled_start', 'scheduled_end')
      .first();

    return scheduleEntry || null;
  } catch (error) {
    console.error('Error fetching schedule entry for work item:', error);
    return null;
  }
}