'use server';

import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { withTransaction } from '@alga-psa/shared/db';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import { OrderingService } from 'server/src/lib/services/orderingService';
import { publishEvent } from 'server/src/lib/eventBus/publishers';
import {
  TemplateWizardData,
  TemplateStatusMapping,
  TemplatePhase,
  TemplateTask,
  TemplateChecklistItem,
} from 'server/src/components/projects/project-templates/TemplateCreationWizard';

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
 * Create a template from wizard data
 */
export async function createTemplateFromWizard(data: TemplateWizardData): Promise<string> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Validate required fields
  if (!data.template_name?.trim()) {
    throw new Error('Template name is required');
  }

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'create', trx);

    // 1. Create the template
    const [template] = await trx('project_templates')
      .insert({
        tenant,
        template_name: data.template_name.trim(),
        description: data.description?.trim() || null,
        category: data.category?.trim() || null,
        created_by: currentUser.user_id,
        use_count: 0,
      })
      .returning('*');

    // 2. Create status mappings
    const statusMappingMap = new Map<string, string>(); // temp_id → template_status_mapping_id
    if (data.status_mappings && data.status_mappings.length > 0) {
      for (const mapping of data.status_mappings) {
        const [newMapping] = await trx('project_template_status_mappings')
          .insert({
            tenant,
            template_id: template.template_id,
            status_id: mapping.status_id || null,
            custom_status_name: mapping.custom_status_name || null,
            display_order: mapping.display_order,
          })
          .returning('*');

        statusMappingMap.set(mapping.temp_id, newMapping.template_status_mapping_id);
      }
    }

    // 3. Create phases with proper ordering
    const phaseMap = new Map<string, string>(); // temp_id → template_phase_id
    if (data.phases && data.phases.length > 0) {
      const sortedPhases = [...data.phases].sort((a, b) => a.order_number - b.order_number);
      const orderKeys = OrderingService.generateInitialKeys(sortedPhases.length);

      for (let i = 0; i < sortedPhases.length; i++) {
        const phase = sortedPhases[i];
        const [newPhase] = await trx('project_template_phases')
          .insert({
            tenant,
            template_id: template.template_id,
            phase_name: phase.phase_name,
            description: phase.description || null,
            duration_days: phase.duration_days || null,
            start_offset_days: phase.start_offset_days || 0,
            order_key: orderKeys[i],
          })
          .returning('*');

        phaseMap.set(phase.temp_id, newPhase.template_phase_id);
      }
    }

    // 4. Create tasks with proper ordering per phase
    const taskMap = new Map<string, string>(); // temp_id → template_task_id
    if (data.tasks && data.tasks.length > 0) {
      // Group tasks by phase
      const tasksByPhase = new Map<string, TemplateTask[]>();
      data.tasks.forEach((task) => {
        const tasks = tasksByPhase.get(task.phase_temp_id) || [];
        tasks.push(task);
        tasksByPhase.set(task.phase_temp_id, tasks);
      });

      // Insert tasks for each phase
      for (const [phaseTempId, phaseTasks] of tasksByPhase.entries()) {
        const templatePhaseId = phaseMap.get(phaseTempId);
        if (!templatePhaseId) continue;

        const sortedTasks = [...phaseTasks].sort((a, b) => a.order_number - b.order_number);
        const orderKeys = OrderingService.generateInitialKeys(sortedTasks.length);

        for (let i = 0; i < sortedTasks.length; i++) {
          const task = sortedTasks[i];

          // Map temp status mapping ID to actual template status mapping ID
          const templateStatusMappingId = task.template_status_mapping_id
            ? statusMappingMap.get(task.template_status_mapping_id)
            : null;

          const [newTask] = await trx('project_template_tasks')
            .insert({
              tenant,
              template_phase_id: templatePhaseId,
              task_name: task.task_name,
              description: task.description || null,
              estimated_hours: task.estimated_hours || null,
              duration_days: task.duration_days || null,
              task_type_key: task.task_type_key || 'task',
              priority_id: task.priority_id || null,
              template_status_mapping_id: templateStatusMappingId || null,
              order_key: orderKeys[i],
            })
            .returning('*');

          taskMap.set(task.temp_id, newTask.template_task_id);
        }
      }
    }

    // 5. Create checklist items
    if (data.checklist_items && data.checklist_items.length > 0) {
      const checklistInserts = data.checklist_items
        .filter((item) => {
          const templateTaskId = taskMap.get(item.task_temp_id);
          return templateTaskId && item.item_name.trim();
        })
        .map((item) => ({
          tenant,
          template_task_id: taskMap.get(item.task_temp_id)!,
          item_name: item.item_name.trim(),
          description: item.description?.trim() || null,
          order_number: item.order_number,
        }));

      if (checklistInserts.length > 0) {
        await trx('project_template_checklist_items').insert(checklistInserts);
      }
    }

    // 6. Publish event
    await publishEvent({
      tenant_id: tenant,
      event_type: 'project_template.created',
      event_data: {
        template_id: template.template_id,
        template_name: template.template_name,
        created_by: currentUser.user_id,
        phases_count: data.phases.length,
        tasks_count: data.tasks.length,
      },
    });

    return template.template_id;
  });
}

