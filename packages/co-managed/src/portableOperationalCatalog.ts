/** Explicit customer-owned operational projections. Billing, live sponsorship,
 * provider bindings, running clocks and dispatch receipts never enter this component.
 * Native operational time persists billable_duration=0 and service_id=null;
 * elapsed effort is reconstructed from the preserved start/end timestamps. */
export const CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS = {
  time_entries: ['entry_id', 'user_id', 'start_time', 'end_time', 'notes', 'work_item_id', 'work_item_type', 'approval_status', 'time_sheet_id', 'created_at', 'updated_at', 'work_date', 'work_timezone', 'created_by', 'updated_by'],
  time_sheets: ['id', 'user_id', 'period_id', 'approval_status', 'submitted_at', 'approved_at', 'approved_by'],
  time_sheet_comments: ['comment_id', 'time_sheet_id', 'user_id', 'comment', 'created_at', 'is_approver'],
  time_entry_change_requests: ['change_request_id', 'time_sheet_id', 'time_entry_id', 'created_by', 'comment', 'created_at', 'handled_by', 'handled_at'],
  time_periods: ['period_id', 'start_date', 'end_date', 'is_closed', 'created_at', 'updated_at'],
  time_period_settings: ['time_period_settings_id', 'start_day', 'frequency', 'frequency_unit', 'is_active', 'effective_from', 'effective_to', 'created_at', 'updated_at', 'end_day', 'start_month', 'start_day_of_month', 'end_month', 'end_day_of_month'],
  time_period_types: ['type_id', 'type_name', 'description'],
  schedule_entries: ['entry_id', 'title', 'work_item_id', 'scheduled_start', 'scheduled_end', 'status', 'notes', 'recurrence_pattern', 'work_item_type', 'created_at', 'updated_at', 'original_entry_id', 'is_recurring', 'is_private'],
  schedule_entry_assignees: ['entry_id', 'user_id', 'created_at', 'updated_at'],
  user_work_schedules: ['user_id', 'day_of_week', 'start_time', 'end_time', 'is_working', 'created_at', 'updated_at'],
  business_hours_schedules: ['schedule_id', 'schedule_name', 'timezone', 'is_default', 'is_24x7', 'created_at', 'updated_at'],
  business_hours_entries: ['entry_id', 'schedule_id', 'day_of_week', 'start_time', 'end_time', 'is_enabled'],
  holidays: ['holiday_id', 'schedule_id', 'holiday_name', 'holiday_date', 'is_recurring', 'created_at'],
  sla_policies: ['sla_policy_id', 'policy_name', 'description', 'is_default', 'created_at', 'updated_at', 'business_hours_schedule_id'],
  sla_policy_targets: ['target_id', 'sla_policy_id', 'priority_id', 'response_time_minutes', 'resolution_time_minutes', 'escalation_1_percent', 'escalation_2_percent', 'escalation_3_percent', 'is_24x7', 'created_at', 'updated_at'],
  sla_settings: ['pause_on_awaiting_client', 'created_at', 'updated_at'],
  sla_notification_thresholds: ['threshold_id', 'sla_policy_id', 'threshold_percent', 'notification_type', 'notify_assignee', 'notify_board_manager', 'notify_escalation_manager', 'channels', 'created_at'],
} as const;
export type CoManagedPortableOperationalTable = keyof typeof CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS;
export type CoManagedPortableOperationalRecords = Record<CoManagedPortableOperationalTable, Record<string, unknown>[]>;
