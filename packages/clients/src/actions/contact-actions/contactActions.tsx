'use server'

import type { IClient, IContact, ImportContactResult, ITag, MappableField } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { unparseCSV } from '@alga-psa/core';
import { getContactAvatarUrlsBatchAsync } from '../../lib/documentsHelpers';
import { createTag } from '@alga-psa/tags/actions';
import { hasPermissionAsync } from '../../lib/authHelpers';
import { ContactModel, CreateContactInput } from '@alga-psa/shared/models/contactModel';
import { deleteEntityTags } from '@alga-psa/tags/lib/tagCleanup';
import { withAuth } from '@alga-psa/auth';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildContactArchivedPayload,
  buildContactCreatedPayload,
  buildContactUpdatedPayload,
} from '@alga-psa/shared/workflow/streams/domainEventBuilders/contactEventBuilders';

function maybeUserActor(user: any) {
  const userId = user?.user_id;
  if (typeof userId !== 'string' || !userId) return undefined;
  return { actorType: 'USER' as const, actorUserId: userId };
}

// Shared column mapping for contact sorting
const CONTACT_SORT_COLUMNS = {
  full_name: 'contacts.full_name',
  created_at: 'contacts.created_at',
  email: 'contacts.email',
  phone_number: 'contacts.phone_number'
} as const;

const CONTACT_SORT_COLUMNS_ALIASED = {
  full_name: 'full_name',
  created_at: 'created_at',
  email: 'email',
  phone_number: 'phone_number'
} as const;

export const getContactByContactNameId = withAuth(async (
  _user,
  { tenant },
  contactNameId: string
): Promise<IContact | null> => {
  const { knex: db } = await createTenantKnex();
  try {
    // Validate input
    if (!contactNameId) {
      throw new Error('VALIDATION_ERROR: Contact ID is required');
    }

    // Fetch contact with client information
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .select(
          'contacts.*',
          'clients.client_name'
        )
        .leftJoin('clients', function (this: Knex.JoinClause) {
          this.on('contacts.client_id', 'clients.client_id')
            .andOn('clients.tenant', 'contacts.tenant')
        })
        .where({
          'contacts.contact_name_id': contactNameId,
          'contacts.tenant': tenant
        })
        .first();
    });

    return contact || null;
  } catch (err) {
    console.error('Error getting contact by contact_name_id:', err);

    if (err instanceof Error) {
      const message = err.message;
      if (message.includes('VALIDATION_ERROR:') ||
        message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      if (message.includes('relation') && message.includes('does not exist')) {
        throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
      }
    }

    throw new Error('SYSTEM_ERROR: An unexpected error occurred while retrieving contact information');
  }
});

