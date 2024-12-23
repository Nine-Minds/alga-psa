// server/src/lib/models/interactions.ts

import { IInteraction, IInteractionType } from '../../interfaces/interaction.interfaces';
import { createTenantKnex } from '../db';

class InteractionModel {
  static async getForEntity(entityId: string, entityType: 'contact' | 'company'): Promise<IInteraction[]> {
    const { knex: db } = await createTenantKnex();

    try {
      const query = db('interactions')
        .select(
          'interactions.interaction_id',
          db.raw(`COALESCE(it.type_name, sit.type_name) as type_name`),
          'interactions.interaction_date',
          'interactions.description',
          'interactions.contact_name_id',
          'contacts.full_name as contact_name',
          'interactions.company_id',
          'companies.company_name',
          'interactions.user_id',
          'users.username as user_name',
          'interactions.ticket_id',
          'interactions.duration'
        )
        .leftJoin('interaction_types as it', function() {
          this.on('interactions.type_id', '=', 'it.type_id')
            .andOn('interactions.tenant', '=', 'it.tenant');
        })
        .leftJoin('system_interaction_types as sit', 'interactions.type_id', 'sit.type_id')
        .leftJoin('contacts', 'interactions.contact_name_id', 'contacts.contact_name_id')
        .leftJoin('companies', 'interactions.company_id', 'companies.company_id')
        .leftJoin('users', 'interactions.user_id', 'users.user_id')
        .orderBy('interactions.interaction_date', 'desc');

      if (entityType === 'contact') {
        query.where('interactions.contact_name_id', entityId);
      } else {
        query.where('interactions.company_id', entityId);
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
    companyId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    typeId?: string;
    limit?: number;
  }): Promise<IInteraction[]> {
    const { knex: db } = await createTenantKnex();

    try {
      const query = db('interactions')
        .select(
          'interactions.interaction_id',
          'interactions.type_id',
          db.raw(`COALESCE(it.type_name, sit.type_name) as type_name`),
          'interactions.contact_name_id',
          'contacts.full_name as contact_name',
          'interactions.company_id',
          'companies.company_name',
          'interactions.user_id',
          'users.username as user_name',
          'interactions.ticket_id',
          'interactions.description',
          'interactions.interaction_date',
          'interactions.duration'
        )
        .leftJoin('interaction_types as it', function() {
          this.on('interactions.type_id', '=', 'it.type_id')
            .andOn('interactions.tenant', '=', 'it.tenant');
        })
        .leftJoin('system_interaction_types as sit', 'interactions.type_id', 'sit.type_id')
        .leftJoin('contacts', 'interactions.contact_name_id', 'contacts.contact_name_id')
        .leftJoin('companies', 'interactions.company_id', 'companies.company_id')
        .leftJoin('users', 'interactions.user_id', 'users.user_id');

      if (filters.userId) {
        query.where('interactions.user_id', filters.userId);
      }
      if (filters.contactId) {
        query.where('interactions.contact_name_id', filters.contactId);
      }
      if (filters.companyId) {
        query.where('interactions.company_id', filters.companyId);
      }
      if (filters.dateFrom) {
        query.where('interactions.interaction_date', '>=', filters.dateFrom);
      }
      if (filters.dateTo) {
        query.where('interactions.interaction_date', '<=', filters.dateTo);
      }
      if (filters.typeId) {
        query.where('interactions.type_id', filters.typeId);
      }

      query.orderBy('interactions.interaction_date', 'desc');

      if (filters.limit) {
        query.limit(filters.limit);
      }

      const result = await query;

      return result;
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
    const { knex: db } = await createTenantKnex();

    try {
      const result = await db('interaction_types')
        .select('type_id', 'type_name', 'icon');

      return result;
    } catch (error) {
      console.error('Error fetching interaction types:', error);
      throw error;
    }
  }

  static async updateInteraction(interactionId: string, updateData: Partial<IInteraction>): Promise<IInteraction> {
    const { knex: db } = await createTenantKnex();

    try {
      const [updatedInteraction] = await db('interactions')
        .where({ interaction_id: interactionId })
        .update(updateData)
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
    const { knex: db } = await createTenantKnex();
  
    try {
      const result = await db('interactions')
        .select(
          'interactions.*',
          db.raw(`COALESCE(it.type_name, sit.type_name) as type_name`),
          'contacts.full_name as contact_name',
          'companies.company_name',
          'users.username as user_name'
        )
        .leftJoin('interaction_types as it', function() {
          this.on('interactions.type_id', '=', 'it.type_id')
            .andOn('interactions.tenant', '=', 'it.tenant');
        })
        .leftJoin('system_interaction_types as sit', 'interactions.type_id', 'sit.type_id')
        .leftJoin('contacts', 'interactions.contact_name_id', 'contacts.contact_name_id')
        .leftJoin('companies', 'interactions.company_id', 'companies.company_id')
        .leftJoin('users', 'interactions.user_id', 'users.user_id')
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
