/** Customer operational engagement records. Meeting provider identities, join
 * credentials, dispatch state and commercial service prices are excluded. */
export const CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS = {
  interactions: ['interaction_id', 'type_id', 'contact_name_id', 'user_id', 'ticket_id', 'title', 'interaction_date', 'duration', 'notes', 'start_time', 'end_time', 'status_id', 'client_id', 'project_id', 'visibility', 'category', 'tags'],
  interaction_types: ['type_id', 'type_name', 'icon', 'system_type_id', 'display_order', 'color', 'is_request', 'created_by'],
  system_interaction_types: ['type_id', 'type_name', 'icon', 'created_at', 'updated_at', 'display_order'],
  appointment_requests: ['appointment_request_id', 'client_id', 'contact_id', 'service_id', 'requested_date', 'requested_time', 'requested_duration', 'preferred_assigned_user_id', 'status', 'description', 'ticket_id', 'is_authenticated', 'requester_name', 'requester_email', 'requester_phone', 'company_name', 'schedule_entry_id', 'approved_by_user_id', 'approved_at', 'declined_reason', 'created_at', 'updated_at', 'requester_timezone', 'online_meeting_provider'],
  availability_settings: ['availability_setting_id', 'setting_type', 'user_id', 'service_id', 'day_of_week', 'start_time', 'end_time', 'is_available', 'buffer_before_minutes', 'buffer_after_minutes', 'max_appointments_per_day', 'allow_without_contract', 'advance_booking_days', 'minimum_notice_hours', 'config_json', 'created_at', 'updated_at'],
  availability_exceptions: ['exception_id', 'user_id', 'date', 'is_available', 'reason', 'created_at', 'updated_at'],
  online_meetings: ['meeting_id', 'provider', 'subject', 'start_time', 'end_time', 'status', 'appointment_request_id', 'interaction_id', 'schedule_entry_id', 'created_by', 'created_at', 'updated_at'],
  online_meeting_artifacts: ['artifact_id', 'meeting_id', 'artifact_type', 'document_id', 'file_id', 'created_date_time', 'created_at', 'updated_at'],
  service_catalog: ['service_id', 'service_name', 'description', 'unit_of_measure', 'category_id', 'custom_service_type_id', 'is_active'],
  service_types: ['id', 'name', 'standard_service_type_id', 'is_active', 'description', 'created_at', 'updated_at', 'order_number'],
  standard_service_types: ['id', 'name', 'created_at', 'updated_at', 'display_order'],
  service_categories: ['category_id', 'category_name', 'description', 'is_active', 'created_at', 'updated_at', 'created_by', 'updated_by', 'display_order'],
} as const;
export type CoManagedPortableEngagementTable = keyof typeof CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS;
export type CoManagedPortableEngagementRecords = Record<CoManagedPortableEngagementTable, Record<string, unknown>[]>;