export const deleteContact = withAuth(async (
  _user,
  { tenant },
  contactId: string
): Promise<{
  success: boolean;
  code?: string;
  message?: string;
  dependencies?: string[];
  counts?: Record<string, number>;
  dependencyText?: string;
}> => {
  console.log('Starting deleteContact function with contactId:', contactId);

  const { knex: db } = await createTenantKnex();
  console.log('Got database connection, tenant:', tenant);

  try {
    if (!contactId) {
      throw new Error('VALIDATION_ERROR: Contact ID is required');
    }

    console.log('Checking if contact exists...');
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({ contact_name_id: contactId, tenant })
        .first();
    });

    console.log('Contact found:', !!contact);
    if (!contact) {
      throw new Error('VALIDATION_ERROR: The contact you are trying to delete no longer exists');
    }

    console.log('Checking for dependencies...');
    const dependencies: string[] = [];
    const counts: Record<string, number> = {};

    await withTransaction(db, async (trx: Knex.Transaction) => {
      if (contact.client_id) {
        const clientInfo = await trx('clients')
          .where({ client_id: contact.client_id, tenant })
          .first();

        if (clientInfo && clientInfo.billing_contact_id === contactId) {
          dependencies.push('billing_contact');
          counts['billing_contact'] = 1;
        }
      }

      const ticketCount = await trx('tickets')
        .where({ contact_name_id: contactId, tenant })
        .count('* as count')
        .first();
      if (ticketCount && Number(ticketCount.count) > 0) {
        dependencies.push('ticket');
        counts['ticket'] = Number(ticketCount.count);
      }

      const interactionCount = await trx('interactions')
        .where({ contact_name_id: contactId, tenant })
        .count('* as count')
        .first();
      if (interactionCount && Number(interactionCount.count) > 0) {
        dependencies.push('interaction');
        counts['interaction'] = Number(interactionCount.count);
      }

      const documentCount = await trx('document_associations')
        .where({ entity_id: contactId, entity_type: 'contact', tenant })
        .count('* as count')
        .first();
      if (documentCount && Number(documentCount.count) > 0) {
        dependencies.push('document');
        counts['document'] = Number(documentCount.count);
      }

      const projectCount = await trx('projects')
        .where({ contact_name_id: contactId, tenant })
        .count('* as count')
        .first();
      if (projectCount && Number(projectCount.count) > 0) {
        dependencies.push('project');
        counts['project'] = Number(projectCount.count);
      }

      const portalUserCount = await trx('users')
        .where({ contact_id: contactId, tenant, user_type: 'client' })
        .count('* as count')
        .first();
      if (portalUserCount && Number(portalUserCount.count) > 0) {
        dependencies.push('portal_user');
        counts['portal_user'] = Number(portalUserCount.count);
      }
    });

    if (dependencies.length > 0) {
      const readableTypes: Record<string, string> = {
        'billing_contact': 'billing contact assignment',
        'ticket': 'tickets',
        'interaction': 'interactions',
        'document': 'documents',
        'project': 'projects',
        'portal_user': 'client portal user account'
      };

      const dependencyText = dependencies.map(dep => {
        const readableName = readableTypes[dep] || dep;
        const count = counts[dep];
        return count === 1 ? readableName : `${count} ${readableName}`;
      }).join(', ');

      return {
        success: false,
        code: 'CONTACT_HAS_DEPENDENCIES',
        message: 'Cannot delete contact with active business records. Consider marking as inactive instead to preserve data integrity.',
        dependencies: dependencies.map((dep: string): string => readableTypes[dep] || dep),
        counts,
        dependencyText
      };
    }

    console.log('Proceeding with contact deletion...');
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      try {
        console.log('Inside transaction, attempting deletion with params:', { contact_name_id: contactId, tenant });

        const contactRecord = await trx('contacts')
          .where({ contact_name_id: contactId, tenant })
          .select('notes_document_id')
          .first();

        if (contactRecord?.notes_document_id) {
          console.log('Cleaning up notes document:', contactRecord.notes_document_id);

          await trx('document_block_content')
            .where({ tenant, document_id: contactRecord.notes_document_id })
            .delete();

          await trx('document_associations')
            .where({ tenant, document_id: contactRecord.notes_document_id })
            .delete();

          await trx('documents')
            .where({ tenant, document_id: contactRecord.notes_document_id })
            .delete();
        }

        await deleteEntityTags(trx, contactId, 'contact');

        const deleted = await trx('contacts')
          .where({ contact_name_id: contactId, tenant })
          .delete();

        console.log('Deletion result:', deleted);

        if (!deleted || deleted === 0) {
          console.error('No rows were deleted');
          throw new Error('Contact record not found or could not be deleted');
        }

        console.log('Contact deletion successful');
        return { success: true };
      } catch (err) {
        console.error('Error during contact deletion transaction:', err);

        let errorMessage = 'Unknown error';
        if (err instanceof Error) {
          errorMessage = err.message;
          console.error('Detailed error message:', errorMessage);
          console.error('Error stack:', err.stack);

          if ('code' in err) {
            console.error('Database error code:', (err as any).code);
          }
          if ('detail' in err) {
            console.error('Database error detail:', (err as any).detail);
          }
          if ('constraint' in err) {
            console.error('Database constraint:', (err as any).constraint);
          }
        }

        if (errorMessage.includes('relation') && errorMessage.includes('does not exist')) {
          throw new Error(`SYSTEM_ERROR: Database table missing - ${errorMessage}`);
        }

        if (errorMessage.includes('violates foreign key constraint')) {
          throw new Error('VALIDATION_ERROR: Cannot delete contact because it has associated records');
        }

        if (errorMessage.includes('connection') || errorMessage.includes('timeout')) {
          throw new Error(`SYSTEM_ERROR: Database connection issue - ${errorMessage}`);
        }

        throw err;
      }
    });

    return result;
  } catch (err) {
    console.error('Error in deleteContact outer catch:', err);

    if (err instanceof Error) {
      const message = err.message;

      if (message.includes('violates foreign key constraint')) {
        console.error('Foreign key constraint violation detected');
        return {
          success: false,
          message: 'Cannot delete contact because it has associated records'
        };
      }

      if (message.includes('connection') || message.includes('timeout')) {
        console.error('Database connection issue detected:', message);
        return {
          success: false,
          message: `Database connection issue - ${message}`
        };
      }

      console.error('Contact deletion failed:', message);
      console.error('Error stack:', err.stack);
      return {
        success: false,
        message: `Contact deletion failed - ${message}`
      };
    }

    console.error('Non-Error object thrown:', typeof err, err);
    return {
      success: false,
      message: 'An unexpected error occurred while deleting the contact'
    };
  }
});

export type ContactFilterStatus = 'active' | 'inactive' | 'all';

export const getContactsByClient = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  status: ContactFilterStatus = 'active',
  sortBy: string = 'full_name',
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> => {
  const { knex: db } = await createTenantKnex();

  try {
    if (!clientId) {
      throw new Error('VALIDATION_ERROR: Client ID is required');
    }

    const allowedSortBy = ['full_name', 'created_at', 'email', 'phone_number'];
    const safeSortBy = allowedSortBy.includes(sortBy) ? sortBy : 'full_name';
    const safeSortDirection = sortDirection === 'desc' ? 'desc' : 'asc';

    const client = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('clients')
        .where({ client_id: clientId, tenant })
        .first();
    });

    if (!client) {
      throw new Error('VALIDATION_ERROR: The specified client does not exist');
    }

    const contacts = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .select('contacts.*', 'clients.client_name')
        .leftJoin('clients', function (this: Knex.JoinClause) {
          this.on('contacts.client_id', 'clients.client_id')
            .andOn('clients.tenant', 'contacts.tenant')
        })
        .where('contacts.client_id', clientId)
        .andWhere('contacts.tenant', tenant)
        .modify(function (queryBuilder: Knex.QueryBuilder) {
          if (status !== 'all') {
            queryBuilder.where('contacts.is_inactive', status === 'inactive');
          }
        })
        .orderBy(CONTACT_SORT_COLUMNS[safeSortBy as keyof typeof CONTACT_SORT_COLUMNS] || 'contacts.full_name', safeSortDirection);
    });

    const contactIds = contacts.map((c: IContact) => c.contact_name_id);
    const avatarUrlsMap = await getContactAvatarUrlsBatchAsync(contactIds, tenant);

    const contactsWithAvatars = contacts.map((contact: IContact) => ({
      ...contact,
      avatarUrl: avatarUrlsMap.get(contact.contact_name_id) || null,
    }));

    return contactsWithAvatars;
  } catch (err) {
    console.error('Error fetching contacts for client:', err);

    if (err instanceof Error) {
      const message = err.message;
      if (message.includes('VALIDATION_ERROR:') || message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      if (message.includes('relation') && message.includes('does not exist')) {
        throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
      }
    }

    throw new Error('SYSTEM_ERROR: An unexpected error occurred while retrieving client contacts');
  }
});

