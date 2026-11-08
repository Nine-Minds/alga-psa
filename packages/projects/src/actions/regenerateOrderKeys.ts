'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { regenerateTaskOrderKeys, repairTaskOrderKeys, regeneratePhaseOrderKeys, repairPhaseOrderKeys } from '../services/projectOrderingService';
import {
  actionError,
  permissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  isProjectOrderKeyActionError,
  type ProjectOrderKeyActionError,
} from './projectOrderKeyActionErrors';

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
    return actionError('One of the selected project, phase, task, or status values is invalid. Please refresh and try again.', 'projects:errors.ordering.invalidValue');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required project ordering field: ${dbError.column}.`,
          'projects:errors.ordering.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required project ordering field.', 'projects:errors.ordering.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected project ordering records no longer exists. Please refresh and try again.', 'projects:errors.ordering.referenceMissing');
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

/** Authenticated adapters for standalone ordering repair. Nested mutations call
 * the transaction-aware service directly after their own resource checks. */
export const regenerateOrderKeysForStatus = withAuth(async (user, { tenant }, phaseId: string, statusId: string): Promise<void | ProjectOrderKeyActionError> =>
  withProjectOrderKeyErrors(async () => {
    const { knex } = await createTenantKnex();
    if (!await hasPermission(user, 'project', 'update', knex)) throw new Error('Permission denied: Cannot update project');
    await regenerateTaskOrderKeys(knex, tenant, phaseId, statusId);
  }));

export const validateAndFixOrderKeys = withAuth(async (user, { tenant }, phaseId: string, statusId: string): Promise<boolean | ProjectOrderKeyActionError> =>
  withProjectOrderKeyErrors(async () => {
    const { knex } = await createTenantKnex();
    if (!await hasPermission(user, 'project', 'update', knex)) throw new Error('Permission denied: Cannot update project');
    return repairTaskOrderKeys(knex, tenant, phaseId, statusId);
  }));

export const regenerateOrderKeysForPhases = withAuth(async (user, { tenant }, projectId: string): Promise<void | ProjectOrderKeyActionError> =>
  withProjectOrderKeyErrors(async () => {
    const { knex } = await createTenantKnex();
    if (!await hasPermission(user, 'project', 'update', knex)) throw new Error('Permission denied: Cannot update project');
    await regeneratePhaseOrderKeys(knex, tenant, projectId);
  }));

export const validateAndFixPhaseOrderKeys = withAuth(async (user, { tenant }, projectId: string): Promise<boolean | ProjectOrderKeyActionError> =>
  withProjectOrderKeyErrors(async () => {
    const { knex } = await createTenantKnex();
    if (!await hasPermission(user, 'project', 'update', knex)) throw new Error('Permission denied: Cannot update project');
    return repairPhaseOrderKeys(knex, tenant, projectId);
  }));
