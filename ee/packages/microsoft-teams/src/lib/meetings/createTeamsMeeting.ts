import logger from '@alga-psa/core/logger';
import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import { getMicrosoftGraphBaseUrl } from '../teams/microsoftEndpoints';
import {
  resolveTeamsMeetingConfigState,
  type TeamsMeetingConfigSkipReason,
} from './meetingConfig';
import { renewTeamsMeetingArtifactSubscriptions } from './artifactSubscriptions';
import { assertTeamsMeetingCreationIdentity, findTeamsCreationEvent, resolveOnlineMeetingIdFromJoinUrl, teamsEventReceipt, TEAMS_CREATION_OPERATION_PROPERTY, type TeamsMeetingCreationIdentity, type CreatedTeamsEventReceipt } from './meetingCreationRecovery';

export interface CreateTeamsMeetingInput {
  tenantId: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
  attendees?: TeamsMeetingAttendee[];
  /** Optional HTML body carried onto the Graph event (appointment context + PSA link). */
  bodyHtml?: string | null;
  appointmentRequestId?: string | null;
  /** Supplied only from a durable, admitted creation operation. */
  creationIdentity?: TeamsMeetingCreationIdentity;
}

export interface CreateTeamsMeetingResult {
  joinWebUrl: string;
  meetingId: string;
  organizerUpn: string;
  organizerUserId: string;
  eventId: string;
}

export interface TeamsMeetingAttendee {
  emailAddress: {
    address: string;
    name?: string;
  };
  type?: 'required' | 'optional' | 'resource';
}

export type CreateTeamsMeetingOutcome =
  | { status: 'created'; meeting: CreateTeamsMeetingResult }
  | { status: 'skipped'; reason: TeamsMeetingConfigSkipReason }
  | { status: 'failed'; errorCode: string; errorMessage: string; createdEvent?: CreatedTeamsEventReceipt };

interface GraphEventResponse {
  id?: unknown;
  onlineMeeting?: {
    joinUrl?: unknown;
  } | null;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || 'Unknown error';
  }

  return String(error || 'Unknown error');
}

export function mapGraphStatusToMeetingErrorCode(status: number): string {
  if (status === 401 || status === 403) return 'graph_unauthorized';
  if (status === 404) return 'graph_not_found';
  if (status === 429) return 'graph_throttled';
  if (status >= 500 && status <= 599) return 'graph_server_error';
  return 'graph_error';
}

/**
 * Best-effort artifact subscription ensure at meeting-creation time so a
 * tenant whose 30-minute renewal schedule has not run yet (or is broken)
 * still captures recordings for meetings created right now. Skips quickly
 * when subscriptions are already active (renewal helper checks expiry).
 */
function ensureArtifactSubscriptionsInBackground(tenantId: string): void {
  void renewTeamsMeetingArtifactSubscriptions({ tenantId }).catch((error) => {
    logger.warn('[TeamsMeetings] Failed to ensure artifact subscriptions after meeting creation', {
      tenant: tenantId,
      error: normalizeErrorMessage(error),
    });
  });
}