export const getContactsEligibleForInvitation = withAuth(async (
  user,
  { tenant },
  clientId?: string,
  status: ContactFilterStatus = 'active'
): Promise<IContact[]> => {
  const { knex: db } = await createTenantKnex();

  const canRead = await hasPermissionAsync(user, 'contact', 'read', db);
  if (!canRead) {
    throw new Error('Permission denied: Cannot read contacts');
  }

  try {
    const contacts = await withTransaction(db, async (trx: Knex.Transaction) => {
      const q = trx('contacts as c')
        .leftJoin('users as u', function(this: Knex.JoinClause) {
          this.on('u.contact_id', 'c.contact_name_id')
            .andOn('u.tenant', 'c.tenant')
            .andOn(trx.raw('u.user_type = ?', ['client']));
        })
        .leftJoin('clients as comp', function(this: Knex.JoinClause) {
          this.on('c.client_id', 'comp.client_id')
            .andOn('comp.tenant', 'c.tenant');
        })
        .where('c.tenant', tenant)
        .whereNull('u.user_id')
        .modify((qb: Knex.QueryBuilder) => {
          if (clientId) qb.andWhere('c.client_id', clientId);
          if (status !== 'all') qb.andWhere('c.is_inactive', status === 'inactive');
        })
        .select('c.*', 'comp.client_name')
        .orderBy('c.full_name', 'asc');

      return q;
    });

    const contactIds = contacts.map((c: IContact) => c.contact_name_id);
    const avatarUrlsMap = await getContactAvatarUrlsBatchAsync(contactIds, tenant);

    const contactsWithAvatars = contacts.map((contact: IContact) => ({
      ...contact,
      avatarUrl: avatarUrlsMap.get(contact.contact_name_id) || null,
    } as IContact));

    return contactsWithAvatars;
  } catch (err) {
    console.error('Error fetching contacts eligible for invitation:', err);
    throw new Error('SYSTEM_ERROR: Failed to retrieve contacts eligible for invitation');
  }
});

