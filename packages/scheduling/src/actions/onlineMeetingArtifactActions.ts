'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { StorageService } from '@alga-psa/storage/StorageService';
import { isEnterprise } from '@alga-psa/core/features';
import logger from '@alga-psa/core/logger';
import type { IOnlineMeeting } from '@alga-psa/types';

// The artifact-capture orchestrator lives in @alga-psa/clients but must not depend on the
// EE Teams package (that would close a clients -> ee-microsoft-teams cycle). The composition
// layer wires Microsoft Graph access here instead: scheduling may import EE (non-vertical),
// and reaches clients via dynamic import (the sanctioned cross-vertical idiom).
type CaptureModule = typeof import('@alga-psa/clients/lib/onlineMeetingArtifactCapture');
type CaptureDeps = NonNullable<Parameters<CaptureModule['fetchAndPersistMeetingArtifacts']>[1]>;

interface EeTeamsArtifactModule {
  fetchMeetingArtifacts?: CaptureDeps['fetchArtifacts'];
  resolveTeamsMeetingGraphConfig?: (tenantId: string) => Promise<{
    clientId: string;
    clientSecret: string;
    microsoftTenantId: string;
  } | null>;
  fetchMicrosoftGraphAppToken?: (input: {
    tenantAuthority: string;
    clientId: string;
    clientSecret: string;
  }) => Promise<string>;
}

async function loadEeTeamsModule(): Promise<EeTeamsArtifactModule> {
  if (!isEnterprise) {
    return {};
  }
  try {
    return (await import('@alga-psa/ee-microsoft-teams/lib')) as EeTeamsArtifactModule;
  } catch (error) {
    logger.warn('[OnlineMeetingArtifacts] EE Teams module unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/**
 * Graph-backed capture dependencies injected into the clients-layer orchestrator. Keeping
 * the EE wiring here is what breaks the clients -> ee-microsoft-teams dependency.
 */
export async function buildTeamsArtifactCaptureDeps(): Promise<CaptureDeps> {
  const ee = await loadEeTeamsModule();

  const fetchArtifacts: CaptureDeps['fetchArtifacts'] = async (input) =>
    (ee.fetchMeetingArtifacts ? ee.fetchMeetingArtifacts(input) : []);

  const downloadRecording: CaptureDeps['downloadRecording'] = async (input) => {
    if (!input.artifact.contentUrl) {
      return null;
    }
    if (!ee.resolveTeamsMeetingGraphConfig || !ee.fetchMicrosoftGraphAppToken) {
      return null;
    }
    const config = await ee.resolveTeamsMeetingGraphConfig(input.tenantId);
    if (!config) {
      return null;
    }
    const accessToken = await ee.fetchMicrosoftGraphAppToken({
      tenantAuthority: config.microsoftTenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    const response = await fetch(input.artifact.contentUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Failed to download Teams recording (${response.status})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const file = await StorageService.uploadFile(
      input.tenantId,
      buffer,
      `${input.meeting.subject || 'teams-meeting'}-${input.artifact.providerArtifactId}.mp4`,
      {
        mime_type: response.headers.get('content-type') || 'video/mp4',
        uploaded_by_id: input.actorUserId,
        metadata: {
          source: 'teams_online_meeting_recording',
          meeting_id: input.meeting.meeting_id,
          provider_artifact_id: input.artifact.providerArtifactId,
        },
      },
    );
    return file.file_id;
  };

  return { fetchArtifacts, downloadRecording };
}

/**
 * Manual "Refresh recordings" — pulls the latest Teams artifacts for a meeting and persists
 * them. Hosted in the composition-facing scheduling layer (not clients) so it can supply the
 * EE Graph dependencies; exposed to the clients UI via the cross-feature context.
 */
export const refreshMeetingRecordings = withAuth(async (
  user,
  { tenant },
  meetingId: string,
): Promise<IOnlineMeeting> => {
  if (!meetingId) {
    throw new Error('Meeting ID is required');
  }
  if (!(await hasPermission(user, 'interaction', 'update'))) {
    throw new Error('Forbidden');
  }

  const { fetchAndPersistMeetingArtifacts } = await import('@alga-psa/clients/lib/onlineMeetingArtifactCapture');
  const deps = await buildTeamsArtifactCaptureDeps();
  return fetchAndPersistMeetingArtifacts(
    { tenantId: tenant, meetingId, actorUserId: user.user_id },
    deps,
  );
});
