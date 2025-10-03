'use server';

import { Knex } from 'knex';
import { createTenantKnex } from '../db';
import { IClientBillingPlan } from '../../interfaces/billing.interfaces';

/**
 * Determines the default billing plan for a time entry or usage record
 * @param clientId The client ID
 * @param serviceId The service ID
 * @returns The recommended billing plan ID or null if explicit selection is required
 */
export async function determineDefaultBillingPlan(
  clientId: string,
  serviceId: string
): Promise<string | null> {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error("Tenant context not found");
  }

  try {
    // Get all billing plans for the client that include this service
    const eligiblePlans = await getEligibleBillingPlans(knex, tenant, clientId, serviceId);
    
    // If only one plan exists, use it
    if (eligiblePlans.length === 1) {
      return eligiblePlans[0].client_billing_plan_id;
    }
    
    // If no plans exist, return null
    if (eligiblePlans.length === 0) {
      return null;
    }
    
    // Check for bucket plans
    const bucketPlans = eligiblePlans.filter(plan => 
      plan.plan_type === 'Bucket'
    );
    
    if (bucketPlans.length === 1) {
      return bucketPlans[0].client_billing_plan_id;
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
export async function getEligibleBillingPlans(
  knex: Knex,
  tenant: string,
  clientId: string,
  serviceId: string
): Promise<(IClientBillingPlan & { plan_type: string })[]> {
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
  const query = knex('client_billing_plans')
    .join('billing_plans', function() {
      this.on('client_billing_plans.plan_id', '=', 'billing_plans.plan_id')
          .andOn('billing_plans.tenant', '=', 'client_billing_plans.tenant');
    })
    .join('plan_services', function() {
      this.on('billing_plans.plan_id', '=', 'plan_services.plan_id')
          .andOn('plan_services.tenant', '=', 'billing_plans.tenant');
    })
    .where({
      'client_billing_plans.client_id': clientId,
      'client_billing_plans.is_active': true,
      'client_billing_plans.tenant': tenant,
      'plan_services.service_id': serviceId
    })
    .where(function(this: Knex.QueryBuilder) {
      this.whereNull('client_billing_plans.end_date')
        .orWhere('client_billing_plans.end_date', '>', new Date().toISOString());
    });

  console.log('service category id', serviceInfo.category_id);
  
  // Filter by service category if available
  if (serviceInfo.category_id) {
    // Filter plans based on the service_category field in client_billing_plans
    // This ensures we only get plans that are assigned to the same category as the service
    query.where(function() {
      this.where('client_billing_plans.service_category', serviceInfo.category_id)
          .orWhereNull('client_billing_plans.service_category'); // Also include plans with no category specified
    });
  }
  
  // Filter by service type to ensure compatibility
  // if (serviceInfo.service_type) {
  //   // Make sure the plan type is compatible with the service type
  //   // For example, Time services should only be used with Hourly or Bucket plans
  //   if (serviceInfo.service_type === 'Time') {
  //     query.whereIn('billing_plans.plan_type', ['Hourly', 'Bucket']);
  //   } else if (serviceInfo.service_type === 'Fixed') {
  //     query.whereIn('billing_plans.plan_type', ['Fixed', 'Bucket']);
  //   } else if (serviceInfo.service_type === 'Usage') {
  //     query.whereIn('billing_plans.plan_type', ['Usage', 'Bucket']);
  //   }
  // }

  console.log(query.toString());
  
  // Execute the query and return the results
  return query.select(
    'client_billing_plans.*',
    'billing_plans.plan_type',
    'billing_plans.plan_name'
  );
}

/**
 * Validates if a billing plan is valid for a given service
 * @param clientId The client ID
 * @param serviceId The service ID
 * @param billingPlanId The billing plan ID to validate
 * @returns True if the billing plan is valid for the service, false otherwise
 */
export async function validateBillingPlanForService(
  clientId: string,
  serviceId: string,
  billingPlanId: string
): Promise<boolean> {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error("Tenant context not found");
  }

  try {
    const eligiblePlans = await getEligibleBillingPlans(knex, tenant, clientId, serviceId);
    return eligiblePlans.some(plan => plan.client_billing_plan_id === billingPlanId);
  } catch (error) {
    console.error('Error validating billing plan for service:', error);
    return false;
  }
}

/**
 * Allocates unassigned time entries or usage records to the appropriate billing plan
 * @param clientId The client ID
 * @param serviceId The service ID
 * @param billingPlanId The billing plan ID to check against
 * @returns True if the unassigned entry should be allocated to this plan, false otherwise
 */
export async function shouldAllocateUnassignedEntry(
  clientId: string,
  serviceId: string,
  billingPlanId: string
): Promise<boolean> {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error("Tenant context not found");
  }

  try {
    const eligiblePlans = await getEligibleBillingPlans(knex, tenant, clientId, serviceId);
    
    // If this is the only eligible plan, allocate to it
    if (eligiblePlans.length === 1 && eligiblePlans[0].client_billing_plan_id === billingPlanId) {
      return true;
    }
    
    // If there are multiple eligible plans, check if this is a bucket plan
    const bucketPlans = eligiblePlans.filter(plan => plan.plan_type === 'Bucket');
    if (bucketPlans.length === 1 && bucketPlans[0].client_billing_plan_id === billingPlanId) {
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
export async function getEligibleBillingPlansForUI(
  clientId: string,
  serviceId: string
): Promise<Array<{
  client_billing_plan_id: string;
  plan_name: string;
  plan_type: string;
}>> {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error("Tenant context not found");
  }

  try {
    const plans = await getEligibleBillingPlans(knex, tenant, clientId, serviceId);
    
    // Transform to a simpler structure for UI
    // Transform to the structure expected by the UI, including dates
    return plans.map(plan => ({
      client_billing_plan_id: plan.client_billing_plan_id,
      plan_name: plan.plan_name || 'Unnamed Plan',
      plan_type: plan.plan_type,
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