export const getAllContacts = withAuth(async (
  _user,
  { tenant },
  status: ContactFilterStatus = 'active',
  sortBy: string = 'full_name',
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> => {
  const { knex: db } = await createTenantKnex();

  try {
    if (!['active', 'inactive', 'all'].includes(status)) {
      throw new Error('VALIDATION_ERROR: Invalid status filter provided');
    }

    const allowedSortBy = ['full_name', 'created_at', 'email', 'phone_number'];
    const safeSortBy = allowedSortBy.includes(sortBy) ? sortBy : 'full_name';
    const safeSortDirection = sortDirection === 'desc' ? 'desc' : 'asc';

    console.log('[getAllContacts] Fetching contacts with status:', status, 'for tenant:', tenant);

    let contacts: any[] = [];
    try {
      contacts = await withTransaction(db, async (trx: Knex.Transaction) => {
        const fetchedContacts = await trx('contacts')
          .select('*')
          .where('tenant', tenant)
          .modify(function (queryBuilder: Knex.QueryBuilder) {
            if (status !== 'all') {
              queryBuilder.where('is_inactive', status === 'inactive');
            }
          })
          .orderBy(CONTACT_SORT_COLUMNS_ALIASED[safeSortBy as keyof typeof CONTACT_SORT_COLUMNS_ALIASED] || 'full_name', safeSortDirection);

        console.log('[getAllContacts] Found', fetchedContacts.length, 'contacts');

        if (fetchedContacts.length > 0) {
          try {
            const clientIds = fetchedContacts.map((c: IContact) => c.client_id).filter(Boolean);
            if (clientIds.length > 0) {
              const clients = await trx('clients')
                .select('client_id', 'client_name')
                .whereIn('client_id', clientIds)
                .where('tenant', tenant);

              const clientMap = new Map(clients.map((c: { client_id: string; client_name: string }) => [c.client_id, c.client_name]));
              return fetchedContacts.map((contact: IContact) => ({
                ...contact,
                client_name: contact.client_id ? clientMap.get(contact.client_id) || null : null
              }));
            }
          } catch (clientErr) {
            console.warn('[getAllContacts] Failed to fetch client names, proceeding without them:', clientErr);
          }
        }

        return fetchedContacts;
      });
    } catch (dbErr: any) {
      console.error('[getAllContacts] Database error:', dbErr);

      if (dbErr.message && (
        dbErr.message.includes('relation') ||
        dbErr.message.includes('does not exist') ||
        dbErr.message.includes('table')
      )) {
        throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
      }
      throw dbErr;
    }

    let avatarUrlsMap: Map<string, string | null> = new Map();
    try {
      const contactIds = contacts.map(c => c.contact_name_id);
      avatarUrlsMap = await getContactAvatarUrlsBatchAsync(contactIds, tenant);
    } catch (avatarErr) {
      console.warn('[getAllContacts] Failed to fetch avatars in batch:', avatarErr);
    }

    const contactsWithAvatars = contacts.map((contact: IContact) => ({
      ...contact,
      avatarUrl: avatarUrlsMap.get(contact.contact_name_id) || null,
    }));

    return contactsWithAvatars;
  } catch (err) {
    console.error('Error fetching all contacts:', err);

    if (err instanceof Error) {
      const message = err.message;
      if (message.includes('VALIDATION_ERROR:') || message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      if (message.includes('relation') && message.includes('does not exist')) {
        throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
      }
    }

    throw new Error('SYSTEM_ERROR: An unexpected error occurred while retrieving contacts');
  }
});

export const addContact = withAuth(async (
  user,
  { tenant },
  contactData: Partial<IContact>
): Promise<IContact> => {
  const { knex: db } = await createTenantKnex();

  if (!await hasPermissionAsync(user, 'contact', 'create')) {
    throw new Error('Permission denied: Cannot create contacts');
  }

  const createInput: CreateContactInput = {
    full_name: contactData.full_name || '',
    email: contactData.email,
    phone_number: contactData.phone_number,
    client_id: contactData.client_id || undefined,
    role: contactData.role,
    notes: contactData.notes || undefined,
    is_inactive: contactData.is_inactive
  };

  // Use the shared ContactModel to create the contact
  // The model handles all validation and business logic
  const created = await withTransaction(db, async (trx: Knex.Transaction) => {
    const contact = await ContactModel.createContact(
      createInput,
      tenant,
      trx
    );

    return {
      ...contact,
      phone_number: contact.phone_number || '',
      email: contact.email || '',
      role: contact.role || '',
      is_inactive: contact.is_inactive || false
    } as IContact;
  });

  const clientId = (created as any)?.client_id;
  if (typeof clientId === 'string' && clientId) {
    const occurredAt = (created as any)?.created_at ?? new Date().toISOString();
    const actor = maybeUserActor(user);
    await publishWorkflowEvent({
      eventType: 'CONTACT_CREATED',
      payload: buildContactCreatedPayload({
        contactId: created.contact_name_id,
        clientId,
        fullName: created.full_name,
        email: created.email || undefined,
        phoneNumber: created.phone_number || undefined,
        createdByUserId: user?.user_id,
        createdAt: occurredAt,
      }),
      ctx: { tenantId: tenant, occurredAt, actor },
      idempotencyKey: `contact_created:${created.contact_name_id}`,
    });
  }

  return created;
});

export const updateContact = withAuth(async (
  user,
  { tenant },
  contactData: Partial<IContact>
): Promise<IContact> => {
  const { knex: db } = await createTenantKnex();

  try {
    if (!contactData.contact_name_id) {
      throw new Error('VALIDATION_ERROR: Contact ID is required for updates');
    }

    if (contactData.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contactData.email.trim())) {
        throw new Error('VALIDATION_ERROR: Please enter a valid email address');
      }

      const existingContact = await withTransaction(db, async (trx: Knex.Transaction) => {
        return await trx('contacts')
          .where({ email: contactData.email!.trim().toLowerCase(), tenant })
          .whereNot({ contact_name_id: contactData.contact_name_id })
          .first();
      });

      if (existingContact) {
        throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system');
      }
    }

    if ('client_id' in contactData && contactData.client_id) {
      const client = await withTransaction(db, async (trx: Knex.Transaction) => {
        return await trx('clients')
          .where({ client_id: contactData.client_id, tenant })
          .first();
      });

      if (!client) {
        throw new Error('FOREIGN_KEY_ERROR: The selected client no longer exists');
      }
    }

    const validFields: (keyof IContact)[] = [
      'contact_name_id', 'full_name', 'client_id', 'phone_number',
      'email', 'created_at', 'updated_at', 'is_inactive',
      'role', 'notes'
    ];

    const updateData: Partial<IContact> = {};
    for (const key of validFields) {
      if (key in contactData && contactData[key] !== undefined) {
        let value = contactData[key];
        if (typeof value === 'string') {
          value = value.trim();
          if (key === 'email') {
            value = value.toLowerCase();
          }
        }
        if (key === 'client_id' && value === '') {
          (updateData as any)[key] = null;
        } else {
          (updateData as any)[key] = value;
        }
      }
    }

    updateData.updated_at = new Date().toISOString();

    // Verify contact exists and perform update in transaction
    const updateResult = await withTransaction(db, async (trx: Knex.Transaction) => {
      const existingContact = await trx('contacts')
        .where({ contact_name_id: contactData.contact_name_id, tenant })
        .first();

      if (!existingContact) {
        throw new Error('VALIDATION_ERROR: The contact you are trying to update no longer exists');
      }

      const [updated] = await trx('contacts')
        .where({ contact_name_id: contactData.contact_name_id, tenant })
        .update(updateData)
        .returning('*');

      if (updateData.is_inactive === true) {
        await trx('users')
          .where({ contact_id: contactData.contact_name_id, tenant, user_type: 'client' })
          .update({ is_inactive: true });
      }

      return {
        before: existingContact,
        after: updated,
        updatedFieldKeys: Object.keys(updateData),
        occurredAt: updateData.updated_at,
      };
    });

    const updatedContact = updateResult.after;
    if (!updatedContact) {
      throw new Error('SYSTEM_ERROR: Failed to update contact record');
    }

    const occurredAt = updateResult.occurredAt ?? (updatedContact as any)?.updated_at ?? new Date().toISOString();
    const actor = maybeUserActor(user);
    const clientId = (updatedContact as any)?.client_id ?? (updateResult.before as any)?.client_id;

    if (typeof clientId === 'string' && clientId) {
      const wasInactive = Boolean((updateResult.before as any)?.is_inactive);
      const isInactive = Boolean((updatedContact as any)?.is_inactive);
      if (!wasInactive && isInactive) {
        await publishWorkflowEvent({
          eventType: 'CONTACT_ARCHIVED',
          payload: buildContactArchivedPayload({
            contactId: updatedContact.contact_name_id,
            clientId,
            archivedByUserId: user?.user_id,
            archivedAt: occurredAt,
          }),
          ctx: { tenantId: tenant, occurredAt, actor },
          idempotencyKey: `contact_archived:${updatedContact.contact_name_id}:${occurredAt}`,
        });
      }

      const updatedPayload = buildContactUpdatedPayload({
        contactId: updatedContact.contact_name_id,
        clientId,
        before: updateResult.before as any,
        after: updatedContact as any,
        updatedFieldKeys: updateResult.updatedFieldKeys ?? [],
        updatedByUserId: user?.user_id,
        updatedAt: occurredAt,
      });

      const updatedFields = (updatedPayload as any).updatedFields;
      const changes = (updatedPayload as any).changes;
      if ((Array.isArray(updatedFields) && updatedFields.length) || (changes && Object.keys(changes).length)) {
        await publishWorkflowEvent({
          eventType: 'CONTACT_UPDATED',
          payload: updatedPayload,
          ctx: { tenantId: tenant, occurredAt, actor },
          idempotencyKey: `contact_updated:${updatedContact.contact_name_id}:${occurredAt}`,
        });
      }
    }

    return updatedContact;
  } catch (err) {
    console.error('Error updating contact:', err);

    if (err instanceof Error) {
      const message = err.message;
      if (message.includes('VALIDATION_ERROR:') ||
        message.includes('EMAIL_EXISTS:') ||
        message.includes('FOREIGN_KEY_ERROR:') ||
        message.includes('SYSTEM_ERROR:')) {
        throw err;
      }

      if (message.includes('duplicate key') && message.includes('contacts_email_tenant_unique')) {
        throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system');
      }

      if (message.includes('violates not-null constraint')) {
        const field = message.match(/column "([^"]+)"/)?.[1] || 'field';
        throw new Error(`VALIDATION_ERROR: The ${field} is required`);
      }

      if (message.includes('violates foreign key constraint') && message.includes('client_id')) {
        throw new Error('FOREIGN_KEY_ERROR: The selected client is no longer valid');
      }
    }

    throw new Error('SYSTEM_ERROR: An unexpected error occurred while updating the contact');
  }
});

