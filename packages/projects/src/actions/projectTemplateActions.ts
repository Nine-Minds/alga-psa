'use server';

import { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
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
import { addDays } from 'date-fns';
import { publishEvent } from 'server/src/lib/eventBus/publishers';
import ProjectModel from 'server/src/lib/models/project';
import { SharedNumberingService } from '@shared/services/numberingService';
import { getProjectStatuses } from './projectActions';
import type { IUser } from '@alga-psa/types';
import { validateData } from '@alga-psa/validation';
import {
  createTemplateSchema,
  updateTemplateSchema,
  applyTemplateSchema
} from 'server/src/lib/schemas/projectTemplate.schemas';
import { OrderingService } from '../lib/orderingService';
import { generateKeyBetween } from 'fractional-indexing';

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
    copyChecklists?: boolean;
    copyServices?: boolean;
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
    copyAssignments: options?.copyAssignments ?? false,
    copyChecklists: options?.copyChecklists ?? true,
    copyServices: options?.copyServices ?? true
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
          duration_days,
          service_id: copyOptions.copyServices ? (task.service_id || null) : null
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

      // Copy checklists (if enabled)
      if (copyOptions.copyChecklists) {
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
                order_number: item.order_number,
                completed: item.completed ?? false
              });
          }
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
      copyServices?: boolean;
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
    copyServices: validatedData.options?.copyServices ?? true,
    assignmentOption: validatedData.options?.assignmentOption ?? 'primary'
  };

  const { knex, tenant } = await createTenantKnex();

  const projectId = await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'create', trx);

    // Verify template exists
    const template = await trx('project_templates')
      .where({ template_id: templateId, tenant })
      .first();

    if (!template) {
      throw new Error('Template not found');
    }

    // 1. Pre-load template statuses
    const templateStatuses = options.copyStatuses
      ? await trx('project_template_status_mappings')
          .where({ template_id: templateId, tenant })
          .orderBy('display_order')
      : [];

    // 2. Create project directly (no need to call createProject which has extra overhead)
    // Get project statuses for the project status field
    const projectStatuses = await getProjectStatuses();
    if (projectStatuses.length === 0) {
      throw new Error('No project statuses found');
    }
    const defaultProjectStatus = projectStatuses[0];

    // Generate project number and WBS code
    const projectNumber = await SharedNumberingService.getNextNumber(
      'PROJECT',
      { knex: trx, tenant: tenant! }
    );
    const wbsCode = await ProjectModel.generateNextWbsCode(trx, '');

    console.log(`[applyTemplate] Creating project "${validatedData.project_name}" with number ${projectNumber}`);

    // Create the project record
    const newProject = await ProjectModel.create(trx, {
      project_name: validatedData.project_name,
      client_id: validatedData.client_id,
      assigned_to: validatedData.assigned_to ? String(validatedData.assigned_to) : null,
      start_date: validatedData.start_date ? new Date(String(validatedData.start_date)) : null,
      end_date: null,
      description: template.description || null,
      status: defaultProjectStatus.status_id,
      status_name: defaultProjectStatus.name,
      is_closed: defaultProjectStatus.is_closed,
      is_inactive: false,
      wbs_code: wbsCode,
      project_number: projectNumber
    });

    const newProjectId = newProject.project_id;
    console.log(`[applyTemplate] Created project ${newProjectId}`);

    // Apply client_portal_config from template
    if (template.client_portal_config) {
      await trx('projects')
        .where({ project_id: newProjectId, tenant })
        .update({ client_portal_config: template.client_portal_config });
    }

    // 3. Load template phases (only if copyPhases is enabled)
    const templatePhases = options.copyPhases
      ? await trx('project_template_phases')
          .where({ template_id: templateId, tenant })
          .orderBy('order_key')
      : [];

    const phaseMap = new Map<string, string>(); // template_phase_id → new_phase_id

    // 4. Create phases (only if copyPhases is enabled)
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

    // 5. Handle status mappings BEFORE creating tasks (only if copyStatuses is enabled)
    let firstStatusMappingId: string | undefined;
    const templateStatusToProjectStatusMap = new Map<string, string>(); // template_status_mapping_id → project_status_mapping_id

    if (options.copyStatuses && templateStatuses.length > 0) {
      // No need to delete - we passed empty array to createProject so no status mappings were created
      // Add template status mappings and build mapping
      console.log(`[applyTemplate] Creating ${templateStatuses.length} status mappings from template`);
      for (const templateStatus of templateStatuses) {
        let statusIdToUse = templateStatus.status_id;

        // If it's a custom status (no status_id), look for existing or create a new status
        if (!templateStatus.status_id && templateStatus.custom_status_name) {
          try {
            // First, check if a status with this name already exists for the tenant
            const existingStatus = await trx('statuses')
              .where({
                tenant,
                status_type: 'project_task',
                name: templateStatus.custom_status_name
              })
              .first();

            if (existingStatus) {
              // Reuse existing status
              statusIdToUse = existingStatus.status_id;
              console.log(`[applyTemplate] Using existing status: "${existingStatus.name}" → status_id=${existingStatus.status_id}`);
            } else {
              // Get next order number for the new status
              const maxOrder = await trx('statuses')
                .where({ tenant, status_type: 'project_task' })
                .max('order_number as max')
                .first();
              const orderNumber = (maxOrder?.max ?? 0) + 1;

              console.log(`[applyTemplate] Creating custom status: "${templateStatus.custom_status_name}" with order_number=${orderNumber}`);

              const insertResult = await trx('statuses')
                .insert({
                  tenant,
                  item_type: 'project_task',
                  status_type: 'project_task',
                  name: templateStatus.custom_status_name,
                  color: templateStatus.custom_status_color || '#6B7280',
                  is_closed: false,
                  order_number: orderNumber,
                  created_at: new Date().toISOString()
                })
                .returning('*');

              if (!insertResult || insertResult.length === 0) {
                throw new Error(`Failed to create custom status "${templateStatus.custom_status_name}" - insert returned empty result`);
              }

              const newStatus = insertResult[0];
              statusIdToUse = newStatus.status_id;
              console.log(`[applyTemplate] Created custom status: "${newStatus.name}" (${newStatus.color}) → status_id=${newStatus.status_id}`);
            }
          } catch (statusError) {
            console.error(`[applyTemplate] Error creating custom status "${templateStatus.custom_status_name}":`, statusError);
            throw statusError;
          }
        }

        const [newMapping] = await trx('project_status_mappings')
          .insert({
            tenant,
            project_id: newProjectId,
            status_id: statusIdToUse,
            custom_name: templateStatus.custom_status_name,
            display_order: templateStatus.display_order,
            is_visible: true,
            is_standard: false  // Custom statuses from the statuses table are never standard
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
      // Not copying statuses from template - create default status mappings
      console.log(`[applyTemplate] Creating default status mappings`);
      const defaultStatuses = await trx('statuses')
        .where({ tenant, status_type: 'project_task' })
        .orderBy('order_number')
        .limit(5);  // Limit to a reasonable number of default statuses

      for (let i = 0; i < defaultStatuses.length; i++) {
        const status = defaultStatuses[i];
        const [newMapping] = await trx('project_status_mappings')
          .insert({
            tenant,
            project_id: newProjectId,
            status_id: status.status_id,
            custom_name: null,
            display_order: i + 1,
            is_visible: true,
            is_standard: false
          })
          .returning('*');

        if (!firstStatusMappingId) {
          firstStatusMappingId = newMapping.project_status_mapping_id;
        }
      }
    }

    // 6. Create tasks (only if copyTasks is enabled)
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

      // Determine assigned_to based on assignmentOption
      let taskAssignedTo: string | null = null;
      if (options.assignmentOption === 'primary' || options.assignmentOption === 'all') {
        taskAssignedTo = templateTask.assigned_to || null;
      }
      // If assignmentOption is 'none', taskAssignedTo remains null

      try {
        const taskInsertData = {
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
          assigned_to: taskAssignedTo,
          due_date: dueDate,
          service_id: options.copyServices ? (templateTask.service_id || null) : null
        };
        console.log(`[applyTemplate] Inserting task:`, JSON.stringify(taskInsertData, null, 2));

        const [newTask] = await trx('project_tasks')
          .insert(taskInsertData)
          .returning('*');

        taskMap.set(templateTask.template_task_id, newTask.task_id);
      } catch (taskError) {
        console.error(`[applyTemplate] Failed to insert task "${templateTask.task_name}":`, taskError);
        throw taskError;
      }
      }

      // Copy additional agent assignments (only if assignmentOption is 'all')
      if (options.assignmentOption === 'all' && templatePhaseIds.length > 0) {
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

    // 7. Create dependencies (REMAP IDs!) - only if copyDependencies and copyTasks are enabled
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

    // 8. Create checklists - only if copyChecklists and copyTasks are enabled
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
              completed: templateItem.completed ?? false
            });
        }
        }
      }
    }

    // 9. Update template usage stats
    await updateTemplateUsage(trx, templateId, tenant);

    return newProjectId;
  });

  // Publish project created event AFTER transaction commits successfully
  // This ensures we don't publish events for projects that fail to be created
  await publishEvent({
    eventType: 'PROJECT_CREATED',
    payload: {
      tenantId: tenant!,
      projectId: projectId,
      userId: currentUser.user_id,
      timestamp: new Date().toISOString()
    }
  });

  return projectId;
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
  let taskAssignments: any[] = [];

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
      [checklistItems, taskAssignments] = await Promise.all([
        knex('project_template_checklist_items')
          .where('tenant', tenant)
          .whereIn('template_task_id', taskIds)
          .orderBy('order_number'),
        knex('project_template_task_resources')
          .where('tenant', tenant)
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
    client_portal_config?: import('server/src/interfaces/project.interfaces').IClientPortalConfig;
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

    // Handle client_portal_config JSON serialization
    const { client_portal_config, ...restData } = validatedData;
    const updateData: Record<string, unknown> = {
      ...restData,
      updated_at: trx.fn.now()
    };
    if (client_portal_config !== undefined) {
      updateData.client_portal_config = JSON.stringify(client_portal_config);
    }

    const [updated] = await trx('project_templates')
      .where({ template_id: templateId, tenant })
      .update(updateData)
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
            order_key: task.order_key,
            service_id: task.service_id || null
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
                order_number: item.order_number,
                completed: item.completed ?? false
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

  await checkPermission(currentUser, 'project', 'read', knex);

  const results = await knex('project_templates')
    .where({ tenant })
    .whereNotNull('category')
    .distinct('category')
    .orderBy('category');

  return results.map(r => r.category).filter(Boolean);
}

// ============================================================
// TEMPLATE DEPENDENCY ACTIONS
// ============================================================

/**
 * Add a dependency to a template task
 */
export async function addTemplateDependency(
  templateId: string,
  predecessorTaskId: string,
  successorTaskId: string,
  dependencyType: DependencyType,
  leadLagDays: number = 0,
  notes?: string
): Promise<IProjectTemplateDependency> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex: db, tenant } = await createTenantKnex();

  return await withTransaction(db, async (trx) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    // Validate that both tasks belong to the template
    const tasks = await trx('project_template_tasks')
      .where('tenant', tenant)
      .whereIn('template_task_id', [predecessorTaskId, successorTaskId]);

    if (tasks.length !== 2) {
      throw new Error('Invalid task IDs');
    }

    // Check for self-reference
    if (predecessorTaskId === successorTaskId) {
      throw new Error('A task cannot depend on itself');
    }

    // Check for existing dependency
    const existing = await trx('project_template_dependencies')
      .where({
        tenant,
        predecessor_task_id: predecessorTaskId,
        successor_task_id: successorTaskId
      })
      .first();

    if (existing) {
      throw new Error('This dependency already exists');
    }

    // Insert new dependency
    const [dependency] = await trx('project_template_dependencies')
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
}

