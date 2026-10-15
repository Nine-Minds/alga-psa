import logger from '@alga-psa/core/logger';
import { runWithTenant } from '@alga-psa/db';
import type { CanonicalCallRecord } from '@alga-psa/telephony/types';
import { runTelephonyAutoTicketTail } from './telephonyPostIngest';

export interface TelephonyCanonicalCallJobData extends Record<string, unknown> {
  tenantId: string;
  record: CanonicalCallRecord;
}

type EeThreecxModule = {
  getThreecxProviderState: (tenantId: string) => Promise<{ autoCreateTickets: boolean }>;
};

type EeTeamsPsaModule = {
  getTeamsTicketCreationDefaults: (params: { tenantId: string }) => Promise<{ boardId: string | null; statusId: string | null }>;
  resolveDefaultPriorityIdForBoard: (tenantId: string, boardId: string) => Promise<string | null>;
};

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

/** The contact the PBX lookup already resolved (3CX echoes EntityId/EntityType back). */
function preferredContactFromRaw(raw: Record<string, unknown>): string | null {
  if (raw.entityType !== 'contact') return null;
  return typeof raw.entityId === 'string' && raw.entityId.trim() !== '' ? raw.entityId : null;
}

/**
 * Provider-agnostic ingestion for adapters that already hand us the canonical
 * record (3CX's server-side ReportCall). Mirrors the Teams notification
 * handler's ingest → shared auto-ticket tail, minus the Graph CDR fetch and the
 * Teams-only artifact poll.
 */
export async function processTelephonyCanonicalCall(
  data: TelephonyCanonicalCallJobData,
): Promise<void> {
  if (!isEnterpriseEdition) {
    logger.info('[Telephony] Skipping canonical call outside Enterprise Edition', {
      tenantId: data.tenantId,
    });
    return;
  }

  await runWithTenant(data.tenantId, async () => {
    const telephony = await import('@alga-psa/telephony');
    const raw = data.record.raw ?? {};
    const preferredContactId = preferredContactFromRaw(raw);
    const outcome = await telephony.ingestCanonicalCall({
      tenantId: data.tenantId,
      call: data.record,
      ...(preferredContactId ? { preferredContactId } : {}),
    });
    logger.info('[Telephony] Canonical call processed', {
      tenantId: data.tenantId,
      provider: data.record.provider,
      providerCallId: data.record.providerCallId,
      outcome: outcome.status,
    });

    if (outcome.status !== 'ingested') {
      return;
    }

    const transcription = typeof raw.transcription === 'string' ? raw.transcription.trim() : '';
    if (transcription) {
      // Best-effort: a transcript filing failure must not lose the call or its ticket.
      try {
        await telephony.attachProvidedTranscript({
          tenantId: data.tenantId,
          callRecordId: outcome.callRecordId,
          transcription,
          summary: typeof raw.summary === 'string' ? raw.summary : null,
        });
      } catch (error) {
        logger.warn('[Telephony] Failed to attach the provided call transcript', {
          tenantId: data.tenantId,
          callRecordId: outcome.callRecordId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const [threecx, teamsPsa] = await Promise.all([
      import('@alga-psa/ee-threecx/lib') as Promise<EeThreecxModule>,
      import('@alga-psa/ee-microsoft-teams/lib') as Promise<EeTeamsPsaModule>,
    ]);

    await runTelephonyAutoTicketTail(data.tenantId, outcome, {
      getAutoCreateTickets: async () =>
        (await threecx.getThreecxProviderState(data.tenantId)).autoCreateTickets,
      getTicketDefaults: () => teamsPsa.getTeamsTicketCreationDefaults({ tenantId: data.tenantId }),
      getPriorityForBoard: (boardId) => teamsPsa.resolveDefaultPriorityIdForBoard(data.tenantId, boardId),
    });
  });
}
