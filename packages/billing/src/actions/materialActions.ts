'use server';

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import { ITicketMaterial, IProjectMaterial } from '@alga-psa/types';

export async function listTicketMaterials(ticketId: string): Promise<ITicketMaterial[]> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const rows = await trx('ticket_materials as tm')
      .leftJoin('service_catalog as sc', function () {
        this.on('tm.service_id', '=', 'sc.service_id').andOn('tm.tenant', '=', 'sc.tenant');
      })
      .where({ 'tm.tenant': tenant, 'tm.ticket_id': ticketId })
      .select(
        'tm.*',
        'sc.service_name as service_name',
        'sc.sku as sku'
      )
      .orderBy('tm.created_at', 'desc');
    return rows as ITicketMaterial[];
  });
}

export async function addTicketMaterial(input: {
  ticket_id: string;
  client_id: string;
  service_id: string;
  quantity: number;
  rate: number; // cents
  currency_code: string;
  description?: string | null;
}): Promise<ITicketMaterial> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const [row] = await trx('ticket_materials')
      .insert({
        tenant,
        ticket_id: input.ticket_id,
        client_id: input.client_id,
        service_id: input.service_id,
        quantity: Math.max(1, Math.floor(input.quantity || 1)),
        rate: Math.max(0, Math.round(input.rate || 0)),
        currency_code: input.currency_code || 'USD',
        description: input.description ?? null,
        is_billed: false
      })
      .returning('*');
    return row as ITicketMaterial;
  });
}

export async function deleteTicketMaterial(ticketMaterialId: string): Promise<void> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const row = await trx('ticket_materials')
      .where({ tenant, ticket_material_id: ticketMaterialId })
      .select('is_billed')
      .first();

    if (!row) return;
    if (row.is_billed) {
      throw new Error('Cannot delete a billed material.');
    }

    await trx('ticket_materials')
      .where({ tenant, ticket_material_id: ticketMaterialId })
      .delete();
  });
}

export async function listProjectMaterials(projectId: string): Promise<IProjectMaterial[]> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const rows = await trx('project_materials as pm')
      .leftJoin('service_catalog as sc', function () {
        this.on('pm.service_id', '=', 'sc.service_id').andOn('pm.tenant', '=', 'sc.tenant');
      })
      .where({ 'pm.tenant': tenant, 'pm.project_id': projectId })
      .select(
        'pm.*',
        'sc.service_name as service_name',
        'sc.sku as sku'
      )
      .orderBy('pm.created_at', 'desc');
    return rows as IProjectMaterial[];
  });
}

export async function addProjectMaterial(input: {
  project_id: string;
  client_id: string;
  service_id: string;
  quantity: number;
  rate: number; // cents
  currency_code: string;
  description?: string | null;
}): Promise<IProjectMaterial> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const [row] = await trx('project_materials')
      .insert({
        tenant,
        project_id: input.project_id,
        client_id: input.client_id,
        service_id: input.service_id,
        quantity: Math.max(1, Math.floor(input.quantity || 1)),
        rate: Math.max(0, Math.round(input.rate || 0)),
        currency_code: input.currency_code || 'USD',
        description: input.description ?? null,
        is_billed: false
      })
      .returning('*');
    return row as IProjectMaterial;
  });
}

export async function deleteProjectMaterial(projectMaterialId: string): Promise<void> {
  const { knex: db, tenant } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const row = await trx('project_materials')
      .where({ tenant, project_material_id: projectMaterialId })
      .select('is_billed')
      .first();

    if (!row) return;
    if (row.is_billed) {
      throw new Error('Cannot delete a billed material.');
    }

    await trx('project_materials')
      .where({ tenant, project_material_id: projectMaterialId })
      .delete();
  });
}

