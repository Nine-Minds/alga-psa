import logger from '@alga-psa/core/logger';
import { OnlineMeetingModel } from '@alga-psa/clients/models';

export const TEAMS_MEETING_CLEANUP_JOB = 'teams-meeting-cleanup';

export interface TeamsMeetingCleanupJobData extends Record<string, unknown> {
  tenantId: string;
  /** online_meetings primary key (not the Graph meeting id). */
  meetingId: string;
}

type DeleteTeamsMeetingOutcome =
  | { status: 'deleted'; alreadyDeleted: boolean }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; errorCode: string; errorMessage: string };

type EeTeamsMeetingCleanupModule = {
  deleteTeamsMeetingWithResult: (input: {
    tenantId: string;
    meetingId: string;
    eventId?: string | null;
    appointmentRequestId?: string | null;
  }) => Promise<DeleteTeamsMeetingOutcome>;
};

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

let eeTeamsMeetingCleanupModulePromise: Promise<EeTeamsMeetingCleanupModule | null> | null = null;

async function loadEeTeamsMeetingCleanupModule(): Promise<EeTeamsMeetingCleanupModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeTeamsMeetingCleanupModulePromise) {
    eeTeamsMeetingCleanupModulePromise = import('@alga-psa/ee-microsoft-teams/lib')
      .then((mod) => {
        if (typeof mod?.deleteTeamsMeetingWithResult !== 'function') {
          return null;
        }
        return mod as unknown as EeTeamsMeetingCleanupModule;
      })
      .catch((error) => {
        logger.error('[TeamsMeetingCleanup] Failed to load EE Teams meeting module', { error });
        return null;
      });
  }

  return eeTeamsMeetingCleanupModulePromise;
}

/**
 * Idempotent Graph cleanup for a cancelled/declined meeting. The meeting row
 * stays `cancel_pending` until Graph deletion is confirmed; a 404 from Graph
 * (event already gone) counts as success so retries converge. Transient Graph
 * failures throw so the job runner retries with backoff, and the recurring
 * Teams meeting sweep re-attempts any rows a dead job left behind.
 */
export async function teamsMeetingCleanupHandler(data: TeamsMeetingCleanupJobData): Promise<void> {
  const meeting = await OnlineMeetingModel.getById(data.meetingId, data.tenantId);
  if (!meeting) {
    logger.warn('[TeamsMeetingCleanup] Meeting not found', {
      tenantId: data.tenantId,
      meetingId: data.meetingId,
    });
    return;
  }

  if (meeting.status !== 'cancel_pending') {
    // Already confirmed (or resurrected) — nothing to do.
    return;
  }

  if (meeting.provider !== 'teams' || !meeting.provider_meeting_id) {
    // Rows persisted for failed creations have no Graph event to remove.
    await OnlineMeetingModel.update(meeting.meeting_id, { status: 'cancelled' }, data.tenantId);
    return;
  }

  const eeModule = await loadEeTeamsMeetingCleanupModule();
  if (!eeModule) {
    logger.info('[TeamsMeetingCleanup] Teams meeting delete unavailable outside Enterprise Edition', {
      tenantId: data.tenantId,
      meetingId: data.meetingId,
    });
    await OnlineMeetingModel.update(
      meeting.meeting_id,
      { status: 'cancelled', error_code: 'cleanup_unavailable' },
      data.tenantId,
    );
    return;
  }

  const outcome = await eeModule.deleteTeamsMeetingWithResult({
    tenantId: data.tenantId,
    meetingId: meeting.provider_meeting_id,
    eventId: meeting.provider_event_id ?? null,
    appointmentRequestId: meeting.appointment_request_id ?? null,
  });

  if (outcome.status === 'deleted') {
    await OnlineMeetingModel.update(
      meeting.meeting_id,
      { status: 'cancelled', error_code: null },
      data.tenantId,
    );
    return;
  }

  if (outcome.status === 'skipped') {
    // Tenant unconfigured / add-on inactive: Graph is unreachable for this
    // tenant, so retrying cannot help. Confirm the local cancellation and
    // record why the remote cleanup was skipped.
    await OnlineMeetingModel.update(
      meeting.meeting_id,
      { status: 'cancelled', error_code: `cleanup_skipped_${outcome.reason}` },
      data.tenantId,
    );
    return;
  }

  await OnlineMeetingModel.update(
    meeting.meeting_id,
    { error_code: outcome.errorCode },
    data.tenantId,
  );
  throw new Error(
    `Teams meeting cleanup failed (${outcome.errorCode}): ${outcome.errorMessage}`,
  );
}
