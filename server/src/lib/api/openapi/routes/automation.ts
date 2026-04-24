import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerAutomationRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Automation';

  const ExecutionStatus = zOpenApi.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'timeout', 'skipped']);
  const TriggerType = zOpenApi.enum(['time_based', 'event_based', 'condition_based', 'manual', 'recurring', 'webhook']);
  const AutomationRuleStatus = zOpenApi.enum(['active', 'inactive', 'draft', 'error']);
  const PriorityLevel = zOpenApi.enum(['low', 'normal', 'high', 'critical']);
  const ActionType = zOpenApi.enum([
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
    'system_command',
  ]);

  const AutomationExecutionParams = registry.registerSchema(
    'AutomationExecutionParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Automation execution UUID from automation_executions.execution_id.'),
    }),
  );

  const AutomationRuleParams = registry.registerSchema(
    'AutomationRuleParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Automation rule UUID from automation_rules.rule_id.'),
    }),
  );

  const AutomationTemplateParams = registry.registerSchema(
    'AutomationTemplateParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Automation template UUID from automation_templates.template_id.'),
    }),
  );

  const AutomationExecutionsListQuery = registry.registerSchema(
    'AutomationExecutionsListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional().describe('Page number as a query string. Defaults to 1.'),
      limit: zOpenApi.string().optional().describe('Page size as a query string. Must parse to 1 through 100; defaults to 25.'),
      sort: zOpenApi.string().optional().describe('Accepted by shared list query validation; the service currently orders executions by started_at desc.'),
      order: zOpenApi.enum(['asc', 'desc']).optional().describe('Accepted by shared list query validation.'),
      search: zOpenApi.string().optional().describe('Accepted by shared filter validation.'),
      created_from: zOpenApi.string().datetime().optional().describe('Accepted by shared filter validation.'),
      created_to: zOpenApi.string().datetime().optional().describe('Accepted by shared filter validation.'),
      updated_from: zOpenApi.string().datetime().optional().describe('Accepted by shared filter validation.'),
      updated_to: zOpenApi.string().datetime().optional().describe('Accepted by shared filter validation.'),
      is_active: zOpenApi.enum(['true', 'false']).optional().describe('Accepted by shared filter validation and transformed to boolean.'),
      automation_rule_id: zOpenApi.string().uuid().optional().describe('Filter executions by parent automation rule UUID.'),
      status: ExecutionStatus.optional().describe('Filter by execution status.'),
      started_from: zOpenApi.string().datetime().optional().describe('Filter executions started at or after this timestamp.'),
      started_to: zOpenApi.string().datetime().optional().describe('Filter executions started at or before this timestamp.'),
      duration_min_ms: zOpenApi.number().min(0).optional().describe('Minimum execution duration in milliseconds.'),
      duration_max_ms: zOpenApi.number().min(0).optional().describe('Maximum execution duration in milliseconds.'),
      has_errors: zOpenApi.enum(['true', 'false']).optional().describe('Filter by whether the execution has errors; transformed to boolean by validation.'),
      trigger_type: TriggerType.optional().describe('Filter by automation trigger type.'),
    }),
  );

  const AutomationRulesListQuery = registry.registerSchema(
    'AutomationRulesListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional().describe('Page number as a query string. Defaults to 1.'),
      limit: zOpenApi.string().optional().describe('Page size as a query string. Must parse to 1 through 100; defaults to 25.'),
      sort: zOpenApi.string().optional().describe('Accepted by shared list query validation; service currently orders rules by created_at desc.'),
      order: zOpenApi.enum(['asc', 'desc']).optional().describe('Accepted by shared list query validation.'),
      search: zOpenApi.string().optional().describe('Accepted by shared filter validation.'),
      created_from: zOpenApi.string().datetime().optional().describe('Accepted by shared filter validation.'),
      created_to: zOpenApi.string().datetime().optional().describe('Accepted by shared filter validation.'),
      updated_from: zOpenApi.string().datetime().optional().describe('Accepted by shared filter validation.'),
      updated_to: zOpenApi.string().datetime().optional().describe('Accepted by shared filter validation.'),
      is_active: zOpenApi.enum(['true', 'false']).optional().describe('Accepted by shared filter validation and transformed to boolean.'),
      name: zOpenApi.string().optional().describe('Optional rule name filter.'),
      status: AutomationRuleStatus.optional().describe('Filter by automation rule status.'),
      trigger_type: TriggerType.optional().describe('Filter by trigger type.'),
      priority: PriorityLevel.optional().describe('Filter by priority level.'),
      template_category: zOpenApi.string().optional().describe('Filter template category.'),
      created_by: zOpenApi.string().uuid().optional().describe('Filter by creator user UUID from automation_rules.created_by.'),
      last_executed_from: zOpenApi.string().datetime().optional().describe('Filter for rules last executed at or after timestamp.'),
      last_executed_to: zOpenApi.string().datetime().optional().describe('Filter for rules last executed at or before timestamp.'),
      execution_count_min: zOpenApi.number().int().min(0).optional().describe('Minimum execution count filter.'),
      execution_count_max: zOpenApi.number().int().min(0).optional().describe('Maximum execution count filter.'),
    }),
  );

  const AutomationTemplatesListQuery = registry.registerSchema(
    'AutomationTemplatesListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional().describe('Page number as a query string. Defaults to 1.'),
      limit: zOpenApi.string().optional().describe('Page size as a query string. Must parse to 1 through 100; defaults to 25.'),
      sort: zOpenApi.string().optional().describe('Accepted by shared list query validation; service currently orders templates by created_at desc.'),
      order: zOpenApi.enum(['asc', 'desc']).optional().describe('Accepted by shared list query validation.'),
      search: zOpenApi.string().optional().describe('Accepted by shared filter validation.'),
      created_from: zOpenApi.string().datetime().optional().describe('Accepted by shared filter validation.'),
      created_to: zOpenApi.string().datetime().optional().describe('Accepted by shared filter validation.'),
      updated_from: zOpenApi.string().datetime().optional().describe('Accepted by shared filter validation.'),
      updated_to: zOpenApi.string().datetime().optional().describe('Accepted by shared filter validation.'),
      is_active: zOpenApi.enum(['true', 'false']).optional().describe('Accepted by shared filter validation and transformed to boolean.'),
      category: zOpenApi.string().optional().describe('Filter templates by category.'),
      compatible_version: zOpenApi.string().optional().describe('Filter templates by compatibility version tag.'),
      author: zOpenApi.string().optional().describe('Filter templates by author/user id value saved on the template.'),
      usage_count_min: zOpenApi.number().int().min(0).optional().describe('Minimum usage_count filter.'),
      usage_count_max: zOpenApi.number().int().min(0).optional().describe('Maximum usage_count filter.'),
    }),
  );

  const AutomationPerformanceQuery = registry.registerSchema(
    'AutomationPerformanceQuery',
    zOpenApi.object({
      date_from: zOpenApi.string().datetime().optional().describe('Optional lower bound for performance window.'),
      date_to: zOpenApi.string().datetime().optional().describe('Optional upper bound for performance window.'),
      group_by: zOpenApi.enum(['hour', 'day', 'week', 'month']).optional().describe('Aggregation bucket size; defaults to day.'),
      rule_ids: zOpenApi.string().optional().describe(
        'Raw query value copied from URL. The controller expects an array UUID schema but validateQueryParams passes string values, so array filters currently require custom caller-side encoding or fail validation.',
      ),
      metrics: zOpenApi.string().optional().describe(
        'Raw query value copied from URL. The controller expects an array enum schema but validateQueryParams passes string values, so array filters currently require custom caller-side encoding or fail validation.',
      ),
    }),
  );

  const AutomationLogEntry = registry.registerSchema(
    'AutomationExecutionLogEntry',
    zOpenApi.object({
      timestamp: zOpenApi.string().datetime().optional().describe('Log timestamp.'),
      level: zOpenApi.enum(['debug', 'info', 'warn', 'error']).describe('Log level.'),
      message: zOpenApi.string().describe('Log message.'),
      action_index: zOpenApi.number().int().optional().describe('Optional action index that produced the log.'),
      metadata: zOpenApi.record(zOpenApi.unknown()).optional().describe('Optional structured log metadata.'),
    }),
  );

  const AutomationLinks = registry.registerSchema(
    'AutomationLinks',
    zOpenApi.record(zOpenApi.unknown()).describe('HATEOAS links generated by the automation controller. Some generic links may point to methods not implemented by a route file.'),
  );

  const AutomationExecution = registry.registerSchema(
    'AutomationExecution',
    zOpenApi.object({
      execution_id: zOpenApi.string().uuid().describe('Execution UUID generated with crypto.randomUUID when the execution is created.'),
      automation_rule_id: zOpenApi.string().uuid().describe('Parent automation rule UUID.'),
      trigger_data: zOpenApi.record(zOpenApi.unknown()).optional().describe('Trigger payload captured when execution started.'),
      status: ExecutionStatus.describe('Current execution status.'),
      started_at: zOpenApi.string().datetime().optional().describe('Timestamp when execution started.'),
      completed_at: zOpenApi.string().datetime().nullable().optional().describe('Timestamp when execution completed.'),
      duration_ms: zOpenApi.number().min(0).nullable().optional().describe('Execution duration in milliseconds.'),
      actions_total: zOpenApi.number().int().min(0).describe('Number of actions planned for this execution.'),
      actions_successful: zOpenApi.number().int().min(0).describe('Number of actions completed successfully.'),
      actions_failed: zOpenApi.number().int().min(0).describe('Number of actions that failed.'),
      error_message: zOpenApi.string().nullable().optional().describe('Top-level error message, when failed.'),
      error_stack: zOpenApi.string().nullable().optional().describe('Error stack, when captured.'),
      failed_action_index: zOpenApi.number().int().nullable().optional().describe('Index of failed action, when applicable.'),
      execution_context: zOpenApi.record(zOpenApi.unknown()).optional().describe('Execution context data.'),
      logs: zOpenApi.array(AutomationLogEntry).optional().describe('Execution log entries.'),
      tenant: zOpenApi.string().uuid().describe('Tenant UUID scoped from the API key context.'),
      _links: AutomationLinks.optional(),
    }),
  );

  const AutomationPagination = registry.registerSchema(
    'AutomationPagination',
    zOpenApi.object({
      page: zOpenApi.number().int().describe('Current page number.'),
      limit: zOpenApi.number().int().describe('Page size.'),
      total: zOpenApi.number().int().describe('Total matching executions.'),
      totalPages: zOpenApi.number().int().describe('Total page count.'),
      hasNext: zOpenApi.boolean().describe('Whether another page exists.'),
      hasPrev: zOpenApi.boolean().describe('Whether a previous page exists.'),
    }),
  );

  const AutomationExecutionListResponse = registry.registerSchema(
    'AutomationExecutionListResponse',
    zOpenApi.object({
      data: zOpenApi.array(AutomationExecution).describe('Automation execution rows. Current service code wraps the DB result array in another array; this schema documents the intended flat shape returned by createPaginatedResponse.'),
      pagination: AutomationPagination,
      meta: zOpenApi.object({
        filters: zOpenApi.record(zOpenApi.unknown()).optional().describe('Validated filters echoed by the controller.'),
        resource: zOpenApi.literal('automation_execution').optional().describe('Resource name supplied by the controller.'),
      }).optional(),
    }),
  );

  const AutomationExecutionResponse = registry.registerSchema(
    'AutomationExecutionResponse',
    zOpenApi.object({
      data: AutomationExecution,
    }),
  );

  const AutomationErrorResponse = registry.registerSchema(
    'AutomationErrorResponse',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string().describe('Machine-readable error code, such as UNAUTHORIZED, FORBIDDEN, VALIDATION_ERROR, or INTERNAL_ERROR.'),
        message: zOpenApi.string().describe('Human-readable error message.'),
        details: zOpenApi.unknown().optional().describe('Optional structured error details.'),
      }),
    }),
  );

  const AutomationMetaResponse = registry.registerSchema(
    'AutomationMetaResponse',
    zOpenApi.object({
      data: zOpenApi.object({
        trigger_types: zOpenApi.array(TriggerType).describe('Valid automation trigger types.'),
        action_types: zOpenApi.array(ActionType).describe('Valid automation action types.'),
        rule_statuses: zOpenApi.array(zOpenApi.enum(['active', 'inactive', 'draft', 'error'])).describe('Valid automation rule statuses.'),
        execution_statuses: zOpenApi.array(ExecutionStatus).describe('Valid automation execution statuses.'),
        priority_levels: zOpenApi.array(zOpenApi.enum(['low', 'normal', 'high', 'critical'])).describe('Valid automation priority levels.'),
        condition_operators: zOpenApi.array(zOpenApi.enum([
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
          'regex_match',
        ])).describe('Valid condition operators.'),
      }),
    }),
  );

  const AutomationRuleCondition = registry.registerSchema(
    'AutomationRuleCondition',
    zOpenApi.object({
      field: zOpenApi.string().describe('Field path evaluated for this condition.'),
      operator: zOpenApi.enum([
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
        'regex_match',
      ]),
      value: zOpenApi.unknown().describe('Condition comparison value.'),
      data_type: zOpenApi.enum(['string', 'number', 'boolean', 'date', 'array', 'object']).optional(),
    }),
  );

  const AutomationRuleAction = registry.registerSchema(
    'AutomationRuleAction',
    zOpenApi.object({
      type: ActionType.describe('Automation action type.'),
      config: zOpenApi.record(zOpenApi.unknown()).describe('Action configuration object. Expected keys depend on action type.'),
      order: zOpenApi.number().int().min(1).describe('Execution order (1-based).'),
      continue_on_error: zOpenApi.boolean().optional().describe('Continue execution after a failed action.'),
      timeout_seconds: zOpenApi.number().int().min(1).optional().describe('Optional per-action timeout in seconds.'),
      retry_attempts: zOpenApi.number().int().min(0).max(5).optional().describe('Optional retry count for this action.'),
    }),
  );

  const AutomationNotificationSettings = registry.registerSchema(
    'AutomationNotificationSettings',
    zOpenApi.object({
      notify_on_success: zOpenApi.boolean().optional(),
      notify_on_failure: zOpenApi.boolean().optional(),
      notification_emails: zOpenApi.array(zOpenApi.string().email()).optional(),
      notification_webhooks: zOpenApi.array(zOpenApi.string().url()).optional(),
    }),
  );

  const AutomationRule = registry.registerSchema(
    'AutomationRule',
    zOpenApi.object({
      rule_id: zOpenApi.string().uuid().describe('Rule UUID generated with crypto.randomUUID when a rule is created.'),
      tenant: zOpenApi.string().uuid().describe('Tenant UUID scoped from API key authentication.'),
      name: zOpenApi.string().describe('Rule display name.'),
      description: zOpenApi.string().optional().nullable(),
      status: AutomationRuleStatus.describe('Current automation rule status.'),
      priority: PriorityLevel.describe('Current automation rule priority.'),
      trigger_type: TriggerType.describe('Trigger type used to start rule execution.'),
      trigger_config: zOpenApi.record(zOpenApi.unknown()).describe('Trigger configuration object stored with the rule.'),
      conditions: zOpenApi.array(AutomationRuleCondition).optional().describe('Optional additional rule conditions.'),
      condition_logic: zOpenApi.enum(['and', 'or']).optional().describe('Condition combination logic.'),
      actions: zOpenApi.array(AutomationRuleAction).describe('Ordered action list for this rule.'),
      max_concurrent_executions: zOpenApi.number().int().min(1).optional(),
      execution_timeout_minutes: zOpenApi.number().int().min(1).optional(),
      retry_failed_executions: zOpenApi.boolean().optional(),
      is_template: zOpenApi.boolean().optional(),
      template_category: zOpenApi.string().optional().nullable(),
      tags: zOpenApi.array(zOpenApi.string()).optional(),
      metadata: zOpenApi.record(zOpenApi.unknown()).optional(),
      notification_settings: AutomationNotificationSettings.optional(),
      created_by: zOpenApi.string().uuid().nullable().optional().describe('User UUID from API key context that created the rule.'),
      created_at: zOpenApi.string().datetime().optional(),
      updated_at: zOpenApi.string().datetime().optional(),
      execution_count: zOpenApi.number().int().min(0).optional(),
      last_executed: zOpenApi.string().datetime().nullable().optional(),
      execution_statistics: zOpenApi.record(zOpenApi.unknown()).optional().describe('Included on GET /rules/{id} by service lookup helper.'),
      _links: AutomationLinks.optional(),
    }),
  );

  const CreateAutomationRuleRequest = registry.registerSchema(
    'CreateAutomationRuleRequest',
    zOpenApi.object({
      name: zOpenApi.string().min(1).max(255),
      description: zOpenApi.string().optional(),
      status: AutomationRuleStatus.optional().describe('Defaults to draft when omitted.'),
      priority: PriorityLevel.optional().describe('Defaults to normal when omitted.'),
      trigger_type: TriggerType,
      trigger_config: zOpenApi.record(zOpenApi.unknown()).describe('Trigger-type-specific configuration object.'),
      conditions: zOpenApi.array(AutomationRuleCondition).optional(),
      condition_logic: zOpenApi.enum(['and', 'or']).optional(),
      actions: zOpenApi.array(AutomationRuleAction).min(1),
      max_concurrent_executions: zOpenApi.number().int().min(1).optional(),
      execution_timeout_minutes: zOpenApi.number().int().min(1).optional(),
      retry_failed_executions: zOpenApi.boolean().optional(),
      is_template: zOpenApi.boolean().optional(),
      template_category: zOpenApi.string().optional(),
      tags: zOpenApi.array(zOpenApi.string()).optional(),
      metadata: zOpenApi.record(zOpenApi.unknown()).optional(),
      notification_settings: AutomationNotificationSettings.optional(),
    }),
  );

  const UpdateAutomationRuleRequest = registry.registerSchema('UpdateAutomationRuleRequest', CreateAutomationRuleRequest.partial());

  const ManualExecutionRequest = registry.registerSchema(
    'ManualExecutionRequest',
    zOpenApi.object({
      automation_rule_id: zOpenApi
        .string()
        .uuid()
        .describe('Required by current validation schema but ignored by controller/service, which execute the path rule ID.'),
      execution_data: zOpenApi.record(zOpenApi.unknown()).optional(),
      override_conditions: zOpenApi.boolean().optional().describe('Set true to allow execution of inactive rules.'),
      dry_run: zOpenApi.boolean().optional().describe('When true, returns a completed execution without queueing actions.'),
    }),
  );

  const BulkStatusUpdateRequest = registry.registerSchema(
    'BulkStatusUpdateRequest',
    zOpenApi.object({
      ids: zOpenApi.array(zOpenApi.string().uuid()).min(1).max(100).describe('Rule UUIDs from automation_rules.rule_id.'),
      status: AutomationRuleStatus.describe('Status to apply to each provided rule id.'),
    }),
  );

  const BulkExecuteRequest = registry.registerSchema(
    'BulkExecuteRequest',
    zOpenApi.object({
      automation_rule_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1).max(20).describe('Rule UUIDs to execute.'),
      execution_data: zOpenApi.record(zOpenApi.unknown()).optional().describe('Optional shared execution payload for each run.'),
      override_conditions: zOpenApi.boolean().optional().describe('Allow execution of inactive rules when true.'),
      sequential_execution: zOpenApi.boolean().optional().describe('When true, executes rules sequentially; otherwise Promise.all is used.'),
    }),
  );

  const AutomationTemplateVariable = registry.registerSchema(
    'AutomationTemplateVariable',
    zOpenApi.object({
      name: zOpenApi.string(),
      display_name: zOpenApi.string().optional(),
      description: zOpenApi.string().optional(),
      type: zOpenApi.enum(['string', 'number', 'boolean', 'date', 'select', 'multiselect']),
      required: zOpenApi.boolean().optional(),
      default_value: zOpenApi.unknown().optional(),
      options: zOpenApi.array(zOpenApi.object({ label: zOpenApi.string(), value: zOpenApi.unknown() })).optional(),
      validation: zOpenApi
        .object({
          min: zOpenApi.number().optional(),
          max: zOpenApi.number().optional(),
          pattern: zOpenApi.string().optional(),
          custom_validator: zOpenApi.string().optional(),
        })
        .optional(),
    }),
  );

  const AutomationTemplate = registry.registerSchema(
    'AutomationTemplate',
    zOpenApi.object({
      template_id: zOpenApi.string().uuid().describe('Template UUID generated with crypto.randomUUID.'),
      name: zOpenApi.string(),
      description: zOpenApi.string().optional().nullable(),
      category: zOpenApi.string(),
      icon: zOpenApi.string().optional().nullable(),
      template_config: zOpenApi.record(zOpenApi.unknown()).describe('Template rule blueprint derived from an automation rule.'),
      version: zOpenApi.string().optional(),
      author: zOpenApi.string().optional().nullable(),
      compatible_versions: zOpenApi.array(zOpenApi.string()).optional(),
      required_permissions: zOpenApi.array(zOpenApi.string()).optional(),
      usage_count: zOpenApi.number().int().min(0).optional(),
      last_used: zOpenApi.string().datetime().nullable().optional(),
      template_variables: zOpenApi.array(AutomationTemplateVariable).optional(),
      is_active: zOpenApi.boolean().optional(),
      is_featured: zOpenApi.boolean().optional(),
      tenant: zOpenApi.string().uuid(),
      _links: AutomationLinks.optional(),
    }),
  );

  const CreateAutomationTemplateRequest = registry.registerSchema(
    'CreateAutomationTemplateRequest',
    zOpenApi.object({
      automation_rule_id: zOpenApi.string().uuid().describe('Source automation_rules.rule_id copied into template_config.'),
      template_name: zOpenApi.string().min(1).max(255),
      template_description: zOpenApi.string().optional(),
      category: zOpenApi.string().min(1),
      template_variables: zOpenApi
        .array(
          zOpenApi.object({
            rule_field_path: zOpenApi.string().min(1),
            variable_name: zOpenApi.string().min(1),
            display_name: zOpenApi.string().min(1),
            description: zOpenApi.string().optional(),
            type: zOpenApi.enum(['string', 'number', 'boolean', 'date', 'select', 'multiselect']),
            required: zOpenApi.boolean().optional(),
          }),
        )
        .optional(),
    }),
  );

  const UseAutomationTemplateRequest = registry.registerSchema(
    'UseAutomationTemplateRequest',
    zOpenApi.object({
      variables: zOpenApi
        .record(zOpenApi.unknown())
        .optional()
        .describe('Optional variable substitutions applied to template_config before creating a new automation rule.'),
    }),
  );

  const AutomationRuleResponse = registry.registerSchema('AutomationRuleResponse', zOpenApi.object({ data: AutomationRule }));
  const AutomationRuleListResponse = registry.registerSchema(
    'AutomationRuleListResponse',
    zOpenApi.object({
      data: zOpenApi.array(AutomationRule),
      pagination: AutomationPagination,
      meta: zOpenApi
        .object({
          filters: zOpenApi.record(zOpenApi.unknown()).optional(),
          resource: zOpenApi.literal('automation_rule').optional(),
        })
        .optional(),
    }),
  );
  const AutomationTemplateResponse = registry.registerSchema('AutomationTemplateResponse', zOpenApi.object({ data: AutomationTemplate }));
  const AutomationTemplateListResponse = registry.registerSchema(
    'AutomationTemplateListResponse',
    zOpenApi.object({
      data: zOpenApi.array(AutomationTemplate).describe(
        'Template rows. Current service code wraps the DB result array in another array before createPaginatedResponse, which can produce nested data in practice.',
      ),
      pagination: AutomationPagination,
      meta: zOpenApi
        .object({
          filters: zOpenApi.record(zOpenApi.unknown()).optional(),
          resource: zOpenApi.literal('automation_template').optional(),
        })
        .optional(),
    }),
  );

  const AutomationStatisticsResponse = registry.registerSchema(
    'AutomationStatisticsResponse',
    zOpenApi.object({
      data: zOpenApi.object({
        total_rules: zOpenApi.number().int().min(0),
        active_rules: zOpenApi.number().int().min(0),
        inactive_rules: zOpenApi.number().int().min(0),
        draft_rules: zOpenApi.number().int().min(0),
        error_rules: zOpenApi.number().int().min(0),
        total_executions: zOpenApi.number().int().min(0),
        successful_executions: zOpenApi.number().int().min(0),
        failed_executions: zOpenApi.number().int().min(0),
        executions_today: zOpenApi.number().int().min(0),
        executions_this_week: zOpenApi.number().int().min(0),
        executions_this_month: zOpenApi.number().int().min(0),
        avg_execution_time_ms: zOpenApi.number().min(0).optional(),
        success_rate_percent: zOpenApi.number().min(0).max(100).optional(),
        _links: zOpenApi
          .object({
            self: zOpenApi.literal('/api/v1/automation/statistics'),
            rules: zOpenApi.literal('/api/v1/automation/rules'),
            executions: zOpenApi.literal('/api/v1/automation/executions'),
            templates: zOpenApi.literal('/api/v1/automation/templates'),
            performance: zOpenApi.literal('/api/v1/automation/performance'),
          })
          .optional(),
      }),
    }),
  );

  const AutomationPerformanceResponse = registry.registerSchema(
    'AutomationPerformanceResponse',
    zOpenApi.object({
      data: zOpenApi
        .record(zOpenApi.unknown())
        .and(
          zOpenApi.object({
            _links: zOpenApi
              .object({
                self: zOpenApi.literal('/api/v1/automation/performance'),
                statistics: zOpenApi.literal('/api/v1/automation/statistics'),
              })
              .optional(),
          }),
        )
        .describe('Performance payload from AutomationService.calculatePerformanceMetrics plus links.'),
    }),
  );

  const BulkStatusUpdateResponse = registry.registerSchema(
    'BulkStatusUpdateResponse',
    zOpenApi.object({
      data: zOpenApi.object({
        action: zOpenApi.literal('bulk_status_update'),
        status: AutomationRuleStatus,
        rule_ids: zOpenApi.array(zOpenApi.string().uuid()),
        updated: zOpenApi.number().int().min(0),
        errors: zOpenApi.array(zOpenApi.string()).describe('Per-rule failures emitted as `<ruleId>: <error message>` entries.'),
        message: zOpenApi.string(),
      }),
    }),
  );

  const BulkExecuteResponse = registry.registerSchema(
    'BulkExecuteResponse',
    zOpenApi.object({
      data: zOpenApi.object({
        action: zOpenApi.literal('bulk_execute'),
        rule_ids: zOpenApi.array(zOpenApi.string().uuid()),
        started: zOpenApi.number().int().min(0),
        errors: zOpenApi.array(zOpenApi.string()).describe('Per-rule failures emitted as `<ruleId>: <error message>` entries.'),
        sequential: zOpenApi.boolean().optional(),
        message: zOpenApi.string(),
      }),
    }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/automation/executions',
    summary: 'List automation executions',
    description:
      'Returns a paginated list of automation executions for the authenticated tenant. Authentication uses x-api-key with optional x-tenant-id; the controller validates the API key, resolves the user and tenant, runs under tenant context, and requires automation:read permission. The service forces tenant into the execution query conditions. Current service code appears to wrap the execution array in another array before createPaginatedResponse, which may produce nested data in practice.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: AutomationExecutionsListQuery },
    responses: {
      200: { description: 'Automation executions returned successfully.', schema: AutomationExecutionListResponse },
      400: { description: 'Query parameter validation failed.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:read permission.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected automation execution listing failure.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'read',
      'x-service-data-wrapping-bug': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/automation/executions/{id}',
    summary: 'Get automation execution',
    description:
      'Returns one automation execution by execution_id for the authenticated tenant, with HATEOAS links to the parent rule and retry endpoint when the status is failed. Authentication uses x-api-key with optional x-tenant-id; the controller validates the API key, resolves tenant context, validates the UUID path parameter, and requires automation:read permission. The service scopes lookup by execution_id and tenant. Missing executions currently throw a generic Error and may surface as 500 rather than 404.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AutomationExecutionParams },
    responses: {
      200: { description: 'Automation execution returned successfully.', schema: AutomationExecutionResponse },
      400: { description: 'Invalid execution UUID format.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:read permission.', schema: AutomationErrorResponse },
      404: { description: 'Intended not-found response for a missing execution; current service may surface this as 500.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected failure, including current generic not-found errors.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'read',
      'x-no-clean-not-found-currently': true,
      'x-generic-resource-links-may-include-unimplemented-methods': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/automation/executions/{id}/retry',
    summary: 'Retry automation execution',
    description:
      'Retries a failed automation execution. The controller authenticates with x-api-key, requires automation:execute permission, validates the execution UUID, resets a failed execution to pending, clears completion/error counters, queues the execution, publishes automation.execution.retried, and returns the updated execution with links. The service only allows status=failed; missing executions and non-failed executions currently throw generic Errors and may surface as 500 rather than 404 or 400. The queueExecution helper is currently a stub.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AutomationExecutionParams },
    responses: {
      200: { description: 'Execution reset and queued for retry.', schema: AutomationExecutionResponse },
      400: { description: 'Invalid execution UUID format, or intended response when execution is not failed.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:execute permission.', schema: AutomationErrorResponse },
      404: { description: 'Intended not-found response for a missing execution; current service may surface this as 500.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected failure, including current generic not-found or not-failed errors.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'execute',
      'x-requires-current-status': 'failed',
      'x-queues-execution-stubbed': true,
      'x-publishes-event': 'automation.execution.retried',
      'x-no-clean-not-found-currently': true,
      'x-not-failed-error-is-500-currently': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/automation/rules',
    summary: 'List automation rules',
    description:
      'Returns a paginated list of automation rules scoped to the authenticated tenant. Authentication uses x-api-key with optional x-tenant-id, then RBAC requires automation:read. The controller validates query params with automationRulesListSchema, parses page/limit from the URL, and the service enforces tenant filtering on automation_rules.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: AutomationRulesListQuery },
    responses: {
      200: { description: 'Automation rules returned successfully.', schema: AutomationRuleListResponse },
      400: { description: 'Query parameter validation failed.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:read permission.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected automation rules listing failure.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'read',
      'x-id-provenance': {
        rule_id: 'automation_rules.rule_id',
        tenant: 'automation_rules.tenant',
      },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/automation/rules',
    summary: 'Create automation rule',
    description:
      'Creates a tenant-scoped automation rule in automation_rules. Authentication uses x-api-key with optional x-tenant-id; RBAC requires automation:create. The controller validates request body via createAutomationRuleSchema, and the service validates trigger/action config, inserts the rule with crypto.randomUUID generated rule_id, and emits automation.rule.created + audit log events.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: CreateAutomationRuleRequest } },
    responses: {
      201: { description: 'Automation rule created successfully.', schema: AutomationRuleResponse },
      400: { description: 'Body validation failed.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:create permission.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected automation rule creation failure.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'create',
      'x-id-provenance': {
        rule_id: 'automation_rules.rule_id (crypto.randomUUID)',
        created_by: 'API key context userId',
      },
      'x-publishes-event': 'automation.rule.created',
      'x-audit-log-action': 'automation_rule_created',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/automation/rules/{id}',
    summary: 'Get automation rule',
    description:
      'Returns one automation rule by rule_id for the authenticated tenant with generated links and execution statistics. Authentication uses x-api-key with optional x-tenant-id; RBAC requires automation:read. The service scopes by {rule_id, tenant}. Missing rules currently throw generic Error and surface as 500 rather than 404.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AutomationRuleParams },
    responses: {
      200: { description: 'Automation rule returned successfully.', schema: AutomationRuleResponse },
      400: { description: 'Invalid rule UUID format.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:read permission.', schema: AutomationErrorResponse },
      404: { description: 'Intended not-found response for missing rules; current service may surface this as 500.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected failure, including current generic not-found errors.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'read',
      'x-id-provenance': {
        rule_id: 'automation_rules.rule_id',
      },
      'x-no-clean-not-found-currently': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/automation/rules/{id}',
    summary: 'Update automation rule',
    description:
      'Updates an automation rule by rule_id for the authenticated tenant. Authentication uses x-api-key with optional x-tenant-id; RBAC requires automation:update. The controller validates partial updates with updateAutomationRuleSchema and the service revalidates trigger/action config when changed, updates automation_rules, and emits automation.rule.updated + audit log events. Missing rules currently surface as 500.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AutomationRuleParams, body: { schema: UpdateAutomationRuleRequest } },
    responses: {
      200: { description: 'Automation rule updated successfully.', schema: AutomationRuleResponse },
      400: { description: 'Invalid UUID format or body validation failed.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:update permission.', schema: AutomationErrorResponse },
      404: { description: 'Intended not-found response for missing rules; current service may surface this as 500.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected failure, including current generic not-found errors.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'update',
      'x-publishes-event': 'automation.rule.updated',
      'x-audit-log-action': 'automation_rule_updated',
      'x-no-clean-not-found-currently': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/automation/rules/{id}',
    summary: 'Delete automation rule',
    description:
      'Deletes one automation rule by rule_id for the authenticated tenant. Authentication uses x-api-key with optional x-tenant-id; RBAC requires automation:delete. The service blocks deletion when pending/running executions exist, unschedules active rules, deletes automation_rules row, and emits automation.rule.deleted + audit log events. Missing rules and delete constraints currently bubble as 500 errors.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AutomationRuleParams },
    responses: {
      204: { description: 'Automation rule deleted successfully.', emptyBody: true },
      400: { description: 'Invalid rule UUID format.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:delete permission.', schema: AutomationErrorResponse },
      404: { description: 'Intended not-found response for missing rules; current service may surface this as 500.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected failure, including running-execution constraints and generic not-found errors.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'delete',
      'x-publishes-event': 'automation.rule.deleted',
      'x-audit-log-action': 'automation_rule_deleted',
      'x-no-clean-not-found-currently': true,
      'x-delete-blocked-when-running-executions': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/automation/rules/{id}/execute',
    summary: 'Execute automation rule manually',
    description:
      'Starts a manual execution for one automation rule identified by path rule_id. Authentication uses x-api-key with optional x-tenant-id; RBAC requires automation:execute. The current request schema requires automation_rule_id in the body, but controller/service execute the path rule ID and do not cross-check the body ID. For dry_run=false the service creates automation_executions row and queues execution via a currently stubbed queue helper.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AutomationRuleParams, body: { schema: ManualExecutionRequest } },
    responses: {
      201: { description: 'Manual execution created successfully.', schema: AutomationExecutionResponse },
      400: { description: 'Invalid UUID format or body validation failed.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:execute permission.', schema: AutomationErrorResponse },
      404: { description: 'Intended not-found response for missing rules; current service may surface this as 500.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected failure, including current generic not-found and inactive-rule errors.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'execute',
      'x-body-automation-rule-id-not-used': true,
      'x-id-provenance': {
        execution_id: 'automation_executions.execution_id (crypto.randomUUID)',
        automation_rule_id: 'URL path param /rules/{id}',
      },
      'x-publishes-event': 'automation.execution.started',
      'x-audit-log-action': 'automation_execution_started',
      'x-queues-execution-stubbed': true,
      'x-no-clean-not-found-currently': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/automation/rules/bulk-status',
    summary: 'Bulk update automation rule status',
    description:
      'Updates status for up to 100 automation rules under the authenticated tenant. Authentication uses x-api-key with optional x-tenant-id; RBAC requires automation:update. The controller validates ids/status with bulkStatusUpdateSchema and calls updateAutomationRule per id. Failures are collected into an errors array and still return HTTP 200 with partial-success details.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: BulkStatusUpdateRequest } },
    responses: {
      200: { description: 'Bulk status update attempted for all ids; includes per-id errors.', schema: BulkStatusUpdateResponse },
      400: { description: 'Body validation failed.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:update permission.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected controller or service failure before result aggregation.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'update',
      'x-partial-failures-return-200': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/automation/rules/bulk-execute',
    summary: 'Bulk execute automation rules',
    description:
      'Starts execution attempts for up to 20 automation rules for the authenticated tenant. Authentication uses x-api-key with optional x-tenant-id; RBAC requires automation:execute. The controller validates bulkExecutionSchema and calls executeAutomationRule per id. sequential_execution=true runs serially; otherwise Promise.all is used. Per-rule errors are returned in a 200 response.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: BulkExecuteRequest } },
    responses: {
      200: { description: 'Bulk execution attempted for all ids; includes started count and per-id errors.', schema: BulkExecuteResponse },
      400: { description: 'Body validation failed.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:execute permission.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected controller or service failure before result aggregation.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'execute',
      'x-partial-failures-return-200': true,
      'x-sequential-execution-supported': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/automation/templates',
    summary: 'List automation templates',
    description:
      'Returns a paginated list of automation templates for the authenticated tenant. Authentication uses x-api-key with optional x-tenant-id; RBAC requires automation:read. The controller validates query params with templatesListSchema and the service filters automation_templates by tenant. Current service code wraps template array before createPaginatedResponse, which can produce nested data in practice.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: AutomationTemplatesListQuery },
    responses: {
      200: { description: 'Automation templates returned successfully.', schema: AutomationTemplateListResponse },
      400: { description: 'Query parameter validation failed.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:read permission.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected automation templates listing failure.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'read',
      'x-service-data-wrapping-bug': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/automation/templates',
    summary: 'Create automation template from rule',
    description:
      'Creates a template row by copying one source automation rule into automation_templates.template_config. Authentication uses x-api-key with optional x-tenant-id; RBAC requires automation:create. The controller validates createTemplateFromRuleSchema and service emits automation.template.created + audit log events. Missing source rules currently throw generic Error and surface as 500.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: CreateAutomationTemplateRequest } },
    responses: {
      201: { description: 'Automation template created successfully.', schema: AutomationTemplateResponse },
      400: { description: 'Body validation failed.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:create permission.', schema: AutomationErrorResponse },
      404: { description: 'Intended not-found response for missing source rules; current service may surface this as 500.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected failure, including current generic source-rule not-found errors.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'create',
      'x-id-provenance': {
        template_id: 'automation_templates.template_id (crypto.randomUUID)',
        automation_rule_id: 'automation_rules.rule_id',
      },
      'x-publishes-event': 'automation.template.created',
      'x-audit-log-action': 'automation_template_created',
      'x-no-clean-not-found-currently': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/automation/templates/{id}',
    summary: 'Get automation template',
    description:
      'Returns one automation template by template_id for the authenticated tenant. Authentication uses x-api-key with optional x-tenant-id; RBAC requires automation:read. Service lookup is scoped by {template_id, tenant}. Missing templates currently throw generic Error and surface as 500 rather than 404.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AutomationTemplateParams },
    responses: {
      200: { description: 'Automation template returned successfully.', schema: AutomationTemplateResponse },
      400: { description: 'Invalid template UUID format.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:read permission.', schema: AutomationErrorResponse },
      404: { description: 'Intended not-found response for missing templates; current service may surface this as 500.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected failure, including current generic not-found errors.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'read',
      'x-id-provenance': {
        template_id: 'automation_templates.template_id',
      },
      'x-no-clean-not-found-currently': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/automation/templates/{id}/use',
    summary: 'Create automation rule from template',
    description:
      'Uses one template_id to create a new automation rule under the authenticated tenant. Authentication uses x-api-key with optional x-tenant-id; RBAC requires automation:create. The controller validates `{ variables }`, then service loads template, applies substitutions into template_config, creates rule via createAutomationRule, and increments automation_templates.usage_count/last_used. Missing templates surface as 500.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AutomationTemplateParams, body: { schema: UseAutomationTemplateRequest } },
    responses: {
      201: { description: 'Automation rule created from template.', schema: AutomationRuleResponse },
      400: { description: 'Invalid template UUID format or body validation failed.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:create permission.', schema: AutomationErrorResponse },
      404: { description: 'Intended not-found response for missing templates; current service may surface this as 500.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected failure, including current generic template not-found errors.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'create',
      'x-id-provenance': {
        template_id: 'automation_templates.template_id',
        rule_id: 'automation_rules.rule_id (crypto.randomUUID from createAutomationRule)',
      },
      'x-uses-template-config-clone': true,
      'x-no-clean-not-found-currently': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/automation/statistics',
    summary: 'Get automation statistics',
    description:
      'Returns tenant-scoped automation aggregate counts (rules and executions) plus HATEOAS links. Authentication uses x-api-key with optional x-tenant-id; RBAC requires automation:read. The service computes counts from automation_rules and automation_executions plus period-based execution totals and success rate.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: { description: 'Automation statistics returned successfully.', schema: AutomationStatisticsResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:read permission.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected automation statistics failure.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'read',
      'x-analytics-from-tables': ['automation_rules', 'automation_executions'],
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/automation/performance',
    summary: 'Get automation performance metrics',
    description:
      'Returns performance metrics calculated by AutomationService.calculatePerformanceMetrics for the authenticated tenant. Authentication uses x-api-key with optional x-tenant-id; RBAC requires automation:read. Query is validated with performanceMetricsRequestSchema; because validateQueryParams maps URL values to strings, array filters (rule_ids, metrics) currently have parsing limitations and may fail validation unless encoded specially.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: AutomationPerformanceQuery },
    responses: {
      200: { description: 'Automation performance payload returned successfully.', schema: AutomationPerformanceResponse },
      400: { description: 'Query parameter validation failed.', schema: AutomationErrorResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:read permission.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected performance metrics failure.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'read',
      'x-query-array-parsing-gap': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/automation/meta',
    summary: 'Get automation metadata',
    description:
      'Returns a static reference catalog of automation enum values: trigger types, action types, rule statuses, execution statuses, priority levels, and condition operators. Authentication uses x-api-key with optional x-tenant-id; the controller validates the API key, resolves tenant context, and requires automation:read permission. The response is hardcoded and performs no service or database lookup beyond authentication/RBAC.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: { description: 'Automation metadata returned successfully.', schema: AutomationMetaResponse },
      401: { description: 'API key is missing, invalid, expired, over limit, or the key user was not found.', schema: AutomationErrorResponse },
      403: { description: 'Authenticated user lacks automation:read permission.', schema: AutomationErrorResponse },
      500: { description: 'Unexpected automation metadata failure.', schema: AutomationErrorResponse },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'automation',
      'x-rbac-action': 'read',
      'x-static-reference-data': true,
    },
    edition: 'both',
  });
}
