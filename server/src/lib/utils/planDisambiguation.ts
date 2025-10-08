'use server';

import { Knex } from 'knex';
import { createTenantKnex } from '../db';
import { IClientContractLine } from '../../interfaces/billing.interfaces';

/**
 * Determines the default billing plan for a time entry or usage record
 * @param clientId The client ID
 * @param serviceId The service ID
 * @returns The recommended billing plan ID or null if explicit selection is required
 */
export async function determineDefaultContractLine(
  clientId: string,
  serviceId: string
): Promise<string | null> {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error("Tenant context not found");
  }

  try {
    // Get all billing plans for the client that include this service
    const eligiblePlans = await getEligibleContractLines(knex, tenant, clientId, serviceId);
    
    // If only one plan exists, use it
    if (eligiblePlans.length === 1) {
      return eligiblePlans[0].client_contract_line_id;
    }
    
    // If no plans exist, return null
    if (eligiblePlans.length === 0) {
      return null;
    }
    
    // Check for bucket plans
    const bucketPlans = eligiblePlans.filter(plan => 
      plan.contract_line_type === 'Bucket'
    );
    
    if (bucketPlans.length === 1) {
      return bucketPlans[0].client_contract_line_id;
    }
    
    // If we have multiple plans and no clear default, return null to require explicit selection
    return null;
  } catch (error) {
    console.error('Error determining default billing plan:', error);
    return null;
  }
}

/**
 * Gets all eligible billing plans for a client and service
 * @param knex The Knex instance
 * @param tenant The tenant ID
 * @param clientId The client ID
 * @param serviceId The service ID
 * @returns Array of eligible billing plans
 */
export async function getEligibleContractLines(
  knex: Knex,
  tenant: string,
  clientId: string,
  serviceId: string
): Promise<(IClientContractLine & { contract_line_type: string })[]> {
  // First, get the service category for the given service
  const serviceInfo = await knex('service_catalog')
    .where({
      'service_catalog.service_id': serviceId,
      'service_catalog.tenant': tenant
    })
    .first('category_id', 'custom_service_type_id as service_type_id');
  
  if (!serviceInfo) {
    console.warn(`Service not found: ${serviceId}`);
    return [];
  }
  
  // Build the query to get eligible billing plans
  const query = knex('client_contract_lines')
    .join('contract_lines', function() {
      this.on('client_contract_lines.contract_line_id', '=', 'contract_lines.contract_line_id')
          .andOn('contract_lines.tenant', '=', 'client_contract_lines.tenant');
    })
    .join('plan_services', function() {
      this.on('contract_lines.contract_line_id', '=', 'plan_services.contract_line_id')
          .andOn('plan_services.tenant', '=', 'contract_lines.tenant');
    })
    .where({
      'client_contract_lines.client_id': clientId,
      'client_contract_lines.is_active': true,
      'client_contract_lines.tenant': tenant,
      'plan_services.service_id': serviceId
    })
    .where(function(this: Knex.QueryBuilder) {
      this.whereNull('client_contract_lines.end_date')
        .orWhere('client_contract_lines.end_date', '>', new Date().toISOString());
    });

  console.log('service category id', serviceInfo.category_id);
  
  // Filter by service category if available
  if (serviceInfo.category_id) {
    // Filter plans based on the service_category field in client_contract_lines
    // This ensures we only get plans that are assigned to the same category as the service
    query.where(function() {
      this.where('client_contract_lines.service_category', serviceInfo.category_id)
          .orWhereNull('client_contract_lines.service_category'); // Also include plans with no category specified
    });
  }
  
  // Filter by service type to ensure compatibility
  // if (serviceInfo.service_type) {
  //   // Make sure the plan type is compatible with the service type
  //   // For example, Time services should only be used with Hourly or Bucket plans
  //   if (serviceInfo.service_type === 'Time') {
  //     query.whereIn('contract_lines.contract_line_type', ['Hourly', 'Bucket']);
  //   } else if (serviceInfo.service_type === 'Fixed') {
  //     query.whereIn('contract_lines.contract_line_type', ['Fixed', 'Bucket']);
  //   } else if (serviceInfo.service_type === 'Usage') {
  //     query.whereIn('contract_lines.contract_line_type', ['Usage', 'Bucket']);
  //   }
  // }

  console.log(query.toString());
  
  // Execute the query and return the results
  return query.select(
    'client_contract_lines.*',
    'contract_lines.contract_line_type',
    'contract_lines.contract_line_name'
  );
}