/**
 * Update a template dependency
 */
export async function updateTemplateDependency(
  dependencyId: string,
  data: {
    dependency_type?: DependencyType;
    lead_lag_days?: number;
    notes?: string;
  }
): Promise<IProjectTemplateDependency> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex: db, tenant } = await createTenantKnex();

  return await withTransaction(db, async (trx) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    const [dependency] = await trx('project_template_dependencies')
      .where({ template_dependency_id: dependencyId, tenant })
      .update(data)
      .returning('*');

    if (!dependency) {
      throw new Error('Dependency not found');
    }

    return dependency;
  });
}

/**
 * Remove a template dependency
 */
export async function removeTemplateDependency(dependencyId: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex: db, tenant } = await createTenantKnex();

  return await withTransaction(db, async (trx) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    const deleted = await trx('project_template_dependencies')
      .where({ template_dependency_id: dependencyId, tenant })
      .delete();

    if (!deleted) {
      throw new Error('Dependency not found');
    }
  });
}

/**
 * Get all dependencies for a template
 */
export async function getTemplateDependencies(templateId: string): Promise<IProjectTemplateDependency[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  await checkPermission(currentUser, 'project', 'read', knex);

  return await knex('project_template_dependencies')
    .where({ template_id: templateId, tenant });
}

