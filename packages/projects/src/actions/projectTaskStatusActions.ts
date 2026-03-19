'use server';

import { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IProjectStatusMapping, IStatus } from '@alga-psa/types';

import { getScopedProjectStatusMappings, ProjectStatusMappingDetails } from '../lib/projectStatusMappingUtils';

function resolveReplacementStatusMapping(
  sourceMapping: ProjectStatusMappingDetails,
  targetMappings: ProjectStatusMappingDetails[]
): ProjectStatusMappingDetails | null {
  const sourceName = sourceMapping.name ?? sourceMapping.status_name ?? null;

  if (sourceName) {
    const sameNameTarget = targetMappings.find((mapping) => {
      const targetName = mapping.name ?? mapping.status_name ?? null;
      return targetName === sourceName;
    });

    if (sameNameTarget) {
      return sameNameTarget;
    }
  }

  const sameClosedStateTarget = targetMappings.find(
    (mapping) => Boolean(mapping.is_closed) === Boolean(sourceMapping.is_closed)
  );

  return sameClosedStateTarget ?? targetMappings[0] ?? null;
}

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
  },
  phaseId?: string | null
): Promise<IProjectStatusMapping> => {
  // RBAC check
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: Cannot update project');
  }

  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    // Get next display_order
    const maxOrderQuery = trx('project_status_mappings')
      .where({ project_id: projectId, tenant });

    if (phaseId) {
      maxOrderQuery.andWhere('phase_id', phaseId);
    } else {
      maxOrderQuery.whereNull('phase_id');
    }

    const maxOrder = await maxOrderQuery
      .max('display_order as max')
      .first();

    const displayOrder = (maxOrder?.max ?? 0) + 1;

    const [mapping] = await trx('project_status_mappings')
      .insert({
        tenant,
        project_id: projectId,
        phase_id: phaseId ?? null,
        status_id: statusData.status_id,
        standard_status_id: statusData.standard_status_id,
        is_standard: !!statusData.standard_status_id,
        custom_name: statusData.custom_name,
        display_order: displayOrder,
        is_visible: statusData.is_visible ?? true
      })
      .returning('*');

    return mapping;
  });
});

/**
 * Get all status mappings for a project
 */
export const getProjectStatusMappings = withAuth(async (
  _user,
  { tenant },
  projectId: string,
  phaseId?: string | null
): Promise<IProjectStatusMapping[]> => {
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    return await getScopedProjectStatusMappings(trx, tenant, projectId, phaseId);
  });
});

/**
 * Copy project default statuses into a phase as custom mappings.
 */
export const copyProjectStatusesToPhase = withAuth(async (
  user,
  { tenant },
  projectId: string,
  phaseId: string
): Promise<IProjectStatusMapping[]> => {
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: Cannot update project');
  }

  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    const phase = await trx('project_phases')
      .where({ tenant, project_id: projectId, phase_id: phaseId })
      .first();

    if (!phase) {
      throw new Error('Project phase not found');
    }

    const existingPhaseMappings = await trx('project_status_mappings')
      .where({ tenant, project_id: projectId, phase_id: phaseId })
      .orderBy('display_order');

    if (existingPhaseMappings.length > 0) {
      return existingPhaseMappings;
    }

    const defaultMappings = await trx('project_status_mappings')
      .where({ tenant, project_id: projectId })
      .whereNull('phase_id')
      .orderBy('display_order');

    if (defaultMappings.length === 0) {
      return [];
    }

    const inserts = defaultMappings.map((mapping) => ({
      tenant,
      project_id: projectId,
      phase_id: phaseId,
      status_id: mapping.status_id,
      standard_status_id: mapping.standard_status_id,
      is_standard: mapping.is_standard,
      custom_name: mapping.custom_name,
      display_order: mapping.display_order,
      is_visible: mapping.is_visible
    }));

    return await trx('project_status_mappings')
      .insert(inserts)
      .returning('*');
  });
});

/**
 * Remove all custom statuses for a phase and revert it to project defaults.
 */
