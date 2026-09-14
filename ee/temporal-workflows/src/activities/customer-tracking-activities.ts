/**
 * Customer Tracking Activities for Temporal Workflows
 * These activities create customer records in the nineminds (management) tenant
 * when new PSA tenants are provisioned.
 */

import { Context } from '@temporalio/activity';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection, withAdminTransactionRetryReadOnly } from '@alga-psa/db/admin.js';
import { ClientModel } from '@alga-psa/shared/models/clientModel.js';
import { ContactModel } from '@alga-psa/shared/models/contactModel.js';
import { TagModel } from '@alga-psa/shared/models/tagModel.js';
import { Knex } from 'knex';

const MANAGEMENT_TENANT_DISCOVERY_CONTEXT = 'customer-tracking-management-tenant-discovery';

/**
 * Get the management tenant ID for 'Nine Minds LLC'
 * @throws Error if management tenant doesn't exist
 */
async function getManagementTenantIdInternal(knex: Knex): Promise<string> {
  const MANAGEMENT_TENANT_NAME = 'Nine Minds LLC';
  
  const tenant = await tenantDb(knex, MANAGEMENT_TENANT_DISCOVERY_CONTEXT)
    .unscoped('tenants', 'customer tracking discovers management tenant before tenant context exists')
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
 * Raised when the management tenant contains more than one client whose exact
 * name matches the tenant being provisioned. We refuse to guess which client to
 * link to rather than silently attaching the customer to the wrong company.
 */
export class AmbiguousCustomerMatchError extends Error {
  readonly tenantName: string;
  readonly candidateClientIds: string[];

  constructor(tenantName: string, candidateClientIds: string[]) {
    super(
      `Multiple clients named "${tenantName}" exist in the management tenant ` +
      `(candidates: ${candidateClientIds.join(', ')}); refusing to link an ambiguous customer.`
    );
    this.name = 'AmbiguousCustomerMatchError';
    this.tenantName = tenantName;
    this.candidateClientIds = candidateClientIds;
  }
}

/**
 * Raised when a contact with the requested email already exists in the
 * management tenant but belongs to a different client. `contacts.email` is
 * unique per tenant, so we surface the collision instead of reusing an
 * unrelated contact.
 */
export class ContactEmailConflictError extends Error {
  readonly email: string;
  readonly existingClientId: string;

  constructor(email: string, existingClientId: string) {
    super(
      `A contact with email "${email}" already exists in the management tenant ` +
      `under a different client (${existingClientId}); refusing to reuse an unrelated contact.`
    );
    this.name = 'ContactEmailConflictError';
    this.email = email;
    this.existingClientId = existingClientId;
  }
}

type DbConstraintError = {
  code?: string;
  constraint?: string;
  message?: string;
};

/**
 * Detect a Postgres unique-constraint violation. Prefer the SQLSTATE (23505)
 * plus the constraint identity; only fall back to message inspection when the
 * driver omits the structured fields.
 */
function isUniqueConstraintViolation(error: unknown, constraintNames: string[]): boolean {
  const dbError = error as DbConstraintError;
  if (dbError?.code === '23505') {
    if (!dbError.constraint || constraintNames.length === 0) return true;
    return constraintNames.includes(dbError.constraint);
  }

  if (error instanceof Error) {
    return (
      error.message.includes('duplicate key') &&
      constraintNames.some((name) => error.message.includes(name))
    );
  }

  return false;
}

async function findClientIdsByName(
  knex: Knex,
  tenant: string,
  tenantName: string
): Promise<string[]> {
  const rows = await tenantDb(knex, tenant).table('clients')
    .where({ client_name: tenantName })
    .select('client_id');
  return rows.map((row: { client_id: string }) => row.client_id);
}

async function findContactIdByClientAndEmail(
  knex: Knex,
  tenant: string,
  clientId: string,
  email: string
): Promise<string | null> {
  const row = await tenantDb(knex, tenant).table('contacts')
    .where({ client_id: clientId, email })
    .select('contact_name_id')
    .first();
  return row?.contact_name_id ?? null;
}

async function findContactOwnerByEmail(
  knex: Knex,
  tenant: string,
  email: string
): Promise<{ contact_name_id: string; client_id: string | null } | undefined> {
  return tenantDb(knex, tenant).table('contacts')
    .where({ email })
    .select('contact_name_id', 'client_id')
    .first();
}

/**
 * Resolve or create a customer client in the nineminds (management) tenant.
 *
 * Resolution is exact-name and tenant-scoped. A single existing match is
 * reused untouched (createClient is bypassed entirely so its tax/email/notes
 * side effects never run). Multiple matches are refused. A concurrent insert
 * that trips the unique `(tenant, client_name)` constraint is re-read rather
 * than treated as a failure.
 */
export async function createCustomerClientActivity(input: {
  tenantName: string;
  adminUserEmail: string;
}): Promise<{ customerId: string; reused: boolean }> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    
    // Get the management tenant ID (will throw if not found)
    const ninemindsTenant = await getManagementTenantIdInternal(adminKnex);
    
    log.info('Resolving customer client in management tenant', {
      tenantName: input.tenantName,
      managementTenantId: ninemindsTenant
    });

    // Read-after-conflict guard: never trust a pre-check alone under concurrency.
    const existingClientIds = await findClientIdsByName(adminKnex, ninemindsTenant, input.tenantName);
    if (existingClientIds.length === 1) {
      log.info('Reusing existing customer client', {
        customerId: existingClientIds[0],
        tenantName: input.tenantName
      });
      return { customerId: existingClientIds[0], reused: true };
    }
    if (existingClientIds.length > 1) {
      throw new AmbiguousCustomerMatchError(input.tenantName, existingClientIds);
    }

    try {
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
      
      return { customerId: result.client_id, reused: false };
    } catch (insertError) {
      if (!isUniqueConstraintViolation(insertError, ['clients_tenant_client_name_unique'])) {
        throw insertError;
      }

      // Another run created the client between our lookup and insert.
      const racedClientIds = await findClientIdsByName(adminKnex, ninemindsTenant, input.tenantName);
      if (racedClientIds.length === 1) {
        log.info('Reusing customer client created by a concurrent run', {
          customerId: racedClientIds[0],
          tenantName: input.tenantName
        });
        return { customerId: racedClientIds[0], reused: true };
      }
      if (racedClientIds.length > 1) {
        throw new AmbiguousCustomerMatchError(input.tenantName, racedClientIds);
      }
      throw insertError;
    }
  } catch (error) {
    log.error('Failed to resolve customer client', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantName: input.tenantName
    });
    throw error;
  }
}

