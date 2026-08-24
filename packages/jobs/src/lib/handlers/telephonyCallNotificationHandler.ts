import logger from '@alga-psa/core/logger';
import { runWithTenant } from '@alga-psa/db';
import { captureTelephonyCallArtifacts } from './telephonyCallArtifactHandler';

export interface TelephonyCallSubscriptionRenewalJobData extends Record<string, unknown> {
  tenantId: string;
  lookAheadMinutes?: number;
}

export interface TelephonyCallNotificationJobData extends Record<string, unknown> {
  tenantId: string;
  notification: Record<string, unknown>;
}

type EeTelephonyModule = {
  renewTelephonyCallSubscriptions: (data: TelephonyCallSubscriptionRenewalJobData) => Promise<unknown>;
  resolveCallRecordIdFromNotification: (notification: Record<string, unknown>) => string | null;
  fetchTeamsCallRecord: (params: { tenantId: string; callRecordId: string }) => Promise<any>;
  mapTeamsCallRecordToCanonical: (record: any) => any;
  getTeamsPhoneProviderState: (tenantId: string) => Promise<{ autoCreateTickets: boolean }>;
  getTeamsTicketCreationDefaults: (params: { tenantId: string }) => Promise<{ boardId: string | null; statusId: string | null }>;
  resolveDefaultPriorityIdForBoard: (tenantId: string, boardId: string) => Promise<string | null>;
};

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

let eeTelephonyModulePromise: Promise<EeTelephonyModule | null> | null = null;

async function loadEeTelephonyModule(): Promise<EeTelephonyModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeTelephonyModulePromise) {
    eeTelephonyModulePromise = import('@alga-psa/ee-microsoft-teams/lib')
      .then((mod) => {
        if (
          typeof mod?.renewTelephonyCallSubscriptions !== 'function' ||
          typeof mod?.resolveCallRecordIdFromNotification !== 'function' ||
          typeof mod?.fetchTeamsCallRecord !== 'function' ||
          typeof mod?.mapTeamsCallRecordToCanonical !== 'function'
        ) {
          return null;
        }
        return mod as unknown as EeTelephonyModule;
      })
      .catch((error) => {
        logger.error('[Telephony] Failed to load the EE Teams telephony module', { error });
        return null;
      });
  }

  return eeTelephonyModulePromise;
}

export async function renewTelephonyCallSubscriptions(
  data: TelephonyCallSubscriptionRenewalJobData,
): Promise<void> {
  const eeModule = await loadEeTelephonyModule();
  if (!eeModule) {
    logger.info('[Telephony] Skipping call subscription renewal outside Enterprise Edition', {
      tenantId: data.tenantId,
    });
    return;
  }

  await eeModule.renewTelephonyCallSubscriptions(data);
}

/**
 * Webhook → job → CDR fetch → canonical → ingest.
 *
 * pg-boss handlers run without ambient tenant context (unlike the Temporal
 * worker path), and everything below reads it from AsyncLocalStorage, so the
 * tenant is set here at the job boundary.
 */
export async function processTelephonyCallNotification(
  data: TelephonyCallNotificationJobData,
): Promise<void> {
  const eeModule = await loadEeTelephonyModule();
  if (!eeModule) {
    logger.info('[Telephony] Skipping call notification outside Enterprise Edition', {
      tenantId: data.tenantId,
    });
    return;
  }

  const callRecordId = eeModule.resolveCallRecordIdFromNotification(data.notification);
  if (!callRecordId) {
    logger.warn('[Telephony] Unable to resolve the call record id from the notification', {
      tenantId: data.tenantId,
    });
    return;
  }

  await runWithTenant(data.tenantId, async () => {
    const record = await eeModule.fetchTeamsCallRecord({ tenantId: data.tenantId, callRecordId });
    const canonical = eeModule.mapTeamsCallRecordToCanonical(record);
    if (!canonical) {
      logger.warn('[Telephony] Call record could not be mapped to the canonical model', {
        tenantId: data.tenantId,
        callRecordId,
      });
      return;
    }

    const { autoCreateTicketForCall, ingestCanonicalCall } = await import('@alga-psa/telephony');
    const outcome = await ingestCanonicalCall({ tenantId: data.tenantId, call: canonical });
    logger.info('[Telephony] Call notification processed', {
      tenantId: data.tenantId,
      callRecordId,
      outcome: outcome.status,
    });

    if (outcome.status !== 'ingested') {
      return;
    }

    // Ad hoc calls have no artifact change notification, so this CDR
    // notification is also the start of the recording/transcript poll. Usually
    // too early (Teams publishes minutes later) — the sweep keeps trying.
    try {
      await captureTelephonyCallArtifacts({
        tenantId: data.tenantId,
        callRecordId: outcome.callRecordId,
      });
    } catch (error) {
      logger.info('[Telephony] Call artifacts are not available yet', {
        tenantId: data.tenantId,
        callRecordId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!outcome.created || outcome.matchStatus !== 'matched') {
      return;
    }

    // Per-tenant auto-ticket policy, off by default: only a freshly ingested,
    // confidently matched call may mint a ticket without a human.
    const provider = await eeModule.getTeamsPhoneProviderState(data.tenantId);
    if (!provider.autoCreateTickets) {
      return;
    }

    const defaults = await eeModule.getTeamsTicketCreationDefaults({ tenantId: data.tenantId });
    const priorityId = defaults.boardId
      ? await eeModule.resolveDefaultPriorityIdForBoard(data.tenantId, defaults.boardId)
      : null;

    await autoCreateTicketForCall({
      tenantId: data.tenantId,
      callRecordId: outcome.callRecordId,
      defaults: { boardId: defaults.boardId, statusId: defaults.statusId, priorityId },
    });
  });
}
