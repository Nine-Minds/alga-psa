'use server'

import type { IClient, IClientWithLocation, IContact, IInteraction } from '@alga-psa/types';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import {
  getClientLogoUrl,
  getClientLogoUrlsBatch,
  getContactAvatarUrlsBatch,
} from '@alga-psa/formatting/avatarUtils';
import { hasPermissionAsync } from '../lib/authHelpers';
import InteractionModel from '../models/interactions';

const CONTACT_LIST_SEARCH_TSQUERY_UNSAFE_RE = /[^\p{L}\p{N}\s]+/gu;
const CONTACT_LIST_SEARCH_IDENTIFIER_TOKEN_PATTERN = /\b[A-Z]+-?\d+\b/i;
const CONTACT_LIST_SEARCH_TYPES = ['contact', 'document', 'interaction'] as const;

type QueryActionUser = {
  user_id: string;
  tenant?: string;
  user_type?: string | null;
  clientId?: string | null;
  contact_id?: string | null;
};

type DbConnection = Knex | Knex.Transaction;

function tenantScopedTable<Row extends object = Record<string, any>>(
  conn: DbConnection,
  table: string,
  tenant: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(table);
}

function tenantScopedDerivedTableSql(
  conn: DbConnection,
  tenant: string,
  tableName: string,
  alias: string
): { sql: string; bindings: Knex.RawBinding[] } {
  const scoped = tenantDb(conn, tenant)
    .table(tableName)
    .select('*')
    .toSQL();

  return {
    sql: `(${scoped.sql}) ${alias}`,
    bindings: scoped.bindings as Knex.RawBinding[],
  };
}

function isClientPortalUser(user: QueryActionUser): boolean {
  return user.user_type === 'client';
}

function isMspUser(user: QueryActionUser): boolean {
  return user.user_type === 'internal';
}

async function hasMspPermissionForAction(
  user: QueryActionUser,
  resource: string,
  action: string,
  db?: DbConnection
): Promise<boolean> {
  if (!isMspUser(user)) {
    return false;
  }

  return hasPermissionAsync(user, resource, action, db);
}

async function assertMspPermissionForAction(
  user: QueryActionUser,
  resource: string,
  action: string,
  message: string,
  db?: DbConnection
): Promise<void> {
  if (!await hasMspPermissionForAction(user, resource, action, db)) {
    throw new Error(message);
  }
}

async function getClientPortalUserClientIdForAction(
  user: QueryActionUser,
  tenant: string,
  db: DbConnection
): Promise<string | null> {
  if (!isClientPortalUser(user)) {
    return null;
  }

  if (typeof user.clientId === 'string' && user.clientId.length > 0) {
    return user.clientId;
  }

  if (!user.contact_id) {
    return null;
  }

  const contact = await tenantScopedTable(db, 'contacts', tenant)
    .select('client_id')
    .where({
      contact_name_id: user.contact_id,
    })
    .first();

  return typeof contact?.client_id === 'string' ? contact.client_id : null;
}

async function hasClientPortalOwnClientPermissionForAction(
  user: QueryActionUser,
  tenant: string,
  clientId: string,
  resource: string,
  action: string,
  db: DbConnection
): Promise<boolean> {
  if (!isClientPortalUser(user)) {
    return false;
  }

  const [canUseResource, userClientId] = await Promise.all([
    hasPermissionAsync(user, resource, action, db),
    getClientPortalUserClientIdForAction(user, tenant, db)
  ]);

  return canUseResource && userClientId === clientId;
}

async function hasMspOrClientPortalOwnClientPermissionForAction(
  user: QueryActionUser,
  tenant: string,
  clientId: string,
  resource: string,
  action: string,
  db: DbConnection
): Promise<boolean> {
  if (isMspUser(user)) {
    return hasPermissionAsync(user, resource, action, db);
  }

  return hasClientPortalOwnClientPermissionForAction(user, tenant, clientId, resource, action, db);
}