export const updateContactsForClient = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  updateData: Partial<IContact>
): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  try {
    if (!clientId) {
      throw new Error('VALIDATION_ERROR: Client ID is required');
    }

    const client = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('clients')
        .where({ client_id: clientId, tenant })
        .first();
    });

    if (!client) {
      throw new Error('VALIDATION_ERROR: The specified client does not exist');
    }

    if (Object.keys(updateData).length === 0) {
      throw new Error('VALIDATION_ERROR: No update data provided');
    }

    if (updateData.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(updateData.email.trim())) {
        throw new Error('VALIDATION_ERROR: Please enter a valid email address');
      }
    }

    const sanitizedData = Object.entries(updateData).reduce<Partial<IContact>>((acc, [key, value]) => {
      const contactKey = key as keyof IContact;
      if (value === undefined) return acc;

      switch (contactKey) {
        case 'email':
        case 'full_name':
        case 'phone_number':
        case 'role':
          acc[contactKey] = typeof value === 'string' ? value.trim() : String(value);
          if (contactKey === 'email' && acc[contactKey]) {
            acc[contactKey] = acc[contactKey]!.toLowerCase();
          }
          break;
        case 'notes':
          if (value === null) {
            acc[contactKey] = undefined;
          } else {
            acc[contactKey] = typeof value === 'string' ? value.trim() : String(value);
          }
          break;
        case 'client_id':
          acc[contactKey] = value === null ? null : String(value);
          break;
        case 'is_inactive':
          acc[contactKey] = Boolean(value);
          break;
        case 'created_at':
        case 'updated_at':
          if (typeof value === 'string') {
            acc[contactKey] = value;
          } else if (value instanceof Date) {
            acc[contactKey] = value.toISOString();
          } else if (typeof value === 'number') {
            acc[contactKey] = new Date(value).toISOString();
          }
          break;
      }
      return acc;
    }, {});

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const updated = await trx('contacts')
        .where({ client_id: clientId, tenant })
        .update({
          ...sanitizedData,
          updated_at: new Date().toISOString()
        });

      if (!updated) {
        throw new Error('SYSTEM_ERROR: Failed to update client contacts');
      }
    });
  } catch (err) {
    console.error('Error updating contacts for client:', err);

    if (err instanceof Error) {
      const message = err.message;
      if (message.includes('VALIDATION_ERROR:') ||
        message.includes('EMAIL_EXISTS:') ||
        message.includes('FOREIGN_KEY_ERROR:') ||
        message.includes('SYSTEM_ERROR:')) {
        throw err;
      }

      if (message.includes('duplicate key') && message.includes('contacts_email_tenant_unique')) {
        throw new Error('EMAIL_EXISTS: One or more contacts already have this email address');
      }

      if (message.includes('violates not-null constraint')) {
        const field = message.match(/column "([^"]+)"/)?.[1] || 'field';
        throw new Error(`VALIDATION_ERROR: The ${field} is required`);
      }

      if (message.includes('violates foreign key constraint')) {
        throw new Error('FOREIGN_KEY_ERROR: Invalid reference in update data');
      }
    }

    throw new Error('SYSTEM_ERROR: An unexpected error occurred while updating client contacts');
  }
});

