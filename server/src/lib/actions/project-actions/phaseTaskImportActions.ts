'use server';

import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { unparseCSV } from 'server/src/lib/utils/csvParser';
import { getAllUsersBasic } from 'server/src/lib/actions/user-actions/userActions';
import { getAllPriorities } from 'server/src/lib/actions/priorityActions';
import { getServices } from 'server/src/lib/actions/serviceActions';
import { createTagsForEntity } from 'server/src/lib/actions/tagActions';
import ProjectModel from 'server/src/lib/models/project';
import ProjectTaskModel from 'server/src/lib/models/projectTask';
import { IProjectPhase, IProjectTask } from 'server/src/interfaces/project.interfaces';
import { IPriority } from 'server/src/interfaces';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { IUser } from '@shared/interfaces/user.interfaces';
import {
  ITaskImportRow,
  ITaskImportValidationResult,
  IGroupedPhaseData,
  IGroupedTaskData,
  IPhaseTaskImportResult,
  IPhaseTaskValidationResponse,
  IStatusResolution,
  DEFAULT_PHASE_NAME,
  MappableTaskField,
} from 'server/src/interfaces/phaseTaskImport.interfaces';
import { IProjectStatusMapping } from 'server/src/interfaces/project.interfaces';

/**
 * Generate a CSV template for phase/task import with sample data
 */
export async function generatePhaseTaskCSVTemplate(): Promise<string> {
  const templateData = [
    {
      phase_name: 'Planning',
      task_name: 'Gather Requirements',
      task_description: 'Collect and document client requirements',
      assigned_to: 'John Smith',
      estimated_hours: '16',
      actual_hours: '',
      due_date: '2024-02-15',
      priority: 'High',
      service: 'Consulting',
      task_type: 'task',
      status: 'To Do',
      tags: 'discovery,client',
    },
    {
      phase_name: 'Planning',
      task_name: 'Create Wireframes',
      task_description: 'Design initial wireframes for review',
      assigned_to: 'Sarah Johnson',
      estimated_hours: '8',
      actual_hours: '',
      due_date: '2024-02-20',
      priority: 'Medium',
      service: 'Design',
      task_type: 'task',
      status: 'To Do',
      tags: 'design',
    },
    {
      phase_name: 'Development',
      task_name: 'Build API',
      task_description: 'Implement REST API endpoints',
      assigned_to: 'Mike Wilson',
      estimated_hours: '40',
      actual_hours: '',
      due_date: '2024-03-15',
      priority: 'High',
      service: 'Development',
      task_type: 'task',
      status: 'In Progress',
      tags: 'backend,api',
    },
    {
      phase_name: 'Development',
      task_name: 'Frontend Components',
      task_description: 'Create React UI components',
      assigned_to: 'Tom Brown',
      estimated_hours: '32',
      actual_hours: '',
      due_date: '2024-03-20',
      priority: 'Medium',
      service: 'Development',
      task_type: 'task',
      status: 'In Progress',
      tags: 'frontend',
    },
    {
      phase_name: '',
      task_name: 'Review Documentation',
      task_description: 'Final documentation review before delivery',
      assigned_to: 'John Smith',
      estimated_hours: '4',
      actual_hours: '',
      due_date: '2024-03-25',
      priority: 'Low',
      service: '',
      task_type: 'task',
      status: '',
      tags: 'docs',
    },
  ];

  const fields: MappableTaskField[] = [
    'phase_name',
    'task_name',
    'task_description',
    'assigned_to',
    'estimated_hours',
    'actual_hours',
    'due_date',
    'priority',
    'service',
    'task_type',
    'status',
    'tags',
  ];

  return unparseCSV(templateData, fields);
}

/**
 * Validate phase/task import data and build lookup maps
 */
