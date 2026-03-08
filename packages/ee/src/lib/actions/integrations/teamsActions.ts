import type {
  TeamsIntegrationExecutionState,
  TeamsIntegrationSettingsInput,
  TeamsIntegrationStatusResponse,
} from '@alga-psa/integrations/actions/integrations/teamsContracts';

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
