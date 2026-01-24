'use server';

import { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IProjectStatusMapping, IStatus } from '@alga-psa/types';
import { publishEvent } from '@alga-psa/event-bus/publishers';

/**
 * Add a status to a project
 */
export const addStatusToProject = withAuth(async (
  user,
  { tenant },
  projectId: string,
  statusData: {
    status_id?: string;  // From tenant library
    standard_status_id?: string;  // Standard status
    custom_name?: string;  // Override name
    is_visible?: boolean;
  }
): Promise<IProjectStatusMapping> => {
  // RBAC check
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: Cannot update project');
  }

  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    // Get next display_order
    const maxOrder = await trx('project_status_mappings')
      .where({ project_id: projectId, tenant })
      .max('display_order as max')
      .first();

    const displayOrder = (maxOrder?.max ?? 0) + 1;

    const [mapping] = await trx('project_status_mappings')
      .insert({
        tenant,
        project_id: projectId,
        status_id: statusData.status_id,
        standard_status_id: statusData.standard_status_id,
        is_standard: !!statusData.standard_status_id,
        custom_name: statusData.custom_name,
        display_order: displayOrder,
        is_visible: statusData.is_visible ?? true
      })
      .returning('*');

    // Publish event
    await publishEvent({
      eventType: 'PROJECT_STATUS_ADDED',
      payload: {
        tenantId: tenant,
        projectId,
        mappingId: mapping.project_status_mapping_id
      }
    });

    return mapping;
  });
});

/**
 * Get all status mappings for a project
 */
export const getProjectStatusMappings = withAuth(async (
  _user,
  { tenant },
  projectId: string
): Promise<IProjectStatusMapping[]> => {
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    return await trx('project_status_mappings as psm')
      .where({ 'psm.project_id': projectId, 'psm.tenant': tenant })
      .leftJoin('statuses as s', function(this: Knex.JoinClause) {
        this.on('psm.status_id', 's.status_id')
          .andOn('psm.tenant', 's.tenant');
      })
      .leftJoin('standard_statuses as ss', function(this: Knex.JoinClause) {
        this.on('psm.standard_status_id', 'ss.standard_status_id')
          .andOn('psm.tenant', 'ss.tenant');
      })
      .select(
        'psm.*',
        trx.raw('COALESCE(psm.custom_name, s.name, ss.name) as status_name'),
        trx.raw('COALESCE(psm.custom_name, s.name, ss.name) as name'),
        trx.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed')
      )
      .orderBy('psm.display_order');
  });
});

/**
 * Update a project status mapping
 */
export const updateProjectStatusMapping = withAuth(async (
  user,
  { tenant },
  mappingId: string,
  updates: {
    custom_name?: string;
    display_order?: number;
    is_visible?: boolean;
  }
): Promise<void> => {
  // RBAC check
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: Cannot update project');
  }

  const { knex } = await createTenantKnex();

  await knex('project_status_mappings')
    .where({ project_status_mapping_id: mappingId, tenant })
    .update(updates);

  // Publish event
  await publishEvent({
    eventType: 'PROJECT_STATUS_UPDATED',
    payload: {
      tenantId: tenant,
      mappingId,
      updates
    }
  });
});

/**
 * Delete a project status mapping
 */
export const deleteProjectStatusMapping = withAuth(async (
  user,
  { tenant },
  mappingId: string
): Promise<void> => {
  // RBAC check
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: Cannot update project');
  }

  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    // Get mapping info
    const mapping = await trx('project_status_mappings')
      .where({ project_status_mapping_id: mappingId, tenant })
      .first();

    if (!mapping) {
      throw new Error('Status mapping not found');
    }

    // Validate: Check if any tasks assigned to this status
    const taskCount = await trx('project_tasks')
      .where({ project_status_mapping_id: mappingId, tenant })
      .count('* as count')
      .first();

    if (parseInt(taskCount?.count as string) > 0) {
      throw new Error(
        `Cannot delete status with ${taskCount?.count} assigned tasks. ` +
        `Please move tasks to another status first.`
      );
    }

    // Validate: Must have at least 1 status remaining
    const remainingCount = await trx('project_status_mappings')
      .where({ project_id: mapping.project_id, tenant })
      .count('* as count')
      .first();

    if (parseInt(remainingCount?.count as string) <= 1) {
      throw new Error('Cannot delete the last status in a project');
    }

    // Delete
    await trx('project_status_mappings')
      .where({ project_status_mapping_id: mappingId, tenant })
      .del();

    // Publish event
    await publishEvent({
      eventType: 'PROJECT_STATUS_DELETED',
      payload: {
        tenantId: tenant,
        projectId: mapping.project_id,
        mappingId
      }
    });
  });
});

/**
 * Reorder project statuses
 */
export const reorderProjectStatuses = withAuth(async (
  user,
  { tenant },
  projectId: string,
  statusOrder: Array<{ mapping_id: string; display_order: number }>
): Promise<void> => {
  // RBAC check
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: Cannot update project');
  }

  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    for (const { mapping_id, display_order } of statusOrder) {
      await trx('project_status_mappings')
        .where({
          project_status_mapping_id: mapping_id,
          project_id: projectId,
          tenant
        })
        .update({ display_order });
    }

    // Publish event
    await publishEvent({
      eventType: 'PROJECT_STATUSES_REORDERED',
      payload: {
        tenantId: tenant,
        projectId,
        statusOrder
      }
    });
  });
});