export const removePhaseStatuses = withAuth(async (
  user,
  { tenant },
  phaseId: string
): Promise<void> => {
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: Cannot update project');
  }

  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    const phase = await trx('project_phases')
      .where({ tenant, phase_id: phaseId })
      .first();

    if (!phase) {
      throw new Error('Project phase not found');
    }

    const phaseMappings = await getScopedProjectStatusMappings(trx, tenant, phase.project_id, phaseId);
    if (phaseMappings.length === 0) {
      return;
    }

    const defaultMappings = await getScopedProjectStatusMappings(trx, tenant, phase.project_id);
    if (defaultMappings.length === 0) {
      throw new Error('Cannot remove phase statuses without project default statuses');
    }

    // Group phase mappings by their replacement target to batch updates
    const updatesByReplacement = new Map<string, string[]>();
    for (const phaseMapping of phaseMappings) {
      const replacementMapping = resolveReplacementStatusMapping(phaseMapping, defaultMappings);

      if (!replacementMapping) {
        throw new Error('Unable to resolve replacement status mapping for phase task');
      }

      const existing = updatesByReplacement.get(replacementMapping.project_status_mapping_id) || [];
      existing.push(phaseMapping.project_status_mapping_id);
      updatesByReplacement.set(replacementMapping.project_status_mapping_id, existing);
    }

    // Batch update: one UPDATE per replacement target
    for (const [replacementId, oldIds] of updatesByReplacement) {
      await trx('project_tasks')
        .where({ tenant, phase_id: phaseId })
        .whereIn('project_status_mapping_id', oldIds)
        .update({ project_status_mapping_id: replacementId });
    }

    await trx('project_status_mappings')
      .where({ tenant, phase_id: phaseId })
      .del();
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

  const existingMapping = await knex('project_status_mappings')
    .where({ project_status_mapping_id: mappingId, tenant })
    .first();

  if (!existingMapping) {
    throw new Error('Status mapping not found');
  }

  await knex('project_status_mappings')
    .where({ project_status_mapping_id: mappingId, tenant })
    .update(updates);

});

/**
 * Get the number of tasks assigned to a status mapping.
 */
export const getStatusMappingTaskCount = withAuth(async (
  _user,
  { tenant },
  mappingId: string
): Promise<number> => {
  const { knex } = await createTenantKnex();
  const result = await knex('project_tasks')
    .where({ project_status_mapping_id: mappingId, tenant })
    .count('* as count')
    .first();
  return parseInt(result?.count as string) || 0;
});

/**
 * Delete a project status mapping, optionally moving tasks to another status first.
 */
export const deleteProjectStatusMapping = withAuth(async (
  user,
  { tenant },
  mappingId: string,
  moveTasksToMappingId?: string
): Promise<void> => {
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: Cannot update project');
  }

  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    const mapping = await trx('project_status_mappings')
      .where({ project_status_mapping_id: mappingId, tenant })
      .first();

    if (!mapping) {
      throw new Error('Status mapping not found');
    }

    // Move tasks if a target mapping is provided
    if (moveTasksToMappingId) {
      await trx('project_tasks')
        .where({ project_status_mapping_id: mappingId, tenant })
        .update({ project_status_mapping_id: moveTasksToMappingId });
    } else {
      // Check for orphaned tasks
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
    }

    // Validate: Must have at least 1 status remaining in the same scope
    const remainingQuery = trx('project_status_mappings')
      .where({ project_id: mapping.project_id, tenant })
      .whereNot({ project_status_mapping_id: mappingId });

    if (mapping.phase_id) {
      remainingQuery.where({ phase_id: mapping.phase_id });
    } else {
      remainingQuery.whereNull('phase_id');
    }

    const remainingCount = await remainingQuery.count('* as count').first();

    if (parseInt(remainingCount?.count as string) < 1) {
      throw new Error('Cannot delete the last status in a project');
    }

    await trx('project_status_mappings')
      .where({ project_status_mapping_id: mappingId, tenant })
      .del();
  });
});

/**
 * Reorder project statuses
 */
export const reorderProjectStatuses = withAuth(async (
  user,
  { tenant },
  projectId: string,
  statusOrder: Array<{ mapping_id: string; display_order: number }>,
  phaseId?: string | null
): Promise<void> => {
  // RBAC check
  if (!await hasPermission(user, 'project', 'update')) {
    throw new Error('Permission denied: Cannot update project');
  }

  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    for (const { mapping_id, display_order } of statusOrder) {
      const query = trx('project_status_mappings')
        .where({
          project_status_mapping_id: mapping_id,
          project_id: projectId,
          tenant
        });

      if (phaseId) {
        query.andWhere('phase_id', phaseId);
      } else {
        query.whereNull('phase_id');
      }

      await query.update({ display_order });
    }

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