/**
 * Get dependencies for a specific task (both as predecessor and successor)
 */
export async function getTaskTemplateDependencies(taskId: string): Promise<{
  predecessors: IProjectTemplateDependency[];
  successors: IProjectTemplateDependency[];
}> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  await checkPermission(currentUser, 'project', 'read', knex);

  const [predecessors, successors] = await Promise.all([
    knex('project_template_dependencies as ptd')
      .where({ 'ptd.successor_task_id': taskId, 'ptd.tenant': tenant })
      .leftJoin('project_template_tasks as ptt', function() {
        this.on('ptd.predecessor_task_id', '=', 'ptt.template_task_id')
            .andOn('ptd.tenant', '=', 'ptt.tenant');
      })
      .select('ptd.*', 'ptt.task_name as predecessor_task_name'),
    knex('project_template_dependencies as ptd')
      .where({ 'ptd.predecessor_task_id': taskId, 'ptd.tenant': tenant })
      .leftJoin('project_template_tasks as ptt', function() {
        this.on('ptd.successor_task_id', '=', 'ptt.template_task_id')
            .andOn('ptd.tenant', '=', 'ptt.tenant');
      })
      .select('ptd.*', 'ptt.task_name as successor_task_name')
  ]);

  return { predecessors, successors };
}

// ============================================================
// GRANULAR UPDATE ACTIONS FOR TEMPLATE EDITOR
// ============================================================

