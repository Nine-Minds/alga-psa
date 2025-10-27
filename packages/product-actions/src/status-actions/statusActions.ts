'use server'

import { createTenantKnex } from '@server/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { IStatus, ItemType } from 'server/src/interfaces/status.interface';

export async function getStatuses(type?: ItemType) {
  try {
    // Get the current user to ensure we have a valid user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('Unauthorized');
    }

    // Get the database connection with tenant
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant not found");
    }

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Build query
      const query = trx<IStatus>('statuses')
        .where({ tenant })
        .select('*')
        .orderBy('order_number');

      // Add type filter if specified
      if (type) {
        query.where({ status_type: type });
      }

      return await query;
    });
  } catch (error) {
    console.error('Error fetching ticket statuses:', error);
    throw error;
  }
}

export async function getTicketStatuses() {
  try {
    // Get the current user to ensure we have a valid user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('Unauthorized');
    }

    // Get the database connection with tenant
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant not found");
    }

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Fetch statuses for the current tenant
      const statuses = await trx<IStatus>('statuses')
        .where({
          tenant,
          status_type: 'ticket' as ItemType
        })
        .select('*')
        .orderBy('order_number');

      return statuses;
    });
  } catch (error) {
    console.error('Error fetching ticket statuses:', error);
    throw error;
  }
}

export async function createStatus(statusData: Omit<IStatus, 'status_id' | 'tenant'>): Promise<IStatus> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  if (!statusData.name || statusData.name.trim() === '') {
    throw new Error('Status name is required');
  }

  const {knex: db, tenant} = await createTenantKnex();
  try {
    if (!tenant) {
      throw new Error("Tenant not found");
    }

    const newStatus = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Check if status with same name already exists
      const existingStatus = await trx('statuses')
        .where({
          tenant,
          name: statusData.name,
          status_type: statusData.status_type
        })
        .first();

      if (existingStatus) {
        throw new Error('A status with this name already exists');
      }

      // Get highest order_number if none specified
      if (!statusData.order_number) {
        const maxOrder = await trx('statuses')
          .where({
            tenant,
            status_type: statusData.status_type
          })
          .max('order_number as max')
          .first();
        
        statusData.order_number = (maxOrder?.max || 0) + 10;
      }

      // Check if we should set as default
      let isDefault = statusData.is_default || false;
      if (isDefault && !statusData.is_closed) {
        // Check if there's already a default status of this type
        const existingDefault = await trx('statuses')
          .where({ 
            tenant, 
            is_default: true,
            status_type: statusData.status_type 
          })
          .first();
        
        if (existingDefault) {
          // Unset the existing default
          await trx('statuses')
            .where({ 
              tenant, 
              is_default: true,
              status_type: statusData.status_type 
            })
            .update({ is_default: false });
        }
      }
      
      // Don't allow closed status to be default
      if (statusData.is_closed && isDefault) {
        isDefault = false;
      }
      
      const [status] = await trx<IStatus>('statuses')
        .insert({
          ...statusData,
          tenant,
          name: statusData.name.trim(),
          is_default: isDefault,
          created_by: user.user_id
        })
        .returning('*');

      return status;
    });

    return newStatus;

  } catch (error) {
    console.error('Error creating status:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to create status');
  }
}

export async function updateStatus(statusId: string, statusData: Partial<IStatus>) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  if (!statusId) {
    throw new Error('Status ID is required');
  }

  if (statusData.name && statusData.name.trim() === '') {
    throw new Error('Status name cannot be empty');
  }

  const {knex: db, tenant} = await createTenantKnex();
  try {
    if (!tenant) {
      throw new Error("Tenant not found");
    }

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Check if new name conflicts with existing status
      if (statusData.name) {
        // Get current status to know its type if no new type provided
        const currentStatus = await trx<IStatus>('statuses')
          .where({
            tenant,
            status_id: statusId
          })
          .first();

        if (!currentStatus) {
          throw new Error('Status not found');
        }

        const existingStatus = await trx('statuses')
          .where({
            tenant,
            name: statusData.name,
            status_type: statusData.status_type || currentStatus.status_type
          })
          .whereNot('status_id', statusId)
          .first();

        if (existingStatus) {
          throw new Error('A status with this name already exists');
        }
      }

      // Extract only updatable fields, excluding tenant
      const {
        name,
        status_type,
        order_number,
        is_closed,
        item_type,
        standard_status_id,
        is_custom,
        is_default
      } = statusData;

      // If setting as default, unset any other default status of the same type
      if (is_default) {
        const currentStatus = await trx<IStatus>('statuses')
          .where({
            tenant,
            status_id: statusId
          })
          .first();

        if (currentStatus) {
          await trx<IStatus>('statuses')
            .where({
              tenant,
              status_type: currentStatus.status_type,
              is_default: true
            })
            .whereNot('status_id', statusId)
            .update({ is_default: false });
        }
      }

      const [updatedStatus] = await trx<IStatus>('statuses')
        .where({
          tenant,
          status_id: statusId
        })
        .update({
          ...(name && { name: name.trim() }),
          ...(status_type && { status_type }),
          ...(order_number && { order_number }),
          ...(is_closed !== undefined && { is_closed }),
          ...(item_type && { item_type }),
          ...(standard_status_id && { standard_status_id }),
          ...(is_custom !== undefined && { is_custom }),
          ...(is_default !== undefined && { is_default })
        })
        .returning('*');

      if (!updatedStatus) {
        throw new Error('Status not found');
      }

      return updatedStatus;
    });
  } catch (error) {
    console.error('Error updating status:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to update status');
  }
}

