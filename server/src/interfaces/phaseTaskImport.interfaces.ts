/**
 * Phase/Task CSV Import Interfaces
 *
 * These interfaces define the data structures for importing phases and tasks
 * from CSV files into existing or new projects.
 */

import { TenantEntity } from './index';

/**
 * All mappable fields in the CSV import
 */
export type MappableTaskField =
  | 'phase_name'
  | 'task_name'
  | 'task_description'
  | 'assigned_to'
  | 'estimated_hours'
  | 'actual_hours'
  | 'due_date'
  | 'priority'
  | 'service'
  | 'task_type'
  | 'status'
  | 'tags';

/**
 * Field definitions with display labels and required status
 */
export const TASK_IMPORT_FIELDS: Record<MappableTaskField, { label: string; required: boolean }> = {
  phase_name: { label: 'Phase Name', required: false },
  task_name: { label: 'Task Name *', required: true },
  task_description: { label: 'Task Description', required: false },
  assigned_to: { label: 'Assigned To', required: false },
  estimated_hours: { label: 'Estimated Hours', required: false },
  actual_hours: { label: 'Actual Hours', required: false },
  due_date: { label: 'Due Date', required: false },
  priority: { label: 'Priority', required: false },
  service: { label: 'Service', required: false },
  task_type: { label: 'Task Type', required: false },
  status: { label: 'Status', required: false },
  tags: { label: 'Tags', required: false },
};

/**
 * Mapping between CSV column header and task field
 */
export interface ICSVTaskColumnMapping {
  csvHeader: string;
  taskField: MappableTaskField | null;
}

/**
 * Preview data from parsed CSV
 */
export interface ICSVTaskPreviewData {
  headers: string[];
  rows: string[][];
}

/**
 * Raw row data from CSV (all values as strings)
 */
export interface ITaskImportRow {
  phase_name?: string;
  task_name?: string;
  task_description?: string;
  assigned_to?: string;
  estimated_hours?: string;
  actual_hours?: string;
  due_date?: string;
  priority?: string;
  service?: string;
  task_type?: string;
  status?: string;
  tags?: string;
}

/**
 * Validation result for a single CSV row
 */
export interface ITaskImportValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  rowNumber: number;
  data: ITaskImportRow;
}

/**
 * Grouped phase data containing its tasks
 */
export interface IGroupedPhaseData {
  phase_name: string;
  description: string | null;
  tasks: IGroupedTaskData[];
}

/**
 * Processed task data ready for import
 */
export interface IGroupedTaskData {
  task_name: string;
  description: string | null;
  assigned_to: string | null;  // User ID after lookup (first agent in comma-separated list)
  additional_agent_ids: string[];  // Additional agent User IDs (remaining agents in comma-separated list)
  estimated_hours: number | null;
  actual_hours: number | null;
  due_date: Date | null;
  priority_id: string | null;
  service_id: string | null;
  task_type_key: string;
  status_name: string | null;  // Original status name from CSV
  status_mapping_id: string | null;  // Resolved status mapping ID (null if unmatched)
  tags: string[];
}

/**
 * Result of the import operation
 */
export interface IPhaseTaskImportResult {
  success: boolean;
  phasesCreated: number;
  tasksCreated: number;
  errors: string[];
}

/**
 * Validation response including lookup maps for name resolution
 */
export interface IPhaseTaskValidationResponse {
  validationResults: ITaskImportValidationResult[];
  userLookup: Record<string, string>;      // name -> user_id
  priorityLookup: Record<string, string>;  // name -> priority_id
  serviceLookup: Record<string, string>;   // name -> service_id
  statusLookup: Record<string, string>;    // name -> project_status_mapping_id
  unmatchedStatuses: string[];             // List of status names that don't match
  unmatchedAgents: string[];               // List of agent names that don't match
}

/**
 * Information about an unmatched status and affected tasks
 */
export interface IUnmatchedStatusInfo {
  statusName: string;
  taskCount: number;
  taskNames: string[];  // First few task names for display
}

/**
 * Resolution option for an unmatched status
 */
export type StatusResolutionAction = 'create' | 'use_default' | 'map_to_existing';

export interface IStatusResolution {
  originalStatusName: string;
  action: StatusResolutionAction;
  mappedStatusId?: string;  // If action is 'map_to_existing', the target status ID
}

/**
 * Information about an unmatched agent and affected tasks
 */
export interface IUnmatchedAgentInfo {
  agentName: string;
  taskCount: number;
  taskNames: string[];  // First few task names for display
  isPrimaryAgent: boolean;  // Whether this agent appears as primary (first in list) for any task
}

/**
 * Resolution option for an unmatched agent
 * Note: Unlike statuses, we cannot create new users, so options are limited to skip or map
 */
export type AgentResolutionAction = 'skip' | 'map_to_existing';

export interface IAgentResolution {
  originalAgentName: string;
  action: AgentResolutionAction;
  mappedUserId?: string;  // If action is 'map_to_existing', the target user ID
}

/**
 * Default phase name for tasks without a phase assignment
 */
export const DEFAULT_PHASE_NAME = 'Unsorted Tasks';

/**
 * Default color for new status columns
 * Gray color matching the application's color palette
 */
export const DEFAULT_STATUS_COLOR = '#6B7280';

/**
 * Import options for the dialog
 */
export interface IPhaseTaskImportOptions {
  skipInvalidRows: boolean;
}

/**
 * Parse a date string to Date object
 * Supports: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY
 */
export function parseImportDate(dateStr: string | undefined): Date | null {
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
export function parseImportNumber(numStr: string | undefined): number | null {
  if (!numStr?.trim()) return null;

  const parsed = parseFloat(numStr.trim());
  return isNaN(parsed) ? null : parsed;
}

/**
 * Group CSV rows into phases and tasks structure
 */
export function groupRowsIntoPhases(
  rows: ITaskImportRow[],
  userLookup: Record<string, string>,
  priorityLookup: Record<string, string>,
  serviceLookup: Record<string, string>,
  statusLookup: Record<string, string> = {},
  agentResolutions: IAgentResolution[] = []
): IGroupedPhaseData[] {
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
