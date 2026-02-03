'use server';

import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/shared/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { unparseCSV } from '@alga-psa/core';
import { getAllUsersBasic } from '@alga-psa/users/actions';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { getServices } from './serviceCatalogActions';
import { createTagsForEntityWithTransaction } from '@alga-psa/tags/actions';
import ProjectModel from '@alga-psa/projects/models/project';
import ProjectTaskModel from '../models/projectTask';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { IProjectPhase } from '@alga-psa/types';
import { IPriority } from '@alga-psa/types';
import { IService } from '@alga-psa/types';
import { IUser } from '@shared/interfaces/user.interfaces';
import {
  buildProjectTaskAssignedPayload,
  buildProjectTaskCreatedPayload,
} from '@shared/workflow/streams/domainEventBuilders/projectTaskEventBuilders';
import {
  ITaskImportRow,
  ITaskImportValidationResult,
  IGroupedPhaseData,
  IPhaseTaskImportResult,
  IPhaseTaskValidationResponse,
  IImportReferenceData,
  IStatusResolution,
  IAgentResolution,
  DEFAULT_PHASE_NAME,
  DEFAULT_STATUS_COLOR,
  MappableTaskField,
} from '@alga-psa/types';
import { IProjectStatusMapping } from '@alga-psa/types';

async function resolveProjectStatusInfo(
  trx: Knex.Transaction,
  tenant: string,
  projectStatusMappingId: string
): Promise<{ status: string; isClosed: boolean }> {
  const row = await trx('project_status_mappings as psm')
    .leftJoin('statuses as s', function joinStatuses(this: Knex.JoinClause) {
      this.on('psm.status_id', '=', 's.status_id').andOn('psm.tenant', '=', 's.tenant');
    })
    .leftJoin('standard_statuses as ss', function joinStandardStatuses(this: Knex.JoinClause) {
      this.on('psm.standard_status_id', '=', 'ss.standard_status_id').andOn('psm.tenant', '=', 'ss.tenant');
    })
    .where({ 'psm.project_status_mapping_id': projectStatusMappingId, 'psm.tenant': tenant })
    .select(
      trx.raw(
        'COALESCE(psm.custom_name, s.name, ss.name, psm.project_status_mapping_id::text) as status_name'
      ),
      trx.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed')
    )
    .first<{ status_name: string; is_closed: boolean }>();

  if (!row) {
    return { status: projectStatusMappingId, isClosed: false };
  }

  return { status: row.status_name, isClosed: Boolean(row.is_closed) };
}

/**
 * Parse a date string to Date object
 * Supports: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY
 */
