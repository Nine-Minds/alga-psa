import type { Knex } from 'knex';
import { randomBytes } from 'node:crypto';
import { tenantDb, withTransaction, withSavepoint } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import { allowsContactSenderAttribution, type SenderAuthResults } from '@alga-psa/shared/lib/email/senderAuthVerification';
import type { AuthorizationRecord } from '@alga-psa/authorization';
import type { CoManagedNotificationRecipient } from './sharedWork';
import { withCoManagedCustomerCommentNotification, type CoManagedCustomerTicketResource } from './customerCommentNotification';
import { authorizeCoManagedWorkRecord, CoManagedSharedWorkError, isCoManagedUuid, lockCoManagedRecipientIdentity } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import type { TicketCommentAudience } from './ticketCommentNotificationContent';

const TABLE = 'co_management_customer_reply_tokens';
const TOKEN = /^cm2:[A-Za-z0-9_-]{43}$/;
const normalize = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const IDENTITY = ['tenant', 'delivery_key', 'recipient_user_id', 'recipient_email', 'ticket_id', 'thread_id', 'comment_id', 'audience'] as const;
function activeToken(trx: Knex.Transaction, tenant: string, token: string) {
  return tenantDb(trx, tenant).table(TABLE).where('token', token).whereNull('revoked_at')
    .where(query => query.whereNull('expires_at').orWhere('expires_at', '>', trx.raw('clock_timestamp()')));
}

// LEVERAGE: pattern qualified-email-reply-token — requester and technician tokens bind immutable delivery/address/source identities under distinct authority.
/** Prepare in the owning delivery transaction, then commit before exposing the
 * token to a mail provider. Issuance grants no update permission or session. */
