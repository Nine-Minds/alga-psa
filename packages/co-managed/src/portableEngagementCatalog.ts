/** Customer engagement records: interactions, appointment requests,
 * availability, and only the service descriptors those records reference.
 * Global interaction/service type tables are not owned (tenantDb refuses global
 * tables) and stay external edges. online_meetings belongs to the EE meeting
 * contributor and online_meeting_artifacts to the supplemental-file contributor.
 * Commercial service pricing and dispatch state are excluded. */
export const CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS = {
  interactions: ['interaction_id', 'type_id', 'contact_name_id', 'user_id', 'ticket_id', 'title', 'interaction_date', 'duration', 'notes', 'start_time', 'end_time', 'status_id', 'client_id', 'project_id', 'visibility', 'category', 'tags'],
  interaction_types: ['type_id', 'type_name', 'icon', 'system_type_id', 'display_order', 'color', 'is_request', 'created_by'],
  appointment_requests: ['appointment_request_id', 'client_id', 'contact_id', 'service_id', 'requested_date', 'requested_time', 'requested_duration', 'preferred_assigned_user_id', 'status', 'description', 'ticket_id', 'is_authenticated', 'requester_name', 'requester_email', 'requester_phone', 'company_name', 'schedule_entry_id', 'approved_by_user_id', 'approved_at', 'declined_reason', 'created_at', 'updated_at', 'requester_timezone', 'online_meeting_provider'],
  availability_settings: ['availability_setting_id', 'setting_type', 'user_id', 'service_id', 'day_of_week', 'start_time', 'end_time', 'is_available', 'buffer_before_minutes', 'buffer_after_minutes', 'max_appointments_per_day', 'allow_without_contract', 'advance_booking_days', 'minimum_notice_hours', 'config_json', 'created_at', 'updated_at'],
  availability_exceptions: ['exception_id', 'user_id', 'date', 'is_available', 'reason', 'created_at', 'updated_at'],
  service_catalog: ['service_id', 'service_name', 'description', 'unit_of_measure', 'category_id', 'custom_service_type_id', 'is_active'],
  service_types: ['id', 'name', 'standard_service_type_id', 'is_active', 'description', 'created_at', 'updated_at', 'order_number'],
  service_categories: ['category_id', 'category_name', 'description', 'is_active', 'created_at', 'updated_at', 'created_by', 'updated_by', 'display_order'],
} as const;
export type CoManagedPortableEngagementTable = keyof typeof CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS;
export type CoManagedPortableEngagementRecords = Record<CoManagedPortableEngagementTable, Record<string, unknown>[]>;

export const CO_MANAGED_PORTABLE_ENGAGEMENT_REFERENCES = [
  ['interactions', 'contact_name_id', 'contacts', 'contact_name_id'], ['interactions', 'client_id', 'clients', 'client_id'],
  ['interactions', 'ticket_id', 'tickets', 'ticket_id'], ['interactions', 'project_id', 'projects', 'project_id'],
  ['interactions', 'status_id', 'statuses', 'status_id'],
  ['appointment_requests', 'client_id', 'clients', 'client_id'], ['appointment_requests', 'contact_id', 'contacts', 'contact_name_id'],
  ['appointment_requests', 'service_id', 'service_catalog', 'service_id'], ['appointment_requests', 'ticket_id', 'tickets', 'ticket_id'],
  ['appointment_requests', 'schedule_entry_id', 'schedule_entries', 'entry_id'],
  ['availability_settings', 'service_id', 'service_catalog', 'service_id'],
  ['service_catalog', 'category_id', 'service_categories', 'category_id'], ['service_catalog', 'custom_service_type_id', 'service_types', 'id'],
] as const;