/**
 * Add a new phase to a template
 */
export async function addTemplatePhase(
  templateId: string,
  phaseData: {
    phase_name: string;
    description?: string;
    duration_days?: number;
    start_offset_days?: number;
  },
  afterPhaseId?: string | null
): Promise<IProjectTemplatePhase> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    // Verify template exists
    const template = await trx('project_templates')
      .where({ template_id: templateId, tenant })
      .first();

    if (!template) {
      throw new Error('Template not found');
    }

    // Get existing phases to determine order_key
    const existingPhases = await trx('project_template_phases')
      .where({ template_id: templateId, tenant })
      .orderBy('order_key');

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

    const [newPhase] = await trx('project_template_phases')
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
    await trx('project_templates')
      .where({ template_id: templateId, tenant })
      .update({ updated_at: trx.fn.now() });

    return newPhase;
  });
}

/**
 * Update a template phase
 */
export async function updateTemplatePhase(
  phaseId: string,
  data: {
    phase_name?: string;
    description?: string;
    duration_days?: number;
    start_offset_days?: number;
  }
): Promise<IProjectTemplatePhase> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    const [updated] = await trx('project_template_phases')
      .where({ template_phase_id: phaseId, tenant })
      .update(data)
      .returning('*');

    if (!updated) {
      throw new Error('Phase not found');
    }

    // Update template timestamp
    await trx('project_templates')
      .where({ template_id: updated.template_id, tenant })
      .update({ updated_at: trx.fn.now() });

    return updated;
  });
}

/**
 * Delete a template phase (and cascade delete tasks)
 */
export async function deleteTemplatePhase(phaseId: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    const phase = await trx('project_template_phases')
      .where({ template_phase_id: phaseId, tenant })
      .first();

    if (!phase) {
      throw new Error('Phase not found');
    }

    // Delete phase (FK cascade handles tasks/checklists)
    await trx('project_template_phases')
      .where({ template_phase_id: phaseId, tenant })
      .delete();

    // Update template timestamp
    await trx('project_templates')
      .where({ template_id: phase.template_id, tenant })
      .update({ updated_at: trx.fn.now() });
  });
}

/**
 * Reorder a template phase
 */