/**
 * Get tenant's project task status library
 * Returns statuses from the 'statuses' table (new system) if available,
 * otherwise falls back to 'standard_statuses' table (old system)
 */
export const getTenantProjectStatuses = withAuth(async (
  _user,
  { tenant }
): Promise<IStatus[]> => {
  const { knex } = await createTenantKnex();

  // First try the new statuses table
  const regularStatuses = await knex('statuses')
    .where({ tenant, status_type: 'project_task' })
    .orderBy('order_number');

  console.log(`[getTenantProjectStatuses] Found ${regularStatuses.length} statuses in 'statuses' table for tenant ${tenant}`);

  if (regularStatuses.length > 0) {
    return regularStatuses;
  }

  // Fall back to standard_statuses table (old system)
  const standardStatuses = await knex('standard_statuses')
    .where({ tenant, item_type: 'project_task' })
    .orderBy('display_order');

  console.log(`[getTenantProjectStatuses] Found ${standardStatuses.length} statuses in 'standard_statuses' table for tenant ${tenant}`);

  // Map standard_statuses to IStatus format for compatibility
  return standardStatuses.map((s: any) => ({
    status_id: s.standard_status_id,
    tenant: s.tenant,
    name: s.name,
    status_type: 'project_task',
    item_type: 'project_task',
    is_closed: s.is_closed,
    order_number: s.display_order,
    color: null, // Standard statuses don't have colors
    icon: null,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }));
});

/**
 * Create a new status in tenant's library
 */
export const createTenantProjectStatus = withAuth(async (
  user,
  { tenant },
  statusData: { name: string; is_closed: boolean; color?: string; icon?: string }
): Promise<IStatus> => {
  // RBAC check
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: Cannot update project');
  }

  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    // Use advisory lock to serialize status creation for this tenant/type combination
    // Create a hash from tenant + item_type + status_type for the lock key
    const lockKey = `${tenant}:project_task:project_task`;

    // Create a stable 32-bit integer hash
    let hash = 0;
    for (let i = 0; i < lockKey.length; i++) {
      const char = lockKey.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    const lockHash = Math.abs(hash) % 2147483647; // Ensure it fits in PostgreSQL integer range

    console.log(`[DEBUG] Acquiring advisory lock ${lockHash} for ${lockKey}`);

    // Acquire advisory lock
    await trx.raw('SELECT pg_advisory_xact_lock(?)', [lockHash]);

    console.log(`[DEBUG] Lock acquired, calculating order_number`);

    // Get next order number - filter by status_type since that's what the constraint uses
    const maxOrder = await trx('statuses')
      .where({ tenant, status_type: 'project_task' })
      .max('order_number as max')
      .first();

    const orderNumber = (maxOrder?.max ?? 0) + 1;

    console.log(`[DEBUG] Max order: ${maxOrder?.max}, Next order: ${orderNumber}`);

    const [status] = await trx('statuses')
      .insert({
        tenant,
        item_type: 'project_task',
        status_type: 'project_task',
        name: statusData.name,
        is_closed: statusData.is_closed,
        order_number: orderNumber,
        color: statusData.color,
        icon: statusData.icon,
        created_at: new Date().toISOString()
      })
      .returning('*');

    return status;
    // Advisory lock automatically released at transaction end
  });
});

/**
 * Update a status in tenant's library
 */
export const updateTenantProjectStatus = withAuth(async (
  user,
  { tenant },
  statusId: string,
  updates: { name?: string; is_closed?: boolean; color?: string; icon?: string }
): Promise<void> => {
  // RBAC check
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: Cannot update project');
  }

  const { knex } = await createTenantKnex();

  await knex('statuses')
    .where({ status_id: statusId, tenant, status_type: 'project_task' })
    .update(updates);
});

/**
 * Delete a status from tenant's library
 */
export const deleteTenantProjectStatus = withAuth(async (
  user,
  { tenant },
  statusId: string
): Promise<void> => {
  // RBAC check
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: Cannot update project');
  }

  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    // Check if any projects are using this status
    const usageCount = await trx('project_status_mappings')
      .where({ status_id: statusId, tenant })
      .count('* as count')
      .first();

    if (parseInt(usageCount?.count as string) > 0) {
      throw new Error(
        `Cannot delete status that is used by ${usageCount?.count} projects. ` +
        `Please remove it from those projects first.`
      );
    }

    // Delete the status
    await trx('statuses')
      .where({ status_id: statusId, tenant, status_type: 'project_task' })
      .del();
  });
});

/**
 * Reorder tenant's project task statuses
 */
export const reorderTenantProjectStatuses = withAuth(async (
  user,
  { tenant },
  statusOrder: Array<{ status_id: string; order_number: number }>
): Promise<void> => {
  // RBAC check
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: Cannot update project');
  }

  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    for (const { status_id, order_number } of statusOrder) {
      await trx('statuses')
        .where({
          status_id,
          tenant,
          status_type: 'project_task'
        })
        .update({ order_number });
    }
  });
});
