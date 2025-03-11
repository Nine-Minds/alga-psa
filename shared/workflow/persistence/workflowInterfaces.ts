/**
 * Interfaces for workflow persistence models
 */

export interface IWorkflowExecution {
  execution_id: string;
  tenant: string;
  workflow_name: string;
  workflow_version: string;
  current_state: string;
  status: string;
  context_data?: Record<string, any>;
  created_at: string;
  updated_at: string;
  version_id?: string; // Reference to workflow_registration_versions
}

export interface IWorkflowEvent {
  event_id: string;
  tenant: string;
  execution_id: string;
  event_name: string;
  event_type: string;
  from_state: string;
  to_state: string;
  user_id?: string;
  payload?: Record<string, any>;
  created_at: string;
}

export interface IWorkflowActionResult {
  result_id: string;
  tenant: string;
  event_id: string;
  execution_id: string;
  action_name: string;
  action_path?: string;
  action_group?: string;
  parameters?: Record<string, any>;
  result?: Record<string, any>;
  success: boolean;
  error_message?: string;
  idempotency_key: string;
  ready_to_execute: boolean;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface IWorkflowActionDependency {
  dependency_id: string;
  tenant: string;
  execution_id: string;
  event_id: string;
  action_id: string;
  depends_on_id: string;
  dependency_type: string;
  created_at: string;
}

export interface IWorkflowSyncPoint {
  sync_id: string;
  tenant: string;
  execution_id: string;
  event_id: string;
  sync_type: string;
  status: string;
  total_actions: number;
  completed_actions: number;
  created_at: string;
  completed_at?: string;
}

export interface IWorkflowTimer {
  timer_id: string;
  tenant: string;
  execution_id: string;
  timer_name: string;
  state_name: string;
  start_time: string;
  duration: string; // Interval as string
  fire_time: string;
  recurrence?: string;
  status: string;
  created_at: string;
}