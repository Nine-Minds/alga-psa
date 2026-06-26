import type { IInteraction, IInteractionType } from '@alga-psa/types';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import OnlineMeetingModel from './onlineMeeting';

type DbOrTransaction = Knex | Knex.Transaction;

async function resolveDb(tenantId: string, trx?: DbOrTransaction): Promise<{ db: DbOrTransaction; tenant: string }> {
  if (trx) {
    return { db: trx, tenant: tenantId };
  }

  const { knex: db, tenant } = await createTenantKnex(tenantId);
  return { db, tenant: tenant ?? tenantId };
}

function tenantScopedTable<Row extends object = Record<string, any>>(
  db: DbOrTransaction,
  tenant: string,
  table: string,
) {
  return tenantDb(db, tenant).table<Row>(table);
}

class InteractionModel {
  private static async withOnlineMeeting(
    interaction: IInteraction,
    tenantId: string,
  ): Promise<IInteraction> {
    const onlineMeeting = await OnlineMeetingModel.getByInteractionId(interaction.interaction_id, tenantId);
    return {
      ...interaction,
      online_meeting: onlineMeeting,
    };
  }

  private static async withOnlineMeetings(
    interactions: IInteraction[],
    tenantId: string,
  ): Promise<IInteraction[]> {
    return await Promise.all(
      interactions.map((interaction) => this.withOnlineMeeting(interaction, tenantId)),
    );
  }

  static async getForEntity(entityId: string, entityType: 'contact' | 'client', tenantId: string): Promise<IInteraction[]> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    const scopedTenant = tenant ?? tenantId;
    const facade = tenantDb(db, scopedTenant);

    try {
      const query = facade.table('interactions')
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
        );
      facade.tenantJoin(query, 'interaction_types as it', 'interactions.type_id', 'it.type_id', { type: 'left' });
      facade.tenantJoin(query, 'system_interaction_types as sit', 'interactions.type_id', 'sit.type_id', { type: 'left' });
      facade.tenantJoin(query, 'contacts', 'interactions.contact_name_id', 'contacts.contact_name_id', { type: 'left' });
      facade.tenantJoin(query, 'clients', 'interactions.client_id', 'clients.client_id', { type: 'left' });
      facade.tenantJoin(query, 'users', 'interactions.user_id', 'users.user_id', { type: 'left' });
      facade.tenantJoin(query, 'statuses', 'interactions.status_id', 'statuses.status_id', { type: 'left' });
      query.orderBy('interactions.interaction_date', 'desc');

      if (entityType === 'contact') {
        query.where('interactions.contact_name_id', entityId);
      } else {
        query.where('interactions.client_id', entityId);
      }

      const result = (await query) as any[];

      const interactions = result.map((row): IInteraction => ({
        ...row,
        type_name: row.type_name?.toLowerCase() || null,
      }));

