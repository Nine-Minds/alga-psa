/**
 * Phase/Task CSV Import Interfaces
 *
 * These interfaces define the data structures for importing phases and tasks
 * from CSV files into existing or new projects.
 */

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
  tags: { label: 'Tags', required: false }
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
  /** User ID after lookup (first agent in comma-separated list) */
  assigned_to: string | null;
  /** Additional agent User IDs (remaining agents in comma-separated list) */
  additional_agent_ids: string[];
  estimated_hours: number | null;
  actual_hours: number | null;
  due_date: Date | null;
  priority_id: string | null;
  service_id: string | null;
  task_type_key: string;
  /** Original status name from CSV */
  status_name: string | null;
  /** Resolved status mapping ID (null if unmatched) */
  status_mapping_id: string | null;
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
  /** name -> user_id */
  userLookup: Record<string, string>;
  /** name -> priority_id */
  priorityLookup: Record<string, string>;
  /** name -> service_id */
  serviceLookup: Record<string, string>;
  /** name -> project_status_mapping_id */
  statusLookup: Record<string, string>;
  /** List of status names that don't match */
  unmatchedStatuses: string[];
  /** List of agent names that don't match */
  unmatchedAgents: string[];
}

/**
 * Reference data for import operations.
 * Contains both full objects (for dropdowns) and lookup maps (for validation).
 * Fetched in a single transaction to reduce DB connection usage.
 */
export interface IImportReferenceData {
  // Full objects for dropdowns
  users: Array<{ user_id: string; first_name: string; last_name: string }>;
  priorities: Array<{ priority_id: string; priority_name: string }>;
  services: Array<{ service_id: string; service_name: string }>;
  statusMappings: Array<{
    project_status_mapping_id: string;
    status_name: string;
    name: string;
    custom_name?: string;
    is_closed?: boolean;
  }>;
  // Lookup maps for validation (case-insensitive name -> id)
  userLookup: Record<string, string>;
  priorityLookup: Record<string, string>;
  serviceLookup: Record<string, string>;
  statusLookup: Record<string, string>;
}

/**
 * Information about an unmatched status and affected tasks
 */
export interface IUnmatchedStatusInfo {
  statusName: string;
  taskCount: number;
  /** First few task names for display */
  taskNames: string[];
}

/**
 * Resolution option for an unmatched status
 */
export type StatusResolutionAction = 'create' | 'use_default' | 'map_to_existing';

export interface IStatusResolution {
  originalStatusName: string;
  action: StatusResolutionAction;
  /** If action is 'map_to_existing', the target status ID */
  mappedStatusId?: string;
}

/**
 * Information about an unmatched agent and affected tasks
 */
export interface IUnmatchedAgentInfo {
  agentName: string;
  taskCount: number;
  /** First few task names for display */
  taskNames: string[];
  /** Whether this agent appears as primary (first in list) for any task */
  isPrimaryAgent: boolean;
}

/**
 * Resolution option for an unmatched agent
 * Note: Unlike statuses, we cannot create new users, so options are limited to skip or map.
 */
export type AgentResolutionAction = 'skip' | 'map_to_existing';

export interface IAgentResolution {
  originalAgentName: string;
  action: AgentResolutionAction;
  /** If action is 'map_to_existing', the target user ID */
  mappedUserId?: string;
}

/**
 * Default phase name for tasks without a phase assignment
 */
export const DEFAULT_PHASE_NAME = 'Unsorted Tasks';

/**
 * Default color for new status columns (gray)
 */
export const DEFAULT_STATUS_COLOR = '#6B7280';

/**
 * Import options for the dialog
 */
export interface IPhaseTaskImportOptions {
  skipInvalidRows: boolean;
}
