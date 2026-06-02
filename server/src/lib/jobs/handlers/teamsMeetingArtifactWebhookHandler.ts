import logger from '@alga-psa/core/logger';
import { OnlineMeetingModel } from '@alga-psa/clients/models';
import { fetchAndPersistMeetingArtifacts } from '@alga-psa/clients/lib/onlineMeetingArtifactCapture';

export interface TeamsMeetingArtifactSubscriptionRenewalJobData extends Record<string, unknown> {
  tenantId: string;
  lookAheadMinutes?: number;
}

export interface TeamsMeetingArtifactNotificationJobData extends Record<string, unknown> {
  tenantId: string;
  notification: Record<string, unknown>;
}

type EeTeamsMeetingArtifactModule = {
  renewTeamsMeetingArtifactSubscriptions: (data: TeamsMeetingArtifactSubscriptionRenewalJobData) => Promise<unknown>;
  resolveTeamsMeetingIdFromNotification: (notification: Record<string, unknown>) => Promise<string | null>;
};

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

let eeTeamsMeetingArtifactModulePromise: Promise<EeTeamsMeetingArtifactModule | null> | null = null;

async function loadEeTeamsMeetingArtifactModule(): Promise<EeTeamsMeetingArtifactModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeTeamsMeetingArtifactModulePromise) {
    eeTeamsMeetingArtifactModulePromise = import('@alga-psa/ee-microsoft-teams/lib')
      .then((mod) => {
        if (
          typeof mod?.renewTeamsMeetingArtifactSubscriptions !== 'function' ||
          typeof mod?.resolveTeamsMeetingIdFromNotification !== 'function'
        ) {
          return null;
        }
        return mod as EeTeamsMeetingArtifactModule;
      })
      .catch((error) => {
        logger.error('[TeamsMeetingArtifacts] Failed to load EE Teams artifact module', { error });
        return null;
      });
  }

  return eeTeamsMeetingArtifactModulePromise;
}

export async function renewTeamsMeetingArtifactSubscriptions(
  data: TeamsMeetingArtifactSubscriptionRenewalJobData,
): Promise<void> {
  const eeModule = await loadEeTeamsMeetingArtifactModule();
  if (!eeModule?.renewTeamsMeetingArtifactSubscriptions) {
    logger.info('[TeamsMeetingArtifacts] Skipping artifact subscription renewal outside Enterprise Edition', {
      tenantId: data.tenantId,
    });
    return;
  }

  await eeModule.renewTeamsMeetingArtifactSubscriptions(data);
}

export async function processTeamsMeetingArtifactNotification(
  data: TeamsMeetingArtifactNotificationJobData,
): Promise<void> {
  const eeModule = await loadEeTeamsMeetingArtifactModule();
  if (!eeModule?.resolveTeamsMeetingIdFromNotification) {
    logger.info('[TeamsMeetingArtifacts] Skipping artifact notification outside Enterprise Edition', {
      tenantId: data.tenantId,
    });
    return;
  }

  const providerMeetingId = await eeModule.resolveTeamsMeetingIdFromNotification(data.notification);
  if (!providerMeetingId) {
    logger.warn('[TeamsMeetingArtifacts] Unable to resolve meeting id from artifact notification', {
      tenantId: data.tenantId,
    });
    return;
  }

  const meeting = await OnlineMeetingModel.getByProviderMeetingId(providerMeetingId, data.tenantId);
  if (!meeting || meeting.status === 'cancelled') {
    return;
  }

  await fetchAndPersistMeetingArtifacts({
    tenantId: data.tenantId,
    meetingId: meeting.meeting_id,
  });
}
