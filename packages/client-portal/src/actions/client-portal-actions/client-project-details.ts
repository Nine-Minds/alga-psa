'use server';

import { createTenantKnex } from '@alga-psa/db';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { DEFAULT_CLIENT_PORTAL_CONFIG, IClientPortalConfig } from '@alga-psa/types';
import { StorageService } from '@alga-psa/storage/StorageService';
import { v4 as uuidv4 } from 'uuid';
import { getEntityImageUrlsBatch } from '@alga-psa/formatting/avatarUtils';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';

type ClientTaskDocument = {
  document_id: string;
  file_id: string;
  document_name: string;
  mime_type: string;
  file_size: number;
  created_by: string;
  entered_at: Date;
  uploaded_by_name: string;
};

/**
 * Helper to verify client access and get config
 * Note: Must be called within withAuth context
 */
async function getProjectWithConfigInternal(
  user: IUserWithRoles,
  tenant: string,
  projectId: string
): Promise<{
  project: any;
  config: IClientPortalConfig;
  clientId: string;
} | null> {
  const { knex } = await createTenantKnex();
  if (user.user_type !== 'client') return null;
  if (!user.contact_id) return null;

  // Get client_id from user's contact -> client relationship
  const contact = await tenantDb(knex, tenant).table('contacts')
    .where({ contact_name_id: user.contact_id, tenant })
    .first<any>();
  if (!contact?.client_id) return null;

  const project = await tenantDb(knex, tenant).table('projects')
    .where({ project_id: projectId, tenant, client_id: contact.client_id, is_inactive: false })
    .first<any>();
  if (!project) return null;

  const config = project.client_portal_config ?? DEFAULT_CLIENT_PORTAL_CONFIG;
  return { project, config, clientId: contact.client_id };
}

/**
 * Get phases (if config.show_phases is true)
 */
export const getClientProjectPhases = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  projectId: string
) => {
  const result = await getProjectWithConfigInternal(user, tenant, projectId);
  if (!result?.config.show_phases) return null;

  const { knex } = await createTenantKnex();
  const phases = await tenantDb(knex, tenant).table('project_phases')
    .where({ project_id: projectId, tenant })
    .orderBy('order_key') as any[];

  // If show_phase_completion, calculate % per phase using a single aggregated query
  if (result.config.show_phase_completion && phases.length > 0) {
    const phaseIds = phases.map((p: { phase_id: string }) => p.phase_id);

    // Single query to get completion stats for all phases
    const scopedDb = tenantDb(knex, tenant);
    const phaseStatsQuery = scopedDb.table('project_tasks as pt');
    scopedDb.tenantJoin(phaseStatsQuery, 'project_status_mappings as psm', 'pt.project_status_mapping_id', 'psm.project_status_mapping_id');
    scopedDb.tenantJoin(phaseStatsQuery, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });

    const phaseStats = await phaseStatsQuery
      .whereIn('pt.phase_id', phaseIds)
      .andWhere('pt.tenant', tenant)
      .groupBy('pt.phase_id')
      .select(
        'pt.phase_id',
        knex.raw('COUNT(*)::int as total'),
        knex.raw('SUM(CASE WHEN s.is_closed THEN 1 ELSE 0 END)::int as completed')
      ) as Array<{ phase_id: string; total: number; completed: number }>;

    // Create a lookup map for quick access
    const statsMap = new Map(
      phaseStats.map((s: { phase_id: string; total: number; completed: number }) => [s.phase_id, s])
    );

    // Attach completion_percentage to each phase
    for (const phase of phases) {
      const stats = statsMap.get(phase.phase_id);
      phase.completion_percentage = stats && stats.total > 0
        ? Math.round((stats.completed / stats.total) * 100)
        : 0;
    }
  }
  return { phases };
});

/**
 * Get tasks with filtered fields (if config.show_tasks is true)
 *
 * @param projectId - The project ID
 * @param options - Optional parameters
 * @param options.phaseId - Filter tasks by phase (used by kanban view)
 */
