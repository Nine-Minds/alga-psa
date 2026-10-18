// Server-only: the single comment-write merge hook shared by every MSP comment path
// (createComment and addTicketCommentInTransaction). Imports the DB-backed context loader.

import type { Knex } from 'knex';
import { hasMergeTokens, resolveMergeFieldsInNote } from './mergeFields';
import { loadCannedMergeContext } from './mergeContext';

/**
 * Resolves canned-response merge fields in a comment note on the caller's transaction. Only internal (MSP)
 * authors are rewritten: client-portal comments are returned untouched. Notes without tokens are returned
 * unchanged without touching the database. Unknown tokens are left as written; known tokens with no value
 * become ''.
 */
export async function resolveCommentMergeTokens(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string | null | undefined,
  userId: string | null | undefined,
  authorType: 'internal' | 'client' | 'unknown' | string | null | undefined,
  note: string
): Promise<string> {
  if (!note || !ticketId || authorType !== 'internal' || !hasMergeTokens(note)) {
    return note;
  }
  const mergeContext = await loadCannedMergeContext(trx, tenant, ticketId, userId);
  return resolveMergeFieldsInNote(note, mergeContext);
}
