type TeamsInstallStatus = 'not_configured' | 'install_pending' | 'active' | 'error';
type TeamsCapability =
  | 'personal_tab'
  | 'personal_bot'
  | 'group_chat_bot'
  | 'message_extension'
  | 'activity_notifications';
type TeamsNotificationCategory =
  | 'assignment'
  | 'customer_reply'
  | 'approval_request'
  | 'escalation'
  | 'sla_risk';
type TeamsAllowedAction =
  | 'assign_ticket'
  | 'add_note'
  | 'reply_to_contact'
  | 'log_time'
  | 'approval_response';

interface TeamsIntegrationStatusResponse {
  success: boolean;
  error?: string;
  integration?: {
    selectedProfileId: string | null;
    installStatus: TeamsInstallStatus;
    enabledCapabilities: TeamsCapability[];
    notificationCategories: TeamsNotificationCategory[];
    allowedActions: TeamsAllowedAction[];
    appId: string | null;
    botId: string | null;
    packageMetadata: Record<string, unknown> | null;
    lastError: string | null;
  };
}

interface TeamsIntegrationExecutionState {
  selectedProfileId: string | null;
  installStatus: TeamsInstallStatus;
  enabledCapabilities: TeamsCapability[];
  allowedActions: TeamsAllowedAction[];
  appId: string | null;
  packageMetadata: Record<string, unknown> | null;
}

interface TeamsIntegrationSettingsInput {
  selectedProfileId?: string | null;
  installStatus?: TeamsInstallStatus;
  enabledCapabilities?: TeamsCapability[];
  notificationCategories?: TeamsNotificationCategory[];
  allowedActions?: TeamsAllowedAction[];
  lastError?: string | null;
}

const DEFAULT_EXECUTION_STATE: TeamsIntegrationExecutionState = {
  selectedProfileId: null,
  installStatus: 'not_configured',
  enabledCapabilities: ['personal_tab', 'personal_bot', 'message_extension', 'activity_notifications'],
  allowedActions: ['assign_ticket', 'add_note', 'reply_to_contact', 'log_time', 'approval_response'],
  appId: null,
  packageMetadata: null,
};

export async function getTeamsIntegrationStatusImpl(
  _user: unknown,
  _context: { tenant: string }
): Promise<TeamsIntegrationStatusResponse> {
  return {
    success: false,
    error: 'Microsoft Teams integration is only available in Enterprise Edition.',
  };
}

export async function getTeamsIntegrationExecutionStateImpl(
  _tenant: string
): Promise<TeamsIntegrationExecutionState> {
  return DEFAULT_EXECUTION_STATE;
}

export async function saveTeamsIntegrationSettingsImpl(
  _user: unknown,
  _context: { tenant: string },
  _input: TeamsIntegrationSettingsInput
): Promise<TeamsIntegrationStatusResponse> {
  return {
    success: false,
    error: 'Microsoft Teams integration is only available in Enterprise Edition.',
  };
}
