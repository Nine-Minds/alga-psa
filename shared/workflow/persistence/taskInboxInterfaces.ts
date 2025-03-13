/**
 * Interfaces for the Task Inbox system
 */
import { WorkflowTaskStatus } from './workflowTaskModel.js';

/**
 * Task creation parameters
 */
export interface TaskCreationParams {
  taskType: string;
  title: string;
  description?: string;
  priority?: string;
  dueDate?: string | Date;
  assignTo?: {
    roles?: string[];
    users?: string[];
  };
  contextData?: Record<string, any>;
  formId?: string;
}

/**
 * Task submission parameters
 */
export interface TaskSubmissionParams {
  taskId: string;
  formData: Record<string, any>;
  comments?: string;
  userId?: string;
}

/**
 * Task query parameters
 */
export interface TaskQueryParams {
  status?: WorkflowTaskStatus | WorkflowTaskStatus[];
  priority?: string;
  assignedToUser?: string;
  assignedToRoles?: string[];
  dueBefore?: string | Date;
  dueAfter?: string | Date;
  taskType?: string;
  executionId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Task query result
 */
export interface TaskQueryResult {
  tasks: TaskDetails[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Task details
 */
export interface TaskDetails {
  taskId: string;
  executionId: string;
  title: string;
  description?: string;
  status: WorkflowTaskStatus;
  priority: string;
  dueDate?: string;
  assignedRoles?: string[];
  assignedUsers?: string[];
  contextData?: Record<string, any>;
  formId: string;
  formSchema?: {
    jsonSchema: Record<string, any>;
    uiSchema?: Record<string, any>;
    defaultValues?: Record<string, any>;
  };
  createdAt: string;
  createdBy?: string;
  claimedAt?: string;
  claimedBy?: string;
  completedAt?: string;
  completedBy?: string;
  responseData?: Record<string, any>;
}

/**
 * Task history entry
 */
export interface TaskHistoryEntry {
  historyId: string;
  taskId: string;
  action: string;
  fromStatus?: string;
  toStatus?: string;
  userId?: string;
  timestamp: string;
  details?: Record<string, any>;
}

/**
 * Task action result
 */
export interface TaskActionResult {
  success: boolean;
  taskId: string;
  status: WorkflowTaskStatus;
  message?: string;
  error?: string;
}

/**
 * Task event types
 */
export enum TaskEventType {
  TASK_CREATED = 'task_created',
  TASK_ASSIGNED = 'task_assigned',
  TASK_CLAIMED = 'task_claimed',
  TASK_UNCLAIMED = 'task_unclaimed',
  TASK_COMPLETED = 'task_completed',
  TASK_CANCELED = 'task_canceled',
  TASK_EXPIRED = 'task_expired'
}

/**
 * Task event naming convention
 */
export const TaskEventNames = {
  /**
   * Generate task created event name
   */
  taskCreated: (taskId: string) => `Task:${taskId}:Created`,
  
  /**
   * Generate task completed event name
   */
  taskCompleted: (taskId: string) => `Task:${taskId}:Complete`,
  
  /**
   * Generate task claimed event name
   */
  taskClaimed: (taskId: string) => `Task:${taskId}:Claimed`,
  
  /**
   * Generate task unclaimed event name
   */
  taskUnclaimed: (taskId: string) => `Task:${taskId}:Unclaimed`,
  
  /**
   * Generate task canceled event name
   */
  taskCanceled: (taskId: string) => `Task:${taskId}:Canceled`,
  
  /**
   * Generate task expired event name
   */
  taskExpired: (taskId: string) => `Task:${taskId}:Expired`,
  
  /**
   * Generate form submission event name
   */
  formSubmitted: (formId: string) => `Form:${formId}:Submit`
};