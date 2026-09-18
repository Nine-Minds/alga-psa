import logger from '@alga-psa/core/logger';
import { createTenantKnex, runWithTenant, tenantDb } from '@alga-psa/db';
import type {
  CallArtifactCaptureSettings,
  CallArtifactProviderFetcher,
  CaptureCallArtifactsDependencies,
} from '@alga-psa/telephony';
import type { CallArtifactPayload, TelephonyCallRecordRow } from '@alga-psa/telephony/types';

export const TELEPHONY_CALL_ARTIFACT_SWEEP_JOB = 'sweep-telephony-call-artifacts';

export interface TelephonyCallArtifactSweepJobData extends Record<string, unknown> {
  tenantId: string;
}

type EeCallArtifactModule = {
  fetchTeamsCallArtifacts: NonNullable<CaptureCallArtifactsDependencies['fetchArtifacts']>;
  downloadTeamsCallArtifactContent: (params: {
    tenantId: string;
    contentUrl: string;
  }) => Promise<{ buffer: Buffer; contentType: string } | null>;
  annotateLinkedTicketFromTranscript?: (input: Record<string, unknown>) => Promise<unknown>;
};

type ThreecxRecordingLike = { Id: number; RecordingUrl?: string | null };

type EeThreecxRecordingModule = {
  findThreecxRecordingForCall: (input: {
    tenantId: string;
    startedAt: string | Date | null | undefined;
    externalNumber: string | null | undefined;
  }) => Promise<
    | { status: 'unsupported' }
    | { status: 'none' }
    | { status: 'found'; recording: ThreecxRecordingLike }
  >;
  downloadThreecxRecording: (tenantId: string, recordingId: number | string) => Promise<Uint8Array>;
  threecxRecordingToCallArtifacts: (recording: ThreecxRecordingLike) => CallArtifactPayload[];
  isThreecxRecordingComplete: (recording: ThreecxRecordingLike) => boolean;
  threecxRecordingMimeType: (url: string | null | undefined) => string;
  threecxRecordingFileExtension: (url: string | null | undefined) => string;
};

const THREECX_PROVIDER = '3cx';

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

let eeCallArtifactModulePromise: Promise<EeCallArtifactModule | null> | null = null;
let eeThreecxModulePromise: Promise<EeThreecxRecordingModule | null> | null = null;

async function loadEeCallArtifactModule(): Promise<EeCallArtifactModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeCallArtifactModulePromise) {
    eeCallArtifactModulePromise = import('@alga-psa/ee-microsoft-teams/lib')
      .then((mod) => {
        if (
          typeof mod?.fetchTeamsCallArtifacts !== 'function' ||
          typeof mod?.downloadTeamsCallArtifactContent !== 'function'
        ) {
          return null;
        }
        return mod as unknown as EeCallArtifactModule;
      })
      .catch((error) => {
        logger.error('[Telephony] Failed to load the EE Teams call artifact module', { error });
        return null;
      });
  }

  return eeCallArtifactModulePromise;
}

async function loadEeThreecxModule(): Promise<EeThreecxRecordingModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeThreecxModulePromise) {
    eeThreecxModulePromise = import('@alga-psa/ee-threecx/lib')
      .then((mod) => {
        if (
          typeof mod?.findThreecxRecordingForCall !== 'function' ||
          typeof mod?.downloadThreecxRecording !== 'function'
        ) {
          return null;
        }
        return mod as unknown as EeThreecxRecordingModule;
      })
      .catch((error) => {
        logger.error('[Telephony] Failed to load the EE 3CX recording module', { error });
        return null;
      });
  }

  return eeThreecxModulePromise;
}

/**
 * Call artifacts reuse the tenant's Teams recording settings: transcripts are
 * always filed as documents, recording blobs are only stored when the tenant
 * opted into downloading them. 3CX recordings are only reachable through the
 * PBX's authenticated API, so they are always stored.
 */
async function loadCaptureSettings(tenantId: string, provider: string): Promise<CallArtifactCaptureSettings> {
  if (provider === THREECX_PROVIDER) {
    return { downloadRecordings: true, exposeRecordingsInPortal: false };
  }
  try {
    const { knex } = await createTenantKnex(tenantId);
    const row = await tenantDb(knex, tenantId).table('teams_integrations')
      .first('download_recordings', 'expose_recordings_in_portal');

    return {
      downloadRecordings: row?.download_recordings === true,
      exposeRecordingsInPortal: row?.expose_recordings_in_portal === true,
    };
  } catch {
    return { downloadRecordings: false, exposeRecordingsInPortal: false };
  }
}

/** The number on the far side of the call: caller inbound, callee outbound. */
function externalNumberOf(call: TelephonyCallRecordRow): string | null {
  return call.direction === 'outbound'
    ? call.callee_number_e164 ?? call.callee_number_raw
    : call.caller_number_e164 ?? call.caller_number_raw;
}

function threecxFetcher(threecx: EeThreecxRecordingModule): CallArtifactProviderFetcher {
  return async ({ tenantId, call }) => {
    const lookup = await threecx.findThreecxRecordingForCall({
      tenantId,
      startedAt: call.started_at,
      externalNumber: externalNumberOf(call),
    });
    if (lookup.status === 'unsupported') {
      return { status: 'unsupported' };
    }
    if (lookup.status === 'none') {
      return { status: 'fetched', artifacts: [] };
    }
    return {
      status: 'fetched',
      artifacts: threecx.threecxRecordingToCallArtifacts(lookup.recording),
      complete: threecx.isThreecxRecordingComplete(lookup.recording),
    };
  };
}

