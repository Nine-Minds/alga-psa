'use server'

import { IBoard } from '../../../interfaces';
import Board from '../../models/board';
import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { ItilStandardsService } from '../../services/itilStandardsService';
import { getCurrentUser } from '../user-actions/userActions';

export interface FindBoardByNameOutput {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  is_active: boolean;
}

export async function findBoardById(id: string): Promise<IBoard | undefined> {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const board = await Board.get(trx, id);
      return board;
    });
  } catch (error) {
    console.error(error);
    throw new Error('Failed to find board');
  }
}

export async function getAllBoards(includeAll: boolean = true): Promise<IBoard[]> {
  const { knex: db, tenant } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const boards = await trx('boards')
        .where({ tenant })
        .where(includeAll ? {} : { is_inactive: false })
        .orderBy('display_order', 'asc')
        .orderBy('board_name', 'asc');
      return boards;
    });
  } catch (error) {
    console.error('Failed to fetch boards:', error);
    return [];
  }
}

export async function createBoard(boardData: Omit<IBoard, 'board_id' | 'tenant'>): Promise<IBoard> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // If no display_order provided, get the next available order
      let displayOrder = boardData.display_order;
      if (displayOrder === undefined || displayOrder === 0) {
        const maxOrder = await trx('boards')
          .where({ tenant })
          .max('display_order as max')
          .first();
        displayOrder = (maxOrder?.max || 0) + 1;
      }

      // Check if we should set as default
      let isDefault = boardData.is_default || false;
      if (isDefault) {
        // Check if there's already a default board
        const existingDefault = await trx('boards')
          .where({ tenant, is_default: true })
          .first();

        if (existingDefault) {
          // Unset the existing default
          await trx('boards')
            .where({ tenant, is_default: true })
            .update({ is_default: false });
        }
      }

      const [newBoard] = await trx('boards')
        .insert({
          board_name: boardData.board_name,
          description: boardData.description || null,
          display_order: displayOrder,
          is_inactive: boardData.is_inactive || false,
          is_default: isDefault,
          category_type: boardData.category_type || 'custom',
          priority_type: boardData.priority_type || 'custom',
          display_itil_impact: boardData.display_itil_impact || false,
          display_itil_urgency: boardData.display_itil_urgency || false,
          default_assigned_to: boardData.default_assigned_to || null,
          tenant
        })
        .returning('*');

      // If ITIL types are configured, copy the standards to tenant tables
      await ItilStandardsService.handleItilConfiguration(
        trx,
        tenant,
        user.user_id,
        newBoard.board_id,
        boardData.category_type,
        boardData.priority_type
      );

      return newBoard;
    });
  } catch (error) {
    console.error('Error creating new board:', error);
    throw new Error('Failed to create new board');
  }
}

export async function deleteBoard(boardId: string): Promise<boolean> {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      await Board.delete(trx, boardId);
      return true;
    });
  } catch (error) {
    console.error('Error deleting board:', error);
    if (error instanceof Error) {
      if (error.message.includes('violates foreign key constraint') && error.message.includes('on table "tickets"')) {
        throw new Error('Cannot delete board: It currently has one or more tickets.');
      }
      throw error;
    }
    throw new Error('Failed to delete board due to an unexpected error.');
  }
}

export async function updateBoard(boardId: string, boardData: Partial<Omit<IBoard, 'tenant'>>): Promise<IBoard> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get the current board to check for ITIL type changes
      const currentBoard = await trx('boards')
        .where({ board_id: boardId, tenant })
        .first();

      if (!currentBoard) {
        throw new Error('Board not found');
      }

      // If setting as default, unset all other defaults first
      if (boardData.is_default === true) {
        await trx('boards')
          .where({ tenant, is_default: true })
          .whereNot('board_id', boardId)
          .update({ is_default: false });
      }

      // Sanitize default_assigned_to: convert empty string to null
      const sanitizedData = { ...boardData };
      if ('default_assigned_to' in sanitizedData) {
        sanitizedData.default_assigned_to = sanitizedData.default_assigned_to || null;
      }

      const [updatedBoard] = await trx('boards')
        .where({ board_id: boardId, tenant })
        .update(sanitizedData)
        .returning('*');

      // Handle ITIL type changes
      const categoryTypeChanged = boardData.category_type && boardData.category_type !== currentBoard.category_type;
      const priorityTypeChanged = boardData.priority_type && boardData.priority_type !== currentBoard.priority_type;

      if (categoryTypeChanged || priorityTypeChanged) {
        // If switching to ITIL, copy the standards
        await ItilStandardsService.handleItilConfiguration(
          trx,
          tenant,
          user.user_id,
          boardId,
          boardData.category_type || currentBoard.category_type,
          boardData.priority_type || currentBoard.priority_type
        );

        // If switching away from ITIL, clean up unused standards
        if ((categoryTypeChanged && currentBoard.category_type === 'itil') ||
            (priorityTypeChanged && currentBoard.priority_type === 'itil')) {
          await ItilStandardsService.cleanupUnusedItilStandards(trx, tenant);
        }
      }

      return updatedBoard;
    });
  } catch (error) {
    console.error('Error updating board:', error);
    // Re-throw the original error to provide specific feedback to the frontend
    if (error instanceof Error) {
      throw error;
    }
    // Fallback for non-Error types (though less likely here)
    throw new Error('Failed to update board due to an unexpected error.');
  }
}

/**
 * Find board by name
 * This action searches for existing boards by name
 */
export async function findBoardByName(name: string): Promise<FindBoardByNameOutput | null> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const board = await trx('boards')
      .select('board_id as id', 'board_name as name', 'description', 'is_default', 'is_active')
      .where('tenant', tenant)
      .whereRaw('LOWER(board_name) = LOWER(?)', [name])
      .first();

    return board || null;
  });
}