export async function reorderTemplatePhase(
  phaseId: string,
  beforePhaseId: string | null,
  afterPhaseId: string | null
): Promise<IProjectTemplatePhase> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    const phase = await trx('project_template_phases')
      .where({ template_phase_id: phaseId, tenant })
      .first();

    if (!phase) {
      throw new Error('Phase not found');
    }

    // Get order keys
    let beforeKey: string | null = null;
    let afterKey: string | null = null;

    if (beforePhaseId) {
      const beforePhase = await trx('project_template_phases')
        .where({ template_phase_id: beforePhaseId, tenant })
        .first();
      beforeKey = beforePhase?.order_key || null;
    }

    if (afterPhaseId) {
      const afterPhase = await trx('project_template_phases')
        .where({ template_phase_id: afterPhaseId, tenant })
        .first();
      afterKey = afterPhase?.order_key || null;
    }

    const newOrderKey = generateKeyBetween(beforeKey, afterKey);

    const [updated] = await trx('project_template_phases')
      .where({ template_phase_id: phaseId, tenant })
      .update({ order_key: newOrderKey })
      .returning('*');

    // Update template timestamp
    await trx('project_templates')
      .where({ template_id: phase.template_id, tenant })
      .update({ updated_at: trx.fn.now() });

    return updated;
  });
}

/**
 * Add a new task to a template phase
 */
export async function addTemplateTask(
  phaseId: string,
  taskData: {
    task_name: string;
    description?: string;
    estimated_hours?: number;
    duration_days?: number;
    task_type_key?: string;
    priority_id?: string;
    assigned_to?: string;
    template_status_mapping_id?: string;
    service_id?: string | null;
  },
  afterTaskId?: string | null
): Promise<IProjectTemplateTask> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    // Verify phase exists
    const phase = await trx('project_template_phases')
      .where({ template_phase_id: phaseId, tenant })
      .first();

    if (!phase) {
      throw new Error('Phase not found');
    }

    // Get existing tasks to determine order_key
    const existingTasks = await trx('project_template_tasks')
      .where({ template_phase_id: phaseId, tenant })
      .orderBy('order_key');

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

    const [newTask] = await trx('project_template_tasks')
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
        template_status_mapping_id: taskData.template_status_mapping_id || null,
        service_id: taskData.service_id || null,
        order_key: orderKey
      })
      .returning('*');

    // Update template timestamp
    await trx('project_templates')
      .where({ template_id: phase.template_id, tenant })
      .update({ updated_at: trx.fn.now() });

    return newTask;
  });
}

/**
 * Update a template task
 */
export async function updateTemplateTask(
  taskId: string,
  data: {
    task_name?: string;
    description?: string;
    estimated_hours?: number;
    duration_days?: number;
    task_type_key?: string;
    priority_id?: string;
    assigned_to?: string | null;
    template_status_mapping_id?: string | null;
    template_phase_id?: string;
    order_key?: string;
    service_id?: string | null;
  }
): Promise<IProjectTemplateTask> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    const [updated] = await trx('project_template_tasks')
      .where({ template_task_id: taskId, tenant })
      .update(data)
      .returning('*');

    if (!updated) {
      throw new Error('Task not found');
    }

    // Get phase to update template timestamp
    const phase = await trx('project_template_phases')
      .where({ template_phase_id: updated.template_phase_id, tenant })
      .first();

    if (phase) {
      await trx('project_templates')
        .where({ template_id: phase.template_id, tenant })
        .update({ updated_at: trx.fn.now() });
    }

    return updated;
  });
}

/**
 * Delete a template task
 */
export async function deleteTemplateTask(taskId: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    const task = await trx('project_template_tasks')
      .where({ template_task_id: taskId, tenant })
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Get phase for template update
    const phase = await trx('project_template_phases')
      .where({ template_phase_id: task.template_phase_id, tenant })
      .first();

    // Delete task (FK cascade handles checklists)
    await trx('project_template_tasks')
      .where({ template_task_id: taskId, tenant })
      .delete();

    // Update template timestamp
    if (phase) {
      await trx('project_templates')
        .where({ template_id: phase.template_id, tenant })
        .update({ updated_at: trx.fn.now() });
    }
  });
}

/**
 * Move a task to a different phase or reorder within same phase
 */
