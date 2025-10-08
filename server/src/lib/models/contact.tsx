import { Knex } from 'knex';
import { getCurrentTenantId } from 'server/src/lib/db';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { te } from 'date-fns/locale';

const ContactModel = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction, includeInactive: boolean = false): Promise<IContact[]> => {
    try {
      const tenant = await getCurrentTenantId();
      let query = knexOrTrx<IContact>('contacts').where('tenant', tenant).select('*');
      if (!includeInactive) {
        query = query.where({ is_inactive: false });
      }
      const contacts = await query;
      return contacts;
    } catch (error) {
      console.error('Error getting all contacts:', error);
      throw error;
    }
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, contact_name_id: string): Promise<IContact | undefined> => {
    try {
      const tenant = await getCurrentTenantId();
      const contact = await knexOrTrx<IContact>('contacts')
        .select('*')
        .where('contact_name_id', contact_name_id)
        .where('tenant', tenant)
        .first();
      return contact;
    } catch (error) {
      console.error(`Error getting contact with id ${contact_name_id}:`, error);
      throw error;
    }
  },

  updateMany: async (knexOrTrx: Knex | Knex.Transaction, clientId: string, updateData: Partial<IContact>): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      await knexOrTrx<IContact>('contacts')
        .where({ client_id: clientId })
        .where('tenant', tenant)
        .update(updateData);
    } catch (error) {
      console.error(`Error updating contacts for client ${clientId}:`, error);
      throw error;
    }
  },
};

export default ContactModel;