export const getClientProjectTasks = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  projectId: string,
  options?: { phaseId?: string }
) => {
  const result = await getProjectWithConfigInternal(user, tenant, projectId);
  if (!result?.config.show_tasks) return null;

  const { knex } = await createTenantKnex();
  const visibleFields = result.config.visible_task_fields ?? ['task_name', 'due_date', 'status'];

  // Build SELECT based on visible_task_fields
  // Always include project_status_mapping_id for kanban grouping
  const selectColumns: string[] = ['pt.task_id', 'pt.phase_id', 'pt.project_status_mapping_id'];
  if (visibleFields.includes('task_name')) selectColumns.push('pt.task_name');
  if (visibleFields.includes('description')) selectColumns.push('pt.description');
  if (visibleFields.includes('due_date')) selectColumns.push('pt.due_date');
  if (visibleFields.includes('estimated_hours')) selectColumns.push('pt.estimated_hours');
  if (visibleFields.includes('actual_hours')) selectColumns.push('pt.actual_hours');
  if (visibleFields.includes('priority')) {
    selectColumns.push('pt.priority_id');
    selectColumns.push('pri.priority_name');
    selectColumns.push('pri.color as priority_color');
  }

  const scopedDb = tenantDb(knex, tenant);
  let query = scopedDb.table('project_tasks as pt');
  scopedDb.tenantJoin(query, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
  // Always join status mappings for ordering and kanban display
  scopedDb.tenantJoin(query, 'project_status_mappings as psm', 'pt.project_status_mapping_id', 'psm.project_status_mapping_id', { type: 'left' });
  scopedDb.tenantJoin(query, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });
  query.leftJoin('standard_statuses as ss', function() {
    this.on('psm.standard_status_id', 'ss.standard_status_id');
  });
  scopedDb.tenantJoin(query, 'priorities as pri', 'pt.priority_id', 'pri.priority_id', { type: 'left' });

  query = query
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
    knex.raw('COALESCE(s.name, ss.name) as status_name'),
    knex.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed'),
    knex.raw('s.color as status_color')
  );

  // Join assigned_to if requested
  if (visibleFields.includes('assigned_to')) {
    scopedDb.tenantJoin(query, 'users as u', 'pt.assigned_to', 'u.user_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'teams as tm', 'pt.assigned_team_id', 'tm.team_id', { type: 'left' });
    query = query
      .select(
        'pt.assigned_to as assigned_to_id',
        knex.raw("CONCAT(u.first_name, ' ', u.last_name) as assigned_to_name"),
        'pt.assigned_team_id',
        'tm.team_name as assigned_team_name'
      );
  }

  // Join service_catalog if services field is visible
  if (visibleFields.includes('services')) {
    scopedDb.tenantJoin(query, 'service_catalog as sc', 'pt.service_id', 'sc.service_id', { type: 'left' });
    query = query.select('sc.service_id', 'sc.service_name');
  }

  // Join for checklist_progress if requested
  if (visibleFields.includes('checklist_progress')) {
    const checklistTotalSubquery = tenantDb(knex, tenant)
      .table('task_checklist_items as tci_total')
      .whereRaw('tci_total.task_id = pt.task_id')
      .select(knex.raw('COUNT(*)::int'))
      .as('checklist_total');
    const checklistCompletedSubquery = tenantDb(knex, tenant)
      .table('task_checklist_items as tci_completed')
      .whereRaw('tci_completed.task_id = pt.task_id')
      .where('tci_completed.completed', true)
      .select(knex.raw('COUNT(*)::int'))
      .as('checklist_completed');

    query = query
      .select(
        checklistTotalSubquery,
        checklistCompletedSubquery
      );
  }

  // Order by phase (for list view grouping), then by status display_order, then by task order
  const tasks = await query
    .orderBy('pp.order_key')
    .orderByRaw('COALESCE(psm.display_order, 999)')
    .orderBy('pt.order_key') as any[];

  // Fetch checklist items if checklist_progress is visible
  let tasksWithChecklists = tasks;
  if (visibleFields.includes('checklist_progress') && tasks.length > 0) {
    const taskIds = tasks.map((t: { task_id: string }) => t.task_id);

    // Get all checklist items for these tasks
    const checklistItems = await tenantDb(knex, tenant).table('task_checklist_items')
      .whereIn('task_id', taskIds)
      .where('tenant', tenant)
      .select('task_id', 'item_name', 'completed')
      .orderBy('order_number') as Array<{ task_id: string; item_name: string; completed: boolean }>;

    // Group checklist items by task_id
    const checklistsByTask = checklistItems.reduce((acc: Record<string, Array<{ item_name: string; completed: boolean }>>, item: { task_id: string; item_name: string; completed: boolean }) => {
      if (!acc[item.task_id]) acc[item.task_id] = [];
      acc[item.task_id].push({
        item_name: item.item_name,
        completed: item.completed
      });
      return acc;
    }, {});

    // Attach to tasks
    tasksWithChecklists = tasks.map((task: { task_id: string }) => ({
      ...task,
      checklist_items: checklistsByTask[task.task_id] || []
    }));
  }

  // Fetch additional agents if assigned_to is visible
  let tasksWithResources = tasksWithChecklists;
  if (visibleFields.includes('assigned_to') && tasksWithChecklists.length > 0) {
    const taskIds = tasks.map((t: { task_id: string }) => t.task_id);

    // Get all additional resources for these tasks
    const additionalResourcesQuery = tenantDb(knex, tenant).table('task_resources as tr');
    tenantDb(knex, tenant).tenantJoin(additionalResourcesQuery, 'users as u', 'tr.additional_user_id', 'u.user_id');

    const additionalResources = await additionalResourcesQuery
      .whereIn('tr.task_id', taskIds)
      .where('tr.tenant', tenant)
      .select(
        'tr.task_id',
        'tr.additional_user_id',
        'tr.role',
        knex.raw("CONCAT(u.first_name, ' ', u.last_name) as user_name")
      ) as Array<{ task_id: string; additional_user_id: string; user_name: string; role: string | null }>;

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

    // Attach to tasks (preserving checklist data from tasksWithChecklists)
    tasksWithResources = tasksWithChecklists.map((task: { task_id: string }) => ({
      ...task,
      additional_agents: resourcesByTask[task.task_id] || []
    }));
  }

  // Always fetch phases (needed for both list grouping and kanban phase selector)
  const phases = await tenantDb(knex, tenant).table('project_phases')
    .select('phase_id', 'phase_name', 'description', 'start_date', 'end_date')
    .where({ project_id: projectId, tenant })
    .orderBy('order_key') as any[];

  // Fetch dependencies if dependencies field is visible
  let taskDependencies: { [taskId: string]: { predecessors: any[]; successors: any[] } } = {};
  if (visibleFields.includes('dependencies') && tasks.length > 0) {
    const taskIds = tasks.map((t: { task_id: string }) => t.task_id);

    // Fetch dependencies where task is the successor (predecessors of task)
    const predecessorsQuery = tenantDb(knex, tenant).table('project_task_dependencies as ptd')
      .whereIn('ptd.successor_task_id', taskIds)
      .andWhere('ptd.tenant', tenant);
    tenantDb(knex, tenant).tenantJoin(predecessorsQuery, 'project_tasks as pt', 'ptd.predecessor_task_id', 'pt.task_id', { type: 'left' });

    const predecessorsArray = await predecessorsQuery
      .select(
        'ptd.dependency_id',
        'ptd.predecessor_task_id',
        'ptd.successor_task_id',
        'ptd.dependency_type',
        'pt.task_name as predecessor_task_name'
      ) as Array<{
        dependency_id: string;
        predecessor_task_id: string;
        successor_task_id: string;
        dependency_type: string;
        predecessor_task_name: string | null;
      }>;

    // Fetch dependencies where task is the predecessor (successors of task)
    const successorsQuery = tenantDb(knex, tenant).table('project_task_dependencies as ptd')
      .whereIn('ptd.predecessor_task_id', taskIds)
      .andWhere('ptd.tenant', tenant);
    tenantDb(knex, tenant).tenantJoin(successorsQuery, 'project_tasks as pt', 'ptd.successor_task_id', 'pt.task_id', { type: 'left' });

    const successorsArray = await successorsQuery
      .select(
        'ptd.dependency_id',
        'ptd.predecessor_task_id',
        'ptd.successor_task_id',
        'ptd.dependency_type',
        'pt.task_name as successor_task_name'
      ) as Array<{
        dependency_id: string;
        predecessor_task_id: string;
        successor_task_id: string;
        dependency_type: string;
        successor_task_name: string | null;
      }>;

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

  // Fetch avatar URLs for all users (assigned_to and additional agents)
  let tasksWithAvatars = tasksWithResources;
  if (visibleFields.includes('assigned_to') && tasksWithResources.length > 0) {
    // Collect all user IDs that need avatars
    const allUserIds = new Set<string>();
    tasksWithResources.forEach((task: { assigned_to_id?: string; additional_agents?: Array<{ user_id: string }> }) => {
      if (task.assigned_to_id) {
        allUserIds.add(task.assigned_to_id);
      }
      task.additional_agents?.forEach(agent => {
        if (agent.user_id) {
          allUserIds.add(agent.user_id);
        }
      });
    });

    // Batch fetch all avatar URLs
    const avatarUrls = allUserIds.size > 0 && tenant
      ? await getEntityImageUrlsBatch('user', Array.from(allUserIds), tenant)
      : new Map<string, string | null>();

    // Collect team IDs for avatar fetching
    const allTeamIds = new Set<string>();
    tasksWithResources.forEach((task: { assigned_team_id?: string }) => {
      if (task.assigned_team_id) {
        allTeamIds.add(task.assigned_team_id);
      }
    });

    // Batch fetch team avatar URLs
    const teamAvatarUrls = allTeamIds.size > 0 && tenant
      ? await getEntityImageUrlsBatch('team', Array.from(allTeamIds), tenant)
      : new Map<string, string | null>();

    // Attach avatar URLs to tasks
    tasksWithAvatars = tasksWithResources.map((task: { assigned_to_id?: string; assigned_team_id?: string; additional_agents?: Array<{ user_id: string; user_name: string; role: string | null }> }) => ({
      ...task,
      assigned_to_avatar: task.assigned_to_id ? avatarUrls.get(task.assigned_to_id) || null : null,
      assigned_team_avatar: task.assigned_team_id ? teamAvatarUrls.get(task.assigned_team_id) || null : null,
      additional_agents: task.additional_agents?.map(agent => ({
        ...agent,
        avatar_url: avatarUrls.get(agent.user_id) || null
      })) || []
    }));
  }

  return { tasks: tasksWithAvatars, phases, config: result.config, taskDependencies };
});

