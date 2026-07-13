'use server';

import { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type {
  DependencyType,
  IProjectTemplate,
  IProjectTemplateChecklistItem,
  IProjectTemplateDependency,
  IProjectTemplatePhase,
  IProjectTemplateTask,
  IProjectTemplateWithDetails,
} from '@alga-psa/types';
import { DEFAULT_CLIENT_PORTAL_CONFIG } from '@alga-psa/types';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import type { IUser } from '@alga-psa/types';
import {
  actionError,
  isActionMessageError,
  isActionPermissionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { validateData } from '@alga-psa/validation';
import {
  createTemplateSchema,
  updateTemplateSchema
} from '../schemas/projectTemplate.schemas';
import {
  applyProjectTemplate,
  type ApplyProjectTemplateInput,
} from '../services/applyProjectTemplate';
import { OrderingService } from '../lib/orderingUtils';
import { getTemplateDefaultStatusMappings } from '../lib/templateStatusMappingUtils';
import { generateKeyBetween } from 'fractional-indexing';

type ProjectTemplateActionError = ActionMessageError | ActionPermissionError;

const EXPECTED_TEMPLATE_ACTION_MESSAGES = [
  'Project not found',
  'Template not found',
  'No project statuses found',
  'Invalid task IDs',
  'A task cannot depend on itself',
  'This dependency already exists',
  'Dependency not found',
  'Phase not found',
  'Task not found',
  'Status mapping not found',
  'Checklist item not found',
];

function projectTemplateActionErrorFrom(error: unknown): ProjectTemplateActionError | null {
  if (isActionPermissionError(error) || isActionMessageError(error)) {
    return error as ProjectTemplateActionError;
  }

  const issues = (error as { issues?: unknown })?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return actionError('Template validation failed. Please review the template details and try again.');
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '22P02') {
    return actionError('Template request contains an invalid UUID');
  }

  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied')) {
      return permissionError(error.message);
    }
    if (
      EXPECTED_TEMPLATE_ACTION_MESSAGES.some((message) => error.message === message) ||
      error.message.startsWith('Failed to create custom status')
    ) {
      return actionError(error.message);
    }
  }

  return null;
}

function returnExpectedTemplateActionError(error: unknown): ProjectTemplateActionError {
  const expected = projectTemplateActionErrorFrom(error);
  if (expected) {
    return expected;
  }
  throw error;
}

async function checkPermission(
  user: IUser,
  resource: string,
  action: string,
  knexConnection?: Knex | Knex.Transaction
): Promise<void> {
  const hasPermissionResult = await hasPermission(user, resource, action, knexConnection);
  if (!hasPermissionResult) {
    throw new Error(`Permission denied: Cannot ${action} ${resource}`);
  }
}

type ProjectTemplateStatusMappingRow = {
  template_status_mapping_id: string;
  template_id: string;
  template_phase_id?: string | null;
  status_id?: string | null;
  custom_status_name?: string | null;
  custom_status_color?: string | null;
  display_order: number;
};

type WbsCodeRow = {
  wbs_code: string;
};

type ProjectTemplateCategoryRow = {
  category: string | null;
};

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

async function getScopedTemplateStatusMappings(
  trx: Knex.Transaction,
  tenant: string,
  templateId: string,
  templatePhaseId?: string | null
): Promise<ProjectTemplateStatusMappingRow[]> {
  const query = tenantScopedTable(trx, 'project_template_status_mappings', tenant)
    .where({ template_id: templateId })
    .orderBy('display_order');

  if (templatePhaseId) {
    query.andWhere('template_phase_id', templatePhaseId);
  } else {
    query.whereNull('template_phase_id');
  }

  return await query as ProjectTemplateStatusMappingRow[];
}

/**
 * Create a template from an existing project
 */
