import { Knex } from 'knex';
import { IBoard } from '@alga-psa/types';

const Board = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, includeAll: boolean = false): Promise<IBoard[]> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }

      let query = knexOrTrx<IBoard>('boards')
        .select('*')
        .where('tenant', tenant);
      if (!includeAll) {
        query = query.andWhere('is_inactive', false);
      }
      const boards = await query;
      return boards;
    } catch (error) {
      console.error('Error getting all boards:', error);
      throw error;
    }
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, id: string): Promise<IBoard | undefined> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required');
      }

      const board = await knexOrTrx<IBoard>('boards')
        .select('*')
        .where('board_id', id)
        .andWhere('tenant', tenant)
        .first();
      return board;
    } catch (error) {
      console.error(`Error getting board with id ${id}:`, error);
      throw error;
    }
  },

  insert: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, board: Omit<IBoard, 'board_id' | 'tenant'>): Promise<IBoard> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required for creating board');
      }

      // Check if this is the first board - if so, make it default
      const existingBoards = await knexOrTrx('boards')
        .where({ tenant, is_default: true });

      const boardToInsert = {
        ...board,
        tenant,
        is_inactive: false,
        is_default: existingBoards.length === 0 // Make default if no other default exists
      };

      const [insertedBoard] = await knexOrTrx('boards').insert(boardToInsert).returning('*');
      return insertedBoard;
    } catch (error) {
      console.error('Error inserting board:', error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, id: string): Promise<void> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required for deleting board');
      }

      // Check if this is a default board
      const board = await knexOrTrx<IBoard>('boards')
        .where({
          board_id: id,
          tenant,
          is_default: true
        })
        .first();

      if (board) {
        throw new Error('Cannot delete the default board');
      }

      await knexOrTrx<IBoard>('boards')
        .where('board_id', id)
        .andWhere('tenant', tenant)
        .del();
    } catch (error) {
      console.error(`Error deleting board with id ${id}:`, error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, tenant: string, id: string, updates: Partial<Omit<IBoard, 'tenant'>>): Promise<IBoard | undefined> => {
    try {
      if (!tenant) {
        throw new Error('Tenant context is required for updating board');
      }

      // If updating is_default to false, check if this is the last default board
      if (updates.is_default === false) {
        const defaultBoards = await knexOrTrx('boards')
          .where({ tenant, is_default: true })
          .whereNot('board_id', id);

        if (defaultBoards.length === 0) {
          throw new Error('Cannot remove default status from the last default board');
        }
      }

      // If setting as default, unset all other defaults first
      if (updates.is_default === true) {
        await knexOrTrx('boards')
          .where({ tenant, is_default: true })
          .update({ is_default: false });
      }

      const [updatedBoard] = await knexOrTrx('boards')
        .where('board_id', id)
        .andWhere('tenant', tenant)
        .update(updates)
        .returning('*');

      return updatedBoard;
    } catch (error) {
      console.error(`Error updating board with id ${id}:`, error);
      throw error;
    }
  },

}

export default Board;