export async function exportContactsToCSV(
  contacts: IContact[],
  clients: IClient[],
  contactTags: Record<string, ITag[]>
): Promise<string> {
  const fields = ['full_name', 'email', 'phone_number', 'client', 'role', 'notes', 'tags'];

  const data = contacts.map((contact): Record<string, string> => {
    const client = clients.find(c => c.client_id === contact.client_id);
    const tags = contactTags[contact.contact_name_id] || [];
    const tagText = tags.map((tag: ITag) => tag.tag_text).join(', ');

    return {
      full_name: contact.full_name || '',
      email: contact.email || '',
      phone_number: contact.phone_number || '',
      client: client?.client_name || '',
      role: contact.role || '',
      notes: contact.notes || '',
      tags: tagText
    };
  });

  return unparseCSV(data, fields);
}

export async function generateContactCSVTemplate(): Promise<string> {
  const templateData = [
    {
      full_name: 'Alice Liddell',
      email: 'alice@wonderland.com',
      phone_number: '+1-555-CURIOUS',
      client: 'Mad Hatter Tea Client',
      role: 'Chief Explorer',
      notes: 'Fell down a rabbit hole and discovered a whole new world',
      tags: 'Curious, Adventurous, Brave'
    },
    {
      full_name: 'Mad Hatter',
      email: 'hatter@teaparty.wonderland',
      phone_number: '+1-555-TEA-TIME',
      client: 'Mad Hatter Tea Client',
      role: 'Chief Tea Ceremony Expert',
      notes: 'Knows why a raven is like a writing desk',
      tags: 'Creative, Eccentric, Tea Expert'
    }
  ];

  const fields = ['full_name', 'email', 'phone_number', 'client', 'role', 'notes', 'tags'];

  return unparseCSV(templateData, fields);
}

type ContactImportData = Partial<IContact> & { tags?: string };

