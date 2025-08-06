/**
 * Customer Tracking Activities for Temporal Workflows
 * These activities create customer records in the nineminds (management) tenant
 * when new PSA tenants are provisioned.
 */

import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { CompanyModel } from '@alga-psa/shared/models/companyModel';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import { TagModel } from '@alga-psa/shared/models/tagModel';
import { Knex } from 'knex';

/**
 * Create a customer company in the nineminds tenant
 */
export async function createCustomerCompanyActivity(input: {
  tenantName: string;
  adminUserEmail: string;
}): Promise<{ customerId: string }> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    const ninemindsTenant = process.env.NINEMINDS_TENANT_ID || 'nineminds';
    
    log.info('Creating customer company in nineminds tenant', {
      tenantName: input.tenantName,
      ninemindsTenant
    });
    
    const result = await adminKnex.transaction(async (trx: Knex.Transaction<any, any[]>) => {
      return await CompanyModel.createCompany(
        {
          company_name: input.tenantName,
          client_type: 'company',
          url: '', // No website for tenant companies initially
          notes: `PSA Customer - Tenant: ${input.tenantName}`,
          properties: {
            tenant_id: input.tenantName,
            subscription_type: 'psa'
          }
        },
        ninemindsTenant,
        trx,
        { skipEmailSuffix: true } // Skip email suffix for tenant companies
      );
    });
    
    log.info('Customer company created successfully', {
      customerId: result.company_id,
      tenantName: input.tenantName
    });
    
    return { customerId: result.company_id };
  } catch (error) {
    log.error('Failed to create customer company', {
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
  companyId: string;
  firstName: string;
  lastName: string;
  email: string;
}): Promise<{ contactId: string }> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    const ninemindsTenant = process.env.NINEMINDS_TENANT_ID || 'nineminds';
    
    log.info('Creating customer contact in nineminds tenant', {
      email: input.email,
      companyId: input.companyId
    });
    
    const result = await adminKnex.transaction(async (trx: Knex.Transaction<any, any[]>) => {
      return await ContactModel.createContact(
        {
          full_name: `${input.firstName} ${input.lastName}`,
          email: input.email,
          company_id: input.companyId,
          role: 'Admin',
          notes: 'Primary admin for PSA tenant'
        },
        ninemindsTenant,
        trx
      );
    });
    
    log.info('Customer contact created successfully', {
      contactId: result.contact_id,
      email: input.email
    });
    
    return { contactId: result.contact_id };
  } catch (error) {
    log.error('Failed to create customer contact', {
      error: error instanceof Error ? error.message : 'Unknown error',
      email: input.email
    });
    throw error;
  }
}

/**
 * Tag a customer company in the nineminds tenant
 */
export async function tagCustomerCompanyActivity(input: {
  companyId: string;
  tagText: string;
}): Promise<{ tagId: string }> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    const ninemindsTenant = process.env.NINEMINDS_TENANT_ID || 'nineminds';
    
    log.info('Tagging customer company', {
      companyId: input.companyId,
      tagText: input.tagText
    });
    
    const result = await adminKnex.transaction(async (trx: Knex.Transaction<any, any[]>) => {
      return await TagModel.createTag(
        {
          tag_text: input.tagText,
          tagged_id: input.companyId,
          tagged_type: 'company',
          created_by: 'system'
        },
        ninemindsTenant,
        trx
      );
    });
    
    log.info('Customer company tagged successfully', {
      tagId: result.tag_id,
      mappingId: result.mapping_id,
      companyId: input.companyId
    });
    
    return { tagId: result.tag_id };
  } catch (error) {
    log.error('Failed to tag customer company', {
      error: error instanceof Error ? error.message : 'Unknown error',
      companyId: input.companyId
    });
    throw error;
  }
}

/**
 * Delete customer company (for rollback purposes)
 */
export async function deleteCustomerCompanyActivity(input: {
  companyId: string;
}): Promise<void> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    const ninemindsTenant = process.env.NINEMINDS_TENANT_ID || 'nineminds';
    
    log.info('Deleting customer company for rollback', {
      companyId: input.companyId
    });
    
    await adminKnex.transaction(async (trx: Knex.Transaction<any, any[]>) => {
      // Delete company (contacts and tags will cascade)
      await trx('companies')
        .where({
          company_id: input.companyId,
          tenant: ninemindsTenant
        })
        .delete();
    });
    
    log.info('Customer company deleted successfully', {
      companyId: input.companyId
    });
  } catch (error) {
    log.error('Failed to delete customer company', {
      error: error instanceof Error ? error.message : 'Unknown error',
      companyId: input.companyId
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
    const ninemindsTenant = process.env.NINEMINDS_TENANT_ID || 'nineminds';
    
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