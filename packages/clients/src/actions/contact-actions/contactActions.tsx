'use server'

import type {
  ContactEmailAddressInput,
  DeletionValidationResult,
  IClient,
  IContact,
  ImportContactResult,
  ITag,
} from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { deleteEntityWithValidation, isEnterprise, unparseCSV } from '@alga-psa/core';
import { getContactAvatarUrlsBatchAsync } from '../../lib/documentsHelpers';
import { createTag } from '@alga-psa/tags/actions';
import { deleteEntityTags } from '@alga-psa/tags/lib/tagCleanup';
import { hasPermissionAsync } from '../../lib/authHelpers';
import { ContactModel, CreateContactInput, UpdateContactInput } from '@alga-psa/shared/models/contactModel';
import { withAuth } from '@alga-psa/auth';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildContactArchivedPayload,
  buildContactCreatedPayload,
  buildContactUpdatedPayload,
} from '@alga-psa/workflow-streams';
import {
  formatContactCsvAdditionalEmailAddresses,
  formatContactCsvPrimaryEmailType,
  isValidContactCsvEmailValue,
  normalizeContactCsvEmailValue,
} from '../../lib/contactCsvEmailFields';

function maybeUserActor(user: any) {
  const userId = user?.user_id;
  if (typeof userId !== 'string' || !userId) return undefined;
  return { actorType: 'USER' as const, actorUserId: userId };
}

function buildDefaultPhoneNumbers(phoneNumber?: string | null) {
  const trimmedPhoneNumber = phoneNumber?.trim();
  if (!trimmedPhoneNumber) {
    return [];
  }

  return [{
    phone_number: trimmedPhoneNumber,
    canonical_type: 'work' as const,
    is_default: true,
    display_order: 0,
  }];
}

type ContactActionInput = Omit<Partial<IContact>, 'phone_numbers' | 'additional_email_addresses'> & {
  phone_numbers?: CreateContactInput['phone_numbers'];
  primary_email_canonical_type?: CreateContactInput['primary_email_canonical_type'];
  primary_email_custom_type?: CreateContactInput['primary_email_custom_type'];
  additional_email_addresses?: CreateContactInput['additional_email_addresses'];
};

type ContactImportData = Omit<Partial<IContact>, 'additional_email_addresses'> & {
  additional_email_addresses?: CreateContactInput['additional_email_addresses'];
  tags?: string;
  primary_email_custom_type?: string | null;
};

