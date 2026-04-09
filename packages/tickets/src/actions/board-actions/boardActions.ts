'use server'

import { IBoard } from '@alga-psa/types';
import Board from '../../models/board';
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { ItilStandardsService } from '../../services/itilStandardsService';
import { withAuth } from '@alga-psa/auth';
import { deleteEntityWithValidation } from '@alga-psa/core';
import { v4 as uuidv4 } from 'uuid';
import { BoardTicketStatusInput, saveBoardTicketStatusesForBoard } from './boardTicketStatusActions';

export interface FindBoardByNameOutput {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  is_inactive: boolean;
}

export interface CreateBoardInput extends Omit<IBoard, 'board_id' | 'tenant'> {
  copy_ticket_statuses_from_board_id?: string | null;
  ticket_statuses?: BoardTicketStatusInput[];
}

export interface UpdateBoardInput extends Partial<Omit<IBoard, 'tenant'>> {
  ticket_statuses?: BoardTicketStatusInput[];
}

function normalizeBoardLiveTimerSetting<T extends Record<string, any>>(board: T): T {
  if (!board || board.enable_live_ticket_timer !== null && board.enable_live_ticket_timer !== undefined) {
    return board;
  }

  return {
    ...board,
    enable_live_ticket_timer: true,
  };
}

function stripStatusIdsForNewBoard(
  statuses: BoardTicketStatusInput[]
): BoardTicketStatusInput[] {
  return statuses.map(({ status_id: _ignoredStatusId, ...status }) => status);
}

export async function copyBoardTicketStatuses(
  trx: Knex.Transaction,
  tenant: string,
  sourceBoardId: string,
  targetBoardId: string,
  userId: string
): Promise<number> {
  const statusColumns = await trx('statuses').columnInfo();
  const hasStatusColumn = (columnName: string) => Object.prototype.hasOwnProperty.call(statusColumns, columnName);
  const sourceStatuses = await trx('statuses')
    .where({
      tenant,
      board_id: sourceBoardId,
      status_type: 'ticket'
    })
    .orderBy('order_number', 'asc')
    .orderBy('name', 'asc');

  if (sourceStatuses.length === 0) {
    throw new Error('Select a source board that has ticket statuses to copy');
  }

  const now = new Date().toISOString();
  const clonedStatuses = sourceStatuses.map((status) => ({
    status_id: uuidv4(),
    tenant,
    board_id: targetBoardId,
    name: status.name,
    status_type: status.status_type,
    ...(hasStatusColumn('item_type') ? { item_type: status.item_type || 'ticket' } : {}),
    is_closed: status.is_closed,
    is_default: status.is_default,
    order_number: status.order_number,
    created_by: userId,
    ...(hasStatusColumn('standard_status_id') ? { standard_status_id: status.standard_status_id || null } : {}),
    ...(hasStatusColumn('is_custom') ? { is_custom: status.is_custom } : {}),
    ...(hasStatusColumn('color') ? { color: status.color || null } : {}),
    ...(hasStatusColumn('icon') ? { icon: status.icon || null } : {}),
    ...(hasStatusColumn('created_at') ? { created_at: status.created_at || now } : {}),
    ...(hasStatusColumn('updated_at') ? { updated_at: now } : {}),
  }));

  await trx('statuses').insert(clonedStatuses);
  return clonedStatuses.length;
}

export const findBoardById = withAuth(async (_user, { tenant }, id: string): Promise<IBoard | undefined> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const board = await Board.get(trx, tenant, id);
      return board ? normalizeBoardLiveTimerSetting(board) : board;
    });
  } catch (error) {
    console.error(error);
    throw new Error('Failed to find board');
  }
});

export const getAllBoards = withAuth(async (_user, { tenant }, includeAll: boolean = true): Promise<IBoard[]> => {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const boards = await trx('boards')
        .where({ tenant })
        .where(includeAll ? {} : { is_inactive: false })
        .orderBy('display_order', 'asc')
        .orderBy('board_name', 'asc');
      return boards.map(normalizeBoardLiveTimerSetting);
    });
  } catch (error) {
    console.error('Failed to fetch boards:', error);
    return [];
  }
});

