import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { CanonicalCallRecord, CallMatchResult, TelephonyCallRecordRow } from '../types';
import { canonicalCallRecordSchema } from '../types';
import { matchCallParty } from '../lib/callMatching';
import { normalizeToE164 } from '../lib/phoneNumbers';
import { tenantHasTelephonyAddOn } from '../lib/telephonyAddOnGate';
import {
  buildCallInteractionNotes,
  buildCallInteractionTitle,
  resolveCallInteractionTypeId,
  resolveTelephonyActorUserId,
} from '../lib/callInteractions';

export interface IngestCanonicalCallInput {
  tenantId: string;
  call: CanonicalCallRecord;
  /** Provided by tests / callers that already hold a connection. */
  knex?: any;
  defaultCallingCode?: string;
}

export type IngestCanonicalCallOutcome =
  | { status: 'skipped'; reason: 'addon_inactive' | 'invalid_payload' }
  | {
      status: 'ingested';
      callRecordId: string;
      matchStatus: CallMatchResult['status'];
      interactionId: string | null;
      created: boolean;
    };

/**
 * Idempotent ingestion of one canonical call.
 *
 * Keyed on (tenant, provider, provider_call_id): Graph re-delivers change
 * notifications, and Temporal retries the job, so a second run must update the
 * ledger row and never mint a second interaction.
 *
 * Interaction policy (F027): only a *matched* call gets an interaction on
 * ingest. Unmatched/ambiguous calls stay in the ledger until a human resolves
 * them, because an interaction with no client is invisible on every timeline
 * and an interaction on the wrong client is worse than none.
 */