export async function validatePhaseTaskImportData(
  rows: ITaskImportRow[],
  projectId?: string
): Promise<IPhaseTaskValidationResponse> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex: db } = await createTenantKnex();

  // Fetch lookup data
  const [users, priorities, servicesResponse] = await Promise.all([
    getAllUsersBasic(true),
    getAllPriorities('project_task'),
    getServices(1, 999, { is_active: true }),
  ]);

  const services = servicesResponse.services;

  // Build lookup maps (case-insensitive)
  const userLookup: Record<string, string> = {};
  users.forEach((user: IUser) => {
    const fullName = `${user.first_name} ${user.last_name}`.toLowerCase().trim();
    userLookup[fullName] = user.user_id;
  });

  const priorityLookup: Record<string, string> = {};
  priorities.forEach((priority: IPriority) => {
    priorityLookup[priority.priority_name.toLowerCase().trim()] = priority.priority_id;
  });

  const serviceLookup: Record<string, string> = {};
  services.forEach((service: IService) => {
    serviceLookup[service.service_name.toLowerCase().trim()] = service.service_id;
  });

  // Build status lookup if projectId is provided
  const statusLookup: Record<string, string> = {};
  const unmatchedStatuses: string[] = [];

  if (projectId) {
    const statusMappings = await ProjectModel.getProjectStatusMappings(db, projectId);
    statusMappings.forEach((mapping: IProjectStatusMapping) => {
      // Use custom_name if available, otherwise use status_name
      const statusName = mapping.custom_name || mapping.status_name || mapping.name;
      if (statusName) {
        statusLookup[statusName.toLowerCase().trim()] = mapping.project_status_mapping_id;
      }
    });
  }

  // Collect unique status names from CSV that don't match existing statuses
  const csvStatusNames = new Set<string>();
  rows.forEach(row => {
    const statusName = row.status?.trim();
    if (statusName) {
      csvStatusNames.add(statusName);
    }
  });

  csvStatusNames.forEach(statusName => {
    if (!statusLookup[statusName.toLowerCase()]) {
      unmatchedStatuses.push(statusName);
    }
  });

  // Validate each row
  const validationResults: ITaskImportValidationResult[] = rows.map((row, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const rowNumber = index + 2; // +2 for 1-based indexing and header row

    // Required field validation
    if (!row.task_name?.trim()) {
      errors.push('Task name is required');
    }

    // Name matching validation
    if (row.assigned_to?.trim()) {
      const normalizedName = row.assigned_to.toLowerCase().trim();
      if (!userLookup[normalizedName]) {
        warnings.push(`User "${row.assigned_to}" not found - task will be unassigned`);
      }
    }

    if (row.priority?.trim()) {
      const normalizedPriority = row.priority.toLowerCase().trim();
      if (!priorityLookup[normalizedPriority]) {
        warnings.push(`Priority "${row.priority}" not found - will be skipped`);
      }
    }

    if (row.service?.trim()) {
      const normalizedService = row.service.toLowerCase().trim();
      if (!serviceLookup[normalizedService]) {
        warnings.push(`Service "${row.service}" not found - will be skipped`);
      }
    }

    // Status validation - only warn, actual resolution happens in wizard step
    if (row.status?.trim() && projectId) {
      const normalizedStatus = row.status.toLowerCase().trim();
      if (!statusLookup[normalizedStatus]) {
        // Don't warn here - the status resolution step will handle this
      }
    }

    // Date validation
    if (row.due_date?.trim()) {
      const parsedDate = parseDate(row.due_date);
      if (!parsedDate) {
        warnings.push(`Invalid date format for due_date: "${row.due_date}" - will be skipped`);
      }
    }

    // Number validation
    if (row.estimated_hours?.trim()) {
      const parsed = parseNumber(row.estimated_hours);
      if (parsed === null || parsed < 0) {
        warnings.push(`Invalid estimated_hours: "${row.estimated_hours}" - will be skipped`);
      }
    }

    if (row.actual_hours?.trim()) {
      const parsed = parseNumber(row.actual_hours);
      if (parsed === null || parsed < 0) {
        warnings.push(`Invalid actual_hours: "${row.actual_hours}" - will be skipped`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      rowNumber,
      data: row,
    };
  });

  return {
    validationResults,
    userLookup,
    priorityLookup,
    serviceLookup,
    statusLookup,
    unmatchedStatuses,
  };
}

/**
 * Get project status mappings for the import dialog
 */
export async function getProjectStatusMappingsForImport(
  projectId: string
): Promise<IProjectStatusMapping[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }
  if (!currentUser.tenant) {
    throw new Error('Tenant context not found');
  }

  const { knex: db } = await createTenantKnex();

  // Query with joins to get actual status names
  return await db('project_status_mappings as psm')
    .where({ 'psm.project_id': projectId, 'psm.tenant': currentUser.tenant })
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
      db.raw('COALESCE(psm.custom_name, s.name, ss.name) as status_name'),
      db.raw('COALESCE(psm.custom_name, s.name, ss.name) as name'),
      db.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed')
    )
    .orderBy('psm.display_order');
}

/**
 * Default status column name for tasks without a matching status
 */
const DEFAULT_UNSPECIFIED_STATUS_NAME = 'No Status Specified';

/**
 * Import phases and tasks into an existing project
 */
