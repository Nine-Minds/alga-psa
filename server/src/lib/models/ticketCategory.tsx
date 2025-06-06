import { getCurrentTenantId } from '../db';
import { ITicketCategory } from '../../interfaces/ticket.interfaces';
import { Knex } from 'knex';

const TicketCategory = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<ITicketCategory[]> => {
    try {
      const tenant = await getCurrentTenantId();
      // Add explicit tenant filtering in addition to RLS
      const categories = await knexOrTrx<ITicketCategory>('categories')
        .where({ tenant })
        .select('*');
      return categories;
    } catch (error) {
      console.error('Error getting all ticket categories:', error);
      throw error;
    }
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, id: string): Promise<ITicketCategory> => {
    try {
      const tenant = await getCurrentTenantId();
      // Add explicit tenant filtering in addition to RLS
      const [category] = await knexOrTrx<ITicketCategory>('categories')
        .where({
          category_id: id,
          tenant
        });
      
      if (!category) {
        throw new Error(`Ticket category with id ${id} not found in tenant ${tenant}`);
      }
      
      return category;
    } catch (error) {
      console.error(`Error getting ticket category with id ${id}:`, error);
      throw error;
    }
  },

  getByChannel: async (knexOrTrx: Knex | Knex.Transaction, channelId: string): Promise<ITicketCategory[]> => {
    try {
      const tenant = await getCurrentTenantId();

      // Verify channel exists in the current tenant
      const channel = await knexOrTrx('channels')
        .where({
          channel_id: channelId,
          tenant
        })
        .first();

      if (!channel) {
        throw new Error(`Channel with id ${channelId} not found in tenant ${tenant}`);
      }

      const categories = await knexOrTrx<ITicketCategory>('categories')
        .where({
          channel_id: channelId,
          tenant
        });
      return categories;
    } catch (error) {
      console.error('Error getting ticket categories by channel:', error);
      throw error;
    }
  },

  insert: async (knexOrTrx: Knex | Knex.Transaction, category: Partial<ITicketCategory>): Promise<ITicketCategory> => {
    try {
      const tenant = await getCurrentTenantId();

      if (!category.category_name) {
        throw new Error('Category name is required');
      }

      if (!category.channel_id) {
        throw new Error('Channel ID is required');
      }

      // Verify channel exists in the current tenant
      const channel = await knexOrTrx('channels')
        .where({
          channel_id: category.channel_id,
          tenant
        })
        .first();

      if (!channel) {
        throw new Error(`Channel with id ${category.channel_id} not found in tenant ${tenant}`);
      }

      // Check if category with same name exists in the channel
      const existingCategory = await knexOrTrx('categories')
        .where({
          tenant,
          category_name: category.category_name,
          channel_id: category.channel_id
        })
        .first();

      if (existingCategory) {
        throw new Error(`A ticket category with name "${category.category_name}" already exists in this channel in tenant ${tenant}`);
      }

      // Ensure tenant is set and cannot be overridden
      const categoryData = {
        ...category,
        tenant
      };

      // Insert with explicit tenant
      const [insertedCategory] = await knexOrTrx<ITicketCategory>('categories')
        .insert(categoryData)
        .returning('*');

      if (!insertedCategory) {
        throw new Error(`Failed to create ticket category in tenant ${tenant}`);
      }

      return insertedCategory;
    } catch (error) {
      console.error('Error inserting ticket category:', error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, id: string, category: Partial<ITicketCategory>): Promise<ITicketCategory> => {
    try {
      const tenant = await getCurrentTenantId();

      // Verify category exists in the current tenant
      const existingCategory = await knexOrTrx('categories')
        .where({
          category_id: id,
          tenant
        })
        .first();

      if (!existingCategory) {
        throw new Error(`Ticket category with id ${id} not found in tenant ${tenant}`);
      }

      // If channel_id is being updated, verify the new channel exists in the current tenant
      if (category.channel_id && category.channel_id !== existingCategory.channel_id) {
        const newChannel = await knexOrTrx('channels')
          .where({
            channel_id: category.channel_id,
            tenant
          })
          .first();

        if (!newChannel) {
          throw new Error(`Channel with id ${category.channel_id} not found in tenant ${tenant}`);
        }
      }

      // If name is being updated, check for duplicates in the same channel
      if (category.category_name) {
        const duplicateCategory = await knexOrTrx('categories')
          .where({
            tenant,
            category_name: category.category_name,
            channel_id: category.channel_id || existingCategory.channel_id
          })
          .whereNot('category_id', id)
          .first();

        if (duplicateCategory) {
          throw new Error(`A ticket category with name "${category.category_name}" already exists in this channel in tenant ${tenant}`);
        }
      }

      // Ensure tenant cannot be changed
      delete category.tenant;

      // Update with explicit tenant check
      const [updatedCategory] = await knexOrTrx<ITicketCategory>('categories')
        .where({
          category_id: id,
          tenant
        })
        .update(category)
        .returning('*');

      if (!updatedCategory) {
        throw new Error(`Failed to update ticket category with id ${id} in tenant ${tenant}`);
      }

      return updatedCategory;
    } catch (error) {
      console.error(`Error updating ticket category with id ${id}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, id: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();

      // Verify category exists in the current tenant
      const category = await knexOrTrx('categories')
        .where({
          category_id: id,
          tenant
        })
        .first();

      if (!category) {
        throw new Error(`Ticket category with id ${id} not found in tenant ${tenant}`);
      }

      // Check if category has subcategories
      const hasSubcategories = await knexOrTrx('categories')
        .where({
          tenant,
          parent_category: id
        })
        .first();

      if (hasSubcategories) {
        throw new Error(`Cannot delete ticket category that has subcategories in tenant ${tenant}`);
      }

      // Check if category is in use by tickets using a proper tenant-aware query
      const inUseCount = await knexOrTrx('tickets')
        .where(function() {
          this.where({
            tenant,
            category_id: id
          }).orWhere({
            tenant,
            subcategory_id: id
          });
        })
        .count('ticket_id as count')
        .first();

      if (inUseCount && Number(inUseCount.count) > 0) {
        throw new Error(`Cannot delete ticket category that is in use by tickets in tenant ${tenant}`);
      }

      // Add explicit tenant check in deletion
      const deletedCount = await knexOrTrx<ITicketCategory>('categories')
        .where({
          category_id: id,
          tenant
        })
        .del();

      if (deletedCount === 0) {
        throw new Error(`Failed to delete ticket category with id ${id} in tenant ${tenant}`);
      }
    } catch (error) {
      console.error(`Error deleting ticket category with id ${id}:`, error);
      throw error;
    }
  },
};

export default TicketCategory;