export const createTemplateFromProject = withAuth(async (
  user,
  { tenant },
  projectId: string,
  templateData: {
    template_name: string;
    description?: string;
    category?: string;
  },
  options?: {
    copyPhases?: boolean;
    copyStatuses?: boolean;
    copyTasks?: boolean;
    copyAssignments?: boolean;
    copyChecklists?: boolean;
    copyServices?: boolean;
  }
): Promise<string | ProjectTemplateActionError> => {
  try {
    // Default all options to true if not specified
    const copyOptions = {
      copyPhases: options?.copyPhases ?? true,
      copyStatuses: options?.copyStatuses ?? true,
      copyTasks: options?.copyTasks ?? true,
      copyAssignments: options?.copyAssignments ?? false,
      copyChecklists: options?.copyChecklists ?? true,
      copyServices: options?.copyServices ?? true
    };

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'create', trx);

    // Verify project exists and user has access
    const project = await tenantScopedTable(trx, 'projects', tenant)
      .where({ project_id: projectId })
      .first();

    if (!project) {
      throw new Error('Project not found');
    }

    // Create template
    const [template] = await tenantScopedTable(trx, 'project_templates', tenant)
      .insert({
        tenant,
        template_name: templateData.template_name,
        description: templateData.description,
        category: templateData.category,
        created_by: user.user_id,
        use_count: 0,
        client_portal_config: JSON.stringify(
          project.client_portal_config ?? DEFAULT_CLIENT_PORTAL_CONFIG
        )
      })
      .returning('*');

    // Copy phases (if enabled)
    let phaseMap = new Map<string, string>(); // old_phase_id → template_phase_id
    let phases: any[] = [];

    if (copyOptions.copyPhases) {
      phases = await tenantScopedTable(trx, 'project_phases', tenant)
        .where({ project_id: projectId })
        .orderBy('order_key');

      for (const phase of phases) {
      // Calculate duration_days from phase dates if available
      let duration_days: number | null = null;
      if (phase.start_date && phase.end_date) {
        const start = new Date(phase.start_date);
        const end = new Date(phase.end_date);
        const diffTime = end.getTime() - start.getTime();
        duration_days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Convert ms to days
      }

      // Calculate start_offset_days from project start date if both are available
      let start_offset_days = 0;
      if (project.start_date && phase.start_date) {
        const projectStart = new Date(project.start_date);
        const phaseStart = new Date(phase.start_date);
        const diffTime = phaseStart.getTime() - projectStart.getTime();
        start_offset_days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Convert ms to days
      }

      const [templatePhase] = await tenantScopedTable(trx, 'project_template_phases', tenant)
        .insert({
          tenant,
          template_id: template.template_id,
          phase_name: phase.phase_name,
          description: phase.description,
          order_key: phase.order_key,
          start_offset_days,
          duration_days
        })
        .returning('*');

      phaseMap.set(phase.phase_id, templatePhase.template_phase_id);
      }
    }

    // Copy status mappings first to create mapping from project status to template status
    const projectStatusToTemplateStatusMap = new Map<string, string>();
    const statusMappings = await tenantScopedTable(trx, 'project_status_mappings', tenant)
      .where({ project_id: projectId });

    for (const mapping of statusMappings) {
      const templatePhaseId = mapping.phase_id
        ? phaseMap.get(mapping.phase_id) ?? null
        : null;

      const [templateStatusMapping] = await tenantScopedTable(trx, 'project_template_status_mappings', tenant)
        .insert({
          tenant,
          template_id: template.template_id,
          template_phase_id: templatePhaseId,
          status_id: mapping.status_id || mapping.standard_status_id,
          custom_status_name: mapping.custom_name,
          display_order: mapping.display_order
        })
        .returning('*');

      projectStatusToTemplateStatusMap.set(
        mapping.project_status_mapping_id,
        templateStatusMapping.template_status_mapping_id
      );
    }

    // Copy tasks
    const phaseIds = Array.from(phaseMap.keys());
    if (phaseIds.length === 0) {
      return template.template_id;
    }

    const tasks = await tenantScopedTable(trx, 'project_tasks', tenant)
      .whereIn('phase_id', phaseIds)
      .orderBy('order_key');

    const taskMap = new Map<string, string>(); // old_task_id → template_task_id

    for (const task of tasks) {
      const templatePhaseId = phaseMap.get(task.phase_id);
      if (!templatePhaseId) continue;

      // Get the corresponding phase to calculate task duration if available
      const originalPhase = phases.find(p => p.phase_id === task.phase_id);

      // Calculate duration_days for the task if it has a due_date and the phase has a start_date
      let duration_days: number | null = null;
      if (task.due_date && originalPhase?.start_date) {
        const phaseStart = new Date(originalPhase.start_date);
        const taskDue = new Date(task.due_date);
        const diffTime = taskDue.getTime() - phaseStart.getTime();
        duration_days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Convert ms to days
      }

      // Map the project status mapping to template status mapping
      const templateStatusMappingId = task.project_status_mapping_id
        ? projectStatusToTemplateStatusMap.get(task.project_status_mapping_id)
        : null;

      const [templateTask] = await tenantScopedTable(trx, 'project_template_tasks', tenant)
        .insert({
          tenant,
          template_phase_id: templatePhaseId,
          task_name: task.task_name,
          // Preserve both description formats verbatim.
          description: task.description || null,
          description_rich_text: task.description_rich_text || null,
          estimated_hours: task.estimated_hours,
          task_type_key: task.task_type_key,
          priority_id: task.priority_id,
          assigned_to: copyOptions.copyAssignments ? task.assigned_to : null,
          assigned_team_id: copyOptions.copyAssignments ? (task.assigned_team_id || null) : null,
          template_status_mapping_id: templateStatusMappingId || null,
          order_key: task.order_key,
          duration_days,
          service_id: copyOptions.copyServices ? (task.service_id || null) : null
        })
        .returning('*');

      taskMap.set(task.task_id, templateTask.template_task_id);

      // Copy additional agents from task_resources if enabled
      if (copyOptions.copyAssignments) {
        // Note: Primary assignment (assigned_to) is already copied via the task insert above

        // Copy additional agents from task_resources
        const additionalAgents = await tenantScopedTable(trx, 'task_resources', tenant)
          .where({ task_id: task.task_id })
          .select('additional_user_id');

        for (const resource of additionalAgents) {
          if (resource.additional_user_id) {
            await tenantScopedTable(trx, 'project_template_task_resources', tenant)
              .insert({
                tenant,
                template_task_id: templateTask.template_task_id,
                user_id: resource.additional_user_id
              });
          }
        }
      }
    }

    // Copy dependencies (with remapped IDs)
    const taskIds = Array.from(taskMap.keys());
    if (taskIds.length > 0) {
      const dependencies = await tenantScopedTable(trx, 'project_task_dependencies', tenant)
        .whereIn('predecessor_task_id', taskIds);

      for (const dep of dependencies) {
        const newPredecessorId = taskMap.get(dep.predecessor_task_id);
        const newSuccessorId = taskMap.get(dep.successor_task_id);

        if (newPredecessorId && newSuccessorId) {
          await tenantScopedTable(trx, 'project_template_dependencies', tenant)
            .insert({
              tenant,
              template_id: template.template_id,
              predecessor_task_id: newPredecessorId,
              successor_task_id: newSuccessorId,
              dependency_type: dep.dependency_type,
              lead_lag_days: dep.lead_lag_days || 0,
              notes: dep.notes
            });
        }
      }

      // Copy checklists (if enabled)
      if (copyOptions.copyChecklists) {
        const checklists = await tenantScopedTable(trx, 'task_checklist_items', tenant)
          .whereIn('task_id', taskIds);

        for (const item of checklists) {
          const newTaskId = taskMap.get(item.task_id);

          if (newTaskId) {
            await tenantScopedTable(trx, 'project_template_checklist_items', tenant)
              .insert({
                tenant,
                template_task_id: newTaskId,
                item_name: item.item_name,
                description: item.description,
                order_number: item.order_number,
                completed: item.completed ?? false
              });
          }
        }
      }
    }

      return template.template_id;
    });
  } catch (error) {
    const expected = projectTemplateActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Apply a template to create a new project
 */
export const applyTemplate = withAuth(async (
  user,
  { tenant },
  templateId: string,
  projectData: ApplyProjectTemplateInput
): Promise<string | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();
    const projectId = await withTransaction(knex, async (trx: Knex.Transaction) => {
      await checkPermission(user, 'project', 'create', trx);
      return applyProjectTemplate(trx, tenant, templateId, projectData);
    });

    await publishEvent({
      eventType: 'PROJECT_CREATED',
      payload: {
        tenantId: tenant,
        projectId,
        userId: user.user_id,
        timestamp: new Date().toISOString(),
      },
    });

    return projectId;
  } catch (error) {
    const expected = projectTemplateActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
/**
 * Get all templates with optional filtering
 */
export const getTemplates = withAuth(async (
  user,
  { tenant },
  filters?: {
    category?: string;
    search?: string;
  }
): Promise<IProjectTemplate[]> => {
  const { knex } = await createTenantKnex();

  await checkPermission(user, 'project', 'read', knex);

  let query = tenantScopedTable(knex, 'project_templates', tenant);

  if (filters?.category) {
    query = query.where('category', filters.category);
  }

  if (filters?.search) {
    query = query.where(function() {
      this.where('template_name', 'ilike', `%${filters.search}%`)
        .orWhere('description', 'ilike', `%${filters.search}%`);
    });
  }

  return await query.orderBy('template_name');
});

/**
 * Get template details with all related data
 */
export const getTemplateWithDetails = withAuth(async (
  user,
  { tenant },
  templateId: string
): Promise<IProjectTemplateWithDetails | null> => {
  const { knex } = await createTenantKnex();

  await checkPermission(user, 'project', 'read', knex);

  const template = await tenantScopedTable(knex, 'project_templates', tenant)
    .where({ template_id: templateId })
    .first();

  if (!template) {
    return null;
  }

  // Load all related data
  const [phases, dependencies, rawStatusMappings] = await Promise.all([
    tenantScopedTable(knex, 'project_template_phases', tenant)
      .where({ template_id: templateId })
      .orderBy('order_key'),
    tenantScopedTable(knex, 'project_template_dependencies', tenant)
      .where({ template_id: templateId }),
    tenantScopedTable(knex, 'project_template_status_mappings', tenant)
      .where({ template_id: templateId })
      .orderBy('display_order')
  ]) as [IProjectTemplatePhase[], IProjectTemplateDependency[], ProjectTemplateStatusMappingRow[]];

  // Enrich status mappings with actual status information
  const statusMappings = await Promise.all(
    rawStatusMappings.map(async (mapping) => {
      if (mapping.status_id) {
        // First, try standard_statuses (for standard statuses)
        const standardStatus = await tenantDb(knex, tenant).table('standard_statuses')
          .where({ standard_status_id: mapping.status_id })
          .first();

        if (standardStatus) {
          return {
            ...mapping,
            status_name: standardStatus.name,
            color: standardStatus.color || '#6B7280',
            is_closed: standardStatus.is_closed,
            icon: standardStatus.icon || null
          };
        }

        // If not found, try statuses table (for custom statuses)
        const customStatus = await tenantScopedTable(knex, 'statuses', tenant)
          .where({ status_id: mapping.status_id })
          .first();

        if (customStatus) {
          return {
            ...mapping,
            status_name: customStatus.name,
            color: customStatus.color || '#6B7280',
            is_closed: customStatus.is_closed,
            icon: customStatus.icon || null
          };
        }
      }

      // If no status_id or status not found, use custom_status_name
      return {
        ...mapping,
        status_name: mapping.custom_status_name || 'Status',
        color: '#6B7280', // Default gray color
        is_closed: false
      };
    })
  );

  const phaseIds = phases.map(p => p.template_phase_id);
  let tasks: IProjectTemplateTask[] = [];
  let checklistItems: any[] = [];
  let taskAssignments: any[] = [];

  console.log(`[getTemplateWithDetails] Template: ${template.template_name}, phaseIds:`, phaseIds);

  if (phaseIds.length > 0) {
    tasks = await tenantScopedTable(knex, 'project_template_tasks', tenant)
      .whereIn('template_phase_id', phaseIds)
      .orderBy('order_key');

    console.log(`[getTemplateWithDetails] Found ${tasks.length} tasks for template ${template.template_name}`);
    if (tasks.length > 0) {
      console.log('[getTemplateWithDetails] First task:', tasks[0]);
    }

    const taskIds = tasks.map(t => t.template_task_id);
    if (taskIds.length > 0) {
      [checklistItems, taskAssignments] = await Promise.all([
        tenantScopedTable(knex, 'project_template_checklist_items', tenant)
          .whereIn('template_task_id', taskIds)
          .orderBy('order_number'),
        tenantScopedTable(knex, 'project_template_task_resources', tenant)
          .whereIn('template_task_id', taskIds)
      ]);
    }
  }

  return {
    ...template,
    phases,
    tasks,
    dependencies,
    checklist_items: checklistItems,
    status_mappings: statusMappings,
    task_assignments: taskAssignments
  };
});

/**
 * Update a template
 */
export const updateTemplate = withAuth(async (
  user,
  { tenant },
  templateId: string,
  data: {
    template_name?: string;
    description?: string;
    category?: string;
    client_portal_config?: import('@alga-psa/types').IClientPortalConfig;
  }
): Promise<IProjectTemplate | ProjectTemplateActionError> => {
  try {
    const validatedData = validateData(updateTemplateSchema, data);
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    // Handle client_portal_config JSON serialization
    const { client_portal_config, ...restData } = validatedData;
    const updateData: Record<string, unknown> = {
      ...restData,
      updated_at: trx.fn.now()
    };
    if (client_portal_config !== undefined) {
      updateData.client_portal_config = JSON.stringify(client_portal_config);
    }

    const [updated] = await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: templateId })
      .update(updateData)
      .returning('*');

    if (!updated) {
      throw new Error('Template not found');
    }

      return updated;
    });
  } catch (error) {
    const expected = projectTemplateActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Delete a template
 */
export const deleteTemplate = withAuth(async (
  user,
  { tenant },
  templateId: string
): Promise<void | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'delete', trx);

    // Cascade delete handled by FK constraints
    const deleted = await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: templateId })
      .delete();

    if (deleted === 0) {
      throw new Error('Template not found');
    }
    });
  } catch (error) {
    const expected = projectTemplateActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Duplicate a template
 * @deprecated Use saveTemplateAsNew from projectTemplateWizardActions instead.
 * This function remains for backwards compatibility but new code should use the wizard-based approach.
 */
export const duplicateTemplate = withAuth(async (
  user,
  { tenant },
  templateId: string
): Promise<string | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'create', trx);

    const originalTemplate = await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: templateId })
      .first();

    if (!originalTemplate) {
      throw new Error('Template not found');
    }

    // Create new template
    const [newTemplate] = await tenantScopedTable(trx, 'project_templates', tenant)
      .insert({
        tenant,
        template_name: `${originalTemplate.template_name} (Copy)`,
        description: originalTemplate.description,
        category: originalTemplate.category,
        created_by: user.user_id,
        use_count: 0
      })
      .returning('*');

    // Copy phases
    const phases = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_id: templateId })
      .orderBy('order_key');

    const phaseMap = new Map<string, string>();

    for (const phase of phases) {
      const [newPhase] = await tenantScopedTable(trx, 'project_template_phases', tenant)
        .insert({
          tenant,
          template_id: newTemplate.template_id,
          phase_name: phase.phase_name,
          description: phase.description,
          duration_days: phase.duration_days,
          start_offset_days: phase.start_offset_days,
          order_key: phase.order_key
        })
        .returning('*');

      phaseMap.set(phase.template_phase_id, newPhase.template_phase_id);
    }

    // Copy tasks
    const phaseIds = Array.from(phaseMap.keys());
    if (phaseIds.length > 0) {
      const tasks = await tenantScopedTable(trx, 'project_template_tasks', tenant)
        .whereIn('template_phase_id', phaseIds);

      const taskMap = new Map<string, string>();

      for (const task of tasks) {
        const newPhaseId = phaseMap.get(task.template_phase_id);
        if (!newPhaseId) continue;

        const [newTask] = await tenantScopedTable(trx, 'project_template_tasks', tenant)
          .insert({
            tenant,
            template_phase_id: newPhaseId,
            task_name: task.task_name,
            description: task.description,
            estimated_hours: task.estimated_hours,
            duration_days: task.duration_days,
            task_type_key: task.task_type_key,
            priority_id: task.priority_id,
            order_key: task.order_key,
            service_id: task.service_id || null
          })
          .returning('*');

        taskMap.set(task.template_task_id, newTask.template_task_id);
      }

      // Copy dependencies
      const deps = await tenantScopedTable(trx, 'project_template_dependencies', tenant)
        .where({ template_id: templateId });

      for (const dep of deps) {
        const newPred = taskMap.get(dep.predecessor_task_id);
        const newSucc = taskMap.get(dep.successor_task_id);

        if (newPred && newSucc) {
          await tenantScopedTable(trx, 'project_template_dependencies', tenant)
            .insert({
              tenant,
              template_id: newTemplate.template_id,
              predecessor_task_id: newPred,
              successor_task_id: newSucc,
              dependency_type: dep.dependency_type,
              lead_lag_days: dep.lead_lag_days,
              notes: dep.notes
            });
        }
      }

      // Copy checklists
      const taskIds = Array.from(taskMap.keys());
      if (taskIds.length > 0) {
        const checklists = await tenantScopedTable(trx, 'project_template_checklist_items', tenant)
          .whereIn('template_task_id', taskIds);

        for (const item of checklists) {
          const newTaskId = taskMap.get(item.template_task_id);
          if (newTaskId) {
            await tenantScopedTable(trx, 'project_template_checklist_items', tenant)
              .insert({
                tenant,
                template_task_id: newTaskId,
                item_name: item.item_name,
                description: item.description,
                order_number: item.order_number,
                completed: item.completed ?? false
              });
          }
        }
      }
    }

    // Copy status mappings
    const statusMappings = await tenantScopedTable(trx, 'project_template_status_mappings', tenant)
      .where({ template_id: templateId });

    for (const mapping of statusMappings) {
      await tenantScopedTable(trx, 'project_template_status_mappings', tenant)
        .insert({
          tenant,
          template_id: newTemplate.template_id,
          template_phase_id: mapping.template_phase_id
            ? phaseMap.get(mapping.template_phase_id) ?? null
            : null,
          status_id: mapping.status_id,
          custom_status_name: mapping.custom_status_name,
          display_order: mapping.display_order
        });
    }

      return newTemplate.template_id;
    });
  } catch (error) {
    const expected = projectTemplateActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Get template categories (unique list)
 */
export const getTemplateCategories = withAuth(async (
  user,
  { tenant }
): Promise<string[] | ActionPermissionError> => {
  const { knex } = await createTenantKnex();

  try {
    await checkPermission(user, 'project', 'read', knex);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Permission denied')) {
      return permissionError(error.message);
    }
    throw error;
  }

  const results = await tenantScopedTable(knex, 'project_templates', tenant)
    .whereNotNull('category')
    .distinct('category')
    .orderBy('category') as ProjectTemplateCategoryRow[];

  return results
    .map((r) => r.category)
    .filter((category): category is string => Boolean(category));
});

