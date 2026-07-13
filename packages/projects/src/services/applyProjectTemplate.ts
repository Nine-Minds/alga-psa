import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { addDays } from 'date-fns';
import ProjectModel from '../models/project';
import ProjectTaskModel from '../models/projectTask';
import { SharedNumberingService } from '@shared/services/numberingService';
import { validateData } from '@alga-psa/validation';
import { applyTemplateSchema } from '../schemas/projectTemplate.schemas';

export interface ApplyProjectTemplateInput {
  project_name: string;
  client_id: string;
  status_id?: string;
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

type WbsCodeRow = { wbs_code: string };

function tenantScopedTable(conn: Knex | Knex.Transaction, table: string, tenant: string): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export async function applyProjectTemplate(
  trx: Knex.Transaction,
  tenant: string,
  templateId: string,
  projectData: ApplyProjectTemplateInput,
): Promise<string> {
  const validatedData = validateData(applyTemplateSchema, { template_id: templateId, ...projectData });
  const options = {
    copyPhases: validatedData.options?.copyPhases ?? true,
    copyStatuses: validatedData.options?.copyStatuses ?? true,
    copyTasks: validatedData.options?.copyTasks ?? true,
    copyDependencies: validatedData.options?.copyDependencies ?? true,
    copyChecklists: validatedData.options?.copyChecklists ?? true,
    copyServices: validatedData.options?.copyServices ?? true,
    assignmentOption: validatedData.options?.assignmentOption ?? 'primary',
  };

    // Verify template exists
    const template = await tenantScopedTable(trx, 'project_templates', tenant)
      .where({ template_id: templateId })
      .first();

    if (!template) {
      throw new Error('Template not found');
    }

    // 1. Pre-load template statuses
    const templateStatuses = options.copyStatuses
      ? await tenantScopedTable(trx, 'project_template_status_mappings', tenant)
          .where({ template_id: templateId })
          .orderBy('display_order')
      : [];

    // 2. Create project directly (no need to call createProject which has extra overhead)
    // Get project statuses for the project status field
    const projectStatuses = await ProjectModel.getStatusesByType(trx, tenant, 'project');
    if (projectStatuses.length === 0) {
      throw new Error('No project statuses found');
    }

    // Use provided status_id or fall back to first available
    let defaultProjectStatus = projectStatuses[0];
    if (validatedData.status_id) {
      const selectedStatus = projectStatuses.find(s => s.status_id === validatedData.status_id);
      if (selectedStatus) {
        defaultProjectStatus = selectedStatus;
      }
    }

    // Generate project number and WBS code
    const projectNumber = await SharedNumberingService.getNextNumber(
      'PROJECT',
      { knex: trx, tenant }
    );
    const wbsCode = await ProjectModel.generateNextWbsCode(trx, tenant, '');

    console.log(`[applyTemplate] Creating project "${validatedData.project_name}" with number ${projectNumber}`);

    // Create the project record
    const newProject = await ProjectModel.create(trx, tenant, {
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
      await tenantScopedTable(trx, 'projects', tenant)
        .where({ project_id: newProjectId })
        .update({ client_portal_config: template.client_portal_config });
    }

    // 3. Load template phases (only if copyPhases is enabled)
    const templatePhases = options.copyPhases
      ? await tenantScopedTable(trx, 'project_template_phases', tenant)
          .where({ template_id: templateId })
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
      const existingPhases = await tenantScopedTable(trx, 'project_phases', tenant)
        .where({ project_id: newProjectId })
        .select('wbs_code') as WbsCodeRow[];

      const phaseNumbers = existingPhases
        .map((phase) => {
          const parts = phase.wbs_code.split('.');
          return parseInt(parts[parts.length - 1]);
        })
        .filter(num => !isNaN(num));

      const maxPhaseNumber = phaseNumbers.length > 0 ? Math.max(...phaseNumbers) : 0;
      const newWbsCode = `${newProject.wbs_code}.${maxPhaseNumber + 1}`;

      const [newPhase] = await tenantScopedTable(trx, 'project_phases', tenant)
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
    const firstStatusMappingIdsByScope = new Map<string, string>();

    const getScopeKey = (templatePhaseId?: string | null) => templatePhaseId ?? '__template_defaults__';
    const getFallbackStatusMappingIdForPhase = (templatePhaseId?: string | null) => {
      if (templatePhaseId) {
        const phaseScopedFallback = firstStatusMappingIdsByScope.get(getScopeKey(templatePhaseId));
        if (phaseScopedFallback) {
          return phaseScopedFallback;
        }
      }

      return firstStatusMappingIdsByScope.get(getScopeKey()) || firstStatusMappingId;
    };

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
            const existingStatus = await tenantScopedTable(trx, 'statuses', tenant)
              .where({
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
              const maxOrder = await tenantScopedTable(trx, 'statuses', tenant)
                .where({ status_type: 'project_task' })
                .max('order_number as max')
                .first();
              const orderNumber = (maxOrder?.max ?? 0) + 1;

              console.log(`[applyTemplate] Creating custom status: "${templateStatus.custom_status_name}" with order_number=${orderNumber}`);

              const insertResult = await tenantScopedTable(trx, 'statuses', tenant)
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
                throw new Error(`Custom status insert for "${templateStatus.custom_status_name}" completed without returning a row.`);
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

        const [newMapping] = await tenantScopedTable(trx, 'project_status_mappings', tenant)
          .insert({
            tenant,
            project_id: newProjectId,
            phase_id: templateStatus.template_phase_id
              ? phaseMap.get(templateStatus.template_phase_id) ?? null
              : null,
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

        const scopeKey = getScopeKey(templateStatus.template_phase_id);
        if (!firstStatusMappingIdsByScope.has(scopeKey)) {
          firstStatusMappingIdsByScope.set(scopeKey, newMapping.project_status_mapping_id);
        }

        // Track first status mapping as fallback
        if (!firstStatusMappingId) {
          firstStatusMappingId = newMapping.project_status_mapping_id;
        }
      }
    } else {
      // Not copying statuses from template - create default status mappings
      console.log(`[applyTemplate] Creating default status mappings`);
      const defaultStatuses = await tenantScopedTable(trx, 'statuses', tenant)
        .where({ status_type: 'project_task' })
        .orderBy('order_number')
        .limit(5);  // Limit to a reasonable number of default statuses

      for (let i = 0; i < defaultStatuses.length; i++) {
        const status = defaultStatuses[i];
        const [newMapping] = await tenantScopedTable(trx, 'project_status_mappings', tenant)
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

        if (!firstStatusMappingIdsByScope.has(getScopeKey())) {
          firstStatusMappingIdsByScope.set(getScopeKey(), newMapping.project_status_mapping_id);
        }

        if (!firstStatusMappingId) {
          firstStatusMappingId = newMapping.project_status_mapping_id;
        }
      }
    }

    // 6. Create tasks (only if copyTasks is enabled)
    const templatePhaseIds = Array.from(phaseMap.keys());
    const taskMap = new Map<string, string>(); // template_task_id → new_task_id

    if (options.copyTasks && templatePhaseIds.length > 0) {
      const templateTasks = await tenantScopedTable(trx, 'project_template_tasks', tenant)
        .whereIn('template_phase_id', templatePhaseIds)
        .orderBy('order_key');

      for (const templateTask of templateTasks) {
      const newPhaseId = phaseMap.get(templateTask.template_phase_id);
      if (!newPhaseId) continue;

      // Get phase for WBS code
      const phase = await tenantScopedTable(trx, 'project_phases', tenant)
        .where({ phase_id: newPhaseId })
        .first();

      if (!phase) continue;

      // Get next task number for WBS
      const existingTasks = await tenantScopedTable(trx, 'project_tasks', tenant)
        .where({ phase_id: newPhaseId })
        .select('wbs_code') as WbsCodeRow[];

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
      let taskStatusMappingId = getFallbackStatusMappingIdForPhase(templateTask.template_phase_id);
      if (templateTask.template_status_mapping_id) {
        // Try to map the template status to the project status
        const mappedStatusId = templateStatusToProjectStatusMap.get(templateTask.template_status_mapping_id);
        console.log(`[applyTemplate] Task "${templateTask.task_name}": template_status_mapping_id=${templateTask.template_status_mapping_id}, mapped to project_status_mapping_id=${mappedStatusId || 'NOT FOUND'}, using ${mappedStatusId || taskStatusMappingId}`);
        if (mappedStatusId) {
          taskStatusMappingId = mappedStatusId;
        }
      } else {
        console.log(`[applyTemplate] Task "${templateTask.task_name}": No template_status_mapping_id, using first status ${taskStatusMappingId}`);
      }

      // Determine assigned_to and assigned_team_id based on assignmentOption
      let taskAssignedTo: string | null = null;
      let taskAssignedTeamId: string | null = null;
      if (options.assignmentOption === 'primary' || options.assignmentOption === 'all') {
        taskAssignedTo = templateTask.assigned_to || null;
        taskAssignedTeamId = templateTask.assigned_team_id || null;
      }
      // If assignmentOption is 'none', both remain null

      try {
        const taskInsertData = {
          tenant,
          phase_id: newPhaseId,
          task_name: templateTask.task_name,
          description: templateTask.description,
          description_rich_text: templateTask.description_rich_text,
          estimated_hours: templateTask.estimated_hours,
          task_type_key: templateTask.task_type_key || 'task',
          priority_id: templateTask.priority_id,
          order_key: templateTask.order_key,
          wbs_code: newWbsCode,
          project_status_mapping_id: taskStatusMappingId,
          assigned_to: taskAssignedTo,
          assigned_team_id: taskAssignedTeamId,
          due_date: dueDate,
          service_id: options.copyServices ? (templateTask.service_id || null) : null
        };
        console.log(`[applyTemplate] Inserting task:`, JSON.stringify(taskInsertData, null, 2));

        const [newTask] = await tenantScopedTable(trx, 'project_tasks', tenant)
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
          const templateResources = await tenantScopedTable(trx, 'project_template_task_resources', tenant)
            .whereIn('template_task_id', templateTaskIds);

          for (const resource of templateResources) {
            const newTaskId = taskMap.get(resource.template_task_id);
            if (!newTaskId) continue;

            // Get the task to find its assigned_to (primary agent)
            const task = await tenantScopedTable(trx, 'project_tasks', tenant)
              .where({ task_id: newTaskId })
              .first();

            if (!task || !task.assigned_to) continue;

            // Check if user exists and is active
            const user = await tenantScopedTable(trx, 'users', tenant)
              .where({ user_id: resource.user_id })
              .first();

            if (!user || user.is_inactive) {
              // Skip assignment if user doesn't exist or is inactive
              continue;
            }

            // Only add if additional user is different from primary
            if (resource.user_id !== task.assigned_to) {
              try {
                await ProjectTaskModel.addTaskResource(trx, tenant, newTaskId, resource.user_id);
              } catch (resourceError) {
                console.error(`Failed to copy template task resource for user ${resource.user_id}:`, resourceError);
              }
            }
          }
        }
      }
    }

    // 7. Create dependencies (REMAP IDs!) - only if copyDependencies and copyTasks are enabled
    if (options.copyDependencies && options.copyTasks) {
      const templateDeps = await tenantScopedTable(trx, 'project_template_dependencies', tenant)
        .where({ template_id: templateId });

      for (const templateDep of templateDeps) {
      const newPredecessorId = taskMap.get(templateDep.predecessor_task_id);
      const newSuccessorId = taskMap.get(templateDep.successor_task_id);

      if (newPredecessorId && newSuccessorId) {
        await tenantScopedTable(trx, 'project_task_dependencies', tenant)
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
        const templateChecklists = await tenantScopedTable(trx, 'project_template_checklist_items', tenant)
          .whereIn('template_task_id', templateTaskIds);

        for (const templateItem of templateChecklists) {
        const newTaskId = taskMap.get(templateItem.template_task_id);

        if (newTaskId) {
          await tenantScopedTable(trx, 'task_checklist_items', tenant)
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

}

async function updateTemplateUsage(trx: Knex.Transaction, templateId: string, tenant: string): Promise<void> {
  await tenantScopedTable(trx, 'project_templates', tenant)
    .where({ template_id: templateId })
    .increment('use_count', 1)
    .update({ last_used_at: trx.fn.now(), updated_at: trx.fn.now() });
}
