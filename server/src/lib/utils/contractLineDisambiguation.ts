'use server';

import { Knex } from 'knex';
import { createTenantKnex } from '../db';
import { IClientContractLine } from '../../interfaces/billing.interfaces';

type EligibleContractLine = IClientContractLine & {
  contract_line_type: string;
  bucket_overlay?: {
    config_id: string;
    total_minutes?: number | null;
    overage_rate?: number | null;
    allow_rollover?: boolean | null;
  };
};

/**
 * Determines the default contract line for a time entry or usage record
 * @param clientId The client ID
 * @param serviceId The service ID
 * @returns The recommended contract line ID or null if explicit selection is required
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
    // Get all contract lines for the client that include this service
    const eligibleContractLines = await getEligibleContractLines(knex, tenant, clientId, serviceId);

    // If only one contract line exists, use it
    if (eligibleContractLines.length === 1) {
      return eligibleContractLines[0].client_contract_line_id;
    }

    // If no contract lines exist, return null
    if (eligibleContractLines.length === 0) {
      return null;
    }

    // Prefer contract lines that have a bucket overlay configuration
    const overlayContractLines = eligibleContractLines.filter(contractLine => contractLine.bucket_overlay?.config_id);
    if (overlayContractLines.length === 1) {
      return overlayContractLines[0].client_contract_line_id;
    }

    // Fallback: check for legacy bucket contract lines (during migration)
    const bucketContractLines = eligibleContractLines.filter(contractLine =>
      contractLine.contract_line_type === 'Bucket'
    );

    if (bucketContractLines.length === 1) {
      return bucketContractLines[0].client_contract_line_id;
    }

    // If we have multiple contract lines and no clear default, return null to require explicit selection
    return null;
  } catch (error) {
    console.error('Error determining default contract line:', error);
    return null;
  }
}

/**
 * Gets all eligible contract lines for a client and service
 * @param knex The Knex instance
 * @param tenant The tenant ID
 * @param clientId The client ID
 * @param serviceId The service ID
 * @returns Array of eligible contract lines
 */
export async function getEligibleContractLines(
  knex: Knex,
  tenant: string,
  clientId: string,
  serviceId: string
): Promise<EligibleContractLine[]> {
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
  
  // Build the query to get eligible contract lines
  const query = knex('client_contract_lines')
    .join('contract_lines', function() {
      this.on('client_contract_lines.contract_line_id', '=', 'contract_lines.contract_line_id')
          .andOn('contract_lines.tenant', '=', 'client_contract_lines.tenant');
    })
    .join('contract_line_services', function() {
      this.on('contract_lines.contract_line_id', '=', 'contract_line_services.contract_line_id')
          .andOn('contract_line_services.tenant', '=', 'contract_lines.tenant');
    })
    .leftJoin('contract_line_service_configuration as bucket_config', function() {
      this.on('bucket_config.contract_line_id', '=', 'contract_lines.contract_line_id')
          .andOn('bucket_config.tenant', '=', 'contract_lines.tenant')
          .andOn('bucket_config.service_id', '=', 'contract_line_services.service_id')
          .andOnVal('bucket_config.configuration_type', 'Bucket');
    })
    .leftJoin('contract_line_service_bucket_config as bucket_details', function() {
      this.on('bucket_details.config_id', '=', 'bucket_config.config_id')
          .andOn('bucket_details.tenant', '=', 'bucket_config.tenant');
    })
    .where({
      'client_contract_lines.client_id': clientId,
      'client_contract_lines.is_active': true,
      'client_contract_lines.tenant': tenant,
      'contract_line_services.service_id': serviceId
    })
    .where(function(this: Knex.QueryBuilder) {
      this.whereNull('client_contract_lines.end_date')
        .orWhere('client_contract_lines.end_date', '>', new Date().toISOString());
    });

  // Filter by service category if available
  if (serviceInfo.category_id) {
    // Filter contract lines based on the service_category field in client_contract_lines
    // This ensures we only get contract lines that are assigned to the same category as the service
    query.where(function() {
      this.where('client_contract_lines.service_category', serviceInfo.category_id)
          .orWhereNull('client_contract_lines.service_category'); // Also include contract lines with no category specified
    });
  }

  // Filter by service type to ensure compatibility
  // if (serviceInfo.service_type) {
  //   // Make sure the contract line type is compatible with the service type
  //   // For example, Time services should only be used with Hourly or Bucket contract lines
  //   if (serviceInfo.service_type === 'Time') {
  //     query.whereIn('contract_lines.contract_line_type', ['Hourly', 'Bucket']);
  //   } else if (serviceInfo.service_type === 'Fixed') {
  //     query.whereIn('contract_lines.contract_line_type', ['Fixed', 'Bucket']);
  //   } else if (serviceInfo.service_type === 'Usage') {
  //     query.whereIn('contract_lines.contract_line_type', ['Usage', 'Bucket']);
  //   }
  // }

  // Execute the query and return the results
  const rows = await query.select(
    'client_contract_lines.*',
    'contract_lines.contract_line_type',
    'contract_lines.contract_line_name',
    'bucket_config.config_id as bucket_config_id',
    'bucket_details.total_minutes as bucket_total_minutes',
    'bucket_details.overage_rate as bucket_overage_rate',
    'bucket_details.allow_rollover as bucket_allow_rollover'
  );

  return rows.map(row => {
    const {
      bucket_config_id,
      bucket_total_minutes,
      bucket_overage_rate,
      bucket_allow_rollover,
      ...rest
    } = row as Record<string, any>;

    const { bucket_overlay: existingOverlay, ...restWithoutOverlay } = rest;

    const bucket_overlay = bucket_config_id
      ? {
          config_id: bucket_config_id,
          total_minutes: bucket_total_minutes ?? null,
          overage_rate: bucket_overage_rate ?? null,
          allow_rollover: bucket_allow_rollover ?? null
        }
      : existingOverlay;

    return {
      ...restWithoutOverlay,
      bucket_overlay
    } as EligibleContractLine;
  });
}