export const importContactsFromCSV = withAuth(async (
  user,
  { tenant },
  contactsData: Array<ContactImportData>,
  updateExisting: boolean = false
): Promise<ImportContactResult[]> => {
  const { knex: db } = await createTenantKnex();

  try {
    if (!contactsData || contactsData.length === 0) {
      throw new Error('VALIDATION_ERROR: No contact data provided');
    }

    const results: ImportContactResult[] = [];

    await withTransaction(db, async (trx: Knex.Transaction) => {
      for (const contactData of contactsData) {
        try {
          if (!contactData.full_name?.trim()) {
            throw new Error('VALIDATION_ERROR: Full name is required');
          }

          if (contactData.email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(contactData.email.trim())) {
              throw new Error(`VALIDATION_ERROR: Invalid email format for contact: ${contactData.full_name}`);
            }
          }

          if (contactData.client_id) {
            const client = await trx('clients')
              .where({ client_id: contactData.client_id, tenant })
              .first();

            if (!client) {
              throw new Error(`FOREIGN_KEY_ERROR: Client not found for contact: ${contactData.full_name}`);
            }
          }

          let existingContact: IContact | undefined = undefined;
          if (contactData.email) {
            existingContact = await trx('contacts')
              .where({ email: contactData.email.trim().toLowerCase(), tenant })
              .first();
          }

          if (!existingContact) {
            existingContact = await trx('contacts')
              .where({
                full_name: contactData.full_name.trim(),
                tenant,
                client_id: contactData.client_id
              })
              .first();
          }

          if (existingContact && !updateExisting) {
            const duplicateField = contactData.email && existingContact.email === contactData.email.trim().toLowerCase() ? 'email' : 'name';
            results.push({
              success: false,
              message: `VALIDATION_ERROR: Contact with this ${duplicateField} already exists: ${duplicateField === 'email' ? contactData.email : contactData.full_name}`,
              originalData: contactData
            });
            continue;
          }

          let savedContact: IContact;

          if (existingContact && updateExisting) {
            const { tags, tenant: _tenant, ...contactDataWithoutTagsAndTenant } = contactData;
            const updateData = {
              ...contactDataWithoutTagsAndTenant,
              full_name: contactData.full_name.trim(),
              email: contactData.email?.trim().toLowerCase() || existingContact.email,
              phone_number: contactData.phone_number?.trim() || existingContact.phone_number,
              role: contactData.role?.trim() || existingContact.role,
              notes: contactData.notes?.trim() || existingContact.notes,
              updated_at: new Date().toISOString()
            };

            [savedContact] = await trx('contacts')
              .where({ contact_name_id: existingContact.contact_name_id, tenant })
              .update(updateData)
              .returning('*');

            if (contactData.tags !== undefined) {
              try {
                await trx('tag_mappings')
                  .where({ tagged_id: savedContact.contact_name_id, tagged_type: 'contact', tenant })
                  .delete();

                if (contactData.tags) {
                  const tagTexts = contactData.tags.split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag);
                  for (const tagText of tagTexts) {
                    await createTag({
                      tag_text: tagText,
                      tagged_id: savedContact.contact_name_id,
                      tagged_type: 'contact',
                      created_by: user.user_id
                    });
                  }
                }
              } catch (tagError) {
                console.error('Failed to update tags during CSV import:', tagError);
              }
            }

            results.push({
              success: true,
              message: 'Contact updated successfully',
              contact: savedContact,
              originalData: contactData
            });
          } else {
            const contactToCreate = {
              full_name: contactData.full_name.trim(),
              email: contactData.email?.trim().toLowerCase() || '',
              phone_number: contactData.phone_number?.trim() || '',
              client_id: contactData.client_id,
              is_inactive: contactData.is_inactive || false,
              role: contactData.role?.trim() || '',
              notes: contactData.notes?.trim() || '',
              tenant: tenant,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };

            [savedContact] = await trx('contacts')
              .insert(contactToCreate)
              .returning('*');

            if (contactData.tags) {
              try {
                const tagTexts = contactData.tags.split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag);
                for (const tagText of tagTexts) {
                  await createTag({
                    tag_text: tagText,
                    tagged_id: savedContact.contact_name_id,
                    tagged_type: 'contact',
                    created_by: user.user_id
                  });
                }
              } catch (tagError) {
                console.error('Failed to create tags during CSV import:', tagError);
              }
            }

            results.push({
              success: true,
              message: 'Contact created successfully',
              contact: savedContact,
              originalData: contactData
            });
          }
        } catch (err) {
          console.error('Error processing contact:', contactData, err);

          if (err instanceof Error) {
            const message = err.message;
            if (message.includes('VALIDATION_ERROR:') ||
              message.includes('EMAIL_EXISTS:') ||
              message.includes('FOREIGN_KEY_ERROR:') ||
              message.includes('SYSTEM_ERROR:')) {
              results.push({
                success: false,
                message: message,
                originalData: contactData
              });
              continue;
            }

            if (message.includes('duplicate key') && (message.includes('contacts_email_tenant_unique') || message.includes('contacts_tenant_email_unique'))) {
              results.push({
                success: false,
                message: `EMAIL_EXISTS: A contact with this email address already exists: ${contactData.email}`,
                originalData: contactData
              });
              continue;
            }

            if (message.includes('violates not-null constraint')) {
              const field = message.match(/column "([^"]+)"/)?.[1] || 'field';
              results.push({
                success: false,
                message: `VALIDATION_ERROR: The ${field} is required`,
                originalData: contactData
              });
              continue;
            }
          }

          results.push({
            success: false,
            message: 'SYSTEM_ERROR: An unexpected error occurred while processing the contact',
            originalData: contactData
          });
        }
      }
    });

    return results;
  } catch (err) {
    console.error('Error importing contacts:', err);

    if (err instanceof Error) {
      const message = err.message;
      if (message.includes('VALIDATION_ERROR:') || message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      if (message.includes('relation') && message.includes('does not exist')) {
        throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
      }
    }

    throw new Error('SYSTEM_ERROR: An unexpected error occurred while importing contacts');
  }
});

export const checkExistingEmails = withAuth(async (
  _user,
  { tenant },
  emails: string[]
): Promise<string[]> => {
  const { knex: db } = await createTenantKnex();

  try {
    if (!emails || emails.length === 0) {
      throw new Error('VALIDATION_ERROR: No email addresses provided');
    }

    const sanitizedEmails = emails.map(email => {
      const trimmedEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        throw new Error(`VALIDATION_ERROR: Invalid email format: ${email}`);
      }
      return trimmedEmail;
    });

    const existingContacts = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .select('email')
        .whereIn('email', sanitizedEmails)
        .andWhere('tenant', tenant);
    });

    return existingContacts.map((contact: { email: string }): string => contact.email);
  } catch (err) {
    console.error('Error checking existing emails:', err);

    if (err instanceof Error) {
      const message = err.message;
      if (message.includes('VALIDATION_ERROR:') || message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      if (message.includes('relation') && message.includes('does not exist')) {
        throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
      }
    }

    throw new Error('SYSTEM_ERROR: An unexpected error occurred while checking existing emails');
  }
});

export const getContactByEmail = withAuth(async (
  _user,
  { tenant },
  email: string,
  clientId: string
) => {
  try {
    const { knex } = await createTenantKnex();

    const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({ email, client_id: clientId, tenant })
        .first();
    });

    return contact;
  } catch (error) {
    console.error('Error getting contact by email:', error);
    throw error;
  }
});

/**
 * Create a new contact for a client
 * @deprecated Use createOrFindContactByEmail instead for better duplicate handling
 */
export const createClientContact = withAuth(async (
  _user,
  { tenant },
  {
    clientId,
    fullName,
    email,
    phone = '',
    jobTitle = ''
  }: {
    clientId: string;
    fullName: string;
    email: string;
    phone?: string;
    jobTitle?: string;
  }
) => {
  try {
    const { knex } = await createTenantKnex();

    const existingContact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({ email: email.trim().toLowerCase(), tenant })
        .first();
    });

    if (existingContact) {
      throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system');
    }

    const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const [inserted] = await trx('contacts')
        .insert({
          tenant,
          client_id: clientId,
          full_name: fullName,
          email: email.trim().toLowerCase(),
          phone_number: phone,
          role: jobTitle,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .returning('*');

      return inserted;
    });

    return contact;
  } catch (error) {
    console.error('Error creating client contact:', error);
    throw error;
  }
});