function getDerivedDefaultPhone(contact: Pick<IContact, 'default_phone_number' | 'phone_numbers'>): string {
  return contact.default_phone_number
    || contact.phone_numbers.find((phoneNumber) => phoneNumber.is_default)?.phone_number
    || '';
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

async function cleanupEntraReferencesBeforeContactDelete(
  trx: Knex.Transaction,
  tenantId: string,
  contactId: string
): Promise<void> {
  if (!isEnterprise) {
    return;
  }

  const queueTableExists = await trx('information_schema.tables')
    .where({ table_schema: 'public', table_name: 'entra_contact_reconciliation_queue' })
    .first('table_name');

  if (!queueTableExists) {
    return;
  }

  await trx('entra_contact_reconciliation_queue')
    .where({ tenant: tenantId, resolved_contact_id: contactId })
    .update({
      resolved_contact_id: null,
      updated_at: trx.fn.now(),
    });
}


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
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => ContactModel.getContactById(contactNameId, tenant, trx));

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
  user,
  { tenant },
  contactId: string
): Promise<DeletionValidationResult & {
  success: boolean;
  deleted?: boolean;
  counts?: Record<string, number>;
}> => {
  const { knex: db } = await createTenantKnex();

  try {
    if (!contactId) {
      throw new Error('VALIDATION_ERROR: Contact ID is required');
    }

    if (!await hasPermissionAsync(user, 'contact', 'delete')) {
      throw new Error('Permission denied: Cannot delete contacts');
    }

    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({ contact_name_id: contactId, tenant })
        .first();
    });

    if (!contact) {
      return {
        success: false,
        canDelete: false,
        code: 'NOT_FOUND',
        message: 'The contact you are trying to delete no longer exists.',
        dependencies: [],
        alternatives: []
      };
    }

    const result = await deleteEntityWithValidation('contact', contactId, db, tenant, async (trx, tenantId) => {
      await deleteEntityTags(trx, contactId, 'contact');

      // Clean up child records owned by the contact
      await trx('contact_phone_numbers').where({ contact_name_id: contactId, tenant: tenantId }).delete();
      await trx('comments').where({ contact_id: contactId, tenant: tenantId }).delete();
      await trx('portal_invitations').where({ contact_id: contactId, tenant: tenantId }).delete();
      await trx('contact_phone_numbers').where({ contact_name_id: contactId, tenant: tenantId }).delete();

      const contactRecord = await trx('contacts')
        .where({ contact_name_id: contactId, tenant: tenantId })
        .select('notes_document_id')
        .first();

      if (contactRecord?.notes_document_id) {
        await trx('document_block_content')
          .where({ tenant: tenantId, document_id: contactRecord.notes_document_id })
          .delete();

        await trx('document_associations')
          .where({ tenant: tenantId, document_id: contactRecord.notes_document_id })
          .delete();

        await trx('documents')
          .where({ tenant: tenantId, document_id: contactRecord.notes_document_id })
          .delete();
      }

      await cleanupEntraReferencesBeforeContactDelete(trx, tenantId, contactId);

      const deleted = await trx('contacts')
        .where({ contact_name_id: contactId, tenant: tenantId })
        .delete();

      if (!deleted || deleted === 0) {
        throw new Error('Contact record not found or could not be deleted');
      }
    });

    const counts = result.dependencies.reduce<Record<string, number>>((acc, dependency) => {
      acc[dependency.type] = dependency.count;
      return acc;
    }, {});

    return {
      ...result,
      deleted: result.deleted,
      success: result.deleted === true,
      counts,
    };
  } catch (err) {
    console.error('Error deleting contact:', err);

    if (err instanceof Error) {
      const message = err.message;

      if (message.includes('violates foreign key constraint')) {
        return {
          success: false,
          canDelete: false,
          code: 'VALIDATION_FAILED',
          message: 'Cannot delete contact because it has associated records',
          dependencies: [],
          alternatives: []
        };
      }

      if (message.includes('connection') || message.includes('timeout')) {
        return {
          success: false,
          canDelete: false,
          code: 'VALIDATION_FAILED',
          message: `Database connection issue - ${message}`,
          dependencies: [],
          alternatives: []
        };
      }

      return {
        success: false,
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: `Contact deletion failed - ${message}`,
        dependencies: [],
        alternatives: []
      };
    }

    return {
      success: false,
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: 'An unexpected error occurred while deleting the contact',
      dependencies: [],
      alternatives: []
    };
  }
});

type ContactFilterStatus = 'active' | 'inactive' | 'all';

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

      const rows = await q;
      return ContactModel.hydrateContactsWithPhoneNumbers(rows as any[], tenant, trx);
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

export const addContact = withAuth(async (
  user,
  { tenant },
  contactData: ContactActionInput
): Promise<IContact> => {
  const { knex: db } = await createTenantKnex();

  if (!await hasPermissionAsync(user, 'contact', 'create')) {
    throw new Error('Permission denied: Cannot create contacts');
  }

  const createInput: CreateContactInput = {
    full_name: contactData.full_name || '',
    email: contactData.email ?? undefined,
    primary_email_canonical_type: contactData.primary_email_canonical_type ?? undefined,
    primary_email_custom_type: contactData.primary_email_custom_type ?? undefined,
    additional_email_addresses: contactData.additional_email_addresses ?? [],
    phone_numbers: contactData.phone_numbers ?? [],
    client_id: contactData.client_id || undefined,
    role: contactData.role ?? undefined,
    notes: contactData.notes || undefined,
    is_inactive: contactData.is_inactive ?? undefined
  };

  // Use the shared ContactModel to create the contact
  // The model handles all validation and business logic
  const created = await withTransaction(db, async (trx: Knex.Transaction) => {
    return ContactModel.createContact(createInput, tenant, trx);
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
        primaryEmailCanonicalType: created.primary_email_canonical_type ?? null,
        primaryEmailCustomTypeId: created.primary_email_custom_type_id ?? null,
        primaryEmailType: created.primary_email_type ?? null,
        additionalEmailAddresses: created.additional_email_addresses ?? [],
        phoneNumbers: created.phone_numbers,
        defaultPhoneNumber: created.default_phone_number || undefined,
        defaultPhoneType: created.default_phone_type || undefined,
        createdByUserId: user?.user_id,
        createdAt: occurredAt,
      }),
      ctx: { tenantId: tenant, occurredAt, actor },
      idempotencyKey: `contact_created:${created.contact_name_id}`,
    });
  }

  return created;
});