/**
 * Update an existing template with full wizard data (for editor save)
 */
export async function updateTemplateFromEditor(
  templateId: string,
  data: TemplateWizardData
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Validate required fields
  if (!data.template_name?.trim()) {
    throw new Error('Template name is required');
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

    // 1. Update template metadata
    await trx('project_templates')
      .where({ template_id: templateId, tenant })
      .update({
        template_name: data.template_name.trim(),
        description: data.description?.trim() || null,
        category: data.category?.trim() || null,
        updated_at: trx.fn.now(),
      });

    // 2. Delete and recreate status mappings
    await trx('project_template_status_mappings')
      .where({ template_id: templateId, tenant })
      .delete();

    if (data.status_mappings && data.status_mappings.length > 0) {
      const statusInserts = data.status_mappings.map((mapping) => ({
        tenant,
        template_id: templateId,
        status_id: mapping.status_id || null,
        custom_status_name: mapping.custom_status_name || null,
        display_order: mapping.display_order,
      }));

      await trx('project_template_status_mappings').insert(statusInserts);
    }

    // 3. Delete existing phases, tasks, dependencies, and checklists
    // (CASCADE should handle related records)
    await trx('project_template_phases').where({ template_id: templateId, tenant }).delete();

    // 4. Recreate phases with proper ordering
    const phaseMap = new Map<string, string>();
    if (data.phases && data.phases.length > 0) {
      const sortedPhases = [...data.phases].sort((a, b) => a.order_number - b.order_number);
      const orderKeys = OrderingService.generateInitialKeys(sortedPhases.length);

      for (let i = 0; i < sortedPhases.length; i++) {
        const phase = sortedPhases[i];
        const [newPhase] = await trx('project_template_phases')
          .insert({
            tenant,
            template_id: templateId,
            phase_name: phase.phase_name,
            description: phase.description || null,
            duration_days: phase.duration_days || null,
            start_offset_days: phase.start_offset_days || 0,
            order_key: orderKeys[i],
          })
          .returning('*');

        phaseMap.set(phase.temp_id, newPhase.template_phase_id);
      }
    }

    // 5. Recreate tasks
    const taskMap = new Map<string, string>();
    if (data.tasks && data.tasks.length > 0) {
      const tasksByPhase = new Map<string, TemplateTask[]>();
      data.tasks.forEach((task) => {
        const tasks = tasksByPhase.get(task.phase_temp_id) || [];
        tasks.push(task);
        tasksByPhase.set(task.phase_temp_id, tasks);
      });

      for (const [phaseTempId, phaseTasks] of tasksByPhase.entries()) {
        const templatePhaseId = phaseMap.get(phaseTempId);
        if (!templatePhaseId) continue;

        const sortedTasks = [...phaseTasks].sort((a, b) => a.order_number - b.order_number);
        const orderKeys = OrderingService.generateInitialKeys(sortedTasks.length);

        for (let i = 0; i < sortedTasks.length; i++) {
          const task = sortedTasks[i];
          const [newTask] = await trx('project_template_tasks')
            .insert({
              tenant,
              template_phase_id: templatePhaseId,
              task_name: task.task_name,
              description: task.description || null,
              estimated_hours: task.estimated_hours || null,
              duration_days: task.duration_days || null,
              task_type_key: task.task_type_key || 'task',
              priority_id: task.priority_id || null,
              order_key: orderKeys[i],
            })
            .returning('*');

          taskMap.set(task.temp_id, newTask.template_task_id);
        }
      }
    }

    // 6. Recreate checklist items
    if (data.checklist_items && data.checklist_items.length > 0) {
      const checklistInserts = data.checklist_items
        .filter((item) => {
          const templateTaskId = taskMap.get(item.task_temp_id);
          return templateTaskId && item.item_name.trim();
        })
        .map((item) => ({
          tenant,
          template_task_id: taskMap.get(item.task_temp_id)!,
          item_name: item.item_name.trim(),
          description: item.description?.trim() || null,
          order_number: item.order_number,
        }));

      if (checklistInserts.length > 0) {
        await trx('project_template_checklist_items').insert(checklistInserts);
      }
    }

    // 7. Publish event
    await publishEvent({
      tenant_id: tenant,
      event_type: 'project_template.updated',
      event_data: {
        template_id: templateId,
        updated_by: currentUser.user_id,
      },
    });
  });
}

