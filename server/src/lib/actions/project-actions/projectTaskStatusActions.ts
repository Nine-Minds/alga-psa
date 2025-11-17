'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { withTransaction } from '@shared/db';
import { IProjectStatusMapping } from 'server/src/interfaces/project.interfaces';
import { IStatus } from 'server/src/interfaces/status.interface';
import { publishEvent } from 'server/src/lib/eventBus/publishers';

/**
 * Add a status to a project
 */
export async function addStatusToProject(
  projectId: string,
  statusData: {
    status_id?: string;  // From tenant library
    standard_status_id?: string;  // Standard status
    custom_name?: string;  // Override name
    is_visible?: boolean;
  }
): Promise<IProjectStatusMapping> {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('User tenant not found');
  }
  const tenant = currentUser.tenant;
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
}

/**
 * Get all status mappings for a project
 */
export async function getProjectStatusMappings(
  projectId: string
): Promise<IProjectStatusMapping[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('User tenant not found');
  }
  const tenant = currentUser.tenant;
  const { knex } = await createTenantKnex();

  return await knex('project_status_mappings as psm')
    .where({ 'psm.project_id': projectId, 'psm.tenant': tenant })
    .leftJoin('statuses as s', function(this: any) {
      this.on('psm.status_id', 's.status_id')
        .andOn('psm.tenant', 's.tenant');
    })
    .leftJoin('standard_statuses as ss', function(this: any) {
      this.on('psm.standard_status_id', 'ss.standard_status_id')
        .andOn('psm.tenant', 'ss.tenant');
    })
    .select(
      'psm.*',
      knex.raw('COALESCE(psm.custom_name, s.name, ss.name) as status_name'),
      knex.raw('COALESCE(psm.custom_name, s.name, ss.name) as name'),
      knex.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed')
    )
    .orderBy('psm.display_order');
}

/**
 * Update a project status mapping
 */
export async function updateProjectStatusMapping(
  mappingId: string,
  updates: {
    custom_name?: string;
    display_order?: number;
    is_visible?: boolean;
  }
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('User tenant not found');
  }
  const tenant = currentUser.tenant;
  const { knex } = await createTenantKnex();

  await knex('project_status_mappings')
    .where({ project_status_mapping_id: mappingId, tenant })
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    });

  // Publish event
  await publishEvent({
    eventType: 'PROJECT_STATUS_UPDATED',
    payload: {
      tenantId: tenant,
      mappingId,
      updates
    }
  });
}

/**
 * Delete a project status mapping
 */
export async function deleteProjectStatusMapping(
  mappingId: string
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('User tenant not found');
  }
  const tenant = currentUser.tenant;
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
}

/**
 * Reorder project statuses
 */
export async function reorderProjectStatuses(
  projectId: string,
  statusOrder: Array<{ mapping_id: string; display_order: number }>
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('User tenant not found');
  }
  const tenant = currentUser.tenant;
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
}

/**
 * Get tenant's project task status library
 */
export async function getTenantProjectStatuses(): Promise<IStatus[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('User tenant not found');
  }
  const tenant = currentUser.tenant;
  const { knex } = await createTenantKnex();

  return await knex('statuses')
    .where({ tenant, item_type: 'project_task' })
    .orderBy('order_number');
}

/**
 * Create a new status in tenant's library
 */
export async function createTenantProjectStatus(
  statusData: { name: string; is_closed: boolean; color?: string; icon?: string }
): Promise<IStatus> {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('User tenant not found');
  }
  const tenant = currentUser.tenant;
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
        icon: statusData.icon
      })
      .returning('*');

    // Publish event
    await publishEvent({
      eventType: 'TENANT_STATUS_CREATED',
      payload: {
        tenantId: tenant,
        statusId: status.status_id,
        itemType: 'project_task'
      }
    });

    return status;
    // Advisory lock automatically released at transaction end
  });
}

/**
 * Update a status in tenant's library
 */
export async function updateTenantProjectStatus(
  statusId: string,
  updates: { name?: string; is_closed?: boolean; color?: string; icon?: string }
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('User tenant not found');
  }
  const tenant = currentUser.tenant;
  const { knex } = await createTenantKnex();

  await knex('statuses')
    .where({ status_id: statusId, tenant, item_type: 'project_task' })
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    });

  // Publish event
  await publishEvent({
    eventType: 'TENANT_STATUS_UPDATED',
    payload: {
      tenantId: tenant,
      statusId,
      updates
    }
  });
}

/**
 * Delete a status from tenant's library
 */
export async function deleteTenantProjectStatus(
  statusId: string
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('User tenant not found');
  }
  const tenant = currentUser.tenant;
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
      .where({ status_id: statusId, tenant, item_type: 'project_task' })
      .del();

    // Publish event
    await publishEvent({
      eventType: 'TENANT_STATUS_DELETED',
      payload: {
        tenantId: tenant,
        statusId
      }
    });
  });
}

/**
 * Reorder tenant's project task statuses
 */
export async function reorderTenantProjectStatuses(
  statusOrder: Array<{ status_id: string; order_number: number }>
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('User tenant not found');
  }
  const tenant = currentUser.tenant;
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    for (const { status_id, order_number } of statusOrder) {
      await trx('statuses')
        .where({
          status_id,
          tenant,
          item_type: 'project_task'
        })
        .update({ order_number });
    }

    // Publish event
    await publishEvent({
      eventType: 'TENANT_STATUSES_REORDERED',
      payload: {
        tenantId: tenant,
        statusOrder
      }
    });
  });
}
