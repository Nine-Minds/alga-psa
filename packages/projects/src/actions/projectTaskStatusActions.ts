'use server';

import { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { DeletionValidationResult, IProjectStatusMapping, IStatus } from '@alga-psa/types';
import type { IUserWithRoles } from '@alga-psa/types';
import ProjectModel from '@alga-psa/projects/models/project';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
  type AuthorizationSubject,
} from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

import { getScopedProjectStatusMappings, ProjectStatusMappingDetails } from '../lib/projectStatusMappingUtils';

export type ProjectTaskStatusActionError = ActionMessageError | ActionPermissionError;

const EXPECTED_PROJECT_TASK_STATUS_ERROR_PREFIXES = [
  'Cannot delete the last status in a project',
  'Cannot delete status with',
  'Cannot delete status',
  'Cannot remove phase statuses without project default statuses',
  'Phase task status removal could not resolve a replacement status mapping',
  'Project not found',
  'Project phase not found',
  'Project task status not found',
  'Status mapping not found',
  'Unable to resolve replacement status mapping for phase task',
];

function projectTaskStatusActionErrorFrom(error: unknown): ProjectTaskStatusActionError | null {
  if (error instanceof Error) {
    if (error.message.includes('Permission denied')) {
      return permissionError(error.message);
    }
    if (EXPECTED_PROJECT_TASK_STATUS_ERROR_PREFIXES.some((message) => error.message.startsWith(message))) {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected status values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required status field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected project statuses no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('A project task status with these settings already exists.');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the status values is not allowed. Please review the form and try again.');
  }

  return null;
}

type ProjectStatusUsage = {
  count: number;
  projectNames: string[];
};

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

function formatProjectUsageDescription(projectNames: string[], count: number): string {
  const visibleNames = projectNames.slice(0, 5);
  const remainingCount = count - visibleNames.length;
  const suffix = remainingCount > 0 ? ` and ${remainingCount} more` : '';

  return `Projects: ${visibleNames.join(', ')}${suffix}`;
}

async function getTenantProjectStatusUsage(
  trx: Knex.Transaction,
  tenant: string,
  statusId: string
): Promise<ProjectStatusUsage> {
  const usageQuery = tenantScopedTable(trx, 'project_status_mappings as psm', tenant);
  tenantDb(trx, tenant).tenantJoin(usageQuery, 'projects as p', 'psm.project_id', 'p.project_id', { type: 'left' });
  const rows = await usageQuery
    .where({ 'psm.status_id': statusId })
    .distinct<{ project_id: string; project_name: string | null }[]>(
      'psm.project_id as project_id',
      'p.project_name as project_name'
    )
    .orderBy('p.project_name');

  return {
    count: rows.length,
    projectNames: rows.map((row) => row.project_name || `Unknown project (${row.project_id})`)
  };
}

async function buildTenantProjectStatusDeletionValidation(
  trx: Knex.Transaction,
  tenant: string,
  statusId: string
): Promise<DeletionValidationResult> {
  const status = await tenantScopedTable(trx, 'statuses', tenant)
    .where({ status_id: statusId, status_type: 'project_task' })
    .first<{ status_id: string; name: string }>('status_id', 'name');

  if (!status) {
    return {
      canDelete: false,
      code: 'NOT_FOUND',
      message: 'Project task status not found.',
      dependencies: [],
      alternatives: []
    };
  }

  const usage = await getTenantProjectStatusUsage(trx, tenant, statusId);
  if (usage.count > 0) {
    const projectLabel = usage.count === 1 ? 'project' : 'projects';

    return {
      canDelete: false,
      code: 'DEPENDENCIES_EXIST',
      message: `Cannot delete status "${status.name}" because it is used by ${usage.count} ${projectLabel}.`,
      dependencies: [{
        type: 'project',
        count: usage.count,
        label: projectLabel,
        description: formatProjectUsageDescription(usage.projectNames, usage.count)
      }],
      alternatives: []
    };
  }

  return {
    canDelete: true,
    dependencies: [],
    alternatives: []
  };
}

function extractRoleIdsFromUser(user: IUserWithRoles): string[] {
  if (!Array.isArray(user.roles)) {
    return [];
  }

  return user.roles
    .map((role) => {
      if (typeof role === 'string') {
        return role;
      }
      return typeof role?.role_id === 'string' ? role.role_id : null;
    })
    .filter((value): value is string => Boolean(value));
}

async function resolveAuthorizationSubjectForUser(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles
): Promise<AuthorizationSubject> {
  let roleIds = extractRoleIdsFromUser(user);
  if (roleIds.length === 0) {
    try {
      const roleRows = await tenantScopedTable(trx, 'user_roles', tenant)
        .where({ user_id: user.user_id })
        .select<{ role_id: string }[]>('role_id');
      roleIds = roleRows.map((row) => row.role_id);
    } catch {
      roleIds = [];
    }
  }

  const [teamRows, managedRows] = await Promise.all([
    tenantScopedTable(trx, 'team_members', tenant).where({ user_id: user.user_id }).select<{ team_id: string }[]>('team_id').catch(() => []),
    tenantScopedTable(trx, 'users', tenant).where({ reports_to: user.user_id }).select<{ user_id: string }[]>('user_id').catch(() => []),
  ]);

  return {
    tenant,
    userId: user.user_id,
    userType: user.user_type,
    roleIds,
    teamIds: teamRows.map((row) => row.team_id),
    managedUserIds: managedRows.map((row) => row.user_id),
    clientId: user.clientId ?? null,
    portfolioClientIds: user.clientId ? [user.clientId] : [],
  };
}

function toProjectAuthorizationRecord(project: {
  project_id?: string | null;
  client_id?: string | null;
  assigned_to?: string | null;
}): AuthorizationRecord {
  const assignedUserIds =
    typeof project.assigned_to === 'string' && project.assigned_to.length > 0 ? [project.assigned_to] : [];

  return {
    id: project.project_id ?? null,
    ownerUserId: project.assigned_to ?? null,
    assignedUserIds,
    clientId: project.client_id ?? null,
  };
}

async function assertProjectReadAllowed(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  projectId: string
): Promise<void> {
  const project = await ProjectModel.getById(trx, tenant, projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const subject = await resolveAuthorizationSubjectForUser(trx, tenant, user);
  const authorizationKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => {
        try {
          return await resolveBundleNarrowingRulesForEvaluation(trx, input);
        } catch {
          return [];
        }
      },
    }),
    rbacEvaluator: async () => true,
  });
  const requestCache = new RequestLocalAuthorizationCache();

  const decision = await authorizationKernel.authorizeResource({
    subject,
    resource: { type: 'project', action: 'read', id: projectId },
    record: toProjectAuthorizationRecord(project),
    requestCache,
    knex: trx,
  });

  if (!decision.allowed) {
    throw new Error('Permission denied: Cannot read project');
  }
}

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
): Promise<IProjectStatusMapping | ProjectTaskStatusActionError> => {
  try {
    // RBAC check
    if (!await hasPermission(user, 'project', 'update')) {
      throw new Error('Permission denied: Cannot update project');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);

    // Get next display_order
    const maxOrderQuery = tenantScopedTable(trx, 'project_status_mappings', tenant)
      .where({ project_id: projectId });

    if (phaseId) {
      maxOrderQuery.andWhere('phase_id', phaseId);
    } else {
      maxOrderQuery.whereNull('phase_id');
    }

    const maxOrder = await maxOrderQuery
      .max('display_order as max')
      .first();

    const displayOrder = (maxOrder?.max ?? 0) + 1;

    const [mapping] = await tenantScopedTable(trx, 'project_status_mappings', tenant)
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
  } catch (error) {
    const expected = projectTaskStatusActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Get all status mappings for a project
 */
export const getProjectStatusMappings = withAuth(async (
  user,
  { tenant },
  projectId: string,
  phaseId?: string | null
): Promise<IProjectStatusMapping[]> => {
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    if (!await hasPermission(user, 'project', 'read', trx)) {
      throw new Error('Permission denied: Cannot read project');
    }
    await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);
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
): Promise<IProjectStatusMapping[] | ProjectTaskStatusActionError> => {
  try {
    if (!await hasPermission(user, 'project', 'update')) {
      throw new Error('Permission denied: Cannot update project');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);

    const phase = await tenantScopedTable(trx, 'project_phases', tenant)
      .where({ project_id: projectId, phase_id: phaseId })
      .first();

    if (!phase) {
      throw new Error('Project phase not found');
    }

    const existingPhaseMappings = await tenantScopedTable(trx, 'project_status_mappings', tenant)
      .where({ project_id: projectId, phase_id: phaseId })
      .orderBy('display_order') as IProjectStatusMapping[];

    if (existingPhaseMappings.length > 0) {
      return existingPhaseMappings;
    }

    const defaultMappings = await tenantScopedTable(trx, 'project_status_mappings', tenant)
      .where({ project_id: projectId })
      .whereNull('phase_id')
      .orderBy('display_order') as IProjectStatusMapping[];

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

    const newMappings: IProjectStatusMapping[] = await tenantScopedTable(trx, 'project_status_mappings', tenant)
      .insert(inserts)
      .returning('*');

    // Reassign existing tasks from project-default mappings to the new phase-specific ones
    // Group by new phase mapping so we can batch with whereIn, matching removePhaseStatuses style
    const updatesByReplacement = new Map<string, string[]>();
    for (const defaultMapping of defaultMappings) {
      const phaseMapping = newMappings.find((m) => m.status_id === defaultMapping.status_id);
      if (phaseMapping) {
        const existing = updatesByReplacement.get(phaseMapping.project_status_mapping_id) || [];
        existing.push(defaultMapping.project_status_mapping_id);
        updatesByReplacement.set(phaseMapping.project_status_mapping_id, existing);
      }
    }

    for (const [newId, oldIds] of updatesByReplacement) {
      await tenantScopedTable(trx, 'project_tasks', tenant)
        .where({ phase_id: phaseId })
        .whereIn('project_status_mapping_id', oldIds)
        .update({ project_status_mapping_id: newId });
    }

      return newMappings;
    });
  } catch (error) {
    const expected = projectTaskStatusActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Remove all custom statuses for a phase and revert it to project defaults.
 */
export const removePhaseStatuses = withAuth(async (
  user,
  { tenant },
  phaseId: string
): Promise<void | ProjectTaskStatusActionError> => {
  try {
    if (!await hasPermission(user, 'project', 'update')) {
      throw new Error('Permission denied: Cannot update project');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      const phase = await tenantScopedTable(trx, 'project_phases', tenant)
      .where({ phase_id: phaseId })
      .first();

    if (!phase) {
      throw new Error('Project phase not found');
    }
    await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, phase.project_id);

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
        throw new Error('Phase task status removal could not resolve a replacement status mapping.');
      }

      const existing = updatesByReplacement.get(replacementMapping.project_status_mapping_id) || [];
      existing.push(phaseMapping.project_status_mapping_id);
      updatesByReplacement.set(replacementMapping.project_status_mapping_id, existing);
    }

    // Batch update: one UPDATE per replacement target
    for (const [replacementId, oldIds] of updatesByReplacement) {
      await tenantScopedTable(trx, 'project_tasks', tenant)
        .where({ phase_id: phaseId })
        .whereIn('project_status_mapping_id', oldIds)
        .update({ project_status_mapping_id: replacementId });
    }

      await tenantScopedTable(trx, 'project_status_mappings', tenant)
        .where({ phase_id: phaseId })
        .del();
    });
  } catch (error) {
    const expected = projectTaskStatusActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
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
): Promise<void | ProjectTaskStatusActionError> => {
  try {
    // RBAC check
    if (!await hasPermission(user, 'project', 'update')) {
      throw new Error('Permission denied: Cannot update project');
    }

    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx) => {
      const existingMapping = await tenantScopedTable(trx, 'project_status_mappings', tenant)
      .where({ project_status_mapping_id: mappingId })
      .first();

    if (!existingMapping) {
      throw new Error('Status mapping not found');
    }

    await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, existingMapping.project_id);

      await tenantScopedTable(trx, 'project_status_mappings', tenant)
        .where({ project_status_mapping_id: mappingId })
        .update(updates);
    });
  } catch (error) {
    const expected = projectTaskStatusActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Get the number of tasks assigned to a status mapping.
 */
export const getStatusMappingTaskCount = withAuth(async (
  user,
  { tenant },
  mappingId: string
): Promise<number | ProjectTaskStatusActionError> => {
  try {
    const { knex } = await createTenantKnex();
    if (!await hasPermission(user, 'project', 'read', knex)) {
      throw new Error('Permission denied: Cannot read project');
    }

    await withTransaction(knex, async (trx) => {
      const mapping = await tenantScopedTable(trx, 'project_status_mappings', tenant)
        .where({ project_status_mapping_id: mappingId })
        .first();

      if (!mapping) {
        throw new Error('Status mapping not found');
      }
      await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, mapping.project_id);
    });

    const result = await tenantScopedTable(knex, 'project_tasks', tenant)
      .where({ project_status_mapping_id: mappingId })
      .count('* as count')
      .first();
    return parseInt(result?.count as string) || 0;
  } catch (error) {
    const expected = projectTaskStatusActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Delete a project status mapping, optionally moving tasks to another status first.
 */
export const deleteProjectStatusMapping = withAuth(async (
  user,
  { tenant },
  mappingId: string,
  moveTasksToMappingId?: string
): Promise<void | ProjectTaskStatusActionError> => {
  try {
    if (!await hasPermission(user, 'project', 'update')) {
      throw new Error('Permission denied: Cannot update project');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      const mapping = await tenantScopedTable(trx, 'project_status_mappings', tenant)
      .where({ project_status_mapping_id: mappingId })
      .first();

    if (!mapping) {
      throw new Error('Status mapping not found');
    }
    await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, mapping.project_id);

    // Move tasks if a target mapping is provided
    if (moveTasksToMappingId) {
      await tenantScopedTable(trx, 'project_tasks', tenant)
        .where({ project_status_mapping_id: mappingId })
        .update({ project_status_mapping_id: moveTasksToMappingId });
    } else {
      // Check for orphaned tasks
      const taskCount = await tenantScopedTable(trx, 'project_tasks', tenant)
        .where({ project_status_mapping_id: mappingId })
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
    const remainingQuery = tenantScopedTable(trx, 'project_status_mappings', tenant)
      .where({ project_id: mapping.project_id })
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

      await tenantScopedTable(trx, 'project_status_mappings', tenant)
        .where({ project_status_mapping_id: mappingId })
        .del();
    });
  } catch (error) {
    const expected = projectTaskStatusActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
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
): Promise<void | ProjectTaskStatusActionError> => {
  try {
    // RBAC check
    if (!await hasPermission(user, 'project', 'update')) {
      throw new Error('Permission denied: Cannot update project');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);

    for (const { mapping_id, display_order } of statusOrder) {
      const query = tenantScopedTable(trx, 'project_status_mappings', tenant)
        .where({
          project_status_mapping_id: mapping_id,
          project_id: projectId
        });

      if (phaseId) {
        query.andWhere('phase_id', phaseId);
      } else {
        query.whereNull('phase_id');
      }

      await query.update({ display_order });
    }
    });
  } catch (error) {
    const expected = projectTaskStatusActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Get tenant's project task status library
 * Returns statuses from the 'statuses' table (new system) if available,
 * otherwise falls back to 'standard_statuses' table (old system)
 */
export const getTenantProjectStatuses = withAuth(async (
  user,
  { tenant }
): Promise<IStatus[] | ProjectTaskStatusActionError> => {
  try {
    const { knex } = await createTenantKnex();

    if (!await hasPermission(user, 'project', 'read', knex)) {
      throw new Error('Permission denied: Cannot read project');
    }

    // First try the new statuses table
    const regularStatuses = await tenantScopedTable(knex, 'statuses', tenant)
      .where({ status_type: 'project_task' })
      .orderBy('order_number');

    console.log(`[getTenantProjectStatuses] Found ${regularStatuses.length} statuses in 'statuses' table for tenant ${tenant}`);

    if (regularStatuses.length > 0) {
      return regularStatuses;
    }

    // Fall back to standard_statuses table (old system)
    const standardStatuses = await tenantDb(knex, tenant).table('standard_statuses')
      .where({ item_type: 'project_task' })
      .orderBy('display_order');

    console.log(`[getTenantProjectStatuses] Found ${standardStatuses.length} statuses in 'standard_statuses' table for tenant ${tenant}`);

    // Map standard_statuses to IStatus format for compatibility
    return standardStatuses.map((s: any) => ({
      status_id: s.standard_status_id,
      tenant,
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
  } catch (error) {
    const expected = projectTaskStatusActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Create a new status in tenant's library
 */
export const createTenantProjectStatus = withAuth(async (
  user,
  { tenant },
  statusData: { name: string; is_closed: boolean; color?: string; icon?: string }
): Promise<IStatus | ProjectTaskStatusActionError> => {
  try {
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
    const maxOrder = await tenantScopedTable(trx, 'statuses', tenant)
      .where({ status_type: 'project_task' })
      .max('order_number as max')
      .first();

    const orderNumber = (maxOrder?.max ?? 0) + 1;

    console.log(`[DEBUG] Max order: ${maxOrder?.max}, Next order: ${orderNumber}`);

    const [status] = await tenantScopedTable(trx, 'statuses', tenant)
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
  } catch (error) {
    const expected = projectTaskStatusActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Update a status in tenant's library
 */
export const updateTenantProjectStatus = withAuth(async (
  user,
  { tenant },
  statusId: string,
  updates: { name?: string; is_closed?: boolean; color?: string; icon?: string }
): Promise<void | ProjectTaskStatusActionError> => {
  try {
    // RBAC check
    if (!await hasPermission(user, 'project', 'update')) {
      throw new Error('Permission denied: Cannot update project');
    }

    const { knex } = await createTenantKnex();

    await tenantScopedTable(knex, 'statuses', tenant)
      .where({ status_id: statusId, status_type: 'project_task' })
      .update(updates);
  } catch (error) {
    const expected = projectTaskStatusActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const validateTenantProjectStatusDeletion = withAuth(async (
  user,
  { tenant },
  statusId: string
): Promise<DeletionValidationResult> => {
  if (!await hasPermission(user, 'project', 'update')) {
    return {
      canDelete: false,
      code: 'PERMISSION_DENIED',
      message: 'Permission denied: Cannot update project',
      dependencies: [],
      alternatives: []
    };
  }

  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx) => (
    buildTenantProjectStatusDeletionValidation(trx, tenant, statusId)
  ));
});

/**
 * Delete a status from tenant's library
 */
export const deleteTenantProjectStatus = withAuth(async (
  user,
  { tenant },
  statusId: string
): Promise<void | ProjectTaskStatusActionError> => {
  try {
    // RBAC check
    if (!await hasPermission(user, 'project', 'update')) {
      throw new Error('Permission denied: Cannot update project');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      const validation = await buildTenantProjectStatusDeletionValidation(trx, tenant, statusId);
    if (!validation.canDelete) {
      const dependencyDetails = validation.dependencies
        .map((dependency) => dependency.description)
        .filter(Boolean)
        .join(' ');
      throw new Error([validation.message, dependencyDetails].filter(Boolean).join(' '));
    }

    // Delete the status
      await tenantScopedTable(trx, 'statuses', tenant)
        .where({ status_id: statusId, status_type: 'project_task' })
        .del();
    });
  } catch (error) {
    const expected = projectTaskStatusActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Reorder tenant's project task statuses
 */
export const reorderTenantProjectStatuses = withAuth(async (
  user,
  { tenant },
  statusOrder: Array<{ status_id: string; order_number: number }>
): Promise<void | ProjectTaskStatusActionError> => {
  try {
    // RBAC check
    if (!await hasPermission(user, 'project', 'update')) {
      throw new Error('Permission denied: Cannot update project');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx) => {
      for (const { status_id, order_number } of statusOrder) {
        await tenantScopedTable(trx, 'statuses', tenant)
          .where({
            status_id,
            status_type: 'project_task'
          })
          .update({ order_number });
      }
    });
  } catch (error) {
    const expected = projectTaskStatusActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});
