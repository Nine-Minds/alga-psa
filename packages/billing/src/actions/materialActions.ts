'use server';

import { createTenantKnex } from '@alga-psa/db';
import { ITicketMaterial, IProjectMaterial } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { addMaterial, deleteMaterial, listMaterials } from '@alga-psa/inventory/lib';

export const listTicketMaterials = withAuth(async (user, { tenant }, ticketId: string): Promise<ITicketMaterial[]> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    throw new Error('Permission denied: billing read required');
  }
  const { knex: db } = await createTenantKnex();
  return (await listMaterials(db, tenant, 'ticket', ticketId)) as ITicketMaterial[];
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
}): Promise<ITicketMaterial> => {
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

export const deleteTicketMaterial = withAuth(async (user, { tenant }, ticketMaterialId: string): Promise<void> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    throw new Error('Permission denied: billing delete required');
  }
  const { knex: db } = await createTenantKnex();
  await deleteMaterial(db, tenant, 'ticket', ticketMaterialId, (user as any)?.user_id ?? null);
});

export const listProjectMaterials = withAuth(async (user, { tenant }, projectId: string): Promise<IProjectMaterial[]> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    throw new Error('Permission denied: billing read required');
  }
  const { knex: db } = await createTenantKnex();
  return (await listMaterials(db, tenant, 'project', projectId)) as IProjectMaterial[];
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
}): Promise<IProjectMaterial> => {
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

export const deleteProjectMaterial = withAuth(async (user, { tenant }, projectMaterialId: string): Promise<void> => {
  if (!await hasPermission(user, 'billing', 'delete')) {
    throw new Error('Permission denied: billing delete required');
  }
  const { knex: db } = await createTenantKnex();
  await deleteMaterial(db, tenant, 'project', projectMaterialId, (user as any)?.user_id ?? null);
});