/**
 * Provider access (artifact listing, blob download) injected into the telephony
 * core, which stays vendor-neutral: it never imports an EE provider package.
 */
export async function buildTelephonyCallArtifactDeps(): Promise<CaptureCallArtifactsDependencies | null> {
  const eeModule = await loadEeCallArtifactModule();
  if (!eeModule) {
    return null;
  }
  const threecx = await loadEeThreecxModule();

  return {
    fetchArtifacts: (input) => eeModule.fetchTeamsCallArtifacts(input),
    providerFetchers: threecx ? { [THREECX_PROVIDER]: threecxFetcher(threecx) } : undefined,
    downloadRecording: async ({ tenantId, call, artifact, actorUserId }) => {
      if (!artifact.contentUrl) {
        return null;
      }
      // Imported here rather than at module scope: this module is pulled in by
      // the call notification handler, which must stay loadable without the
      // storage stack.
      const { StorageService } = await import('@alga-psa/storage/StorageService');

      if (call.provider === THREECX_PROVIDER) {
        if (!threecx) {
          return null;
        }
        const bytes = await threecx.downloadThreecxRecording(tenantId, artifact.providerArtifactId);
        const extension = threecx.threecxRecordingFileExtension(artifact.contentUrl);
        const file = await StorageService.uploadFile(
          tenantId,
          Buffer.from(bytes),
          `call-${call.provider_call_id}-${artifact.providerArtifactId}.${extension}`,
          {
            // Stated in code from the URL's extension; the PBX response
            // content-type is untrusted under the system-artifact bypass.
            mime_type: threecx.threecxRecordingMimeType(artifact.contentUrl),
            uploaded_by_id: actorUserId,
            origin: 'system-artifact',
            metadata: {
              source: 'threecx_call_recording',
              call_record_id: call.call_record_id,
              provider_artifact_id: artifact.providerArtifactId,
            },
          },
        );
        return file.file_id;
      }

      const content = await eeModule.downloadTeamsCallArtifactContent({
        tenantId,
        contentUrl: artifact.contentUrl,
      });
      if (!content) {
        return null;
      }
      const file = await StorageService.uploadFile(
        tenantId,
        content.buffer,
        `call-${call.provider_call_id}-${artifact.providerArtifactId}.mp4`,
        {
          // content.contentType traces to the provider's response content-type
          // header, which is untrusted and unchecked under the system-artifact
          // bypass. State the type in code; the filename above is always .mp4.
          mime_type: 'video/mp4',
          uploaded_by_id: actorUserId,
          origin: 'system-artifact',
          metadata: {
            source: 'teams_phone_call_recording',
            call_record_id: call.call_record_id,
            provider_artifact_id: artifact.providerArtifactId,
          },
        },
      );
      return file.file_id;
    },
    annotateTicketFromTranscript: eeModule.annotateLinkedTicketFromTranscript
      ? (input) => eeModule.annotateLinkedTicketFromTranscript!(input as Record<string, unknown>)
      : undefined,
    loadSettings: loadCaptureSettings,
  };
}

/**
 * Capture one call's artifacts. Called inline right after ingestion (the
 * callRecord notification is the only trigger Graph gives us for ad hoc calls)
 * and again from the sweep until artifacts land or the window closes.
 */
export async function captureTelephonyCallArtifacts(params: {
  tenantId: string;
  callRecordId: string;
}): Promise<void> {
  const deps = await buildTelephonyCallArtifactDeps();
  if (!deps) {
    return;
  }

  const { captureCallArtifacts } = await import('@alga-psa/telephony');
  await captureCallArtifacts({ tenantId: params.tenantId, callRecordId: params.callRecordId }, deps);
}

/**
 * Recurring per-tenant poll for calls still waiting on recordings/transcripts.
 * Per-call error isolation: one call that keeps failing never stops the rest.
 */
export async function telephonyCallArtifactSweepHandler(
  data: TelephonyCallArtifactSweepJobData,
): Promise<void> {
  const deps = await buildTelephonyCallArtifactDeps();
  if (!deps) {
    return;
  }

  await runWithTenant(data.tenantId, async () => {
    const { captureCallArtifacts, isCallArtifactFetchDue, listCallsAwaitingArtifacts } =
      await import('@alga-psa/telephony');

    const now = new Date();
    const pending = await listCallsAwaitingArtifacts({ tenantId: data.tenantId });
    const due = pending.filter((call) => isCallArtifactFetchDue(call, now));
    if (due.length === 0) {
      return;
    }

    for (const call of due) {
      try {
        await captureCallArtifacts(
          { tenantId: data.tenantId, callRecordId: call.call_record_id },
          deps,
        );
      } catch (error) {
        logger.warn('[Telephony] Call artifact capture failed', {
          tenantId: data.tenantId,
          callRecordId: call.call_record_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('[Telephony] Call artifact sweep complete', {
      tenantId: data.tenantId,
      considered: pending.length,
      swept: due.length,
    });
  });
}