export async function moveTemplateTask(
  taskId: string,
  targetPhaseId: string,
  targetStatusMappingId?: string | null,
  beforeTaskId?: string | null,
  afterTaskId?: string | null
): Promise<IProjectTemplateTask> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    const task = await trx('project_template_tasks')
      .where({ template_task_id: taskId, tenant })
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Get order keys
    let beforeKey: string | null = null;
    let afterKey: string | null = null;

    if (beforeTaskId) {
      const beforeTask = await trx('project_template_tasks')
        .where({ template_task_id: beforeTaskId, tenant })
        .first();
      beforeKey = beforeTask?.order_key || null;
    }

    if (afterTaskId) {
      const afterTask = await trx('project_template_tasks')
        .where({ template_task_id: afterTaskId, tenant })
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

    const [updated] = await trx('project_template_tasks')
      .where({ template_task_id: taskId, tenant })
      .update(updateData)
      .returning('*');

    // Get phase for template update
    const phase = await trx('project_template_phases')
      .where({ template_phase_id: targetPhaseId, tenant })
      .first();

    if (phase) {
      await trx('project_templates')
        .where({ template_id: phase.template_id, tenant })
        .update({ updated_at: trx.fn.now() });
    }

    return updated;
  });
}

/**
 * Update task status (move between status columns)
 */
export async function updateTemplateTaskStatus(
  taskId: string,
  statusMappingId: string,
  beforeTaskId?: string | null,
  afterTaskId?: string | null
): Promise<IProjectTemplateTask> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    const task = await trx('project_template_tasks')
      .where({ template_task_id: taskId, tenant })
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Calculate new order key
    let beforeKey: string | null = null;
    let afterKey: string | null = null;

    if (beforeTaskId) {
      const beforeTask = await trx('project_template_tasks')
        .where({ template_task_id: beforeTaskId, tenant })
        .first();
      beforeKey = beforeTask?.order_key || null;
    }

    if (afterTaskId) {
      const afterTask = await trx('project_template_tasks')
        .where({ template_task_id: afterTaskId, tenant })
        .first();
      afterKey = afterTask?.order_key || null;
    }

    const newOrderKey = generateKeyBetween(beforeKey, afterKey);

    const [updated] = await trx('project_template_tasks')
      .where({ template_task_id: taskId, tenant })
      .update({
        template_status_mapping_id: statusMappingId,
        order_key: newOrderKey
      })
      .returning('*');

    // Get phase for template update
    const phase = await trx('project_template_phases')
      .where({ template_phase_id: task.template_phase_id, tenant })
      .first();

    if (phase) {
      await trx('project_templates')
        .where({ template_id: phase.template_id, tenant })
        .update({ updated_at: trx.fn.now() });
    }

    return updated;
  });
}

/**
 * Add a status mapping to a template
 */
export async function addTemplateStatusMapping(
  templateId: string,
  data: {
    status_id: string;
  }
): Promise<any> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    // Get existing mappings to determine display_order
    const existingMappings = await trx('project_template_status_mappings')
      .where({ template_id: templateId, tenant })
      .orderBy('display_order');

    const maxOrder = existingMappings.length > 0
      ? Math.max(...existingMappings.map(m => m.display_order))
      : 0;

    const [newMapping] = await trx('project_template_status_mappings')
      .insert({
        tenant,
        template_id: templateId,
        status_id: data.status_id,
        display_order: maxOrder + 1
      })
      .returning('*');

    // Enrich with status info
    const status = await trx('statuses')
      .where({ status_id: data.status_id, tenant })
      .first();

    await trx('project_templates')
      .where({ template_id: templateId, tenant })
      .update({ updated_at: trx.fn.now() });

    return {
      ...newMapping,
      status_name: status?.name,
      color: status?.color || '#6B7280',
      is_closed: status?.is_closed
    };
  });
}

/**
 * Remove a status mapping from a template
 */
export async function removeTemplateStatusMapping(
  mappingId: string
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    const mapping = await trx('project_template_status_mappings')
      .where({ template_status_mapping_id: mappingId, tenant })
      .first();

    if (!mapping) {
      throw new Error('Status mapping not found');
    }

    // Clear template_status_mapping_id from tasks that use this status
    await trx('project_template_tasks')
      .where({ template_status_mapping_id: mappingId, tenant })
      .update({ template_status_mapping_id: null });

    // Delete the mapping
    await trx('project_template_status_mappings')
      .where({ template_status_mapping_id: mappingId, tenant })
      .delete();

    await trx('project_templates')
      .where({ template_id: mapping.template_id, tenant })
      .update({ updated_at: trx.fn.now() });
  });
}

/**
 * Reorder status mappings
 */
export async function reorderTemplateStatusMappings(
  templateId: string,
  orderedMappingIds: string[]
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    // Update display_order for each mapping
    for (let i = 0; i < orderedMappingIds.length; i++) {
      await trx('project_template_status_mappings')
        .where({ template_status_mapping_id: orderedMappingIds[i], tenant })
        .update({ display_order: i });
    }

    await trx('project_templates')
      .where({ template_id: templateId, tenant })
      .update({ updated_at: trx.fn.now() });
  });
}