/**
 * Get project statuses for kanban view (respects visibility settings)
 */
export const getClientProjectStatuses = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  projectId: string,
  phaseId?: string | null
) => {
  const result = await getProjectWithConfigInternal(user, tenant, projectId);
  if (!result?.config.show_tasks) return null;

  const { knex } = await createTenantKnex();

  const loadStatusesForScope = async (scopedPhaseId?: string | null) => {
    const scopedDb = tenantDb(knex, tenant);
    const query = scopedDb.table('project_status_mappings as psm');
    scopedDb.tenantJoin(query, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });
    query
      .leftJoin('standard_statuses as ss', function() {
        this.on('psm.standard_status_id', 'ss.standard_status_id');
      })
      .where({ 'psm.project_id': projectId, 'psm.tenant': tenant, 'psm.is_visible': true })
      .select(
        'psm.project_status_mapping_id',
        'psm.custom_name',
        'psm.display_order',
        knex.raw('COALESCE(s.name, ss.name) as status_name'),
        knex.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed'),
        knex.raw('s.color as color')
      )
      .orderBy('psm.display_order');

    if (scopedPhaseId) {
      query.andWhere('psm.phase_id', scopedPhaseId);
    } else {
      query.whereNull('psm.phase_id');
    }

    return query as unknown as Promise<Array<{
      project_status_mapping_id: string;
      custom_name: string | null;
      status_name: string;
      display_order: number;
      is_closed: boolean;
      color: string | null;
    }>>;
  };

  let statuses = phaseId ? await loadStatusesForScope(phaseId) : [];
  if (!statuses || statuses.length === 0) {
    statuses = await loadStatusesForScope();
  }

  return {
    statuses: statuses.map((s: { project_status_mapping_id: string; custom_name: string | null; status_name: string; display_order: number; is_closed: boolean; color: string | null }) => ({
      project_status_mapping_id: s.project_status_mapping_id,
      name: s.custom_name || s.status_name,
      display_order: s.display_order,
      is_closed: s.is_closed,
      color: s.color
    }))
  };
});

