import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { CallMatchCandidate, CallMatchResult, CanonicalChatRecord, TelephonyChatRecordRow } from '../types';
import { canonicalChatRecordSchema } from '../types';
import { matchCallParty } from '../lib/callMatching';
import { formatCallNumber, normalizeCountryCode, normalizeToE164 } from '../lib/phoneNumbers';
import { resolveChatInteractionTypeId, resolveTelephonyActorUserId } from '../lib/callInteractions';
import { resolveInteractionClientId, resolveTenantPhoneCountryCode } from './ingestCanonicalCall';

export interface IngestChatInput {
  tenantId: string;
  chat: CanonicalChatRecord;
  /** Provided by tests / callers that already hold a connection. */
  knex?: any;
  /** Overrides the tenant's own-company country for imports/tests. */
  defaultCountryCode?: string | null;
}

export type IngestChatOutcome =
  | { status: 'skipped'; reason: 'invalid_payload' }
  | { status: 'duplicate'; chatRecordId: string; interactionId: string | null }
  | {
      status: 'ingested';
      chatRecordId: string;
      matchStatus: CallMatchResult['status'];
      interactionId: string | null;
    };

const UNMATCHED: CallMatchResult = { status: 'unmatched', contactId: null, clientId: null, candidates: [] };

/**
 * Contact recognition ladder for a chat, in order: the Alga id the template
 * echoed back (only while that contact is active), the visitor's email
 * (case-insensitive), then the visitor's number through the call ladder.
 */
async function resolveChatParty(input: {
  knex: any;
  tenantId: string;
  chat: CanonicalChatRecord;
  partyE164: string | null;
  defaultCountryCode: string | null;
}): Promise<CallMatchResult> {
  const db = tenantDb(input.knex, input.tenantId);
  const { chat } = input;

  if (chat.entityId && chat.entityType === 'contact') {
    const contact = await db.table('contacts')
      .where({ contact_name_id: chat.entityId, is_inactive: false })
      .first('contact_name_id', 'full_name', 'client_id');
    if (contact) {
      return {
        status: 'matched',
        contactId: contact.contact_name_id,
        clientId: contact.client_id ?? null,
        candidates: [{ ...emailCandidate(contact), source: 'contact_entity' }],
      };
    }
  }

  const email = chat.email?.trim().toLowerCase();
  if (email) {
    const rows: Array<{ contact_name_id: string; full_name: string | null; client_id: string | null }> =
      await db.table('contacts')
        .whereRaw('lower(email) = ?', [email])
        .andWhere({ is_inactive: false })
        .select('contact_name_id', 'full_name', 'client_id');

    if (rows.length === 1) {
      const [row] = rows;
      return {
        status: 'matched',
        contactId: row.contact_name_id,
        clientId: row.client_id ?? null,
        candidates: [emailCandidate(row)],
      };
    }
    if (rows.length > 1) {
      return { status: 'ambiguous', contactId: null, clientId: null, candidates: rows.map(emailCandidate) };
    }
  }

  if (input.partyE164 ?? chat.number) {
    return matchCallParty({
      knex: input.knex,
      tenantId: input.tenantId,
      phoneNumber: input.partyE164 ?? chat.number,
      defaultCountryCode: input.defaultCountryCode,
    });
  }

  return UNMATCHED;
}

function emailCandidate(row: { contact_name_id: string; full_name: string | null; client_id: string | null }): CallMatchCandidate {
  return {
    contactId: row.contact_name_id,
    clientId: row.client_id ?? null,
    contactName: row.full_name ?? null,
    source: 'contact_email',
  };
}

async function resolveAgentUserId(knex: any, tenantId: string, agentEmail: string | null | undefined): Promise<string | null> {
  const email = agentEmail?.trim().toLowerCase();
  if (!email) return null;
  const row = await tenantDb(knex, tenantId).table('users')
    .whereRaw('lower(email) = ?', [email])
    .first('user_id');
  return row?.user_id ?? null;
}

/**
 * Idempotent ingestion of one canonical chat, keyed on
 * (tenant, provider, provider_chat_id). A repeat creates nothing.
 *
 * Only a matched chat gets an interaction on ingest; unmatched/ambiguous chats
 * stay in the ledger until a human resolves them.
 */
