import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { TelephonyCallRecordRow } from '../types';
import { createCallInteraction, resolveInteractionClientId } from './ingestCanonicalCall';

export interface ResolveCallMatchInput {
  tenantId: string;
  callRecordId: string;
  contactId?: string | null;
  clientId?: string | null;
  actingUserId?: string | null;
  knex?: any;
}

export type ResolveCallMatchOutcome =
  | { status: 'not_found' }
  | { status: 'already_resolved'; interactionId: string | null }
  | { status: 'resolved'; interactionId: string | null };

/**
 * Dispatcher path: attach an unmatched/ambiguous call to a contact or client.
 * Resolving is what mints the interaction, so the call finally shows up on the
 * timeline it belongs to.
 */
export async function resolveCallMatch(input: ResolveCallMatchInput): Promise<ResolveCallMatchOutcome> {
  const knex = input.knex ?? (await createTenantKnex(input.tenantId)).knex;

  return withTransaction(knex, async (trx: any) => {
    const db = tenantDb(trx, input.tenantId);
    const record: TelephonyCallRecordRow | undefined = await db.table('telephony_call_records')
      .where({ call_record_id: input.callRecordId })
      .first();

    if (!record) {
      return { status: 'not_found' as const };
    }

    if (record.interaction_id) {
      return { status: 'already_resolved' as const, interactionId: record.interaction_id };
    }

    const contactId = input.contactId ?? null;
    if (!contactId && !input.clientId) {
      throw new Error('Resolving a call requires a contact or a client');
    }

    const clientId = await resolveInteractionClientId(trx, input.tenantId, input.clientId ?? null, contactId);
    if (!clientId) {
      // An interaction with no client is invisible on every timeline, so say so
      // rather than record a "resolved" call that never appears anywhere.
      throw new Error('That contact is not associated with a client. Pick a client for this call instead.');
    }

    const interactionId = await createCallInteraction({
      trx,
      tenantId: input.tenantId,
      call: {
        direction: record.direction,
        provider: record.provider,
        durationSeconds: record.duration_seconds,
        startedAt: toIsoString(record.started_at),
        endedAt: toIsoString(record.ended_at),
        callerNumber: { raw: record.caller_number_raw, e164: record.caller_number_e164 },
        calleeNumber: { raw: record.callee_number_raw, e164: record.callee_number_e164 },
      },
      callerE164: record.caller_number_e164,
      calleeE164: record.callee_number_e164,
      contactId,
      clientId,
      actingUserId: input.actingUserId,
    });

    await db.table('telephony_call_records')
      .where({ call_record_id: input.callRecordId })
      .update({
        match_status: 'resolved',
        matched_contact_id: contactId,
        matched_client_id: clientId,
        interaction_id: interactionId,
        updated_at: trx.fn.now(),
      });

    logger.info('[Telephony] Call manually resolved', {
      tenantId: input.tenantId,
      callRecordId: input.callRecordId,
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
