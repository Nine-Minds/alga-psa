import logger from '@alga-psa/core/logger';
import { serves } from '@alga-psa/core/capability';
import { getConnection } from '@alga-psa/db';
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
 * Co-managed durable meeting work (appointment creation recovery, calendar sync intents).
 *
 * Isolation contract: the participation verdict is read first (cached, no SQL, no co-managed
 * import); only a served tenant reaches any co-managed SQL, and the co-managed package is loaded
 * lazily here and nowhere at module scope. Any failure (package unresolved, table or columns
 * absent, provider error) is logged and swallowed so the native sweep always runs.
 */
async function reconcileCoManagedMeetings(tenantId: string): Promise<void> {
  try {
    if (!(await serves('co-managed', tenantId)).served) return;

    const [reconciliation, appointments, schedule] = await Promise.all([
      import('@alga-psa/co-managed/meetingReconciliation'),
      import('@alga-psa/scheduling/lib/appointmentMeetingCreation'),
      import('@alga-psa/scheduling/lib/scheduleMeetingSynchronization'),
    ]);
    const db = await getConnection(tenantId);

    const operationIds = await appointments.listDueCoManagedAppointmentMeetingOperations(db, tenantId);
    if (operationIds.length > 0) {
      const provider = await appointments.appointmentMeetingProvider(tenantId);
      const publish = await appointments.appointmentReconciliationPublisher();
      for (const operationId of operationIds) {
        try {
          await reconciliation.recoverCoManagedAppointmentMeeting(db, tenantId, operationId, provider, publish);
        } catch (error) {
          logger.warn('[TeamsMeetingSweep] Co-managed meeting creation recovery failed', {
            tenantId, operationId, error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const syncs = await schedule.listPendingScheduleMeetingSyncs(db, tenantId);
    if (syncs.length > 0) {
      const deliver = await schedule.scheduleMeetingSyncDelivery();
      for (const sync of syncs) {
        try {
          await reconciliation.synchronizeNativeScheduleMeeting(db, { tenant: tenantId, ...sync }, deliver);
        } catch (error) {
          logger.warn('[TeamsMeetingSweep] Co-managed schedule meeting sync failed', {
            tenantId, meetingId: sync.meetingId, error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } catch (error) {
    logger.warn('[TeamsMeetingSweep] Co-managed meeting reconciliation unavailable; native sweep continues', {
      tenantId, error: error instanceof Error ? error.message : String(error),
    });
  }
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
 *
 * A tenant that participates in co-managed work additionally drains its durable
 * meeting-creation operations and calendar-sync intents first (see
 * reconcileCoManagedMeetings). That step never affects the native sweep.
 */
export async function teamsMeetingSweepHandler(data: TeamsMeetingSweepJobData): Promise<void> {
  await reconcileCoManagedMeetings(data.tenantId);
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