/**
 * Resolve or create a customer contact in the nineminds (management) tenant.
 *
 * `contacts.email` is unique per tenant (not per client), so the lookup is
 * scoped to the resolved client. If the email already belongs to a different
 * client we surface `ContactEmailConflictError` rather than linking across
 * companies. A concurrent insert that trips the email constraint is re-read.
 */
export async function createCustomerContactActivity(input: {
  clientId: string;
  firstName: string;
  lastName: string;
  email: string;
}): Promise<{ contactId: string; reused: boolean }> {
  const log = Context.current().log;
  
  try {
    const adminKnex = await getAdminConnection();
    // Get the management tenant ID (will throw if not found)
    const ninemindsTenant = await getManagementTenantIdInternal(adminKnex);
    const normalizedEmail = input.email.trim().toLowerCase();

    log.info('Resolving customer contact in nineminds tenant', {
      email: normalizedEmail,
      clientId: input.clientId,
      managementTenantId: ninemindsTenant
    });

    const existingContactId = await findContactIdByClientAndEmail(
      adminKnex,
      ninemindsTenant,
      input.clientId,
      normalizedEmail
    );
    if (existingContactId) {
      log.info('Reusing existing customer contact', {
        contactId: existingContactId,
        email: normalizedEmail
      });
      return { contactId: existingContactId, reused: true };
    }

    try {
      const result = await adminKnex.transaction(async (trx: Knex.Transaction<any, any[]>) => {
        return await ContactModel.createContact(
          {
            full_name: `${input.firstName} ${input.lastName}`,
            email: normalizedEmail,
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
        email: normalizedEmail
      });
      
      return { contactId: result.contact_name_id, reused: false };
    } catch (insertError) {
      const message = insertError instanceof Error ? insertError.message : '';
      const isEmailConflict =
        isUniqueConstraintViolation(insertError, [
          'contacts_tenant_email_unique',
          'contacts_email_tenant_unique',
        ]) || message.includes('EMAIL_EXISTS');

      if (!isEmailConflict) {
        throw insertError;
      }

      const racedContactId = await findContactIdByClientAndEmail(
        adminKnex,
        ninemindsTenant,
        input.clientId,
        normalizedEmail
      );
      if (racedContactId) {
        log.info('Reusing customer contact created by a concurrent run', {
          contactId: racedContactId,
          email: normalizedEmail
        });
        return { contactId: racedContactId, reused: true };
      }

      const otherOwner = await findContactOwnerByEmail(adminKnex, ninemindsTenant, normalizedEmail);
      if (otherOwner && otherOwner.client_id !== input.clientId) {
        throw new ContactEmailConflictError(normalizedEmail, otherOwner.client_id ?? 'unknown');
      }
      throw insertError;
    }
  } catch (error) {
    log.error('Failed to resolve customer contact', {
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
    
    await withAdminTransactionRetryReadOnly(async (trx: Knex.Transaction<any, any[]>) => {
      // Delete client (contacts and tags will cascade)
      await tenantDb(trx, ninemindsTenant).table('clients')
        .where({
          client_id: input.clientId
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
    
    await withAdminTransactionRetryReadOnly(async (trx: Knex.Transaction<any, any[]>) => {
      await tenantDb(trx, ninemindsTenant).table('contacts')
        .where({
          contact_name_id: input.contactId
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