export const listContactPhoneTypeSuggestions = withAuth(async (
  user,
  { tenant }
): Promise<string[]> => {
  const { knex: db } = await createTenantKnex();

  if (!await hasPermissionAsync(user, 'contact', 'read')) {
    return [];
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const rows = await trx('contact_phone_type_definitions')
      .where({ tenant })
      .orderBy('label', 'asc')
      .select('label');

    return rows
      .map((row: { label?: string | null }) => row.label?.trim() ?? '')
      .filter((label): label is string => label.length > 0);
  });
});

export const getCustomPhoneTypeUsageCount = withAuth(async (
  user,
  { tenant },
  customTypeLabel: string
): Promise<{ label: string; usageCount: number }> => {
  const { knex: db } = await createTenantKnex();

  if (!await hasPermissionAsync(user, 'contact', 'read')) {
    return { label: customTypeLabel, usageCount: 0 };
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    return ContactModel.getCustomPhoneTypeUsageCount(customTypeLabel, tenant, trx);
  });
});

export const getContactLastUsagePhoneTypes = withAuth(async (
  user,
  { tenant },
  contactId: string
): Promise<Array<{ contact_phone_type_id: string; label: string }>> => {
  const { knex: db } = await createTenantKnex();

  if (!await hasPermissionAsync(user, 'contact', 'read')) {
    return [];
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    return ContactModel.findLastUsagePhoneTypes(contactId, tenant, trx);
  });
});

export const deleteOrphanedPhoneTypes = withAuth(async (
  user,
  { tenant },
  typeLabels: string[]
): Promise<number> => {
  const { knex: db } = await createTenantKnex();

  if (!await hasPermissionAsync(user, 'contact', 'update')) {
    throw new Error('Permission denied: Cannot manage phone types');
  }

  if (typeLabels.length === 0) return 0;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Only delete types that are actually orphaned (safety check)
    const orphaned = await ContactModel.findOrphanedPhoneTypeDefinitions(tenant, trx);
    const normalizedRequested = new Set(
      typeLabels.map(l => l.trim().replace(/\s+/g, ' ').toLowerCase())
    );
    const idsToDelete = orphaned
      .filter(o => normalizedRequested.has(o.label.trim().replace(/\s+/g, ' ').toLowerCase()))
      .map(o => o.contact_phone_type_id);
    return ContactModel.deletePhoneTypeDefinitions(idsToDelete, tenant, trx);
  });
});

