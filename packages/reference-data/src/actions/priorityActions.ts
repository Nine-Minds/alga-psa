'use server'

import type { IPriority, DeletionValidationResult } from '@alga-psa/types';
import Priority from '../models/priority';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex';
import { deleteEntityWithValidation, preCheckDeletion } from '@alga-psa/core';

export const getAllPriorities = withAuth(async (_user, { tenant }, itemType?: 'ticket' | 'project_task') => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const priorities = await Priority.getAll(trx, tenant, itemType);
      return priorities;
    } catch (error) {
      console.error(`Error fetching priorities for tenant ${tenant}:`, error);
      throw new Error(`Failed to fetch priorities for tenant ${tenant}`);
    }
  });
});

export const getAllPrioritiesWithStandard = withAuth(async (_user, ctx, itemType?: 'ticket' | 'project_task') => {
  // This function is deprecated. Use getAllPriorities instead.
  // Standard priorities should now be imported via referenceDataActions.ts
  return getAllPriorities(itemType);
});

export const findPriorityById = withAuth(async (_user, { tenant }, id: string) => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const priority = await Priority.get(trx, tenant, id);
      if (!priority) {
        throw new Error(`Priority ${id} not found`);
      }
      return priority;
    } catch (error) {
      console.error(`Error finding priority for tenant ${tenant}:`, error);
      throw new Error(`Failed to find priority for tenant ${tenant}`);
    }
  });
});

export const createPriority = withAuth(async (user, { tenant }, priorityData: Omit<IPriority, 'priority_id' | 'tenant' | 'created_by' | 'created_at'>): Promise<IPriority> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const newPriority = await Priority.insert(trx, tenant, {
        ...priorityData,
        created_by: user.user_id,
        created_at: new Date()
      });
      return newPriority;
    } catch (error) {
      console.error(`Error creating priority for tenant ${tenant}:`, error);
      throw new Error(`Failed to create priority for tenant ${tenant}`);
    }
  });
});


export const validatePriorityDeletion = withAuth(async (
  _user,
  { tenant },
  priorityId: string
): Promise<DeletionValidationResult> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const priority = await Priority.get(trx, tenant, priorityId);
    if (!priority) {
      return {
        canDelete: false,
        code: 'NOT_FOUND',
        message: 'Priority not found.',
        dependencies: [],
        alternatives: []
      };
    }

    if (priority.is_from_itil_standard) {
      return {
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: 'ITIL standard priorities cannot be deleted.',
        dependencies: [],
        alternatives: []
      };
    }

    return preCheckDeletion('priority', priorityId);
  });
});

export const deletePriority = withAuth(async (
  _user,
  { tenant },
  priorityId: string
): Promise<DeletionValidationResult & { success: boolean; deleted?: boolean }> => {
  try {
    const { knex: db } = await createTenantKnex();
    const priority = await withTransaction(db, async (trx: Knex.Transaction) => {
      return Priority.get(trx, tenant, priorityId);
    });

    if (!priority) {
      return {
        success: false,
        canDelete: false,
        code: 'NOT_FOUND',
        message: 'Priority not found.',
        dependencies: [],
        alternatives: []
      };
    }

    if (priority.is_from_itil_standard) {
      return {
        success: false,
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: 'ITIL standard priorities cannot be deleted.',
        dependencies: [],
        alternatives: []
      };
    }

    const result = await deleteEntityWithValidation('priority', priorityId, async (trx, tenantId) => {
      await Priority.delete(trx, tenantId, priorityId);
    });

    return {
      ...result,
      success: result.deleted === true,
      deleted: result.deleted
    };
  } catch (error) {
    console.error(`Error deleting priority ${priorityId} for tenant ${tenant}:`, error);
    return {
      success: false,
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: error instanceof Error ? error.message : `Failed to delete priority for tenant ${tenant}`,
      dependencies: [],
      alternatives: []
    };
  }
});

export const updatePriority = withAuth(async (_user, { tenant }, priorityId: string, priorityData: Partial<IPriority>): Promise<IPriority> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Check if this is an ITIL standard priority (immutable)
      const existingPriority = await Priority.get(trx, tenant, priorityId);
      if (existingPriority?.is_from_itil_standard) {
        throw new Error('ITIL standard priorities cannot be edited');
      }

      const updatedPriority = await Priority.update(trx, tenant, priorityId, priorityData);
      if (!updatedPriority) {
        throw new Error(`Priority ${priorityId} not found for tenant ${tenant}`);
      }
      return updatedPriority;
    } catch (error) {
      console.error(`Error updating priority ${priorityId} for tenant ${tenant}:`, error);
      throw new Error(error instanceof Error ? error.message : `Failed to update priority for tenant ${tenant}`);
    }
  });
});

/**
 * Get priorities filtered by board's priority type
 * Returns ITIL priorities if board uses ITIL, custom priorities otherwise
 */
export const getPrioritiesByBoardType = withAuth(async (_user, { tenant }, boardId: string, itemType?: 'ticket' | 'project_task'): Promise<IPriority[]> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Get the board's priority type
      const board = await trx('boards')
        .select('priority_type')
        .where({ tenant, board_id: boardId })
        .first();

      if (!board) {
        throw new Error(`Board ${boardId} not found`);
      }

      // Get priorities based on board's priority type
      let query = trx('priorities')
        .select('*')
        .where({ tenant });

      if (itemType) {
        query = query.where({ item_type: itemType });
      }

      if (board.priority_type === 'itil') {
        // For ITIL boards, return only ITIL priorities
        query = query.where({ is_from_itil_standard: true });
      } else {
        // For custom boards, return only custom priorities
        query = query.where(function() {
          this.where({ is_from_itil_standard: false })
            .orWhereNull('is_from_itil_standard');
        });
      }

      return query.orderBy('order_number', 'asc');
    } catch (error) {
      console.error(`Error fetching priorities for board ${boardId}:`, error);
      throw new Error(`Failed to fetch priorities for board ${boardId}`);
    }
  });
});

export interface FindPriorityByNameOutput {
  id: string;
  name: string;
  order_number: number;
  color?: string;
}

/**
 * Find priority by name
 * This action searches for existing priorities by name
 */
export const findPriorityByName = withAuth(async (_user, { tenant }, name: string): Promise<FindPriorityByNameOutput | null> => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const priority = await trx('priorities')
        .select('priority_id as id', 'priority_name as name', 'order_number', 'color')
        .where('tenant', tenant)
        .whereRaw('LOWER(priority_name) = LOWER(?)', [name])
        .first();

      return priority || null;
    } catch (error) {
      console.error(`Error finding priority by name for tenant ${tenant}:`, error);
      return null;
    }
  });
});