// ============================================================
// TASK RESOURCE (ADDITIONAL AGENTS) ACTIONS
// ============================================================

/**
 * Get additional agents for a task
 */
export async function getTaskAdditionalAgents(taskId: string): Promise<string[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  await checkPermission(currentUser, 'project', 'read', knex);

  const resources = await knex('project_template_task_resources')
    .where({ template_task_id: taskId, tenant })
    .select('user_id');

  return resources.map((r: { user_id: string }) => r.user_id);
}

/**
 * Set additional agents for a task (replaces all existing)
 */
export async function setTaskAdditionalAgents(
  taskId: string,
  userIds: string[]
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    // Verify task exists
    const task = await trx('project_template_tasks')
      .where({ template_task_id: taskId, tenant })
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Delete existing resources
    await trx('project_template_task_resources')
      .where({ template_task_id: taskId, tenant })
      .delete();

    // Insert new resources
    if (userIds.length > 0) {
      const resources = userIds.map(userId => ({
        tenant,
        template_task_id: taskId,
        user_id: userId
      }));
      await trx('project_template_task_resources').insert(resources);
    }

    // Update template timestamp via phase
    const phase = await trx('project_template_phases')
      .where({ template_phase_id: task.template_phase_id, tenant })
      .first();

    if (phase) {
      await trx('project_templates')
        .where({ template_id: phase.template_id, tenant })
        .update({ updated_at: trx.fn.now() });
    }
  });
}

/**
 * Add an additional agent to a task
 */
export async function addTaskAdditionalAgent(
  taskId: string,
  userId: string
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    // Verify task exists
    const task = await trx('project_template_tasks')
      .where({ template_task_id: taskId, tenant })
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Check if already exists
    const existing = await trx('project_template_task_resources')
      .where({ template_task_id: taskId, user_id: userId, tenant })
      .first();

    if (!existing) {
      await trx('project_template_task_resources').insert({
        tenant,
        template_task_id: taskId,
        user_id: userId
      });
    }

    // Update template timestamp via phase
    const phase = await trx('project_template_phases')
      .where({ template_phase_id: task.template_phase_id, tenant })
      .first();

    if (phase) {
      await trx('project_templates')
        .where({ template_id: phase.template_id, tenant })
        .update({ updated_at: trx.fn.now() });
    }
  });
}

/**
 * Remove an additional agent from a task
 */
export async function removeTaskAdditionalAgent(
  taskId: string,
  userId: string
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    await trx('project_template_task_resources')
      .where({ template_task_id: taskId, user_id: userId, tenant })
      .delete();

    // Get task for template update
    const task = await trx('project_template_tasks')
      .where({ template_task_id: taskId, tenant })
      .first();

    if (task) {
      const phase = await trx('project_template_phases')
        .where({ template_phase_id: task.template_phase_id, tenant })
        .first();

      if (phase) {
        await trx('project_templates')
          .where({ template_id: phase.template_id, tenant })
          .update({ updated_at: trx.fn.now() });
      }
    }
  });
}

// ============================================================
// TEMPLATE CHECKLIST ACTIONS
// ============================================================

/**
 * Get all checklist items for a template task
 */
export async function getTemplateTaskChecklistItems(
  taskId: string
): Promise<IProjectTemplateChecklistItem[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  const items = await knex('project_template_checklist_items')
    .where({ template_task_id: taskId, tenant })
    .orderBy('order_number');

  return items;
}

/**
 * Add a checklist item to a template task
 */
export async function addTemplateChecklistItem(
  taskId: string,
  data: {
    item_name: string;
    description?: string;
    completed?: boolean;
    order_number?: number;
  }
): Promise<IProjectTemplateChecklistItem> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    // Verify task exists
    const task = await trx('project_template_tasks')
      .where({ template_task_id: taskId, tenant })
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Use provided order_number or calculate from max
    let orderNumber = data.order_number;
    if (orderNumber === undefined) {
      const maxOrder = await trx('project_template_checklist_items')
        .where({ template_task_id: taskId, tenant })
        .max('order_number as max')
        .first();
      orderNumber = (maxOrder?.max ?? -1) + 1;
    }

    // Insert checklist item
    const [item] = await trx('project_template_checklist_items')
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
    const phase = await trx('project_template_phases')
      .where({ template_phase_id: task.template_phase_id, tenant })
      .first();

    if (phase) {
      await trx('project_templates')
        .where({ template_id: phase.template_id, tenant })
        .update({ updated_at: trx.fn.now() });
    }

    return item;
  });
}