// ============================================================
// TEMPLATE DEPENDENCY ACTIONS
// ============================================================

/**
 * Add a dependency to a template task
 */
export const addTemplateDependency = withAuth(async (
  user,
  { tenant },
  templateId: string,
  predecessorTaskId: string,
  successorTaskId: string,
  dependencyType: DependencyType,
  leadLagDays: number = 0,
  notes?: string
): Promise<IProjectTemplateDependency | ProjectTemplateActionError> => {
  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx) => {
    await checkPermission(user, 'project', 'update', trx);

    // Validate that both tasks belong to the template
    const tasks = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .whereIn('template_task_id', [predecessorTaskId, successorTaskId]);

    if (tasks.length !== 2) {
      throw new Error('Invalid task IDs');
    }

    // Check for self-reference
    if (predecessorTaskId === successorTaskId) {
      throw new Error('A task cannot depend on itself');
    }

    // Check for existing dependency
    const existing = await tenantScopedTable(trx, 'project_template_dependencies', tenant)
      .where({
        predecessor_task_id: predecessorTaskId,
        successor_task_id: successorTaskId
      })
      .first();

    if (existing) {
      throw new Error('This dependency already exists');
    }

    // Insert new dependency
    const [dependency] = await tenantScopedTable(trx, 'project_template_dependencies', tenant)
      .insert({
        tenant,
        template_id: templateId,
        predecessor_task_id: predecessorTaskId,
        successor_task_id: successorTaskId,
        dependency_type: dependencyType,
        lead_lag_days: leadLagDays,
        notes
      })
      .returning('*');

      return dependency;
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Update a template dependency
 */
export const updateTemplateDependency = withAuth(async (
  user,
  { tenant },
  dependencyId: string,
  data: {
    dependency_type?: DependencyType;
    lead_lag_days?: number;
    notes?: string;
  }
): Promise<IProjectTemplateDependency | ProjectTemplateActionError> => {
  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx) => {
    await checkPermission(user, 'project', 'update', trx);

    const [dependency] = await tenantScopedTable(trx, 'project_template_dependencies', tenant)
      .where({ template_dependency_id: dependencyId })
      .update(data)
      .returning('*');

    if (!dependency) {
      throw new Error('Dependency not found');
    }

      return dependency;
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Remove a template dependency
 */
export const removeTemplateDependency = withAuth(async (
  user,
  { tenant },
  dependencyId: string
): Promise<void | ProjectTemplateActionError> => {
  try {
    const { knex: db } = await createTenantKnex();

    return await withTransaction(db, async (trx) => {
    await checkPermission(user, 'project', 'update', trx);

    const deleted = await tenantScopedTable(trx, 'project_template_dependencies', tenant)
      .where({ template_dependency_id: dependencyId })
      .delete();

    if (!deleted) {
      throw new Error('Dependency not found');
    }
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Get all dependencies for a template
 */
export const getTemplateDependencies = withAuth(async (
  user,
  { tenant },
  templateId: string
): Promise<IProjectTemplateDependency[]> => {
  const { knex } = await createTenantKnex();

  await checkPermission(user, 'project', 'read', knex);

  return await tenantScopedTable(knex, 'project_template_dependencies', tenant)
    .where({ template_id: templateId });
});

/**
 * Get dependencies for a specific task (both as predecessor and successor)
 */
export const getTaskTemplateDependencies = withAuth(async (
  user,
  { tenant },
  taskId: string
): Promise<{
  predecessors: IProjectTemplateDependency[];
  successors: IProjectTemplateDependency[];
}> => {
  const { knex } = await createTenantKnex();

  await checkPermission(user, 'project', 'read', knex);

  const db = tenantDb(knex, tenant);
  const predecessorsQuery = tenantScopedTable(knex, 'project_template_dependencies as ptd', tenant)
    .where({ 'ptd.successor_task_id': taskId })
    .select('ptd.*', 'ptt.task_name as predecessor_task_name');
  db.tenantJoin(predecessorsQuery, 'project_template_tasks as ptt', 'ptd.predecessor_task_id', 'ptt.template_task_id', { type: 'left' });

  const successorsQuery = tenantScopedTable(knex, 'project_template_dependencies as ptd', tenant)
    .where({ 'ptd.predecessor_task_id': taskId })
    .select('ptd.*', 'ptt.task_name as successor_task_name');
  db.tenantJoin(successorsQuery, 'project_template_tasks as ptt', 'ptd.successor_task_id', 'ptt.template_task_id', { type: 'left' });

  const [predecessors, successors] = await Promise.all([
    predecessorsQuery,
    successorsQuery
  ]);

  return { predecessors, successors };
});

// ============================================================
// GRANULAR UPDATE ACTIONS FOR TEMPLATE EDITOR
// ============================================================

/**
 * Add a new phase to a template
 */
export const addTemplatePhase = withAuth(async (
  user,
  { tenant },
  templateId: string,
  phaseData: {
    phase_name: string;
    description?: string;
    duration_days?: number;
    start_offset_days?: number;
  },
  afterPhaseId?: string | null
): Promise<IProjectTemplatePhase | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    // Verify template exists
    const template = await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: templateId })
      .first();

    if (!template) {
      throw new Error('Template not found');
    }

    // Get existing phases to determine order_key
    const existingPhases = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_id: templateId })
      .orderBy('order_key') as IProjectTemplatePhase[];

    let orderKey: string;
    if (afterPhaseId) {
      const afterIndex = existingPhases.findIndex(p => p.template_phase_id === afterPhaseId);
      const afterKey = existingPhases[afterIndex]?.order_key || null;
      const beforeKey = existingPhases[afterIndex + 1]?.order_key || null;
      orderKey = generateKeyBetween(afterKey, beforeKey);
    } else {
      // Add at end
      const lastKey = existingPhases[existingPhases.length - 1]?.order_key || null;
      orderKey = generateKeyBetween(lastKey, null);
    }

    const [newPhase] = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .insert({
        tenant,
        template_id: templateId,
        phase_name: phaseData.phase_name,
        description: phaseData.description || null,
        duration_days: phaseData.duration_days || null,
        start_offset_days: phaseData.start_offset_days || 0,
        order_key: orderKey
      })
      .returning('*');

    // Update template timestamp
    await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: templateId })
      .update({ updated_at: trx.fn.now() });

      return newPhase;
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Update a template phase
 */
export const updateTemplatePhase = withAuth(async (
  user,
  { tenant },
  phaseId: string,
  data: {
    phase_name?: string;
    description?: string;
    duration_days?: number;
    start_offset_days?: number;
  }
): Promise<IProjectTemplatePhase | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    const [updated] = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_phase_id: phaseId })
      .update(data)
      .returning('*');

    if (!updated) {
      throw new Error('Phase not found');
    }

    // Update template timestamp
    await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: updated.template_id })
      .update({ updated_at: trx.fn.now() });

      return updated;
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Delete a template phase (and cascade delete tasks)
 */
export const deleteTemplatePhase = withAuth(async (
  user,
  { tenant },
  phaseId: string
): Promise<void | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    const phase = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_phase_id: phaseId })
      .first();

    if (!phase) {
      throw new Error('Phase not found');
    }

    // Delete phase (FK cascade handles tasks/checklists)
    await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_phase_id: phaseId })
      .delete();

    // Update template timestamp
    await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: phase.template_id })
      .update({ updated_at: trx.fn.now() });
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Reorder a template phase
 */
