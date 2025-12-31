'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { DEFAULT_CLIENT_PORTAL_CONFIG, IClientPortalConfig } from 'server/src/interfaces/project.interfaces';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { v4 as uuidv4 } from 'uuid';

/**
 * Helper to verify client access and get config
 */
async function getProjectWithConfig(projectId: string): Promise<{
  project: any;
  config: IClientPortalConfig;
  clientId: string;
} | null> {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();
  if (!user || user.user_type !== 'client') return null;
  if (!user.contact_id) return null;

  // Get client_id from user's contact -> client relationship
  const contact = await knex('contacts')
    .where({ contact_name_id: user.contact_id, tenant })
    .first();
  if (!contact?.client_id) return null;

  const project = await knex('projects')
    .where({ project_id: projectId, tenant, client_id: contact.client_id, is_inactive: false })
    .first();
  if (!project) return null;

  const config = project.client_portal_config ?? DEFAULT_CLIENT_PORTAL_CONFIG;
  return { project, config, clientId: contact.client_id };
}

/**
 * Get phases (if config.show_phases is true)
 */
export async function getClientProjectPhases(projectId: string) {
  const result = await getProjectWithConfig(projectId);
  if (!result?.config.show_phases) return null;

  const { knex, tenant } = await createTenantKnex();
  const phases = await knex('project_phases')
    .where({ project_id: projectId, tenant })
    .orderBy('order_key');

  // If show_phase_completion, calculate % per phase
  if (result.config.show_phase_completion) {
    for (const phase of phases) {
      const stats = await knex('project_tasks as pt')
        .join('project_status_mappings as psm', function() {
          this.on('pt.project_status_mapping_id', 'psm.project_status_mapping_id')
              .andOn('pt.tenant', 'psm.tenant');
        })
        .leftJoin('statuses as s', function() {
          this.on('psm.status_id', 's.status_id').andOn('psm.tenant', 's.tenant');
        })
        .where({ 'pt.phase_id': phase.phase_id, 'pt.tenant': tenant })
        .select(
          knex.raw('COUNT(*)::int as total'),
          knex.raw('SUM(CASE WHEN s.is_closed THEN 1 ELSE 0 END)::int as completed')
        )
        .first();
      phase.completion_percentage = stats.total > 0
        ? Math.round((stats.completed / stats.total) * 100) : 0;
    }
  }
  return { phases };
}

/**
 * Get tasks with filtered fields (if config.show_tasks is true)
 *
 * @param projectId - The project ID
 * @param options - Optional parameters
 * @param options.phaseId - Filter tasks by phase (used by kanban view)
 */
