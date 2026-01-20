/**
 * Phase/Task CSV Import Interfaces
 *
 * These interfaces define the data structures for importing phases and tasks
 * from CSV files into existing or new projects.
 */

import { TenantEntity } from './index';
import { IUser } from '@shared/interfaces/user.interfaces';

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
 * Reference data for import operations.
 * Contains both full objects (for dropdowns) and lookup maps (for validation).
 * Fetched in a single transaction to reduce DB connection usage.
 */
/**
 * Subset of IUser fields needed for the import user picker
 */
export type IImportUser = Pick<IUser, 'user_id' | 'username' | 'first_name' | 'last_name' | 'email' | 'user_type' | 'is_inactive' | 'tenant'>;

export interface IImportReferenceData {
  // Full objects for dropdowns
  users: IImportUser[];
  priorities: Array<{ priority_id: string; priority_name: string }>;
  services: Array<{ service_id: string; service_name: string }>;
  statusMappings: Array<{ project_status_mapping_id: string; status_name: string; name: string; custom_name?: string; is_closed?: boolean }>;
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
