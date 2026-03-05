import type { IInteraction } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';

class InteractionModel {
  static async getById(interactionId: string, tenantId: string): Promise<IInteraction | null> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);

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
        type_name: result.type_name?.toLowerCase() || null,
      };
    } catch (error) {
      console.error('Error fetching interaction by ID:', error);
      throw error;
    }
  }
}

export default InteractionModel;
