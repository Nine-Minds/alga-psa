export enum AnalyticsEvents {
  // Application Events
  APP_STARTED = 'app_started',
  APP_ERROR = 'app_error',
  
  // User Events
  USER_SIGNED_UP = 'user_signed_up',
  USER_LOGGED_IN = 'user_logged_in',
  USER_LOGGED_OUT = 'user_logged_out',
  USER_PROFILE_UPDATED = 'user_profile_updated',
  
  // Ticket Events
  TICKET_CREATED = 'ticket_created',
  TICKET_UPDATED = 'ticket_updated',
  TICKET_RESOLVED = 'ticket_resolved',
  TICKET_SEARCHED = 'ticket_searched',
  TICKET_VIEWED = 'ticket_viewed',
  TICKET_ASSIGNED = 'ticket_assigned',
  TICKET_STATUS_CHANGED = 'ticket_status_changed',
  COMMENT_CREATED = 'comment_created',
  
  // Time Tracking
  TIME_ENTRY_CREATED = 'time_entry_created',
  TIME_ENTRY_UPDATED = 'time_entry_updated',
  TIME_ENTRY_DELETED = 'time_entry_deleted',
  TIME_SHEET_SUBMITTED = 'time_sheet_submitted',
  TIME_SHEET_APPROVED = 'time_sheet_approved',
  
  // Billing
  INVOICE_GENERATED = 'invoice_generated',
  INVOICE_SENT = 'invoice_sent',
  INVOICE_VIEWED = 'invoice_viewed',
  PAYMENT_PROCESSED = 'payment_processed',
  BILLING_RULE_CREATED = 'billing_rule_created',
  BILLING_RULE_UPDATED = 'billing_rule_updated',
  
  // Projects
  PROJECT_CREATED = 'project_created',
  PROJECT_UPDATED = 'project_updated',
  PROJECT_COMPLETED = 'project_completed',
  PROJECT_TASK_CREATED = 'project_task_created',
  PROJECT_TASK_COMPLETED = 'project_task_completed',
  
  // Reports
  REPORT_GENERATED = 'report_generated',
  REPORT_EXPORTED = 'report_exported',
  REPORT_SCHEDULED = 'report_scheduled',
  DASHBOARD_VIEWED = 'dashboard_viewed',
  
  // Features
  FEATURE_ENABLED = 'feature_enabled',
  FEATURE_DISABLED = 'feature_disabled',
  FEATURE_ACCESSED = 'feature_accessed',
  INTEGRATION_CONNECTED = 'integration_connected',
  INTEGRATION_DISCONNECTED = 'integration_disconnected',
  
  // Search
  SEARCH_PERFORMED = 'search_performed',
  SEARCH_RESULT_CLICKED = 'search_result_clicked',
  
  // Navigation
  PAGE_VIEWED = 'page_viewed',
  NAVIGATION_CLICKED = 'navigation_clicked',
  
  // Performance
  SLOW_QUERY = 'slow_query',
  API_ERROR = 'api_error',
  API_TIMEOUT = 'api_timeout',
  
  // Journey Tracking
  JOURNEY_STARTED = 'journey_started',
  JOURNEY_STEP_COMPLETED = 'journey_step_completed',
  JOURNEY_COMPLETED = 'journey_completed',
  JOURNEY_ABANDONED = 'journey_abandoned',
  ERROR_RECOVERY_ATTEMPTED = 'error_recovery_attempted',
  
  // Performance Metrics
  PERFORMANCE_METRIC = 'performance_metric',
  SLOW_OPERATION_DETECTED = 'slow_operation_detected',
  PAGE_PERFORMANCE = 'page_performance',
  API_PERFORMANCE = 'api_performance',
  SEARCH_PERFORMANCE = 'search_performance',
  REPORT_GENERATION_PERFORMANCE = 'report_generation_performance',
  SLOW_DATABASE_QUERY = 'slow_database_query',
  BULK_OPERATION_PERFORMANCE = 'bulk_operation_performance',
  
  // Feature Adoption
  FEATURE_USED = 'feature_used',
  FEATURE_DISCOVERED = 'feature_discovered',
  FEATURE_FIRST_USE = 'feature_first_use',
  FEATURE_RETENTION = 'feature_retention',
  POWER_USER_SCORE_CALCULATED = 'power_user_score_calculated',
  ROLE_BASED_USAGE_PATTERN = 'role_based_usage_pattern',
  NEW_FEATURE_ADOPTION = 'new_feature_adoption',
}

// Helper function to create consistent event properties
export function createEventProperties(
  baseProperties: Record<string, any>,
  additionalProperties?: Record<string, any>
): Record<string, any> {
  return {
    timestamp: new Date().toISOString(),
    ...baseProperties,
    ...additionalProperties,
  };
}