import type { TenantEntity } from ".";
import type { ISO8601String } from '../lib/temporal';
import { IScheduleEntry } from "./schedule.interfaces";
import { IProjectTask } from "./project.interfaces";
import { ITimeEntry } from "./timeEntry.interfaces";

export interface IWorkflowExecution {
  execution_id: string;
  tenant: string;
  workflow_name: string;
  workflow_version: string;
  current_state: string;
  status: string;
  workflow_type: 'system' | 'tenant';
  context_data?: Record<string, any>;
  created_at: string;
  updated_at: string;
  version_id?: string;
  correlation_id?: string;
}

/**
 * Types of activities that can be displayed in the User Activities Dashboard
 */
export enum ActivityType {
  SCHEDULE = 'schedule',
  PROJECT_TASK = 'projectTask',
  TICKET = 'ticket',
  TIME_ENTRY = 'timeEntry',
  WORKFLOW_TASK = 'workflowTask',
  NOTIFICATION = 'notification',
  DOCUMENT = 'document'
}

/**
 * Priority levels for activities
 */
export enum ActivityPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high'
}

/**
 * Represents a related entity that can be linked to an activity
 */
export interface RelatedEntity {
  id: string;
  type: 'project' | 'ticket' | 'client' | 'contact' | 'workflow';
  name: string;
  url?: string;
}

/**
 * Represents an action that can be performed on an activity
 */
