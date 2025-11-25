'use server';

import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { withTransaction } from '@alga-psa/shared/db';
import { createProject } from './projectActions';
import {
  IProjectTemplate,
  IProjectTemplateWithDetails,
  IProjectTemplatePhase,
  IProjectTemplateTask
} from 'server/src/interfaces/projectTemplate.interfaces';
import { addDays } from 'date-fns';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import { validateData } from 'server/src/lib/utils/validation';
import {
  createTemplateSchema,
  updateTemplateSchema,
  applyTemplateSchema
} from 'server/src/lib/schemas/projectTemplate.schemas';
import { OrderingService } from 'server/src/lib/services/orderingService';

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

/**
 * Create a template from an existing project
 */
export async function createTemplateFromProject(
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
  }
): Promise<string> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Default all options to true if not specified
  const copyOptions = {
    copyPhases: options?.copyPhases ?? true,
    copyStatuses: options?.copyStatuses ?? true,
    copyTasks: options?.copyTasks ?? true,
    copyAssignments: options?.copyAssignments ?? false
  };

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'create', trx);

    // Verify project exists and user has access
    const project = await trx('projects')
      .where({ project_id: projectId, tenant })
      .first();

    if (!project) {
      throw new Error('Project not found');
    }

    // Create template
    const [template] = await trx('project_templates')
      .insert({
        tenant,
        template_name: templateData.template_name,
        description: templateData.description,
        category: templateData.category,
        created_by: currentUser.user_id,
        use_count: 0
      })
      .returning('*');

    // Copy phases (if enabled)
    let phaseMap = new Map<string, string>(); // old_phase_id → template_phase_id
    let phases: any[] = [];

    if (copyOptions.copyPhases) {
      phases = await trx('project_phases')
        .where({ project_id: projectId, tenant })
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

      const [templatePhase] = await trx('project_template_phases')
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
    const statusMappings = await trx('project_status_mappings')
      .where({ project_id: projectId, tenant });

    for (const mapping of statusMappings) {
      const [templateStatusMapping] = await trx('project_template_status_mappings')
        .insert({
          tenant,
          template_id: template.template_id,
          status_id: mapping.status_id,
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

    const tasks = await trx('project_tasks')
      .where('tenant', tenant)
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

      const [templateTask] = await trx('project_template_tasks')
        .insert({
          tenant,
          template_phase_id: templatePhaseId,
          task_name: task.task_name,
          description: task.description,
          estimated_hours: task.estimated_hours,
          task_type_key: task.task_type_key,
          priority_id: task.priority_id,
          assigned_to: copyOptions.copyAssignments ? task.assigned_to : null,
          template_status_mapping_id: templateStatusMappingId || null,
          order_key: task.order_key,
          duration_days
        })
        .returning('*');

      taskMap.set(task.task_id, templateTask.template_task_id);

      // Copy additional agents from task_resources if enabled
      if (copyOptions.copyAssignments) {
        // Note: Primary assignment (assigned_to) is already copied via the task insert above

        // Copy additional agents from task_resources
        const additionalAgents = await trx('task_resources')
          .where({ task_id: task.task_id, tenant })
          .select('additional_user_id');

        for (const resource of additionalAgents) {
          if (resource.additional_user_id) {
            await trx('project_template_task_resources')
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
      const dependencies = await trx('project_task_dependencies')
        .where('tenant', tenant)
        .whereIn('predecessor_task_id', taskIds);

      for (const dep of dependencies) {
        const newPredecessorId = taskMap.get(dep.predecessor_task_id);
        const newSuccessorId = taskMap.get(dep.successor_task_id);

        if (newPredecessorId && newSuccessorId) {
          await trx('project_template_dependencies')
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

      // Copy checklists
      const checklists = await trx('task_checklist_items')
        .where('tenant', tenant)
        .whereIn('task_id', taskIds);

      for (const item of checklists) {
        const newTaskId = taskMap.get(item.task_id);

        if (newTaskId) {
          await trx('project_template_checklist_items')
            .insert({
              tenant,
              template_task_id: newTaskId,
              item_name: item.item_name,
              description: item.description,
              order_number: item.order_number
            });
        }
      }
    }

    return template.template_id;
  });
}

/**
 * Apply a template to create a new project
 */
export async function applyTemplate(
  templateId: string,
  projectData: {
    project_name: string;
    client_id: string;
    start_date?: string;
    assigned_to?: string;
    options?: {
      copyPhases?: boolean;
      copyStatuses?: boolean;
      copyTasks?: boolean;
      copyDependencies?: boolean;
      copyChecklists?: boolean;
      assignmentOption?: 'none' | 'primary' | 'all';
    };
  }
): Promise<string> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const validatedData = validateData(applyTemplateSchema, {
    template_id: templateId,
    ...projectData
  });

  // Set default options if not provided
  const options = {
    copyPhases: validatedData.options?.copyPhases ?? true,
    copyStatuses: validatedData.options?.copyStatuses ?? true,
    copyTasks: validatedData.options?.copyTasks ?? true,
    copyDependencies: validatedData.options?.copyDependencies ?? true,
    copyChecklists: validatedData.options?.copyChecklists ?? true,
    assignmentOption: validatedData.options?.assignmentOption ?? 'primary'
  };

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'create', trx);

    // Verify template exists
    const template = await trx('project_templates')
      .where({ template_id: templateId, tenant })
      .first();

    if (!template) {
      throw new Error('Template not found');
    }

    // 1. Create project (using existing createProject function)
    const newProject = await createProject({
      project_name: validatedData.project_name,
      client_id: validatedData.client_id,
      assigned_to: validatedData.assigned_to ? String(validatedData.assigned_to) : null,
      start_date: validatedData.start_date ? new Date(String(validatedData.start_date)) : null,
      end_date: null,
      description: template.description || null,
      status: 'not_started',
      is_inactive: false,
      tenant: tenant || undefined
    });

    const newProjectId = newProject.project_id;

    // 2. Load template phases (only if copyPhases is enabled)
    const templatePhases = options.copyPhases
      ? await trx('project_template_phases')
          .where({ template_id: templateId, tenant })
          .orderBy('order_key')
      : [];

    const phaseMap = new Map<string, string>(); // template_phase_id → new_phase_id

    // 3. Create phases (only if copyPhases is enabled)
    if (options.copyPhases) {
      for (const templatePhase of templatePhases) {
      const startDate = validatedData.start_date
        ? addDays(new Date(String(validatedData.start_date)), templatePhase.start_offset_days || 0)
        : null;

      const endDate = startDate && templatePhase.duration_days
        ? addDays(startDate, templatePhase.duration_days)
        : null;

      // Get next phase number for WBS
      const existingPhases = await trx('project_phases')
        .where({ project_id: newProjectId, tenant })
        .select('wbs_code');

      const phaseNumbers = existingPhases
        .map((phase) => {
          const parts = phase.wbs_code.split('.');
          return parseInt(parts[parts.length - 1]);
        })
        .filter(num => !isNaN(num));

      const maxPhaseNumber = phaseNumbers.length > 0 ? Math.max(...phaseNumbers) : 0;
      const newWbsCode = `${newProject.wbs_code}.${maxPhaseNumber + 1}`;

      const [newPhase] = await trx('project_phases')
        .insert({
          tenant,
          project_id: newProjectId,
          phase_name: templatePhase.phase_name,
          description: templatePhase.description,
          start_date: startDate,
          end_date: endDate,
          order_key: templatePhase.order_key,
          order_number: phaseNumbers.length + 1,
          wbs_code: newWbsCode,
          status: 'not_started'
        })
        .returning('*');

      phaseMap.set(templatePhase.template_phase_id, newPhase.phase_id);
      }
    }

    // 4. Handle status mappings BEFORE creating tasks (only if copyStatuses is enabled)
    let firstStatusMappingId: string | undefined;
    const templateStatusToProjectStatusMap = new Map<string, string>(); // template_status_mapping_id → project_status_mapping_id

    if (options.copyStatuses) {
      // Check if template has custom status mappings
      const templateStatuses = await trx('project_template_status_mappings')
        .where({ template_id: templateId, tenant })
        .orderBy('display_order');

      if (templateStatuses.length > 0) {
      // Remove default status mappings created by createProject
      await trx('project_status_mappings')
        .where({ project_id: newProjectId, tenant })
        .delete();

      // Add template status mappings and build mapping
      console.log(`[applyTemplate] Creating ${templateStatuses.length} status mappings from template`);
      for (const templateStatus of templateStatuses) {
        let statusIdToUse = templateStatus.status_id;

        // If it's a custom status (no status_id), create a new status first
        if (!templateStatus.status_id && templateStatus.custom_status_name) {
          const [newStatus] = await trx('project_task_statuses')
            .insert({
              tenant,
              name: templateStatus.custom_status_name,
              color: templateStatus.custom_status_color || '#6B7280',
              is_closed: false,
              is_standard: false,
              created_by: currentUser.user_id
            })
            .returning('*');

          statusIdToUse = newStatus.status_id;
          console.log(`[applyTemplate] Created custom status: "${newStatus.name}" (${newStatus.color}) → status_id=${newStatus.status_id}`);
        }

        const [newMapping] = await trx('project_status_mappings')
          .insert({
            tenant,
            project_id: newProjectId,
            status_id: statusIdToUse,
            custom_name: templateStatus.custom_status_name,
            display_order: templateStatus.display_order,
            is_visible: true,
            is_standard: templateStatus.status_id ? true : false
          })
          .returning('*');

        // Map template status to project status
        console.log(`[applyTemplate] Mapping: template_status_mapping_id=${templateStatus.template_status_mapping_id} → project_status_mapping_id=${newMapping.project_status_mapping_id} (display_order=${templateStatus.display_order})`);
        templateStatusToProjectStatusMap.set(
          templateStatus.template_status_mapping_id,
          newMapping.project_status_mapping_id
        );

        // Track first status mapping as fallback
        if (!firstStatusMappingId) {
          firstStatusMappingId = newMapping.project_status_mapping_id;
        }
      }
      } else {
        // No custom status mappings, use the default one created by createProject
        const defaultStatus = await trx('project_status_mappings')
          .where({ project_id: newProjectId, tenant })
          .orderBy('display_order')
          .first();

        firstStatusMappingId = defaultStatus?.project_status_mapping_id;
      }
    } else {
      // If not copying statuses, use default status mapping from createProject
      const defaultStatus = await trx('project_status_mappings')
        .where({ project_id: newProjectId, tenant })
        .orderBy('display_order')
        .first();

      firstStatusMappingId = defaultStatus?.project_status_mapping_id;
    }

    // 5. Create tasks (only if copyTasks is enabled)
    const templatePhaseIds = Array.from(phaseMap.keys());
    const taskMap = new Map<string, string>(); // template_task_id → new_task_id

    if (options.copyTasks && templatePhaseIds.length > 0) {
      const templateTasks = await trx('project_template_tasks')
        .where('tenant', tenant)
        .whereIn('template_phase_id', templatePhaseIds)
        .orderBy('order_key');

      for (const templateTask of templateTasks) {
      const newPhaseId = phaseMap.get(templateTask.template_phase_id);
      if (!newPhaseId) continue;

      // Get phase for WBS code
      const phase = await trx('project_phases')
        .where({ phase_id: newPhaseId, tenant })
        .first();

      if (!phase) continue;

      // Get next task number for WBS
      const existingTasks = await trx('project_tasks')
        .where({ phase_id: newPhaseId, tenant })
        .select('wbs_code');

      const taskNumbers = existingTasks
        .map((task) => {
          const parts = task.wbs_code.split('.');
          return parseInt(parts[parts.length - 1]);
        })
        .filter(num => !isNaN(num));

      const maxTaskNumber = taskNumbers.length > 0 ? Math.max(...taskNumbers) : 0;
      const newWbsCode = `${phase.wbs_code}.${maxTaskNumber + 1}`;

      // Calculate task due_date from phase start_date and task duration_days
      const dueDate = phase.start_date && templateTask.duration_days
        ? addDays(new Date(phase.start_date), templateTask.duration_days)
        : null;

      // Determine which status mapping to use for this task
      let taskStatusMappingId = firstStatusMappingId;
      if (templateTask.template_status_mapping_id) {
        // Try to map the template status to the project status
        const mappedStatusId = templateStatusToProjectStatusMap.get(templateTask.template_status_mapping_id);
        console.log(`[applyTemplate] Task "${templateTask.task_name}": template_status_mapping_id=${templateTask.template_status_mapping_id}, mapped to project_status_mapping_id=${mappedStatusId || 'NOT FOUND'}, using ${mappedStatusId || firstStatusMappingId}`);
        if (mappedStatusId) {
          taskStatusMappingId = mappedStatusId;
        }
      } else {
        console.log(`[applyTemplate] Task "${templateTask.task_name}": No template_status_mapping_id, using first status ${firstStatusMappingId}`);
      }

      const [newTask] = await trx('project_tasks')
        .insert({
          tenant,
          phase_id: newPhaseId,
          task_name: templateTask.task_name,
          description: templateTask.description,
          estimated_hours: templateTask.estimated_hours,
          task_type_key: templateTask.task_type_key || 'task',
          priority_id: templateTask.priority_id,
          order_key: templateTask.order_key,
          wbs_code: newWbsCode,
          project_status_mapping_id: taskStatusMappingId,
          assigned_to: templateTask.assigned_to || null,
          due_date: dueDate
        })
        .returning('*');

      taskMap.set(templateTask.template_task_id, newTask.task_id);
      }

      // Copy additional agent assignments
      if (templatePhaseIds.length > 0) {
        const templateTaskIds = Array.from(taskMap.keys());

        if (templateTaskIds.length > 0) {
          // Fetch all template task resources (additional agents)
          const templateResources = await trx('project_template_task_resources')
            .where('tenant', tenant)
            .whereIn('template_task_id', templateTaskIds);

          for (const resource of templateResources) {
            const newTaskId = taskMap.get(resource.template_task_id);
            if (!newTaskId) continue;

            // Get the task to find its assigned_to (primary agent)
            const task = await trx('project_tasks')
              .where({ task_id: newTaskId, tenant })
              .first();

            if (!task || !task.assigned_to) continue;

            // Check if user exists and is active
            const user = await trx('users')
              .where({ user_id: resource.user_id, tenant })
              .first();

            if (!user || user.is_inactive) {
              // Skip assignment if user doesn't exist or is inactive
              continue;
            }

            // Only add if additional user is different from primary
            if (resource.user_id !== task.assigned_to) {
              await trx('task_resources')
                .insert({
                  tenant,
                  task_id: newTaskId,
                  assigned_to: task.assigned_to,
                  additional_user_id: resource.user_id
                });
            }
          }
        }
      }
    }

    // 6. Create dependencies (REMAP IDs!) - only if copyDependencies and copyTasks are enabled
    if (options.copyDependencies && options.copyTasks) {
      const templateDeps = await trx('project_template_dependencies')
        .where({ template_id: templateId, tenant });

      for (const templateDep of templateDeps) {
      const newPredecessorId = taskMap.get(templateDep.predecessor_task_id);
      const newSuccessorId = taskMap.get(templateDep.successor_task_id);

      if (newPredecessorId && newSuccessorId) {
        await trx('project_task_dependencies')
          .insert({
            tenant,
            predecessor_task_id: newPredecessorId,
            successor_task_id: newSuccessorId,
            dependency_type: templateDep.dependency_type,
            lead_lag_days: templateDep.lead_lag_days || 0,
            notes: templateDep.notes
          });
      }
      }
    }

    // 7. Create checklists - only if copyChecklists and copyTasks are enabled
    if (options.copyChecklists && options.copyTasks) {
      const templateTaskIds = Array.from(taskMap.keys());
      if (templateTaskIds.length > 0) {
        const templateChecklists = await trx('project_template_checklist_items')
          .where('tenant', tenant)
          .whereIn('template_task_id', templateTaskIds);

        for (const templateItem of templateChecklists) {
        const newTaskId = taskMap.get(templateItem.template_task_id);

        if (newTaskId) {
          await trx('task_checklist_items')
            .insert({
              tenant,
              task_id: newTaskId,
              item_name: templateItem.item_name,
              description: templateItem.description,
              order_number: templateItem.order_number,
              completed: false
            });
        }
        }
      }
    }

    // 8. Update template usage stats
    await updateTemplateUsage(trx, templateId, tenant);

    return newProjectId;
  });
}

/**
 * Helper to update template usage statistics
 */
async function updateTemplateUsage(
  trx: Knex.Transaction,
  templateId: string,
  tenant: string | null
): Promise<void> {
  if (!tenant) {
    throw new Error('Tenant is required for updating template usage');
  }
  await trx('project_templates')
    .where({ template_id: templateId, tenant })
    .increment('use_count', 1)
    .update({
      last_used_at: trx.fn.now(),
      updated_at: trx.fn.now()
    });
}

/**
 * Get all templates with optional filtering
 */
export async function getTemplates(
  filters?: {
    category?: string;
    search?: string;
  }
): Promise<IProjectTemplate[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  await checkPermission(currentUser, 'project', 'read', knex);

  let query = knex('project_templates')
    .where({ tenant });

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
}

/**
 * Get template details with all related data
 */
export async function getTemplateWithDetails(
  templateId: string
): Promise<IProjectTemplateWithDetails | null> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  await checkPermission(currentUser, 'project', 'read', knex);

  const template = await knex('project_templates')
    .where({ template_id: templateId, tenant })
    .first();

  if (!template) {
    return null;
  }

  // Load all related data
  const [phases, dependencies, rawStatusMappings] = await Promise.all([
    knex('project_template_phases')
      .where({ template_id: templateId, tenant })
      .orderBy('order_key'),
    knex('project_template_dependencies')
      .where({ template_id: templateId, tenant }),
    knex('project_template_status_mappings')
      .where({ template_id: templateId, tenant })
      .orderBy('display_order')
  ]);

  // Enrich status mappings with actual status information
  const statusMappings = await Promise.all(
    rawStatusMappings.map(async (mapping: any) => {
      if (mapping.status_id) {
        // First, try standard_statuses (for standard statuses)
        const standardStatus = await knex('standard_statuses')
          .where({ standard_status_id: mapping.status_id, tenant })
          .first();

        if (standardStatus) {
          return {
            ...mapping,
            status_name: standardStatus.name,
            color: standardStatus.color || '#6B7280',
            is_closed: standardStatus.is_closed
          };
        }

        // If not found, try statuses table (for custom statuses)
        const customStatus = await knex('statuses')
          .where({ status_id: mapping.status_id, tenant })
          .first();

        if (customStatus) {
          return {
            ...mapping,
            status_name: customStatus.name,
            color: customStatus.color || '#6B7280',
            is_closed: customStatus.is_closed
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

  console.log(`[getTemplateWithDetails] Template: ${template.template_name}, phaseIds:`, phaseIds);

  if (phaseIds.length > 0) {
    tasks = await knex('project_template_tasks')
      .where('tenant', tenant)
      .whereIn('template_phase_id', phaseIds)
      .orderBy('order_key');

    console.log(`[getTemplateWithDetails] Found ${tasks.length} tasks for template ${template.template_name}`);
    if (tasks.length > 0) {
      console.log('[getTemplateWithDetails] First task:', tasks[0]);
    }

    const taskIds = tasks.map(t => t.template_task_id);
    if (taskIds.length > 0) {
      checklistItems = await knex('project_template_checklist_items')
        .where('tenant', tenant)
        .whereIn('template_task_id', taskIds)
        .orderBy('order_number');
    }
  }

  return {
    ...template,
    phases,
    tasks,
    dependencies,
    checklist_items: checklistItems,
    status_mappings: statusMappings
  };
}

/**
 * Update a template
 */
export async function updateTemplate(
  templateId: string,
  data: {
    template_name?: string;
    description?: string;
    category?: string;
  }
): Promise<IProjectTemplate> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const validatedData = validateData(updateTemplateSchema, data);
  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    const [updated] = await trx('project_templates')
      .where({ template_id: templateId, tenant })
      .update({
        ...validatedData,
        updated_at: trx.fn.now()
      })
      .returning('*');

    if (!updated) {
      throw new Error('Template not found');
    }

    return updated;
  });
}

/**
 * Delete a template
 */
export async function deleteTemplate(templateId: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'delete', trx);

    // Cascade delete handled by FK constraints
    const deleted = await trx('project_templates')
      .where({ template_id: templateId, tenant })
      .delete();

    if (deleted === 0) {
      throw new Error('Template not found');
    }
  });
}

