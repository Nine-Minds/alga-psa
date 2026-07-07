import logger from '@alga-psa/core/logger';
import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import { resolveTeamsMeetingExecutionConfig } from './meetingConfig';

export interface FetchMeetingArtifactsInput {
  tenantId: string;
  meetingId: string;
  organizerUserId: string;
}

export interface TeamsMeetingArtifact {
  artifactType: 'recording' | 'transcript';
  providerArtifactId: string;
  contentUrl: string | null;
  createdDateTime: string | null;
  transcriptContent?: string;
}

interface GraphArtifactCollection {
  value?: Array<{
    id?: unknown;
    contentUrl?: unknown;
    createdDateTime?: unknown;
  }>;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function fetchJsonCollection(params: {
  accessToken: string;
  url: string;
}): Promise<GraphArtifactCollection> {
  const response = await fetch(params.url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Microsoft Graph artifact request failed (${response.status}): ${errorBody || response.statusText}`);
  }

  return (await response.json()) as GraphArtifactCollection;
}

async function fetchTranscriptContent(params: {
  accessToken: string;
  url: string;
}): Promise<string> {
  const response = await fetch(params.url, {
    method: 'GET',
    headers: {
      Accept: 'text/vtt',
      Authorization: `Bearer ${params.accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Microsoft Graph transcript content request failed (${response.status}): ${errorBody || response.statusText}`);
  }

  return await response.text();
}

export async function fetchMeetingArtifacts(
  input: FetchMeetingArtifactsInput
): Promise<TeamsMeetingArtifact[]> {
  // NOTE: this function throws on any fetch/token/Graph failure. The caller relies
  // on that to distinguish a genuine "no artifacts yet" empty result (returned here)
  // from a transient failure (thrown) — so a temporary Graph error never ages a real
  // recording into the terminal `no_recording` state via the retry-attempt counter.
  const config = await resolveTeamsMeetingExecutionConfig(input.tenantId);
  if (!config) {
    logger.warn('[TeamsMeetings] Cannot fetch Teams meeting artifacts because the tenant is not ready', {
      tenant: input.tenantId,
      operation: 'fetch_artifacts',
      meeting_id: input.meetingId,
    });
    throw new Error(`Teams meeting artifacts unavailable: tenant ${input.tenantId} is not configured for meetings.`);
  }

  const accessToken = await fetchMicrosoftGraphAppToken({
    tenantAuthority: config.microsoftTenantId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  const organizerSegment = encodeURIComponent(input.organizerUserId);
  const meetingSegment = encodeURIComponent(input.meetingId);
  const baseUrl = `https://graph.microsoft.com/v1.0/users/${organizerSegment}/onlineMeetings/${meetingSegment}`;

  const [recordings, transcripts] = await Promise.all([
    fetchJsonCollection({ accessToken, url: `${baseUrl}/recordings` }),
    fetchJsonCollection({ accessToken, url: `${baseUrl}/transcripts` }),
  ]);

  const recordingArtifacts = (recordings.value ?? [])
    .map((recording): TeamsMeetingArtifact | null => {
      const providerArtifactId = normalizeString(recording.id);
      if (!providerArtifactId) {
        return null;
      }

      // The recordings list resource does NOT expose a `contentUrl`; Graph's
      // `callRecording` uses `recordingContentUrl`, which is an AMS URL that
      // does not accept our app bearer token. Address the documented, bearer-
      // token-friendly content endpoint directly (parallel to transcripts) so
      // both the download proxy and the store-to-disk path can retrieve it.
      return {
        artifactType: 'recording',
        providerArtifactId,
        contentUrl: `${baseUrl}/recordings/${encodeURIComponent(providerArtifactId)}/content`,
        createdDateTime: normalizeString(recording.createdDateTime) || null,
      };
    })
    .filter((artifact): artifact is TeamsMeetingArtifact => Boolean(artifact));

  const transcriptArtifacts = await Promise.all((transcripts.value ?? []).map(async (transcript): Promise<TeamsMeetingArtifact | null> => {
    const providerArtifactId = normalizeString(transcript.id);
    if (!providerArtifactId) {
      return null;
    }

    const contentUrl = `${baseUrl}/transcripts/${encodeURIComponent(providerArtifactId)}/content`;
    const transcriptContent = await fetchTranscriptContent({
      accessToken,
      url: contentUrl,
    });

    return {
      artifactType: 'transcript' as const,
      providerArtifactId,
      // Same fix for symmetry: Graph exposes `transcriptContentUrl`, not
      // `contentUrl`; point at the content endpoint we already fetch.
      contentUrl,
      createdDateTime: normalizeString(transcript.createdDateTime) || null,
      transcriptContent,
    };
  }));

  return [
    ...recordingArtifacts,
    ...transcriptArtifacts.filter((artifact): artifact is TeamsMeetingArtifact => Boolean(artifact)),
  ];
}
