// server/src/lib/models/interactions.ts

import { IInteraction, IInteractionType } from '../../interfaces/interaction.interfaces';
import { createTenantKnex } from '../db';

class InteractionModel {
  static async getForEntity(entityId: string, entityType: 'contact' | 'client'): Promise<IInteraction[]> {
    const { knex: db, tenant } = await createTenantKnex();

    try {
      const query = db('interactions')
        .where('interactions.tenant', tenant)
        .select(
          'interactions.interaction_id',
          'interactions.type_id',
          db.raw(`COALESCE(it.type_name, sit.type_name) as type_name`),
          db.raw(`COALESCE(it.icon, sit.icon) as icon`),
          'interactions.interaction_date',
          'interactions.title',
          'interactions.notes',
          'interactions.start_time',
          'interactions.end_time',
          'interactions.contact_name_id',
          'contacts.full_name as contact_name',
          'interactions.client_id',
          'clients.client_name',
          'interactions.user_id',
          'users.username as user_name',
          'interactions.ticket_id',
          'interactions.duration',
          'interactions.status_id',
          'statuses.name as status_name',
          'statuses.is_closed as is_status_closed'
        )
        .leftJoin('interaction_types as it', function() {
          this.on('interactions.type_id', '=', 'it.type_id')
            .andOn('interactions.tenant', '=', 'it.tenant');
        })
        .leftJoin('system_interaction_types as sit', function() {
          this.on('interactions.type_id', '=', 'sit.type_id');
        })
        .leftJoin('contacts', function() {
          this.on('interactions.contact_name_id', '=', 'contacts.contact_name_id')
            .andOn('interactions.tenant', '=', 'contacts.tenant');
        })
        .leftJoin('clients', function() {
          this.on('interactions.client_id', '=', 'clients.client_id')
            .andOn('interactions.tenant', '=', 'clients.tenant');
        })
        .leftJoin('users', function() {
          this.on('interactions.user_id', '=', 'users.user_id')
            .andOn('interactions.tenant', '=', 'users.tenant');
        })
        .leftJoin('statuses', function() {
          this.on('interactions.status_id', '=', 'statuses.status_id')
            .andOn('interactions.tenant', '=', 'statuses.tenant');
        })
        .orderBy('interactions.interaction_date', 'desc');

      if (entityType === 'contact') {
        query.where('interactions.contact_name_id', entityId);
      } else {
        query.where('interactions.client_id', entityId);
      }

      const result = await query;

      return result.map((row): IInteraction => ({
        ...row,
        type_name: row.type_name.toLowerCase(),
      }));
    } catch (error) {
      console.error(`Error fetching interactions for ${entityType}:`, error);
      throw error;
    }
  }