export const reorderTemplatePhase = withAuth(async (
  user,
  { tenant },
  phaseId: string,
  beforePhaseId: string | null,
  afterPhaseId: string | null
): Promise<IProjectTemplatePhase | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    const phase = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_phase_id: phaseId })
      .first();

    if (!phase) {
      throw new Error('Phase not found');
    }

    // Get order keys
    let beforeKey: string | null = null;
    let afterKey: string | null = null;

    if (beforePhaseId) {
      const beforePhase = await tenantScopedTable(trx, 'project_template_phases', tenant)
        .where({ template_phase_id: beforePhaseId })
        .first();
      beforeKey = beforePhase?.order_key || null;
    }

    if (afterPhaseId) {
      const afterPhase = await tenantScopedTable(trx, 'project_template_phases', tenant)
        .where({ template_phase_id: afterPhaseId })
        .first();
      afterKey = afterPhase?.order_key || null;
    }

    const newOrderKey = generateKeyBetween(beforeKey, afterKey);

    const [updated] = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_phase_id: phaseId })
      .update({ order_key: newOrderKey })
      .returning('*');

    // Update template timestamp
    await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: phase.template_id })
      .update({ updated_at: trx.fn.now() });

      return updated;
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Add a new task to a template phase
 */
export const addTemplateTask = withAuth(async (
  user,
  { tenant },
  phaseId: string,
  taskData: {
    task_name: string;
    description?: string;
    estimated_hours?: number;
    duration_days?: number;
    task_type_key?: string;
    priority_id?: string;
    assigned_to?: string;
    assigned_team_id?: string | null;
    template_status_mapping_id?: string;
    service_id?: string | null;
  },
  afterTaskId?: string | null
): Promise<IProjectTemplateTask | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    // Verify phase exists
    const phase = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_phase_id: phaseId })
      .first();

    if (!phase) {
      throw new Error('Phase not found');
    }

    // Get existing tasks to determine order_key
    const existingTasks = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_phase_id: phaseId })
      .orderBy('order_key') as IProjectTemplateTask[];

    let orderKey: string;
    if (afterTaskId) {
      const afterIndex = existingTasks.findIndex(t => t.template_task_id === afterTaskId);
      const afterKey = existingTasks[afterIndex]?.order_key || null;
      const beforeKey = existingTasks[afterIndex + 1]?.order_key || null;
      orderKey = generateKeyBetween(afterKey, beforeKey);
    } else {
      // Add at end
      const lastKey = existingTasks[existingTasks.length - 1]?.order_key || null;
      orderKey = generateKeyBetween(lastKey, null);
    }

    const [newTask] = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .insert({
        tenant,
        template_phase_id: phaseId,
        task_name: taskData.task_name,
        description: taskData.description || null,
        estimated_hours: taskData.estimated_hours || null,
        duration_days: taskData.duration_days || null,
        task_type_key: taskData.task_type_key || null,
        priority_id: taskData.priority_id || null,
        assigned_to: taskData.assigned_to || null,
        assigned_team_id: taskData.assigned_team_id || null,
        template_status_mapping_id: taskData.template_status_mapping_id || null,
        service_id: taskData.service_id || null,
        order_key: orderKey
      })
      .returning('*');

    // Update template timestamp
    await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: phase.template_id })
      .update({ updated_at: trx.fn.now() });

      return newTask;
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Update a template task
 */
