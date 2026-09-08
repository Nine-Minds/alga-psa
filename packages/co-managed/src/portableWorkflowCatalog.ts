/** Authored workflow configuration and inert task business history. Execution
 * context, dispatch identities, claims and provider state are never projected. */
export const CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS = {
  workflow_definitions: ['workflow_id', 'name', 'description', 'payload_schema_ref', 'trigger', 'draft_definition', 'draft_version', 'status', 'created_by', 'updated_by', 'created_at', 'updated_at', 'is_system', 'is_visible', 'is_paused', 'concurrency_limit', 'auto_pause_on_failure', 'failure_rate_threshold', 'failure_rate_min_runs', 'retention_policy_override', 'payload_schema_mode', 'pinned_payload_schema_ref', 'payload_schema_provenance', 'key'],
  workflow_definition_versions: ['version_id', 'workflow_id', 'version', 'definition_json', 'payload_schema_json', 'published_by', 'published_at', 'created_at', 'updated_at'],
  workflow_form_definitions: ['form_id', 'name', 'description', 'version', 'status', 'category', 'created_by', 'created_at', 'updated_at', 'is_temporary'],
  workflow_form_schemas: ['schema_id', 'form_id', 'json_schema', 'ui_schema', 'default_values', 'created_at', 'updated_at'],
  workflow_task_definitions: ['task_definition_id', 'name', 'description', 'form_id', 'form_type', 'default_priority', 'default_sla_days', 'created_by', 'created_at', 'updated_at', 'task_type'],
  workflow_tasks: ['task_id', 'tenant_task_definition_id', 'system_task_definition_task_type', 'task_definition_type', 'title', 'description', 'status', 'priority', 'due_date', 'created_at', 'updated_at', 'created_by', 'created_by_name', 'completed_at', 'completed_by', 'completed_by_name', 'response_data'],
  workflow_task_history: ['history_id', 'task_id', 'action', 'from_status', 'to_status', 'user_id', 'user_name', 'timestamp', 'details'],
} as const;
export const CO_MANAGED_PORTABLE_WORKFLOW_HISTORY_TABLES = ['workflow_tasks', 'workflow_task_history'] as const;
export type CoManagedPortableWorkflowTable = keyof typeof CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS;
export type CoManagedPortableWorkflowRecords = Record<CoManagedPortableWorkflowTable, Record<string, unknown>[]>;
