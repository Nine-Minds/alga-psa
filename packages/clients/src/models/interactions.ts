import type { IInteraction } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';

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
}

export default InteractionModel;

