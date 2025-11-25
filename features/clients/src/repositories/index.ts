/**
 * Client repository - data access layer for clients/companies
 *
 * This repository provides database operations for clients.
 * It uses the @alga-psa/database package for connection management.
 */

import type { Knex } from 'knex';
import type {
  Company,
  CreateCompanyInput,
  UpdateCompanyInput,
  CompanyFilters,
  CompanyListResponse,
  CompanyWithLocation,
} from '../types/index.js';

const TABLE_NAME = 'clients';

/**
 * Create the client repository with database connection
 */
export function createClientRepository(knex: Knex) {
  return {
    /**
     * Find a client by ID
     */
    async findById(
      tenantId: string,
      clientId: string
    ): Promise<CompanyWithLocation | null> {
      const result = await knex(TABLE_NAME)
        .leftJoin('users as u', function() {
          this.on(`${TABLE_NAME}.account_manager_id`, '=', 'u.user_id')
              .andOn(`${TABLE_NAME}.tenant`, '=', 'u.tenant');
        })
        .leftJoin('client_locations as cl', function() {
          this.on(`${TABLE_NAME}.client_id`, '=', 'cl.client_id')
              .andOn(`${TABLE_NAME}.tenant`, '=', 'cl.tenant')
              .andOn('cl.is_default', '=', knex.raw('true'));
        })
        .select(
          `${TABLE_NAME}.*`,
          'cl.email as location_email',
          'cl.phone as location_phone',
          'cl.address_line1 as location_address',
          'cl.address_line1',
          'cl.address_line2',
          'cl.city',
          'cl.state_province',
          'cl.postal_code',
          'cl.country_name',
          knex.raw(`CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`)
        )
        .where({ [`${TABLE_NAME}.tenant`]: tenantId, [`${TABLE_NAME}.client_id`]: clientId })
        .first();

      return result || null;
    },

    /**
     * Find clients matching filters
     */
    async findMany(
      tenantId: string,
      filters: CompanyFilters = {}
    ): Promise<CompanyListResponse> {
      const {
        search,
        client_type,
        is_inactive,
        status,
        tags,
        account_manager_id,
        limit = 50,
        offset = 0,
        page = 1,
        pageSize = 10,
        orderBy,
        sortBy,
        orderDirection = 'asc',
        sortDirection,
      } = filters;

      const actualLimit = pageSize || limit;
      const actualOffset = page ? (page - 1) * actualLimit : offset;
      const actualSortDirection = sortDirection || orderDirection;

      let query = knex(TABLE_NAME)
        .leftJoin('users as u', function() {
          this.on(`${TABLE_NAME}.account_manager_id`, '=', 'u.user_id')
              .andOn(`${TABLE_NAME}.tenant`, '=', 'u.tenant');
        })
        .leftJoin('client_locations as cl', function() {
          this.on(`${TABLE_NAME}.client_id`, '=', 'cl.client_id')
              .andOn(`${TABLE_NAME}.tenant`, '=', 'cl.tenant')
              .andOn('cl.is_default', '=', knex.raw('true'));
        })
        .where({ [`${TABLE_NAME}.tenant`]: tenantId });

      // Apply status/inactive filter
      if (status === 'active') {
        query = query.andWhere(`${TABLE_NAME}.is_inactive`, false);
      } else if (status === 'inactive') {
        query = query.andWhere(`${TABLE_NAME}.is_inactive`, true);
      } else if (is_inactive !== undefined) {
        query = query.andWhere(`${TABLE_NAME}.is_inactive`, is_inactive);
      }

      // Apply search filter
      if (search) {
        query = query.where(function() {
          this.where(`${TABLE_NAME}.client_name`, 'ilike', `%${search}%`)
              .orWhere('cl.phone', 'ilike', `%${search}%`)
              .orWhere('cl.address_line1', 'ilike', `%${search}%`)
              .orWhere('cl.address_line2', 'ilike', `%${search}%`)
              .orWhere('cl.city', 'ilike', `%${search}%`);
        });
      }

      // Apply client type filter
      if (client_type && client_type !== 'all') {
        query = query.where(`${TABLE_NAME}.client_type`, client_type);
      }

      // Apply account manager filter
      if (account_manager_id) {
        query = query.where(`${TABLE_NAME}.account_manager_id`, account_manager_id);
      }

      // Apply tag filter
      if (tags && tags.length > 0) {
        query = query.whereIn(`${TABLE_NAME}.client_id`, function() {
          this.select('tm.tagged_id')
            .from('tag_mappings as tm')
            .join('tag_definitions as td', function() {
              this.on('tm.tenant', '=', 'td.tenant')
                  .andOn('tm.tag_id', '=', 'td.tag_id');
            })
            .where('tm.tagged_type', 'client')
            .where('tm.tenant', tenantId)
            .whereIn('td.tag_text', tags);
        });
      }

      // Get total count
      const countResult = await query.clone().count('* as count').first();
      const totalCount = Number(countResult?.count || 0);

      // Apply ordering
      const sortColumn = sortBy || (orderBy as string) || 'client_name';
      const sortColumnMap: Record<string, string> = {
        'client_name': `${TABLE_NAME}.client_name`,
        'client_type': `${TABLE_NAME}.client_type`,
        'phone_no': 'cl.phone',
        'address': 'cl.address_line1',
        'account_manager_full_name': 'account_manager_full_name',
        'url': `${TABLE_NAME}.url`,
        'created_at': `${TABLE_NAME}.created_at`,
      };

      const dbSortColumn = sortColumnMap[sortColumn] || `${TABLE_NAME}.${sortColumn}`;
      const textColumns = ['client_name', 'client_type', 'address', 'account_manager_full_name', 'url'];

      // Apply sorting and pagination
      let selectQuery = query.select(
        `${TABLE_NAME}.*`,
        'cl.phone as location_phone',
        'cl.email as location_email',
        'cl.address_line1',
        'cl.address_line2',
        'cl.city',
        'cl.state_province',
        'cl.postal_code',
        'cl.country_name',
        knex.raw(`CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`)
      );

      if (textColumns.includes(sortColumn)) {
        selectQuery = selectQuery.orderByRaw(`LOWER(${dbSortColumn}) ${actualSortDirection}`);
      } else {
        selectQuery = selectQuery.orderBy(dbSortColumn, actualSortDirection);
      }

      const clients = await selectQuery
        .limit(actualLimit)
        .offset(actualOffset);

      return {
        clients: clients as Company[],
        total: totalCount,
        totalCount,
        limit: actualLimit,
        offset: actualOffset,
        page: page || Math.floor(actualOffset / actualLimit) + 1,
        pageSize: actualLimit,
        totalPages: Math.ceil(totalCount / actualLimit),
      };
    },

    /**
     * Create a new client
     */
    async create(
      tenantId: string,
      input: CreateCompanyInput
    ): Promise<Company> {
      const { tags, ...clientData } = input;

      // Ensure website field is synchronized between properties.website and url
      const dataToInsert: any = {
        ...clientData,
        tenant: tenantId,
        is_inactive: false,
        credit_balance: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };

      // Sync website and url fields
      if (dataToInsert.properties?.website && !dataToInsert.url) {
        dataToInsert.url = dataToInsert.properties.website;
      }
      if (dataToInsert.url && (!dataToInsert.properties || !dataToInsert.properties.website)) {
        if (!dataToInsert.properties) {
          dataToInsert.properties = {};
        }
        dataToInsert.properties.website = dataToInsert.url;
      }

      const [client] = await knex(TABLE_NAME)
        .insert(dataToInsert)
        .returning('*');

      // Associate tags if provided
      if (tags && tags.length > 0) {
        await knex('tag_mappings').insert(
          tags.map((tagId) => ({
            tagged_id: client.client_id,
            tagged_type: 'client',
            tag_id: tagId,
            tenant: tenantId,
          }))
        );
      }

      return client;
    },

    /**
     * Update an existing client
     */
    async update(
      tenantId: string,
      input: UpdateCompanyInput
    ): Promise<Company | null> {
      const { client_id, tags, ...updateData } = input;

      // Build update object
      const updateObject: any = {
        ...updateData,
        updated_at: new Date(),
      };

      // Get current client data to properly merge properties
      const currentClient = await knex(TABLE_NAME)
        .where({ client_id, tenant: tenantId })
        .first();

      if (!currentClient) {
        return null;
      }

      // Handle properties merge
      if (updateData.properties) {
        const currentProperties = currentClient.properties || {};
        updateObject.properties = { ...currentProperties, ...updateData.properties };

        // Sync website field with url if website is being updated
        if ('website' in updateData.properties) {
          updateObject.url = updateData.properties.website || '';
        }
      }

      // Handle url field to sync with properties.website
      if (updateData.url !== undefined) {
        updateObject.url = updateData.url;

        if (!updateObject.properties) {
          updateObject.properties = {
            ...(currentClient.properties || {}),
            website: updateData.url,
          };
        } else {
          updateObject.properties = {
            ...updateObject.properties,
            website: updateData.url,
          };
        }
      }

      const [client] = await knex(TABLE_NAME)
        .where({ tenant: tenantId, client_id })
        .update(updateObject)
        .returning('*');

      if (!client) {
        return null;
      }

      // Update tags if provided
      if (tags !== undefined) {
        // Remove existing tags
        await knex('tag_mappings')
          .where({ tagged_id: client_id, tagged_type: 'client', tenant: tenantId })
          .delete();

        // Add new tags
        if (tags.length > 0) {
          await knex('tag_mappings').insert(
            tags.map((tagId) => ({
              tagged_id: client_id,
              tagged_type: 'client',
              tag_id: tagId,
              tenant: tenantId,
            }))
          );
        }
      }

      return client;
    },

    /**
     * Delete a client (soft delete by setting is_inactive)
     */
    async delete(tenantId: string, clientId: string): Promise<boolean> {
      const result = await knex(TABLE_NAME)
        .where({ tenant: tenantId, client_id: clientId })
        .update({ is_inactive: true, updated_at: new Date() });

      return result > 0;
    },

    /**
     * Hard delete a client (permanent)
     */
    async hardDelete(tenantId: string, clientId: string): Promise<boolean> {
      // Delete tags first
      await knex('tag_mappings')
        .where({ tagged_id: clientId, tagged_type: 'client', tenant: tenantId })
        .delete();

      const result = await knex(TABLE_NAME)
        .where({ tenant: tenantId, client_id: clientId })
        .delete();

      return result > 0;
    },
  };
}

// Default export for convenience when used with dependency injection
export const clientRepository = {
  create: createClientRepository,
};