export async function importPhasesAndTasks(
  projectId: string,
  groupedPhases: IGroupedPhaseData[],
  statusResolutions: IStatusResolution[] = []
): Promise<IPhaseTaskImportResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }
  if (!currentUser.tenant) {
    throw new Error('Tenant context not found');
  }

  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(currentUser, 'project', 'update')) {
      throw new Error('Permission denied: Cannot update projects');
    }

    // Verify project exists
    const project = await ProjectModel.getById(trx, projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Get existing status mappings
    let statusMappings = await ProjectModel.getProjectStatusMappings(trx, projectId);
    if (!statusMappings || statusMappings.length === 0) {
      throw new Error('No status mappings found for project. Please configure task statuses first.');
    }

    // Build a map of status name -> mapping ID
    const statusMappingByName: Record<string, string> = {};
    statusMappings.forEach((mapping: IProjectStatusMapping) => {
      const statusName = mapping.custom_name || mapping.status_name || mapping.name;
      if (statusName) {
        statusMappingByName[statusName.toLowerCase().trim()] = mapping.project_status_mapping_id;
      }
    });

    // Process status resolutions to create new statuses or map to existing
    let defaultUnspecifiedStatusId: string | null = null;

    for (const resolution of statusResolutions) {
      if (resolution.action === 'create') {
        // Create a new status mapping for this status name
        const newMapping = await createNewStatusMapping(trx, projectId, resolution.originalStatusName, statusMappings.length, currentUser.tenant);
        statusMappingByName[resolution.originalStatusName.toLowerCase().trim()] = newMapping.project_status_mapping_id;
        statusMappings = [...statusMappings, newMapping];
      } else if (resolution.action === 'map_to_existing' && resolution.mappedStatusId) {
        // Map to an existing status
        statusMappingByName[resolution.originalStatusName.toLowerCase().trim()] = resolution.mappedStatusId;
      } else if (resolution.action === 'use_default') {
        // Will use the default "No Status Specified" column
        // Create it if it doesn't exist
        if (!defaultUnspecifiedStatusId) {
          const existingDefault = statusMappings.find(
            m => (m.custom_name || m.status_name || m.name || '').toLowerCase() === DEFAULT_UNSPECIFIED_STATUS_NAME.toLowerCase()
          );
          if (existingDefault) {
            defaultUnspecifiedStatusId = existingDefault.project_status_mapping_id;
          } else {
            const newMapping = await createNewStatusMapping(trx, projectId, DEFAULT_UNSPECIFIED_STATUS_NAME, statusMappings.length, currentUser.tenant);
            defaultUnspecifiedStatusId = newMapping.project_status_mapping_id;
            statusMappings = [...statusMappings, newMapping];
          }
        }
        statusMappingByName[resolution.originalStatusName.toLowerCase().trim()] = defaultUnspecifiedStatusId;
      }
    }

    // Default status for tasks without any status specified
    const firstStatusMappingId = statusMappings[0].project_status_mapping_id;

    // Get existing phases
    const existingPhases = await ProjectModel.getPhases(trx, projectId);
    const existingPhaseMap = new Map<string, IProjectPhase>();
    existingPhases.forEach(phase => {
      existingPhaseMap.set(phase.phase_name.toLowerCase(), phase);
    });

    let phasesCreated = 0;
    let tasksCreated = 0;
    const errors: string[] = [];

    // Import fractional indexing for phase ordering
    const { generateKeyBetween } = await import('fractional-indexing');

    for (const groupedPhase of groupedPhases) {
      try {
        let phase: IProjectPhase;
        const existingPhase = existingPhaseMap.get(groupedPhase.phase_name.toLowerCase());

        if (existingPhase) {
          // Use existing phase
          phase = existingPhase;
        } else {
          // Create new phase
          const phases = await ProjectModel.getPhases(trx, projectId);
          const nextOrderNumber = phases.length + 1;

          // Generate WBS code
          const phaseNumbers = phases
            .map((p): number => {
              const parts = p.wbs_code.split('.');
              return parseInt(parts[parts.length - 1]);
            })
            .filter(num => !isNaN(num));
          const maxPhaseNumber = phaseNumbers.length > 0 ? Math.max(...phaseNumbers) : 0;
          const newWbsCode = `${project.wbs_code}.${maxPhaseNumber + 1}`;

          // Generate order key
          let orderKey: string;
          if (phases.length === 0) {
            orderKey = generateKeyBetween(null, null);
          } else {
            const sortedPhases = [...phases].sort((a, b) => {
              if (a.order_key && b.order_key) {
                return a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : 0;
              }
              return 0;
            });
            const lastPhase = sortedPhases[sortedPhases.length - 1];
            orderKey = generateKeyBetween(lastPhase.order_key || null, null);
          }

          phase = await ProjectModel.addPhase(trx, {
            project_id: projectId,
            phase_name: groupedPhase.phase_name,
            description: groupedPhase.description,
            start_date: null,
            end_date: null,
            status: 'pending',
            order_number: nextOrderNumber,
            wbs_code: newWbsCode,
            order_key: orderKey,
          });

          phasesCreated++;
          existingPhaseMap.set(groupedPhase.phase_name.toLowerCase(), phase);
        }

        // Create tasks for this phase
        for (const taskData of groupedPhase.tasks) {
          try {
            // Determine the status mapping ID for this task
            let taskStatusMappingId: string;
            if (taskData.status_mapping_id) {
              // Already resolved during grouping
              taskStatusMappingId = taskData.status_mapping_id;
            } else if (taskData.status_name) {
              // Look up from resolutions
              const resolvedId = statusMappingByName[taskData.status_name.toLowerCase().trim()];
              taskStatusMappingId = resolvedId || defaultUnspecifiedStatusId || firstStatusMappingId;
            } else {
              // No status specified - use first status
              taskStatusMappingId = firstStatusMappingId;
            }

            const newTask = await ProjectTaskModel.addTask(trx, phase.phase_id, {
              task_name: taskData.task_name,
              description: taskData.description,
              assigned_to: taskData.assigned_to,
              estimated_hours: taskData.estimated_hours,
              actual_hours: taskData.actual_hours,
              due_date: taskData.due_date,
              priority_id: taskData.priority_id,
              service_id: taskData.service_id,
              task_type_key: taskData.task_type_key,
              project_status_mapping_id: taskStatusMappingId,
            });

            // Apply tags if present
            if (taskData.tags.length > 0) {
              const pendingTags = taskData.tags.map(tagText => ({
                tag_text: tagText,
                background_color: null,
                text_color: null,
                isNew: true,
              }));
              await createTagsForEntity(newTask.task_id, 'project_task', pendingTags);
            }

            tasksCreated++;
          } catch (taskError) {
            const errorMessage = taskError instanceof Error ? taskError.message : 'Unknown error';
            errors.push(`Failed to create task "${taskData.task_name}": ${errorMessage}`);
          }
        }
      } catch (phaseError) {
        const errorMessage = phaseError instanceof Error ? phaseError.message : 'Unknown error';
        errors.push(`Failed to process phase "${groupedPhase.phase_name}": ${errorMessage}`);
      }
    }

    return {
      success: errors.length === 0,
      phasesCreated,
      tasksCreated,
      errors,
    };
  });
}

