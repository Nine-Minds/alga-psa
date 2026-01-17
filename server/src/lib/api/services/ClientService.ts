/**
 * Client Service
 * Business logic for client-related operations
 *
 * This service replaces ClientService as part of the client → client migration.
 * It implements dual-write logic to both clients and clients tables during the transition period.
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListResult } from './BaseService';
import { IClient, IClientLocation } from 'server/src/interfaces/client.interfaces';
import { withTransaction } from '@alga-psa/db';
import { getClientLogoUrl } from 'server/src/lib/utils/avatarUtils';
import { createDefaultTaxSettings } from 'server/src/lib/actions/taxSettingsActions';
import { NotFoundError } from '../../api/middleware/apiMiddleware';
import {
  CreateClientData,
  UpdateClientData,
  ClientFilterData,
  CreateClientLocationData,
  UpdateClientLocationData
} from '../schemas/client';
import { ListOptions } from '../controllers/types';
import { runWithTenant } from 'server/src/lib/db';
import { featureFlags } from 'server/src/lib/feature-flags/featureFlags';

export class ClientService extends BaseService<IClient> {
  constructor() {
    super({
      tableName: 'clients',
      primaryKey: 'client_id',
      tenantColumn: 'tenant',
      searchableFields: ['client_name', 'email', 'phone_no', 'address'],
      defaultSort: 'client_name',
      defaultOrder: 'asc'
    });
  }

  /**
   * Check if dual-write is enabled for the migration
   */
  private async isDualWriteEnabled(context: ServiceContext): Promise<boolean> {
    return await featureFlags.isEnabled('enable_client_client_dual_write', {
      tenantId: context.tenant,
      userId: context.userId
    });
  }

  /**
   * Map client data to client data for dual-write
   */
  private mapClientToClientData(inputData: any): any {
    const clientData = { ...inputData };

    // Map field names
    if (clientData.client_id) clientData.client_id = clientData.client_id;
    if (clientData.client_name) clientData.client_name = clientData.client_name;

    // Remove client-specific fields
    delete clientData.client_id;
    delete clientData.client_name;

    return clientData;
  }

  /**
   * Map client location data to client location data
   */
  private mapClientLocationToClientLocation(locationData: any): any {
    const clientLocationData = { ...locationData };

    // Map field names
    if (locationData.client_id) clientLocationData.client_id = locationData.client_id;

    // Remove client-specific fields
    delete clientLocationData.client_id;

    return clientLocationData;
  }

  /**
   * List clients with enhanced filtering and search
   */
  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<IClient>> {
    const { knex } = await this.getKnex();

    const {
      page = 1,
      limit = 25,
      filters = {} as ClientFilterData,
      sort,
      order
    } = options;

    return withTransaction(knex, async (trx) => {
      // Build base query with account manager and location joins
      let dataQuery = trx('clients as c')
        .leftJoin('users as u', function() {
          this.on('c.account_manager_id', '=', 'u.user_id')
              .andOn('c.tenant', '=', 'u.tenant');
        })
        .leftJoin('client_locations as cl', function() {
          this.on('c.client_id', '=', 'cl.client_id')
              .andOn('c.tenant', '=', 'cl.tenant')
              .andOn('cl.is_default', '=', trx.raw('true'));
        })
        .where('c.tenant', context.tenant);

      let countQuery = trx('clients as c')
        .leftJoin('client_locations as cl', function() {
          this.on('c.client_id', '=', 'cl.client_id')
              .andOn('c.tenant', '=', 'cl.tenant')
              .andOn('cl.is_default', '=', trx.raw('true'));
        })
        .where('c.tenant', context.tenant);

      // Apply filters
      dataQuery = this.applyClientFilters(dataQuery, filters);
      countQuery = this.applyClientFilters(countQuery, filters);

      // Apply sorting
      const sortField = sort || this.defaultSort;
      const sortOrder = order || this.defaultOrder;
      dataQuery = dataQuery.orderBy(`c.${sortField}`, sortOrder);

      // Apply pagination
      const offset = (page - 1) * limit;
      dataQuery = dataQuery.limit(limit).offset(offset);

      // Select fields
      dataQuery = dataQuery.select(
        'c.*',
        trx.raw(`CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`)
      );

      // Execute queries
      const [clients, [{ count }]] = await Promise.all([
        dataQuery,
        countQuery.count('* as count')
      ]);

      // Add logo URLs
      const clientsWithLogos = await Promise.all(
        clients.map(async (client: IClient) => {
          const logoUrl = await getClientLogoUrl(client.client_id, context.tenant);
          return { ...client, logoUrl };
        })
      );

      return {
        data: clientsWithLogos,
        total: parseInt(count as string)
      };
    });
  }

  /**
   * Get client by ID with account manager and logo
   */
  async getById(id: string, context: ServiceContext): Promise<IClient | null> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const client = await trx('clients as c')
        .leftJoin('users as u', function() {
          this.on('c.account_manager_id', '=', 'u.user_id')
              .andOn('c.tenant', '=', 'u.tenant');
        })
        .select(
          'c.*',
          trx.raw(`CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`)
        )
        .where({ 'c.client_id': id, 'c.tenant': context.tenant })
        .first();

      if (!client) {
        return null;
      }

      // Get logo URL
      const logoUrl = await getClientLogoUrl(id, context.tenant);

      return {
        ...client,
        logoUrl
      } as IClient;
    });
  }

  /**
   * Create new client with default settings
   * Implements dual-write to clients table during migration period
   */
  async create(data: Partial<IClient>, context: ServiceContext): Promise<IClient> {
    const { knex } = await this.getKnex();
    const enableDualWrite = await this.isDualWriteEnabled(context);

    const client = await withTransaction(knex, async (trx) => {
      // Prepare client data
      const clientData = {
        client_id: knex.raw('gen_random_uuid()'),
        client_name: data.client_name,
        url: data.url || '',
        client_type: data.client_type,
        tax_id_number: data.tax_id_number,
        notes: data.notes,
        properties: data.properties,
        payment_terms: data.payment_terms,
        billing_cycle: data.billing_cycle,
        credit_balance: 0,
        credit_limit: data.credit_limit,
        preferred_payment_method: data.preferred_payment_method,
        auto_invoice: data.auto_invoice || false,
        invoice_delivery_method: data.invoice_delivery_method,
        region_code: data.region_code,
        is_tax_exempt: data.is_tax_exempt || false,
        tax_exemption_certificate: data.tax_exemption_certificate,
        timezone: data.timezone,
        invoice_template_id: data.invoice_template_id,
        billing_contact_id: data.billing_contact_id,
        billing_email: data.billing_email,
        account_manager_id: data.account_manager_id,
        is_inactive: data.is_inactive || false,
        tenant: context.tenant,
        created_at: knex.raw('now()'),
        updated_at: knex.raw('now()')
      };

      // Insert into clients table
      const [client] = await trx('clients').insert(clientData).returning('*');

      // Dual-write to clients table if enabled
      if (enableDualWrite) {
        try {
          const clientData = this.mapClientToClientData(client);
          await trx('clients').insert(clientData);
          console.log(`[ClientService] Dual-write: Created client record for client ${client.client_id}`);
        } catch (dualWriteError) {
          console.warn(`[ClientService] Dual-write failed for client ${client.client_id}:`, dualWriteError);
          // Don't fail the whole transaction - dual-write is for safety only
        }
      }

      // Handle tags if provided
      if ((data as any).tags && (data as any).tags.length > 0) {
        try {
          await this.handleTags(client.client_id, (data as any).tags, context, trx);
        } catch (tagError) {
          console.warn('Failed to handle tags:', tagError);
          // Continue without tags - they can be added later
        }
      }

      return client;
    });

    // Try to create default tax settings for the client with tenant context (after transaction)
    try {
      await runWithTenant(context.tenant, async () => {
        await createDefaultTaxSettings(client.client_id);
      });
    } catch (taxError) {
      console.warn('Failed to create default tax settings:', taxError);
      // Continue without tax settings - they can be added later
    }

    return client;
  }

  /**
   * Create client with typed data
   */
  async createClient(data: CreateClientData, context: ServiceContext): Promise<IClient> {
    return this.create(data as Partial<IClient>, context);
  }

  /**
   * Update client
   * Implements dual-write to clients table during migration period
   */
  async update(id: string, data: UpdateClientData, context: ServiceContext): Promise<IClient> {
    const { knex } = await this.getKnex();
    const enableDualWrite = await this.isDualWriteEnabled(context);

    return withTransaction(knex, async (trx) => {
      // Prepare update data
      const updateData: any = {
        ...data,
        updated_at: knex.raw('now()')
      };

      // Remove undefined values
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });

      // Update client
      const [client] = await trx('clients')
        .where('client_id', id)
        .where('tenant', context.tenant)
        .update(updateData)
        .returning('*');

      if (!client) {
        throw new NotFoundError('Client not found');
      }

      // Dual-write to clients table if enabled
      if (enableDualWrite) {
        try {
          const clientUpdateData = this.mapClientToClientData(updateData);
          const updated = await trx('clients')
            .where('client_id', id)
            .where('tenant', context.tenant)
            .update(clientUpdateData);

          if (updated > 0) {
            console.log(`[ClientService] Dual-write: Updated client record for client ${id}`);
          } else {
            console.warn(`[ClientService] Dual-write: No client record found for client ${id}`);
          }
        } catch (dualWriteError) {
          console.warn(`[ClientService] Dual-write update failed for client ${id}:`, dualWriteError);
          // Don't fail the whole transaction
        }
      }

      // If the client is being set to inactive, update all associated contacts and users
      if (data.is_inactive === true) {
        // Get all contact IDs for this client
        const contacts = await trx('contacts')
          .select('contact_name_id')
          .where({ client_id: id, tenant: context.tenant });

        const contactIds = contacts.map(c => c.contact_name_id);

        // Deactivate all contacts
        await trx('contacts')
          .where({ client_id: id, tenant: context.tenant })
          .update({ is_inactive: true });

        // Deactivate all users associated with these contacts
        if (contactIds.length > 0) {
          await trx('users')
            .whereIn('contact_id', contactIds)
            .andWhere({ tenant: context.tenant, user_type: 'client' })
            .update({ is_inactive: true });
        }
      }

      // Handle tags if provided
      if (data.tags !== undefined) {
        try {
          await this.handleTags(id, data.tags, context, trx);
        } catch (tagError) {
          console.warn('Failed to handle tags:', tagError);
          // Continue without tags - they can be added later
        }
      }

      return client;
    });
  }

  /**
   * Get client locations
   */
  async getClientLocations(clientId: string, context: ServiceContext): Promise<IClientLocation[]> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const locations = await trx('client_locations')
        .where({
          client_id: clientId,
          tenant: context.tenant
        })
        .orderBy('is_default', 'desc')
        .orderBy('location_name', 'asc');

      return locations;
    });
  }

  /**
   * Create client location
   * Implements dual-write to client_locations table during migration period
   */
  async createLocation(
    clientId: string,
    data: CreateClientLocationData,
    context: ServiceContext
  ): Promise<IClientLocation> {
    const { knex } = await this.getKnex();
    const enableDualWrite = await this.isDualWriteEnabled(context);

    return withTransaction(knex, async (trx) => {
      // Verify client exists
      const client = await trx('clients')
        .where({ client_id: clientId, tenant: context.tenant })
        .first();

      if (!client) {
        throw new NotFoundError('Client not found');
      }

      const locationData = {
        location_id: knex.raw('gen_random_uuid()'),
        client_id: clientId,
        ...data,
        tenant: context.tenant,
        created_at: knex.raw('now()'),
        updated_at: knex.raw('now()')
      };

      const [location] = await trx('client_locations')
        .insert(locationData)
        .returning('*');

      // Dual-write to client_locations table if enabled
      if (enableDualWrite) {
        try {
          const clientLocationData = this.mapClientLocationToClientLocation(location);
          await trx('client_locations').insert(clientLocationData);
          console.log(`[ClientService] Dual-write: Created client_location record for client location ${location.location_id}`);
        } catch (dualWriteError) {
          console.warn(`[ClientService] Dual-write location create failed:`, dualWriteError);
          // Don't fail the whole transaction
        }
      }

      return location as IClientLocation;
    });
  }

  /**
   * Update client location
   * Implements dual-write to client_locations table during migration period
   */
  async updateLocation(
    clientId: string,
    locationId: string,
    data: UpdateClientLocationData,
    context: ServiceContext
  ): Promise<IClientLocation> {
    const { knex } = await this.getKnex();
    const enableDualWrite = await this.isDualWriteEnabled(context);

    return withTransaction(knex, async (trx) => {
      const updateData: any = {
        ...data,
        updated_at: knex.raw('now()')
      };

      // Remove undefined values
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });

      const [location] = await trx('client_locations')
        .where('location_id', locationId)
        .where('client_id', clientId)
        .where('tenant', context.tenant)
        .update(updateData)
        .returning('*');

      if (!location) {
        throw new NotFoundError('Client location not found');
      }

      // Dual-write to client_locations table if enabled
      if (enableDualWrite) {
        try {
          const clientLocationUpdateData = this.mapClientLocationToClientLocation(updateData);
          const updated = await trx('client_locations')
            .where('location_id', locationId)
            .where('client_id', clientId)
            .where('tenant', context.tenant)
            .update(clientLocationUpdateData);

          if (updated > 0) {
            console.log(`[ClientService] Dual-write: Updated client_location record for location ${locationId}`);
          }
        } catch (dualWriteError) {
          console.warn(`[ClientService] Dual-write location update failed:`, dualWriteError);
          // Don't fail the whole transaction
        }
      }

      return location as IClientLocation;
    });
  }

  /**
   * Delete client location
   * Implements dual-write to client_locations table during migration period
   */
  async deleteLocation(
    clientId: string,
    locationId: string,
    context: ServiceContext
  ): Promise<void> {
    const { knex } = await this.getKnex();
    const enableDualWrite = await this.isDualWriteEnabled(context);

    return withTransaction(knex, async (trx) => {
      const result = await trx('client_locations')
        .where({
          location_id: locationId,
          client_id: clientId,
          tenant: context.tenant
        })
        .delete();

      if (result === 0) {
        throw new NotFoundError('Location not found');
      }

      // Dual-write to client_locations table if enabled
      if (enableDualWrite) {
        try {
          await trx('client_locations')
            .where({
              location_id: locationId,
              client_id: clientId,
              tenant: context.tenant
            })
            .delete();
          console.log(`[ClientService] Dual-write: Deleted client_location record for location ${locationId}`);
        } catch (dualWriteError) {
          console.warn(`[ClientService] Dual-write location delete failed:`, dualWriteError);
          // Don't fail the whole transaction
        }
      }
    });
  }

  /**
   * Get client statistics
   */
  async getClientStats(context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const [
        totalStats,
        billingCycleStats,
        clientTypeStats,
        creditStats
      ] = await Promise.all([
        // Total and active/inactive counts
        trx('clients')
          .where('tenant', context.tenant)
          .select(
            trx.raw('COUNT(*) as total_clients'),
            trx.raw('COUNT(CASE WHEN is_inactive = false THEN 1 END) as active_clients'),
            trx.raw('COUNT(CASE WHEN is_inactive = true THEN 1 END) as inactive_clients')
          )
          .first(),

        // Clients by billing cycle
        trx('clients')
          .where('tenant', context.tenant)
          .groupBy('billing_cycle')
          .select('billing_cycle', trx.raw('COUNT(*) as count')),

        // Clients by client type
        trx('clients')
          .where('tenant', context.tenant)
          .whereNotNull('client_type')
          .groupBy('client_type')
          .select('client_type', trx.raw('COUNT(*) as count')),

        // Credit balance statistics
        trx('clients')
          .where('tenant', context.tenant)
          .select(
            trx.raw('SUM(credit_balance) as total_credit_balance'),
            trx.raw('AVG(credit_balance) as average_credit_balance')
          )
          .first()
      ]);

      return {
        total_clients: parseInt(totalStats.total_clients),
        active_clients: parseInt(totalStats.active_clients),
        inactive_clients: parseInt(totalStats.inactive_clients),
        clients_by_billing_cycle: billingCycleStats.reduce((acc: any, row: any) => {
          acc[row.billing_cycle] = parseInt(row.count);
          return acc;
        }, {}),
        clients_by_client_type: clientTypeStats.reduce((acc: any, row: any) => {
          acc[row.client_type] = parseInt(row.count);
          return acc;
        }, {}),
        total_credit_balance: parseFloat(creditStats.total_credit_balance || '0'),
        average_credit_balance: parseFloat(creditStats.average_credit_balance || '0')
      };
    });
  }

  /**
   * Apply client-specific filters
   */
  private applyClientFilters(query: Knex.QueryBuilder, filters: ClientFilterData): Knex.QueryBuilder {
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;

      switch (key) {
        case 'client_name':
          query.whereILike('c.client_name', `%${value}%`);
          break;
        case 'email':
          query.whereILike('cl.email', `%${value}%`);
          break;
        case 'client_type':
          query.where('c.client_type', value);
          break;
        case 'billing_cycle':
          query.where('c.billing_cycle', value);
          break;
        case 'is_inactive':
          query.where('c.is_inactive', value);
          break;
        case 'is_tax_exempt':
          query.where('c.is_tax_exempt', value);
          break;
        case 'account_manager_id':
          query.where('c.account_manager_id', value);
          break;
        case 'region_code':
          query.where('c.region_code', value);
          break;
        case 'credit_balance_min':
          query.where('c.credit_balance', '>=', value);
          break;
        case 'credit_balance_max':
          query.where('c.credit_balance', '<=', value);
          break;
        case 'has_credit_limit':
          if (value) {
            query.whereNotNull('c.credit_limit');
          } else {
            query.whereNull('c.credit_limit');
          }
          break;
        case 'industry':
          query.whereRaw("c.properties->>'industry' = ?", [value]);
          break;
        case 'company_size':
          query.whereRaw("c.properties->>'company_size' = ?", [value]);
          break;
        case 'search':
          if (this.searchableFields.length > 0) {
            query.where(subQuery => {
              this.searchableFields.forEach((field, index) => {
                if (field === 'email') {
                  if (index === 0) {
                    subQuery.whereILike('cl.email', `%${value}%`);
                  } else {
                    subQuery.orWhereILike('cl.email', `%${value}%`);
                  }
                } else if (field === 'phone_no') {
                  if (index === 0) {
                    subQuery.whereILike('cl.phone', `%${value}%`);
                  } else {
                    subQuery.orWhereILike('cl.phone', `%${value}%`);
                  }
                } else if (field === 'address') {
                  if (index === 0) {
                    subQuery.where(addressSubQuery => {
                      addressSubQuery.whereILike('cl.address_line1', `%${value}%`)
                        .orWhereILike('cl.address_line2', `%${value}%`)
                        .orWhereILike('cl.city', `%${value}%`)
                        .orWhereILike('cl.state_province', `%${value}%`)
                        .orWhereILike('cl.postal_code', `%${value}%`);
                    });
                  } else {
                    subQuery.orWhere(addressSubQuery => {
                      addressSubQuery.whereILike('cl.address_line1', `%${value}%`)
                        .orWhereILike('cl.address_line2', `%${value}%`)
                        .orWhereILike('cl.city', `%${value}%`)
                        .orWhereILike('cl.state_province', `%${value}%`)
                        .orWhereILike('cl.postal_code', `%${value}%`);
                    });
                  }
                } else {
                  if (index === 0) {
                    subQuery.whereILike(`c.${field}`, `%${value}%`);
                  } else {
                    subQuery.orWhereILike(`c.${field}`, `%${value}%`);
                  }
                }
              });
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
    clientId: string,
    tags: string[],
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    // Remove existing tag mappings for this client
    const existingMappings = await trx('tag_mappings')
      .where({
        tagged_id: clientId,
        tagged_type: 'client',
        tenant: context.tenant
      })
      .select('tag_id');

    if (existingMappings.length > 0) {
      await trx('tag_mappings')
        .where({
          tagged_id: clientId,
          tagged_type: 'client',
          tenant: context.tenant
        })
        .delete();
    }

    // Add new tags
    if (tags.length > 0) {
      for (const tagText of tags) {
        // First, ensure the tag definition exists
        let tagDef = await trx('tag_definitions')
          .where({
            tenant: context.tenant,
            tag_text: tagText,
            tagged_type: 'client'
          })
          .first();

        if (!tagDef) {
          // Create the tag definition
          const [newTagDef] = await trx('tag_definitions')
            .insert({
              tenant: context.tenant,
              tag_text: tagText,
              tagged_type: 'client',
              created_at: trx.raw('now()')
            })
            .returning('*');
          tagDef = newTagDef;
        }

        // Create the mapping
        await trx('tag_mappings')
          .insert({
            tenant: context.tenant,
            tag_id: tagDef.tag_id,
            tagged_id: clientId,
            tagged_type: 'client',
            created_by: context.userId,
            created_at: trx.raw('now()')
          });
      }
    }
  }
}
