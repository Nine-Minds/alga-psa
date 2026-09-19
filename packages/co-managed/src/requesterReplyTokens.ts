import type { Knex } from 'knex';
import { randomBytes } from 'node:crypto';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import { allowsContactSenderAttribution, type SenderAuthResults } from '@alga-psa/shared/lib/email/senderAuthVerification';
import { withCoManagedRequesterCommentEmail, type CoManagedRequesterEmailRecipient } from './requesterCommentEmail';
import type { CoManagedCustomerTicketResource } from './customerCommentNotification';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

const TABLE = 'co_management_requester_reply_tokens';
const TOKEN = /^cm1:[A-Za-z0-9_-]{43}$/;
const normalize = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
function activeToken(trx: Knex.Transaction, tenant: string, token: string) {
  return tenantDb(trx, tenant).table(TABLE).where('token', token).whereNull('revoked_at')
    .where(query => query.whereNull('expires_at').orWhere('expires_at', '>', trx.raw('clock_timestamp()')));
}
const IDENTITY = ['tenant', 'delivery_key', 'recipient_kind', 'client_id', 'recipient_id', 'recipient_email', 'ticket_id', 'thread_id', 'comment_id'] as const;

// LEVERAGE: pattern qualified-email-reply-token — requester and technician tokens bind immutable delivery/address/source identities under distinct authority.
/** Issue within the delivery's owning transaction and send only after commit.
 * A provider acknowledgement loss reuses the same token for the same delivery
 * and address. Address changes get distinct tokens; old mail cannot authorize
 * the new address. A token alone never grants a reply or an interactive session. */
export async function issueCoManagedRequesterReplyToken(db: Knex, input: {
  recipient: CoManagedRequesterEmailRecipient; resource: CoManagedCustomerTicketResource; commentId: string; deliveryKey: string;
}): Promise<{ token: string; email: string } | null> {
  if (!input || typeof input.deliveryKey !== 'string' || !input.deliveryKey.trim() || input.deliveryKey.length > 300) throw new CoManagedSharedWorkError();
  const deliveryKey = input.deliveryKey;
  return withCoManagedRequesterCommentEmail(db, input.recipient, input.resource, input.commentId, async (context, message) => {
    const { recipient } = context;
    const values = { tenant: recipient.tenant, delivery_key: deliveryKey, recipient_kind: recipient.kind, client_id: recipient.clientId,
      recipient_id: recipient.kind === 'requester_contact' ? recipient.contactId : recipient.locationId, recipient_email: normalize(context.email),
      ticket_id: message.resource.id, thread_id: message.threadId, comment_id: message.commentId };
    const owner = tenantDb(context.trx, recipient.tenant);
    await owner.table(TABLE).insert({ ...values, token: `cm1:${randomBytes(32).toString('base64url')}` })
      .onConflict(['tenant', 'delivery_key', 'recipient_email']).ignore();
    const row = await owner.table(TABLE).where({ delivery_key: deliveryKey, recipient_email: values.recipient_email }).forShare().first();
    if (!row || IDENTITY.some(key => row[key] !== values[key])) throw new Error('Requester reply token identity conflict');
    if (!await activeToken(context.trx, recipient.tenant, row.token).first('token')) return null;
    return { token: row.token, email: context.email };
  });
}

export interface CoManagedRequesterReplyContext {
  trx: Knex.Transaction;
  recipient: CoManagedRequesterEmailRecipient;
  resource: CoManagedCustomerTicketResource;
  parentCommentId: string;
  threadId: string;
  senderEmail: string;
}
/** Authentication results must be derived by the trusted receiving-MTA adapter,
 * never accepted from an API request. The callback must perform every reply
 * mutation in this transaction. Rejection is terminal for this token: an inbound
 * adapter must quarantine it, not retry native token/header/subject matching. */
export async function withCoManagedRequesterEmailReply<T>(db: Knex, input: {
  tenant: string; token: string; senderEmail: string; senderAuth: SenderAuthResults | null;
}, reply: (context: CoManagedRequesterReplyContext) => Promise<T>): Promise<T> {
  if (!input || !isCoManagedUuid(input.tenant) || typeof input.token !== 'string' || !TOKEN.test(input.token) ||
      !input.senderAuth?.aligned || !allowsContactSenderAttribution(input.senderAuth)) throw new CoManagedSharedWorkError();
  const tenant = input.tenant, token = input.token, senderEmail = normalize(input.senderEmail);
  if (!senderEmail) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    // Follow mutation lock order: lifecycle/tenant, ticket, thread, then source
    // and recipient. A token read is not a substitute for current write admission.
    await assertCoManagedOperationalWrite(trx, tenant);
    const owner = tenantDb(trx, tenant);
    const found = await owner.table(TABLE).where('token', token).first();
    if (!found || found.recipient_email !== senderEmail) throw new CoManagedSharedWorkError();
    if (!await owner.table('tickets').where('ticket_id', found.ticket_id).forUpdate().first('ticket_id') ||
        !await owner.table('comment_threads').where({ ticket_id: found.ticket_id, thread_id: found.thread_id }).forUpdate().first('thread_id')) throw new CoManagedSharedWorkError();
    const row = await activeToken(trx, tenant, token).forShare().first();
    if (!row || IDENTITY.some(key => row[key] !== found[key])) throw new CoManagedSharedWorkError();
    if (!['requester_contact', 'requester_location'].includes(row.recipient_kind)) throw new CoManagedSharedWorkError();
    const recipient: CoManagedRequesterEmailRecipient = row.recipient_kind === 'requester_contact'
      ? { kind: 'requester_contact', tenant, clientId: row.client_id, contactId: row.recipient_id }
      : { kind: 'requester_location', tenant, clientId: row.client_id, locationId: row.recipient_id };
    const resource: CoManagedCustomerTicketResource = { tenant, kind: 'ticket', id: row.ticket_id };
    const admitted = await withCoManagedRequesterCommentEmail(trx, recipient, resource, row.comment_id, async (context, message) => {
      if (normalize(context.email) !== senderEmail || message.threadId !== row.thread_id) throw new CoManagedSharedWorkError();
      await assertCoManagedOperationalWrite(trx, tenant);
      // Expiry is checked after waits, using database time rather than cached input.
      if (!await activeToken(trx, tenant, token).first('token')) throw new CoManagedSharedWorkError();
      const result = await reply({ trx, recipient, resource, parentCommentId: row.comment_id, threadId: row.thread_id, senderEmail });
      await assertCoManagedOperationalWrite(trx, tenant);
      if (!await activeToken(trx, tenant, token).first('token')) throw new CoManagedSharedWorkError();
      return { result };
    });
    if (!admitted) throw new CoManagedSharedWorkError();
    return admitted.result;
  });
}