function parseImportDate(dateStr: string | undefined): Date | null {
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
function parseImportNumber(numStr: string | undefined): number | null {
  if (!numStr?.trim()) return null;

  const parsed = parseFloat(numStr.trim());
  return isNaN(parsed) ? null : parsed;
}

/**
 * Group CSV rows into phases and tasks structure
 * Note: Made async to satisfy Next.js server action requirements.
 */
export async function groupRowsIntoPhases(
  rows: ITaskImportRow[],
  userLookup: Record<string, string>,
  priorityLookup: Record<string, string>,
  serviceLookup: Record<string, string>,
  statusLookup: Record<string, string> = {},
  agentResolutions: IAgentResolution[] = []
): Promise<IGroupedPhaseData[]> {
  const phaseMap = new Map<string, IGroupedPhaseData>();

  // Build a map of agent resolutions for quick lookup
  const agentResolutionMap = new Map<string, IAgentResolution>();
  agentResolutions.forEach(resolution => {
    agentResolutionMap.set(resolution.originalAgentName.toLowerCase().trim(), resolution);
  });

  for (const row of rows) {
    if (!row.task_name?.trim()) continue;

    const phaseName = row.phase_name?.trim() || DEFAULT_PHASE_NAME;

    if (!phaseMap.has(phaseName)) {
      phaseMap.set(phaseName, {
        phase_name: phaseName,
        description: null,
        tasks: [],
      });
    }

    // Parse comma-separated agents: first = primary assigned_to, rest = additional agents
    const agentNames = row.assigned_to
      ? row.assigned_to.split(',').map(name => name.trim()).filter(name => name)
      : [];

    // Resolve agent IDs using userLookup and agentResolutions
    const resolveAgentId = (agentName: string): string | null => {
      const normalizedName = agentName.toLowerCase().trim();

      // First check if there's a direct match in userLookup
      if (userLookup[normalizedName]) {
        return userLookup[normalizedName];
      }

      // Check if there's a resolution for this agent
      const resolution = agentResolutionMap.get(normalizedName);
      if (resolution) {
        if (resolution.action === 'map_to_existing' && resolution.mappedUserId) {
          return resolution.mappedUserId;
        }
        // If action is 'skip', return null
        return null;
      }

      // No match found
      return null;
    };

    const primaryAgentId = agentNames.length > 0 ? resolveAgentId(agentNames[0]) : null;
    // Filter out additional agents that match the primary agent to avoid constraint violations
    const additionalAgentIds = agentNames.slice(1)
      .map(name => resolveAgentId(name))
      .filter((id): id is string => id !== null && id !== primaryAgentId);

    const priorityName = row.priority?.toLowerCase().trim() || '';
    const serviceName = row.service?.toLowerCase().trim() || '';
    const statusName = row.status?.trim() || '';
    const statusNameLower = statusName.toLowerCase();

    phaseMap.get(phaseName)!.tasks.push({
      task_name: row.task_name.trim(),
      description: row.task_description?.trim() || null,
      assigned_to: primaryAgentId,
      additional_agent_ids: additionalAgentIds,
      estimated_hours: parseImportNumber(row.estimated_hours),
      actual_hours: parseImportNumber(row.actual_hours),
      due_date: parseImportDate(row.due_date),
      priority_id: priorityLookup[priorityName] || null,
      service_id: serviceLookup[serviceName] || null,
      task_type_key: row.task_type?.trim() || 'task',
      status_name: statusName || null,
      status_mapping_id: statusLookup[statusNameLower] || null,
      tags: row.tags ? row.tags.split(',').map(t => t.trim()).filter(t => t) : [],
    });
  }

  // Sort phases: named phases in order of appearance, then "Unsorted Tasks" last
  const phases = Array.from(phaseMap.values());
  phases.sort((a, b) => {
    if (a.phase_name === DEFAULT_PHASE_NAME) return 1;
    if (b.phase_name === DEFAULT_PHASE_NAME) return -1;
    return 0;
  });

  return phases;
}

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
      assigned_to: 'Mike Wilson, Sarah Johnson',  // First = primary, rest = additional agents
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
 * Fetch all reference data needed for import in a single transaction.
 * Returns both full objects (for dropdowns) and lookup maps (for validation).
 * This eliminates multiple connection acquisitions during import.
 */
export const getImportReferenceData = withAuth(async (
  _user,
  { tenant },
  projectId?: string
): Promise<IImportReferenceData> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    // Fetch all reference data in parallel within the same transaction
    const [users, priorities, services, statusMappings] = await Promise.all([
      // Users (only active internal/MSP agents - exclude client portal users)
      trx('users')
        .select('user_id', 'username', 'first_name', 'last_name', 'email', 'user_type', 'is_inactive', 'tenant')
        .where('tenant', tenant)
        .where('is_inactive', false)
        .where('user_type', 'internal')
        .orderBy(['first_name', 'last_name']),

      // Priorities for project_task
      trx('priorities')
        .select('priority_id', 'priority_name')
        .where('tenant', tenant)
        .where('item_type', 'project_task')
        .orderBy('order_number'),

      // Active services
      trx('service_catalog')
        .select('service_id', 'service_name')
        .where('tenant', tenant)
        .where('is_active', true)
        .orderBy('service_name'),

      // Status mappings (only if projectId provided)
      projectId && tenant
        ? trx('project_status_mappings as psm')
            .where({ 'psm.project_id': projectId, 'psm.tenant': tenant })
            .leftJoin('statuses as s', function(this: Knex.JoinClause) {
              this.on('psm.status_id', 's.status_id')
                .andOn('psm.tenant', 's.tenant');
            })
            .leftJoin('standard_statuses as ss', function(this: Knex.JoinClause) {
              this.on('psm.standard_status_id', 'ss.standard_status_id')
                .andOn('psm.tenant', 'ss.tenant');
            })
            .select(
              'psm.project_status_mapping_id',
              'psm.custom_name',
              trx.raw('COALESCE(psm.custom_name, s.name, ss.name) as status_name'),
              trx.raw('COALESCE(psm.custom_name, s.name, ss.name) as name'),
              trx.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed')
            )
            .orderBy('psm.display_order')
        : Promise.resolve([]),
    ]);

    // Build lookup maps (case-insensitive)
    const userLookup: Record<string, string> = {};
    users.forEach((user: { user_id: string; first_name: string; last_name: string }) => {
      const fullName = `${user.first_name} ${user.last_name}`.toLowerCase().trim();
      userLookup[fullName] = user.user_id;
    });

    const priorityLookup: Record<string, string> = {};
    priorities.forEach((priority: { priority_id: string; priority_name: string }) => {
      priorityLookup[priority.priority_name.toLowerCase().trim()] = priority.priority_id;
    });

    const serviceLookup: Record<string, string> = {};
    services.forEach((service: { service_id: string; service_name: string }) => {
      serviceLookup[service.service_name.toLowerCase().trim()] = service.service_id;
    });

    const statusLookup: Record<string, string> = {};
    statusMappings.forEach((mapping: { project_status_mapping_id: string; status_name?: string; name?: string; custom_name?: string }) => {
      const statusName = mapping.custom_name || mapping.status_name || mapping.name;
      if (statusName) {
        statusLookup[statusName.toLowerCase().trim()] = mapping.project_status_mapping_id;
      }
    });

    return {
      users,
      priorities,
      services,
      statusMappings,
      userLookup,
      priorityLookup,
      serviceLookup,
      statusLookup,
    };
  });
});

