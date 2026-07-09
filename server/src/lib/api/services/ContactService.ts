/**
 * Contact Service
 * Business logic for contact-related operations
 */

import { Knex } from 'knex';
import { BaseService, ListResult, ServiceContext, withTransaction, tenantDb } from '@alga-psa/db';
import { getContactAvatarUrl } from '@alga-psa/formatting/avatarUtils';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import {
  buildContactArchivedPayload,
  buildContactCreatedPayload,
  buildContactUpdatedPayload,
} from '@alga-psa/workflow-streams';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/apiMiddleware';
import {
  ContactFilterData,
  ContactSearchData,
  CreateContactData,
  UpdateContactData,
} from '../schemas/contact';
import { ListOptions } from '../controllers/types';

type ContactListRow = Omit<IContact, 'phone_numbers'> & {
  phone_numbers?: IContact['phone_numbers'];
  client_name?: string | null;
};

function maybeUserActorFromContext(context: ServiceContext) {
  if (typeof context.userId !== 'string' || !context.userId) return undefined;
  return { actorType: 'USER' as const, actorUserId: context.userId };
}

function normalizePhoneForSearch(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizeEmailForSearch(value: string): string {
  return value.trim().toLowerCase();
}

function applyEmailSearchClause(
  query: Knex.QueryBuilder,
  knex: Knex,
  tenant: string,
  value: string,
  contactAlias = 'c'
): void {
  const normalizedEmail = normalizeEmailForSearch(value);
  const scopedDb = tenantDb(knex, tenant);
  query.where(function emailSearch() {
    this.whereILike(`${contactAlias}.email`, `%${value}%`)
      .orWhereExists(
        scopedDb.subquery('contact_additional_email_addresses as caea')
          .select(knex.raw('1'))
          .whereRaw(`caea.contact_name_id = ${contactAlias}.contact_name_id`)
          .andWhere(function matchAdditionalEmail() {
            this.whereILike('caea.email_address', `%${value}%`);
            if (normalizedEmail) {
              this.orWhere('caea.normalized_email_address', 'like', `%${normalizedEmail}%`);
            }
          })
      );
  });
}

function applyDefaultPhoneJoins(query: Knex.QueryBuilder, knex: Knex, tenant: string, contactAlias = 'c'): Knex.QueryBuilder {
  const scopedDb = tenantDb(knex, tenant);
  scopedDb.tenantJoin(query, 'contact_phone_numbers as cpn_default', `${contactAlias}.contact_name_id`, 'cpn_default.contact_name_id', {
    type: 'left',
    on(join) {
      join.andOn('cpn_default.is_default', '=', knex.raw('true'));
    },
  });
  scopedDb.tenantJoin(query, 'contact_phone_type_definitions as cptd_default', 'cpn_default.custom_phone_type_id', 'cptd_default.contact_phone_type_id', {
    type: 'left',
    rootTenantColumn: 'cpn_default.tenant',
  });
  return query;
}

function throwContactModelApiError(error: unknown): never {
  if (!(error instanceof Error)) {
    throw error;
  }

  const message = error.message;
  const [, prefix, rawDetail] = message.match(/^([A-Z_]+):\s*(.*)$/) ?? [];
  const detail = rawDetail || message;

  switch (prefix) {
    case 'VALIDATION_ERROR':
      throw new ValidationError('Validation failed', [
        { path: [], message: detail },
      ]);
    case 'EMAIL_EXISTS':
      throw new ConflictError(detail);
    case 'FOREIGN_KEY_ERROR':
      throw new ValidationError('Validation failed', [
        { path: ['client_id'], message: detail },
      ]);
    case 'NOT_FOUND':
      throw new NotFoundError(detail || 'Contact not found');
    default:
      throw error;
  }
}

export class ContactService extends BaseService<IContact> {
  constructor() {
    super({
      tableName: 'contacts',
      primaryKey: 'contact_name_id',
      tenantColumn: 'tenant',
      searchableFields: ['full_name', 'email', 'role'],
      defaultSort: 'full_name',
      defaultOrder: 'asc',
    });
  }

  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<IContact>> {
    const { knex } = await this.getKnex();
    const {
      page = 1,
      limit = 25,
      filters = {} as ContactFilterData,
      sort,
      order,
    } = options;

    const scopedDb = tenantDb(knex, context.tenant);
    let dataQuery = scopedDb.table('contacts as c');
    dataQuery = scopedDb.tenantJoin(dataQuery, 'clients as comp', 'c.client_id', 'comp.client_id', { type: 'left' });
    dataQuery = applyDefaultPhoneJoins(dataQuery, knex, context.tenant);

    let countQuery = scopedDb.table('contacts as c');
    countQuery = scopedDb.tenantJoin(countQuery, 'clients as comp', 'c.client_id', 'comp.client_id', { type: 'left' });
    countQuery = applyDefaultPhoneJoins(countQuery, knex, context.tenant);

    dataQuery = this.applyContactFilters(dataQuery, filters, knex, context.tenant);
    countQuery = this.applyContactFilters(countQuery, filters, knex, context.tenant);

    const sortField = sort || this.defaultSort;
    const sortOrder = order || this.defaultOrder;

    if (sortField === 'client_name') {
      dataQuery = dataQuery.orderBy('comp.client_name', sortOrder);
    } else if (sortField === 'phone_number') {
      dataQuery = dataQuery.orderBy('cpn_default.phone_number', sortOrder).orderBy('c.full_name', 'asc');
    } else {
      dataQuery = dataQuery.orderBy(`c.${sortField}`, sortOrder);
    }

    dataQuery = dataQuery
      .limit(limit)
      .offset((page - 1) * limit)
      .select(
        'c.*',
        'comp.client_name',
        'cpn_default.phone_number as default_phone_number',
        knex.raw('COALESCE(cptd_default.label, cpn_default.canonical_type) as default_phone_type')
      );

    const [contacts, [{ count }]] = await Promise.all([
      dataQuery,
      countQuery.countDistinct('c.contact_name_id as count') as unknown as Promise<Array<{ count: string }>>,
    ]);

    const contactsWithPhones = await withTransaction(knex, async (trx) =>
      ContactModel.hydrateContactsWithPhoneNumbers(contacts as any[], context.tenant, trx)
    );

    const contactsWithAvatars = await Promise.all(
      contactsWithPhones.map(async (contact: IContact) => ({
        ...contact,
        avatarUrl: await getContactAvatarUrl(contact.contact_name_id, context.tenant),
      }))
    );

    return {
      data: contactsWithAvatars,
      total: parseInt(count as string, 10),
    };
  }

  async getById(id: string, context: ServiceContext): Promise<IContact | null> {
    const { knex } = await this.getKnex();

    const contact = await withTransaction(knex, async (trx) => {
      const scopedDb = tenantDb(trx, context.tenant);
      const contactQuery = scopedDb.table('contacts as c');
      scopedDb.tenantJoin(contactQuery, 'clients as comp', 'c.client_id', 'comp.client_id', { type: 'left' });
      scopedDb.tenantJoin(contactQuery, 'client_locations as cl', 'comp.client_id', 'cl.client_id', {
        type: 'left',
        rootTenantColumn: 'comp.tenant',
        on(join) {
          join.andOn('cl.is_default', '=', knex.raw('true'));
        },
      });
      const baseContact = await applyDefaultPhoneJoins(contactQuery, trx, context.tenant)
        .where('c.contact_name_id', id)
        .select(
          'c.*',
          'comp.client_name',
          'cl.email as client_email',
          'cl.phone as client_phone',
          'comp.is_inactive as client_inactive',
          'cpn_default.phone_number as default_phone_number',
          knex.raw('COALESCE(cptd_default.label, cpn_default.canonical_type) as default_phone_type')
        )
        .first();

      if (!baseContact) {
        return null;
      }

      const [hydrated] = await ContactModel.hydrateContactsWithPhoneNumbers([baseContact as any], context.tenant, trx);
      return hydrated as IContact;
    });

    if (!contact) {
      return null;
    }

    return {
      ...contact,
      avatarUrl: await getContactAvatarUrl(id, context.tenant),
    } as IContact;
  }

  async create(data: Partial<IContact>, context: ServiceContext): Promise<IContact> {
    const { knex } = await this.getKnex();

    const contact = await withTransaction(knex, async (trx) => {
      const created = await ContactModel.createContact(
        {
          full_name: data.full_name ?? '',
          client_id: data.client_id ?? undefined,
          phone_numbers: data.phone_numbers ?? [],
          email: data.email ?? undefined,
          primary_email_canonical_type: data.primary_email_canonical_type ?? undefined,
          primary_email_custom_type: data.primary_email_custom_type ?? undefined,
          primary_email_custom_type_id: data.primary_email_custom_type_id ?? undefined,
          additional_email_addresses: data.additional_email_addresses ?? [],
          role: data.role ?? undefined,
          notes: data.notes ?? undefined,
          is_inactive: data.is_inactive ?? false,
        },
        context.tenant,
        trx
      );

      if ((data as any).tags && (data as any).tags.length > 0) {
        await this.handleTags(created.contact_name_id, (data as any).tags, context, trx);
      }

      return ContactModel.getContactById(created.contact_name_id, context.tenant, trx);
    }).catch(throwContactModelApiError);

    if (!contact) {
      throw new NotFoundError('Contact not found');
    }

    const clientId = contact.client_id;
    if (typeof clientId === 'string' && clientId) {
      const occurredAt = contact.created_at ?? new Date().toISOString();
      const actor = maybeUserActorFromContext(context);
      await publishWorkflowEvent({
        eventType: 'CONTACT_CREATED',
        payload: buildContactCreatedPayload({
          contactId: contact.contact_name_id,
          clientId,
          fullName: contact.full_name,
          email: contact.email || undefined,
          primaryEmailCanonicalType: contact.primary_email_canonical_type ?? null,
          primaryEmailCustomTypeId: contact.primary_email_custom_type_id ?? null,
          primaryEmailType: contact.primary_email_type ?? null,
          additionalEmailAddresses: contact.additional_email_addresses ?? [],
          phoneNumbers: contact.phone_numbers,
          defaultPhoneNumber: contact.default_phone_number || undefined,
          defaultPhoneType: contact.default_phone_type || undefined,
          createdByUserId: typeof context.userId === 'string' ? context.userId : undefined,
          createdAt: occurredAt,
        }),
        ctx: { tenantId: context.tenant, occurredAt, actor },
        idempotencyKey: `contact_created:${contact.contact_name_id}`,
      });
    }

    return contact;
  }

  async createContact(data: CreateContactData, context: ServiceContext): Promise<IContact> {
    return this.create(data as Partial<IContact>, context);
  }

  async update(id: string, data: UpdateContactData, context: ServiceContext): Promise<IContact> {
    const { knex } = await this.getKnex();

    const result = await withTransaction(knex, async (trx) => {
      const before = await ContactModel.getContactById(id, context.tenant, trx);
      if (!before) {
        throw new NotFoundError('Contact not found');
      }

      const after = await ContactModel.updateContact(id, data, context.tenant, trx);

      if (data.tags) {
        await this.handleTags(id, data.tags, context, trx);
      }

      const updatedFieldKeys = Object.keys(data).filter((key) => (data as Record<string, unknown>)[key] !== undefined);
      return { before, after, updatedFieldKeys };
    }).catch(throwContactModelApiError);

    const occurredAt = result.after.updated_at ?? new Date().toISOString();
    const actor = maybeUserActorFromContext(context);
    const clientId = result.after.client_id ?? result.before.client_id;

    if (typeof clientId === 'string' && clientId) {
      const wasInactive = Boolean(result.before.is_inactive);
      const isInactive = Boolean(result.after.is_inactive);
      if (!wasInactive && isInactive) {
        await publishWorkflowEvent({
          eventType: 'CONTACT_ARCHIVED',
          payload: buildContactArchivedPayload({
            contactId: id,
            clientId,
            archivedByUserId: typeof context.userId === 'string' ? context.userId : undefined,
            archivedAt: occurredAt,
          }),
          ctx: { tenantId: context.tenant, occurredAt, actor },
          idempotencyKey: `contact_archived:${id}:${occurredAt}`,
        });
      }

      const updatedPayload = buildContactUpdatedPayload({
        contactId: id,
        clientId,
        before: result.before as any,
        after: result.after as any,
        updatedFieldKeys: result.updatedFieldKeys,
        updatedByUserId: typeof context.userId === 'string' ? context.userId : undefined,
        updatedAt: occurredAt,
      });

      const updatedFields = (updatedPayload as any).updatedFields;
      const changes = (updatedPayload as any).changes;
      if ((Array.isArray(updatedFields) && updatedFields.length) || (changes && Object.keys(changes).length)) {
        await publishWorkflowEvent({
          eventType: 'CONTACT_UPDATED',
          payload: updatedPayload,
          ctx: { tenantId: context.tenant, occurredAt, actor },
          idempotencyKey: `contact_updated:${id}:${occurredAt}`,
        });
      }
    }

    return result.after;
  }

  async getContactsByClient(clientId: string, context: ServiceContext): Promise<IContact[]> {
    const { knex } = await this.getKnex();
    const contacts = await withTransaction(knex, async (trx) => {
      const scopedDb = tenantDb(trx, context.tenant);
      const contactsQuery = scopedDb.table('contacts as c');
      scopedDb.tenantJoin(contactsQuery, 'clients as comp', 'c.client_id', 'comp.client_id', { type: 'left' });
      const rows = await applyDefaultPhoneJoins(contactsQuery, trx, context.tenant)
        .where('c.client_id', clientId)
        .select(
          'c.*',
          'comp.client_name',
          'cpn_default.phone_number as default_phone_number',
          knex.raw('COALESCE(cptd_default.label, cpn_default.canonical_type) as default_phone_type')
        )
        .orderBy('c.full_name', 'asc');

      return ContactModel.hydrateContactsWithPhoneNumbers(rows as any[], context.tenant, trx);
    });

    return Promise.all(
      contacts.map(async (contact) => ({
        ...contact,
        avatarUrl: await getContactAvatarUrl(contact.contact_name_id, context.tenant),
      }))
    );
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();

    const deletedContact = await withTransaction(knex, async (trx) => {
      const before = await ContactModel.getContactById(id, context.tenant, trx);
      if (!before) {
        throw new NotFoundError('Contact not found');
      }

      await tenantDb(trx, context.tenant).table('contacts')
        .where('contact_name_id', id)
        .delete();

      return before;
    });

    const occurredAt = new Date().toISOString();
    const actor = maybeUserActorFromContext(context);
    await publishWorkflowEvent({
      eventType: 'CONTACT_DELETED',
      payload: {
        contactId: id,
        ...(deletedContact.client_id ? { clientId: deletedContact.client_id } : {}),
        ...(typeof context.userId === 'string' ? { deletedByUserId: context.userId } : {}),
        deletedAt: occurredAt,
      },
      ctx: { tenantId: context.tenant, occurredAt, actor },
      idempotencyKey: `contact_deleted:${id}:${occurredAt}`,
    });
  }

  async search(searchData: ContactSearchData, context: ServiceContext): Promise<IContact[]> {
    const { knex } = await this.getKnex();

    const scopedDb = tenantDb(knex, context.tenant);
    let query = scopedDb.table('contacts as c');
    query = scopedDb.tenantJoin(query, 'clients as comp', 'c.client_id', 'comp.client_id', { type: 'left' });
    query = applyDefaultPhoneJoins(query, knex, context.tenant);

    if (!searchData.include_inactive) {
      query = query.where('c.is_inactive', false);
    }

    if (searchData.client_id) {
      query = query.where('c.client_id', searchData.client_id);
    }

    const searchFields = searchData.fields || ['full_name', 'email', 'phone_number', 'role'];
    query = query.where((subQuery) => {
      searchFields.forEach((field, index) => {
        const method = index === 0 ? 'where' : 'orWhere';
        if (field === 'phone_number') {
          const normalizedDigits = normalizePhoneForSearch(searchData.query);
          subQuery[method](function phoneSearch() {
            this.whereExists(
              scopedDb.subquery('contact_phone_numbers as cpn')
                .select(knex.raw('1'))
                .whereRaw('cpn.contact_name_id = c.contact_name_id')
                .andWhere(function matchPhone() {
                  this.whereILike('cpn.phone_number', `%${searchData.query}%`);
                  if (normalizedDigits) {
                    this.orWhere('cpn.normalized_phone_number', 'like', `%${normalizedDigits}%`);
                  }
                })
            );
          });
        } else if (field === 'email') {
          subQuery[method](function emailSearch() {
            applyEmailSearchClause(this, knex, context.tenant, searchData.query, 'c');
          });
        } else {
          subQuery[method](`c.${field}`, 'ilike', `%${searchData.query}%`);
        }
      });

      subQuery.orWhereILike('comp.client_name', `%${searchData.query}%`);
    });

    const contacts = await query
      .select(
        'c.*',
        'comp.client_name',
        'cpn_default.phone_number as default_phone_number',
        knex.raw('COALESCE(cptd_default.label, cpn_default.canonical_type) as default_phone_type')
      )
      .limit(searchData.limit || 25)
      .orderBy('c.full_name', 'asc');

    const hydratedContacts = await withTransaction(knex, async (trx) =>
      ContactModel.hydrateContactsWithPhoneNumbers(contacts as any[], context.tenant, trx)
    );

    return Promise.all(
      hydratedContacts.map(async (contact) => ({
        ...contact,
        avatarUrl: await getContactAvatarUrl(contact.contact_name_id, context.tenant),
      }))
    );
  }

  async getContactStats(context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();

    const [totalStats, roleStats, recentStats] = await Promise.all([
      tenantDb(knex, context.tenant).table('contacts')
        .select(
          knex.raw('COUNT(*) as total_contacts'),
          knex.raw('COUNT(CASE WHEN is_inactive = false THEN 1 END) as active_contacts'),
          knex.raw('COUNT(CASE WHEN is_inactive = true THEN 1 END) as inactive_contacts'),
          knex.raw('COUNT(CASE WHEN client_id IS NOT NULL THEN 1 END) as contacts_with_client'),
          knex.raw('COUNT(CASE WHEN client_id IS NULL THEN 1 END) as contacts_without_client')
        )
        .first(),
      tenantDb(knex, context.tenant).table('contacts')
        .whereNotNull('role')
        .where('role', '!=', '')
        .groupBy('role')
        .select('role', knex.raw('COUNT(*) as count')),
      tenantDb(knex, context.tenant).table('contacts')
        .where('created_at', '>=', knex.raw("now() - interval '30 days'"))
        .count('* as recent_contacts')
        .first(),
    ]);

    return {
      total_contacts: parseInt(totalStats.total_contacts as string, 10),
      active_contacts: parseInt(totalStats.active_contacts as string, 10),
      inactive_contacts: parseInt(totalStats.inactive_contacts as string, 10),
      contacts_with_client: parseInt(totalStats.contacts_with_client as string, 10),
      contacts_without_client: parseInt(totalStats.contacts_without_client as string, 10),
      contacts_by_role: roleStats.reduce((acc: any, row: any) => {
        acc[row.role] = parseInt(row.count, 10);
        return acc;
      }, {}),
      recent_contacts: parseInt((recentStats?.recent_contacts as string) || '0', 10),
    };
  }

  async exportContacts(
    filters: ContactFilterData,
    format: 'csv' | 'json',
    context: ServiceContext
  ): Promise<string> {
    const { knex } = await this.getKnex();

    const scopedDb = tenantDb(knex, context.tenant);
    let query = scopedDb.table('contacts as c');
    query = scopedDb.tenantJoin(query, 'clients as comp', 'c.client_id', 'comp.client_id', { type: 'left' });
    query = applyDefaultPhoneJoins(query, knex, context.tenant);

    query = this.applyContactFilters(query, {
      is_inactive: false,
      ...filters,
    }, knex, context.tenant);

    const contacts = await query
      .select(
        'c.contact_name_id',
        'c.full_name',
        'c.email',
        'c.role',
        'c.is_inactive',
        'c.created_at',
        'comp.client_name',
        'cpn_default.phone_number as default_phone_number',
        knex.raw('COALESCE(cptd_default.label, cpn_default.canonical_type) as default_phone_type')
      )
      .orderBy('c.full_name', 'asc');

    if (format === 'json') {
      return JSON.stringify(contacts, null, 2);
    }

    const headers = [
      'ID', 'Full Name', 'Email', 'Phone', 'Phone Type', 'Role',
      'Client', 'Inactive', 'Created At',
    ];

    const rows = contacts.map((contact: any) => [
      contact.contact_name_id,
      contact.full_name,
      contact.email,
      contact.default_phone_number,
      contact.default_phone_type || '',
      contact.role || '',
      contact.client_name || '',
      contact.is_inactive ? 'Yes' : 'No',
      contact.created_at,
    ]);

    return [headers, ...rows]
      .map((row) => row.map((field) => `"${String(field || '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }

  private applyContactFilters(query: Knex.QueryBuilder, filters: ContactFilterData, knex: Knex, tenant: string): Knex.QueryBuilder {
    const scopedDb = tenantDb(knex, tenant);
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;

      switch (key) {
        case 'full_name':
          query.whereILike('c.full_name', `%${value}%`);
          break;
        case 'email':
          query.where((subQuery) => {
            applyEmailSearchClause(subQuery, knex, tenant, String(value), 'c');
          });
          break;
        case 'phone_number': {
          const normalizedDigits = normalizePhoneForSearch(String(value));
          query.where((subQuery) => {
            subQuery.whereExists(
              scopedDb.subquery('contact_phone_numbers as cpn_filter')
                .select(knex.raw('1'))
                .whereRaw('cpn_filter.contact_name_id = c.contact_name_id')
                .andWhere(function matchPhone() {
                  this.whereILike('cpn_filter.phone_number', `%${value}%`);
                  if (normalizedDigits) {
                    this.orWhere('cpn_filter.normalized_phone_number', 'like', `%${normalizedDigits}%`);
                  }
                })
            );
          });
          break;
        }
        case 'client_id':
          query.where('c.client_id', value);
          break;
        case 'role':
          query.whereILike('c.role', `%${value}%`);
          break;
        case 'is_inactive':
          query.where('c.is_inactive', value);
          break;
        case 'has_client':
          if (value) {
            query.whereNotNull('c.client_id');
          } else {
            query.whereNull('c.client_id');
          }
          break;
        case 'client_name':
          query.whereILike('comp.client_name', `%${value}%`);
          break;
        case 'search': {
          const normalizedDigits = normalizePhoneForSearch(String(value));
          query.where((subQuery) => {
            subQuery
              .whereILike('c.full_name', `%${value}%`)
              .orWhere(function emailSearch() {
                applyEmailSearchClause(this, knex, tenant, String(value), 'c');
              })
              .orWhereILike('c.role', `%${value}%`)
              .orWhereILike('comp.client_name', `%${value}%`)
              .orWhereExists(
                scopedDb.subquery('contact_phone_numbers as cpn_search')
                  .select(knex.raw('1'))
                  .whereRaw('cpn_search.contact_name_id = c.contact_name_id')
                  .andWhere(function matchPhone() {
                    this.whereILike('cpn_search.phone_number', `%${value}%`);
                    if (normalizedDigits) {
                      this.orWhere('cpn_search.normalized_phone_number', 'like', `%${normalizedDigits}%`);
                    }
                  })
              );
          });
          break;
        }
        case 'created_from':
          query.where('c.created_at', '>=', value);
          break;
        case 'created_to':
          query.where('c.created_at', '<=', value);
          break;
        case 'updated_from':
          query.where('c.updated_at', '>=', value);
          break;
        case 'updated_to':
          query.where('c.updated_at', '<=', value);
          break;
        default:
          break;
      }
    });

    return query;
  }

  private async handleTags(
    contactId: string,
    tags: string[],
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    const contactTags = () =>
      tenantDb(trx, context.tenant).unscoped(
        'contact_tags',
        'legacy contact tags table is not schema-backed tenant metadata'
      );

    await contactTags()
      .where({ contact_name_id: contactId, tenant: context.tenant })
      .delete();

    if (tags.length === 0) {
      return;
    }

    await contactTags().insert(
      tags.map((tag) => ({
        contact_name_id: contactId,
        tag_name: tag,
        tenant: context.tenant,
        created_at: trx.raw('now()'),
      }))
    );
  }
}
