/**
 * Contact Service
 * Business logic for contact-related operations
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListResult } from '@alga-psa/db';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { withTransaction } from '@alga-psa/db';
import { getContactAvatarUrl } from 'server/src/lib/utils/avatarUtils';
import { NotFoundError } from '../middleware/apiMiddleware';
import { 
  CreateContactData, 
  UpdateContactData, 
  ContactFilterData,
  ContactSearchData
} from '../schemas/contact';
import { ListOptions } from '../controllers/types';

export class ContactService extends BaseService<IContact> {
  constructor() {
    super({
      tableName: 'contacts',
      primaryKey: 'contact_name_id',
      tenantColumn: 'tenant',
      searchableFields: ['full_name', 'email', 'phone_number', 'role'],
      defaultSort: 'full_name',
      defaultOrder: 'asc'
    });
  }

  /**
   * List contacts with enhanced filtering and search
   */
  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<IContact>> {
    const { knex } = await this.getKnex();
    
    const {
      page = 1,
      limit = 25,
      filters = {} as ContactFilterData,
      sort,
      order
    } = options;

    // Build base query with client join
    let dataQuery = knex('contacts as c')
      .leftJoin('clients as comp', function() {
        this.on('c.client_id', '=', 'comp.client_id')
            .andOn('c.tenant', '=', 'comp.tenant');
      })
      .where('c.tenant', context.tenant);

    let countQuery = knex('contacts as c')
      .where('c.tenant', context.tenant);

    // Apply filters
    dataQuery = this.applyContactFilters(dataQuery, filters);
    countQuery = this.applyContactFilters(countQuery, filters);

    // Apply sorting
    const sortField = sort || this.defaultSort;
    const sortOrder = order || this.defaultOrder;
    
    // Handle sorting by client name
    if (sortField === 'client_name') {
      dataQuery = dataQuery.orderBy('comp.client_name', sortOrder);
    } else {
      dataQuery = dataQuery.orderBy(`c.${sortField}`, sortOrder);
    }

    // Apply pagination
    const offset = (page - 1) * limit;
    dataQuery = dataQuery.limit(limit).offset(offset);

    // Select fields
    dataQuery = dataQuery.select(
      'c.*',
      'comp.client_name'
    );

    // Execute queries
    const [contacts, [{ count }]] = await Promise.all([
      dataQuery,
      countQuery.count('* as count')
    ]);

    // Add avatar URLs
    const contactsWithAvatars = await Promise.all(
      contacts.map(async (contact: IContact) => {
        const avatarUrl = await getContactAvatarUrl(contact.contact_name_id, context.tenant);
        return { ...contact, avatarUrl };
      })
    );

    return {
      data: contactsWithAvatars,
      total: parseInt(count as string)
    };
  }

  /**
   * Get contact by ID with client details
   */
  async getById(id: string, context: ServiceContext): Promise<IContact | null> {
    const { knex } = await this.getKnex();

    const contact = await knex('contacts as c')
      .leftJoin('clients as comp', function() {
        this.on('c.client_id', '=', 'comp.client_id')
            .andOn('c.tenant', '=', 'comp.tenant');
      })
      .leftJoin('client_locations as cl', function() {
        this.on('comp.client_id', '=', 'cl.client_id')
            .andOn('comp.tenant', '=', 'cl.tenant')
            .andOn('cl.is_default', '=', knex.raw('true'));
      })
      .select(
        'c.*',
        'comp.client_name',
        'cl.email as client_email',
        'cl.phone as client_phone',
        'comp.is_inactive as client_inactive'
      )
      .where({ 'c.contact_name_id': id, 'c.tenant': context.tenant })
      .first();

    if (!contact) {
      return null;
    }

    // Get avatar URL
    const avatarUrl = await getContactAvatarUrl(id, context.tenant);

    return {
      ...contact,
      avatarUrl
    } as IContact;
  }

  /**
   * Create new contact
   */
  async create(data: Partial<IContact>, context: ServiceContext): Promise<IContact> {
      const { knex } = await this.getKnex();
  
      return withTransaction(knex, async (trx) => {
        // Validate client exists if provided
        if (data.client_id) {
          const client = await trx('clients')
            .where({ client_id: data.client_id, tenant: context.tenant })
            .first();
          
          if (!client) {
            throw new Error('Client not found');
          }
        }
  
        // Prepare contact data
        const contactData = {
          contact_name_id: knex.raw('gen_random_uuid()'),
          full_name: data.full_name,
          client_id: data.client_id || null,
          phone_number: data.phone_number || '',
          email: data.email,
          role: data.role || '',
          notes: data.notes,
          is_inactive: data.is_inactive || false,
          tenant: context.tenant,
          created_at: knex.raw('now()'),
          updated_at: knex.raw('now()')
        };
  
        // Insert contact
        const [contact] = await trx('contacts').insert(contactData).returning('*');
  
        // Handle tags if provided
        if ((data as any).tags && (data as any).tags.length > 0) {
          await this.handleTags(contact.contact_name_id, (data as any).tags, context, trx);
        }
  
        return contact as IContact;
      });
    }
  
    /**
     * Create contact with typed data
     */
    async createContact(data: CreateContactData, context: ServiceContext): Promise<IContact> {
      return this.create(data as Partial<IContact>, context);
    }


  /**
   * Update contact
   */
  async update(id: string, data: UpdateContactData, context: ServiceContext): Promise<IContact> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Validate client exists if provided
      if (data.client_id) {
        const client = await trx('clients')
          .where({ client_id: data.client_id, tenant: context.tenant })
          .first();
        
        if (!client) {
          throw new Error('Client not found');
        }
      }

      // Prepare update data
      const updateData = {
        ...data,
        updated_at: knex.raw('now()')
      };

      // Remove undefined values
      Object.keys(updateData).forEach(key => {
        if ((updateData as any)[key] === undefined) {
          delete (updateData as any)[key];
        }
      });

      // Update contact
      const [contact] = await trx('contacts')
        .where({ contact_name_id: id, tenant: context.tenant })
        .update(updateData)
        .returning('*');

      if (!contact) {
        throw new NotFoundError('Contact not found');
      }

      // Handle tags if provided
      if (data.tags) {
        await this.handleTags(id, data.tags, context, trx);
      }

      return contact as IContact;
    });
  }

  /**
   * Get contacts by client ID
   */
  async getContactsByClient(clientId: string, context: ServiceContext): Promise<IContact[]> {
    const { knex } = await this.getKnex();

    const contacts = await knex('contacts')
      .where({
        client_id: clientId,
        tenant: context.tenant
      })
      .orderBy('full_name', 'asc');

    // Add avatar URLs
    const contactsWithAvatars = await Promise.all(
      contacts.map(async (contact: IContact) => {
        const avatarUrl = await getContactAvatarUrl(contact.contact_name_id, context.tenant);
        return { ...contact, avatarUrl };
      })
    );

    return contactsWithAvatars;
  }

  /**
   * Search contacts with advanced options
   */
  async search(searchData: ContactSearchData, context: ServiceContext): Promise<IContact[]> {
    const { knex } = await this.getKnex();

    let query = knex('contacts as c')
      .leftJoin('clients as comp', function() {
        this.on('c.client_id', '=', 'comp.client_id')
            .andOn('c.tenant', '=', 'comp.tenant');
      })
      .where('c.tenant', context.tenant);

    // Apply search filters
    if (!searchData.include_inactive) {
      query = query.where('c.is_inactive', false);
    }

    if (searchData.client_id) {
      query = query.where('c.client_id', searchData.client_id);
    }

    // Apply search query
    const searchFields = searchData.fields || ['full_name', 'email', 'phone_number', 'role'];
    query = query.where(subQuery => {
      searchFields.forEach((field, index) => {
        if (index === 0) {
          subQuery.whereILike(`c.${field}`, `%${searchData.query}%`);
        } else {
          subQuery.orWhereILike(`c.${field}`, `%${searchData.query}%`);
        }
      });
      
      // Also search in client name
      subQuery.orWhereILike('comp.client_name', `%${searchData.query}%`);
    });

    // Apply limit and execute
    const contacts = await query
      .select('c.*', 'comp.client_name')
      .limit(searchData.limit || 25)
      .orderBy('c.full_name', 'asc');

    // Add avatar URLs
    const contactsWithAvatars = await Promise.all(
      contacts.map(async (contact: IContact) => {
        const avatarUrl = await getContactAvatarUrl(contact.contact_name_id, context.tenant);
        return { ...contact, avatarUrl };
      })
    );

    return contactsWithAvatars;
  }

  /**
   * Get contact statistics
   */
  async getContactStats(context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();

    const [
      totalStats,
      roleStats,
      recentStats
    ] = await Promise.all([
      // Total and active/inactive counts
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

      // Contacts by role
      knex('contacts')
        .where('tenant', context.tenant)
        .whereNotNull('role')
        .where('role', '!=', '')
        .groupBy('role')
        .select('role', knex.raw('COUNT(*) as count')),

      // Recent contacts (last 30 days)
      knex('contacts')
        .where('tenant', context.tenant)
        .where('created_at', '>=', knex.raw("now() - interval '30 days'"))
        .count('* as recent_contacts')
        .first()
    ]);

    return {
      total_contacts: parseInt(totalStats.total_contacts as string),
      active_contacts: parseInt(totalStats.active_contacts as string),
      inactive_contacts: parseInt(totalStats.inactive_contacts as string),
      contacts_with_client: parseInt(totalStats.contacts_with_client as string),
      contacts_without_client: parseInt(totalStats.contacts_without_client as string),
      contacts_by_role: roleStats.reduce((acc: any, row: any) => {
        acc[row.role] = parseInt(row.count);
        return acc;
      }, {}),
      recent_contacts: parseInt(recentStats?.recent_contacts as string || '0')
    };
  }

  /**
   * Export contacts to CSV or JSON
   */
  async exportContacts(
    filters: ContactFilterData, 
    format: 'csv' | 'json',
    context: ServiceContext
  ): Promise<string> {
    const { knex } = await this.getKnex();

    let query = knex('contacts as c')
      .leftJoin('clients as comp', function() {
        this.on('c.client_id', '=', 'comp.client_id')
            .andOn('c.tenant', '=', 'comp.tenant');
      })
      .where('c.tenant', context.tenant);

    // Apply filters with default to exclude inactive contacts unless explicitly requested
    const filtersWithDefaults = {
      is_inactive: false, // Default to active contacts only
      ...filters // Allow override if explicitly set
    };
    query = this.applyContactFilters(query, filtersWithDefaults);

    // Select export fields
    const contacts = await query.select(
      'c.contact_name_id',
      'c.full_name',
      'c.email',
      'c.phone_number',
      'c.role',
      'c.is_inactive',
      'c.created_at',
      'comp.client_name'
    ).orderBy('c.full_name', 'asc');

    if (format === 'json') {
      return JSON.stringify(contacts, null, 2);
    } else {
      // Convert to CSV format
      const headers = [
        'ID', 'Full Name', 'Email', 'Phone', 'Role',
        'Client', 'Inactive', 'Created At'
      ];
      
      const rows = contacts.map(contact => [
        contact.contact_name_id,
        contact.full_name,
        contact.email,
        contact.phone_number,
        contact.role || '',
        contact.client_name || '',
        contact.is_inactive ? 'Yes' : 'No',
        contact.created_at
      ]);

      return [headers, ...rows].map(row => 
        row.map(field => `"${String(field || '').replace(/"/g, '""')}"`).join(',')
      ).join('\n');
    }
  }

  /**
   * Apply contact-specific filters
   */
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
        case 'phone_number':
          query.whereILike('c.phone_number', `%${value}%`);
          break;
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
        case 'search':
          if (this.searchableFields.length > 0) {
            query.where(subQuery => {
              this.searchableFields.forEach((field, index) => {
                if (index === 0) {
                  subQuery.whereILike(`c.${field}`, `%${value}%`);
                } else {
                  subQuery.orWhereILike(`c.${field}`, `%${value}%`);
                }
              });
              // Also search in client name
              subQuery.orWhereILike('comp.client_name', `%${value}%`);
            });
          }
          break;
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
      }
    });

    return query;
  }

  /**
   * Handle tag associations
   */
  private async handleTags(
    contactId: string,
    tags: string[],
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    // Remove existing tags
    await trx('contact_tags')
      .where({ contact_name_id: contactId, tenant: context.tenant })
      .delete();

    // Add new tags
    if (tags.length > 0) {
      const tagInserts = tags.map(tag => ({
        contact_name_id: contactId,
        tag_name: tag,
        tenant: context.tenant,
        created_at: trx.raw('now()')
      }));

      await trx('contact_tags').insert(tagInserts);
    }
  }
}