export const createBoard = withAuth(async (user, { tenant }, boardData: CreateBoardInput): Promise<IBoard> => {
  const { knex: db } = await createTenantKnex();

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

      // If no explicit default_priority_id provided, choose one based on priority_type.
      // This keeps "Quick Add" stable even when priority ordering changes.
      const desiredPriorityType = boardData.priority_type || 'custom';
      let defaultPriorityId = (boardData.default_priority_id || null) as string | null;
      if (!defaultPriorityId) {
        const row = await trx('priorities')
          .select('priority_id')
          .where({ tenant, item_type: 'ticket' })
          .where(function() {
            if (desiredPriorityType === 'itil') {
              this.where('is_from_itil_standard', true);
            } else {
              this.where(function() {
                this.whereNull('is_from_itil_standard').orWhere('is_from_itil_standard', false);
              });
            }
          })
          .orderByRaw(
            desiredPriorityType === 'itil'
              ? "CASE WHEN itil_priority_level = 3 THEN 0 ELSE 1 END, order_number ASC, priority_name ASC"
              : "order_number ASC, priority_name ASC"
          )
          .first();
        defaultPriorityId = row?.priority_id || null;
      }
      if (!defaultPriorityId) {
        const row = await trx('priorities')
          .select('priority_id')
          .where({ tenant, item_type: 'ticket' })
          .orderBy('order_number', 'asc')
          .orderBy('priority_name', 'asc')
          .first();
        defaultPriorityId = row?.priority_id || null;
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
          default_priority_id: defaultPriorityId,
          manager_user_id: boardData.manager_user_id || null,
          sla_policy_id: boardData.sla_policy_id || null,
          inbound_reply_reopen_enabled: boardData.inbound_reply_reopen_enabled ?? false,
          inbound_reply_reopen_cutoff_hours: boardData.inbound_reply_reopen_cutoff_hours ?? 168,
          inbound_reply_reopen_status_id: boardData.inbound_reply_reopen_status_id || null,
          inbound_reply_ai_ack_suppression_enabled: boardData.inbound_reply_ai_ack_suppression_enabled ?? false,
          enable_live_ticket_timer: boardData.enable_live_ticket_timer ?? true,
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

      if (boardData.ticket_statuses && boardData.ticket_statuses.length > 0) {
        await saveBoardTicketStatusesForBoard(
          trx,
          tenant,
          newBoard.board_id,
          user.user_id,
          stripStatusIdsForNewBoard(boardData.ticket_statuses)
        );
      } else if (boardData.copy_ticket_statuses_from_board_id) {
        await copyBoardTicketStatuses(
          trx,
          tenant,
          boardData.copy_ticket_statuses_from_board_id,
          newBoard.board_id,
          user.user_id
        );
      }

      return normalizeBoardLiveTimerSetting(newBoard);
    });
  } catch (error) {
    console.error('Error creating new board:', error);
    throw new Error('Failed to create new board');
  }
});

/**
 * Remove all ticket statuses owned by a board, plus their child rows in
 * other tables that hold FK references back to `statuses`.
 *
 * This bypasses the normal "at least one default status per board"
 * enforcement because the entire board is going away.  The caller MUST
 * have already verified that zero tickets reference these statuses.
 */
async function cleanupBoardStatuses(
  trx: Knex | Knex.Transaction,
  tenant: string,
  boardId: string
): Promise<void> {
  const statusIds = await trx('statuses')
    .where({ tenant, board_id: boardId, status_type: 'ticket' })
    .pluck('status_id');

  if (statusIds.length === 0) return;

  // 1. Clear the board's own FK back to statuses (circular ref)
  await trx('boards')
    .where({ tenant, board_id: boardId })
    .whereIn('inbound_reply_reopen_status_id', statusIds)
    .update({ inbound_reply_reopen_status_id: null });

  // 2. Remove SLA pause config rows that reference these statuses
  await trx('status_sla_pause_config')
    .where({ tenant })
    .whereIn('status_id', statusIds)
    .delete();

  // 3. Delete the statuses themselves
  await trx('statuses')
    .where({ tenant, board_id: boardId, status_type: 'ticket' })
    .delete();
}

