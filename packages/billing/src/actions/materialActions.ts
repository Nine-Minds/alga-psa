'use server';

import { createTenantKnex } from '@alga-psa/db';
import { ITicketMaterial, IProjectMaterial } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { addMaterial, deleteMaterial, listMaterials } from '@alga-psa/inventory/lib';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type MaterialActionError = ActionMessageError | ActionPermissionError;

function materialActionErrorFrom(error: unknown): MaterialActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }
    if (
      error.name === 'MaterialValidationError' ||
      error.name === 'InsufficientStockError' ||
      error.message === 'Cannot delete a billed material.'
    ) {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected material values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required material field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected material records is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This material record already exists.');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the material values is not allowed. Please review the form and try again.');
  }

  return null;
}

async function withMaterialActionErrors<T>(work: () => Promise<T>): Promise<T | MaterialActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = materialActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

export const listTicketMaterials = withAuth(async (user, { tenant }, ticketId: string): Promise<ITicketMaterial[] | MaterialActionError> => {
  return withMaterialActionErrors(async () => {
  if (!await hasPermission(user, 'billing', 'read')) {
    throw new Error('Permission denied: billing read required');
  }
  const { knex: db } = await createTenantKnex();
  return (await listMaterials(db, tenant, 'ticket', ticketId)) as ITicketMaterial[];
  });
});

export const addTicketMaterial = withAuth(async (user, { tenant }, input: {
  ticket_id: string;
  client_id: string;
  service_id: string;
  quantity: number;
  rate: number; // cents
  currency_code: string;
  description?: string | null;
  unit_id?: string | null; // serialized: the picked stock unit to deliver
}): Promise<ITicketMaterial | MaterialActionError> => {
  return withMaterialActionErrors(async () => {
  if (!await hasPermission(user, 'billing', 'create')) {
    throw new Error('Permission denied: billing create required');
  }
  const { knex: db } = await createTenantKnex();
  return (await addMaterial(
    db,
    tenant,
    { ...input, parent_type: 'ticket', parent_id: input.ticket_id },
    (user as any)?.user_id ?? null,
  )) as ITicketMaterial;
  });
});

export const deleteTicketMaterial = withAuth(async (user, { tenant }, ticketMaterialId: string): Promise<void | MaterialActionError> => {
  return withMaterialActionErrors(async () => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    throw new Error('Permission denied: billing delete required');
  }
  const { knex: db } = await createTenantKnex();
  await deleteMaterial(db, tenant, 'ticket', ticketMaterialId, (user as any)?.user_id ?? null);
  });
});

export const listProjectMaterials = withAuth(async (user, { tenant }, projectId: string): Promise<IProjectMaterial[] | MaterialActionError> => {
  return withMaterialActionErrors(async () => {
  if (!await hasPermission(user, 'billing', 'read')) {
    throw new Error('Permission denied: billing read required');
  }
  const { knex: db } = await createTenantKnex();
  return (await listMaterials(db, tenant, 'project', projectId)) as IProjectMaterial[];
  });
});

export const addProjectMaterial = withAuth(async (user, { tenant }, input: {
  project_id: string;
  client_id: string;
  service_id: string;
  quantity: number;
  rate: number; // cents
  currency_code: string;
  description?: string | null;
  unit_id?: string | null; // serialized: the picked stock unit to deliver
}): Promise<IProjectMaterial | MaterialActionError> => {
  return withMaterialActionErrors(async () => {
  if (!await hasPermission(user, 'billing', 'create')) {
    throw new Error('Permission denied: billing create required');
  }
  const { knex: db } = await createTenantKnex();
  return (await addMaterial(
    db,
    tenant,
    { ...input, parent_type: 'project', parent_id: input.project_id },
    (user as any)?.user_id ?? null,
  )) as IProjectMaterial;
  });
});

export const deleteProjectMaterial = withAuth(async (user, { tenant }, projectMaterialId: string): Promise<void | MaterialActionError> => {
  return withMaterialActionErrors(async () => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    throw new Error('Permission denied: billing delete required');
  }
  const { knex: db } = await createTenantKnex();
  await deleteMaterial(db, tenant, 'project', projectMaterialId, (user as any)?.user_id ?? null);
  });
});