export const updateTemplateTask = withAuth(async (
  user,
  { tenant },
  taskId: string,
  data: {
    task_name?: string;
    description?: string;
    description_rich_text?: string;
    estimated_hours?: number;
    duration_days?: number;
    task_type_key?: string;
    priority_id?: string;
    assigned_to?: string | null;
    assigned_team_id?: string | null;
    template_status_mapping_id?: string | null;
    template_phase_id?: string;
    order_key?: string;
    service_id?: string | null;
  }
): Promise<IProjectTemplateTask | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    const [updated] = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_task_id: taskId })
      .update(data)
      .returning('*');

    if (!updated) {
      throw new Error('Task not found');
    }

    // Get phase to update template timestamp
    const phase = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_phase_id: updated.template_phase_id })
      .first();

    if (phase) {
      await tenantScopedTable(trx, 'project_templates', tenant)
        .where({ template_id: phase.template_id })
        .update({ updated_at: trx.fn.now() });
    }

      return updated;
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Delete a template task
 */
export const deleteTemplateTask = withAuth(async (
  user,
  { tenant },
  taskId: string
): Promise<void | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    const task = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_task_id: taskId })
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Get phase for template update
    const phase = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_phase_id: task.template_phase_id })
      .first();

    // Delete task (FK cascade handles checklists)
    await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_task_id: taskId })
      .delete();

    // Update template timestamp
    if (phase) {
      await tenantScopedTable(trx, 'project_templates', tenant)
        .where({ template_id: phase.template_id })
        .update({ updated_at: trx.fn.now() });
    }
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Move a task to a different phase or reorder within same phase
 */
