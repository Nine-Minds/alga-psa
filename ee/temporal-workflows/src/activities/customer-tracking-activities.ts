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

/**
 * Raised when a management-tenant client has the onboarding tenant's exact name
 * but nothing that ties it to this onboarding admin. Reusing it would link an
 * unrelated signup (name collision) to an existing customer's record — and its
 * portal. We refuse and let an operator verify the association out-of-band.
 */
export class UnverifiedCustomerMatchError extends Error {
  readonly tenantName: string;
  readonly existingClientId: string;
  readonly adminUserEmail: string;

  constructor(tenantName: string, existingClientId: string, adminUserEmail: string) {
    super(
      `A client named "${tenantName}" already exists in the management tenant ` +
      `(${existingClientId}) but has no trusted association with the onboarding ` +
      `admin "${adminUserEmail}"; refusing to link an unverified customer. ` +
      `Verify the association out-of-band, link the contact, then use the ` +
      `Nine Minds portal-user recovery procedure.`
    );
    this.name = 'UnverifiedCustomerMatchError';
    this.tenantName = tenantName;
    this.existingClientId = existingClientId;
    this.adminUserEmail = adminUserEmail;
  }
}

type DbConstraintError = {
  code?: string;
  constraint?: string;
  message?: string;
};

type ClientLookupRow = {
  client_id: string;
  properties?: unknown;
};

/**
 * The association marker written by a previous run of this same onboarding.
 * `properties` JSON is deliberately reused so no migration is needed; the
 * marker's normalized admin email (and, when available, the provisioned tenant
 * UUID) are what make the concurrent-duplicate race self-identifying: the
 * losing run re-reads a client the winner just created, which has no contacts
 * yet, and must still recognize it as its own.
 */
