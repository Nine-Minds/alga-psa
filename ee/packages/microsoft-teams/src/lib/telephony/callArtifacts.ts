import logger from '@alga-psa/core/logger';
import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import { getMicrosoftGraphBaseUrl } from '../teams/microsoftEndpoints';
import { resolveTeamsMeetingGraphConfig } from '../meetings/meetingConfig';

/**
 * Teams Phone call recordings and transcripts (F066).
 *
 * Meeting artifacts hang off `/users/{id}/onlineMeetings/{id}`; a Teams Phone
 * call is not a meeting, so its artifacts live on the *ad hoc call* resource
 * (`/users/{id}/adhocCalls/{callId}`) — a different surface with different
 * consent (`CallRecordings.Read.All` / `CallTranscripts.Read.All` plus a Teams
 * application access policy for the user) and no change notification of its
 * own, which is why the caller polls.
 *
 * Recording is a per-policy Teams feature that most tenants leave off, so "no
 * artifacts" is the ordinary answer: a 403/404 from Graph means nothing to
 * capture, not a broken integration, and is reported as an empty result.
 */

export interface TeamsCallArtifact {
  artifactType: 'recording' | 'transcript';
  providerArtifactId: string;
  contentUrl: string | null;
  createdDateTime: string | null;
  transcriptContent?: string;
}

interface GraphArtifactCollection {
  value?: Array<{ id?: unknown; createdDateTime?: unknown }>;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function fetchArtifactCollection(params: {
  accessToken: string;
  url: string;
  tenantId: string;
  kind: 'recordings' | 'transcripts';
}): Promise<GraphArtifactCollection | null> {
  const response = await fetch(params.url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });

  if (response.status === 403 || response.status === 404) {
    logger.info('[Telephony] No call artifacts available from Graph', {
      tenantId: params.tenantId,
      kind: params.kind,
      status: response.status,
      hint: 'Ad hoc call artifacts need CallRecordings.Read.All / CallTranscripts.Read.All admin consent and a Teams application access policy for the user.',
    });
    return null;
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Microsoft Graph call artifact request failed (${response.status}): ${errorBody || response.statusText}`,
    );
  }

  return (await response.json()) as GraphArtifactCollection;
}

async function fetchTranscriptContent(params: { accessToken: string; url: string }): Promise<string> {
  const response = await fetch(params.url, {
    method: 'GET',
    headers: {
      Accept: 'text/vtt',
      Authorization: `Bearer ${params.accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Microsoft Graph call transcript content request failed (${response.status}): ${errorBody || response.statusText}`,
    );
  }

  return await response.text();
}

export async function fetchTeamsCallArtifacts(input: {
  tenantId: string;
  providerCallId: string;
  organizerUserId: string;
}): Promise<TeamsCallArtifact[]> {
  const config = await resolveTeamsMeetingGraphConfig(input.tenantId);
  if (!config) {
    logger.info('[Telephony] Cannot fetch call artifacts: Teams is not configured', {
      tenantId: input.tenantId,
    });
    return [];
  }

  const accessToken = await fetchMicrosoftGraphAppToken({
    tenantAuthority: config.microsoftTenantId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  const userSegment = encodeURIComponent(input.organizerUserId);
  const callSegment = encodeURIComponent(input.providerCallId);
  // The gated base URL is what points at the emulator under TEAMS_EMULATOR_MODE.
  const baseUrl = `${getMicrosoftGraphBaseUrl()}/users/${userSegment}/adhocCalls/${callSegment}`;

  const [recordings, transcripts] = await Promise.all([
    fetchArtifactCollection({ accessToken, url: `${baseUrl}/recordings`, tenantId: input.tenantId, kind: 'recordings' }),
    fetchArtifactCollection({ accessToken, url: `${baseUrl}/transcripts`, tenantId: input.tenantId, kind: 'transcripts' }),
  ]);

  const recordingArtifacts = (recordings?.value ?? [])
    .map((recording): TeamsCallArtifact | null => {
      const providerArtifactId = normalizeString(recording.id);
      if (!providerArtifactId) {
        return null;
      }
      return {
        artifactType: 'recording',
        providerArtifactId,
        // As with meetings: the AMS `recordingContentUrl` does not accept our
        // app bearer token, so address the documented content endpoint.
        contentUrl: `${baseUrl}/recordings/${encodeURIComponent(providerArtifactId)}/content`,
        createdDateTime: normalizeString(recording.createdDateTime) || null,
      };
    })
    .filter((artifact): artifact is TeamsCallArtifact => Boolean(artifact));

  const transcriptArtifacts = await Promise.all((transcripts?.value ?? []).map(
    async (transcript): Promise<TeamsCallArtifact | null> => {
      const providerArtifactId = normalizeString(transcript.id);
      if (!providerArtifactId) {
        return null;
      }
      const contentUrl = `${baseUrl}/transcripts/${encodeURIComponent(providerArtifactId)}/content`;
      return {
        artifactType: 'transcript',
        providerArtifactId,
        contentUrl,
        createdDateTime: normalizeString(transcript.createdDateTime) || null,
        transcriptContent: await fetchTranscriptContent({ accessToken, url: contentUrl }),
      };
    },
  ));

  return [
    ...recordingArtifacts,
    ...transcriptArtifacts.filter((artifact): artifact is TeamsCallArtifact => Boolean(artifact)),
  ];
}

/**
 * Download a call artifact's bytes with an app token. The composition layer
 * hands the buffer to storage; the telephony core never learns about Graph.
 */
export async function downloadTeamsCallArtifactContent(params: {
  tenantId: string;
  contentUrl: string;
}): Promise<{ buffer: Buffer; contentType: string } | null> {
  const config = await resolveTeamsMeetingGraphConfig(params.tenantId);
  if (!config) {
    return null;
  }

  const accessToken = await fetchMicrosoftGraphAppToken({
    tenantAuthority: config.microsoftTenantId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  const response = await fetch(params.contentUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Teams call recording download returned HTTP status ${response.status}`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'video/mp4',
  };
}
