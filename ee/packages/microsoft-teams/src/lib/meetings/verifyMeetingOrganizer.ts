import logger from '@alga-psa/core/logger';
import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import { resolveTeamsMeetingGraphConfig } from './meetingConfig';

export interface VerifyMeetingOrganizerInput {
  tenantId: string;
  organizerUpn: string;
}

export interface VerifyMeetingOrganizerResult {
  valid: boolean;
  displayName?: string;
  reason?: 'not_configured' | 'user_not_found' | 'policy_missing' | 'graph_error';
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

function inferPolicyMissingReason(status: number, errorBody: string): boolean {
  if (status !== 403) {
    return false;
  }

  const normalizedBody = errorBody.toLowerCase();
  return normalizedBody.includes('application access policy') || normalizedBody.includes('policy');
}

export async function verifyMeetingOrganizer(
  input: VerifyMeetingOrganizerInput
): Promise<VerifyMeetingOrganizerResult> {
  const organizerUpn = normalizeString(input.organizerUpn);
  if (!organizerUpn) {
    return { valid: false, reason: 'user_not_found' };
  }

  try {
    const config = await resolveTeamsMeetingGraphConfig(input.tenantId);
    if (!config) {
      return { valid: false, reason: 'not_configured' };
    }

    const accessToken = await fetchMicrosoftGraphAppToken({
      tenantAuthority: config.microsoftTenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    const userResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organizerUpn)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!userResponse.ok) {
      const errorBody = await userResponse.text();
      logger.warn('[TeamsMeetings] Failed to verify meeting organizer user lookup', {
        tenant: input.tenantId,
        operation: 'verify',
        status: userResponse.status,
        organizer_upn: organizerUpn,
        graph_error: errorBody || userResponse.statusText,
      });
      return {
        valid: false,
        reason: userResponse.status === 404 ? 'user_not_found' : 'graph_error',
      };
    }

    const userPayload = (await userResponse.json()) as { displayName?: unknown };
    const displayName = normalizeString(userPayload.displayName);

    const startDateTime = new Date(Date.now() + 5 * 60 * 1000);
    const endDateTime = new Date(startDateTime.getTime() + 15 * 60 * 1000);

    const createResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organizerUpn)}/onlineMeetings`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          subject: 'Alga PSA meeting organizer verification',
          startDateTime: startDateTime.toISOString(),
          endDateTime: endDateTime.toISOString(),
        }),
      }
    );

    if (!createResponse.ok) {
      const errorBody = await createResponse.text();
      const policyMissing = inferPolicyMissingReason(createResponse.status, errorBody);
      logger.warn('[TeamsMeetings] Failed to verify meeting organizer policy access', {
        tenant: input.tenantId,
        operation: 'verify',
        status: createResponse.status,
        organizer_upn: organizerUpn,
        graph_error: errorBody || createResponse.statusText,
      });
      return {
        valid: false,
        displayName: displayName || undefined,
        reason: policyMissing ? 'policy_missing' : 'graph_error',
      };
    }

    const createdMeeting = (await createResponse.json()) as { id?: unknown };
    const meetingId = normalizeString(createdMeeting.id);
    if (meetingId) {
      await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organizerUpn)}/onlineMeetings/${encodeURIComponent(meetingId)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      ).catch((error) => {
        logger.warn('[TeamsMeetings] Failed to delete verification meeting', {
          tenant: input.tenantId,
          operation: 'verify',
          organizer_upn: organizerUpn,
          meeting_id: meetingId,
          error: normalizeErrorMessage(error),
        });
      });
    }

    return {
      valid: true,
      displayName: displayName || undefined,
    };
  } catch (error) {
    logger.warn('[TeamsMeetings] Failed to verify meeting organizer', {
      tenant: input.tenantId,
      operation: 'verify',
      organizer_upn: organizerUpn,
      error: normalizeErrorMessage(error),
    });
    return {
      valid: false,
      reason: 'graph_error',
    };
  }
}