export async function getClientProjectTasks(
  projectId: string,
  options?: { phaseId?: string }
) {
  const result = await getProjectWithConfig(projectId);
  if (!result?.config.show_tasks) return null;

  const { knex, tenant } = await createTenantKnex();
  const visibleFields = result.config.visible_task_fields ?? ['task_name', 'due_date', 'status'];

  // Build SELECT based on visible_task_fields
  // Always include project_status_mapping_id for kanban grouping
  const selectColumns: string[] = ['pt.task_id', 'pt.phase_id', 'pt.project_status_mapping_id'];
  if (visibleFields.includes('task_name')) selectColumns.push('pt.task_name');
  if (visibleFields.includes('description')) selectColumns.push('pt.description');
  if (visibleFields.includes('due_date')) selectColumns.push('pt.due_date');
  if (visibleFields.includes('estimated_hours')) selectColumns.push('pt.estimated_hours');
  if (visibleFields.includes('actual_hours')) selectColumns.push('pt.actual_hours');
  if (visibleFields.includes('priority')) selectColumns.push('pt.priority_id');

  let query = knex('project_tasks as pt')
    .join('project_phases as pp', function() {
      this.on('pt.phase_id', 'pp.phase_id').andOn('pt.tenant', 'pp.tenant');
    })
    // Always join status mappings for ordering and kanban display
    .leftJoin('project_status_mappings as psm', function() {
      this.on('pt.project_status_mapping_id', 'psm.project_status_mapping_id')
          .andOn('pt.tenant', 'psm.tenant');
    })
    .leftJoin('statuses as s', function() {
      this.on('psm.status_id', 's.status_id').andOn('psm.tenant', 's.tenant');
    })
    .where({ 'pp.project_id': projectId, 'pt.tenant': tenant })
    // Only show tasks with visible status mappings
    .where('psm.is_visible', true)
    .select(selectColumns);

  // Filter by phase if specified (for kanban view)
  if (options?.phaseId) {
    query = query.where('pt.phase_id', options.phaseId);
  }

  // Always add status info for kanban grouping and display
  query = query.select(
    'psm.custom_name',
    'psm.display_order',
    's.name as status_name',
    's.is_closed',
    's.color as status_color'
  );

  // Join assigned_to if requested
  if (visibleFields.includes('assigned_to')) {
    query = query
      .leftJoin('users as u', function() {
        this.on('pt.assigned_to', 'u.user_id').andOn('pt.tenant', 'u.tenant');
      })
      .select(knex.raw("CONCAT(u.first_name, ' ', u.last_name) as assigned_to_name"));
  }

  // Join service_catalog if services field is visible
  if (visibleFields.includes('services')) {
    query = query
      .leftJoin('service_catalog as sc', function() {
        this.on('pt.service_id', 'sc.service_id').andOn('pt.tenant', 'sc.tenant');
      })
      .select('sc.service_id', 'sc.service_name');
  }

  // Join for checklist_progress if requested
  if (visibleFields.includes('checklist_progress')) {
    query = query
      .select(
        knex.raw(`(
          SELECT COUNT(*)::int
          FROM task_checklist_items
          WHERE task_id = pt.task_id AND tenant = pt.tenant
        ) as checklist_total`),
        knex.raw(`(
          SELECT COUNT(*)::int
          FROM task_checklist_items
          WHERE task_id = pt.task_id AND tenant = pt.tenant AND completed = true
        ) as checklist_completed`)
      );
  }

  // Order by phase (for list view grouping), then by status display_order, then by task order
  const tasks = await query
    .orderBy('pp.order_key')
    .orderByRaw('COALESCE(psm.display_order, 999)')
    .orderBy('pt.order_key');

  // Fetch additional agents if assigned_to is visible
  let tasksWithResources = tasks;
  if (visibleFields.includes('assigned_to') && tasks.length > 0) {
    const taskIds = tasks.map((t: { task_id: string }) => t.task_id);

    // Get all additional resources for these tasks
    const additionalResources = await knex('task_resources as tr')
      .join('users as u', function() {
        this.on('tr.additional_user_id', 'u.user_id').andOn('tr.tenant', 'u.tenant');
      })
      .whereIn('tr.task_id', taskIds)
      .where('tr.tenant', tenant)
      .select(
        'tr.task_id',
        'tr.additional_user_id',
        'tr.role',
        knex.raw("CONCAT(u.first_name, ' ', u.last_name) as user_name")
      );

    // Group resources by task_id
    const resourcesByTask = additionalResources.reduce((acc: Record<string, Array<{ user_id: string; user_name: string; role: string | null }>>, r: { task_id: string; additional_user_id: string; user_name: string; role: string | null }) => {
      if (!acc[r.task_id]) acc[r.task_id] = [];
      acc[r.task_id].push({
        user_id: r.additional_user_id,
        user_name: r.user_name,
        role: r.role
      });
      return acc;
    }, {});

    // Attach to tasks
    tasksWithResources = tasks.map((task: { task_id: string }) => ({
      ...task,
      additional_agents: resourcesByTask[task.task_id] || []
    }));
  }

  // Always fetch phases (needed for both list grouping and kanban phase selector)
  const phases = await knex('project_phases')
    .select('phase_id', 'phase_name', 'description', 'start_date', 'end_date')
    .where({ project_id: projectId, tenant })
    .orderBy('order_key');

  // Fetch dependencies if dependencies field is visible
  let taskDependencies: { [taskId: string]: { predecessors: any[]; successors: any[] } } = {};
  if (visibleFields.includes('dependencies') && tasks.length > 0) {
    const taskIds = tasks.map((t: { task_id: string }) => t.task_id);

    // Fetch dependencies where task is the successor (predecessors of task)
    const predecessorsArray = await knex('project_task_dependencies as ptd')
      .whereIn('ptd.successor_task_id', taskIds)
      .andWhere('ptd.tenant', tenant)
      .leftJoin('project_tasks as pt', function() {
        this.on('ptd.predecessor_task_id', '=', 'pt.task_id')
            .andOn('ptd.tenant', '=', 'pt.tenant');
      })
      .select(
        'ptd.dependency_id',
        'ptd.predecessor_task_id',
        'ptd.successor_task_id',
        'ptd.dependency_type',
        'pt.task_name as predecessor_task_name'
      );

    // Fetch dependencies where task is the predecessor (successors of task)
    const successorsArray = await knex('project_task_dependencies as ptd')
      .whereIn('ptd.predecessor_task_id', taskIds)
      .andWhere('ptd.tenant', tenant)
      .leftJoin('project_tasks as pt', function() {
        this.on('ptd.successor_task_id', '=', 'pt.task_id')
            .andOn('ptd.tenant', '=', 'pt.tenant');
      })
      .select(
        'ptd.dependency_id',
        'ptd.predecessor_task_id',
        'ptd.successor_task_id',
        'ptd.dependency_type',
        'pt.task_name as successor_task_name'
      );

    // Group by task
    for (const dep of predecessorsArray) {
      const taskId = dep.successor_task_id;
      if (!taskDependencies[taskId]) {
        taskDependencies[taskId] = { predecessors: [], successors: [] };
      }
      taskDependencies[taskId].predecessors.push({
        dependency_id: dep.dependency_id,
        predecessor_task_id: dep.predecessor_task_id,
        successor_task_id: dep.successor_task_id,
        dependency_type: dep.dependency_type,
        predecessor_task: { task_name: dep.predecessor_task_name }
      });
    }

    for (const dep of successorsArray) {
      const taskId = dep.predecessor_task_id;
      if (!taskDependencies[taskId]) {
        taskDependencies[taskId] = { predecessors: [], successors: [] };
      }
      taskDependencies[taskId].successors.push({
        dependency_id: dep.dependency_id,
        predecessor_task_id: dep.predecessor_task_id,
        successor_task_id: dep.successor_task_id,
        dependency_type: dep.dependency_type,
        successor_task: { task_name: dep.successor_task_name }
      });
    }
  }

  return { tasks: tasksWithResources, phases, config: result.config, taskDependencies };
}