      return await this.withOnlineMeetings(interactions, scopedTenant);
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
  }, tenantId: string): Promise<IInteraction[]> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    const scopedTenant = tenant ?? tenantId;

    try {
      let interactions: any[] = [];
      const query = tenantScopedTable(db, scopedTenant, 'interactions')
        .select('*');

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

      if (interactions.length > 0) {
        const typeIds = [...new Set(interactions.map(i => i.type_id).filter(Boolean))];
        const typeMap = new Map();

        if (typeIds.length > 0) {
          try {
            const customTypes = await tenantScopedTable(db, scopedTenant, 'interaction_types')
              .select('type_id', 'type_name', 'icon')
              .whereIn('type_id', typeIds);
            customTypes.forEach(t => typeMap.set(t.type_id, { type_name: t.type_name, icon: t.icon }));
          } catch (_typeErr) {
            // Continue without custom types
          }

          try {
            const systemTypes = await tenantScopedTable(db, scopedTenant, 'system_interaction_types')
              .select('type_id', 'type_name', 'icon')
              .whereIn('type_id', typeIds);
            systemTypes.forEach(t => typeMap.set(t.type_id, { type_name: t.type_name, icon: t.icon }));
          } catch (_sysTypeErr) {
            // Continue without system types
          }
        }

        const contactIds = [...new Set(interactions.map(i => i.contact_name_id).filter(Boolean))];
        const contactMap = new Map();
        if (contactIds.length > 0) {
          try {
            const contacts = await tenantScopedTable(db, scopedTenant, 'contacts')
              .select('contact_name_id', 'full_name')
              .whereIn('contact_name_id', contactIds);
            contacts.forEach(c => contactMap.set(c.contact_name_id, c.full_name));
          } catch (_contactErr) {
            // Continue without contact names
          }
        }

        const clientIds = [...new Set(interactions.map(i => i.client_id).filter(Boolean))];
        const clientMap = new Map();
        if (clientIds.length > 0) {
          try {
            const clients = await tenantScopedTable(db, scopedTenant, 'clients')
              .select('client_id', 'client_name')
              .whereIn('client_id', clientIds);
            clients.forEach(c => clientMap.set(c.client_id, c.client_name));
          } catch (_clientErr) {
            // Continue without client names
          }
        }

        const userIds = [...new Set(interactions.map(i => i.user_id).filter(Boolean))];
        const userMap = new Map();
        if (userIds.length > 0) {
          try {
            const users = await tenantScopedTable(db, scopedTenant, 'users')
              .select('user_id', 'username')
              .whereIn('user_id', userIds);
            users.forEach(u => userMap.set(u.user_id, u.username));
          } catch (_userErr) {
            // Continue without user names
          }
        }

        const statusIds = [...new Set(interactions.map(i => i.status_id).filter(Boolean))];
        const statusMap = new Map();
        if (statusIds.length > 0) {
          try {
            const statuses = await tenantScopedTable(db, scopedTenant, 'statuses')
              .select('status_id', 'name', 'is_closed')
              .whereIn('status_id', statusIds);
            statuses.forEach(s => statusMap.set(s.status_id, { name: s.name, is_closed: s.is_closed }));
          } catch (_statusErr) {
            // Continue without status names
          }
        }

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
      }

      return interactions;
    } catch (error) {
      console.error('Error fetching recent interactions:', error);
      throw error;
    }
  }

  static async addInteraction(
    interactionData: Omit<IInteraction, 'interaction_id'>,
    tenantId: string,
    trx?: DbOrTransaction,
  ): Promise<IInteraction> {
    const { db, tenant } = await resolveDb(tenantId, trx);

    try {
      const [newInteraction] = await tenantScopedTable(db, tenant, 'interactions')
        .insert({
          ...interactionData,
          tenant
        })
        .returning('*');

      const fullInteraction = await this.getById(newInteraction.interaction_id, tenantId, db);
      if (!fullInteraction) {
        throw new Error('Failed to fetch created interaction');
      }

      return fullInteraction;
    } catch (error) {
      console.error('Error adding interaction:', error);
      throw error;
    }
  }

  static async getInteractionTypes(tenantId: string): Promise<IInteractionType[]> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    const scopedTenant = tenant ?? tenantId;

    try {
      const result = await tenantScopedTable(db, scopedTenant, 'interaction_types')
        .select('type_id', 'type_name', 'icon');

      return result;
    } catch (error) {
      console.error('Error fetching interaction types:', error);
      throw error;
    }
  }

  static async updateInteraction(interactionId: string, updateData: Partial<IInteraction>, tenantId: string): Promise<IInteraction> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    const scopedTenant = tenant ?? tenantId;

    try {
      const { tenant: _ignoreTenant, interaction_id: _ignoreId, ...safeUpdateData } = updateData as any;

      const [updatedInteraction] = await tenantScopedTable(db, scopedTenant, 'interactions')
        .where({
          interaction_id: interactionId,
        })
        .update(safeUpdateData)
        .returning('*');

      const fullInteraction = await this.getById(updatedInteraction.interaction_id, tenantId);
      if (!fullInteraction) {
        throw new Error('Failed to fetch updated interaction');
      }

      return fullInteraction;
    } catch (error) {
      console.error('Error updating interaction:', error);
      throw error;
    }
  }

  static async getById(
    interactionId: string,
    tenantId: string,
    trx?: DbOrTransaction,
  ): Promise<IInteraction | null> {
    const { db, tenant } = await resolveDb(tenantId, trx);
    const facade = tenantDb(db, tenant);

    try {
      const query = facade.table('interactions')
        .select(
          'interactions.*',
          db.raw(`COALESCE(it.type_name, sit.type_name) as type_name`),
          db.raw(`COALESCE(it.icon, sit.icon) as icon`),
          'contacts.full_name as contact_name',
          'clients.client_name',
          'users.username as user_name',
          'statuses.name as status_name',
          'statuses.is_closed as is_status_closed'
        );
      facade.tenantJoin(query, 'interaction_types as it', 'interactions.type_id', 'it.type_id', { type: 'left' });
      facade.tenantJoin(query, 'system_interaction_types as sit', 'interactions.type_id', 'sit.type_id', { type: 'left' });
      facade.tenantJoin(query, 'contacts', 'interactions.contact_name_id', 'contacts.contact_name_id', { type: 'left' });
      facade.tenantJoin(query, 'clients', 'interactions.client_id', 'clients.client_id', { type: 'left' });
      facade.tenantJoin(query, 'users', 'interactions.user_id', 'users.user_id', { type: 'left' });
      facade.tenantJoin(query, 'statuses', 'interactions.status_id', 'statuses.status_id', { type: 'left' });

      const result = (await query
        .where('interactions.interaction_id', interactionId)
        .first()) as any | undefined;

      if (!result) {
        return null;
      }

      return await this.withOnlineMeeting({
        ...result,
        type_name: result.type_name?.toLowerCase() || null,
      }, tenant);
    } catch (error) {
      console.error('Error fetching interaction by ID:', error);
      throw error;
    }
  }
}

export default InteractionModel;