export async function createTeamsMeetingWithResult(
  input: CreateTeamsMeetingInput
): Promise<CreateTeamsMeetingOutcome> {
  let createdEvent: CreatedTeamsEventReceipt | undefined;
  try {
    if (input.creationIdentity) assertTeamsMeetingCreationIdentity(input.creationIdentity);
    const configState = await resolveTeamsMeetingConfigState(input.tenantId);
    if (configState.status !== 'ready') {
      logger.warn('[TeamsMeetings] Unable to create Teams meeting because the tenant is not ready', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'create',
        reason: configState.reason,
      });
      return { status: 'skipped', reason: configState.reason };
    }
    const config = configState.config;
    const identity = input.creationIdentity;
    if (identity && (config.microsoftTenantId.toLowerCase() !== identity.target.microsoftTenantId.toLowerCase() ||
      config.organizerUserId.toLowerCase() !== identity.target.organizerUserId.toLowerCase() || config.sendMeetingInvites !== identity.target.sendMeetingInvites)) {
      return { status: 'failed', errorCode: 'creation_target_changed', errorMessage: 'The Teams organizer or invitation configuration changed. Start a new authorized operation after recovery.' };
    }
    const organizer = identity?.target.organizerUserId ?? config.organizerUpn;

    const accessToken = await fetchMicrosoftGraphAppToken({
      tenantAuthority: config.microsoftTenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    // Attendees drive native calendar invites; when the tenant has turned
    // invites off, create the event without attendees (legacy behavior).
    const attendees = config.sendMeetingInvites ? input.attendees ?? [] : [];
    const bodyHtml = normalizeString(input.bodyHtml);

    const recovered = identity ? await findTeamsCreationEvent(accessToken, identity) : null;
    const response = recovered ? null : await fetch(
      `${getMicrosoftGraphBaseUrl()}/users/${encodeURIComponent(organizer)}/events`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          ...(identity ? { transactionId: identity.operationId, singleValueExtendedProperties: [{ id: TEAMS_CREATION_OPERATION_PROPERTY, value: identity.operationId }] } : {}),
          subject: input.subject,
          start: {
            dateTime: input.startDateTime,
            timeZone: 'UTC',
          },
          end: {
            dateTime: input.endDateTime,
            timeZone: 'UTC',
          },
          isOnlineMeeting: true,
          onlineMeetingProvider: 'teamsForBusiness',
          ...(bodyHtml ? { body: { contentType: 'html', content: bodyHtml } } : {}),
          ...(attendees.length ? { attendees } : {}),
        }),
      }
    );

    if (response && !response.ok) {
      const errorBody = await response.text();
      const errorMessage = `Failed to create Teams meeting (${response.status}): ${errorBody || response.statusText}`;
      logger.warn('[TeamsMeetings] Failed to create Teams meeting', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'create',
        status: response.status,
        graph_error: errorBody || response.statusText,
      });
      return {
        status: 'failed',
        errorCode: mapGraphStatusToMeetingErrorCode(response.status),
        errorMessage,
      };
    }

    const payload = recovered ?? (await response!.json()) as GraphEventResponse;
    if (identity) createdEvent = teamsEventReceipt(payload, identity.target);
    const eventId = normalizeString(payload.id);
    const joinWebUrl = normalizeString(payload.onlineMeeting?.joinUrl);

    if (!joinWebUrl || !eventId) {
      logger.warn('[TeamsMeetings] Graph create response was missing meeting fields', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'create',
        status: response?.status ?? 200,
        graph_response: payload,
      });
      return {
        status: 'failed',
        ...(createdEvent ? { createdEvent } : {}),
        errorCode: 'graph_missing_meeting_fields',
        errorMessage: 'Microsoft Graph created the event but did not return an online meeting join URL.',
      };
    }

    const meetingId = await resolveOnlineMeetingIdFromJoinUrl({
      accessToken,
      organizerUpn: organizer,
      joinWebUrl,
    });

    logger.info('[TeamsMeetings] Created Teams meeting', {
      tenant: input.tenantId,
      appointment_request_id: input.appointmentRequestId ?? null,
      operation: 'create',
      status: response?.status ?? 200,
      meeting_id: meetingId,
      event_id: eventId,
      attendee_count: attendees.length,
    });

    ensureArtifactSubscriptionsInBackground(input.tenantId);

    return {
      status: 'created',
      meeting: {
        joinWebUrl,
        meetingId,
        organizerUpn: identity?.target.organizerUpn ?? config.organizerUpn,
        organizerUserId: identity?.target.organizerUserId ?? config.organizerUserId,
        eventId,
      },
    };
  } catch (error) {
    const errorMessage = normalizeErrorMessage(error);
    logger.warn('[TeamsMeetings] Failed to create Teams meeting', {
      tenant: input.tenantId,
      appointment_request_id: input.appointmentRequestId ?? null,
      operation: 'create',
      status: null,
      error: errorMessage,
    });
    return { status: 'failed', errorCode: 'exception', errorMessage, ...(createdEvent ? { createdEvent } : {}) };
  }
}

export async function createTeamsMeeting(
  input: CreateTeamsMeetingInput
): Promise<CreateTeamsMeetingResult | null> {
  const outcome = await createTeamsMeetingWithResult(input);
  return outcome.status === 'created' ? outcome.meeting : null;
}
