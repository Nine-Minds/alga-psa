'use server'

import type { IPriority, DeletionValidationResult } from '@alga-psa/types';
import Priority from '../models/priority';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { Knex } from 'knex';
import { deleteEntityWithValidation } from '@alga-psa/core/server';
import { preCheckDeletion } from '@alga-psa/auth';
import {
  actionError,
} from '@alga-psa/ui/lib/errorHandling';
import type { PriorityActionError } from './priorityActionErrors';

const tenantScopedTable = (trx: Knex | Knex.Transaction, table: string, tenant: string) =>
  tenantDb(trx, tenant).table(table);

function priorityActionErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (
    message === 'ITIL standard priorities cannot be edited' ||
    /^Priority .+ not found/.test(message)
  ) {
    return message;
  }

  return fallback;
}

function priorityActionErrorFrom(error: unknown): PriorityActionError | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (message === 'ITIL standard priorities cannot be edited') {
    return actionError(message);
  }
  if (/^Priority .+ not found/.test(message)) {
    return actionError('Priority not found.');
  }
  if (message === 'Board not found') {
    return actionError('The selected board no longer exists.');
  }

  const dbError = error as { code?: string; column?: string; constraint?: string };
  if (dbError?.code === '23505') {
    return actionError('A priority with these details already exists.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required priority field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected priority reference is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23514' || dbError?.code === '22P02') {
    return actionError('Invalid priority data provided. Please check the priority details.');
  }

  return null;
}

export const getAllPriorities = withAuth(async (_user, { tenant }, itemType?: 'ticket' | 'project_task') => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      const priorities = await Priority.getAll(trx, tenant, itemType);
      return priorities;
    } catch (error) {
      console.error(`Error fetching priorities for tenant ${tenant}:`, error);
      throw error;
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
      if (priorityActionErrorFrom(error)) {
        return null;
      }
      throw error;
    }
  });
});

export const createPriority = withAuth(async (user, { tenant }, priorityData: Omit<IPriority, 'priority_id' | 'tenant' | 'created_by' | 'created_at'>): Promise<IPriority | PriorityActionError> => {
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
      const expected = priorityActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
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

    const result = await deleteEntityWithValidation('priority', priorityId, db, tenant, async (trx, tenantId) => {
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
      message: priorityActionErrorMessage(error, 'Priority could not be deleted.'),
      dependencies: [],
      alternatives: []
    };
  }
});

export const updatePriority = withAuth(async (_user, { tenant }, priorityId: string, priorityData: Partial<IPriority>): Promise<IPriority | PriorityActionError> => {
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
      const expected = priorityActionErrorFrom(error);
      if (expected) {
        return expected;
      }
      throw error;
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
      const board = await tenantScopedTable(trx, 'boards', tenant)
        .select('priority_type')
        .where({ board_id: boardId })
        .first() as { priority_type?: string | null } | undefined;

      if (!board) {
        return [];
      }

      // Get priorities based on board's priority type
      let query = tenantScopedTable(trx, 'priorities', tenant)
        .select('*') as Knex.QueryBuilder;

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

      return await query.orderBy('order_number', 'asc') as IPriority[];
    } catch (error) {
      console.error(`Error fetching priorities for board ${boardId}:`, error);
      throw error;
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
      const priority = await tenantScopedTable(trx, 'priorities', tenant)
        .select('priority_id as id', 'priority_name as name', 'order_number', 'color')
        .whereRaw('LOWER(priority_name) = LOWER(?)', [name])
        .first() as FindPriorityByNameOutput | undefined;

      return priority || null;
    } catch (error) {
      console.error(`Error finding priority by name for tenant ${tenant}:`, error);
      return null;
    }
  });
});
