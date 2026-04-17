export const TEAMS_INSTALL_STATUSES = ['not_configured', 'install_pending', 'active', 'error'] as const;
export type TeamsInstallStatus = typeof TEAMS_INSTALL_STATUSES[number];

export const TEAMS_CAPABILITIES = [
  'personal_tab',
  'personal_bot',
  'group_chat_bot',
  'message_extension',
  'activity_notifications',
] as const;
export type TeamsCapability = typeof TEAMS_CAPABILITIES[number];

export const TEAMS_NOTIFICATION_CATEGORIES = [
  'assignment',
  'customer_reply',
  'approval_request',
  'escalation',
  'sla_risk',
] as const;
export type TeamsNotificationCategory = typeof TEAMS_NOTIFICATION_CATEGORIES[number];

export const TEAMS_ALLOWED_ACTIONS = [
  'assign_ticket',
  'add_note',
  'reply_to_contact',
  'log_time',
  'approval_response',
] as const;
export type TeamsAllowedAction = typeof TEAMS_ALLOWED_ACTIONS[number];
