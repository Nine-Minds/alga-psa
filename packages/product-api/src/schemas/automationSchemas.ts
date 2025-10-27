/**
 * Automation API Schemas
 * Comprehensive validation schemas for automation rule and workflow API endpoints
 * Based on existing patterns from workflow triggers and schedule schemas
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  booleanTransform,
  dateSchema,
  metadataSchema,
  bulkDeleteSchema,
  bulkUpdateSchema
} from './common';

// ============================================================================
// ENUMS AND BASIC TYPES
// ============================================================================

// Automation rule status
export const automationRuleStatusSchema = z.enum(['active', 'inactive', 'draft', 'error']);

// Trigger types
export const triggerTypeSchema = z.enum([
  'time_based',      // Scheduled/cron-based triggers
  'event_based',     // Event-driven triggers
  'condition_based', // Conditional triggers
  'manual',          // Manual execution
  'recurring',       // Recurring schedule
  'webhook'          // External webhook triggers
]);

// Action types
export const actionTypeSchema = z.enum([
  'email_notification',
  'sms_notification',
  'webhook_call',
  'database_update',
  'ticket_creation',
  'ticket_update',
  'project_update',
  'time_entry_creation',
  'invoice_generation',
  'custom_script',
  'workflow_execution',
  'system_command'
]);

// Schedule frequency
export const scheduleFrequencySchema = z.enum([
  'once',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'custom_cron'
]);

// Condition operators
export const conditionOperatorSchema = z.enum([
  'equals',
  'not_equals',
  'greater_than',
  'less_than',
  'greater_than_or_equal',
  'less_than_or_equal',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'in',
  'not_in',
  'exists',
  'not_exists',
  'regex_match'
]);

// Logic operators
export const logicOperatorSchema = z.enum(['and', 'or', 'not']);

// Execution status
export const executionStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'timeout',
  'skipped'
]);

// Priority levels
export const prioritySchema = z.enum(['low', 'normal', 'high', 'critical']);

// ============================================================================
// TRIGGER DEFINITIONS
// ============================================================================

// Time-based trigger configuration
export const timeBasedTriggerSchema = z.object({
  schedule_type: scheduleFrequencySchema,
  cron_expression: z.string().optional(),
  start_date: dateSchema.optional(),
  end_date: dateSchema.optional(),
  timezone: z.string().optional(),
  max_executions: z.number().min(1).optional(),
  skip_if_running: z.boolean().optional().default(false)
});

// Event-based trigger configuration
export const eventBasedTriggerSchema = z.object({
  event_type: z.string().min(1),
  event_source: z.string().optional(),
  event_filters: z.record(z.any()).optional(),
  debounce_minutes: z.number().min(0).optional(),
  batch_size: z.number().min(1).optional(),
  batch_timeout_minutes: z.number().min(1).optional()
});

// Condition-based trigger configuration
export const conditionBasedTriggerSchema = z.object({
  check_interval_minutes: z.number().min(1),
  conditions: z.array(z.object({
    field: z.string().min(1),
    operator: conditionOperatorSchema,
    value: z.any(),
    data_type: z.enum(['string', 'number', 'boolean', 'date', 'array', 'object']).optional()
  })).min(1),
  logic_operator: logicOperatorSchema.optional().default('and'),
  max_check_attempts: z.number().min(1).optional().default(3)
});

// Webhook trigger configuration
export const webhookTriggerSchema = z.object({
  webhook_url: z.string().url(),
  http_method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().default('POST'),
  headers: z.record(z.string()).optional(),
  authentication: z.object({
    type: z.enum(['none', 'basic', 'bearer', 'api_key']),
    credentials: z.record(z.string()).optional()
  }).optional(),
  timeout_seconds: z.number().min(1).max(300).optional().default(30),
  retry_attempts: z.number().min(0).max(5).optional().default(3)
});

// Generic trigger configuration
export const triggerConfigSchema = z.union([
  timeBasedTriggerSchema,
  eventBasedTriggerSchema,
  conditionBasedTriggerSchema,
  webhookTriggerSchema
]);

// ============================================================================
// ACTION DEFINITIONS
// ============================================================================

// Email action configuration
export const emailActionSchema = z.object({
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  is_html: z.boolean().optional().default(false),
  attachments: z.array(z.object({
    filename: z.string(),
    content_type: z.string().optional(),
    path: z.string().optional(),
    url: z.string().url().optional()
  })).optional()
});

// SMS action configuration
export const smsActionSchema = z.object({
  phone_numbers: z.array(z.string()).min(1),
  message: z.string().min(1).max(1600),
  sender_id: z.string().optional()
});

// Webhook action configuration
export const webhookActionSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().default('POST'),
  headers: z.record(z.string()).optional(),
  body: z.any().optional(),
  authentication: z.object({
    type: z.enum(['none', 'basic', 'bearer', 'api_key']),
    credentials: z.record(z.string()).optional()
  }).optional(),
  timeout_seconds: z.number().min(1).max(300).optional().default(30),
  retry_attempts: z.number().min(0).max(5).optional().default(3)
});

// Database update action configuration
export const databaseUpdateActionSchema = z.object({
  table: z.string().min(1),
  operation: z.enum(['insert', 'update', 'delete']),
  data: z.record(z.any()),
  conditions: z.record(z.any()).optional(),
  return_updated: z.boolean().optional().default(false)
});

// Ticket action configuration
export const ticketActionSchema = z.object({
  operation: z.enum(['create', 'update', 'close', 'assign']),
  ticket_data: z.record(z.any()),
  ticket_id: uuidSchema.optional(),
  assigned_to: uuidSchema.optional(),
  status: z.string().optional(),
  priority: prioritySchema.optional(),
  notes: z.string().optional()
});

// Custom script action configuration
export const customScriptActionSchema = z.object({
  script_type: z.enum(['javascript', 'python', 'bash', 'powershell']),
  script_content: z.string().min(1),
  timeout_seconds: z.number().min(1).max(3600).optional().default(300),
  environment_variables: z.record(z.string()).optional(),
  working_directory: z.string().optional()
});

// Generic action configuration
export const actionConfigSchema = z.union([
  emailActionSchema,
  smsActionSchema,
  webhookActionSchema,
  databaseUpdateActionSchema,
  ticketActionSchema,
  customScriptActionSchema
]);

// ============================================================================
// AUTOMATION RULE SCHEMAS
// ============================================================================

// Create automation rule schema
export const createAutomationRuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required').max(255),
  description: z.string().optional(),
  status: automationRuleStatusSchema.optional().default('draft'),
  priority: prioritySchema.optional().default('normal'),
  
  // Trigger configuration
  trigger_type: triggerTypeSchema,
  trigger_config: triggerConfigSchema,
  
  // Conditions (optional additional conditions beyond trigger)
  conditions: z.array(z.object({
    field: z.string().min(1),
    operator: conditionOperatorSchema,
    value: z.any(),
    data_type: z.enum(['string', 'number', 'boolean', 'date', 'array', 'object']).optional()
  })).optional(),
  condition_logic: logicOperatorSchema.optional().default('and'),
  
  // Actions to execute
  actions: z.array(z.object({
    type: actionTypeSchema,
    config: actionConfigSchema,
    order: z.number().min(1),
    continue_on_error: z.boolean().optional().default(false),
    timeout_seconds: z.number().min(1).optional(),
    retry_attempts: z.number().min(0).max(5).optional().default(0)
  })).min(1),
  
  // Execution settings
  max_concurrent_executions: z.number().min(1).optional().default(1),
  execution_timeout_minutes: z.number().min(1).optional().default(60),
  retry_failed_executions: z.boolean().optional().default(false),
  
  // Scheduling and lifecycle
  is_template: z.boolean().optional().default(false),
  template_category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: metadataSchema.optional(),
  
  // Notifications
  notification_settings: z.object({
    notify_on_success: z.boolean().optional().default(false),
    notify_on_failure: z.boolean().optional().default(true),
    notification_emails: z.array(z.string().email()).optional(),
    notification_webhooks: z.array(z.string().url()).optional()
  }).optional()
});

// Update automation rule schema (all fields optional)
export const updateAutomationRuleSchema = createUpdateSchema(createAutomationRuleSchema);

// ============================================================================
// AUTOMATION EXECUTION SCHEMAS
// ============================================================================

// Automation execution record
export const automationExecutionSchema = z.object({
  execution_id: uuidSchema,
  automation_rule_id: uuidSchema,
  trigger_data: z.record(z.any()).optional(),
  status: executionStatusSchema,
  started_at: dateSchema,
  completed_at: dateSchema.optional(),
  duration_ms: z.number().min(0).optional(),
  
  // Execution results
  actions_total: z.number().min(0),
  actions_successful: z.number().min(0),
  actions_failed: z.number().min(0),
  
  // Error information
  error_message: z.string().optional(),
  error_stack: z.string().optional(),
  failed_action_index: z.number().optional(),
  
  // Execution context
  execution_context: z.record(z.any()).optional(),
  logs: z.array(z.object({
    timestamp: dateSchema,
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string(),
    action_index: z.number().optional(),
    metadata: z.record(z.any()).optional()
  })).optional(),
  
  tenant: uuidSchema
});

// Manual execution request
export const manualExecutionSchema = z.object({
  automation_rule_id: uuidSchema,
  execution_data: z.record(z.any()).optional(),
  override_conditions: z.boolean().optional().default(false),
  dry_run: z.boolean().optional().default(false)
});

// ============================================================================
// AUTOMATION TEMPLATE SCHEMAS
// ============================================================================

// Automation template schema
export const automationTemplateSchema = z.object({
  template_id: uuidSchema,
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  category: z.string().min(1),
  icon: z.string().optional(),
  
  // Template configuration
  template_config: createAutomationRuleSchema.omit({ 
    is_template: true,
    template_category: true 
  }),
  
  // Template metadata
  version: z.string().optional().default('1.0.0'),
  author: z.string().optional(),
  compatible_versions: z.array(z.string()).optional(),
  required_permissions: z.array(z.string()).optional(),
  
  // Usage stats
  usage_count: z.number().min(0).optional().default(0),
  last_used: dateSchema.optional(),
  
  // Variables that can be customized
  template_variables: z.array(z.object({
    name: z.string().min(1),
    display_name: z.string().min(1),
    description: z.string().optional(),
    type: z.enum(['string', 'number', 'boolean', 'date', 'select', 'multiselect']),
    required: z.boolean().optional().default(false),
    default_value: z.any().optional(),
    options: z.array(z.object({
      label: z.string(),
      value: z.any()
    })).optional(),
    validation: z.object({
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
      custom_validator: z.string().optional()
    }).optional()
  })).optional(),
  
  is_active: z.boolean().optional().default(true),
  is_featured: z.boolean().optional().default(false),
  tenant: uuidSchema
});

// Create template from rule
export const createTemplateFromRuleSchema = z.object({
  automation_rule_id: uuidSchema,
  template_name: z.string().min(1).max(255),
  template_description: z.string().optional(),
  category: z.string().min(1),
  template_variables: z.array(z.object({
    rule_field_path: z.string().min(1),
    variable_name: z.string().min(1),
    display_name: z.string().min(1),
    description: z.string().optional(),
    type: z.enum(['string', 'number', 'boolean', 'date', 'select', 'multiselect']),
    required: z.boolean().optional().default(false)
  })).optional()
});

// ============================================================================
// FILTER AND SEARCH SCHEMAS
// ============================================================================

// Automation rule filter schema
export const automationRuleFilterSchema = baseFilterSchema.extend({
  name: z.string().optional(),
  status: automationRuleStatusSchema.optional(),
  trigger_type: triggerTypeSchema.optional(),
  priority: prioritySchema.optional(),
  is_template: booleanTransform.optional(),
  template_category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  created_by: uuidSchema.optional(),
  last_executed_from: dateSchema.optional(),
  last_executed_to: dateSchema.optional(),
  execution_count_min: z.number().min(0).optional(),
  execution_count_max: z.number().min(0).optional()
});

// Automation execution filter schema
export const automationExecutionFilterSchema = baseFilterSchema.extend({
  automation_rule_id: uuidSchema.optional(),
  status: executionStatusSchema.optional(),
  started_from: dateSchema.optional(),
  started_to: dateSchema.optional(),
  duration_min_ms: z.number().min(0).optional(),
  duration_max_ms: z.number().min(0).optional(),
  has_errors: booleanTransform.optional(),
  trigger_type: triggerTypeSchema.optional()
});

// Template filter schema
export const templateFilterSchema = baseFilterSchema.extend({
  category: z.string().optional(),
  is_featured: booleanTransform.optional(),
  compatible_version: z.string().optional(),
  author: z.string().optional(),
  usage_count_min: z.number().min(0).optional(),
  usage_count_max: z.number().min(0).optional()
});

// ============================================================================
// BULK OPERATIONS
// ============================================================================

// Bulk enable/disable automation rules
export const bulkStatusUpdateSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(100),
  status: automationRuleStatusSchema
});

// Bulk execution request
export const bulkExecutionSchema = z.object({
  automation_rule_ids: z.array(uuidSchema).min(1).max(20),
  execution_data: z.record(z.any()).optional(),
  override_conditions: z.boolean().optional().default(false),
  sequential_execution: z.boolean().optional().default(false)
});

// ============================================================================
// LIST QUERY SCHEMAS
// ============================================================================

// Automation rules list query
export const automationRulesListSchema = createListQuerySchema(automationRuleFilterSchema);

// Automation executions list query
export const automationExecutionsListSchema = createListQuerySchema(automationExecutionFilterSchema);

// Templates list query
export const templatesListSchema = createListQuerySchema(templateFilterSchema);

// ============================================================================
// STATISTICS AND ANALYTICS SCHEMAS
// ============================================================================

// Automation statistics
export const automationStatsSchema = z.object({
  total_rules: z.number().min(0),
  active_rules: z.number().min(0),
  inactive_rules: z.number().min(0),
  draft_rules: z.number().min(0),
  error_rules: z.number().min(0),
  
  total_executions: z.number().min(0),
  successful_executions: z.number().min(0),
  failed_executions: z.number().min(0),
  
  executions_today: z.number().min(0),
  executions_this_week: z.number().min(0),
  executions_this_month: z.number().min(0),
  
  avg_execution_time_ms: z.number().min(0).optional(),
  success_rate_percent: z.number().min(0).max(100).optional(),
  
  most_used_trigger_types: z.array(z.object({
    trigger_type: triggerTypeSchema,
    count: z.number().min(0)
  })).optional(),
  
  most_used_action_types: z.array(z.object({
    action_type: actionTypeSchema,
    count: z.number().min(0)
  })).optional()
});

// Performance metrics request
export const performanceMetricsRequestSchema = z.object({
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
  rule_ids: z.array(uuidSchema).optional(),
  group_by: z.enum(['hour', 'day', 'week', 'month']).optional().default('day'),
  metrics: z.array(z.enum([
    'execution_count',
    'success_rate',
    'avg_duration',
    'error_rate',
    'throughput'
  ])).optional()
});

// ============================================================================
// EXPORT SCHEMAS
// ============================================================================

export type AutomationRuleStatus = z.infer<typeof automationRuleStatusSchema>;
export type TriggerType = z.infer<typeof triggerTypeSchema>;
export type ActionType = z.infer<typeof actionTypeSchema>;
export type ScheduleFrequency = z.infer<typeof scheduleFrequencySchema>;
export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;
export type LogicOperator = z.infer<typeof logicOperatorSchema>;
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;
export type Priority = z.infer<typeof prioritySchema>;

export type CreateAutomationRule = z.infer<typeof createAutomationRuleSchema>;
export type UpdateAutomationRule = z.infer<typeof updateAutomationRuleSchema>;
export type AutomationExecution = z.infer<typeof automationExecutionSchema>;
export type ManualExecution = z.infer<typeof manualExecutionSchema>;
export type AutomationTemplate = z.infer<typeof automationTemplateSchema>;
export type CreateTemplateFromRule = z.infer<typeof createTemplateFromRuleSchema>;
export type AutomationStats = z.infer<typeof automationStatsSchema>;
export type PerformanceMetricsRequest = z.infer<typeof performanceMetricsRequestSchema>;

export type AutomationRuleFilter = z.infer<typeof automationRuleFilterSchema>;
export type AutomationExecutionFilter = z.infer<typeof automationExecutionFilterSchema>;
export type TemplateFilter = z.infer<typeof templateFilterSchema>;

export type BulkStatusUpdate = z.infer<typeof bulkStatusUpdateSchema>;
export type BulkExecution = z.infer<typeof bulkExecutionSchema>;