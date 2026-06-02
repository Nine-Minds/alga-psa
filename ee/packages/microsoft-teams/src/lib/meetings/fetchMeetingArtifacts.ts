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

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || 'Unknown error';
  }

  return String(error || 'Unknown error');
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
  try {
    const config = await resolveTeamsMeetingExecutionConfig(input.tenantId);
    if (!config) {
      logger.warn('[TeamsMeetings] Unable to fetch Teams meeting artifacts because the tenant is not ready', {
        tenant: input.tenantId,
        operation: 'fetch_artifacts',
        meeting_id: input.meetingId,
        status: null,
      });
      return [];
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

        return {
          artifactType: 'recording',
          providerArtifactId,
          contentUrl: normalizeString(recording.contentUrl) || null,
          createdDateTime: normalizeString(recording.createdDateTime) || null,
        };
      })
      .filter((artifact): artifact is TeamsMeetingArtifact => Boolean(artifact));

    const transcriptArtifacts = await Promise.all((transcripts.value ?? []).map(async (transcript): Promise<TeamsMeetingArtifact | null> => {
      const providerArtifactId = normalizeString(transcript.id);
      if (!providerArtifactId) {
        return null;
      }

      const transcriptContent = await fetchTranscriptContent({
        accessToken,
        url: `${baseUrl}/transcripts/${encodeURIComponent(providerArtifactId)}/content`,
      });

      return {
        artifactType: 'transcript' as const,
        providerArtifactId,
        contentUrl: normalizeString(transcript.contentUrl) || null,
        createdDateTime: normalizeString(transcript.createdDateTime) || null,
        transcriptContent,
      };
    }));

    return [
      ...recordingArtifacts,
      ...transcriptArtifacts.filter((artifact): artifact is TeamsMeetingArtifact => Boolean(artifact)),
    ];
  } catch (error) {
    logger.warn('[TeamsMeetings] Failed to fetch Teams meeting artifacts', {
      tenant: input.tenantId,
      operation: 'fetch_artifacts',
      meeting_id: input.meetingId,
      status: null,
      error: normalizeErrorMessage(error),
    });
    return [];
  }
}