export async function ingestChat(input: IngestChatInput): Promise<IngestChatOutcome> {
  const parsed = canonicalChatRecordSchema.safeParse(input.chat);
  if (!parsed.success) {
    logger.warn('[Telephony] Rejecting chat with an invalid canonical payload', {
      tenantId: input.tenantId,
      issues: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
    return { status: 'skipped', reason: 'invalid_payload' };
  }

  const chat = parsed.data;
  const knex = input.knex ?? (await createTenantKnex(input.tenantId)).knex;

  const defaultCountryCode = normalizeCountryCode(input.defaultCountryCode)
    ?? await resolveTenantPhoneCountryCode(knex, input.tenantId);
  const partyE164 = normalizeToE164(chat.number, { defaultCountryCode });

  const match = await resolveChatParty({ knex, tenantId: input.tenantId, chat, partyE164, defaultCountryCode });
  const agentUserId = await resolveAgentUserId(knex, input.tenantId, chat.agentEmail);

  return withTransaction(knex, async (trx: any) => {
    const db = tenantDb(trx, input.tenantId);
    const existing: TelephonyChatRecordRow | undefined = await db.table('telephony_chat_records')
      .where({ provider: chat.provider, provider_chat_id: chat.providerChatId })
      .first();

    if (existing) {
      return {
        status: 'duplicate' as const,
        chatRecordId: existing.chat_record_id,
        interactionId: existing.interaction_id,
      };
    }

    const [inserted] = await db.table('telephony_chat_records')
      .insert({
        tenant: input.tenantId,
        provider: chat.provider,
        provider_chat_id: chat.providerChatId,
        agent_user_id: agentUserId,
        party_number_raw: chat.number ?? null,
        party_number_e164: partyE164,
        party_email: chat.email ?? null,
        party_name: chat.name ?? null,
        queue_extension: chat.queueExtension ?? null,
        started_at: chat.startedAt,
        ended_at: chat.endedAt ?? null,
        duration_seconds: chat.durationSeconds ?? null,
        messages: chat.messages,
        match_status: match.status,
        matched_contact_id: match.contactId,
        matched_client_id: match.clientId,
        match_candidates: JSON.stringify(match.candidates),
        raw: JSON.stringify(chat.raw ?? {}),
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      } as any)
      .returning('chat_record_id');

    const chatRecordId = (inserted as any).chat_record_id as string;

    let interactionId: string | null = null;
    if (match.status === 'matched') {
      interactionId = await createChatInteraction({
        trx,
        tenantId: input.tenantId,
        chat: {
          provider: chat.provider,
          partyName: chat.name ?? null,
          partyNumberRaw: chat.number ?? null,
          partyNumberE164: partyE164,
          partyEmail: chat.email ?? null,
          messages: chat.messages,
          startedAt: chat.startedAt,
          endedAt: chat.endedAt ?? null,
          durationSeconds: chat.durationSeconds ?? null,
        },
        contactId: match.contactId,
        clientId: match.clientId,
        actingUserId: agentUserId,
      });

      if (interactionId) {
        await db.table('telephony_chat_records')
          .where({ chat_record_id: chatRecordId })
          .update({ interaction_id: interactionId, updated_at: trx.fn.now() });
      }
    }

    return {
      status: 'ingested' as const,
      chatRecordId,
      matchStatus: match.status,
      interactionId,
    };
  });
}

export interface ChatInteractionSource {
  provider: string;
  partyName: string | null;
  partyNumberRaw: string | null;
  partyNumberE164: string | null;
  partyEmail: string | null;
  messages: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
}

export interface CreateChatInteractionInput {
  trx: any;
  tenantId: string;
  chat: ChatInteractionSource;
  contactId: string | null;
  clientId: string | null;
  actingUserId?: string | null;
}

/** "Chat with Dorothy Gale" — the visitor's name, else their number, else their email. */
export function buildChatInteractionTitle(chat: Pick<ChatInteractionSource, 'partyName' | 'partyNumberRaw' | 'partyNumberE164' | 'partyEmail'>): string {
  const party = chat.partyName?.trim()
    || (chat.partyNumberE164 || chat.partyNumberRaw ? formatCallNumber(chat.partyNumberE164, chat.partyNumberRaw) : null)
    || chat.partyEmail?.trim()
    || 'unknown visitor';
  return `Chat with ${party}`;
}

export async function createChatInteraction(input: CreateChatInteractionInput): Promise<string | null> {
  // Runs inside the ingestion transaction; a throw here would roll the ledger
  // row back and lose the chat on every retry, so missing prerequisites skip
  // the interaction instead.
  const clientId = await resolveInteractionClientId(input.trx, input.tenantId, input.clientId, input.contactId);
  if (!clientId) {
    logger.warn('[Telephony] Matched chat party has no client; leaving the chat for manual attribution', {
      tenantId: input.tenantId,
      contactId: input.contactId,
    });
    return null;
  }

  const typeId = await resolveChatInteractionTypeId(input.trx, input.tenantId);
  if (!typeId) {
    logger.warn('[Telephony] Chat interaction type is not configured; skipping interaction', {
      tenantId: input.tenantId,
    });
    return null;
  }

  const userId = await resolveTelephonyActorUserId(input.trx, input.tenantId, input.actingUserId);
  if (!userId) {
    logger.warn('[Telephony] No internal user to own the chat interaction; skipping interaction', {
      tenantId: input.tenantId,
    });
    return null;
  }

  const start = input.chat.startedAt ? new Date(input.chat.startedAt) : null;
  const end = input.chat.endedAt ? new Date(input.chat.endedAt) : null;

  // Cross-vertical dynamic import (see custom-rules/no-feature-to-feature-imports).
  const { createInteractionRecord } = await import('@alga-psa/clients/actions/interactionCreateHelper');
  const interaction = await createInteractionRecord({
    tenant: input.tenantId,
    trx: input.trx,
    interactionData: {
      type_id: typeId,
      user_id: userId,
      client_id: clientId,
      contact_name_id: input.contactId ?? undefined,
      title: buildChatInteractionTitle(input.chat),
      notes: input.chat.messages,
      start_time: start ?? undefined,
      end_time: end ?? undefined,
      interaction_date: start ?? undefined,
      // `interactions.duration` is minutes everywhere else in the product.
      duration: typeof input.chat.durationSeconds === 'number'
        ? Math.max(1, Math.round(input.chat.durationSeconds / 60))
        : undefined,
    } as any,
  });

  return interaction.interaction_id;
}