export const moveTemplateTask = withAuth(async (
  user,
  { tenant },
  taskId: string,
  targetPhaseId: string,
  targetStatusMappingId?: string | null,
  beforeTaskId?: string | null,
  afterTaskId?: string | null
): Promise<IProjectTemplateTask | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    const task = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_task_id: taskId })
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Get order keys
    let beforeKey: string | null = null;
    let afterKey: string | null = null;

    if (beforeTaskId) {
      const beforeTask = await tenantScopedTable(trx, 'project_template_tasks', tenant)
        .where({ template_task_id: beforeTaskId })
        .first();
      beforeKey = beforeTask?.order_key || null;
    }

    if (afterTaskId) {
      const afterTask = await tenantScopedTable(trx, 'project_template_tasks', tenant)
        .where({ template_task_id: afterTaskId })
        .first();
      afterKey = afterTask?.order_key || null;
    }

    const newOrderKey = generateKeyBetween(beforeKey, afterKey);

    const updateData: any = {
      template_phase_id: targetPhaseId,
      order_key: newOrderKey
    };

    // Update status mapping if provided
    if (targetStatusMappingId !== undefined) {
      updateData.template_status_mapping_id = targetStatusMappingId;
    }

    const [updated] = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_task_id: taskId })
      .update(updateData)
      .returning('*');

    // Get phase for template update
    const phase = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_phase_id: targetPhaseId })
      .first();

    if (phase) {
      await tenantScopedTable(trx, 'project_templates', tenant)
        .where({ template_id: phase.template_id })
        .update({ updated_at: trx.fn.now() });
    }

      return updated;
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Update task status (move between status columns)
 */
export const updateTemplateTaskStatus = withAuth(async (
  user,
  { tenant },
  taskId: string,
  statusMappingId: string,
  beforeTaskId?: string | null,
  afterTaskId?: string | null
): Promise<IProjectTemplateTask | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    const task = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_task_id: taskId })
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Calculate new order key
    let beforeKey: string | null = null;
    let afterKey: string | null = null;

    if (beforeTaskId) {
      const beforeTask = await tenantScopedTable(trx, 'project_template_tasks', tenant)
        .where({ template_task_id: beforeTaskId })
        .first();
      beforeKey = beforeTask?.order_key || null;
    }

    if (afterTaskId) {
      const afterTask = await tenantScopedTable(trx, 'project_template_tasks', tenant)
        .where({ template_task_id: afterTaskId })
        .first();
      afterKey = afterTask?.order_key || null;
    }

    const newOrderKey = generateKeyBetween(beforeKey, afterKey);

    const [updated] = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_task_id: taskId })
      .update({
        template_status_mapping_id: statusMappingId,
        order_key: newOrderKey
      })
      .returning('*');

    // Get phase for template update
    const phase = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_phase_id: task.template_phase_id })
      .first();

    if (phase) {
      await tenantScopedTable(trx, 'project_templates', tenant)
        .where({ template_id: phase.template_id })
        .update({ updated_at: trx.fn.now() });
    }

      return updated;
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Add a status mapping to a template
 */
export const addTemplateStatusMapping = withAuth(async (
  user,
  { tenant },
  templateId: string,
  data: {
    status_id: string;
  },
  templatePhaseId?: string | null
): Promise<any | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    // Get existing mappings to determine display_order
    const existingMappings = await getScopedTemplateStatusMappings(
      trx,
      tenant,
      templateId,
      templatePhaseId
    );

    const maxOrder = existingMappings.length > 0
      ? Math.max(...existingMappings.map(m => m.display_order))
      : 0;

    const [newMapping] = await tenantScopedTable(trx, 'project_template_status_mappings', tenant)
      .insert({
        tenant,
        template_id: templateId,
        template_phase_id: templatePhaseId ?? null,
        status_id: data.status_id,
        display_order: maxOrder + 1
      })
      .returning('*');

    // Enrich with status info
    const status = await tenantScopedTable(trx, 'statuses', tenant)
      .where({ status_id: data.status_id })
      .first();

    await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: templateId })
      .update({ updated_at: trx.fn.now() });

      return {
        ...newMapping,
        status_name: status?.name,
        color: status?.color || '#6B7280',
        is_closed: status?.is_closed
      };
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Remove a status mapping from a template
 */
