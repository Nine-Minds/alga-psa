import { getCurrentTenantId } from '../db';
import { ITicketCategory } from '../../interfaces/ticket.interfaces';
import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

const TicketCategory = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<ITicketCategory[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('No tenant context available');
      }
      const categories = await tenantDb(knexOrTrx, tenant).table<ITicketCategory>('categories')
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
      if (!tenant) {
        throw new Error('No tenant context available');
      }
      const [category] = await tenantDb(knexOrTrx, tenant).table<ITicketCategory>('categories')
        .where({
          category_id: id
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

  getByBoard: async (knexOrTrx: Knex | Knex.Transaction, boardId: string): Promise<ITicketCategory[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('No tenant context available');
      }

      const db = tenantDb(knexOrTrx, tenant);

      const board = await db.table('boards')
        .where({
          board_id: boardId
        })
        .first();

      if (!board) {
        throw new Error(`Board with id ${boardId} not found in tenant ${tenant}`);
      }

      const categories = await db.table<ITicketCategory>('categories')
        .where({
          board_id: boardId
        });
      return categories;
    } catch (error) {
      console.error('Error getting ticket categories by board:', error);
      throw error;
    }
  },

  insert: async (knexOrTrx: Knex | Knex.Transaction, category: Partial<ITicketCategory>): Promise<ITicketCategory> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('No tenant context available');
      }

      if (!category.category_name) {
        throw new Error('Category name is required');
      }

      if (!category.board_id) {
        throw new Error('Board ID is required');
      }

      const db = tenantDb(knexOrTrx, tenant);

      const board = await db.table('boards')
        .where({
          board_id: category.board_id
        })
        .first();

      if (!board) {
        throw new Error(`Board with id ${category.board_id} not found in tenant ${tenant}`);
      }

      // Check if category with same name exists in the board
      const existingCategory = await db.table('categories')
        .where({
          category_name: category.category_name,
          board_id: category.board_id
        })
        .first();

      if (existingCategory) {
        throw new Error(`A ticket category with name "${category.category_name}" already exists in this board in tenant ${tenant}`);
      }

      // Ensure tenant is set and cannot be overridden
      const categoryData = {
        ...category,
        tenant
      };

      const [insertedCategory] = await db.table<ITicketCategory>('categories')
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
      if (!tenant) {
        throw new Error('No tenant context available');
      }

      const db = tenantDb(knexOrTrx, tenant);

      const existingCategory = await db.table('categories')
        .where({
          category_id: id
        })
        .first();

      if (!existingCategory) {
        throw new Error(`Ticket category with id ${id} not found in tenant ${tenant}`);
      }

      // If board_id is being updated, verify the new board exists in the current tenant
      if (category.board_id && category.board_id !== existingCategory.board_id) {
        const newBoard = await db.table('boards')
          .where({
            board_id: category.board_id
          })
          .first();

        if (!newBoard) {
          throw new Error(`Board with id ${category.board_id} not found in tenant ${tenant}`);
        }
      }

      // If name is being updated, check for duplicates in the same board
      if (category.category_name) {
        const duplicateCategory = await db.table('categories')
          .where({
            category_name: category.category_name,
            board_id: category.board_id || existingCategory.board_id
          })
          .whereNot('category_id', id)
          .first();

        if (duplicateCategory) {
          throw new Error(`A ticket category with name "${category.category_name}" already exists in this board in tenant ${tenant}`);
        }
      }

      // Ensure tenant cannot be changed
      delete category.tenant;

      const [updatedCategory] = await db.table<ITicketCategory>('categories')
        .where({
          category_id: id
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
      if (!tenant) {
        throw new Error('No tenant context available');
      }

      const db = tenantDb(knexOrTrx, tenant);

      const category = await db.table('categories')
        .where({
          category_id: id
        })
        .first();

      if (!category) {
        throw new Error(`Ticket category with id ${id} not found in tenant ${tenant}`);
      }

      // Check if category has subcategories
      const hasSubcategories = await db.table('categories')
        .where({
          parent_category: id
        })
        .first();

      if (hasSubcategories) {
        throw new Error(`Cannot delete ticket category that has subcategories in tenant ${tenant}`);
      }

      // Check if category is in use by tickets using a proper tenant-aware query
      const inUseCount = await tenantDb(knexOrTrx, tenant).table('tickets')
        .where(function() {
          this.where({
            category_id: id
          }).orWhere({
            subcategory_id: id
          });
        })
        .count('ticket_id as count')
        .first();

      if (inUseCount && Number(inUseCount.count) > 0) {
        throw new Error(`Cannot delete ticket category that is in use by tickets in tenant ${tenant}`);
      }

      const deletedCount = await db.table<ITicketCategory>('categories')
        .where({
          category_id: id
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
