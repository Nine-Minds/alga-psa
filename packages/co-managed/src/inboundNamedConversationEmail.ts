import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { allowsContactSenderAttribution } from '@alga-psa/shared/lib/email/senderAuthVerification';
import { parseEmailReply, htmlToVisibleText } from '@alga-psa/shared/lib/email/replyParser';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import { TicketConversationError, conversationUuid, readStoredTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import type { NamedConversationReplyAdmission } from '@alga-psa/shared/services/email/namedConversationReplyAdmission';
import { plainTextContent } from './conversationContent';
import { reviewConversationEmailDraft } from '@alga-psa/shared/lib/tickets/conversationEmailEnvelope';
import { hasNamedConversationReplyHint, qualifiedReplyTokenFromBody } from '@alga-psa/shared/services/email/qualifiedReplyAdmission';
import { isNamedConversationCorrespondent, rememberNamedConversationCorrespondents } from '@alga-psa/shared/services/email/namedConversationCorrespondents';

const RECEIPTS = 'ticket_conversation_inbound_receipts', MESSAGES = 'ticket_conversation_inbound_messages';
class ReplyRejected extends Error {}
const reject = (): never => { throw new ReplyRejected(); };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const normalizeId = (value: string) => `<${value.trim().replace(/^<|>$/g, '')}>`;
const address = (input: { email: string; name?: string }) => {
  const email = input?.email?.trim().toLowerCase(), name = input?.name?.trim();
  if (!email || email.length > 500 || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email) || (name && (name.length > 500 || /[\r\n\0]/.test(name)))) return reject();
  return { email, ...(name ? { name } : {}) };
};
function evidence(email: Parameters<NamedConversationReplyAdmission>[1]['email']) {
  const tokens = new Set<string>();
  for (const content of [email.body?.text, email.body?.html]) {
    const pattern = /(?:ALGA-REPLY-TOKEN[\s:]+|data-alga-reply-token\s*=\s*["']|alga:reply-token:)([^\s<>"'\]]*?)(?=-->|[\s<>"'\]]|$)/gi;
    for (const match of (content ?? '').matchAll(pattern)) tokens.add(match[1]);
  }
  const headers = [...new Set([email.inReplyTo, ...(email.references ?? []).slice().reverse()].filter((value): value is string => Boolean(value))
    .map(normalizeId))];
  if (tokens.size > 100 || headers.length > 100) return reject();
  return { tokens: [...tokens], headers };
}
async function routeFor(trx: Knex.Transaction, tenant: string, providerId: string, email: Parameters<NamedConversationReplyAdmission>[1]['email']) {
  const hints = evidence(email), routes: any[] = [];
  let replyParent: any = null;
  for (const id of hints.headers) {
    const found = await tenantDb(trx, tenant).table('ticket_conversation_email_routes').where({ mailbox_id: providerId, rfc_message_id: id }).forShare().first();
    if (found) routes.push(found);
    else if (/^<conversation-/i.test(id)) return reject();
    // A colleague may reply to a previously accepted vendor message, dropping
    // both our token and the original outgoing reference from the thread.
    const receipts = await tenantDb(trx, tenant).table(RECEIPTS).where({ provider_id: providerId })
      .whereRaw("envelope->>'messageId' = ?", [id]).forShare().select('*');
    if (receipts.length > 1 || (found && receipts.length)) return reject();
    for (const receipt of receipts) {
      const prior = await tenantDb(trx, tenant).table('ticket_conversation_email_routes').where({ mailbox_id: providerId,
        operation_tenant: receipt.route_operation_tenant, operation_id: receipt.route_operation_id }).forShare().first();
      if (!prior) return reject();
      if (!routes.length) replyParent = receipt;
      routes.push(prior);
    }
  }
  if (!routes.length && !hasNamedConversationReplyHint(email)) return null;
  if (hints.tokens.some(token => !/^tc1:[A-Za-z0-9_-]{43}$/.test(token))) return reject();
  for (const token of hints.tokens) {
    const found = await tenantDb(trx, tenant).table('ticket_conversation_email_routes').where({ mailbox_id: providerId, token_hash: digest(token) }).forShare().first();
    if (!found) return reject(); routes.push(found);
  }
  const first = routes[0];
  if (!first || routes.some(row => ['ticket_tenant', 'ticket_id', 'relationship_id', 'conversation_store_tenant', 'conversation_id'].some(key => row[key] !== first[key]))) return reject();
  return { route: first, replyParent, matchedBy: hints.tokens.length ? 'reply_token' as const : 'thread_headers' as const };
}
/** Intake is an organization capability issued by an accepted Send, not a
 * borrowed staff session. Current mailbox, relationship and collaboration scope
 * must still permit receiving into this exact audience/store. */