export const updateContact = withAuth(async (
  user,
  { tenant },
  contactData: ContactActionInput
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

    const inboundDestinationIdRaw = (contactData as any).inbound_ticket_defaults_id;
    if (
      inboundDestinationIdRaw !== undefined &&
      inboundDestinationIdRaw !== null &&
      String(inboundDestinationIdRaw).trim() !== ''
    ) {
      const inboundDestinationId = String(inboundDestinationIdRaw).trim();
      const destination = await withTransaction(db, async (trx: Knex.Transaction) => {
        return await trx('inbound_ticket_defaults')
          .where({ id: inboundDestinationId, tenant })
          .first();
      });

      if (!destination) {
        throw new Error('FOREIGN_KEY_ERROR: The selected inbound ticket destination no longer exists');
      }

      (contactData as any).inbound_ticket_defaults_id = inboundDestinationId;
    }

    const updateResult = await withTransaction(db, async (trx: Knex.Transaction) => {
      const existingContact = await ContactModel.getContactById(contactData.contact_name_id!, tenant, trx);

      if (!existingContact) {
        throw new Error('VALIDATION_ERROR: The contact you are trying to update no longer exists');
      }

      const updated = await ContactModel.updateContact(contactData.contact_name_id!, {
        full_name: contactData.full_name,
        client_id: contactData.client_id === '' ? undefined : contactData.client_id || undefined,
        phone_numbers: contactData.phone_numbers,
        email: contactData.email ?? undefined,
        primary_email_canonical_type: contactData.primary_email_canonical_type ?? undefined,
        primary_email_custom_type: contactData.primary_email_custom_type ?? undefined,
        additional_email_addresses: contactData.additional_email_addresses,
        role: contactData.role ?? undefined,
        notes: contactData.notes ?? undefined,
        is_inactive: contactData.is_inactive ?? undefined,
      }, tenant, trx);

      if (contactData.is_inactive === true) {
        await trx('users')
          .where({ contact_id: contactData.contact_name_id, tenant, user_type: 'client' })
          .update({ is_inactive: true });
      }

      return {
        before: existingContact,
        after: updated,
        updatedFieldKeys: Object.keys(contactData).filter((key) => key !== 'contact_name_id'),
        occurredAt: updated.updated_at,
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
  const fields = [
    'full_name',
    'email',
    'primary_email_type',
    'additional_email_addresses',
    'phone_number',
    'client',
    'role',
    'notes',
    'tags',
  ];

  const data = contacts.map((contact): Record<string, string> => {
    const client = clients.find(c => c.client_id === contact.client_id);
    const tags = contactTags[contact.contact_name_id] || [];
    const tagText = tags.map((tag: ITag) => tag.tag_text).join(', ');

    return {
      full_name: contact.full_name || '',
      email: contact.email || '',
      primary_email_type: formatContactCsvPrimaryEmailType(contact),
      additional_email_addresses: formatContactCsvAdditionalEmailAddresses(contact.additional_email_addresses),
      phone_number: getDerivedDefaultPhone(contact),
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
      primary_email_type: 'work',
      additional_email_addresses: 'personal:alice.home@wonderland.com | billing:accounts@wonderland.com',
      phone_number: '+1-555-CURIOUS',
      client: 'Mad Hatter Tea Client',
      role: 'Chief Explorer',
      notes: 'Fell down a rabbit hole and discovered a whole new world',
      tags: 'Curious, Adventurous, Brave'
    },
    {
      full_name: 'Mad Hatter',
      email: 'hatter@teaparty.wonderland',
      primary_email_type: 'other',
      additional_email_addresses: 'billing:tea-bills@teaparty.wonderland | personal:hatter.afterhours@teaparty.wonderland',
      phone_number: '+1-555-TEA-TIME',
      client: 'Mad Hatter Tea Client',
      role: 'Chief Tea Ceremony Expert',
      notes: 'Knows why a raven is like a writing desk',
      tags: 'Creative, Eccentric, Tea Expert'
    }
  ];

  const fields = [
    'full_name',
    'email',
    'primary_email_type',
    'additional_email_addresses',
    'phone_number',
    'client',
    'role',
    'notes',
    'tags',
  ];

  return unparseCSV(templateData, fields);
}

function normalizeImportedEmailList(emails: Array<string | null | undefined>): string[] {
  return [...new Set(
    emails
      .map((email) => normalizeContactCsvEmailValue(email))
      .filter((email): email is string => Boolean(email))
  )];
}

async function findExistingContactByImportedEmails(
  trx: Knex.Transaction,
  tenant: string,
  emails: string[]
): Promise<IContact | undefined> {
  if (emails.length === 0) {
    return undefined;
  }

  const directMatches = await trx('contacts')
    .select('contact_name_id')
    .whereIn('email', emails)
    .andWhere('tenant', tenant);

  const additionalMatches = await trx('contact_additional_email_addresses')
    .select('contact_name_id')
    .whereIn('normalized_email_address', emails)
    .andWhere('tenant', tenant);

  const contactIds = [...new Set([
    ...directMatches.map((row: { contact_name_id: string }) => row.contact_name_id),
    ...additionalMatches.map((row: { contact_name_id: string }) => row.contact_name_id),
  ])];

  if (contactIds.length > 1) {
    throw new Error('VALIDATION_ERROR: Imported email addresses match multiple existing contacts');
  }

  if (contactIds.length === 0) {
    return undefined;
  }

  const contact = await ContactModel.getContactById(contactIds[0], tenant, trx);
  return contact ?? undefined;
}

function toContactEmailAddressInput(
  row: Pick<NonNullable<IContact['additional_email_addresses']>[number], 'email_address' | 'canonical_type' | 'custom_type' | 'display_order'>
): ContactEmailAddressInput {
  return {
    email_address: row.email_address,
    canonical_type: row.canonical_type ?? null,
    custom_type: row.custom_type ?? null,
    display_order: row.display_order,
  };
}

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

          const normalizedPrimaryEmail = normalizeContactCsvEmailValue(contactData.email);
          if (normalizedPrimaryEmail !== contactData.email) {
            contactData.email = normalizedPrimaryEmail ?? undefined;
          }

          if (contactData.email && !isValidContactCsvEmailValue(contactData.email)) {
            throw new Error(`VALIDATION_ERROR: Invalid email format for contact: ${contactData.full_name}`);
          }

          if (contactData.client_id) {
            const client = await trx('clients')
              .where({ client_id: contactData.client_id, tenant })
              .first();

            if (!client) {
              throw new Error(`FOREIGN_KEY_ERROR: Client not found for contact: ${contactData.full_name}`);
            }
          }

          const importEmails = normalizeImportedEmailList([
            contactData.email,
            ...(contactData.additional_email_addresses ?? []).map((row) => row.email_address),
          ]);

          let existingContact: IContact | undefined = undefined;
          let matchedByEmail = false;
          existingContact = await findExistingContactByImportedEmails(trx, tenant, importEmails);
          matchedByEmail = Boolean(existingContact);

          if (!existingContact) {
            const existingContactRow = await trx('contacts')
              .select('contact_name_id')
              .where({
                full_name: contactData.full_name.trim(),
                tenant,
                client_id: contactData.client_id
              })
              .first();

            if (existingContactRow?.contact_name_id) {
              existingContact = await ContactModel.getContactById(existingContactRow.contact_name_id, tenant, trx) ?? undefined;
            }
          }

          if (existingContact && !updateExisting) {
            const duplicateField = matchedByEmail ? 'email' : 'name';
            results.push({
              success: false,
              message: `VALIDATION_ERROR: Contact with this ${duplicateField} already exists: ${duplicateField === 'email' ? importEmails[0] ?? contactData.email : contactData.full_name}`,
              originalData: contactData
            });
            continue;
          }

          let savedContact: IContact;

          if (existingContact && updateExisting) {
            const normalizedImportedPrimaryEmail = normalizeContactCsvEmailValue(contactData.email);
            if (
              normalizedImportedPrimaryEmail &&
              normalizedImportedPrimaryEmail !== existingContact.email?.toLowerCase()
            ) {
              const baseAdditionalRows = (
                contactData.additional_email_addresses
                ?? existingContact.additional_email_addresses?.map(toContactEmailAddressInput)
                ?? []
              )
                .filter((row) =>
                  normalizeContactCsvEmailValue(row.email_address) !== existingContact.email?.toLowerCase()
                )
                .map((row, index) => ({
                  ...row,
                  display_order: index,
                }));

              const hasPromotedEmailRow = baseAdditionalRows.some((row) =>
                normalizeContactCsvEmailValue(row.email_address) === normalizedImportedPrimaryEmail
              );

              if (!hasPromotedEmailRow) {
                const matchingExistingAdditionalRow = existingContact.additional_email_addresses?.find((row) =>
                  normalizeContactCsvEmailValue(row.email_address) === normalizedImportedPrimaryEmail
                );

                if (matchingExistingAdditionalRow) {
                  baseAdditionalRows.push({
                    email_address: matchingExistingAdditionalRow.email_address,
                    canonical_type: matchingExistingAdditionalRow.canonical_type ?? null,
                    custom_type: matchingExistingAdditionalRow.custom_type ?? null,
                    display_order: baseAdditionalRows.length,
                  });
                }
              }

              contactData.additional_email_addresses = baseAdditionalRows;
            }

            const updateData: UpdateContactInput = {
              full_name: contactData.full_name.trim(),
              email: contactData.email ?? existingContact.email ?? undefined,
              phone_numbers: contactData.phone_numbers
                ?? (contactData.phone_number !== undefined
                  ? buildDefaultPhoneNumbers(contactData.phone_number)
                  : existingContact.phone_numbers),
              client_id: contactData.client_id || undefined,
              is_inactive: contactData.is_inactive ?? undefined,
              role: normalizeOptionalText(contactData.role) ?? existingContact.role ?? undefined,
              notes: normalizeOptionalText(contactData.notes) ?? existingContact.notes ?? undefined,
            };

            if (contactData.primary_email_canonical_type !== undefined || contactData.primary_email_custom_type !== undefined) {
              updateData.primary_email_canonical_type = contactData.primary_email_canonical_type ?? null;
              updateData.primary_email_custom_type = contactData.primary_email_custom_type ?? null;
            }

            if (contactData.additional_email_addresses !== undefined) {
              updateData.additional_email_addresses = contactData.additional_email_addresses;
            }

            savedContact = await ContactModel.updateContact(existingContact.contact_name_id, updateData, tenant, trx);

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
              email: contactData.email || '',
              primary_email_canonical_type: contactData.primary_email_canonical_type,
              primary_email_custom_type: contactData.primary_email_custom_type,
              additional_email_addresses: contactData.additional_email_addresses,
              phone_numbers: contactData.phone_numbers ?? buildDefaultPhoneNumbers(contactData.phone_number),
              client_id: contactData.client_id || undefined,
              is_inactive: contactData.is_inactive || false,
              role: normalizeOptionalText(contactData.role),
              notes: normalizeOptionalText(contactData.notes),
            };

            savedContact = await ContactModel.createContact(contactToCreate, tenant, trx);

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

    const invalidEmail = emails.find((email) => !isValidContactCsvEmailValue(email));
    if (invalidEmail) {
      throw new Error(`VALIDATION_ERROR: Invalid email format: ${invalidEmail}`);
    }

    const sanitizedEmails = normalizeImportedEmailList(emails);
    if (sanitizedEmails.length === 0) {
      throw new Error('VALIDATION_ERROR: No valid email addresses provided');
    }

    const existingEmails = await withTransaction(db, async (trx: Knex.Transaction) => {
      const primaryEmails = await trx('contacts')
        .select('email')
        .whereIn('email', sanitizedEmails)
        .andWhere('tenant', tenant);

      const additionalEmails = await trx('contact_additional_email_addresses')
        .select('normalized_email_address')
        .whereIn('normalized_email_address', sanitizedEmails)
        .andWhere('tenant', tenant);

      return [
        ...primaryEmails.map((contact: { email: string }) => contact.email),
        ...additionalEmails.map((row: { normalized_email_address: string }) => row.normalized_email_address),
      ];
    });

    return [...new Set(existingEmails)];
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
      const existingContact = await trx('contacts')
        .where({ email: email.toLowerCase(), client_id: clientId, tenant })
        .first<{ contact_name_id: string }>();

      if (!existingContact) {
        return null;
      }

      return ContactModel.getContactById(existingContact.contact_name_id, tenant, trx);
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
    primaryEmailCanonicalType,
    primaryEmailCustomType,
    additionalEmailAddresses,
    phone = '',
    phoneNumbers,
    jobTitle = ''
  }: {
    clientId: string;
    fullName: string;
    email: string;
    primaryEmailCanonicalType?: CreateContactInput['primary_email_canonical_type'];
    primaryEmailCustomType?: CreateContactInput['primary_email_custom_type'];
    additionalEmailAddresses?: CreateContactInput['additional_email_addresses'];
    phone?: string;
    phoneNumbers?: CreateContactInput['phone_numbers'];
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
      return ContactModel.createContact({
        full_name: fullName,
        email: email.trim().toLowerCase(),
        primary_email_canonical_type: primaryEmailCanonicalType,
        primary_email_custom_type: primaryEmailCustomType,
        additional_email_addresses: additionalEmailAddresses ?? [],
        phone_numbers: phoneNumbers ?? buildDefaultPhoneNumbers(phone),
        client_id: clientId,
        role: jobTitle,
      }, tenant, trx);
    });

    return contact;
  } catch (error) {
    console.error('Error creating client contact:', error);
    throw error;
  }
});

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