/**
 * Get project statuses for kanban view (respects visibility settings)
 */
export async function getClientProjectStatuses(projectId: string) {
  const result = await getProjectWithConfig(projectId);
  if (!result?.config.show_tasks) return null;

  const { knex, tenant } = await createTenantKnex();

  // Get visible statuses for this project
  const statuses = await knex('project_status_mappings as psm')
    .leftJoin('statuses as s', function() {
      this.on('psm.status_id', 's.status_id').andOn('psm.tenant', 's.tenant');
    })
    .where({ 'psm.project_id': projectId, 'psm.tenant': tenant, 'psm.is_visible': true })
    .select(
      'psm.project_status_mapping_id',
      'psm.custom_name',
      'psm.display_order',
      's.name as status_name',
      's.is_closed',
      's.color'
    )
    .orderBy('psm.display_order');

  return {
    statuses: statuses.map((s: { project_status_mapping_id: string; custom_name: string | null; status_name: string; display_order: number; is_closed: boolean; color: string | null }) => ({
      project_status_mapping_id: s.project_status_mapping_id,
      name: s.custom_name || s.status_name,
      display_order: s.display_order,
      is_closed: s.is_closed,
      color: s.color
    }))
  };
}

/**
 * Upload document to task (if config.allow_document_uploads is true)
 * Client-safe path - does NOT use MSP RBAC
 */
