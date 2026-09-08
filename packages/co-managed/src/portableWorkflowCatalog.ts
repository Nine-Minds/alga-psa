/** Authored workflow configuration only; runtime, validation caches and secret provider state are separate. */
export const CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS = {
  workflow_definitions: ['workflow_id', 'name', 'description', 'payload_schema_ref', 'trigger', 'draft_definition', 'draft_version', 'status', 'created_by', 'updated_by', 'created_at', 'updated_at', 'is_system', 'is_visible', 'is_paused', 'concurrency_limit', 'auto_pause_on_failure', 'failure_rate_threshold', 'failure_rate_min_runs', 'retention_policy_override', 'payload_schema_mode', 'pinned_payload_schema_ref', 'payload_schema_provenance', 'key'],
  workflow_definition_versions: ['version_id', 'workflow_id', 'version', 'definition_json', 'payload_schema_json', 'published_by', 'published_at', 'created_at', 'updated_at'],
  workflow_form_definitions: ['form_id', 'name', 'description', 'version', 'status', 'category', 'created_by', 'created_at', 'updated_at', 'is_temporary'],
  workflow_form_schemas: ['schema_id', 'form_id', 'json_schema', 'ui_schema', 'default_values', 'created_at', 'updated_at'],
  workflow_task_definitions: ['task_definition_id', 'name', 'description', 'form_id', 'form_type', 'default_priority', 'default_sla_days', 'created_by', 'created_at', 'updated_at', 'task_type'],
} as const;
export type CoManagedPortableWorkflowTable = keyof typeof CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS;
export type CoManagedPortableWorkflowRecords = Record<CoManagedPortableWorkflowTable, Record<string, unknown>[]>;