/**
 * Validates if a contract line is valid for a given service
 * @param clientId The client ID
 * @param serviceId The service ID
 * @param contractLineId The contract line ID to validate
 * @returns True if the contract line is valid for the service, false otherwise
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
    const eligibleContractLines = await getEligibleContractLines(knex, tenant, clientId, serviceId);
    return eligibleContractLines.some(contractLine => contractLine.client_contract_line_id === contractLineId);
  } catch (error) {
    console.error('Error validating contract line for service:', error);
    return false;
  }
}

/**
 * Allocates unassigned time entries or usage records to the appropriate contract line
 * @param clientId The client ID
 * @param serviceId The service ID
 * @param contractLineId The contract line ID to check against
 * @returns True if the unassigned entry should be allocated to this contract line, false otherwise
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
    const eligibleContractLines = await getEligibleContractLines(knex, tenant, clientId, serviceId);

    // If this is the only eligible contract line, allocate to it
    if (eligibleContractLines.length === 1 && eligibleContractLines[0].client_contract_line_id === contractLineId) {
      return true;
    }

    // If there are multiple eligible contract lines, prefer ones with bucket overlays
    const overlayContractLines = eligibleContractLines.filter(contractLine => contractLine.bucket_overlay?.config_id);
    if (overlayContractLines.length === 1 && overlayContractLines[0].client_contract_line_id === contractLineId) {
      return true;
    }

    // Fallback legacy behavior for bucket contract lines
    const bucketContractLines = eligibleContractLines.filter(contractLine => contractLine.contract_line_type === 'Bucket');
    if (bucketContractLines.length === 1 && bucketContractLines[0].client_contract_line_id === contractLineId) {
      return true;
    }

    // Otherwise, don't allocate unassigned entries to this contract line
    return false;
  } catch (error) {
    console.error('Error determining if unassigned entry should be allocated:', error);
    return false;
  }
}

/**
 * Gets eligible contract lines for a client and service - UI friendly version
 * @param clientId The client ID
 * @param serviceId The service ID
 * @returns Array of eligible contract lines with simplified structure
 */
export async function getEligibleContractLinesForUI(
  clientId: string,
  serviceId: string
): Promise<Array<{
  client_contract_line_id: string;
  contract_line_name: string;
  contract_line_type: string;
  start_date: string;
  end_date: string | null;
  has_bucket_overlay: boolean;
  bucket_overlay?: EligibleContractLine['bucket_overlay'];
}>> {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error("Tenant context not found");
  }

  try {
    const contractLines = await getEligibleContractLines(knex, tenant, clientId, serviceId);

    // Transform to a simpler structure for UI
    // Transform to the structure expected by the UI, including dates
    return contractLines.map(contractLine => {
      const hasBucketOverlay = Boolean(contractLine.bucket_overlay?.config_id);

      return {
        client_contract_line_id: contractLine.client_contract_line_id,
        contract_line_name: contractLine.contract_line_name || 'Unnamed Contract Line',
        contract_line_type: contractLine.contract_line_type,
        start_date: contractLine.start_date,
        end_date: contractLine.end_date,
        has_bucket_overlay: hasBucketOverlay,
        bucket_overlay: contractLine.bucket_overlay
      };
    });
  } catch (error) {
    console.error('Error getting eligible contract lines for UI:', error);
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