/**
 * Delete a board with hasDependencies pattern (like deleteClient).
 *
 * - If board is default → BLOCK
 * - If board is used in inbound_ticket_defaults → BLOCK
 * - If tickets exist directly on board or in any category/subcategory → BLOCK
 * - If categories exist and no tickets → offer to delete them with force=true
 * - If last ITIL board → offer to cleanup unused ITIL data with cleanupItil=true
 *
 * @param boardId - The board to delete
 * @param force - If true, delete categories and subcategories too (still blocks on tickets)
 * @param cleanupItil - If true and this is the last ITIL board, cleanup unused ITIL priorities/categories
 */
interface DeleteBoardResult {
  success: boolean;
  code?: string;
  message?: string;
  dependencies?: string[];
  counts?: Record<string, number>;
}

export const deleteBoard = withAuth(async (
  _user,
  { tenant },
  boardId: string,
  force = false,
  cleanupItil = false
): Promise<DeleteBoardResult> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction): Promise<DeleteBoardResult> => {
    // 1. Get the board
    const board = await trx('boards')
      .where({ tenant, board_id: boardId })
      .first();

    if (!board) {
      return { success: false, code: 'NOT_FOUND', message: 'Board not found' };
    }

    // 2. Check if default board (protected)
    if (board.is_default) {
      return {
        success: false,
        code: 'BOARD_IS_DEFAULT',
        message: 'Cannot delete the default board. Please set another board as default first.'
      };
    }

    // 3. Check if board is used in inbound_ticket_defaults (email routing)
    const inboundDefaultsResult = await trx('inbound_ticket_defaults')
      .where({ tenant, board_id: boardId })
      .count('* as count')
      .first();

    const inboundDefaultsCount = Number(inboundDefaultsResult?.count || 0);

    if (inboundDefaultsCount > 0) {
      return {
        success: false,
        code: 'BOARD_USED_IN_EMAIL_ROUTING',
        message: 'Cannot delete board: it is configured as the default board for inbound email tickets. Please update your email routing settings first.',
        dependencies: ['inbound_ticket_defaults'],
        counts: { inbound_ticket_defaults: inboundDefaultsCount }
      };
    }

    // 4. Check if this is an ITIL board (categories are shared across ITIL boards)
    const isItilCategoryBoard = board.category_type === 'itil';

    // 5. Get categories for this board (only for custom boards)
    // ITIL categories are shared and shouldn't block individual board deletion
    let allCategoryIds: string[] = [];
    if (!isItilCategoryBoard) {
      const allCategories = await trx('categories')
        .where({ tenant, board_id: boardId })
        .select('category_id');
      allCategoryIds = allCategories.map((c: { category_id: string }) => c.category_id);
    }

    // 6. Check for tickets directly on this board
    // For custom boards, also check tickets in board's categories
    const ticketCountResult = await trx('tickets')
      .where({ tenant })
      .where(function() {
        this.where('board_id', boardId);
        // Only check category-based tickets for custom boards
        if (!isItilCategoryBoard && allCategoryIds.length > 0) {
          this.orWhereIn('category_id', allCategoryIds)
            .orWhereIn('subcategory_id', allCategoryIds);
        }
      })
      .count('ticket_id as count')
      .first();

    const ticketCount = Number(ticketCountResult?.count || 0);

    if (ticketCount > 0) {
      return {
        success: false,
        code: 'BOARD_HAS_TICKETS',
        message: `Cannot delete board: ${ticketCount} ticket${ticketCount === 1 ? ' is' : 's are'} directly on this board`,
        dependencies: ['tickets'],
        counts: { tickets: ticketCount }
      };
    }

    // 6b. Count board ticket statuses (informational — these are always
    // auto-cleaned because the "at least one default" rule makes manual
    // deletion impossible)
    const statusCountResult = await trx('statuses')
      .where({ tenant, board_id: boardId, status_type: 'ticket' })
      .count('status_id as count')
      .first();
    const statusCount = Number(statusCountResult?.count || 0);

    // 7. If custom board has categories and force=false, prompt for confirmation
    // ITIL categories are shared and handled separately via ITIL cleanup
    if (!isItilCategoryBoard && allCategoryIds.length > 0 && !force) {
      const statusInfo = statusCount > 0
        ? ` and ${statusCount} ticket status${statusCount === 1 ? '' : 'es'}`
        : '';
      return {
        success: false,
        code: 'BOARD_HAS_CATEGORIES',
        message: `Board has ${allCategoryIds.length} categor${allCategoryIds.length === 1 ? 'y' : 'ies'}${statusInfo}. Delete them too?`,
        dependencies: ['categories', ...(statusCount > 0 ? ['statuses'] : [])],
        counts: { categories: allCategoryIds.length, ...(statusCount > 0 ? { statuses: statusCount } : {}) }
      };
    }

    // 7b. If board has statuses and user hasn't confirmed, inform them
    if (!force && statusCount > 0 && allCategoryIds.length === 0) {
      return {
        success: false,
        code: 'BOARD_HAS_STATUSES',
        message: `Board has ${statusCount} ticket status${statusCount === 1 ? '' : 'es'} that will also be removed.`,
        dependencies: ['statuses'],
        counts: { statuses: statusCount }
      };
    }

    // 8. Check if this is the last ITIL board
    const isItilBoard = board.category_type === 'itil' || board.priority_type === 'itil';
    let isLastItilBoard = false;

    if (isItilBoard) {
      const otherItilBoardsResult = await trx('boards')
        .where({ tenant })
        .whereNot('board_id', boardId)
        .where(function() {
          this.where('category_type', 'itil').orWhere('priority_type', 'itil');
        })
        .count('* as count')
        .first();

      isLastItilBoard = Number(otherItilBoardsResult?.count || 0) === 0;

      // If last ITIL board and cleanupItil not confirmed, prompt for confirmation
      if (isLastItilBoard && !cleanupItil) {
        return {
          success: false,
          code: 'LAST_ITIL_BOARD',
          message: 'This is the last ITIL board. Do you want to also remove unused ITIL priorities and categories?',
          dependencies: ['itil_data']
        };
      }
    }

    if (!force && !isLastItilBoard && allCategoryIds.length === 0) {
      const result = await deleteEntityWithValidation('board', boardId, db, tenant, async (boardTrx, tenantId) => {
        // Clean up board statuses (can't be deleted manually due to
        // "at least one default status" enforcement, safe because
        // we already confirmed zero tickets above)
        await cleanupBoardStatuses(boardTrx, tenantId, boardId);

        const deletedCount = await boardTrx('boards')
          .where({ tenant: tenantId, board_id: boardId })
          .delete();

        if (deletedCount === 0) {
          throw new Error('Board not found');
        }
      });

      if (!result.deleted) {
        return {
          success: false,
          code: result.code,
          message: result.message || 'Failed to delete board',
          dependencies: result.dependencies?.map((dep) => dep.type)
        };
      }

      return {
        success: true,
        message: 'Board deleted.'
      };
    }

    // 9. Delete custom categories (ITIL categories are shared and cleaned up separately)
    if (!isItilCategoryBoard && allCategoryIds.length > 0) {
      await trx('categories')
        .where({ tenant, board_id: boardId })
        .delete();
    }

    // 10. Clean up board statuses (can't be deleted manually due to
    // "at least one default status" enforcement, safe because
    // we already confirmed zero tickets above)
    await cleanupBoardStatuses(trx, tenant, boardId);

    // 11. Delete the board
    await trx('boards')
      .where({ tenant, board_id: boardId })
      .delete();

    // 12. If last ITIL board and cleanup confirmed, remove unused ITIL data
    let itilCleanupMessage = '';
    if (isLastItilBoard && cleanupItil) {
      const cleanupResult = await ItilStandardsService.cleanupUnusedItilStandards(trx, tenant);

      // Build informative message about what was cleaned up
      const cleanedParts: string[] = [];
      const skippedParts: string[] = [];

      if (cleanupResult.categoriesDeleted > 0) {
        cleanedParts.push(`${cleanupResult.categoriesDeleted} ITIL categor${cleanupResult.categoriesDeleted === 1 ? 'y' : 'ies'}`);
      }
      if (cleanupResult.prioritiesDeleted > 0) {
        cleanedParts.push(`${cleanupResult.prioritiesDeleted} ITIL priorit${cleanupResult.prioritiesDeleted === 1 ? 'y' : 'ies'}`);
      }
      if (cleanupResult.categoriesSkippedReason) {
        skippedParts.push(`categories (${cleanupResult.categoriesSkippedReason})`);
      }
      if (cleanupResult.prioritiesSkippedReason) {
        skippedParts.push(`priorities (${cleanupResult.prioritiesSkippedReason})`);
      }

      if (cleanedParts.length > 0) {
        itilCleanupMessage = ` Cleaned up: ${cleanedParts.join(', ')}.`;
      }
      if (skippedParts.length > 0) {
        itilCleanupMessage += ` Could not clean up: ${skippedParts.join(', ')}.`;
      }
    }

    return {
      success: true,
      message: !isItilCategoryBoard && allCategoryIds.length > 0
        ? `Board and ${allCategoryIds.length} categor${allCategoryIds.length === 1 ? 'y' : 'ies'} deleted.${itilCleanupMessage}`
        : `Board deleted.${itilCleanupMessage}`
    };
  });
});

