import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { TelephonyCallRecordRow } from '../types';
import { buildCallInteractionNotes, buildCallInteractionTitle } from '../lib/callInteractions';

export interface TicketCreationDefaults {
  boardId: string | null;
  statusId: string | null;
  priorityId: string | null;
}

export interface AutoTicketFromCallInput {
  tenantId: string;
  callRecordId: string;
  /** Resolved by the caller so the core stays free of provider/edition imports. */
  defaults: TicketCreationDefaults;
  knex?: any;
}

export type AutoTicketFromCallOutcome =
  | { status: 'skipped'; reason: 'not_found' | 'already_ticketed' | 'unmatched' | 'no_defaults' }
  | { status: 'created'; ticketId: string; ticketNumber: string };

/**
 * Per-tenant auto-ticket policy (off by default). Only *matched* calls qualify:
 * an auto-created ticket on the wrong client is a support incident, so an
 * ambiguous call waits for a human in the unmatched queue.
 */
export async function autoCreateTicketForCall(
  input: AutoTicketFromCallInput,
): Promise<AutoTicketFromCallOutcome> {
  if (!input.defaults.boardId || !input.defaults.statusId || !input.defaults.priorityId) {
    return { status: 'skipped', reason: 'no_defaults' };
  }

  const knex = input.knex ?? (await createTenantKnex(input.tenantId)).knex;

  return withTransaction(knex, async (trx: any) => {
    const db = tenantDb(trx, input.tenantId);
    const record: TelephonyCallRecordRow | undefined = await db.table('telephony_call_records')
      .where({ call_record_id: input.callRecordId })
      .first();

    if (!record) {
      return { status: 'skipped' as const, reason: 'not_found' as const };
    }
    if (record.ticket_id) {
      return { status: 'skipped' as const, reason: 'already_ticketed' as const };
    }
    if (!record.matched_client_id) {
      return { status: 'skipped' as const, reason: 'unmatched' as const };
    }

    const titleInput = {
      direction: record.direction,
      callerNumberE164: record.caller_number_e164,
      callerNumberRaw: record.caller_number_raw,
      calleeNumberE164: record.callee_number_e164,
      calleeNumberRaw: record.callee_number_raw,
    };

    const { TicketModel } = await import('@alga-psa/shared/models/ticketModel');
    const created = await TicketModel.createTicketWithRetry(
      {
        title: buildCallInteractionTitle(titleInput),
        description: buildCallInteractionNotes({
          ...titleInput,
          provider: record.provider,
          durationSeconds: record.duration_seconds,
        }),
        client_id: record.matched_client_id,
        contact_id: record.matched_contact_id ?? undefined,
        board_id: input.defaults.boardId!,
        status_id: input.defaults.statusId!,
        priority_id: input.defaults.priorityId!,
        source: 'telephony',
      } as any,
      input.tenantId,
      trx,
      {},
      undefined,
      undefined,
      undefined,
      3,
    );

    if (record.interaction_id) {
      await db.table('interactions')
        .where({ interaction_id: record.interaction_id })
        .update({ ticket_id: created.ticket_id });
    }
    await db.table('telephony_call_records')
      .where({ call_record_id: input.callRecordId })
      .update({ ticket_id: created.ticket_id, updated_at: trx.fn.now() });

    logger.info('[Telephony] Auto-created a ticket from a matched call', {
      tenantId: input.tenantId,
      callRecordId: input.callRecordId,
      ticketNumber: created.ticket_number,
    });

    return { status: 'created' as const, ticketId: created.ticket_id, ticketNumber: created.ticket_number };
  });
}