/**
 * Create a new status mapping for a project by first creating a tenant-level status,
 * then adding it to the project.
 *
 * This follows the same pattern as the template wizard's QuickAddStatus component
 * which uses createTenantProjectStatus.
 */
async function createNewStatusMapping(
  trx: Knex.Transaction,
  projectId: string,
  statusName: string,
  existingCount: number,
  tenant: string
): Promise<IProjectStatusMapping> {
  // Use advisory lock to serialize status creation for this tenant/type combination
  // This matches the logic in createTenantProjectStatus
  const lockKey = `${tenant}:project_task:project_task`;

  // Create a stable 32-bit integer hash
  let hash = 0;
  for (let i = 0; i < lockKey.length; i++) {
    const char = lockKey.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  const lockHash = Math.abs(hash) % 2147483647; // Ensure it fits in PostgreSQL integer range

  // Acquire advisory lock
  await trx.raw('SELECT pg_advisory_xact_lock(?)', [lockHash]);

  // Get next order number for the tenant's status library
  const maxOrder = await trx('statuses')
    .where({ tenant, status_type: 'project_task' })
    .max('order_number as max')
    .first();

  const orderNumber = (maxOrder?.max ?? 0) + 1;

  // Create a new status in the tenant's status library
  const [newStatus] = await trx('statuses')
    .insert({
      tenant,
      item_type: 'project_task',
      status_type: 'project_task',
      name: statusName,
      is_closed: false,
      order_number: orderNumber,
      color: '#6B7280', // Default gray color
      created_at: new Date().toISOString()
    })
    .returning('*');

  // Now create the project status mapping pointing to the new status
  const [newMapping] = await trx('project_status_mappings')
    .insert({
      tenant,
      project_id: projectId,
      status_id: newStatus.status_id,
      display_order: existingCount + 1,
      is_visible: true,
      is_standard: false,
    })
    .returning('*');

  return {
    ...newMapping,
    status_name: statusName,
    name: statusName,
  };
}

/**
 * Parse a date string to Date object
 * Supports: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY
 */
function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr?.trim()) return null;

  const trimmed = dateStr.trim();

  // Try YYYY-MM-DD format
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const date = new Date(trimmed);
    return isNaN(date.getTime()) ? null : date;
  }

  // Try MM/DD/YYYY or DD/MM/YYYY format
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    // Assume MM/DD/YYYY (US format)
    const month = parseInt(slashMatch[1], 10);
    const day = parseInt(slashMatch[2], 10);
    const year = parseInt(slashMatch[3], 10);

    // Basic validation
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(year, month - 1, day);
      return isNaN(date.getTime()) ? null : date;
    }
  }

  // Try parsing as generic date string
  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parse a number string to number
 */
function parseNumber(numStr: string | undefined): number | null {
  if (!numStr?.trim()) return null;

  const parsed = parseFloat(numStr.trim());
  return isNaN(parsed) ? null : parsed;
}
