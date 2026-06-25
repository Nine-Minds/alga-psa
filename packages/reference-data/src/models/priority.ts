/**
 * @alga-psa/reference-data - Priority Model
 *
 * Data access layer for priority entities.
 * Copied from @alga-psa/tickets/models/priority to avoid reference-data ↔ tickets cycles.
 */

import type { Knex } from 'knex';
import type { IPriority } from '@alga-psa/types';
import { createTenantScopedQuery } from '@alga-psa/db';

const prioritiesQuery = (knexOrTrx: Knex | Knex.Transaction, tenant: string) =>
  createTenantScopedQuery(knexOrTrx, {
    table: 'priorities',
    tenant
  }).builder;

const Priority = {
  getAll: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    itemType?: 'ticket' | 'project_task'
  ): Promise<IPriority[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }

    const query = prioritiesQuery(knexOrTrx, tenant)
      .select('*');

    if (itemType) {
      query.where({ item_type: itemType });
    }

    return query.orderBy('order_number', 'asc');
  },

  get: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    id: string
  ): Promise<IPriority | null> => {
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }

    const [priority] = await prioritiesQuery(knexOrTrx, tenant)
      .where({ priority_id: id }) as IPriority[];

    return priority || null;
  },

  insert: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    priority: Omit<IPriority, 'priority_id' | 'tenant'>
  ): Promise<IPriority> => {
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }

    const [insertedPriority] = await knexOrTrx('priorities')
      .insert({
        ...priority,
        tenant,
      })
      .returning('*');

    return insertedPriority;
  },

  update: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    id: string,
    priority: Partial<Omit<IPriority, 'tenant'>>
  ): Promise<IPriority | null> => {
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }

    const { ...updateData } = priority;

    const [updatedPriority] = await prioritiesQuery(knexOrTrx, tenant)
      .where({ priority_id: id })
      .update(updateData)
      .returning('*') as IPriority[];

    return updatedPriority || null;
  },

  delete: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    id: string
  ): Promise<void> => {
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }

    const deleted = await prioritiesQuery(knexOrTrx, tenant)
      .where({ priority_id: id })
      .del();

    if (deleted === 0) {
      throw new Error(`Priority ${id} not found in tenant ${tenant}`);
    }
  },

  getTicketPriorities: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IPriority[]> => {
    return Priority.getAll(knexOrTrx, tenant, 'ticket');
  },

  getProjectTaskPriorities: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IPriority[]> => {
    return Priority.getAll(knexOrTrx, tenant, 'project_task');
  },
};

export default Priority;
