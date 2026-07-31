/**
 * @alga-psa/tickets - Priority Model
 *
 * Data access layer for priority entities.
 * Migrated from server/src/lib/models/priority.ts
 *
 * Key changes from original:
 * - Tenant is an explicit parameter (not from getCurrentTenantId)
 * - This decouples the model from Next.js runtime
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IPriority } from '@alga-psa/types';

function tenantScopedTable<Row extends object = Record<string, unknown>>(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(table);
}

/**
 * Priority model with tenant-explicit methods.
 * All methods require an explicit tenant parameter for multi-tenant safety.
 */
const Priority = {
  /**
   * Get all priorities for a tenant.
   * @param itemType - Optional filter by 'ticket' or 'project_task'
   */
  getAll: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    itemType?: 'ticket' | 'project_task'
  ): Promise<IPriority[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }

    const query = tenantScopedTable<IPriority>(knexOrTrx, 'priorities', tenant)
      .select('*');

    if (itemType) {
      query.where({ item_type: itemType });
    }

    return query.orderBy('order_number', 'asc');
  },

  /**
   * Get a single priority by ID.
   */
  get: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    id: string
  ): Promise<IPriority | null> => {
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }

    const [priority] = await tenantScopedTable<IPriority>(knexOrTrx, 'priorities', tenant)
      .where({ priority_id: id });

    return priority || null;
  },

  /**
   * Create a new priority.
   */
  insert: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    priority: Omit<IPriority, 'priority_id' | 'tenant'>
  ): Promise<IPriority> => {
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }

    const [insertedPriority] = await tenantScopedTable<IPriority>(knexOrTrx, 'priorities', tenant)
      .insert({
        ...priority,
        tenant,
      })
      .returning('*');

    return insertedPriority;
  },

  /**
   * Update an existing priority.
   */
  update: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    id: string,
    priority: Partial<Omit<IPriority, 'tenant'>>
  ): Promise<IPriority | null> => {
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }

    // Remove tenant from update data since it's a partition key and cannot be modified
    const { ...updateData } = priority;

    const [updatedPriority] = await tenantScopedTable<IPriority>(knexOrTrx, 'priorities', tenant)
      .where({ priority_id: id })
      .update(updateData)
      .returning('*');

    return updatedPriority || null;
  },

  /**
   * Delete a priority.
   */
  delete: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    id: string
  ): Promise<void> => {
    if (!tenant) {
      throw new Error('Tenant context is required for priority operations');
    }

    const deleted = await tenantScopedTable<IPriority>(knexOrTrx, 'priorities', tenant)
      .where({ priority_id: id })
      .del();

    if (deleted === 0) {
      throw new Error(`Priority ${id} not found in tenant ${tenant}`);
    }
  },

  /**
   * Get priorities for tickets.
   */
  getTicketPriorities: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IPriority[]> => {
    return Priority.getAll(knexOrTrx, tenant, 'ticket');
  },

  /**
   * Get priorities for project tasks.
   */
  getProjectTaskPriorities: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IPriority[]> => {
    return Priority.getAll(knexOrTrx, tenant, 'project_task');
  },
};

export default Priority;
