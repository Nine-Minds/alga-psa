import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { TelephonyChatRecordRow } from '../types';
import { resolveInteractionClientId } from './ingestCanonicalCall';
import { createChatInteraction } from './ingestChat';

export interface ResolveChatMatchInput {
  tenantId: string;
  chatRecordId: string;
  contactId?: string | null;
  clientId?: string | null;
  actingUserId?: string | null;
  knex?: any;
}

export type ResolveChatMatchOutcome =
  | { status: 'not_found' }
  | { status: 'already_resolved'; interactionId: string | null }
  | { status: 'resolved'; interactionId: string | null };

/**
 * Dispatcher path: attach an unmatched/ambiguous chat to a contact or client.
 * Resolving is what mints the Chat interaction, mirroring resolveCallMatch.
 */
export async function resolveChatMatch(input: ResolveChatMatchInput): Promise<ResolveChatMatchOutcome> {
  const knex = input.knex ?? (await createTenantKnex(input.tenantId)).knex;

  return withTransaction(knex, async (trx: any) => {
    const db = tenantDb(trx, input.tenantId);
    const record: TelephonyChatRecordRow | undefined = await db.table('telephony_chat_records')
      .where({ chat_record_id: input.chatRecordId })
      .first();

    if (!record) {
      return { status: 'not_found' as const };
    }

    if (record.interaction_id) {
      return { status: 'already_resolved' as const, interactionId: record.interaction_id };
    }

    const contactId = input.contactId ?? null;
    if (!contactId && !input.clientId) {
      throw new Error('Resolving a chat requires a contact or a client');
    }

    const clientId = await resolveInteractionClientId(trx, input.tenantId, input.clientId ?? null, contactId);
    if (!clientId) {
      throw new Error('That contact is not associated with a client. Pick a client for this chat instead.');
    }

    const interactionId = await createChatInteraction({
      trx,
      tenantId: input.tenantId,
      chat: {
        provider: record.provider,
        partyName: record.party_name,
        partyNumberRaw: record.party_number_raw,
        partyNumberE164: record.party_number_e164,
        partyEmail: record.party_email,
        messages: record.messages,
        startedAt: toIsoString(record.started_at),
        endedAt: toIsoString(record.ended_at),
        durationSeconds: record.duration_seconds,
      },
      contactId,
      clientId,
      actingUserId: input.actingUserId ?? record.agent_user_id,
    });

    await db.table('telephony_chat_records')
      .where({ chat_record_id: input.chatRecordId })
      .update({
        match_status: 'resolved',
        matched_contact_id: contactId,
        matched_client_id: clientId,
        interaction_id: interactionId,
        updated_at: trx.fn.now(),
      });

    logger.info('[Telephony] Chat manually resolved', {
      tenantId: input.tenantId,
      chatRecordId: input.chatRecordId,
      interactionId,
    });

    return { status: 'resolved' as const, interactionId };
  });
}

function toIsoString(value: string | Date | null): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