/**
 * Find contact by email address (without requiring client_id)
 * Used for email processing workflows
 */
export const findContactByEmailAddress = withAuth(async (
  _user,
  { tenant },
  email: string
): Promise<IContact | null> => {
  try {
    const { knex } = await createTenantKnex();

    const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .select('contacts.*', 'clients.client_name')
        .leftJoin('clients', function (this: Knex.JoinClause) {
          this.on('contacts.client_id', 'clients.client_id')
            .andOn('clients.tenant', 'contacts.tenant')
        })
        .where({
          'contacts.email': email.toLowerCase(),
          'contacts.tenant': tenant
        })
        .first();
    });

    return contact || null;
  } catch (error) {
    console.error('Error finding contact by email address:', error);
    throw error;
  }
});

/**
 * Create or find contact - if contact exists, return it; otherwise create new one
 */
export const createOrFindContactByEmail = withAuth(async (
  _user,
  { tenant },
  {
    email,
    name,
    clientId,
    phone,
    title
  }: {
    email: string;
    name?: string;
    clientId: string;
    phone?: string;
    title?: string;
  }
): Promise<{ contact: IContact & { client_name: string }; isNew: boolean }> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const existingContactInTenant = await trx('contacts')
        .select('contacts.*', 'clients.client_name')
        .leftJoin('clients', function (this: Knex.JoinClause) {
          this.on('contacts.client_id', 'clients.client_id')
            .andOn('clients.tenant', 'contacts.tenant')
        })
        .where({
          'contacts.email': email.toLowerCase(),
          'contacts.tenant': tenant
        })
        .first();

      if (existingContactInTenant) {
        if (existingContactInTenant.client_id !== clientId) {
          if (!existingContactInTenant.client_id) {
            throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system without a client assignment');
          }
          throw new Error(`EMAIL_EXISTS: This email is already associated with ${existingContactInTenant.client_name || 'another client'}`);
        }
        const contactWithClientName = {
          ...existingContactInTenant,
          client_name: existingContactInTenant.client_name || ''
        };
        return { contact: contactWithClientName, isNew: false };
      }

      const contactName = name || extractNameFromEmail(email);
      const now = new Date();

      const [newContact] = await trx('contacts')
        .insert({
          tenant,
          client_id: clientId,
          full_name: contactName,
          email: email.toLowerCase(),
          phone_number: phone,
          role: title,
          is_inactive: false,
          created_at: now,
          updated_at: now
        })
        .returning('*');

      const client = await trx('clients')
        .select('client_name')
        .where({ client_id: clientId, tenant })
        .first();

      const contactWithClient = {
        ...newContact,
        client_name: client?.client_name || ''
      };

      return { contact: contactWithClient, isNew: true };
    });
  } catch (error) {
    console.error('Error creating or finding contact:', error);
    throw error;
  }
});

/**
 * Extract a reasonable name from email address if no name provided
 */
function extractNameFromEmail(email: string): string {
  const localPart = email.split('@')[0];

  return localPart
    .replace(/[._-]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Update contact's portal admin status
 */
export const updateContactPortalAdminStatus = withAuth(async (
  user,
  { tenant },
  contactId: string,
  isPortalAdmin: boolean
): Promise<{ success: boolean; error?: string }> => {
  try {
    const hasUpdatePermission = await hasPermissionAsync(user, 'client', 'update');
    if (!hasUpdatePermission) {
      throw new Error('You do not have permission to update client settings');
    }

    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      const updated = await trx('contacts')
        .where({ contact_name_id: contactId, tenant })
        .update({
          is_client_admin: isPortalAdmin,
          updated_at: new Date().toISOString()
        });

      if (updated === 0) {
        throw new Error('Contact not found');
      }
    });

    return { success: true };
  } catch (error) {
    console.error('[contactActions.updateContactPortalAdminStatus]', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update contact'
    };
  }
});

/**
 * Get user associated with a contact
 */
export const getUserByContactId = withAuth(async (
  user,
  { tenant },
  contactId: string
): Promise<{ user: any | null; error?: string }> => {
  try {
    const hasReadPermission = await hasPermissionAsync(user, 'client', 'read');
    if (!hasReadPermission) {
      throw new Error('You do not have permission to view client information');
    }

    const { knex } = await createTenantKnex();

    const userWithRoles = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const foundUser = await trx('users')
        .where({ contact_id: contactId, tenant: tenant, user_type: 'client' })
        .first();

      if (!foundUser) {
        return null;
      }

      const roles = await trx('user_roles')
        .select('roles.role_id', 'roles.role_name')
        .join('roles', function(this: Knex.JoinClause) {
          this.on('user_roles.role_id', 'roles.role_id')
            .andOn('roles.tenant', trx.raw('?', [tenant]));
        })
        .where({
          'user_roles.user_id': foundUser.user_id,
          'user_roles.tenant': tenant
        });

      return {
        ...foundUser,
        roles: roles || []
      };
    });

    if (!userWithRoles) {
      return { user: null, error: undefined };
    }

    return { user: userWithRoles, error: undefined };
  } catch (error) {
    console.error('[contactActions.getUserByContactId]', error);
    return {
      user: null,
      error: error instanceof Error ? error.message : 'Failed to get user'
    };
  }
});