/**
 * Validate phase/task import data using pre-fetched reference data.
 * This is a pure validation function that doesn't fetch any data.
 * Note: Made async to satisfy Next.js server action requirements.
 */
export async function validatePhaseTaskImportDataWithReferenceData(
  rows: ITaskImportRow[],
  referenceData: IImportReferenceData
): Promise<IPhaseTaskValidationResponse> {
  const { userLookup, priorityLookup, serviceLookup, statusLookup } = referenceData;

  // Collect unique status names from CSV that don't match existing statuses
  const csvStatusNames = new Set<string>();
  rows.forEach(row => {
    const statusName = row.status?.trim();
    if (statusName) {
      csvStatusNames.add(statusName);
    }
  });

  const unmatchedStatuses: string[] = [];
  csvStatusNames.forEach(statusName => {
    if (!statusLookup[statusName.toLowerCase()]) {
      unmatchedStatuses.push(statusName);
    }
  });

  // Collect unique agent names from CSV that don't match existing users
  const unmatchedAgents: string[] = [];
  const csvAgentNames = new Set<string>();
  rows.forEach(row => {
    if (row.assigned_to?.trim()) {
      const agentNames = row.assigned_to.split(',').map(name => name.trim()).filter(name => name);
      agentNames.forEach(agentName => {
        csvAgentNames.add(agentName);
      });
    }
  });

  csvAgentNames.forEach(agentName => {
    const normalizedName = agentName.toLowerCase();
    if (!userLookup[normalizedName]) {
      unmatchedAgents.push(agentName);
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

    // Name matching validation - supports comma-separated agents
    if (row.assigned_to?.trim()) {
      const agentNames = row.assigned_to.split(',').map(name => name.trim()).filter(name => name);
      const notFoundAgents: string[] = [];

      agentNames.forEach(agentName => {
        const normalizedName = agentName.toLowerCase();
        if (!userLookup[normalizedName]) {
          notFoundAgents.push(agentName);
        }
      });

      if (notFoundAgents.length > 0) {
        if (notFoundAgents.length === agentNames.length) {
          warnings.push(`User(s) "${notFoundAgents.join(', ')}" not found - task will be unassigned`);
        } else {
          warnings.push(`User(s) "${notFoundAgents.join(', ')}" not found - will be skipped`);
        }
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

    // Date validation
    if (row.due_date?.trim()) {
      const parsedDate = parseImportDate(row.due_date);
      if (!parsedDate) {
        warnings.push(`Invalid date format for due_date: "${row.due_date}" - will be skipped`);
      }
    }

    // Number validation
    if (row.estimated_hours?.trim()) {
      const parsed = parseImportNumber(row.estimated_hours);
      if (parsed === null || parsed < 0) {
        warnings.push(`Invalid estimated_hours: "${row.estimated_hours}" - will be skipped`);
      }
    }

    if (row.actual_hours?.trim()) {
      const parsed = parseImportNumber(row.actual_hours);
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
    unmatchedAgents,
  };
}

/**
 * Validate phase/task import data and build lookup maps
 * @deprecated Use getImportReferenceData + validatePhaseTaskImportDataWithReferenceData for better performance
 */
export const validatePhaseTaskImportData = withAuth(async (
  _user,
  { tenant },
  rows: ITaskImportRow[],
  projectId?: string
): Promise<IPhaseTaskValidationResponse> => {
  const { knex: db } = await createTenantKnex();

  // Fetch lookup data
  const [users, priorities, servicesResponse] = await Promise.all([
    getAllUsersBasic(true, 'internal'), // Only fetch active internal/MSP agents
    getAllPriorities('project_task'),
    getServices(1, 999),
  ]);

  const services = servicesResponse.services.filter((service) => {
    const isActive = (service as any).is_active;
    return isActive === undefined ? true : Boolean(isActive);
  });

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

  if (projectId && tenant) {
    // Query with joins to get actual status names
    const statusMappings = await db('project_status_mappings as psm')
      .where({ 'psm.project_id': projectId, 'psm.tenant': tenant })
      .leftJoin('statuses as s', function(this: Knex.JoinClause) {
        this.on('psm.status_id', 's.status_id')
          .andOn('psm.tenant', 's.tenant');
      })
      .leftJoin('standard_statuses as ss', function(this: Knex.JoinClause) {
        this.on('psm.standard_status_id', 'ss.standard_status_id')
          .andOn('psm.tenant', 'ss.tenant');
      })
      .select(
        'psm.*',
        db.raw('COALESCE(psm.custom_name, s.name, ss.name) as status_name'),
        db.raw('COALESCE(psm.custom_name, s.name, ss.name) as name')
      );

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

  // Collect unique agent names from CSV that don't match existing users
  const unmatchedAgents: string[] = [];
  const csvAgentNames = new Set<string>();
  rows.forEach(row => {
    if (row.assigned_to?.trim()) {
      const agentNames = row.assigned_to.split(',').map(name => name.trim()).filter(name => name);
      agentNames.forEach(agentName => {
        csvAgentNames.add(agentName);
      });
    }
  });

  csvAgentNames.forEach(agentName => {
    const normalizedName = agentName.toLowerCase();
    if (!userLookup[normalizedName]) {
      unmatchedAgents.push(agentName);
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

    // Name matching validation - supports comma-separated agents (first = primary, rest = additional)
    if (row.assigned_to?.trim()) {
      const agentNames = row.assigned_to.split(',').map(name => name.trim()).filter(name => name);
      const notFoundAgents: string[] = [];

      agentNames.forEach(agentName => {
        const normalizedName = agentName.toLowerCase();
        if (!userLookup[normalizedName]) {
          notFoundAgents.push(agentName);
        }
      });

      if (notFoundAgents.length > 0) {
        if (notFoundAgents.length === agentNames.length) {
          // All agents not found
          warnings.push(`User(s) "${notFoundAgents.join(', ')}" not found - task will be unassigned`);
        } else {
          // Some agents not found
          warnings.push(`User(s) "${notFoundAgents.join(', ')}" not found - will be skipped`);
        }
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
      const parsedDate = parseImportDate(row.due_date);
      if (!parsedDate) {
        warnings.push(`Invalid date format for due_date: "${row.due_date}" - will be skipped`);
      }
    }

    // Number validation
    if (row.estimated_hours?.trim()) {
      const parsed = parseImportNumber(row.estimated_hours);
      if (parsed === null || parsed < 0) {
        warnings.push(`Invalid estimated_hours: "${row.estimated_hours}" - will be skipped`);
      }
    }

    if (row.actual_hours?.trim()) {
      const parsed = parseImportNumber(row.actual_hours);
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
    unmatchedAgents,
  };
});

/**
 * Default status column name for tasks without a matching status
 */
const DEFAULT_UNSPECIFIED_STATUS_NAME = 'No Status Specified';

/**
 * Import phases and tasks into an existing project
 */
export const importPhasesAndTasks = withAuth(async (
  user,
  { tenant },
  projectId: string,
  groupedPhases: IGroupedPhaseData[],
  statusResolutions: IStatusResolution[] = []
): Promise<IPhaseTaskImportResult> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'project', 'update')) {
      throw new Error('Permission denied: Cannot update projects');
    }

    // Verify project exists
    const project = await ProjectModel.getById(trx, tenant, projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Get existing status mappings
    let statusMappings = await ProjectModel.getProjectStatusMappings(trx, tenant, projectId);
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
        const newMapping = await createNewStatusMapping(trx, projectId, resolution.originalStatusName, statusMappings.length, tenant);
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
            const newMapping = await createNewStatusMapping(trx, projectId, DEFAULT_UNSPECIFIED_STATUS_NAME, statusMappings.length, tenant);
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
    const existingPhases = await ProjectModel.getPhases(trx, tenant, projectId);
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
          const phases = await ProjectModel.getPhases(trx, tenant, projectId);
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

          phase = await ProjectModel.addPhase(trx, tenant, {
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

            const newTask = await ProjectTaskModel.addTask(trx, tenant, phase.phase_id, {
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

            // Apply tags if present (using transaction for atomicity)
            if (taskData.tags.length > 0) {
              const pendingTags = taskData.tags.map(tagText => ({
                tag_text: tagText,
                background_color: null,
                text_color: null,
                isNew: true,
              }));
              await createTagsForEntityWithTransaction(trx, tenant, newTask.task_id, 'project_task', pendingTags);
            }

            // Add additional agents as task resources (only if primary agent is assigned)
            // Filter out any agents that match the primary assigned_to to avoid constraint violation
            if (taskData.assigned_to && taskData.additional_agent_ids && taskData.additional_agent_ids.length > 0) {
              const uniqueAdditionalAgents = taskData.additional_agent_ids.filter(
                agentId => agentId !== taskData.assigned_to
              );
              for (const additionalAgentId of uniqueAdditionalAgents) {
                await ProjectTaskModel.addTaskResource(trx, tenant, newTask.task_id, additionalAgentId);
              }
            }

            const occurredAt = newTask.created_at instanceof Date ? newTask.created_at : new Date();
            const ctx = {
              tenantId: tenant,
              occurredAt,
              actor: { actorType: 'USER' as const, actorUserId: user.user_id },
            };
            const statusInfo = await resolveProjectStatusInfo(trx, tenant, newTask.project_status_mapping_id);

            await publishWorkflowEvent({
              eventType: 'PROJECT_TASK_CREATED',
              ctx,
              payload: buildProjectTaskCreatedPayload({
                projectId,
                taskId: newTask.task_id,
                title: newTask.task_name,
                dueDate: newTask.due_date,
                status: statusInfo.status,
                createdByUserId: user.user_id,
                createdAt: occurredAt,
              }),
            });

            if (newTask.assigned_to) {
              await publishWorkflowEvent({
                eventType: 'PROJECT_TASK_ASSIGNED',
                ctx,
                payload: buildProjectTaskAssignedPayload({
                  projectId,
                  taskId: newTask.task_id,
                  assignedToId: newTask.assigned_to,
                  assignedToType: 'user',
                  assignedByUserId: user.user_id,
                  assignedByName: user.first_name && user.last_name ? `${user.first_name} ${user.last_name}` : undefined,
                  assignedAt: occurredAt,
                }),
              });
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
});

/**
 * Create a new status mapping for a project by first finding or creating a tenant-level status,
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

  // Check if status already exists in tenant's status library
  let status = await trx('statuses')
    .where({ tenant, name: statusName, status_type: 'project_task' })
    .first();

  if (!status) {
    // Get next order number for the tenant's status library
    const maxOrder = await trx('statuses')
      .where({ tenant, status_type: 'project_task' })
      .max('order_number as max')
      .first();

    const orderNumber = (maxOrder?.max ?? 0) + 1;

    // Create a new status in the tenant's status library
    [status] = await trx('statuses')
      .insert({
        tenant,
        item_type: 'project_task',
        status_type: 'project_task',
        name: statusName,
        is_closed: false,
        order_number: orderNumber,
        color: DEFAULT_STATUS_COLOR,
        created_at: new Date().toISOString()
      })
      .returning('*');
  }

  // Check if a mapping already exists for this status in this project
  const existingMapping = await trx('project_status_mappings')
    .where({ tenant, project_id: projectId, status_id: status.status_id })
    .first();

  if (existingMapping) {
    return {
      ...existingMapping,
      status_name: statusName,
      name: statusName,
    };
  }

  // Create the project status mapping pointing to the status
  const [newMapping] = await trx('project_status_mappings')
    .insert({
      tenant,
      project_id: projectId,
      status_id: status.status_id,
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