async function assertMspOrClientPortalOwnClientPermissionForAction(
  user: QueryActionUser,
  tenant: string,
  clientId: string,
  resource: string,
  action: string,
  message: string,
  db: DbConnection
): Promise<void> {
  if (!await hasMspOrClientPortalOwnClientPermissionForAction(user, tenant, clientId, resource, action, db)) {
    throw new Error(message);
  }
}

async function assertCreateOrFindContactPermission(
  user: QueryActionUser,
  tenant: string,
  clientId: string,
  db: DbConnection
): Promise<void> {
  if (isClientPortalUser(user)) {
    if (!await hasClientPortalOwnClientPermissionForAction(user, tenant, clientId, 'user', 'create', db)) {
      throw new Error('Permission denied: Cannot create client users');
    }
    return;
  }

  if (!await hasMspPermissionForAction(user, 'contact', 'read', db)) {
    throw new Error('Permission denied: Cannot read contacts');
  }

  if (!await hasMspPermissionForAction(user, 'contact', 'create', db)) {
    throw new Error('Permission denied: Cannot create contacts');
  }
}

// --- Client query actions ---

export const getClientById = withAuth(async (user, { tenant }, clientId: string): Promise<IClientWithLocation | null> => {
  const { knex } = await createTenantKnex();
  await assertMspOrClientPortalOwnClientPermissionForAction(
    user,
    tenant,
    clientId,
    'client',
    'read',
    'Permission denied: Cannot read clients',
    knex
  );

  const clientData = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);
    const query = db.table<any>('clients as c');

    db.tenantJoin(query, 'users as u', 'c.account_manager_id', 'u.user_id', { type: 'left' });
    db.tenantJoin(query, 'client_locations as cl', 'c.client_id', 'cl.client_id', {
      type: 'left',
      on(join) {
        join.andOn('cl.is_default', '=', trx.raw('true'));
      },
    });

    return await query
      .select(
        'c.*',
        'cl.email as location_email',
        'cl.phone as location_phone',
        'cl.address_line1 as location_address',
        trx.raw(`CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`)
      )
      .where({ 'c.client_id': clientId })
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
  await assertMspPermissionForAction(user, 'client', 'read', 'Permission denied: Cannot read clients');

  const { knex: db } = await createTenantKnex();

  const clients = await withTransaction(db, async (trx) => {
    const query = tenantScopedTable(trx, 'clients', tenant)
      .select('*')
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
  client_name: 'clients.client_name',
  phone_number: 'contacts.created_at'
} as const;

const CONTACT_SORT_COLUMNS_ALIASED = {
  full_name: 'full_name',
  created_at: 'created_at',
  email: 'email',
  phone_number: 'created_at'
} as const;

function getDefaultPhoneNumber(contact: Pick<IContact, 'default_phone_number' | 'phone_numbers'>): string {
  return contact.default_phone_number
    || contact.phone_numbers.find((phoneNumber) => phoneNumber.is_default)?.phone_number
    || '';
}

function sortContacts(contacts: IContact[], sortBy: string, sortDirection: 'asc' | 'desc'): IContact[] {
  const direction = sortDirection === 'desc' ? -1 : 1;
  return [...contacts].sort((left, right) => {
    const leftValue = sortBy === 'phone_number'
      ? getDefaultPhoneNumber(left)
      : String((left as any)[sortBy] ?? '');
    const rightValue = sortBy === 'phone_number'
      ? getDefaultPhoneNumber(right)
      : String((right as any)[sortBy] ?? '');
    return leftValue.localeCompare(rightValue) * direction;
  });
}

export type ContactFilterStatus = 'active' | 'inactive' | 'all';

export const getContactsByClient = withAuth(async (
  user,
  { tenant },
  clientId: string,
  status: ContactFilterStatus = 'active',
  sortBy: string = 'full_name',
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> => {
  await assertMspPermissionForAction(user, 'contact', 'read', 'Permission denied: Cannot read contacts');

  const { knex: db } = await createTenantKnex();

  try {
    if (!clientId) {
      throw new Error('VALIDATION_ERROR: Client ID is required');
    }

    const allowedSortBy = ['full_name', 'created_at', 'email', 'client_name', 'phone_number'];
    const safeSortBy = allowedSortBy.includes(sortBy) ? sortBy : 'full_name';
    const safeSortDirection = sortDirection === 'desc' ? 'desc' : 'asc';

    const client = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantScopedTable(trx, 'clients', tenant)
        .where({ client_id: clientId })
        .first();
    });

    if (!client) {
      throw new Error('VALIDATION_ERROR: The specified client does not exist');
    }

    const contacts = await withTransaction(db, async (trx: Knex.Transaction) => {
      const facade = tenantDb(trx, tenant);
      const contactQuery = facade.table('contacts')
        .select('contacts.*', 'clients.client_name')
        .where('contacts.client_id', clientId)
        .modify(function (queryBuilder: Knex.QueryBuilder) {
          if (status !== 'all') {
            queryBuilder.where('contacts.is_inactive', status === 'inactive');
          }
        })
        .orderBy(CONTACT_SORT_COLUMNS[safeSortBy as keyof typeof CONTACT_SORT_COLUMNS] || 'contacts.full_name', safeSortDirection);

      facade.tenantJoin(contactQuery, 'clients', 'contacts.client_id', 'clients.client_id', { type: 'left' });

      const rows = await contactQuery;

      const hydratedRows = await ContactModel.hydrateContactsWithPhoneNumbers(rows as any[], tenant, trx);
      return sortContacts(hydratedRows as IContact[], safeSortBy, safeSortDirection);
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

function buildContactListSearchPrefixTsquery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .replace(CONTACT_LIST_SEARCH_TSQUERY_UNSAFE_RE, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `${token}:*`).join(' & ');
}

export const searchContactListIds = withAuth(async (
  user,
  { tenant },
  query: string
): Promise<string[]> => {
  await assertMspPermissionForAction(user, 'contact', 'read', 'Permission denied: Cannot read contacts');

  const rawSearch = query.replace(/\s+/g, ' ').trim();
  if (!rawSearch) {
    return [];
  }

  const permissions = ['contact:read'];
  if (await hasMspPermissionForAction(user, 'document', 'read')) {
    permissions.push('document:read');
  }
  if (await hasMspPermissionForAction(user, 'interaction', 'read')) {
    permissions.push('interaction:read');
  }

  const prefixTsquery = buildContactListSearchPrefixTsquery(rawSearch);
  const identifier = rawSearch.match(CONTACT_LIST_SEARCH_IDENTIFIER_TOKEN_PATTERN)?.[0]?.toLowerCase() ?? null;
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const searchIndex = tenantScopedDerivedTableSql(trx, tenant, 'app_search_index', 'si');
    const interactions = tenantScopedDerivedTableSql(trx, tenant, 'interactions', 'interaction_match');
    const noteContacts = tenantScopedDerivedTableSql(trx, tenant, 'contacts', 'note_contact');
    const documentAssociations = tenantScopedDerivedTableSql(trx, tenant, 'document_associations', 'document_contact_match');
    const result = await trx.raw<{ rows: Array<{ contact_id: string }> }>(
      `
        WITH q AS (
          SELECT
            websearch_to_tsquery('english', ?) AS tsq,
            CASE WHEN ?::text IS NULL THEN NULL ELSE to_tsquery('english', ?::text) END AS prefix_tsq,
            ?::text AS raw,
            ?::text AS identifier
        ),
        matched AS (
          SELECT DISTINCT
            CASE
              WHEN si.object_type = 'contact' THEN si.object_id
              WHEN si.object_type = 'interaction' THEN interaction_match.contact_name_id::text
              WHEN si.object_type = 'document' THEN coalesce(note_contact.contact_name_id::text, document_contact_match.entity_id::text)
            END AS contact_id
          FROM ${searchIndex.sql}
          CROSS JOIN q
          LEFT JOIN ${interactions.sql}
            ON si.object_type = 'interaction'
            AND interaction_match.tenant = si.tenant
            AND interaction_match.interaction_id::text = si.object_id
          LEFT JOIN ${noteContacts.sql}
            ON si.object_type = 'document'
            AND note_contact.tenant = si.tenant
            AND note_contact.notes_document_id::text = si.object_id
          LEFT JOIN ${documentAssociations.sql}
            ON si.object_type = 'document'
            AND document_contact_match.tenant = si.tenant
            AND document_contact_match.document_id::text = si.object_id
            AND document_contact_match.entity_type = 'contact'
          WHERE si.object_type = ANY(?::text[])
            AND (si.required_permission IS NULL OR si.required_permission = ANY(?::text[]))
            AND (cardinality(si.visible_to_user_ids) = 0 OR si.visible_to_user_ids && ARRAY[?]::uuid[])
            AND (si.is_internal_only = false OR ?::boolean = true)
            AND (si.is_private = false OR si.visible_to_user_ids && ARRAY[?]::uuid[])
            AND (
              si.search_vector @@ q.tsq
              OR (q.prefix_tsq IS NOT NULL AND si.search_vector @@ q.prefix_tsq)
              OR si.title ILIKE '%' || q.raw || '%'
              OR coalesce(si.subtitle, '') ILIKE '%' || q.raw || '%'
              OR si.title % q.raw
              OR coalesce(si.subtitle, '') % q.raw
              OR (
                q.identifier IS NOT NULL
                AND lower(coalesce(si.metadata->>'identifier', '')) = q.identifier
              )
              OR (
                q.identifier IS NOT NULL
                AND lower(coalesce(si.metadata->>'identifier', '')) LIKE q.identifier || '%'
              )
            )
        )
        SELECT contact_id
        FROM matched
        WHERE contact_id IS NOT NULL
      `,
      [
        rawSearch,
        prefixTsquery,
        prefixTsquery,
        rawSearch,
        identifier,
        ...searchIndex.bindings,
        ...interactions.bindings,
        ...noteContacts.bindings,
        ...documentAssociations.bindings,
        [...CONTACT_LIST_SEARCH_TYPES],
        permissions,
        user.user_id,
        true,
        user.user_id,
      ]
    );

    return result.rows.map((row) => row.contact_id);
  });
});

export const getAllContacts = withAuth(async (
  user,
  { tenant },
  status: ContactFilterStatus = 'active',
  sortBy: string = 'full_name',
  sortDirection: 'asc' | 'desc' = 'asc'
): Promise<IContact[]> => {
  await assertMspPermissionForAction(user, 'contact', 'read', 'Permission denied: Cannot read contacts');

  const { knex: db } = await createTenantKnex();

  try {
    if (!['active', 'inactive', 'all'].includes(status)) {
      throw new Error('VALIDATION_ERROR: Invalid status filter provided');
    }

    const allowedSortBy = ['full_name', 'created_at', 'email', 'client_name', 'phone_number'];
    const safeSortBy = allowedSortBy.includes(sortBy) ? sortBy : 'full_name';
    const safeSortDirection = sortDirection === 'desc' ? 'desc' : 'asc';

    console.log('[getAllContacts] Fetching contacts with status:', status, 'for tenant:', tenant);

    let contacts: any[] = [];
    try {
      contacts = await withTransaction(db, async (trx: Knex.Transaction) => {
        const dbSortBy = safeSortBy === 'client_name'
          ? 'full_name'
          : CONTACT_SORT_COLUMNS_ALIASED[safeSortBy as keyof typeof CONTACT_SORT_COLUMNS_ALIASED] || 'full_name';

        const fetchedContacts = await tenantScopedTable(trx, 'contacts', tenant)
          .select('*')
          .modify(function (queryBuilder: Knex.QueryBuilder) {
            if (status !== 'all') {
              queryBuilder.where('is_inactive', status === 'inactive');
            }
          })
          .orderBy(dbSortBy, safeSortDirection);

        console.log('[getAllContacts] Found', fetchedContacts.length, 'contacts');

        if (fetchedContacts.length > 0) {
          try {
            const clientIds = fetchedContacts.map((c: IContact) => c.client_id).filter(Boolean);
            if (clientIds.length > 0) {
              const clients = await tenantScopedTable(trx, 'clients', tenant)
                .select('client_id', 'client_name')
                .whereIn('client_id', clientIds);

              const clientMap = new Map(clients.map((c: { client_id: string; client_name: string }) => [c.client_id, c.client_name]));
              const contactsWithClientNames = fetchedContacts.map((contact: IContact) => ({
                ...contact,
                client_name: contact.client_id ? clientMap.get(contact.client_id) || null : null
              }));
              const hydratedContacts = await ContactModel.hydrateContactsWithPhoneNumbers(contactsWithClientNames as any[], tenant, trx);
              return sortContacts(hydratedContacts as IContact[], safeSortBy, safeSortDirection);
            }
          } catch (clientErr) {
            console.warn('[getAllContacts] Failed to fetch client names, proceeding without them:', clientErr);
          }
        }

        const hydratedContacts = await ContactModel.hydrateContactsWithPhoneNumbers(fetchedContacts as any[], tenant, trx);
        return sortContacts(hydratedContacts as IContact[], safeSortBy, safeSortDirection);
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
  user,
  { tenant },
  email: string
): Promise<IContact | null> => {
  await assertMspPermissionForAction(user, 'contact', 'read', 'Permission denied: Cannot read contacts');

  try {
    const { knex } = await createTenantKnex();

    const contact = await withTransaction(knex, async (trx: Knex.Transaction) =>
      ContactModel.getContactByEmail(email, tenant, trx)
    );

    return contact || null;
  } catch (error) {
    console.error('Error finding contact by email address:', error);
    throw error;
  }
});

export const createOrFindContactByEmail = withAuth(async (
  user,
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
    await assertCreateOrFindContactPermission(user, tenant, clientId, knex);
    const isClientPortal = isClientPortalUser(user);
    const normalizedEmail = email.toLowerCase();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const existingContactInTenant = await ContactModel.getContactByEmail(normalizedEmail, tenant, trx);

      if (existingContactInTenant) {
        if (existingContactInTenant.client_id !== clientId) {
          if (isClientPortal) {
            throw new Error('EMAIL_EXISTS: This email address is already in use');
          }
          if (!existingContactInTenant.client_id) {
            throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system without a client assignment');
          }
          const existingClient = await tenantScopedTable(trx, 'clients', tenant)
            .select('client_name')
            .where({ client_id: existingContactInTenant.client_id })
            .first<{ client_name: string }>();
          throw new Error(`EMAIL_EXISTS: This email is already associated with ${existingClient?.client_name || 'another client'}`);
        }
        const contactWithClientName = {
          ...existingContactInTenant,
          client_name: (existingContactInTenant as any).client_name || ''
        };
        return { contact: contactWithClientName, isNew: false };
      }

      const newContact = await ContactModel.createContact({
        full_name: name || extractNameFromEmail(email),
        email: normalizedEmail,
        client_id: clientId,
        phone_numbers: phone ? [{
          phone_number: phone,
          canonical_type: 'work',
          is_default: true,
          display_order: 0,
        }] : [],
        role: title,
        is_inactive: false,
      }, tenant, trx);

      const client = await tenantScopedTable(trx, 'clients', tenant)
        .select('client_name')
        .where({ client_id: clientId })
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
  user,
  { tenant },
  interactionId: string
): Promise<IInteraction> => {
  await assertMspPermissionForAction(user, 'interaction', 'read', 'Permission denied: Cannot read interactions');

  try {
    const { knex } = await createTenantKnex();
    const interaction = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await InteractionModel.getById(interactionId, tenant, trx);
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
