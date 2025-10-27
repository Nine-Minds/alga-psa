/**
 * Workflow API Schemas
 * Comprehensive validation schemas for workflow-related API endpoints
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  booleanTransform,
  dateSchema,
  metadataSchema
} from './common';

// Common workflow enums and types
export const workflowTypeSchema = z.enum(['system', 'tenant']);
export const workflowStatusSchema = z.enum(['draft', 'active', 'inactive', 'archived', 'published']);
export const workflowExecutionStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'paused']);
export const workflowEventTypeSchema = z.enum(['state_change', 'action_complete', 'timer_fired', 'error', 'user_action', 'system_event']);
export const workflowTaskStatusSchema = z.enum(['pending', 'claimed', 'completed', 'canceled', 'expired']);
export const workflowTaskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export const workflowTriggerTypeSchema = z.enum(['manual', 'scheduled', 'event', 'webhook', 'api']);

// ============================
// WORKFLOW REGISTRATION SCHEMAS
// ============================

// Create workflow registration schema
export const createWorkflowRegistrationSchema = z.object({
  name: z.string().min(1, 'Workflow name is required').max(255),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: workflowStatusSchema.optional().default('draft'),
  source_template_id: uuidSchema.optional(),
  code: z.string().optional(), // TypeScript/JavaScript code
  parameters: z.record(z.any()).optional(),
  version: z.string().optional().default('1.0.0')
});

// Update workflow registration schema
export const updateWorkflowRegistrationSchema = createUpdateSchema(createWorkflowRegistrationSchema);

// Workflow registration response schema
export const workflowRegistrationResponseSchema = z.object({
  registration_id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  version: z.string(),
  status: workflowStatusSchema,
  source_template_id: uuidSchema.nullable(),
  created_by: uuidSchema.nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  isSystemManaged: z.boolean(),
  
  // Extended fields
  code: z.string().optional(),
  parameters: z.record(z.any()).optional(),
  execution_count: z.number().optional(),
  last_executed: z.string().datetime().optional()
});

// Workflow registration filter schema
export const workflowRegistrationFilterSchema = baseFilterSchema.extend({
  name: z.string().optional(),
  category: z.string().optional(),
  status: workflowStatusSchema.optional(),
  source_template_id: uuidSchema.optional(),
  created_by: uuidSchema.optional(),
  tags: z.array(z.string()).optional(),
  is_system_managed: booleanTransform.optional()
});

// Workflow registration list query schema
export const workflowRegistrationListQuerySchema = createListQuerySchema(workflowRegistrationFilterSchema);

// ============================
// WORKFLOW EXECUTION SCHEMAS
// ============================

// Create workflow execution schema
export const createWorkflowExecutionSchema = z.object({
  workflow_name: z.string().min(1, 'Workflow name is required'),
  workflow_version: z.string().optional(),
  workflow_type: workflowTypeSchema.optional().default('tenant'),
  context_data: z.record(z.any()).optional(),
  correlation_id: z.string().optional(),
  priority: workflowTaskPrioritySchema.optional().default('medium'),
  scheduled_at: dateSchema.optional(),
  timeout_seconds: z.number().optional()
});

// Update workflow execution schema
export const updateWorkflowExecutionSchema = z.object({
  status: workflowExecutionStatusSchema.optional(),
  current_state: z.string().optional(),
  context_data: z.record(z.any()).optional(),
  correlation_id: z.string().optional()
});

// Workflow execution response schema
export const workflowExecutionResponseSchema = z.object({
  execution_id: uuidSchema,
  tenant: uuidSchema,
  workflow_name: z.string(),
  workflow_version: z.string(),
  current_state: z.string(),
  status: workflowExecutionStatusSchema,
  workflow_type: workflowTypeSchema,
  context_data: z.record(z.any()).nullable(),
  correlation_id: z.string().nullable(),
  version_id: uuidSchema.nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  started_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  
  // Extended fields
  duration_seconds: z.number().optional(),
  error_message: z.string().optional(),
  progress_percentage: z.number().optional(),
  events_count: z.number().optional(),
  tasks_count: z.number().optional()
});

// Workflow execution filter schema
export const workflowExecutionFilterSchema = baseFilterSchema.extend({
  workflow_name: z.string().optional(),
  workflow_version: z.string().optional(),
  status: workflowExecutionStatusSchema.optional(),
  workflow_type: workflowTypeSchema.optional(),
  correlation_id: z.string().optional(),
  current_state: z.string().optional(),
  started_from: dateSchema.optional(),
  started_to: dateSchema.optional(),
  completed_from: dateSchema.optional(),
  completed_to: dateSchema.optional(),
  has_errors: booleanTransform.optional()
});

// Workflow execution list query schema
export const workflowExecutionListQuerySchema = createListQuerySchema(workflowExecutionFilterSchema);

// ============================
// WORKFLOW EVENT SCHEMAS
// ============================

// Create workflow event schema
export const createWorkflowEventSchema = z.object({
  execution_id: uuidSchema,
  event_name: z.string().min(1, 'Event name is required'),
  event_type: workflowEventTypeSchema,
  from_state: z.string().optional(),
  to_state: z.string().optional(),
  user_id: uuidSchema.optional(),
  payload: z.record(z.any()).optional(),
  correlation_id: z.string().optional()
});

// Workflow event response schema
export const workflowEventResponseSchema = z.object({
  event_id: uuidSchema,
  tenant: uuidSchema,
  execution_id: uuidSchema,
  event_name: z.string(),
  event_type: workflowEventTypeSchema,
  from_state: z.string().nullable(),
  to_state: z.string().nullable(),
  user_id: uuidSchema.nullable(),
  payload: z.record(z.any()).nullable(),
  created_at: z.string().datetime(),
  
  // Extended fields
  processing_status: z.enum(['pending', 'published', 'processing', 'completed', 'failed', 'retrying']).optional(),
  error_message: z.string().optional(),
  attempt_count: z.number().optional()
});

// Workflow event filter schema
export const workflowEventFilterSchema = baseFilterSchema.extend({
  execution_id: uuidSchema.optional(),
  event_name: z.string().optional(),
  event_type: workflowEventTypeSchema.optional(),
  from_state: z.string().optional(),
  to_state: z.string().optional(),
  user_id: uuidSchema.optional(),
  processing_status: z.enum(['pending', 'published', 'processing', 'completed', 'failed', 'retrying']).optional()
});

// Workflow event list query schema
export const workflowEventListQuerySchema = createListQuerySchema(workflowEventFilterSchema);

// ============================
// WORKFLOW TASK SCHEMAS
// ============================

// Create workflow task schema
export const createWorkflowTaskSchema = z.object({
  execution_id: uuidSchema,
  event_id: uuidSchema.optional(),
  tenant_task_definition_id: uuidSchema.optional(),
  system_task_definition_task_type: z.string().optional(),
  task_definition_type: z.enum(['tenant', 'system']),
  title: z.string().min(1, 'Task title is required'),
  description: z.string().optional(),
  priority: workflowTaskPrioritySchema.optional().default('medium'),
  due_date: dateSchema.optional(),
  context_data: z.record(z.any()).optional(),
  assigned_roles: z.array(z.string()).optional(),
  assigned_users: z.array(uuidSchema).optional()
});

// Update workflow task schema
export const updateWorkflowTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: workflowTaskStatusSchema.optional(),
  priority: workflowTaskPrioritySchema.optional(),
  due_date: dateSchema.optional(),
  context_data: z.record(z.any()).optional(),
  assigned_roles: z.array(z.string()).optional(),
  assigned_users: z.array(uuidSchema).optional(),
  response_data: z.record(z.any()).optional()
});

// Complete workflow task schema
export const completeWorkflowTaskSchema = z.object({
  response_data: z.record(z.any()).optional(),
  completion_notes: z.string().optional()
});

// Workflow task response schema
export const workflowTaskResponseSchema = z.object({
  task_id: uuidSchema,
  tenant: uuidSchema,
  execution_id: uuidSchema,
  event_id: uuidSchema.nullable(),
  tenant_task_definition_id: uuidSchema.nullable(),
  system_task_definition_task_type: z.string().nullable(),
  task_definition_type: z.enum(['tenant', 'system']),
  title: z.string(),
  description: z.string().nullable(),
  status: workflowTaskStatusSchema,
  priority: workflowTaskPrioritySchema,
  due_date: z.string().datetime().nullable(),
  context_data: z.record(z.any()).nullable(),
  assigned_roles: z.array(z.string()).nullable(),
  assigned_users: z.array(uuidSchema).nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  created_by: uuidSchema.nullable(),
  claimed_at: z.string().datetime().nullable(),
  claimed_by: uuidSchema.nullable(),
  completed_at: z.string().datetime().nullable(),
  completed_by: uuidSchema.nullable(),
  response_data: z.record(z.any()).nullable(),
  
  // Extended fields
  workflow_name: z.string().optional(),
  form_definition: z.record(z.any()).optional(),
  is_overdue: z.boolean().optional(),
  time_to_complete_hours: z.number().optional()
});

// Workflow task filter schema
export const workflowTaskFilterSchema = baseFilterSchema.extend({
  execution_id: uuidSchema.optional(),
  status: workflowTaskStatusSchema.optional(),
  priority: workflowTaskPrioritySchema.optional(),
  assigned_user: uuidSchema.optional(),
  assigned_role: z.string().optional(),
  task_definition_type: z.enum(['tenant', 'system']).optional(),
  due_date_from: dateSchema.optional(),
  due_date_to: dateSchema.optional(),
  is_overdue: booleanTransform.optional(),
  claimed_by: uuidSchema.optional(),
  completed_by: uuidSchema.optional()
});

// Workflow task list query schema
export const workflowTaskListQuerySchema = createListQuerySchema(workflowTaskFilterSchema);

// ============================
// WORKFLOW TEMPLATE SCHEMAS
// ============================

// Create workflow template schema
export const createWorkflowTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(255),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  version: z.string().optional().default('1.0.0'),
  status: workflowStatusSchema.optional().default('draft'),
  definition: z.record(z.any()), // Workflow definition/code
  parameter_schema: z.record(z.any()).optional(),
  default_parameters: z.record(z.any()).optional(),
  ui_metadata: z.record(z.any()).optional()
});

// Update workflow template schema
export const updateWorkflowTemplateSchema = createUpdateSchema(createWorkflowTemplateSchema);

// Workflow template response schema
export const workflowTemplateResponseSchema = z.object({
  template_id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  version: z.string(),
  status: workflowStatusSchema,
  definition: z.record(z.any()),
  parameter_schema: z.record(z.any()).nullable(),
  default_parameters: z.record(z.any()).nullable(),
  ui_metadata: z.record(z.any()).nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Extended fields
  usage_count: z.number().optional(),
  last_used: z.string().datetime().optional(),
  created_by_name: z.string().optional()
});

// Workflow template filter schema
export const workflowTemplateFilterSchema = baseFilterSchema.extend({
  name: z.string().optional(),
  category: z.string().optional(),
  status: workflowStatusSchema.optional(),
  tags: z.array(z.string()).optional(),
  version: z.string().optional()
});

// Workflow template list query schema
export const workflowTemplateListQuerySchema = createListQuerySchema(workflowTemplateFilterSchema);

// ============================
// WORKFLOW TRIGGER SCHEMAS
// ============================

// Create workflow trigger schema
export const createWorkflowTriggerSchema = z.object({
  name: z.string().min(1, 'Trigger name is required').max(255),
  description: z.string().optional(),
  workflow_registration_id: uuidSchema,
  trigger_type: workflowTriggerTypeSchema,
  event_type: z.string().optional(),
  conditions: z.record(z.any()).optional(),
  parameters: z.record(z.any()).optional(),
  is_active: z.boolean().optional().default(true),
  schedule_expression: z.string().optional(), // For scheduled triggers
  webhook_url: z.string().url().optional() // For webhook triggers
});

// Update workflow trigger schema
export const updateWorkflowTriggerSchema = createUpdateSchema(createWorkflowTriggerSchema);

// Workflow trigger response schema
export const workflowTriggerResponseSchema = z.object({
  trigger_id: uuidSchema,
  tenant: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  workflow_registration_id: uuidSchema,
  trigger_type: workflowTriggerTypeSchema,
  event_type: z.string().nullable(),
  conditions: z.record(z.any()).nullable(),
  parameters: z.record(z.any()).nullable(),
  is_active: z.boolean(),
  schedule_expression: z.string().nullable(),
  webhook_url: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  
  // Extended fields
  workflow_name: z.string().optional(),
  last_triggered: z.string().datetime().optional(),
  trigger_count: z.number().optional(),
  next_scheduled_time: z.string().datetime().optional()
});

// Workflow trigger filter schema
export const workflowTriggerFilterSchema = baseFilterSchema.extend({
  name: z.string().optional(),
  workflow_registration_id: uuidSchema.optional(),
  trigger_type: workflowTriggerTypeSchema.optional(),
  event_type: z.string().optional(),
  is_active: booleanTransform.optional()
});

// Workflow trigger list query schema
export const workflowTriggerListQuerySchema = createListQuerySchema(workflowTriggerFilterSchema);

// ============================
// WORKFLOW ACTION SCHEMAS
// ============================

// Workflow action result schema
export const workflowActionResultResponseSchema = z.object({
  result_id: uuidSchema,
  tenant: uuidSchema,
  event_id: uuidSchema,
  execution_id: uuidSchema,
  action_name: z.string(),
  action_path: z.string().nullable(),
  action_group: z.string().nullable(),
  parameters: z.record(z.any()).nullable(),
  result: z.any().nullable(),
  success: z.boolean(),
  error_message: z.string().nullable(),
  idempotency_key: z.string(),
  ready_to_execute: z.boolean(),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  
  // Extended fields
  duration_ms: z.number().optional(),
  retry_count: z.number().optional()
});

// ============================
// WORKFLOW TIMER SCHEMAS
// ============================

// Create workflow timer schema
export const createWorkflowTimerSchema = z.object({
  execution_id: uuidSchema,
  timer_name: z.string().min(1, 'Timer name is required'),
  state_name: z.string().min(1, 'State name is required'),
  duration: z.string(), // ISO 8601 duration or interval
  recurrence: z.string().optional(), // Cron expression for recurring timers
  start_time: dateSchema.optional(),
  metadata: z.record(z.any()).optional()
});

// Workflow timer response schema
export const workflowTimerResponseSchema = z.object({
  timer_id: uuidSchema,
  tenant: uuidSchema,
  execution_id: uuidSchema,
  timer_name: z.string(),
  state_name: z.string(),
  start_time: z.string().datetime(),
  duration: z.string(),
  fire_time: z.string().datetime(),
  recurrence: z.string().nullable(),
  status: z.enum(['pending', 'fired', 'cancelled']),
  created_at: z.string().datetime(),
  
  // Extended fields
  next_fire_time: z.string().datetime().optional(),
  fire_count: z.number().optional()
});

// ============================
// WORKFLOW SNAPSHOT SCHEMAS
// ============================

// Create workflow snapshot schema
export const createWorkflowSnapshotSchema = z.object({
  execution_id: uuidSchema,
  snapshot_type: z.enum(['checkpoint', 'error', 'manual', 'scheduled']),
  state_data: z.record(z.any()),
  context_data: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
  description: z.string().optional()
});

// Workflow snapshot response schema
export const workflowSnapshotResponseSchema = z.object({
  snapshot_id: uuidSchema,
  tenant: uuidSchema,
  execution_id: uuidSchema,
  snapshot_type: z.enum(['checkpoint', 'error', 'manual', 'scheduled']),
  state_data: z.record(z.any()),
  context_data: z.record(z.any()).nullable(),
  metadata: z.record(z.any()).nullable(),
  description: z.string().nullable(),
  created_at: z.string().datetime(),
  
  // Extended fields
  workflow_name: z.string().optional(),
  current_state: z.string().optional(),
  size_bytes: z.number().optional()
});

// ============================
// BULK OPERATION SCHEMAS
// ============================

// Bulk workflow execution schema
export const bulkCreateWorkflowExecutionSchema = z.object({
  executions: z.array(createWorkflowExecutionSchema).min(1).max(50)
});

// Bulk workflow action schema
export const bulkWorkflowActionSchema = z.object({
  execution_ids: z.array(uuidSchema).min(1).max(50),
  action: z.enum(['pause', 'resume', 'cancel', 'restart']),
  reason: z.string().optional()
});

// Bulk task assignment schema
export const bulkTaskAssignmentSchema = z.object({
  task_ids: z.array(uuidSchema).min(1).max(100),
  assigned_users: z.array(uuidSchema).optional(),
  assigned_roles: z.array(z.string()).optional(),
  priority: workflowTaskPrioritySchema.optional(),
  due_date: dateSchema.optional()
});

// ============================
// SEARCH AND ANALYTICS SCHEMAS
// ============================

// Workflow search schema
export const workflowSearchSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  entity_types: z.array(z.enum(['workflow', 'execution', 'task', 'template', 'trigger'])).optional(),
  fields: z.array(z.string()).optional(),
  status: z.array(z.string()).optional(),
  date_range_field: z.enum(['created_at', 'updated_at', 'started_at', 'completed_at']).optional(),
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
  limit: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(100)).optional().default('25')
});

// Workflow analytics schema
export const workflowAnalyticsQuerySchema = z.object({
  metric_type: z.enum(['execution_stats', 'task_stats', 'performance', 'error_analysis', 'usage_trends']),
  workflow_names: z.array(z.string()).optional(),
  date_from: dateSchema,
  date_to: dateSchema,
  group_by: z.enum(['day', 'week', 'month', 'workflow', 'status', 'user']).optional().default('day'),
  include_system_workflows: booleanTransform.optional().default("false")
});

// Workflow analytics response schema
export const workflowAnalyticsResponseSchema = z.object({
  metric_type: z.string(),
  period: z.object({
    from: z.string().datetime(),
    to: z.string().datetime()
  }),
  data: z.array(z.object({
    label: z.string(),
    value: z.number(),
    metadata: z.record(z.any()).optional()
  })),
  summary: z.object({
    total_executions: z.number().optional(),
    success_rate: z.number().optional(),
    average_duration: z.number().optional(),
    error_count: z.number().optional()
  }).optional()
});

// ============================
// WORKFLOW VERSIONING SCHEMAS
// ============================

// Create workflow version schema
export const createWorkflowVersionSchema = z.object({
  registration_id: uuidSchema,
  version: z.string().min(1, 'Version is required'),
  code: z.string().min(1, 'Code is required'),
  parameters: z.record(z.any()).optional(),
  changelog: z.string().optional(),
  is_current: z.boolean().optional().default(false)
});

// Workflow version response schema
export const workflowVersionResponseSchema = z.object({
  version_id: uuidSchema,
  registration_id: uuidSchema,
  tenant: uuidSchema,
  version: z.string(),
  code: z.string(),
  parameters: z.record(z.any()).nullable(),
  changelog: z.string().nullable(),
  is_current: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  
  // Extended fields
  execution_count: z.number().optional(),
  last_executed: z.string().datetime().optional(),
  created_by_name: z.string().optional()
});

// ============================
// WORKFLOW EXPORT/IMPORT SCHEMAS
// ============================

// Workflow export schema
export const workflowExportQuerySchema = z.object({
  format: z.enum(['json', 'yaml', 'csv']).optional().default('json'),
  entity_types: z.array(z.enum(['registrations', 'templates', 'executions', 'tasks'])).optional(),
  include_system_workflows: booleanTransform.optional().default("false"),
  include_history: booleanTransform.optional().default("false"),
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
  workflow_names: z.array(z.string()).optional()
});

// Workflow import schema
export const workflowImportSchema = z.object({
  format: z.enum(['json', 'yaml']),
  data: z.string().min(1, 'Import data is required'),
  options: z.object({
    overwrite_existing: z.boolean().optional().default(false),
    create_new_versions: z.boolean().optional().default(true),
    validate_only: z.boolean().optional().default(false),
    import_templates: z.boolean().optional().default(true),
    import_workflows: z.boolean().optional().default(true),
    import_triggers: z.boolean().optional().default(false)
  }).optional()
});

// ============================
// TYPE EXPORTS
// ============================

// Export types for TypeScript
export type CreateWorkflowRegistrationData = z.infer<typeof createWorkflowRegistrationSchema>;
export type UpdateWorkflowRegistrationData = z.infer<typeof updateWorkflowRegistrationSchema>;
export type WorkflowRegistrationResponse = z.infer<typeof workflowRegistrationResponseSchema>;
export type WorkflowRegistrationFilterData = z.infer<typeof workflowRegistrationFilterSchema>;

export type CreateWorkflowExecutionData = z.infer<typeof createWorkflowExecutionSchema>;
export type UpdateWorkflowExecutionData = z.infer<typeof updateWorkflowExecutionSchema>;
export type WorkflowExecutionResponse = z.infer<typeof workflowExecutionResponseSchema>;
export type WorkflowExecutionFilterData = z.infer<typeof workflowExecutionFilterSchema>;

export type CreateWorkflowEventData = z.infer<typeof createWorkflowEventSchema>;
export type WorkflowEventResponse = z.infer<typeof workflowEventResponseSchema>;
export type WorkflowEventFilterData = z.infer<typeof workflowEventFilterSchema>;

export type CreateWorkflowTaskData = z.infer<typeof createWorkflowTaskSchema>;
export type UpdateWorkflowTaskData = z.infer<typeof updateWorkflowTaskSchema>;
export type CompleteWorkflowTaskData = z.infer<typeof completeWorkflowTaskSchema>;
export type WorkflowTaskResponse = z.infer<typeof workflowTaskResponseSchema>;
export type WorkflowTaskFilterData = z.infer<typeof workflowTaskFilterSchema>;

export type CreateWorkflowTemplateData = z.infer<typeof createWorkflowTemplateSchema>;
export type UpdateWorkflowTemplateData = z.infer<typeof updateWorkflowTemplateSchema>;
export type WorkflowTemplateResponse = z.infer<typeof workflowTemplateResponseSchema>;
export type WorkflowTemplateFilterData = z.infer<typeof workflowTemplateFilterSchema>;

export type CreateWorkflowTriggerData = z.infer<typeof createWorkflowTriggerSchema>;
export type UpdateWorkflowTriggerData = z.infer<typeof updateWorkflowTriggerSchema>;
export type WorkflowTriggerResponse = z.infer<typeof workflowTriggerResponseSchema>;
export type WorkflowTriggerFilterData = z.infer<typeof workflowTriggerFilterSchema>;

export type WorkflowActionResultResponse = z.infer<typeof workflowActionResultResponseSchema>;

export type CreateWorkflowTimerData = z.infer<typeof createWorkflowTimerSchema>;
export type WorkflowTimerResponse = z.infer<typeof workflowTimerResponseSchema>;

export type CreateWorkflowSnapshotData = z.infer<typeof createWorkflowSnapshotSchema>;
export type WorkflowSnapshotResponse = z.infer<typeof workflowSnapshotResponseSchema>;

export type BulkCreateWorkflowExecutionData = z.infer<typeof bulkCreateWorkflowExecutionSchema>;
export type BulkWorkflowActionData = z.infer<typeof bulkWorkflowActionSchema>;
export type BulkTaskAssignmentData = z.infer<typeof bulkTaskAssignmentSchema>;

export type WorkflowSearchData = z.infer<typeof workflowSearchSchema>;
export type WorkflowAnalyticsQuery = z.infer<typeof workflowAnalyticsQuerySchema>;
export type WorkflowAnalyticsResponse = z.infer<typeof workflowAnalyticsResponseSchema>;

export type CreateWorkflowVersionData = z.infer<typeof createWorkflowVersionSchema>;
export type WorkflowVersionResponse = z.infer<typeof workflowVersionResponseSchema>;

export type WorkflowExportQuery = z.infer<typeof workflowExportQuerySchema>;
export type WorkflowImportData = z.infer<typeof workflowImportSchema>;