/**
 * Customer Tracking Activities for Temporal Workflows
 * These activities create customer records in the nineminds (management) tenant
 * when new PSA tenants are provisioned.
 */

import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { ClientModel } from '@alga-psa/shared/models/clientModel.js';
import { ContactModel } from '@alga-psa/shared/models/contactModel.js';
import { TagModel } from '@alga-psa/shared/models/tagModel.js';
import { Knex } from 'knex';

/**
 * Get the management tenant ID for 'Nine Minds LLC'
 * @throws Error if management tenant doesn't exist
 */
async function getManagementTenantIdInternal(knex: Knex): Promise<string> {
  const MANAGEMENT_TENANT_NAME = 'Nine Minds LLC';
  
  // NOTE: tenants is a reference table
  const tenant = await knex('tenants')
    .where('client_name', MANAGEMENT_TENANT_NAME)
    .first();
  
  if (!tenant) {
    throw new Error(`Management tenant '${MANAGEMENT_TENANT_NAME}' not found. This tenant must exist for customer tracking.`);
  }
  
  return tenant.tenant;
}

/**
 * Activity to get the management tenant ID
 * This can be called by workflows to get the Nine Minds tenant ID
 */
export async function getManagementTenantId(): Promise<{ tenantId: string }> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    const tenantId = await getManagementTenantIdInternal(adminKnex);
    
    log.info('Retrieved management tenant ID', { tenantId });
    
    return { tenantId };
  } catch (error) {
    log.error('Failed to get management tenant ID', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Create a customer client in the nineminds tenant
 */
export async function createCustomerClientActivity(input: {
  tenantName: string;
  adminUserEmail: string;
}): Promise<{ customerId: string }> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    
    // Get the management tenant ID (will throw if not found)
    const ninemindsTenant = await getManagementTenantIdInternal(adminKnex);
    
    log.info('Creating customer client in management tenant', {
      tenantName: input.tenantName,
      managementTenantId: ninemindsTenant
    });
    
    const result = await adminKnex.transaction(async (trx: Knex.Transaction<any, any[]>) => {
      return await ClientModel.createClient(
        {
          client_name: input.tenantName,
          client_type: 'company',
          url: '', // No website for tenant clients initially
          notes: `PSA Customer - Tenant: ${input.tenantName}`,
          properties: {
            tenant_id: input.tenantName,
            subscription_type: 'psa'
          }
        },
        ninemindsTenant,
        trx,
        { skipEmailSuffix: true, skipTaxSettings: true } // Skip email suffix for tenant clients
      );
    });
    
    log.info('Customer client created successfully', {
      customerId: result.client_id,
      tenantName: input.tenantName
    });
    
    return { customerId: result.client_id };
  } catch (error) {
    log.error('Failed to create customer client', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantName: input.tenantName
    });
    throw error;
  }
}

/**
 * Create a customer contact in the nineminds tenant
 */
export async function createCustomerContactActivity(input: {
  clientId: string;
  firstName: string;
  lastName: string;
  email: string;
}): Promise<{ contactId: string }> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    // Get the management tenant ID (will throw if not found)
    const ninemindsTenant = await getManagementTenantIdInternal(adminKnex);
    
    log.info('Creating customer contact in nineminds tenant', {
      email: input.email,
      clientId: input.clientId,
      managementTenantId: ninemindsTenant
    });
    
    // Debug: Verify the client exists before creating contact
    const clientCheck = await adminKnex('clients')
      .where({ client_id: input.clientId, tenant: ninemindsTenant })
      .first();
    
    log.info('Client check result', {
      clientExists: !!clientCheck,
      clientId: input.clientId,
      tenant: ninemindsTenant,
      clientName: clientCheck?.client_name
    });
    
    const result = await adminKnex.transaction(async (trx: Knex.Transaction<any, any[]>) => {
      return await ContactModel.createContact(
        {
          full_name: `${input.firstName} ${input.lastName}`,
          email: input.email,
          client_id: input.clientId,
          role: 'Admin',
          notes: 'Primary admin for PSA tenant'
        },
        ninemindsTenant,
        trx
      );
    });
    
    log.info('Customer contact created successfully', {
      contactId: result.contact_name_id,
      email: input.email
    });
    
    return { contactId: result.contact_name_id };
  } catch (error) {
    log.error('Failed to create customer contact', {
      error: error instanceof Error ? error.message : 'Unknown error',
      email: input.email
    });
    throw error;
  }
}

/**
 * Tag a customer client in the nineminds tenant
 */
export async function tagCustomerClientActivity(input: {
  clientId: string;
  tagText: string;
}): Promise<{ tagId: string }> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    // Get the management tenant ID (will throw if not found)
    const ninemindsTenant = await getManagementTenantIdInternal(adminKnex);
    
    log.info('Tagging customer client', {
      clientId: input.clientId,
      tagText: input.tagText
    });
    
    const result = await adminKnex.transaction(async (trx: Knex.Transaction<any, any[]>) => {
      return await TagModel.createTag(
        {
          tag_text: input.tagText,
          tagged_id: input.clientId,
          tagged_type: 'client',
          created_by: 'system'
        },
        ninemindsTenant,
        trx
      );
    });
    
    log.info('Customer client tagged successfully', {
      tagId: result.tag_id,
      mappingId: result.mapping_id,
      clientId: input.clientId
    });
    
    return { tagId: result.tag_id };
  } catch (error) {
    log.error('Failed to tag customer client', {
      error: error instanceof Error ? error.message : 'Unknown error',
      clientId: input.clientId
    });
    throw error;
  }
}

/**
 * Delete customer client (for rollback purposes)
 */
export async function deleteCustomerClientActivity(input: {
  clientId: string;
}): Promise<void> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    // Get the management tenant ID (will throw if not found)
    const ninemindsTenant = await getManagementTenantIdInternal(adminKnex);
    
    log.info('Deleting customer client for rollback', {
      clientId: input.clientId
    });
    
    await adminKnex.transaction(async (trx: Knex.Transaction<any, any[]>) => {
      // Delete client (contacts and tags will cascade)
      await trx('clients')
        .where({
          client_id: input.clientId,
          tenant: ninemindsTenant
        })
        .delete();
    });
    
    log.info('Customer client deleted successfully', {
      clientId: input.clientId
    });
  } catch (error) {
    log.error('Failed to delete customer client', {
      error: error instanceof Error ? error.message : 'Unknown error',
      clientId: input.clientId
    });
    throw error;
  }
}

/**
 * Delete customer contact (for rollback purposes)
 */
export async function deleteCustomerContactActivity(input: {
  contactId: string;
}): Promise<void> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    // Get the management tenant ID (will throw if not found)
    const ninemindsTenant = await getManagementTenantIdInternal(adminKnex);
    
    log.info('Deleting customer contact for rollback', {
      contactId: input.contactId
    });
    
    await adminKnex.transaction(async (trx: Knex.Transaction<any, any[]>) => {
      await trx('contacts')
        .where({
          contact_name_id: input.contactId,
          tenant: ninemindsTenant
        })
        .delete();
    });
    
    log.info('Customer contact deleted successfully', {
      contactId: input.contactId
    });
  } catch (error) {
    log.error('Failed to delete customer contact', {
      error: error instanceof Error ? error.message : 'Unknown error',
      contactId: input.contactId
    });
    throw error;
  }
}
