/**
 * Contact Service
 * Business logic for contact-related operations
 */

import { Knex } from 'knex';
import { BaseService, ListResult, ServiceContext, withTransaction } from '@alga-psa/db';
import { getContactAvatarUrl } from '@alga-psa/formatting/avatarUtils';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import {
  buildContactArchivedPayload,
  buildContactCreatedPayload,
  buildContactUpdatedPayload,
} from '@alga-psa/workflow-streams';
import { NotFoundError } from '../middleware/apiMiddleware';
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

function applyDefaultPhoneJoins(query: Knex.QueryBuilder, knex: Knex, contactAlias = 'c'): Knex.QueryBuilder {
  return query
    .leftJoin('contact_phone_numbers as cpn_default', function joinDefaultPhone() {
      this.on(`${contactAlias}.contact_name_id`, '=', 'cpn_default.contact_name_id')
        .andOn(`${contactAlias}.tenant`, '=', 'cpn_default.tenant')
        .andOn('cpn_default.is_default', '=', knex.raw('true'));
    })
    .leftJoin('contact_phone_type_definitions as cptd_default', function joinDefaultPhoneType() {
      this.on('cpn_default.custom_phone_type_id', '=', 'cptd_default.contact_phone_type_id')
        .andOn('cpn_default.tenant', '=', 'cptd_default.tenant');
    });
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

    let dataQuery = applyDefaultPhoneJoins(
      knex('contacts as c')
        .leftJoin('clients as comp', function joinClients() {
          this.on('c.client_id', '=', 'comp.client_id')
            .andOn('c.tenant', '=', 'comp.tenant');
        })
        .where('c.tenant', context.tenant),
      knex
    );

    let countQuery = applyDefaultPhoneJoins(
      knex('contacts as c')
        .leftJoin('clients as comp', function joinClients() {
          this.on('c.client_id', '=', 'comp.client_id')
            .andOn('c.tenant', '=', 'comp.tenant');
        })
        .where('c.tenant', context.tenant),
      knex
    );

    dataQuery = this.applyContactFilters(dataQuery, filters);
    countQuery = this.applyContactFilters(countQuery, filters);

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
      countQuery.countDistinct('c.contact_name_id as count'),
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
      const baseContact = await applyDefaultPhoneJoins(
        trx('contacts as c')
          .leftJoin('clients as comp', function joinClients() {
            this.on('c.client_id', '=', 'comp.client_id')
              .andOn('c.tenant', '=', 'comp.tenant');
          })
          .leftJoin('client_locations as cl', function joinClientLocation() {
            this.on('comp.client_id', '=', 'cl.client_id')
              .andOn('comp.tenant', '=', 'cl.tenant')
              .andOn('cl.is_default', '=', knex.raw('true'));
          })
          .where({ 'c.contact_name_id': id, 'c.tenant': context.tenant }),
        knex
      )
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
    });

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
    });

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
      const rows = await applyDefaultPhoneJoins(
        trx('contacts as c')
          .leftJoin('clients as comp', function joinClients() {
            this.on('c.client_id', '=', 'comp.client_id')
              .andOn('c.tenant', '=', 'comp.tenant');
          })
          .where({
            'c.client_id': clientId,
            'c.tenant': context.tenant,
          }),
        knex
      )
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

  async search(searchData: ContactSearchData, context: ServiceContext): Promise<IContact[]> {
    const { knex } = await this.getKnex();

    let query = applyDefaultPhoneJoins(
      knex('contacts as c')
        .leftJoin('clients as comp', function joinClients() {
          this.on('c.client_id', '=', 'comp.client_id')
            .andOn('c.tenant', '=', 'comp.tenant');
        })
        .where('c.tenant', context.tenant),
      knex
    );

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
            this.whereExists(function existsPhone() {
              this.select(knex.raw('1'))
                .from('contact_phone_numbers as cpn')
                .whereRaw('cpn.tenant = c.tenant')
                .andWhereRaw('cpn.contact_name_id = c.contact_name_id')
                .andWhere(function matchPhone() {
                  this.whereILike('cpn.phone_number', `%${searchData.query}%`);
                  if (normalizedDigits) {
                    this.orWhere('cpn.normalized_phone_number', 'like', `%${normalizedDigits}%`);
                  }
                });
            });
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
      knex('contacts')
        .where('tenant', context.tenant)
        .select(
          knex.raw('COUNT(*) as total_contacts'),
          knex.raw('COUNT(CASE WHEN is_inactive = false THEN 1 END) as active_contacts'),
          knex.raw('COUNT(CASE WHEN is_inactive = true THEN 1 END) as inactive_contacts'),
          knex.raw('COUNT(CASE WHEN client_id IS NOT NULL THEN 1 END) as contacts_with_client'),
          knex.raw('COUNT(CASE WHEN client_id IS NULL THEN 1 END) as contacts_without_client')
        )
        .first(),
      knex('contacts')
        .where('tenant', context.tenant)
        .whereNotNull('role')
        .where('role', '!=', '')
        .groupBy('role')
        .select('role', knex.raw('COUNT(*) as count')),
      knex('contacts')
        .where('tenant', context.tenant)
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

    let query = applyDefaultPhoneJoins(
      knex('contacts as c')
        .leftJoin('clients as comp', function joinClients() {
          this.on('c.client_id', '=', 'comp.client_id')
            .andOn('c.tenant', '=', 'comp.tenant');
        })
        .where('c.tenant', context.tenant),
      knex
    );

    query = this.applyContactFilters(query, {
      is_inactive: false,
      ...filters,
    });

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

  private applyContactFilters(query: Knex.QueryBuilder, filters: ContactFilterData): Knex.QueryBuilder {
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;

      switch (key) {
        case 'full_name':
          query.whereILike('c.full_name', `%${value}%`);
          break;
        case 'email':
          query.whereILike('c.email', `%${value}%`);
          break;
        case 'phone_number': {
          const normalizedDigits = normalizePhoneForSearch(String(value));
          query.where((subQuery) => {
            subQuery.whereExists(function existsPhone() {
              this.select(query.client!.raw('1'))
                .from('contact_phone_numbers as cpn_filter')
                .whereRaw('cpn_filter.tenant = c.tenant')
                .andWhereRaw('cpn_filter.contact_name_id = c.contact_name_id')
                .andWhere(function matchPhone() {
                  this.whereILike('cpn_filter.phone_number', `%${value}%`);
                  if (normalizedDigits) {
                    this.orWhere('cpn_filter.normalized_phone_number', 'like', `%${normalizedDigits}%`);
                  }
                });
            });
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
              .orWhereILike('c.email', `%${value}%`)
              .orWhereILike('c.role', `%${value}%`)
              .orWhereILike('comp.client_name', `%${value}%`)
              .orWhereExists(function existsPhone() {
                this.select(query.client!.raw('1'))
                  .from('contact_phone_numbers as cpn_search')
                  .whereRaw('cpn_search.tenant = c.tenant')
                  .andWhereRaw('cpn_search.contact_name_id = c.contact_name_id')
                  .andWhere(function matchPhone() {
                    this.whereILike('cpn_search.phone_number', `%${value}%`);
                    if (normalizedDigits) {
                      this.orWhere('cpn_search.normalized_phone_number', 'like', `%${normalizedDigits}%`);
                    }
                  });
              });
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
    await trx('contact_tags')
      .where({ contact_name_id: contactId, tenant: context.tenant })
      .delete();

    if (tags.length === 0) {
      return;
    }

    await trx('contact_tags').insert(
      tags.map((tag) => ({
        contact_name_id: contactId,
        tag_name: tag,
        tenant: context.tenant,
        created_at: trx.raw('now()'),
      }))
    );
  }
}