  static async getRecentInteractions(filters: {
    userId?: string;
    contactId?: string;
    clientId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    typeId?: string;
    limit?: number;
  }): Promise<IInteraction[]> {
    const { knex: db, tenant } = await createTenantKnex();

    try {
      console.log('[getRecentInteractions] Fetching interactions with filters:', filters, 'for tenant:', tenant);

      // Start with basic interactions query
      let interactions: any[] = [];
      try {
        const query = db('interactions')
          .select('*')
          .where('tenant', tenant);

        // Apply filters
        if (filters.userId) {
          query.where('user_id', filters.userId);
        }
        if (filters.contactId) {
          query.where('contact_name_id', filters.contactId);
        }
        if (filters.clientId) {
          query.where('client_id', filters.clientId);
        }
        if (filters.dateFrom) {
          query.where('interaction_date', '>=', filters.dateFrom);
        }
        if (filters.dateTo) {
          query.where('interaction_date', '<=', filters.dateTo);
        }
        if (filters.typeId) {
          query.where('type_id', filters.typeId);
        }

        query.orderBy('interaction_date', 'desc');

        if (filters.limit) {
          query.limit(filters.limit);
        }

        interactions = await query;
        console.log('[getRecentInteractions] Found', interactions.length, 'interactions');

        // Try to enrich with related data if available
        if (interactions.length > 0) {
          try {
            // Add type names
            const typeIds = [...new Set(interactions.map(i => i.type_id).filter(Boolean))];
            const typeMap = new Map();

            if (typeIds.length > 0) {
              try {
                const customTypes = await db('interaction_types')
                  .select('type_id', 'type_name', 'icon')
                  .whereIn('type_id', typeIds)
                  .where('tenant', tenant);
                customTypes.forEach(t => typeMap.set(t.type_id, { type_name: t.type_name, icon: t.icon }));
              } catch (typeErr) {
                console.warn('[getRecentInteractions] Failed to fetch interaction types:', typeErr);
              }

              try {
                const systemTypes = await db('system_interaction_types')
                  .select('type_id', 'type_name', 'icon')
                  .whereIn('type_id', typeIds);
                systemTypes.forEach(t => typeMap.set(t.type_id, { type_name: t.type_name, icon: t.icon }));
              } catch (sysTypeErr) {
                console.warn('[getRecentInteractions] Failed to fetch system interaction types:', sysTypeErr);
              }
            }

            // Add contact names
            const contactIds = [...new Set(interactions.map(i => i.contact_name_id).filter(Boolean))];
            const contactMap = new Map();
            if (contactIds.length > 0) {
              try {
                const contacts = await db('contacts')
                  .select('contact_name_id', 'full_name')
                  .whereIn('contact_name_id', contactIds)
                  .where('tenant', tenant);
                contacts.forEach(c => contactMap.set(c.contact_name_id, c.full_name));
              } catch (contactErr) {
                console.warn('[getRecentInteractions] Failed to fetch contact names:', contactErr);
              }
            }

            // Add client names
            const clientIds = [...new Set(interactions.map(i => i.client_id).filter(Boolean))];
            const clientMap = new Map();
            if (clientIds.length > 0) {
              try {
                const clients = await db('clients')
                  .select('client_id', 'client_name')
                  .whereIn('client_id', clientIds)
                  .where('tenant', tenant);
                clients.forEach(c => clientMap.set(c.client_id, c.client_name));
              } catch (clientErr) {
                console.warn('[getRecentInteractions] Failed to fetch client names:', clientErr);
              }
            }

            // Add user names
            const userIds = [...new Set(interactions.map(i => i.user_id).filter(Boolean))];
            const userMap = new Map();
            if (userIds.length > 0) {
              try {
                const users = await db('users')
                  .select('user_id', 'username')
                  .whereIn('user_id', userIds)
                  .where('tenant', tenant);
                users.forEach(u => userMap.set(u.user_id, u.username));
              } catch (userErr) {
                console.warn('[getRecentInteractions] Failed to fetch user names:', userErr);
              }
            }

            // Add status names
            const statusIds = [...new Set(interactions.map(i => i.status_id).filter(Boolean))];
            const statusMap = new Map();
            if (statusIds.length > 0) {
              try {
                const statuses = await db('statuses')
                  .select('status_id', 'name', 'is_closed')
                  .whereIn('status_id', statusIds)
                  .where('tenant', tenant);
                statuses.forEach(s => statusMap.set(s.status_id, { name: s.name, is_closed: s.is_closed }));
              } catch (statusErr) {
                console.warn('[getRecentInteractions] Failed to fetch status names:', statusErr);
              }
            }

            // Enrich interactions with related data
            interactions = interactions.map(interaction => {
              const typeInfo = typeMap.get(interaction.type_id);
              const statusInfo = statusMap.get(interaction.status_id);

              return {
                ...interaction,
                type_name: typeInfo?.type_name?.toLowerCase() || null,
                icon: typeInfo?.icon || null,
                contact_name: contactMap.get(interaction.contact_name_id) || null,
                client_name: clientMap.get(interaction.client_id) || null,
                user_name: userMap.get(interaction.user_id) || null,
                status_name: statusInfo?.name || null,
                is_status_closed: statusInfo?.is_closed || false
              };
            });
          } catch (enrichErr) {
            console.warn('[getRecentInteractions] Failed to enrich interaction data:', enrichErr);
            // Continue with basic interaction data
          }
        }
      } catch (dbErr: any) {
        console.error('[getRecentInteractions] Database error:', dbErr);

        if (dbErr.message && (
          dbErr.message.includes('relation') ||
          dbErr.message.includes('does not exist') ||
          dbErr.message.includes('table')
        )) {
          throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
        }
        throw dbErr;
      }

      return interactions;
    } catch (error) {
      console.error('Error fetching recent interactions:', error);
      throw error;
    }
  }