async function destination(trx: Knex.Transaction, route: any, replyParent?: any) {
  const owner = tenantDb(trx, route.ticket_tenant);
  for (const tenant of new Set<string>([route.tenant, route.ticket_tenant, route.conversation_store_tenant])) await assertCoManagedOperationalWrite(trx, tenant);
  const mailbox = await tenantDb(trx, route.tenant).table('email_providers').where({ id: route.mailbox_id, is_active: true, status: 'connected' }).forShare().first('mailbox');
  if (!mailbox) return reject();
  const ticket = await owner.table('tickets').where('ticket_id', route.ticket_id).forShare().first('board_id');
  if (!ticket) return reject();
  if (route.relationship_id) {
    const relation = await owner.table('co_management_relationships').where({ relationship_id: route.relationship_id, state: 'active' }).whereNull('ended_at').forShare().first();
    if (!relation || ![route.ticket_tenant, relation.sponsor_tenant].includes(route.tenant)) return reject();
    await assertCoManagedOperationalWrite(trx, relation.sponsor_tenant);
    if (route.tenant !== route.ticket_tenant) {
      const work = await owner.table('co_management_ticket_work').where({ relationship_id: route.relationship_id, ticket_id: route.ticket_id }).forShare().first();
      const board = relation.visibility_mode === 'board_scope' ? await owner.table('co_management_board_scopes')
        .where({ relationship_id: route.relationship_id, board_id: ticket.board_id }).forShare().first() : null;
      if (!((work && !work.grant_revoked_at && work.can_collaborate) || board?.can_collaborate)) return reject();
    }
  } else if (route.tenant !== route.ticket_tenant || route.conversation_store_tenant !== route.ticket_tenant) return reject();
  const scope = { trx, storeTenant: route.conversation_store_tenant, ticket: { tenant: route.ticket_tenant, ticketId: route.ticket_id,
    ...(route.relationship_id ? { relationshipId: route.relationship_id } : {}) } };
  const conversation = await readStoredTicketConversation(scope, route.conversation_id, 'update');
  if (conversation.transport !== 'email' || conversation.audience === 'requester' || conversation.mailbox?.tenant !== route.tenant || conversation.mailbox?.id !== route.mailbox_id ||
      (conversation.audience === 'shared_it' && conversation.storeTenant !== route.ticket_tenant) ||
      (conversation.storeTenant !== route.ticket_tenant && (conversation.audience !== 'organization_private' || conversation.storeTenant !== route.tenant))) return reject();
  const source = await tenantDb(trx, conversation.storeTenant).table('ticket_conversation_publications').where({ operation_id: route.operation_id,
    actor_tenant: route.operation_tenant, conversation_id: conversation.conversationId, ticket_tenant: route.ticket_tenant, ticket_id: route.ticket_id, mode: 'send' }).forShare().first();
  if (!source?.email_envelope) return reject();
  const privateStore = conversation.storeTenant !== route.ticket_tenant, store = tenantDb(trx, conversation.storeTenant);
  const thread = await store.table(privateStore ? 'co_management_private_threads' : 'comment_threads')
    .where({ thread_id: source.thread_id, conversation_id: conversation.conversationId }).forShare().first();
  if (!thread || (privateStore && thread.disclosure_operation_id)) return reject();
  const comments = privateStore ? 'co_management_private_comments' : 'comments';
  if (replyParent && (replyParent.conversation_store_tenant !== conversation.storeTenant || replyParent.conversation_id !== conversation.conversationId ||
    replyParent.thread_id !== thread.thread_id || replyParent.ticket_tenant !== route.ticket_tenant || replyParent.ticket_id !== route.ticket_id)) return reject();
  for (const commentId of new Set([source.comment_id, thread.root_comment_id, ...(replyParent ? [replyParent.comment_id] : [])])) {
    const row = await store.table(comments).where({ thread_id: thread.thread_id, comment_id: commentId }).whereNull('deleted_at').forShare().first();
    if (!row || (!privateStore && (row.publish_state !== 'published' || !row.is_internal || thread.collaboration_audience !== conversation.audience))) return reject();
  }
  return { conversation, source: replyParent ? { ...source, comment_id: replyParent.comment_id } : source, privateStore, store };
}
export const admitNamedConversationEmailReply: NamedConversationReplyAdmission = async (outer, input) => {
  if (!outer?.isTransaction || ![input.tenant, input.providerId, input.inboxId].every(conversationUuid)) throw new Error('Named replies require a qualified durable inbox transaction');
  const email = { ...input.email, from: { ...input.email.from }, to: input.email.to.map(value => ({ ...value })), cc: input.email.cc?.map(value => ({ ...value })),
    body: { ...input.email.body }, headers: { ...input.email.headers }, references: [...(input.email.references ?? [])] };
  const sourceAuth = input.senderAuth ? JSON.parse(JSON.stringify(input.senderAuth)) : null;
  input = { ...input, email, senderAuth: sourceAuth };
  try {
    return await outer.transaction(async trx => {
      const home = tenantDb(trx, input.tenant);
      const resolved = await routeFor(trx, input.tenant, input.providerId, email);
      if (!resolved) {
        // Explicit cm1/cm2 tokens retain their existing guarded admission. A
        // subject or bare sender address never chooses a vendor destination.
        if (qualifiedReplyTokenFromBody(email.body) || !await isNamedConversationCorrespondent(trx, input.tenant, input.providerId, email.from.email)) return null;
        return { outcome: 'quarantined' as const, reason: 'conversation_reply_requires_admission' as const, matchedBy: 'correspondent' as const };
      }
      if (!allowsContactSenderAttribution(sourceAuth)) return reject();
      const from = address(email.from);
      const inbox = await home.table('inbound_email_inbox').where({ inbox_id: input.inboxId, provider_id: input.providerId, status: 'processing' }).forUpdate().first();
      if (!inbox?.source_object_key || !inbox.source_sha256 || inbox.source_sha256 !== email.sourceSha256 || email.tenant !== input.tenant || email.providerId !== input.providerId) return reject();
      const { route, matchedBy, replyParent } = resolved;
      const { conversation, source, privateStore, store } = await destination(trx, route, replyParent);
      const previous = await home.table(RECEIPTS).where({ provider_id: input.providerId, normalized_message_id: inbox.normalized_message_id }).forShare().first();
      if (previous) {
        if (previous.source_sha256 !== inbox.source_sha256 || previous.conversation_store_tenant !== conversation.storeTenant || previous.conversation_id !== conversation.conversationId) return reject();
        return { outcome: 'replied' as const, ticketId: previous.ticket_id, commentId: previous.comment_id, matchedBy };
      }
      const routing = (await home.table('email_providers').select('mailbox')).map(row => String(row.mailbox).trim().toLowerCase());
      const headers = Object.fromEntries(Object.entries(email.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
      if (routing.includes(from.email) || (headers['auto-submitted'] && headers['auto-submitted'].trim().toLowerCase() !== 'no') ||
          /^(bulk|junk|list)$/i.test(headers.precedence?.trim() ?? '')) return { outcome: 'skipped' as const, reason: 'self_notification' as const };
      const parsed = parseEmailReply({ text: email.body.text ?? '', html: email.body.html });
      const text = (parsed.sanitizedText ?? (email.body.text?.trim() ? '' : htmlToVisibleText(parsed.sanitizedHtml ?? ''))).trim();
      if (!text) return { outcome: 'skipped' as const, reason: 'self_notification' as const };
      if (text.length > 100000 || text.includes('\0') || typeof email.subject !== 'string' || email.subject.length > 998 || /[\r\n\0]/.test(email.subject)) return reject();
      const to = email.to.map(address), cc = (email.cc ?? []).map(address);
      const rfcId = inbox.rfc_message_id?.trim();
      const messageId = rfcId && /^<[^<>\s@]+@[^<>\s@]+>$/.test(rfcId) ? rfcId : null;
      const envelope = { from, to, cc, subject: email.subject, messageId, receivedAt: email.receivedAt };
      const proposed = reviewConversationEmailDraft({ subject: (email.subject || conversation.name).slice(0,255), to: [from.email, ...to.map(value => value.email)], cc: cc.map(value => value.email) }, routing);
      let commentId: string;
      if (privateStore) {
        commentId = randomUUID();
        await store.table('co_management_private_comments').insert({ tenant: conversation.storeTenant, comment_id: commentId, thread_id: source.thread_id,
          parent_comment_id: source.comment_id, actor_kind: 'external', actor_user_id: null, external_author_email: from.email,
          actor_display_name: from.name || from.email, actor_organization_name: 'External correspondent', ...plainTextContent(text), revision: 1 });
        await store.table('co_management_private_threads').where('thread_id', source.thread_id).update({ last_activity_at: trx.fn.now() });
      } else {
        // The canonical model retains reply-root, publication and internal
        // visibility invariants. No requester lifecycle or ticket-wide email runs.
        const saved = await TicketModel.createComment({ ticket_id: route.ticket_id, parent_comment_id: source.comment_id, content: plainTextContent(text).note,
          is_internal: true, is_resolution: false, collaboration_audience: conversation.audience,
          metadata: { source: 'named_conversation_email' } }, route.ticket_tenant, trx);
        commentId = saved.comment_id;
      }
      await store.table(MESSAGES).insert({ tenant: conversation.storeTenant, comment_id: commentId, thread_id: source.thread_id,
        conversation_id: conversation.conversationId, ticket_tenant: route.ticket_tenant, ticket_id: route.ticket_id,
        mailbox_tenant: input.tenant, mailbox_id: input.providerId, inbox_id: input.inboxId, envelope: JSON.stringify(envelope), proposed_recipients: JSON.stringify(proposed) });
      await home.table(RECEIPTS).insert({ tenant: input.tenant, inbox_id: input.inboxId, provider_id: input.providerId, normalized_message_id: inbox.normalized_message_id,
        source_sha256: inbox.source_sha256, ticket_tenant: route.ticket_tenant, ticket_id: route.ticket_id, relationship_id: route.relationship_id,
        conversation_store_tenant: conversation.storeTenant, conversation_id: conversation.conversationId, thread_id: source.thread_id, comment_id: commentId,
        route_operation_tenant: route.operation_tenant, route_operation_id: route.operation_id, sender_auth: JSON.stringify(sourceAuth), envelope: JSON.stringify(envelope) });
      await rememberNamedConversationCorrespondents(trx, route, [from]);
      await store.table('ticket_conversations').where('conversation_id', conversation.conversationId).update({ status: 'open',
        revision: conversation.revision + (conversation.status === 'done' ? 1 : 0), message_version: trx.raw('message_version + 1'), updated_at: trx.fn.now() });
      return { outcome: 'replied' as const, ticketId: route.ticket_id, commentId, matchedBy };
    });
  } catch (error) {
    if (!(error instanceof ReplyRejected) && !(error instanceof TicketConversationError && error.code === 'CONVERSATION_FORBIDDEN')) throw error;
    return { outcome: 'quarantined', reason: 'conversation_reply_requires_admission', matchedBy: /tc1:/i.test(`${email.body.text ?? ''}${email.body.html ?? ''}`) ? 'reply_token' : 'thread_headers' };
  }
};