/**
 * Save a copy of a template as a new template (Save As functionality)
 */
export async function saveTemplateAsNew(
  sourceTemplateId: string,
  newTemplateName: string
): Promise<string> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!newTemplateName?.trim()) {
    throw new Error('New template name is required');
  }

  const { knex, tenant } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await checkPermission(currentUser, 'project', 'create', trx);

    // Get source template with all details
    const sourceTemplate = await trx('project_templates')
      .where({ template_id: sourceTemplateId, tenant })
      .first();

    if (!sourceTemplate) {
      throw new Error('Source template not found');
    }

    // Create new template
    const [newTemplate] = await trx('project_templates')
      .insert({
        tenant,
        template_name: newTemplateName.trim(),
        description: sourceTemplate.description,
        category: sourceTemplate.category,
        created_by: currentUser.user_id,
        use_count: 0,
      })
      .returning('*');

    // Copy status mappings
    const statusMappings = await trx('project_template_status_mappings').where({
      template_id: sourceTemplateId,
      tenant,
    });

    if (statusMappings.length > 0) {
      const statusInserts = statusMappings.map((mapping) => ({
        tenant,
        template_id: newTemplate.template_id,
        status_id: mapping.status_id,
        custom_status_name: mapping.custom_status_name,
        display_order: mapping.display_order,
      }));
      await trx('project_template_status_mappings').insert(statusInserts);
    }

    // Copy phases
    const sourcePhases = await trx('project_template_phases')
      .where({ template_id: sourceTemplateId, tenant })
      .orderBy('order_key');

    const phaseMap = new Map<string, string>();

    for (const phase of sourcePhases) {
      const [newPhase] = await trx('project_template_phases')
        .insert({
          tenant,
          template_id: newTemplate.template_id,
          phase_name: phase.phase_name,
          description: phase.description,
          duration_days: phase.duration_days,
          start_offset_days: phase.start_offset_days,
          order_key: phase.order_key,
        })
        .returning('*');

      phaseMap.set(phase.template_phase_id, newPhase.template_phase_id);
    }

    // Copy tasks
    const sourceTasks = await trx('project_template_tasks')
      .where('tenant', tenant)
      .whereIn(
        'template_phase_id',
        sourcePhases.map((p) => p.template_phase_id)
      )
      .orderBy('order_key');

    const taskMap = new Map<string, string>();

    for (const task of sourceTasks) {
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
        })
        .returning('*');

      taskMap.set(task.template_task_id, newTask.template_task_id);
    }

    // Copy dependencies
    const sourceDeps = await trx('project_template_dependencies').where({
      template_id: sourceTemplateId,
      tenant,
    });

    for (const dep of sourceDeps) {
      const newPred = taskMap.get(dep.predecessor_task_id);
      const newSucc = taskMap.get(dep.successor_task_id);

      if (newPred && newSucc) {
        await trx('project_template_dependencies').insert({
          tenant,
          template_id: newTemplate.template_id,
          predecessor_task_id: newPred,
          successor_task_id: newSucc,
          dependency_type: dep.dependency_type,
          lead_lag_days: dep.lead_lag_days,
          notes: dep.notes,
        });
      }
    }

    // Copy checklists
    if (taskMap.size > 0) {
      const sourceChecklists = await trx('project_template_checklist_items')
        .where('tenant', tenant)
        .whereIn('template_task_id', Array.from(taskMap.keys()));

      for (const item of sourceChecklists) {
        const newTaskId = taskMap.get(item.template_task_id);
        if (newTaskId) {
          await trx('project_template_checklist_items').insert({
            tenant,
            template_task_id: newTaskId,
            item_name: item.item_name,
            description: item.description,
            order_number: item.order_number,
          });
        }
      }
    }

    // Publish event
    await publishEvent({
      tenant_id: tenant,
      event_type: 'project_template.duplicated',
      event_data: {
        original_template_id: sourceTemplateId,
        new_template_id: newTemplate.template_id,
        new_template_name: newTemplateName,
        created_by: currentUser.user_id,
      },
    });

    return newTemplate.template_id;
  });
}