/**
 * Legacy delete function - throws errors for backward compatibility.
 * Use deleteBoard() with force parameter for new code.
 */
export async function deleteBoardLegacy(boardId: string): Promise<boolean> {
  const result = await deleteBoard(boardId, false);
  if (!result.success) {
    throw new Error(result.message || 'Failed to delete board');
  }
  return true;
}

export const updateBoard = withAuth(async (user, { tenant }, boardId: string, boardData: UpdateBoardInput): Promise<IBoard> => {
  const { knex: db } = await createTenantKnex();

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

      // Sanitize default_assigned_to, manager_user_id, and sla_policy_id: convert empty string to null
      const sanitizedData = { ...boardData };
      if ('default_assigned_to' in sanitizedData) {
        sanitizedData.default_assigned_to = sanitizedData.default_assigned_to || null;
      }
      if ('default_priority_id' in sanitizedData) {
        const v = sanitizedData.default_priority_id as unknown;
        sanitizedData.default_priority_id = (typeof v === 'string' && v.length > 0) ? v : null;
      }
      if ('manager_user_id' in sanitizedData) {
        sanitizedData.manager_user_id = sanitizedData.manager_user_id || null;
      }
      if ('sla_policy_id' in sanitizedData) {
        sanitizedData.sla_policy_id = sanitizedData.sla_policy_id || null;
      }
      if ('inbound_reply_reopen_status_id' in sanitizedData) {
        const v = sanitizedData.inbound_reply_reopen_status_id as unknown;
        sanitizedData.inbound_reply_reopen_status_id = (typeof v === 'string' && v.length > 0) ? v : null;
      }
      if ('inbound_reply_reopen_cutoff_hours' in sanitizedData) {
        const cutoff = Number(sanitizedData.inbound_reply_reopen_cutoff_hours);
        sanitizedData.inbound_reply_reopen_cutoff_hours = Number.isFinite(cutoff) && cutoff > 0
          ? Math.max(1, Math.floor(cutoff))
          : 168;
      }
      if ('inbound_reply_reopen_enabled' in sanitizedData) {
        sanitizedData.inbound_reply_reopen_enabled = Boolean(sanitizedData.inbound_reply_reopen_enabled);
      }
      if ('inbound_reply_ai_ack_suppression_enabled' in sanitizedData) {
        sanitizedData.inbound_reply_ai_ack_suppression_enabled = Boolean(
          sanitizedData.inbound_reply_ai_ack_suppression_enabled
        );
      }
      if ('enable_live_ticket_timer' in sanitizedData) {
        sanitizedData.enable_live_ticket_timer = sanitizedData.enable_live_ticket_timer ?? true;
      }

      const { ticket_statuses: ticketStatuses, ...boardUpdateData } = sanitizedData;

      const [updatedBoard] = await trx('boards')
        .where({ board_id: boardId, tenant })
        .update(boardUpdateData)
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

      if (ticketStatuses) {
        await saveBoardTicketStatusesForBoard(
          trx,
          tenant,
          boardId,
          user.user_id,
          ticketStatuses
        );
      }

      return normalizeBoardLiveTimerSetting(updatedBoard);
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
});

/**
 * Find board by name
 * This action searches for existing boards by name
 */
export const findBoardByName = withAuth(async (_user, { tenant }, name: string): Promise<FindBoardByNameOutput | null> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const board = await trx('boards')
      .select('board_id as id', 'board_name as name', 'description', 'is_default', 'is_inactive')
      .where('tenant', tenant)
      .whereRaw('LOWER(board_name) = LOWER(?)', [name])
      .first();

    return board || null;
  });
});