export interface OnboardingAssociationMarker {
  admin_email?: string;
  tenant_uuid?: string | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseClientProperties(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

function readOnboardingMarker(raw: unknown): OnboardingAssociationMarker {
  const marker = parseClientProperties(raw).onboarding_association;
  return marker && typeof marker === 'object' ? (marker as OnboardingAssociationMarker) : {};
}

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

async function findClientsByName(
  knex: Knex,
  tenant: string,
  tenantName: string
): Promise<ClientLookupRow[]> {
  return tenantDb(knex, tenant).table('clients')
    .where({ client_name: tenantName })
    .select('client_id', 'properties');
}

/**
 * Emails the management tenant already associates with a client: contact
 * emails plus emails of client-portal users linked to that client's contacts.
 * Evaluated only inside the management tenant (never unscoped).
 */
async function findClientAssociationEmails(
  knex: Knex,
  tenant: string,
  clientId: string
): Promise<Set<string>> {
  const emails = new Set<string>();

  const contacts = await tenantDb(knex, tenant).table('contacts')
    .where({ client_id: clientId })
    .select('contact_name_id', 'email');
  for (const contact of contacts as Array<{ contact_name_id: string; email?: string | null }>) {
    if (contact.email) emails.add(normalizeEmail(contact.email));
  }

  const contactIds = (contacts as Array<{ contact_name_id: string }>)
    .map((contact) => contact.contact_name_id);
  if (contactIds.length > 0) {
    const users = await tenantDb(knex, tenant).table('users')
      .whereIn('contact_id', contactIds)
      .andWhere({ user_type: 'client' })
      .select('email');
    for (const user of users as Array<{ email?: string | null }>) {
      if (user.email) emails.add(normalizeEmail(user.email));
    }
  }

  return emails;
}

/**
 * True only when the existing client is provably associated with the onboarding
 * admin. A bare exact-name match is never enough.
 */
async function isClientTrustedForOnboarding(
  knex: Knex,
  tenant: string,
  client: ClientLookupRow,
  normalizedEmail: string,
  tenantUuid: string | undefined
): Promise<boolean> {
  const marker = readOnboardingMarker(client.properties);
  if (marker.admin_email && normalizeEmail(marker.admin_email) === normalizedEmail) {
    return true;
  }
  if (tenantUuid && marker.tenant_uuid && marker.tenant_uuid === tenantUuid) {
    return true;
  }

  const associatedEmails = await findClientAssociationEmails(knex, tenant, client.client_id);
  return associatedEmails.has(normalizedEmail);
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
 * Resolution is exact-name and tenant-scoped, but a name match alone is not
 * enough to reuse a client: the existing client must be provably associated
 * with the onboarding admin (an existing contact/portal user with the admin's
 * email, or an onboarding association marker written when the client was
 * created). Otherwise an unrelated signup that happens to share a company name
 * could be linked to — and granted portal access to — a stranger's record.
 *
 * A trusted single match is reused untouched (createClient is bypassed entirely
 * so its tax/email/notes side effects never run). Multiple matches are refused.
 * A concurrent insert that trips the unique `(tenant, client_name)` constraint
 * is re-read rather than treated as a failure; the association marker is what
 * makes that race self-identifying before any contact exists.
 *
 * Pre-marker partial onboardings: a client created before this marker existed
 * (or any run that failed between creating the client and creating its contact)
 * has no contacts, so it can present no trusted association and the retry
 * refuses with `UnverifiedCustomerMatchError`. That refusal is deliberate.
 * Widening trust to accept "same name, no contacts" is exactly the name
 * collision that linked an unrelated signup to Harbor Point; an operator must
 * verify the association out-of-band and use the Nine Minds recovery runbook
 * rather than have the workflow guess. The refusal is logged at `error` with
 * the colliding client id, and Step 5 treats it as non-fatal: tenant creation
 * succeeds, portal provisioning is skipped, and the welcome email makes no
 * Support Portal claim.
 */
export async function createCustomerClientActivity(input: {
  tenantName: string;
  adminUserEmail: string;
  tenantId?: string;
}): Promise<{ customerId: string; reused: boolean }> {
  const log = Context.current().log;
  const normalizedEmail = normalizeEmail(input.adminUserEmail);
  const tenantUuid = input.tenantId?.trim() || undefined;
  
  try {
    const adminKnex = await getAdminConnection();
    
    // Get the management tenant ID (will throw if not found)
    const ninemindsTenant = await getManagementTenantIdInternal(adminKnex);
    
    log.info('Resolving customer client in management tenant', {
      tenantName: input.tenantName,
      managementTenantId: ninemindsTenant
    });

    // Read-after-conflict guard: never trust a pre-check alone under concurrency.
    const existingClients = await findClientsByName(adminKnex, ninemindsTenant, input.tenantName);
    if (existingClients.length === 1) {
      const client = existingClients[0];
      const trusted = await isClientTrustedForOnboarding(
        adminKnex,
        ninemindsTenant,
        client,
        normalizedEmail,
        tenantUuid
      );
      if (!trusted) {
        log.error('Refusing to reuse an unverified exact-name customer client', {
          customerId: client.client_id,
          tenantName: input.tenantName,
          adminUserEmail: normalizedEmail
        });
        throw new UnverifiedCustomerMatchError(input.tenantName, client.client_id, normalizedEmail);
      }

      log.info('Reusing verified existing customer client', {
        customerId: client.client_id,
        tenantName: input.tenantName
      });
      return { customerId: client.client_id, reused: true };
    }
    if (existingClients.length > 1) {
      throw new AmbiguousCustomerMatchError(
        input.tenantName,
        existingClients.map((client) => client.client_id)
      );
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
              subscription_type: 'psa',
              // Identity for this onboarding. `tenant_id` above is a display
              // name and cannot disambiguate; this marker is what lets a
              // concurrent duplicate recognize the client it just lost the
              // race to create (before any contact exists).
              onboarding_association: {
                admin_email: normalizedEmail,
                tenant_uuid: tenantUuid ?? null,
              },
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

      // Another run created the client between our lookup and insert. Re-read
      // and require the same trusted association; a bare name collision here is
      // just as unsafe as on the pre-check path.
      const racedClients = await findClientsByName(adminKnex, ninemindsTenant, input.tenantName);
      if (racedClients.length === 1) {
        const client = racedClients[0];
        const trusted = await isClientTrustedForOnboarding(
          adminKnex,
          ninemindsTenant,
          client,
          normalizedEmail,
          tenantUuid
        );
        if (!trusted) {
          log.error('Refusing to reuse an unverified raced customer client', {
            customerId: client.client_id,
            tenantName: input.tenantName,
            adminUserEmail: normalizedEmail
          });
          throw new UnverifiedCustomerMatchError(input.tenantName, client.client_id, normalizedEmail);
        }

        log.info('Reusing verified customer client created by a concurrent run', {
          customerId: client.client_id,
          tenantName: input.tenantName
        });
        return { customerId: client.client_id, reused: true };
      }
      if (racedClients.length > 1) {
        throw new AmbiguousCustomerMatchError(
          input.tenantName,
          racedClients.map((client) => client.client_id)
        );
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