/**
 * Update a template checklist item
 */
export async function updateTemplateChecklistItem(
  checklistId: string,
  data: {
    item_name?: string;
    description?: string;
    order_number?: number;
    completed?: boolean;
  }
): Promise<IProjectTemplateChecklistItem> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    const [updated] = await trx('project_template_checklist_items')
      .where({ template_checklist_id: checklistId, tenant })
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
    const task = await trx('project_template_tasks')
      .where({ template_task_id: updated.template_task_id, tenant })
      .first();

    if (task) {
      const phase = await trx('project_template_phases')
        .where({ template_phase_id: task.template_phase_id, tenant })
        .first();

      if (phase) {
        await trx('project_templates')
          .where({ template_id: phase.template_id, tenant })
          .update({ updated_at: trx.fn.now() });
      }
    }

    return updated;
  });
}

/**
 * Delete a template checklist item
 */
export async function deleteTemplateChecklistItem(
  checklistId: string
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    // Get item first to find task for timestamp update
    const item = await trx('project_template_checklist_items')
      .where({ template_checklist_id: checklistId, tenant })
      .first();

    if (!item) {
      throw new Error('Checklist item not found');
    }

    // Delete the item
    await trx('project_template_checklist_items')
      .where({ template_checklist_id: checklistId, tenant })
      .delete();

    // Update template timestamp via task -> phase
    const task = await trx('project_template_tasks')
      .where({ template_task_id: item.template_task_id, tenant })
      .first();

    if (task) {
      const phase = await trx('project_template_phases')
        .where({ template_phase_id: task.template_phase_id, tenant })
        .first();

      if (phase) {
        await trx('project_templates')
          .where({ template_id: phase.template_id, tenant })
          .update({ updated_at: trx.fn.now() });
      }
    }
  });
}

/**
 * Batch save checklist items for a template task.
 * Handles creates, updates, and deletes in a single transaction for atomicity.
 *
 * @param taskId - The template task ID
 * @param items - Array of checklist items to save. Items with "temp_" prefix ids are new items to create.
 * @returns The saved checklist items
 */
export async function saveTemplateChecklistItems(
  taskId: string,
  items: Array<{
    id: string; // template_checklist_id for existing, "temp_..." for new
    item_name: string;
    description?: string;
    completed: boolean;
    order_number: number;
  }>
): Promise<IProjectTemplateChecklistItem[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'update', trx);

    // Verify task exists
    const task = await trx('project_template_tasks')
      .where({ template_task_id: taskId, tenant })
      .first();

    if (!task) {
      throw new Error('Task not found');
    }

    // Get existing items for this task
    const existingItems = await trx('project_template_checklist_items')
      .where({ template_task_id: taskId, tenant });

    const existingIds = new Set(existingItems.map(i => i.template_checklist_id));
    const newItemIds = new Set(items.map(i => i.id));
    const savedItems: IProjectTemplateChecklistItem[] = [];

    // Delete items that are no longer in the list
    const idsToDelete = existingItems
      .filter(e => !newItemIds.has(e.template_checklist_id))
      .map(e => e.template_checklist_id);

    if (idsToDelete.length > 0) {
      await trx('project_template_checklist_items')
        .whereIn('template_checklist_id', idsToDelete)
        .andWhere({ tenant })
        .delete();
    }

    // Process each item - create new or update existing
    for (const item of items) {
      if (!item.item_name.trim()) {
        continue; // Skip empty items
      }

      if (item.id.startsWith('temp_')) {
        // Create new item
        const [created] = await trx('project_template_checklist_items')
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
        const [updated] = await trx('project_template_checklist_items')
          .where({ template_checklist_id: item.id, tenant })
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
    const phase = await trx('project_template_phases')
      .where({ template_phase_id: task.template_phase_id, tenant })
      .first();

    if (phase) {
      await trx('project_templates')
        .where({ template_id: phase.template_id, tenant })
        .update({ updated_at: trx.fn.now() });
    }

    return savedItems;
  });
}