export interface ActivityAction {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Base interface for all activity types
 * This provides a common structure for displaying activities in the dashboard
 */
export interface ActivityBase extends TenantEntity {
  id: string;
  title: string;
  description?: string;
  type: ActivityType;
  status: string;
  statusColor?: string;
  priority: ActivityPriority;
  dueDate?: ISO8601String;
  startDate?: ISO8601String;
  endDate?: ISO8601String;
  assignedTo?: string[];
  assignedToNames?: string[];
  relatedEntities?: RelatedEntity[];
  sourceId: string;
  sourceType: ActivityType;
  actions: ActivityAction[];
  isClosed?: boolean;
  createdAt: ISO8601String;
  updatedAt: ISO8601String;
}

/**
 * Schedule-specific activity interface
 */
export interface ScheduleActivity extends ActivityBase {
  sourceType: ActivityType.SCHEDULE;
  workItemId?: string;
  workItemType?: string;
  isRecurring?: boolean;
}

/**
 * Project task-specific activity interface
 */
export interface ProjectTaskActivity extends ActivityBase {
  sourceType: ActivityType.PROJECT_TASK;
  projectId: string;
  projectName?: string;
  phaseId: string;
  phaseName?: string;
  estimatedHours?: number;
  actualHours?: number;
  wbsCode?: string;
}

/**
 * Ticket-specific activity interface
 */
export interface TicketActivity extends ActivityBase {
  sourceType: ActivityType.TICKET;
  ticketNumber: string;
  clientId?: string;
  clientName?: string;
  contactId?: string;
  contactName?: string;
  estimatedHours?: number;
}

/**
 * Time entry-specific activity interface
 */
export interface TimeEntryActivity extends ActivityBase {
  sourceType: ActivityType.TIME_ENTRY;
  workItemId: string;
  workItemType: string;
  billableDuration: number;
  timeSheetId?: string;
  approvalStatus?: string;
}

/**
 * Workflow task-specific activity interface
 */
export interface WorkflowTaskActivity extends ActivityBase {
  sourceType: ActivityType.WORKFLOW_TASK;
  executionId: string;
  formId?: string;
  contextData?: Record<string, any>;
  assignedRoles?: string[];
}

/**
 * Notification-specific activity interface
 */
export interface NotificationActivity extends ActivityBase {
  sourceType: ActivityType.NOTIFICATION;
  notificationId: string;
  templateName: string;
  message: string;
  isRead: boolean;
  readAt?: ISO8601String;
  link?: string;
  category?: string;
  metadata?: Record<string, any>;
}

/**
 * Document-specific activity interface
 */
export interface DocumentActivity extends ActivityBase {
  sourceType: ActivityType.DOCUMENT;
  documentId: string;
  documentName: string;
}

/**
 * Union type for all activity types
 */
export type Activity =
  | ScheduleActivity
  | ProjectTaskActivity
  | TicketActivity
  | TimeEntryActivity
  | WorkflowTaskActivity
  | NotificationActivity
  | DocumentActivity;

/**
 * Filters for querying activities
 */
export interface ActivityFilters {
  types?: ActivityType[];
  status?: string[];
  priority?: ActivityPriority[];
  assignedTo?: string[];
  dueDateStart?: ISO8601String;
  dueDateEnd?: ISO8601String;
  dateRangeStart?: ISO8601String;
  dateRangeEnd?: ISO8601String;
  search?: string;
  isClosed?: boolean;
  clientId?: string;
  contactId?: string;
  ticketNumber?: string;
  projectId?: string;
  phaseId?: string;
  isRecurring?: boolean;
  workItemType?: string;
  executionId?: string;
  includeHidden?: boolean;
}

/**
 * Response format for activity queries
 */
export interface ActivityResponse {
  activities: Activity[];
  totalCount: number;
  pageCount: number;
  pageSize: number;
  pageNumber: number;
}

/**
 * Mapper functions to convert from source models to activity models
 */

/**
 * Convert a schedule entry to an activity
 */
export function scheduleEntryToActivity(entry: IScheduleEntry): ScheduleActivity {
  return {
    id: entry.entry_id,
    title: entry.title,
    description: entry.notes,
    type: ActivityType.SCHEDULE,
    status: entry.status,
    priority: ActivityPriority.MEDIUM, // Default priority if not specified
    startDate: entry.scheduled_start.toISOString(),
    endDate: entry.scheduled_end.toISOString(),
    dueDate: entry.scheduled_end.toISOString(),
    assignedTo: entry.assigned_user_ids,
    sourceId: entry.entry_id,
    sourceType: ActivityType.SCHEDULE,
    workItemId: entry.work_item_id || undefined,
    workItemType: entry.work_item_type,
    isRecurring: entry.is_recurring,
    actions: [
      { id: 'view', label: 'View Details' },
      { id: 'edit', label: 'Go to page' }
    ],
    tenant: entry.tenant,
    createdAt: entry.created_at.toISOString(),
    updatedAt: entry.updated_at.toISOString()
  };
}

/**
 * Convert a project task to an activity
 */
export function projectTaskToActivity(task: IProjectTask, projectName?: string, phaseName?: string): ProjectTaskActivity {
  return {
    id: task.task_id,
    title: task.task_name,
    description: task.description || undefined,
    type: ActivityType.PROJECT_TASK,
    status: task.project_status_mapping_id, // This will need to be resolved to a status name
    priority: ActivityPriority.MEDIUM, // Default priority if not specified
    dueDate: task.due_date?.toISOString(),
    assignedTo: task.assigned_to ? [task.assigned_to] : [],
    sourceId: task.task_id,
    sourceType: ActivityType.PROJECT_TASK,
    projectId: task.phase_id, // We need to get the project ID from the phase
    phaseId: task.phase_id,
    projectName,
    phaseName,
    estimatedHours: task.estimated_hours || undefined,
    actualHours: task.actual_hours || undefined,
    wbsCode: task.wbs_code,
    actions: [
      { id: 'view', label: 'View Details' },
      { id: 'edit', label: 'Go to page' }
    ],
    tenant: task.tenant,
    createdAt: task.created_at.toISOString(),
    updatedAt: task.updated_at.toISOString()
  };
}

/**
 * Convert a time entry to an activity
 */
export function timeEntryToActivity(entry: ITimeEntry): TimeEntryActivity {
  return {
    id: entry.entry_id || '',
    title: `Time Entry: ${entry.work_item_type}`,
    description: entry.notes,
    type: ActivityType.TIME_ENTRY,
    status: entry.approval_status,
    priority: ActivityPriority.MEDIUM, // Default priority
    startDate: entry.start_time,
    endDate: entry.end_time,
    assignedTo: [entry.user_id],
    sourceId: entry.entry_id || '',
    sourceType: ActivityType.TIME_ENTRY,
    workItemId: entry.work_item_id,
    workItemType: entry.work_item_type,
    billableDuration: entry.billable_duration,
    timeSheetId: entry.time_sheet_id,
    approvalStatus: entry.approval_status,
    actions: [
      { id: 'view', label: 'View Details' }
    ],
    tenant: entry.tenant,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at
  };
}

/**
 * Convert a workflow task to an activity
 * Note: This is a placeholder as we don't have the exact workflow task interface yet
 */
export function workflowTaskToActivity(
  task: any, // This should be replaced with the actual workflow task interface
  execution?: IWorkflowExecution
): WorkflowTaskActivity {
  return {
    id: task.task_id,
    title: task.title || 'Workflow Task',
    description: task.description,
    type: ActivityType.WORKFLOW_TASK,
    status: task.status,
    priority: mapWorkflowPriority(task.priority),
    dueDate: task.due_date,
    assignedTo: task.assigned_users || [],
    assignedRoles: task.assigned_roles || [],
    sourceId: task.task_id,
    sourceType: ActivityType.WORKFLOW_TASK,
    executionId: task.execution_id || execution?.execution_id || '',
    formId: task.form_id,
    contextData: task.context_data || execution?.context_data,
    actions: generateWorkflowTaskActions(task),
    tenant: task.tenant || execution?.tenant || '',
    createdAt: task.created_at || execution?.created_at || new Date().toISOString(),
    updatedAt: task.updated_at || execution?.updated_at || new Date().toISOString()
  };
}

/**
 * Helper function to map workflow priority to activity priority
 */
function mapWorkflowPriority(priority?: string): ActivityPriority {
  if (!priority) return ActivityPriority.MEDIUM;
  
  switch (priority.toLowerCase()) {
    case 'high':
    case 'urgent':
    case 'critical':
      return ActivityPriority.HIGH;
    case 'low':
    case 'minor':
      return ActivityPriority.LOW;
    case 'medium':
    case 'normal':
    default:
      return ActivityPriority.MEDIUM;
  }
}

/**
 * Helper function to generate actions for workflow tasks based on their state
 */
function generateWorkflowTaskActions(task: any): ActivityAction[] {
  const actions: ActivityAction[] = [
    { id: 'view', label: 'View Details' }
  ];

  // Add actions based on task state
  if (task.status !== 'completed' && task.status !== 'cancelled') {
    if (task.form_id) {
      actions.push({ id: 'complete', label: 'Complete Task' });
    }
    
    if (task.can_reassign) {
      actions.push({ id: 'reassign', label: 'Reassign' });
    }
    
    if (task.can_cancel) {
      actions.push({ id: 'cancel', label: 'Cancel' });
    }
    
    // Add dismiss action for active tasks
    actions.push({ id: 'dismiss', label: 'Dismiss' });
  }

  // Add hide/unhide action based on current visibility
  if (task.is_hidden) {
    actions.push({ id: 'unhide', label: 'Unhide' });
  } else {
    actions.push({ id: 'hide', label: 'Hide' });
  }

  return actions;
}
