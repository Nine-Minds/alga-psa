import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { TelephonyChatRecordRow } from '../types';

export interface ListUnattributedChatsInput {
  tenantId: string;
  knex?: any;
  limit?: number;
}

/** Chats still waiting for a human to attribute them, newest first. */
export async function listUnattributedChats(input: ListUnattributedChatsInput): Promise<TelephonyChatRecordRow[]> {
  const knex = input.knex ?? (await createTenantKnex(input.tenantId)).knex;
  const rows: TelephonyChatRecordRow[] = await tenantDb(knex, input.tenantId)
    .table('telephony_chat_records')
    .whereIn('match_status', ['unmatched', 'ambiguous'])
    .orderBy('started_at', 'desc')
    .limit(input.limit ?? 50)
    .select('*');

  return rows;
}