export async function uploadClientTaskDocument(taskId: string, formData: FormData) {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    return { success: false, error: 'Tenant not found' };
  }
  const user = await getCurrentUser();
  if (!user || user.user_type !== 'client') {
    return { success: false, error: 'Not authorized' };
  }

  // Get client_id from user's contact
  if (!user.contact_id) {
    return { success: false, error: 'User not associated with a contact' };
  }
  const contact = await knex('contacts')
    .where({ contact_name_id: user.contact_id, tenant })
    .first();
  if (!contact?.client_id) {
    return { success: false, error: 'Client not found' };
  }

  // Verify task belongs to a project owned by this client (read-only check)
  const task = await knex('project_tasks as pt')
    .join('project_phases as pp', function() {
      this.on('pt.phase_id', 'pp.phase_id').andOn('pt.tenant', 'pp.tenant');
    })
    .join('projects as p', function() {
      this.on('pp.project_id', 'p.project_id').andOn('pp.tenant', 'p.tenant');
    })
    .where({ 'pt.task_id': taskId, 'pt.tenant': tenant, 'p.client_id': contact.client_id })
    .select('p.project_id', 'p.client_portal_config')
    .first();

  if (!task) {
    return { success: false, error: 'Task not found or access denied' };
  }

  const config = task.client_portal_config ?? DEFAULT_CLIENT_PORTAL_CONFIG;
  const visibleFields = config.visible_task_fields ?? ['task_name', 'due_date', 'status'];
  if (!config.show_tasks || !visibleFields.includes('document_uploads')) {
    return { success: false, error: 'Document uploads not allowed' };
  }

  const file = formData.get('file') as File;
  if (!file) return { success: false, error: 'No file provided' };

  try {
    const mimeType = file.type || 'application/octet-stream';

    // 1. Validate file before upload (follows fileActions.ts pattern)
    await StorageService.validateFileUpload(tenant, mimeType, file.size);

    // 2. Upload file to storage (StorageService.uploadFile is static, doesn't support transactions)
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileRecord = await StorageService.uploadFile(tenant, buffer, file.name, {
      mime_type: mimeType,
      uploaded_by_id: user.user_id
    });
    // fileRecord is a FileStore with: file_id, storage_path, original_name, mime_type, file_size, etc.

    // 3. Create document + association in transaction (matches documentActions.ts pattern)
    const documentId = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const docId = uuidv4();
      await trx('documents').insert({
        document_id: docId,
        document_name: file.name,
        tenant,
        file_id: fileRecord.file_id,           // From StorageService.uploadFile
        storage_path: fileRecord.storage_path, // From StorageService.uploadFile
        mime_type: fileRecord.mime_type,
        file_size: fileRecord.file_size,
        user_id: user.user_id,
        created_by: user.user_id,
        entered_at: new Date(),
        updated_at: new Date()
      });

      await trx('document_associations').insert({
        tenant,
        document_id: docId,
        entity_type: 'project_task',
        entity_id: taskId,
        created_at: new Date()
      });

      return docId;
    });

    return { success: true, documentId };
  } catch (error) {
    console.error('Error uploading client document:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Upload failed' };
  }
}

/**
 * Get documents for a task (client view)
 */
export async function getClientTaskDocuments(taskId: string) {
  const { knex, tenant } = await createTenantKnex();
  const user = await getCurrentUser();
  if (!user || user.user_type !== 'client') {
    return { success: false, error: 'Not authorized' };
  }

  // Get client_id from user's contact
  if (!user.contact_id) {
    return { success: false, error: 'User not associated with a contact' };
  }
  const contact = await knex('contacts')
    .where({ contact_name_id: user.contact_id, tenant })
    .first();
  if (!contact?.client_id) {
    return { success: false, error: 'Client not found' };
  }

  // Verify task belongs to a project owned by this client
  const task = await knex('project_tasks as pt')
    .join('project_phases as pp', function() {
      this.on('pt.phase_id', 'pp.phase_id').andOn('pt.tenant', 'pp.tenant');
    })
    .join('projects as p', function() {
      this.on('pp.project_id', 'p.project_id').andOn('pp.tenant', 'p.tenant');
    })
    .where({ 'pt.task_id': taskId, 'pt.tenant': tenant, 'p.client_id': contact.client_id })
    .select('p.project_id', 'p.client_portal_config')
    .first();

  if (!task) {
    return { success: false, error: 'Task not found or access denied' };
  }

  const config = task.client_portal_config ?? DEFAULT_CLIENT_PORTAL_CONFIG;
  if (!config.show_tasks) {
    return { success: false, error: 'Task documents not available' };
  }

  // Get documents
  const documents = await knex('documents as d')
    .join('document_associations as da', function() {
      this.on('d.document_id', 'da.document_id').andOn('d.tenant', 'da.tenant');
    })
    .leftJoin('users as u', function() {
      this.on('d.created_by', 'u.user_id').andOn('d.tenant', 'u.tenant');
    })
    .where({
      'da.entity_type': 'project_task',
      'da.entity_id': taskId,
      'd.tenant': tenant
    })
    .select(
      'd.document_id',
      'd.file_id',
      'd.document_name',
      'd.mime_type',
      'd.file_size',
      'd.created_by',
      'd.entered_at',
      knex.raw("CONCAT(u.first_name, ' ', u.last_name) as uploaded_by_name")
    )
    .orderBy('d.entered_at', 'desc');

  return { success: true, documents };
}
