import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

type Conn = Knex | Knex.Transaction;

/**
 * Tenant-scoped lookup of the comment a reaction targets.
 *
 * When `ticketId` is given the comment must also belong to that ticket, so a comment that
 * exists under a different ticket is indistinguishable from a missing one (both return
 * `undefined`). Access checks stay with the caller: authorize the ticket with the
 * authorizer that suits the principal, then call this.
 */
export async function findReactionComment(
  trx: Conn,
  tenant: string,
  commentId: string,
  ticketId?: string,
): Promise<Record<string, any> | undefined> {
  const where: Record<string, string> = { comment_id: commentId };
  if (ticketId !== undefined) where.ticket_id = ticketId;
  return tenantDb(trx, tenant).table('comments').where(where).first();
}