/**
 * Validates if a billing plan is valid for a given service
 * @param clientId The client ID
 * @param serviceId The service ID
 * @param contractLineId The billing plan ID to validate
 * @returns True if the billing plan is valid for the service, false otherwise
 */
export async function validateContractLineForService(
  clientId: string,
  serviceId: string,
  contractLineId: string
): Promise<boolean> {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error("Tenant context not found");
  }

  try {
    const eligiblePlans = await getEligibleContractLines(knex, tenant, clientId, serviceId);
    return eligiblePlans.some(plan => plan.client_contract_line_id === contractLineId);
  } catch (error) {
    console.error('Error validating billing plan for service:', error);
    return false;
  }
}

/**
 * Allocates unassigned time entries or usage records to the appropriate billing plan
 * @param clientId The client ID
 * @param serviceId The service ID
 * @param contractLineId The billing plan ID to check against
 * @returns True if the unassigned entry should be allocated to this plan, false otherwise
 */
export async function shouldAllocateUnassignedEntry(
  clientId: string,
  serviceId: string,
  contractLineId: string
): Promise<boolean> {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error("Tenant context not found");
  }

  try {
    const eligiblePlans = await getEligibleContractLines(knex, tenant, clientId, serviceId);
    
    // If this is the only eligible plan, allocate to it
    if (eligiblePlans.length === 1 && eligiblePlans[0].client_contract_line_id === contractLineId) {
      return true;
    }
    
    // If there are multiple eligible plans, check if this is a bucket plan
    const bucketPlans = eligiblePlans.filter(plan => plan.contract_line_type === 'Bucket');
    if (bucketPlans.length === 1 && bucketPlans[0].client_contract_line_id === contractLineId) {
      return true;
    }
    
    // Otherwise, don't allocate unassigned entries to this plan
    return false;
  } catch (error) {
    console.error('Error determining if unassigned entry should be allocated:', error);
    return false;
  }
}

/**
 * Gets eligible billing plans for a client and service - UI friendly version
 * @param clientId The client ID
 * @param serviceId The service ID
 * @returns Array of eligible billing plans with simplified structure
 */
export async function getEligibleContractLinesForUI(
  clientId: string,
  serviceId: string
): Promise<Array<{
  client_contract_line_id: string;
  contract_line_name: string;
  contract_line_type: string;
}>> {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error("Tenant context not found");
  }

  try {
    const plans = await getEligibleContractLines(knex, tenant, clientId, serviceId);
    
    // Transform to a simpler structure for UI
    // Transform to the structure expected by the UI, including dates
    return plans.map(plan => ({
      client_contract_line_id: plan.client_contract_line_id,
      contract_line_name: plan.contract_line_name || 'Unnamed Plan',
      contract_line_type: plan.contract_line_type,
      start_date: plan.start_date, // Include start_date
      end_date: plan.end_date // Include end_date
    }));
  } catch (error) {
    console.error('Error getting eligible billing plans for UI:', error);
    return [];
  }
}

/**
 * Gets the client ID for a work item
 * @param workItemId The work item ID
 * @param workItemType The work item type ('project_task' or 'ticket')
 * @returns The client ID or null if not found
 */
export async function getClientIdForWorkItem(
  workItemId: string,
  workItemType: string
): Promise<string | null> {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error("Tenant context not found");
  }

  try {
    if (workItemType === 'project_task') {
      const result = await knex('project_tasks')
        .join('project_phases', function() {
          this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
              .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
        })
        .join('projects', function() {
          this.on('project_phases.project_id', '=', 'projects.project_id')
              .andOn('project_phases.tenant', '=', 'projects.tenant');
        })
        .where({ 'project_tasks.task_id': workItemId, 'project_tasks.tenant': tenant })
        .first('projects.client_id');
      
      return result?.client_id || null;
    } else if (workItemType === 'ticket') {
      const result = await knex('tickets')
        .where({ ticket_id: workItemId, tenant })
        .first('client_id');
      
      return result?.client_id || null;
    } else if (workItemType === 'interaction') {
      const result = await knex('interactions')
        .where({ interaction_id: workItemId, tenant })
        .first('client_id');
      
      return result?.client_id || null;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting client ID for work item:', error);
    return null;
  }
}