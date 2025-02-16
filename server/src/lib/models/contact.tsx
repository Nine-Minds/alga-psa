import { createTenantKnex } from '@/lib/db';
import { IContact } from '@/interfaces/contact.interfaces';
import { te } from 'date-fns/locale';

const ContactModel = {
  getAll: async (includeInactive: boolean = false): Promise<IContact[]> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      let query = db<IContact>('contacts').where('tenant', tenant).select('*');
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

  get: async (contact_name_id: string): Promise<IContact | undefined> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const contact = await db<IContact>('contacts')
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

  updateMany: async (companyId: string, updateData: Partial<IContact>): Promise<void> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      await db<IContact>('contacts')
        .where({ company_id: companyId })
        .where('tenant', tenant)
        .update(updateData);
    } catch (error) {
      console.error(`Error updating contacts for company ${companyId}:`, error);
      throw error;
    }
  },
};

export default ContactModel;
