import logger from '@alga-psa/core/logger';
import { OnlineMeetingModel } from '@alga-psa/clients/models';
import {
  fetchAndPersistMeetingArtifacts,
  isRecordingFetchDue,
} from '@alga-psa/clients/lib/onlineMeetingArtifactCapture';
import { buildTeamsArtifactCaptureDeps } from '@alga-psa/scheduling/actions';
import { teamsMeetingCleanupHandler } from './teamsMeetingCleanupHandler';

export const TEAMS_MEETING_SWEEP_JOB = 'sweep-teams-online-meetings';

export interface TeamsMeetingSweepJobData extends Record<string, unknown> {
  tenantId: string;
}

type EeTeamsMeetingConfigModule = {
  resolveTeamsMeetingGraphConfig: (tenantId: string) => Promise<unknown | null>;
};

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

let eeTeamsMeetingConfigModulePromise: Promise<EeTeamsMeetingConfigModule | null> | null = null;

async function loadEeTeamsMeetingConfigModule(): Promise<EeTeamsMeetingConfigModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeTeamsMeetingConfigModulePromise) {
    eeTeamsMeetingConfigModulePromise = import('@alga-psa/ee-microsoft-teams/lib')
      .then((mod) => {
        if (typeof mod?.resolveTeamsMeetingGraphConfig !== 'function') {
          return null;
        }
        return mod as unknown as EeTeamsMeetingConfigModule;
      })
      .catch((error) => {
        logger.error('[TeamsMeetingSweep] Failed to load EE Teams meeting module', { error });
        return null;
      });
  }

  return eeTeamsMeetingConfigModulePromise;
}

/**
 * Recurring per-tenant sweep that makes recording capture and meeting cleanup
 * independent of Graph webhooks:
 *
 * 1. Polling fallback (F028): fetch artifacts for ended meetings still in
 *    recording_pending/ended/scheduled state, paced by the bounded backoff
 *    schedule, so a lost webhook never loses a recording.
 * 2. Cleanup retry: re-attempt Graph deletion for cancel_pending meetings a
 *    dead one-off cleanup job left behind.
 *
 * Skips entirely when the tenant has no ready Teams Graph config (add-on
 * inactive / not configured) — the config resolver performs those gates.
 */
export async function teamsMeetingSweepHandler(data: TeamsMeetingSweepJobData): Promise<void> {
  const eeModule = await loadEeTeamsMeetingConfigModule();
  if (!eeModule) {
    return;
  }

  const config = await eeModule.resolveTeamsMeetingGraphConfig(data.tenantId);
  if (!config) {
    logger.info('[TeamsMeetingSweep] Skipping sweep — Teams is not available for tenant', {
      tenantId: data.tenantId,
    });
    return;
  }

  const now = new Date();
  const pendingRecordings = await OnlineMeetingModel.listPendingRecordings(data.tenantId);
  const dueMeetings = pendingRecordings.filter((meeting) => isRecordingFetchDue(meeting, now));

  if (dueMeetings.length > 0) {
    const captureDeps = await buildTeamsArtifactCaptureDeps();
    for (const meeting of dueMeetings) {
      try {
        await fetchAndPersistMeetingArtifacts(
          { tenantId: data.tenantId, meetingId: meeting.meeting_id },
          captureDeps,
        );
      } catch (error) {
        logger.warn('[TeamsMeetingSweep] Failed to fetch artifacts for meeting', {
          tenantId: data.tenantId,
          meetingId: meeting.meeting_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const pendingCleanup = await OnlineMeetingModel.listPendingCleanup(data.tenantId);
  for (const meeting of pendingCleanup) {
    try {
      await teamsMeetingCleanupHandler({ tenantId: data.tenantId, meetingId: meeting.meeting_id });
    } catch (error) {
      logger.warn('[TeamsMeetingSweep] Cleanup retry failed for meeting', {
        tenantId: data.tenantId,
        meetingId: meeting.meeting_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