export const removeTemplateStatusMapping = withAuth(async (
  user,
  { tenant },
  mappingId: string
): Promise<void | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    const mapping = await tenantScopedTable(trx, 'project_template_status_mappings', tenant)
      .where({ template_status_mapping_id: mappingId })
      .first();

    if (!mapping) {
      throw new Error('Status mapping not found');
    }

    // Clear template_status_mapping_id from tasks that use this status
    await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_status_mapping_id: mappingId })
      .update({ template_status_mapping_id: null });

    // Delete the mapping
    await tenantScopedTable(trx, 'project_template_status_mappings', tenant)
      .where({ template_status_mapping_id: mappingId })
      .delete();

    await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: mapping.template_id })
      .update({ updated_at: trx.fn.now() });
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Reorder status mappings
 */
export const reorderTemplateStatusMappings = withAuth(async (
  user,
  { tenant },
  templateId: string,
  orderedMappingIds: string[],
  templatePhaseId?: string | null
): Promise<void | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    const scopedMappings = await getScopedTemplateStatusMappings(
      trx,
      tenant,
      templateId,
      templatePhaseId
    );
    const scopedMappingIds = new Set(
      scopedMappings.map((mapping) => mapping.template_status_mapping_id)
    );

    // Update display_order for each mapping
    for (let i = 0; i < orderedMappingIds.length; i++) {
      if (!scopedMappingIds.has(orderedMappingIds[i])) {
        continue;
      }

      await tenantScopedTable(trx, 'project_template_status_mappings', tenant)
        .where({ template_status_mapping_id: orderedMappingIds[i] })
        .update({ display_order: i });
    }

    await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: templateId })
      .update({ updated_at: trx.fn.now() });
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

export const copyTemplateStatusesToPhase = withAuth(async (
  user,
  { tenant },
  templateId: string,
  templatePhaseId: string
): Promise<any[] | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    const existingPhaseMappings = await getScopedTemplateStatusMappings(
      trx,
      tenant,
      templateId,
      templatePhaseId
    );

    if (existingPhaseMappings.length > 0) {
      return existingPhaseMappings;
    }

    const defaultMappings = getTemplateDefaultStatusMappings(
      await getScopedTemplateStatusMappings(trx, tenant, templateId)
    );

    if (defaultMappings.length === 0) {
      return [];
    }

    const copiedMappings: any[] = [];

    for (const mapping of defaultMappings) {
      const [copiedMapping] = await tenantScopedTable(trx, 'project_template_status_mappings', tenant)
        .insert({
          tenant,
          template_id: templateId,
          template_phase_id: templatePhaseId,
          status_id: mapping.status_id,
          custom_status_name: mapping.custom_status_name,
          custom_status_color: mapping.custom_status_color ?? null,
          display_order: mapping.display_order,
        })
        .returning('*');

      copiedMappings.push(copiedMapping);
    }

    await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: templateId })
      .update({ updated_at: trx.fn.now() });

      return copiedMappings;
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

export const removeTemplatePhaseStatuses = withAuth(async (
  user,
  { tenant },
  templateId: string,
  templatePhaseId: string
): Promise<void | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    await tenantScopedTable(trx, 'project_template_status_mappings', tenant)
      .where({
        template_id: templateId,
        template_phase_id: templatePhaseId,
      })
      .delete();

    await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: templateId })
      .update({ updated_at: trx.fn.now() });
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

// ============================================================
// TASK RESOURCE (ADDITIONAL AGENTS) ACTIONS
// ============================================================

/**
 * Get additional agents for a task
 */
export const getTaskAdditionalAgents = withAuth(async (
  user,
  { tenant },
  taskId: string
): Promise<string[]> => {
  const { knex } = await createTenantKnex();

  await checkPermission(user, 'project', 'read', knex);

  const resources = await tenantScopedTable(knex, 'project_template_task_resources', tenant)
    .where({ template_task_id: taskId })
    .select('user_id') as { user_id: string }[];

  return resources.map((r: { user_id: string }) => r.user_id);
});

/**
 * Set additional agents for a task (replaces all existing)
 */
export const setTaskAdditionalAgents = withAuth(async (
  user,
  { tenant },
  taskId: string,
  userIds: string[]
): Promise<void | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    // Verify task exists
    const task = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_task_id: taskId })
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Delete existing resources
    await tenantScopedTable(trx, 'project_template_task_resources', tenant)
      .where({ template_task_id: taskId })
      .delete();

    // Insert new resources
    if (userIds.length > 0) {
      const resources = userIds.map(userId => ({
        tenant,
        template_task_id: taskId,
        user_id: userId
      }));
      await tenantScopedTable(trx, 'project_template_task_resources', tenant).insert(resources);
    }

    // Update template timestamp via phase
    const phase = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_phase_id: task.template_phase_id })
      .first();

    if (phase) {
      await tenantScopedTable(trx, 'project_templates', tenant)
        .where({ template_id: phase.template_id })
        .update({ updated_at: trx.fn.now() });
    }
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Add an additional agent to a task
 */
export const addTaskAdditionalAgent = withAuth(async (
  user,
  { tenant },
  taskId: string,
  userId: string
): Promise<void> => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    // Verify task exists
    const task = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_task_id: taskId })
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Check if already exists
    const existing = await tenantScopedTable(trx, 'project_template_task_resources', tenant)
      .where({ template_task_id: taskId, user_id: userId })
      .first();

    if (!existing) {
      await tenantScopedTable(trx, 'project_template_task_resources', tenant).insert({
        tenant,
        template_task_id: taskId,
        user_id: userId
      });
    }

    // Update template timestamp via phase
    const phase = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_phase_id: task.template_phase_id })
      .first();

    if (phase) {
      await tenantScopedTable(trx, 'project_templates', tenant)
        .where({ template_id: phase.template_id })
        .update({ updated_at: trx.fn.now() });
    }
  });
});

/**
 * Remove an additional agent from a task
 */
export const removeTaskAdditionalAgent = withAuth(async (
  user,
  { tenant },
  taskId: string,
  userId: string
): Promise<void> => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    await tenantScopedTable(trx, 'project_template_task_resources', tenant)
      .where({ template_task_id: taskId, user_id: userId })
      .delete();

    // Get task for template update
    const task = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_task_id: taskId })
      .first();

    if (task) {
      const phase = await tenantScopedTable(trx, 'project_template_phases', tenant)
        .where({ template_phase_id: task.template_phase_id })
        .first();

      if (phase) {
        await tenantScopedTable(trx, 'project_templates', tenant)
          .where({ template_id: phase.template_id })
          .update({ updated_at: trx.fn.now() });
      }
    }
  });
});

// ============================================================
// TEMPLATE CHECKLIST ACTIONS
// ============================================================

/**
 * Get all checklist items for a template task
 */
export const getTemplateTaskChecklistItems = withAuth(async (
  _user,
  { tenant },
  taskId: string
): Promise<IProjectTemplateChecklistItem[]> => {
  const { knex } = await createTenantKnex();

  const items = await tenantScopedTable(knex, 'project_template_checklist_items', tenant)
    .where({ template_task_id: taskId })
    .orderBy('order_number');

  return items;
});