/**
 * Duplicate a template
 * @deprecated Use saveTemplateAsNew from projectTemplateWizardActions instead.
 * This function remains for backwards compatibility but new code should use the wizard-based approach.
 */
export async function duplicateTemplate(templateId: string): Promise<string> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'create', trx);

    const originalTemplate = await trx('project_templates')
      .where({ template_id: templateId, tenant })
      .first();

    if (!originalTemplate) {
      throw new Error('Template not found');
    }

    // Create new template
    const [newTemplate] = await trx('project_templates')
      .insert({
        tenant,
        template_name: `${originalTemplate.template_name} (Copy)`,
        description: originalTemplate.description,
        category: originalTemplate.category,
        created_by: currentUser.user_id,
        use_count: 0
      })
      .returning('*');

    // Copy phases
    const phases = await trx('project_template_phases')
      .where({ template_id: templateId, tenant })
      .orderBy('order_key');

    const phaseMap = new Map<string, string>();

    for (const phase of phases) {
      const [newPhase] = await trx('project_template_phases')
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
      const tasks = await trx('project_template_tasks')
        .where('tenant', tenant)
        .whereIn('template_phase_id', phaseIds);

      const taskMap = new Map<string, string>();

      for (const task of tasks) {
        const newPhaseId = phaseMap.get(task.template_phase_id);
        if (!newPhaseId) continue;

        const [newTask] = await trx('project_template_tasks')
          .insert({
            tenant,
            template_phase_id: newPhaseId,
            task_name: task.task_name,
            description: task.description,
            estimated_hours: task.estimated_hours,
            duration_days: task.duration_days,
            task_type_key: task.task_type_key,
            priority_id: task.priority_id,
            order_key: task.order_key
          })
          .returning('*');

        taskMap.set(task.template_task_id, newTask.template_task_id);
      }

      // Copy dependencies
      const deps = await trx('project_template_dependencies')
        .where({ template_id: templateId, tenant });

      for (const dep of deps) {
        const newPred = taskMap.get(dep.predecessor_task_id);
        const newSucc = taskMap.get(dep.successor_task_id);

        if (newPred && newSucc) {
          await trx('project_template_dependencies')
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
        const checklists = await trx('project_template_checklist_items')
          .where('tenant', tenant)
          .whereIn('template_task_id', taskIds);

        for (const item of checklists) {
          const newTaskId = taskMap.get(item.template_task_id);
          if (newTaskId) {
            await trx('project_template_checklist_items')
              .insert({
                tenant,
                template_task_id: newTaskId,
                item_name: item.item_name,
                description: item.description,
                order_number: item.order_number
              });
          }
        }
      }
    }

    // Copy status mappings
    const statusMappings = await trx('project_template_status_mappings')
      .where({ template_id: templateId, tenant });

    for (const mapping of statusMappings) {
      await trx('project_template_status_mappings')
        .insert({
          tenant,
          template_id: newTemplate.template_id,
          status_id: mapping.status_id,
          custom_status_name: mapping.custom_status_name,
          display_order: mapping.display_order
        });
    }

    return newTemplate.template_id;
  });
}

/**
 * Get template categories (unique list)
 */
export async function getTemplateCategories(): Promise<string[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  const results = await knex('project_templates')
    .where({ tenant })
    .whereNotNull('category')
    .distinct('category')
    .orderBy('category');

  return results.map(r => r.category).filter(Boolean);
}