export async function ingestCanonicalCall(
  input: IngestCanonicalCallInput,
): Promise<IngestCanonicalCallOutcome> {
  const parsed = canonicalCallRecordSchema.safeParse(input.call);
  if (!parsed.success) {
    logger.warn('[Telephony] Rejecting call with an invalid canonical payload', {
      tenantId: input.tenantId,
      issues: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
    return { status: 'skipped', reason: 'invalid_payload' };
  }

  const call = parsed.data;
  const knex = input.knex ?? (await createTenantKnex(input.tenantId)).knex;

  if (!(await tenantHasTelephonyAddOn(knex, input.tenantId))) {
    logger.info('[Telephony] Skipping call ingestion: telephony add-on inactive', {
      tenantId: input.tenantId,
      provider: call.provider,
    });
    return { status: 'skipped', reason: 'addon_inactive' };
  }

  const callerE164 = normalizeToE164(call.callerNumber?.e164 ?? call.callerNumber?.raw, {
    defaultCallingCode: input.defaultCallingCode,
  });
  const calleeE164 = normalizeToE164(call.calleeNumber?.e164 ?? call.calleeNumber?.raw, {
    defaultCallingCode: input.defaultCallingCode,
  });

  // The counterparty is whoever is not us: the caller on the way in, the callee
  // on the way out.
  const counterpartyE164 = call.direction === 'outbound' ? calleeE164 : callerE164;
  const match = await matchCallParty({
    knex,
    tenantId: input.tenantId,
    phoneNumber: counterpartyE164,
    defaultCallingCode: input.defaultCallingCode,
  });

  return withTransaction(knex, async (trx: any) => {
    const db = tenantDb(trx, input.tenantId);
    const existing: TelephonyCallRecordRow | undefined = await db.table('telephony_call_records')
      .where({ provider: call.provider, provider_call_id: call.providerCallId })
      .first();

    const columns = {
      provider: call.provider,
      provider_call_id: call.providerCallId,
      direction: call.direction,
      caller_number_raw: call.callerNumber?.raw ?? null,
      caller_number_e164: callerE164,
      callee_number_raw: call.calleeNumber?.raw ?? null,
      callee_number_e164: calleeE164,
      organizer_user_id: call.organizerUserId ?? null,
      modality: call.modality ?? null,
      started_at: call.startedAt ?? null,
      ended_at: call.endedAt ?? null,
      duration_seconds: call.durationSeconds ?? null,
      raw: JSON.stringify(call.raw ?? {}),
      updated_at: trx.fn.now(),
    };

    if (existing) {
      // Replay: refresh the payload, keep the match/interaction the first run
      // (or a human) already established.
      await db.table('telephony_call_records')
        .where({ call_record_id: existing.call_record_id })
        .update(columns);

      return {
        status: 'ingested' as const,
        callRecordId: existing.call_record_id,
        matchStatus: existing.match_status,
        interactionId: existing.interaction_id,
        created: false,
      };
    }

    const [inserted] = await db.table('telephony_call_records')
      .insert({
        ...columns,
        tenant: input.tenantId,
        match_status: match.status,
        matched_contact_id: match.contactId,
        matched_client_id: match.clientId,
        match_candidates: JSON.stringify(match.candidates),
        created_at: trx.fn.now(),
      } as any)
      .returning('call_record_id');

    const callRecordId = (inserted as any).call_record_id as string;

    let interactionId: string | null = null;
    if (match.status === 'matched') {
      interactionId = await createCallInteraction({
        trx,
        tenantId: input.tenantId,
        call,
        callerE164,
        calleeE164,
        contactId: match.contactId,
        clientId: match.clientId,
      });

      if (interactionId) {
        await db.table('telephony_call_records')
          .where({ call_record_id: callRecordId })
          .update({ interaction_id: interactionId, updated_at: trx.fn.now() });
      }
    }

    return {
      status: 'ingested' as const,
      callRecordId,
      matchStatus: match.status,
      interactionId,
      created: true,
    };
  });
}

export interface CreateCallInteractionInput {
  trx: any;
  tenantId: string;
  call: Pick<CanonicalCallRecord, 'direction' | 'provider' | 'durationSeconds' | 'startedAt' | 'endedAt'> & {
    callerNumber?: CanonicalCallRecord['callerNumber'];
    calleeNumber?: CanonicalCallRecord['calleeNumber'];
  };
  callerE164: string | null;
  calleeE164: string | null;
  contactId: string | null;
  clientId: string | null;
  actingUserId?: string | null;
  ticketId?: string | null;
}

export async function createCallInteraction(input: CreateCallInteractionInput): Promise<string | null> {
  const typeId = await resolveCallInteractionTypeId(input.trx, input.tenantId);
  if (!typeId) {
    logger.warn('[Telephony] Call interaction type is not configured; skipping interaction', {
      tenantId: input.tenantId,
    });
    return null;
  }

  const userId = await resolveTelephonyActorUserId(input.trx, input.tenantId, input.actingUserId);
  if (!userId) {
    logger.warn('[Telephony] No internal user to own the call interaction; skipping interaction', {
      tenantId: input.tenantId,
    });
    return null;
  }

  const titleInput = {
    direction: input.call.direction,
    callerNumberE164: input.callerE164,
    callerNumberRaw: input.call.callerNumber?.raw ?? null,
    calleeNumberE164: input.calleeE164,
    calleeNumberRaw: input.call.calleeNumber?.raw ?? null,
  };

  const start = input.call.startedAt ? new Date(input.call.startedAt) : null;
  const end = input.call.endedAt ? new Date(input.call.endedAt) : null;

  // Cross-vertical dynamic import (see custom-rules/no-feature-to-feature-imports):
  // the telephony core stays free of a static dependency on the clients vertical.
  const { createInteractionRecord } = await import('@alga-psa/clients/actions/interactionCreateHelper');
  const interaction = await createInteractionRecord({
    tenant: input.tenantId,
    trx: input.trx,
    interactionData: {
      type_id: typeId,
      user_id: userId,
      client_id: input.clientId ?? undefined,
      contact_name_id: input.contactId ?? undefined,
      ticket_id: input.ticketId ?? null,
      title: buildCallInteractionTitle(titleInput),
      notes: buildCallInteractionNotes({
        ...titleInput,
        provider: input.call.provider,
        durationSeconds: input.call.durationSeconds ?? null,
      }),
      start_time: start ?? undefined,
      end_time: end ?? undefined,
      interaction_date: start ?? undefined,
      // `interactions.duration` is minutes everywhere else in the product.
      duration: typeof input.call.durationSeconds === 'number'
        ? Math.max(1, Math.round(input.call.durationSeconds / 60))
        : undefined,
    } as any,
  });

  return interaction.interaction_id;
}