/**
 * Add a checklist item to a template task
 */
export const addTemplateChecklistItem = withAuth(async (
  user,
  { tenant },
  taskId: string,
  data: {
    item_name: string;
    description?: string;
    completed?: boolean;
    order_number?: number;
  }
): Promise<IProjectTemplateChecklistItem | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    // Verify task exists
    const task = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_task_id: taskId })
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Use provided order_number or calculate from max
    let orderNumber = data.order_number;
    if (orderNumber === undefined) {
      const maxOrder = await tenantScopedTable(trx, 'project_template_checklist_items', tenant)
        .where({ template_task_id: taskId })
        .max('order_number as max')
        .first();
      orderNumber = (maxOrder?.max ?? -1) + 1;
    }

    // Insert checklist item
    const [item] = await tenantScopedTable(trx, 'project_template_checklist_items', tenant)
      .insert({
        tenant,
        template_task_id: taskId,
        item_name: data.item_name,
        description: data.description || null,
        order_number: orderNumber,
        completed: data.completed ?? false
      })
      .returning('*');

    // Update template timestamp via phase
    const phase = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_phase_id: task.template_phase_id })
      .first();

    if (phase) {
      await tenantScopedTable(trx, 'project_templates', tenant)
        .where({ template_id: phase.template_id })
        .update({ updated_at: trx.fn.now() });
    }

      return item;
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Update a template checklist item
 */
export const updateTemplateChecklistItem = withAuth(async (
  user,
  { tenant },
  checklistId: string,
  data: {
    item_name?: string;
    description?: string;
    order_number?: number;
    completed?: boolean;
  }
): Promise<IProjectTemplateChecklistItem | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    const [updated] = await tenantScopedTable(trx, 'project_template_checklist_items', tenant)
      .where({ template_checklist_id: checklistId })
      .update({
        ...(data.item_name !== undefined && { item_name: data.item_name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.order_number !== undefined && { order_number: data.order_number }),
        ...(data.completed !== undefined && { completed: data.completed })
      })
      .returning('*');

    if (!updated) {
      throw new Error('Checklist item not found');
    }

    // Update template timestamp via task -> phase
    const task = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_task_id: updated.template_task_id })
      .first();

    if (task) {
      const phase = await tenantScopedTable(trx, 'project_template_phases', tenant)
        .where({ template_phase_id: task.template_phase_id })
        .first();

      if (phase) {
        await tenantScopedTable(trx, 'project_templates', tenant)
          .where({ template_id: phase.template_id })
          .update({ updated_at: trx.fn.now() });
      }
    }

      return updated;
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Delete a template checklist item
 */
export const deleteTemplateChecklistItem = withAuth(async (
  user,
  { tenant },
  checklistId: string
): Promise<void | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    // Get item first to find task for timestamp update
    const item = await tenantScopedTable(trx, 'project_template_checklist_items', tenant)
      .where({ template_checklist_id: checklistId })
      .first();

    if (!item) {
      throw new Error('Checklist item not found');
    }

    // Delete the item
    await tenantScopedTable(trx, 'project_template_checklist_items', tenant)
      .where({ template_checklist_id: checklistId })
      .delete();

    // Update template timestamp via task -> phase
    const task = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_task_id: item.template_task_id })
      .first();

    if (task) {
      const phase = await tenantScopedTable(trx, 'project_template_phases', tenant)
        .where({ template_phase_id: task.template_phase_id })
        .first();

      if (phase) {
        await tenantScopedTable(trx, 'project_templates', tenant)
          .where({ template_id: phase.template_id })
          .update({ updated_at: trx.fn.now() });
      }
    }
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});

/**
 * Batch save checklist items for a template task.
 * Handles creates, updates, and deletes in a single transaction for atomicity.
 *
 * @param taskId - The template task ID
 * @param items - Array of checklist items to save. Items with "temp_" prefix ids are new items to create.
 * @returns The saved checklist items
 */
export const saveTemplateChecklistItems = withAuth(async (
  user,
  { tenant },
  taskId: string,
  items: Array<{
    id: string; // template_checklist_id for existing, "temp_..." for new
    item_name: string;
    description?: string;
    completed: boolean;
    order_number: number;
  }>
): Promise<IProjectTemplateChecklistItem[] | ProjectTemplateActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(user, 'project', 'update', trx);

    // Verify task exists
    const task = await tenantScopedTable(trx, 'project_template_tasks', tenant)
      .where({ template_task_id: taskId })
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Get existing items for this task
    const existingItems = await tenantScopedTable(trx, 'project_template_checklist_items', tenant)
      .where({ template_task_id: taskId }) as IProjectTemplateChecklistItem[];

    const existingIds = new Set(existingItems.map(i => i.template_checklist_id));
    const newItemIds = new Set(items.map(i => i.id));
    const savedItems: IProjectTemplateChecklistItem[] = [];

    // Delete items that are no longer in the list
    const idsToDelete = existingItems
      .filter(e => !newItemIds.has(e.template_checklist_id))
      .map(e => e.template_checklist_id);

    if (idsToDelete.length > 0) {
      await tenantScopedTable(trx, 'project_template_checklist_items', tenant)
        .whereIn('template_checklist_id', idsToDelete)
        .delete();
    }

    // Process each item - create new or update existing
    for (const item of items) {
      if (!item.item_name.trim()) {
        continue; // Skip empty items
      }

      if (item.id.startsWith('temp_')) {
        // Create new item
        const [created] = await tenantScopedTable(trx, 'project_template_checklist_items', tenant)
          .insert({
            tenant,
            template_task_id: taskId,
            item_name: item.item_name.trim(),
            description: item.description || null,
            order_number: item.order_number,
            completed: item.completed
          })
          .returning('*');
        savedItems.push(created);
      } else if (existingIds.has(item.id)) {
        // Update existing item
        const [updated] = await tenantScopedTable(trx, 'project_template_checklist_items', tenant)
          .where({ template_checklist_id: item.id })
          .update({
            item_name: item.item_name.trim(),
            description: item.description || null,
            order_number: item.order_number,
            completed: item.completed
          })
          .returning('*');
        savedItems.push(updated);
      }
    }

    // Update template timestamp
    const phase = await tenantScopedTable(trx, 'project_template_phases', tenant)
      .where({ template_phase_id: task.template_phase_id })
      .first();

    if (phase) {
      await tenantScopedTable(trx, 'project_templates', tenant)
        .where({ template_id: phase.template_id })
        .update({ updated_at: trx.fn.now() });
    }

      return savedItems;
    });
  } catch (error) {
    return returnExpectedTemplateActionError(error);
  }
});
