'use server'

import type { IClient, IClientWithLocation, IContact, IInteraction } from '@alga-psa/types';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex';
import {
  getClientLogoUrl,
  getClientLogoUrlsBatch,
  getContactAvatarUrlsBatch,
} from '@alga-psa/formatting/avatarUtils';
import InteractionModel from './InteractionModel';

async function hasPermissionAsync(user: any, resource: string, action: string, trx?: any): Promise<boolean> {
  const module = await import('@alga-psa/auth');
  return module.hasPermission(user, resource, action, trx);
}

// --- Client query actions ---

export const getClientById = withAuth(async (user, { tenant }, clientId: string): Promise<IClientWithLocation | null> => {
  if (!await hasPermissionAsync(user, 'client', 'read')) {
    throw new Error('Permission denied: Cannot read clients');
  }

  const { knex } = await createTenantKnex();

  const clientData = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('clients as c')
      .leftJoin('users as u', function() {
        this.on('c.account_manager_id', '=', 'u.user_id')
            .andOn('c.tenant', '=', 'u.tenant');
      })
      .leftJoin('client_locations as cl', function() {
        this.on('c.client_id', '=', 'cl.client_id')
            .andOn('c.tenant', '=', 'cl.tenant')
            .andOn('cl.is_default', '=', trx.raw('true'));
      })
      .select(
        'c.*',
        'cl.email as location_email',
        'cl.phone as location_phone',
        'cl.address_line1 as location_address',
        trx.raw(`CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`)
      )
      .where({ 'c.client_id': clientId, 'c.tenant': tenant })
      .first();
  });

  if (!clientData) {
    return null;
  }

  const logoUrl = await getClientLogoUrl(clientId, tenant);

  return {
    ...clientData,
    logoUrl,
  } as IClientWithLocation;
});

export const getAllClients = withAuth(async (user, { tenant }, includeInactive: boolean = true): Promise<IClient[]> => {
  if (!await hasPermissionAsync(user, 'client', 'read')) {
    throw new Error('Permission denied: Cannot read clients');
  }

  const { knex: db } = await createTenantKnex();

  const clients = await withTransaction(db, async (trx) => {
    const query = trx('clients')
      .select('*')
      .where('tenant', tenant)
      .orderBy('client_name', 'asc');

    if (!includeInactive) {
      query.andWhere({ is_inactive: false });
    }

    return query;
  });

  if (clients.length === 0) {
    return [];
  }

  const clientIds = clients.map((client: any) => client.client_id);
  const logoUrlsMap = await getClientLogoUrlsBatch(clientIds, tenant);

  const clientsWithLogos = clients.map((client: any) => ({
    ...client,
    properties: client.properties || {},
    logoUrl: logoUrlsMap.get(client.client_id) || null,
  }));

  return clientsWithLogos as IClient[];
});

// --- Contact query actions ---

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
    const avatarUrlsMap = await getContactAvatarUrlsBatch(contactIds, tenant);

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
      avatarUrlsMap = await getContactAvatarUrlsBatch(contactIds, tenant);
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

function extractNameFromEmail(email: string): string {
  const localPart = email.split('@')[0];

  return localPart
    .replace(/[._-]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// --- Interaction query actions ---

export const getInteractionById = withAuth(async (
  _user,
  { tenant },
  interactionId: string
): Promise<IInteraction> => {
  try {
    const { knex } = await createTenantKnex();
    const interaction = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await InteractionModel.getById(interactionId, tenant);
    });
    if (!interaction) {
      throw new Error('Interaction not found');
    }
    return interaction;
  } catch (error) {
    console.error('Error fetching interaction:', error);
    throw new Error('Failed to fetch interaction');
  }
});
