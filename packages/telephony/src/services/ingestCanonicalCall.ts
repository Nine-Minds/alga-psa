import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { CanonicalCallRecord, CallMatchResult, TelephonyCallRecordRow } from '../types';
import { canonicalCallRecordSchema } from '../types';
import { matchCallParty } from '../lib/callMatching';
import { normalizeCountryCode, normalizeToE164 } from '../lib/phoneNumbers';
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
  /** Overrides the tenant's own-company country for imports/tests. */
  defaultCountryCode?: string | null;
}

export type IngestCanonicalCallOutcome =
  | { status: 'skipped'; reason: 'invalid_payload' }
  | {
      status: 'ingested';
      callRecordId: string;
      matchStatus: CallMatchResult['status'];
      interactionId: string | null;
      created: boolean;
    };

interface PendingCallIntentRow {
  intent_id: string;
  user_id: string;
  provider_user_id: string | null;
  ticket_id: string;
  client_id: string | null;
  contact_id: string | null;
  created_at: string | Date;
  expires_at: string | Date;
}

/**
 * Find the ticket-screen click that launched this outbound call. An exact
 * Microsoft user match wins; without one we only accept a single unambiguous
 * intent for the number and time window. This avoids filing a call on the
 * wrong ticket when two technicians dial the same number near-simultaneously.
 */
async function resolvePendingCallIntent(input: {
  trx: any;
  tenantId: string;
  provider: string;
  providerUserId: string | null;
  phoneNumberE164: string | null;
  startedAt: string | null | undefined;
}): Promise<PendingCallIntentRow | null> {
  if (!input.phoneNumberE164 || !input.startedAt) return null;

  const callStartedAt = new Date(input.startedAt).getTime();
  if (!Number.isFinite(callStartedAt)) return null;

  const rows: PendingCallIntentRow[] = await tenantDb(input.trx, input.tenantId)
    .table('telephony_call_intents')
    .where({
      provider: input.provider,
      status: 'pending',
      phone_number_e164: input.phoneNumberE164,
    })
    .orderBy('created_at', 'desc')
    .limit(20);

  // Allow a small clock-skew margin. The normal window starts when the user
  // clicks and ends at expires_at; delayed Graph delivery does not matter
  // because the CDR's actual started_at is used here.
  const eligible = rows.filter((row) => {
    const createdAt = new Date(row.created_at).getTime();
    const expiresAt = new Date(row.expires_at).getTime();
    return Number.isFinite(createdAt)
      && Number.isFinite(expiresAt)
      && createdAt <= callStartedAt + (5 * 60 * 1000)
      && expiresAt >= callStartedAt - (5 * 60 * 1000);
  });

  if (input.providerUserId) {
    const exact = eligible.filter((row) => row.provider_user_id === input.providerUserId);
    if (exact.length > 0) return exact[0];

    // A lone intent from a user without a Microsoft account link is still
    // useful. Never fall back across a conflicting, known Teams identity.
    const unbound = eligible.filter((row) => !row.provider_user_id);
    return eligible.length === 1 && unbound.length === 1 ? unbound[0] : null;
  }

  return eligible.length === 1 ? eligible[0] : null;
}

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


  const defaultCountryCode = normalizeCountryCode(input.defaultCountryCode)
    ?? await resolveTenantPhoneCountryCode(knex, input.tenantId);

  const callerE164 = normalizeToE164(call.callerNumber?.e164 ?? call.callerNumber?.raw, {
    defaultCountryCode,
  });
  const calleeE164 = normalizeToE164(call.calleeNumber?.e164 ?? call.calleeNumber?.raw, {
    defaultCountryCode,
  });

  // The counterparty is whoever is not us: the caller on the way in, the callee
  // on the way out.
  const counterpartyE164 = call.direction === 'outbound' ? calleeE164 : callerE164;
  const numberMatch = await matchCallParty({
    knex,
    tenantId: input.tenantId,
    phoneNumber: counterpartyE164,
    defaultCountryCode,
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

    const callIntent = call.direction === 'outbound'
      ? await resolvePendingCallIntent({
          trx,
          tenantId: input.tenantId,
          provider: call.provider,
          providerUserId: call.organizerUserId ?? null,
          phoneNumberE164: counterpartyE164,
          startedAt: call.startedAt,
        })
      : null;

    const match: CallMatchResult = callIntent
      ? {
          status: 'matched',
          contactId: callIntent.contact_id,
          clientId: callIntent.client_id,
          candidates: [],
        }
      : numberMatch;

    const [inserted] = await db.table('telephony_call_records')
      .insert({
        ...columns,
        tenant: input.tenantId,
        match_status: match.status,
        matched_contact_id: match.contactId,
        matched_client_id: match.clientId,
        match_candidates: JSON.stringify(match.candidates),
        ticket_id: callIntent?.ticket_id ?? null,
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
        actingUserId: callIntent?.user_id ?? null,
        ticketId: callIntent?.ticket_id ?? null,
      });

      if (interactionId) {
        await db.table('telephony_call_records')
          .where({ call_record_id: callRecordId })
          .update({ interaction_id: interactionId, updated_at: trx.fn.now() });
      }
    }

    if (callIntent) {
      await db.table('telephony_call_intents')
        .where({ intent_id: callIntent.intent_id, status: 'pending' })
        .update({
          status: 'matched',
          call_record_id: callRecordId,
          matched_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });
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

/**
 * Use the MSP's own default company location as the tenant-wide numbering
 * context. Both reads are tenant-scoped; placeholder/unsupported country codes
 * intentionally produce no default rather than silently assuming North America.
 */
export async function resolveTenantPhoneCountryCode(
  knex: any,
  tenantId: string,
): Promise<string | null> {
  const db = tenantDb(knex, tenantId);
  const tenantCompany = await db.table('tenant_companies')
    .where({ is_default: true, deleted_at: null })
    .first('client_id');
  if (!tenantCompany?.client_id) {
    return null;
  }

  const location = await db.table('client_locations')
    .where({ client_id: tenantCompany.client_id, is_default: true, is_active: true })
    .first('country_code');

  return normalizeCountryCode(location?.country_code) ?? null;
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

/**
 * The client an interaction will actually be filed under: the explicit one, or
 * the matched contact's. `contacts.client_id` is nullable by design, so a
 * contact match does not guarantee a client.
 */
export async function resolveInteractionClientId(
  trx: any,
  tenantId: string,
  clientId: string | null,
  contactId: string | null,
): Promise<string | null> {
  if (clientId) {
    return clientId;
  }
  if (!contactId) {
    return null;
  }

  const contact = await tenantDb(trx, tenantId).table('contacts')
    .where({ contact_name_id: contactId })
    .first('client_id');

  return contact?.client_id ?? null;
}

export async function createCallInteraction(input: CreateCallInteractionInput): Promise<string | null> {
  // `createInteractionRecord` throws when no client can be resolved, and this
  // runs inside the ingestion transaction — letting it throw rolls the ledger
  // insert back, so the call is lost entirely and every retry loses it again.
  const clientId = await resolveInteractionClientId(input.trx, input.tenantId, input.clientId, input.contactId);
  if (!clientId) {
    logger.warn('[Telephony] Matched party has no client; leaving the call for manual attribution', {
      tenantId: input.tenantId,
      contactId: input.contactId,
    });
    return null;
  }

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
      client_id: clientId,
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