/**
 * Upload document to task (if 'document_uploads' is in visible_task_fields)
 * Client-safe path - does NOT use MSP RBAC
 */
export const uploadClientTaskDocument = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  taskId: string,
  formData: FormData,
  folderPath?: string | null
) => {
  const { knex } = await createTenantKnex();
  if (user.user_type !== 'client') {
    return { success: false, error: 'Not authorized' };
  }

  // Get client_id from user's contact
  if (!user.contact_id) {
    return { success: false, error: 'User not associated with a contact' };
  }
  const contact = await tenantDb(knex, tenant).table('contacts')
    .where({ contact_name_id: user.contact_id, tenant })
    .first<any>();
  if (!contact?.client_id) {
    return { success: false, error: 'Client not found' };
  }

  // Verify task belongs to a project owned by this client (read-only check)
  const scopedDb = tenantDb(knex, tenant);
  const taskQuery = scopedDb.table('project_tasks as pt');
  scopedDb.tenantJoin(taskQuery, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
  scopedDb.tenantJoin(taskQuery, 'projects as p', 'pp.project_id', 'p.project_id');

  const task = await taskQuery
    .where({ 'pt.task_id': taskId, 'pt.tenant': tenant, 'p.client_id': contact.client_id })
    .select('p.project_id', 'p.client_portal_config')
    .first<any>();

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
      await tenantDb(trx, tenant).table('documents').insert({
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
        updated_at: new Date(),
        folder_path: folderPath ?? null,
        is_client_visible: true,               // Client-uploaded docs are always visible to client portal
      });

      await tenantDb(trx, tenant).table('document_associations').insert({
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
});

/**
 * Get documents for a task (client view)
 */
export const getClientTaskDocuments = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  taskId: string
) => {
  const { knex } = await createTenantKnex();
  if (user.user_type !== 'client') {
    return { success: false, error: 'Not authorized' };
  }

  // Get client_id from user's contact
  if (!user.contact_id) {
    return { success: false, error: 'User not associated with a contact' };
  }
  const contact = await tenantDb(knex, tenant).table('contacts')
    .where({ contact_name_id: user.contact_id, tenant })
    .first<any>();
  if (!contact?.client_id) {
    return { success: false, error: 'Client not found' };
  }

  // Verify task belongs to a project owned by this client
  const scopedDb = tenantDb(knex, tenant);
  const taskQuery = scopedDb.table('project_tasks as pt');
  scopedDb.tenantJoin(taskQuery, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
  scopedDb.tenantJoin(taskQuery, 'projects as p', 'pp.project_id', 'p.project_id');

  const task = await taskQuery
    .where({ 'pt.task_id': taskId, 'pt.tenant': tenant, 'p.client_id': contact.client_id })
    .select('p.project_id', 'p.client_portal_config')
    .first<any>();

  if (!task) {
    return { success: false, error: 'Task not found or access denied' };
  }

  const config = task.client_portal_config ?? DEFAULT_CLIENT_PORTAL_CONFIG;
  if (!config.show_tasks) {
    return { success: false, error: 'Task documents not available' };
  }

  // Get client-visible documents
  const documentsQuery = tenantDb(knex, tenant).table('documents as d');
  tenantDb(knex, tenant).tenantJoin(documentsQuery, 'document_associations as da', 'd.document_id', 'da.document_id');
  tenantDb(knex, tenant).tenantJoin(documentsQuery, 'users as u', 'd.created_by', 'u.user_id', { type: 'left' });

  const documents = await documentsQuery
    .where({
      'da.entity_type': 'project_task',
      'da.entity_id': taskId,
      'd.tenant': tenant,
      'd.is_client_visible': true,
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
    .orderBy('d.entered_at', 'desc') as unknown as ClientTaskDocument[];

  return { success: true, documents };
});
