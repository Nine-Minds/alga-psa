import { toDigits } from '@alga-psa/telephony';
import type { CallArtifactPayload } from '@alga-psa/telephony/types';
import { createThreecxPbxClient, odataValues, type CreateThreecxPbxClientOptions, type ThreecxPbxClient } from './pbx/client';
import { getThreecxProviderConfig } from './providerState';

/** The subset of the XAPI Recordings entity the artifact sweep reads. */
export interface ThreecxRecording {
  Id: number;
  StartTime?: string | null;
  EndTime?: string | null;
  FromCallerNumber?: string | null;
  ToCallerNumber?: string | null;
  FromDisplayName?: string | null;
  ToDisplayName?: string | null;
  IsTranscribed?: boolean | null;
  Transcription?: string | null;
  Summary?: string | null;
  RecordingUrl?: string | null;
}

export type ThreecxRecordingLookup =
  /** The tenant has not enabled the XAPI: there is nothing to ask. */
  | { status: 'unsupported' }
  | { status: 'none' }
  | { status: 'found'; recording: ThreecxRecording };

export interface FindThreecxRecordingInput {
  tenantId: string;
  startedAt: string | Date | null | undefined;
  /** The counterparty's number, any format; compared on digits. */
  externalNumber: string | null | undefined;
  knex?: any;
  client?: ThreecxPbxClient;
  clientOptions?: CreateThreecxPbxClientOptions;
}

/** StartTime window either side of the call's start; PBX and CDR clocks drift. */
export const THREECX_RECORDING_WINDOW_MS = 2 * 60 * 1000;
const MIN_MATCH_DIGITS = 7;

function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Two numbers agree when one's digits end with the other's (national vs E.164). */
export function threecxNumbersMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = toDigits(left);
  const b = toDigits(right);
  if (a.length < MIN_MATCH_DIGITS || b.length < MIN_MATCH_DIGITS) return a !== '' && a === b;
  return a.endsWith(b) || b.endsWith(a);
}

export function threecxRecordingsFilter(startedAt: Date): string {
  const from = new Date(startedAt.getTime() - THREECX_RECORDING_WINDOW_MS);
  const to = new Date(startedAt.getTime() + THREECX_RECORDING_WINDOW_MS);
  return `StartTime ge ${isoSeconds(from)} and StartTime le ${isoSeconds(to)}`;
}

/** The recording whose caller/callee is the call's external party, if any. */
export function pickThreecxRecording(
  recordings: ThreecxRecording[],
  externalNumber: string | null | undefined,
): ThreecxRecording | null {
  if (!toDigits(externalNumber)) return null;
  return recordings.find(
    (recording) => threecxNumbersMatch(recording.FromCallerNumber, externalNumber)
      || threecxNumbersMatch(recording.ToCallerNumber, externalNumber),
  ) ?? null;
}

/**
 * Locate the PBX recording for one call: `GET /xapi/v1/Recordings` filtered
 * to two minutes around the call's start, then matched on the external
 * number. Requires the tenant to have enabled the XAPI capability.
 */
export async function findThreecxRecordingForCall(input: FindThreecxRecordingInput): Promise<ThreecxRecordingLookup> {
  const provider = await getThreecxProviderConfig(input.tenantId, input.knex);
  if (!provider?.config.pbx.capabilities.xapi) {
    return { status: 'unsupported' };
  }

  const startedAt = input.startedAt ? new Date(input.startedAt) : null;
  if (!startedAt || Number.isNaN(startedAt.getTime())) {
    return { status: 'none' };
  }

  const client = input.client ?? (await createThreecxPbxClient(input.tenantId, input.clientOptions));
  const payload = await client.xapiGet('/Recordings', {
    $filter: threecxRecordingsFilter(startedAt),
    $top: 100,
  });
  const recording = pickThreecxRecording(odataValues<ThreecxRecording>(payload), input.externalNumber);
  return recording ? { status: 'found', recording } : { status: 'none' };
}

export function threecxRecordingMimeType(recordingUrl: string | null | undefined): 'audio/wav' | 'audio/mpeg' {
  return /\.mp3(?:$|[?#])/i.test(recordingUrl ?? '') ? 'audio/mpeg' : 'audio/wav';
}

export function threecxRecordingFileExtension(recordingUrl: string | null | undefined): 'wav' | 'mp3' {
  return threecxRecordingMimeType(recordingUrl) === 'audio/mpeg' ? 'mp3' : 'wav';
}

/** Raw audio bytes via `GET /xapi/v1/Recordings/Pbx.DownloadRecording(recId=<Id>)`. */
export async function downloadThreecxRecording(
  tenantId: string,
  recordingId: number | string,
  options: { client?: ThreecxPbxClient; clientOptions?: CreateThreecxPbxClientOptions } = {},
): Promise<Uint8Array> {
  const client = options.client ?? (await createThreecxPbxClient(tenantId, options.clientOptions));
  const recId = Number(recordingId);
  if (!Number.isInteger(recId)) {
    throw new Error(`Invalid 3CX recording id: ${String(recordingId)}`);
  }
  return client.xapiDownload(`/Recordings/Pbx.DownloadRecording(recId=${recId})`);
}

/**
 * The vendor-neutral artifacts a recording yields: a transcript once the PBX
 * has transcribed it, a recording pointer when the audio is downloadable.
 */
export function threecxRecordingToCallArtifacts(recording: ThreecxRecording): CallArtifactPayload[] {
  const artifacts: CallArtifactPayload[] = [];
  const providerArtifactId = String(recording.Id);
  const createdDateTime = recording.StartTime ?? null;
  const transcription = (recording.Transcription ?? '').trim();

  if (recording.IsTranscribed === true && transcription) {
    artifacts.push({
      artifactType: 'transcript',
      providerArtifactId,
      contentUrl: null,
      createdDateTime,
      transcriptContent: transcription,
      summary: recording.Summary ?? null,
    });
  }

  if (recording.RecordingUrl) {
    artifacts.push({
      artifactType: 'recording',
      providerArtifactId,
      contentUrl: recording.RecordingUrl,
      createdDateTime,
    });
  }

  return artifacts;
}

/** Whether the PBX is done with this recording (nothing more will appear later). */
export function isThreecxRecordingComplete(recording: ThreecxRecording): boolean {
  return recording.IsTranscribed === true;
}