export interface StatusOption {
  value: string;
  label: string;
  isStandard?: boolean;
}

export async function getWorkItemStatusOptions(itemType?: ItemType | ItemType[]): Promise<StatusOption[]> {
  try {
    const { knex: db, tenant } = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const itemTypesToFetch = itemType 
        ? (Array.isArray(itemType) ? itemType : [itemType]) 
        : ['ticket', 'project_task'];

      const statusesQuery = trx('statuses')
        .where({ tenant: tenant })
        .select('status_id', 'name', 'order_number')
        .orderBy('order_number', 'asc')
        .orderBy('name', 'asc');

      if (itemTypesToFetch.length > 0) {
        statusesQuery.whereIn('status_type', itemTypesToFetch);
      }
      const statuses = await statusesQuery;

      const options: StatusOption[] = [
        { value: 'all_open', label: 'All Open' },
        { value: 'all_closed', label: 'All Closed' },
        ...statuses.map(s => ({
          value: s.status_id,
          label: s.name,
          isStandard: false,
        }))
      ];

      return options;
    });

  } catch (error) {
    console.error('Error fetching work item status options:', error);
    throw new Error('Failed to fetch work item status options');
  }
}

export async function deleteStatus(statusId: string) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  if (!statusId) {
    throw new Error('Status ID is required');
  }

  const {knex: db, tenant} = await createTenantKnex();
  try {
    if (!tenant) {
      throw new Error("Tenant not found");
    }

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get the status to check its type
      const status = await trx<IStatus>('statuses')
        .where({
          tenant,
          status_id: statusId
        })
        .first();

      if (!status) {
        throw new Error('Status not found');
      }

      // Check if status is in use based on its type
      let inUseCount = 0;
      let errorMessage = '';

      if (status.status_type === 'ticket') {
        const ticketsCount = await trx('tickets')
          .where({
            tenant,
            status_id: statusId
          })
          .count('status_id as count')
          .first();
        inUseCount = Number(ticketsCount?.count || 0);
        errorMessage = 'Cannot delete status that is in use by tickets';
      } else if (status.status_type === 'project') {
        const projectsCount = await trx('projects')
          .where({
            tenant,
            status: statusId
          })
          .count('status as count')
          .first();
        inUseCount = Number(projectsCount?.count || 0);
        errorMessage = 'Cannot delete status that is in use by projects';
      } else if (status.status_type === 'project_task') {
        // Check if status is used in project_tasks
        const tasksCount = await trx('project_tasks')
          .where({
            tenant,
            status_id: statusId
          })
          .count('task_id as count')
          .first();
        
        // Check if status is used in project_status_mappings
        const mappingsCount = await trx('project_status_mappings')
          .where({
            tenant,
            status_id: statusId
          })
          .count('project_status_mapping_id as count')
          .first();

        inUseCount = Number(tasksCount?.count || 0) + Number(mappingsCount?.count || 0);
        errorMessage = 'Cannot delete status that is in use by project tasks or status mappings';
      } else if (status.status_type === 'interaction') {
        const interactionsCount = await trx('interactions')
          .where({
            tenant,
            status_id: statusId
          })
          .count('interaction_id as count')
          .first();
        inUseCount = Number(interactionsCount?.count || 0);
        errorMessage = 'Cannot delete status that is in use by interactions';
      }

      if (inUseCount > 0) {
        throw new Error(errorMessage);
      }

      await trx('statuses')
        .where({
          tenant,
          status_id: statusId
        })
        .del();
      return true;
    });
  } catch (error) {
    console.error('Error deleting status:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to delete status');
  }
}

export interface FindStatusByNameInput {
  name: string;
  item_type: string; // 'ticket', 'project', etc.
}

export interface FindStatusByNameOutput {
  id: string;
  name: string;
  item_type: string;
  is_closed: boolean;
  is_default: boolean;
}

/**
 * Find status by name and item type
 * This action searches for existing statuses by name and type
 */
export async function findStatusByName(input: FindStatusByNameInput): Promise<FindStatusByNameOutput | null> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const status = await trx('statuses')
      .select('status_id as id', 'name', 'item_type', 'is_closed', 'is_default')
      .where('tenant', tenant)
      .whereRaw('LOWER(name) = LOWER(?)', [input.name])
      .where('item_type', input.item_type)
      .first();

    return status || null;
  });
}