  static async addInteraction(interactionData: Omit<IInteraction, 'interaction_id'>): Promise<IInteraction> {
    const { knex: db, tenant } = await createTenantKnex();

    try {
      console.log('Adding interaction with data:', interactionData);

      const [newInteraction] = await db('interactions')
        .insert({
          ...interactionData,
          tenant
        })
        .returning('*');

      console.log('New interaction after insert:', newInteraction);

      // Get the full interaction details including type name
      const fullInteraction = await this.getById(newInteraction.interaction_id);
      if (!fullInteraction) {
        throw new Error('Failed to fetch created interaction');
      }

      return fullInteraction;
    } catch (error) {
      console.error('Error adding interaction:', error);
      throw error;
    }
  }

  static async getInteractionTypes(): Promise<IInteractionType[]> {
    const { knex: db, tenant } = await createTenantKnex();

    try {
      const result = await db('interaction_types')
        .select('type_id', 'type_name', 'icon')
        .where({ tenant });

      return result;
    } catch (error) {
      console.error('Error fetching interaction types:', error);
      throw error;
    }
  }

  static async updateInteraction(interactionId: string, updateData: Partial<IInteraction>): Promise<IInteraction> {
    const { knex: db, tenant } = await createTenantKnex();

    try {
      // Never attempt to update the tenant (distribution/partition key).
      // Some backends (e.g., Citus) reject updates that include the partition/distribution column
      // even if the value remains unchanged.
      const { tenant: _ignoreTenant, interaction_id: _ignoreId, ...safeUpdateData } = updateData as any;

      const [updatedInteraction] = await db('interactions')
        .where({ 
          interaction_id: interactionId,
          tenant
        })
        .update(safeUpdateData)
        .returning('*');

      // Get the full interaction details including type name
      const fullInteraction = await this.getById(updatedInteraction.interaction_id);
      if (!fullInteraction) {
        throw new Error('Failed to fetch updated interaction');
      }

      return fullInteraction;
    } catch (error) {
      console.error('Error updating interaction:', error);
      throw error;
    }
  }

  static async getById(interactionId: string): Promise<IInteraction | null> {
    const { knex: db, tenant } = await createTenantKnex();
  
    try {
      const result = await db('interactions')
        .where('interactions.tenant', tenant)
        .select(
          'interactions.*',
          db.raw(`COALESCE(it.type_name, sit.type_name) as type_name`),
          db.raw(`COALESCE(it.icon, sit.icon) as icon`),
          'contacts.full_name as contact_name',
          'clients.client_name',
          'users.username as user_name',
          'statuses.name as status_name',
          'statuses.is_closed as is_status_closed'
        )
        .leftJoin('interaction_types as it', function() {
          this.on('interactions.type_id', '=', 'it.type_id')
            .andOn('interactions.tenant', '=', 'it.tenant');
        })
        .leftJoin('system_interaction_types as sit', function() {
          this.on('interactions.type_id', '=', 'sit.type_id');
        })
        .leftJoin('contacts', function() {
          this.on('interactions.contact_name_id', '=', 'contacts.contact_name_id')
            .andOn('interactions.tenant', '=', 'contacts.tenant');
        })
        .leftJoin('clients', function() {
          this.on('interactions.client_id', '=', 'clients.client_id')
            .andOn('interactions.tenant', '=', 'clients.tenant');
        })
        .leftJoin('users', function() {
          this.on('interactions.user_id', '=', 'users.user_id')
            .andOn('interactions.tenant', '=', 'users.tenant');
        })
        .leftJoin('statuses', function() {
          this.on('interactions.status_id', '=', 'statuses.status_id')
            .andOn('interactions.tenant', '=', 'statuses.tenant');
        })
        .where('interactions.interaction_id', interactionId)
        .first();
  
      if (!result) {
        return null;
      }
  
      return {
        ...result,
        type_name: result.type_name.toLowerCase(),
      };
    } catch (error) {
      console.error('Error fetching interaction by ID:', error);
      throw error;
    }
  }
}

export default InteractionModel;
