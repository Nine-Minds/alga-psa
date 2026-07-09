'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { OrderingService } from '../lib/orderingUtils';
import type { IProjectPhase, IProjectTask } from '@alga-psa/types';
import { Knex } from 'knex';
import {
  actionError,
  isActionMessageError,
  isActionPermissionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export type ProjectOrderKeyActionError = ActionMessageError | ActionPermissionError;

export function isProjectOrderKeyActionError(value: unknown): value is ProjectOrderKeyActionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}

function projectOrderKeyActionErrorFrom(error: unknown): ProjectOrderKeyActionError | null {
  if (isProjectOrderKeyActionError(error)) {
    return error;
  }
  if (error instanceof Error) {
    if (error.message.includes('Permission denied')) {
      return permissionError(error.message);
    }
    if (
      error.message.includes('not found') ||
      error.message.includes('No valid') ||
      error.message.includes('Missing order key')
    ) {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected project, phase, task, or status values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required project ordering field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected project ordering records no longer exists. Please refresh and try again.');
  }

  return null;
}

async function withProjectOrderKeyErrors<T>(operation: () => Promise<T>): Promise<T | ProjectOrderKeyActionError> {
  try {
    return await operation();
  } catch (error) {
    const expected = projectOrderKeyActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

/**
 * Regenerates order keys for all tasks in a phase/status to ensure they follow proper fractional indexing
 */
export const regenerateOrderKeysForStatus = withAuth(async (
  user,
  { tenant },
  phaseId: string,
  statusId: string
): Promise<void | ProjectOrderKeyActionError> => withProjectOrderKeyErrors(async () => {
  const { knex: db } = await createTenantKnex();

  await db.transaction(async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'project', 'update', trx)) {
      throw new Error('Permission denied: Cannot update project');
    }
    // Get all tasks in this status, ordered by current order_key
    const tasks = await tenantScopedTable(trx, 'project_tasks', tenant)
      .where('phase_id', phaseId)
      .where('project_status_mapping_id', statusId)
      .orderBy('order_key', 'asc') as IProjectTask[];

    if (tasks.length === 0) return;

    // Generate new order keys
    const newKeys = OrderingService.generateInitialKeys(tasks.length);

    // Update each task with its new order key
    for (let i = 0; i < tasks.length; i++) {
      await tenantScopedTable(trx, 'project_tasks', tenant)
        .where('task_id', tasks[i].task_id)
        .update({
          order_key: newKeys[i],
          updated_at: trx.fn.now()
        });
    }

    console.log(`Regenerated order keys for ${tasks.length} tasks in status ${statusId}`);
  });
}));

/**
 * Checks if order keys in a status are valid and regenerates them if needed
 */
export const validateAndFixOrderKeys = withAuth(async (
  user,
  { tenant },
  phaseId: string,
  statusId: string
): Promise<boolean | ProjectOrderKeyActionError> => withProjectOrderKeyErrors(async () => {
  const { knex: db } = await createTenantKnex();

  if (!await hasPermission(user, 'project', 'update', db)) {
    throw new Error('Permission denied: Cannot update project');
  }

  const tasks = await tenantScopedTable(db, 'project_tasks', tenant)
    .where('phase_id', phaseId)
    .where('project_status_mapping_id', statusId)
    .orderBy('order_key', 'asc')
    .select('task_id', 'order_key', 'task_name') as Pick<IProjectTask, 'task_id' | 'order_key' | 'task_name'>[];

  // Check for issues
  let needsRegeneration = false;

  for (let i = 0; i < tasks.length - 1; i++) {
    const currentKey = tasks[i].order_key;
    const nextKey = tasks[i + 1].order_key;

    if (!currentKey || !nextKey) {
      console.log('Missing order key detected');
      needsRegeneration = true;
      break;
    }

    if (currentKey >= nextKey) {
      console.log(`Order key issue: ${currentKey} >= ${nextKey}`);
      needsRegeneration = true;
      break;
    }

    // Check for unusual patterns (like "Zz" which shouldn't appear in normal fractional indexing)
    if (!/^[a-zA-Z0-9]*$/.test(currentKey) || currentKey.includes('Zz')) {
      console.log(`Unusual order key pattern: ${currentKey}`);
      needsRegeneration = true;
      break;
    }
  }

  if (needsRegeneration) {
    console.log('Order keys need regeneration for status', statusId);
    const result = await regenerateOrderKeysForStatus(phaseId, statusId);
    if (isProjectOrderKeyActionError(result)) {
      return result;
    }
    return true;
  }

  return false;
}));

