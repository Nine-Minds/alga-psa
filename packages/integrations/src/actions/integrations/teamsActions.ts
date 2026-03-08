'use server';

import logger from '@alga-psa/core/logger';
import { withAuth } from '@alga-psa/auth/withAuth';
import { getTeamsAvailability } from '../../lib/teamsAvailability';
import type {
  TeamsAllowedAction,
  TeamsCapability,
  TeamsInstallStatus,
  TeamsNotificationCategory,
} from './teamsShared';
import type {
  TeamsIntegrationExecutionState,
  TeamsIntegrationSettingsInput,
  TeamsIntegrationStatusResponse,
} from './teamsContracts';

const DEFAULT_EXECUTION_STATE: TeamsIntegrationExecutionState = {
  selectedProfileId: null,
  installStatus: 'not_configured',
  enabledCapabilities: ['personal_tab', 'personal_bot', 'message_extension', 'activity_notifications'],
  allowedActions: ['assign_ticket', 'add_note', 'reply_to_contact', 'log_time', 'approval_response'],
  appId: null,
  packageMetadata: null,
};

let eeTeamsActionsPromise:
  | Promise<{
      getTeamsIntegrationStatusImpl?: (
        user: unknown,
        context: { tenant: string }
      ) => Promise<TeamsIntegrationStatusResponse>;
      getTeamsIntegrationExecutionStateImpl?: (
        tenant: string
      ) => Promise<TeamsIntegrationExecutionState>;
      saveTeamsIntegrationSettingsImpl?: (
        user: unknown,
        context: { tenant: string },
        input: TeamsIntegrationSettingsInput
      ) => Promise<TeamsIntegrationStatusResponse>;
    }>
  | null = null;

async function loadEeTeamsActions() {
  if (!eeTeamsActionsPromise) {
    eeTeamsActionsPromise = import('../../../../../ee/server/src/lib/actions/integrations/teamsActions').catch((error) => {
      logger.warn('[TeamsActions] Failed to load EE Teams settings action implementation', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    });
  }

  return eeTeamsActionsPromise;
}

export const getTeamsIntegrationStatus = withAuth(async (
  user,
  { tenant }
): Promise<TeamsIntegrationStatusResponse> => {
  const availability = await getTeamsAvailability({
    tenantId: tenant,
    userId: (user as any)?.user_id,
  });
  if (!availability.enabled) {
    return { success: false, error: availability.message };
  }

  const ee = await loadEeTeamsActions();
  if (!ee.getTeamsIntegrationStatusImpl) {
    return { success: false, error: 'Failed to load Teams integration settings' };
  }

  return ee.getTeamsIntegrationStatusImpl(user, { tenant });
});

export async function getTeamsIntegrationExecutionState(
  tenant: string
): Promise<TeamsIntegrationExecutionState> {
  const ee = await loadEeTeamsActions();
  if (!ee.getTeamsIntegrationExecutionStateImpl) {
    return DEFAULT_EXECUTION_STATE;
  }

  return ee.getTeamsIntegrationExecutionStateImpl(tenant);
}

export const saveTeamsIntegrationSettings = withAuth(async (
  user,
  { tenant },
  input: TeamsIntegrationSettingsInput
): Promise<TeamsIntegrationStatusResponse> => {
  const availability = await getTeamsAvailability({
    tenantId: tenant,
    userId: (user as any)?.user_id,
  });
  if (!availability.enabled) {
    return { success: false, error: availability.message };
  }

  const ee = await loadEeTeamsActions();
  if (!ee.saveTeamsIntegrationSettingsImpl) {
    return { success: false, error: 'Failed to save Teams integration settings' };
  }

  return ee.saveTeamsIntegrationSettingsImpl(user, { tenant }, input);
});
