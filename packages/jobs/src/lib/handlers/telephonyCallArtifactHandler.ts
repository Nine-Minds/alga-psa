import logger from '@alga-psa/core/logger';
import { createTenantKnex, runWithTenant, tenantDb } from '@alga-psa/db';
import type {
  CallArtifactCaptureSettings,
  CaptureCallArtifactsDependencies,
} from '@alga-psa/telephony';

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

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

let eeCallArtifactModulePromise: Promise<EeCallArtifactModule | null> | null = null;

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

/**
 * Call artifacts reuse the tenant's Teams recording settings: transcripts are
 * always filed as documents, recording blobs are only stored when the tenant
 * opted into downloading them.
 */
async function loadCaptureSettings(tenantId: string): Promise<CallArtifactCaptureSettings> {
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

/**
 * Graph access (artifact listing, blob download) injected into the telephony
 * core, which stays vendor-neutral: it never imports the EE Teams package.
 */
export async function buildTelephonyCallArtifactDeps(): Promise<CaptureCallArtifactsDependencies | null> {
  const eeModule = await loadEeCallArtifactModule();
  if (!eeModule) {
    return null;
  }

  return {
    fetchArtifacts: (input) => eeModule.fetchTeamsCallArtifacts(input),
    downloadRecording: async ({ tenantId, call, artifact, actorUserId }) => {
      if (!artifact.contentUrl) {
        return null;
      }
      const content = await eeModule.downloadTeamsCallArtifactContent({
        tenantId,
        contentUrl: artifact.contentUrl,
      });
      if (!content) {
        return null;
      }
      // Imported here rather than at module scope: this module is pulled in by
      // the call notification handler, which must stay loadable without the
      // storage stack.
      const { StorageService } = await import('@alga-psa/storage/StorageService');
      const file = await StorageService.uploadFile(
        tenantId,
        content.buffer,
        `call-${call.provider_call_id}-${artifact.providerArtifactId}.mp4`,
        {
          mime_type: content.contentType,
          uploaded_by_id: actorUserId,
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