/**
 * Regenerates order keys for all phases in a project to ensure they follow proper fractional indexing
 */
export const regenerateOrderKeysForPhases = withAuth(async (
  user,
  { tenant },
  projectId: string
): Promise<void | ProjectOrderKeyActionError> => withProjectOrderKeyErrors(async () => {
  const { knex: db } = await createTenantKnex();

  await db.transaction(async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'project', 'update', trx)) {
      throw new Error('Permission denied: Cannot update project');
    }
    // Get all phases in this project, ordered by current order_key (or fallback to end_date)
    const phases = await tenantScopedTable(trx, 'project_phases', tenant)
      .where('project_id', projectId)
      .orderByRaw(`
        CASE
          WHEN order_key IS NULL THEN 1
          ELSE 0
        END,
        order_key ASC,
        end_date ASC
      `) as IProjectPhase[];

    if (phases.length === 0) return;

    // Generate new order keys
    const newKeys = OrderingService.generateInitialKeys(phases.length);

    // Update each phase with its new order key
    for (let i = 0; i < phases.length; i++) {
      await tenantScopedTable(trx, 'project_phases', tenant)
        .where('phase_id', phases[i].phase_id)
        .update({
          order_key: newKeys[i],
          updated_at: trx.fn.now()
        });
    }

    console.log(`Regenerated order keys for ${phases.length} phases in project ${projectId}`);
  });
}));

/**
 * Validates and fixes order keys for phases if needed
 */
export const validateAndFixPhaseOrderKeys = withAuth(async (
  user,
  { tenant },
  projectId: string
): Promise<boolean | ProjectOrderKeyActionError> => withProjectOrderKeyErrors(async () => {
  const { knex: db } = await createTenantKnex();

  if (!await hasPermission(user, 'project', 'update', db)) {
    throw new Error('Permission denied: Cannot update project');
  }

  const phases = await tenantScopedTable(db, 'project_phases', tenant)
    .where('project_id', projectId)
    .orderBy('order_key', 'asc')
    .select('phase_id', 'order_key', 'phase_name') as Pick<IProjectPhase, 'phase_id' | 'order_key' | 'phase_name'>[];

  // Check for issues
  let needsRegeneration = false;

  for (let i = 0; i < phases.length - 1; i++) {
    const currentKey = phases[i].order_key;
    const nextKey = phases[i + 1].order_key;

    if (!currentKey || !nextKey) {
      console.log('Missing phase order key detected');
      needsRegeneration = true;
      break;
    }

    if (currentKey >= nextKey) {
      console.log(`Phase order key issue: ${currentKey} >= ${nextKey}`);
      needsRegeneration = true;
      break;
    }

    // Check for unusual patterns
    if (!/^[a-zA-Z0-9]*$/.test(currentKey) || currentKey.includes('Zz')) {
      console.log(`Unusual phase order key pattern: ${currentKey}`);
      needsRegeneration = true;
      break;
    }
  }

  if (needsRegeneration) {
    console.log('Phase order keys need regeneration for project', projectId);
    const result = await regenerateOrderKeysForPhases(projectId);
    if (isProjectOrderKeyActionError(result)) {
      return result;
    }
    return true;
  }

  return false;
}));