export async function issueCoManagedCustomerReplyToken(db: Knex, input: {
  recipient: CoManagedNotificationRecipient; resource: CoManagedCustomerTicketResource; commentId: string; deliveryKey: string;
}): Promise<{ token: string; email: string } | null> {
  if (!input || typeof input.deliveryKey !== 'string' || !input.deliveryKey.trim() || input.deliveryKey.length > 300) throw new CoManagedSharedWorkError();
  const deliveryKey = input.deliveryKey;
  return withCoManagedCustomerCommentNotification(db, input.recipient, input.resource, input.commentId, async (context, message) => {
    const owner = tenantDb(context.trx, context.actor.tenant);
    const user = await owner.table('users').where('user_id', context.actor.userId).first('email');
    const email = normalize(user?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    const values = { tenant: context.actor.tenant, delivery_key: deliveryKey, recipient_user_id: context.actor.userId, recipient_email: email,
      ticket_id: message.resource.id, thread_id: message.threadId, comment_id: message.commentId, audience: message.audience };
    await owner.table(TABLE).insert({ ...values, token: `cm2:${randomBytes(32).toString('base64url')}` })
      .onConflict(['tenant', 'delivery_key', 'recipient_email']).ignore();
    const row = await owner.table(TABLE).where({ delivery_key: deliveryKey, recipient_email: email }).forShare().first();
    if (!row || IDENTITY.some(key => row[key] !== values[key])) throw new Error('Customer technician reply token identity conflict');
    if (!await activeToken(context.trx, values.tenant, row.token).first('token')) return null;
    return { token: row.token, email };
  });
}

export interface CoManagedCustomerReplyContext {
  trx: Knex.Transaction;
  actor: { tenant: string; userId: string };
  resource: CoManagedCustomerTicketResource;
  parentCommentId: string;
  threadId: string;
  audience: TicketCommentAudience;
  senderEmail: string;
}
/** Receiving-MTA authentication plus the original token/address identifies the
 * current customer user. Current read AND update RBAC/bundle policy admit the
 * specific thread; no MSP trust or borrowed interactive session is involved.
 * All writer effects must use this transaction. Rejection must never fall
 * through to unqualified email matching. The savepoint also rolls back writes
 * when a caller catches a late rejection in an enclosing inbox transaction. */
export async function withCoManagedCustomerEmailReply<T>(db: Knex, input: {
  tenant: string; token: string; senderEmail: string; senderAuth: SenderAuthResults | null;
}, reply: (context: CoManagedCustomerReplyContext) => Promise<T>): Promise<T> {
  if (!input || !isCoManagedUuid(input.tenant) || typeof input.token !== 'string' || !TOKEN.test(input.token) ||
      !input.senderAuth?.aligned || !allowsContactSenderAttribution(input.senderAuth)) throw new CoManagedSharedWorkError();
  const tenant = input.tenant, token = input.token, senderEmail = normalize(input.senderEmail);
  if (!senderEmail) throw new CoManagedSharedWorkError();
  return withTransaction(db, outer => withSavepoint(outer, async trx => {
    await assertCoManagedOperationalWrite(trx, tenant);
    const owner = tenantDb(trx, tenant);
    const found = await owner.table(TABLE).where('token', token).first();
    if (!found || found.recipient_email !== senderEmail) throw new CoManagedSharedWorkError();
    const ticket = await owner.table('tickets').where('ticket_id', found.ticket_id).forUpdate()
      .first('ticket_id', 'client_id', 'board_id', 'entered_by', 'assigned_to', 'assigned_team_id');
    if (!ticket || !await owner.table('comment_threads').where({ ticket_id: found.ticket_id, thread_id: found.thread_id }).forUpdate().first('thread_id')) throw new CoManagedSharedWorkError();
    const row = await activeToken(trx, tenant, token).forShare().first();
    if (!row || IDENTITY.some(key => row[key] !== found[key])) throw new CoManagedSharedWorkError();
    const actor = { tenant, userId: row.recipient_user_id };
    const subject = await lockCoManagedRecipientIdentity(trx, actor);
    if (normalize((await owner.table('users').where('user_id', actor.userId).first('email'))?.email) !== senderEmail) throw new CoManagedSharedWorkError();
    // LEVERAGE: pattern customer-ticket-policy-record — customer reply writes use the same current projection as local commands and notification reads.
    const record: AuthorizationRecord = { id: ticket.ticket_id, clientId: ticket.client_id, boardId: ticket.board_id,
      ownerUserId: ticket.entered_by, assignedUserIds: ticket.assigned_to ? [ticket.assigned_to] : [],
      teamIds: ticket.assigned_team_id ? [ticket.assigned_team_id] : [] };
    const update = await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', 'update', record);
    if (isCoManagedReadFieldHidden(update.redactedFields, ['conversation', 'comments', 'comment_threads', 'note', 'markdown_content',
      'thread_id', 'parent_comment_id', 'created_at', 'updated_at', 'collaboration_audience'])) throw new CoManagedSharedWorkError();
    const resource: CoManagedCustomerTicketResource = { tenant, kind: 'ticket', id: row.ticket_id };
    const admitted = await withCoManagedCustomerCommentNotification(trx, { kind: 'notification_recipient', ...actor }, resource, row.comment_id, async (_, message) => {
      // A later disclosure must not turn an answer to an IT-only email into a
      // requester-facing reply. The author must compose again in current UI.
      if (message.threadId !== row.thread_id || message.audience !== row.audience) throw new CoManagedSharedWorkError();
      await assertCoManagedOperationalWrite(trx, tenant);
      if (!await activeToken(trx, tenant, token).first('token')) throw new CoManagedSharedWorkError();
      const result = await reply({ trx, actor, resource, parentCommentId: row.comment_id, threadId: row.thread_id, audience: message.audience, senderEmail });
      await assertCoManagedOperationalWrite(trx, tenant);
      if (!await activeToken(trx, tenant, token).first('token')) throw new CoManagedSharedWorkError();
      return { result };
    });
    if (!admitted) throw new CoManagedSharedWorkError();
    return admitted.result;
  }));
}
