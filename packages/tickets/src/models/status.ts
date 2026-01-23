/**
 * @alga-psa/tickets - Status Model
 *
 * Data access layer for status entities.
 * Migrated from server/src/lib/models/status.ts
 *
 * Key changes from original:
 * - Tenant is an explicit parameter (not from getCurrentTenantId)
 * - This decouples the model from Next.js runtime
 */

import type { Knex } from 'knex';
import type { IStatus, StatusItemType } from '@alga-psa/types';

/**
 * Status model with tenant-explicit methods.
 * All methods require an explicit tenant parameter for multi-tenant safety.
 */
const Status = {
  /**
   * Get all statuses for a tenant.
   */
  getAll: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IStatus[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting statuses');
    }

    try {
      const statuses = await knexOrTrx<IStatus>('statuses')
        .select('*')
        .where({ tenant });

      return statuses;
    } catch (error) {
      console.error('Error getting all statuses:', error);
      throw error;
    }
  },

  /**
   * Get statuses by type for a tenant.
   */
  getByType: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    statusType: StatusItemType
  ): Promise<IStatus[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting statuses by type');
    }

    try {
      const statuses = await knexOrTrx<IStatus>('statuses')
        .select('*')
        .where({ tenant, status_type: statusType })
        .orderBy('order_number', 'asc');

      return statuses;
    } catch (error) {
      console.error(`Error getting statuses of type ${statusType}:`, error);
      throw error;
    }
  },

  /**
   * Get a single status by ID.
   */
  get: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    id: string
  ): Promise<IStatus | undefined> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting status');
    }

    try {
      const status = await knexOrTrx<IStatus>('statuses')
        .select('*')
        .where({
          status_id: id,
          tenant
        })
        .first();

      return status;
    } catch (error) {
      console.error(`Error getting status with id ${id}:`, error);
      throw error;
    }
  },

  /**
   * Create a new status.
   */
  insert: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    status: Omit<IStatus, 'tenant'>
  ): Promise<Pick<IStatus, 'status_id'>> => {
    if (!tenant) {
      throw new Error('Tenant context is required for creating status');
    }

    try {
      // Check if this is the first status of this type - if so, make it default
      const existingStatuses = await knexOrTrx<IStatus>('statuses')
        .where({
          tenant,
          status_type: status.status_type,
          is_default: true
        });

      // Get the max order number for this status type
      const maxOrderResult = await knexOrTrx('statuses')
        .max('order_number as maxOrder')
        .where({
          tenant,
          status_type: status.status_type
        })
        .first<{ maxOrder: number | null }>();

      const nextOrderNumber = (maxOrderResult?.maxOrder || 0) + 1;

      const statusToInsert = {
        ...status,
        tenant,
        order_number: nextOrderNumber,
        is_default: existingStatuses.length === 0
      };

      const [insertedStatus] = await knexOrTrx<IStatus>('statuses')
        .insert(statusToInsert)
        .returning('status_id');

      return { status_id: insertedStatus.status_id };
    } catch (error) {
      console.error('Error inserting status:', error);
      throw error;
    }
  },

  /**
   * Update an existing status.
   */
  update: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    id: string,
    status: Partial<Omit<IStatus, 'tenant'>>
  ): Promise<IStatus> => {
    if (!tenant) {
      throw new Error('Tenant context is required for updating status');
    }

    try {
      // If updating is_default to false, check if this is the last default status
      if (status.is_default === false) {
        const currentStatus = await knexOrTrx<IStatus>('statuses')
          .where({ tenant, status_id: id })
          .first();

        if (currentStatus) {
          const defaultStatuses = await knexOrTrx<IStatus>('statuses')
            .where({
              tenant,
              is_default: true,
              status_type: currentStatus.status_type
            })
            .whereNot('status_id', id);

          if (defaultStatuses.length === 0) {
            throw new Error('Cannot remove default status from the last default status');
          }
        }
      }

      await knexOrTrx<IStatus>('statuses')
        .where({
          status_id: id,
          tenant
        })
        .update(status);

      const updatedStatus = await knexOrTrx<IStatus>('statuses')
        .where({
          status_id: id,
          tenant
        })
        .first();

      if (!updatedStatus) {
        throw new Error(`Status with id ${id} not found after update`);
      }

      return updatedStatus;
    } catch (error) {
      console.error(`Error updating status with id ${id}:`, error);
      throw error;
    }
  },

  /**
   * Delete a status.
   */
  delete: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    id: string
  ): Promise<void> => {
    if (!tenant) {
      throw new Error('Tenant context is required for deleting status');
    }

    try {
      // Check if this is a default status
      const status = await knexOrTrx<IStatus>('statuses')
        .where({
          status_id: id,
          tenant,
          is_default: true
        })
        .first();

      if (status) {
        throw new Error('Cannot delete the default status');
      }

      const result = await knexOrTrx<IStatus>('statuses')
        .where({
          status_id: id,
          tenant
        })
        .del();

      if (result === 0) {
        throw new Error(`Status with id ${id} not found or belongs to different tenant`);
      }
    } catch (error) {
      console.error(`Error deleting status with id ${id}:`, error);
      throw error;
    }
  },

  /**
   * Get ticket statuses for a tenant.
   */
  getTicketStatuses: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IStatus[]> => {
    return Status.getByType(knexOrTrx, tenant, 'ticket');
  },

  /**
   * Get project statuses for a tenant.
   */
  getProjectStatuses: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IStatus[]> => {
    return Status.getByType(knexOrTrx, tenant, 'project');
  },

  /**
   * Get project task statuses for a tenant.
   */
  getProjectTaskStatuses: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IStatus[]> => {
    return Status.getByType(knexOrTrx, tenant, 'project_task');
  },
};

export default Status;
