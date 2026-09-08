import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { allowsContactSenderAttribution, allowsInternalSenderAttribution } from '@alga-psa/shared/lib/email/senderAuthVerification';
import { parseEmailReply, htmlToVisibleText } from '@alga-psa/shared/lib/email/replyParser';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import { TicketConversationError, conversationUuid, readStoredTicketConversation, ensureDefaultTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import type { NamedConversationReplyAdmission } from '@alga-psa/shared/services/email/namedConversationReplyAdmission';
import { plainTextContent } from './conversationContent';
import { reviewConversationEmailDraft } from '@alga-psa/shared/lib/tickets/conversationEmailEnvelope';
import { hasNamedConversationReplyHint, qualifiedReplyTokenFromBody } from '@alga-psa/shared/services/email/qualifiedReplyAdmission';
import { isNamedConversationCorrespondent, rememberNamedConversationCorrespondents } from '@alga-psa/shared/services/email/namedConversationCorrespondents';
import { admitNamedRequesterReplyIdentity } from './namedRequesterReplyIdentity';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';

const RECEIPTS = 'ticket_conversation_inbound_receipts', MESSAGES = 'ticket_conversation_inbound_messages';
class ReplyRejected extends Error {}
const reject = (): never => { throw new ReplyRejected(); };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const normalizeId = (value: string) => `<${value.trim().replace(/^<|>$/g, '')}>`;
const destinationKey = (row: any) => JSON.stringify([row.ticket_tenant, row.ticket_id, row.conversation_store_tenant, row.conversation_id]);
const conversationKey = (conversation: Awaited<ReturnType<typeof readStoredTicketConversation>>) =>
  JSON.stringify([conversation.ticket.tenant, conversation.ticket.ticketId, conversation.storeTenant, conversation.conversationId]);
const followupHash = (route: any, inboxId: string, ticketId: string, conversationId: string, parentTicketId: string, parentCommentId: string) =>
  digest(JSON.stringify(['named-requester-followup', route.tenant, route.mailbox_id, route.operation_tenant, route.operation_id,
    inboxId, ticketId, conversationId, parentTicketId, parentCommentId]));
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
  const hints = evidence(email), routes: { route: any; replyParent: any }[] = [];
  for (const id of hints.headers) {
    const found = await tenantDb(trx, tenant).table('ticket_conversation_email_routes').where({ mailbox_id: providerId, rfc_message_id: id }).forShare().first();
    if (found) routes.push({ route: found, replyParent: null });
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
      routes.push({ route: prior, replyParent: receipt });
    }
  }
  if (!routes.length && !hasNamedConversationReplyHint(email)) return null;
  if (hints.tokens.some(token => !/^tc1:[A-Za-z0-9_-]{43}$/.test(token))) return reject();
  for (const token of hints.tokens) {
    const found = await tenantDb(trx, tenant).table('ticket_conversation_email_routes').where({ mailbox_id: providerId, token_hash: digest(token) }).forShare().first();
    if (!found) return reject(); routes.push({ route: found, replyParent: null });
  }
  const first = routes[0];
  if (!first) return reject();
  const selected = await destination(trx, first.route, first.replyParent);
  // References retain older messages when a cutoff creates a follow-up. Only
  // proven ancestors may accompany the nearest destination; sibling tickets or
  // unrelated conversations remain ambiguous, even if their subjects match.
  for (const candidate of routes.slice(1)) {
    const admitted = await destination(trx, candidate.route, candidate.replyParent);
    const key = conversationKey(admitted.conversation);
    if (key !== conversationKey(selected.conversation) && !selected.ancestors.includes(key)) return reject();
  }
  return { ...first, matchedBy: hints.tokens.length ? 'reply_token' as const : 'thread_headers' as const };
}
/** Intake is an organization capability issued by an accepted Send, not a
 * borrowed staff session. Current mailbox, relationship and collaboration scope
 * must still permit receiving into this exact audience/store. */
export async function readNamedConversationEmailDestination(trx: Knex.Transaction, route: any, replyParent?: any) {
  try { return await destination(trx, route, replyParent); }
  catch (error) {
    if (error instanceof ReplyRejected) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
    throw error;
  }
}
async function destination(trx: Knex.Transaction, route: any, replyParent?: any, depth = 0): Promise<{
  conversation: Awaited<ReturnType<typeof readStoredTicketConversation>>; source: any; privateStore: boolean;
  store: ReturnType<typeof tenantDb>; ancestors: string[];
}> {
  if (depth > 32) return reject();
  if (replyParent && (replyParent.tenant !== route.tenant || replyParent.provider_id !== route.mailbox_id ||
    replyParent.route_operation_tenant !== route.operation_tenant || replyParent.route_operation_id !== route.operation_id)) return reject();
  const owner = tenantDb(trx, route.ticket_tenant);
  for (const tenant of new Set<string>([route.tenant, route.ticket_tenant, route.conversation_store_tenant])) await assertCoManagedOperationalWrite(trx, tenant);
  const mailbox = await tenantDb(trx, route.tenant).table('email_providers').where({ id: route.mailbox_id, is_active: true, status: 'connected' }).forShare().first('mailbox');
  if (!mailbox) return reject();
  const ticket = await owner.table('tickets').where('ticket_id', route.ticket_id).forShare().first('board_id', 'client_id');
  if (!ticket) return reject();
  const requesterRoute = route.tenant === route.ticket_tenant && route.conversation_store_tenant === route.ticket_tenant &&
    (await owner.table('ticket_conversations').where({ conversation_id: route.conversation_id, ticket_id: route.ticket_id }).first('audience'))?.audience === 'requester';
  if (route.relationship_id && !requesterRoute) {
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
  if (requesterRoute && conversation.audience !== 'requester') return reject();
  if (conversation.transport !== 'email' || (conversation.audience === 'requester' && !requesterRoute) || conversation.mailbox?.tenant !== route.tenant || conversation.mailbox?.id !== route.mailbox_id ||
      (conversation.audience === 'shared_it' && conversation.storeTenant !== route.ticket_tenant) ||
      (conversation.storeTenant !== route.ticket_tenant && (conversation.audience !== 'organization_private' || conversation.storeTenant !== route.tenant))) return reject();
  const source = await tenantDb(trx, conversation.storeTenant).table('ticket_conversation_publications').where({ operation_id: route.operation_id,
    actor_tenant: route.operation_tenant, conversation_id: conversation.conversationId, ticket_tenant: route.ticket_tenant, ticket_id: route.ticket_id, mode: 'send' }).forShare().first();
  if (!source?.email_envelope) return reject();
  // The accepted Send fixes its audience. A later disclosure must not turn an
  // answer to a vendor email into a requester reply (or the reverse). Older
  // routes predate requester Send and can only retain side-conversation intake.
  if (source.email_envelope.audience ? source.email_envelope.audience !== conversation.audience : conversation.audience === 'requester') return reject();
  const privateStore = conversation.storeTenant !== route.ticket_tenant, store = tenantDb(trx, conversation.storeTenant);
  const thread = await store.table(privateStore ? 'co_management_private_threads' : 'comment_threads')
    .where({ thread_id: source.thread_id, conversation_id: conversation.conversationId }).forShare().first();
  if (!thread || (privateStore && thread.disclosure_operation_id)) return reject();
  const comments = privateStore ? 'co_management_private_comments' : 'comments';
  const followup = replyParent && destinationKey(replyParent) !== destinationKey(route);
  if (replyParent && !followup && replyParent.thread_id !== thread.thread_id) return reject();
  for (const commentId of new Set([source.comment_id, thread.root_comment_id, ...(replyParent && !followup ? [replyParent.comment_id] : [])])) {
    const row = await store.table(comments).where({ thread_id: thread.thread_id, comment_id: commentId }).whereNull('deleted_at').forShare().first();
    if (!row || (!privateStore && (row.publish_state !== 'published' || row.is_internal !== (conversation.audience !== 'requester') || thread.collaboration_audience !== conversation.audience))) return reject();
  }
  let sourceAncestors: string[] = [];
  if (requesterRoute) {
    const binding = await owner.table('ticket_conversations').where('conversation_id', conversation.conversationId).first('creation_hash', 'created_by_user_id');
    if (binding?.creation_hash && !binding.created_by_user_id) {
      const first = await owner.table(RECEIPTS).where('conversation_id', conversation.conversationId)
        .whereIn('comment_id', owner.table('comment_threads').where('conversation_id', conversation.conversationId).select('root_comment_id'))
        .orderBy('created_at').forShare().first();
      const originRoute = first && await owner.table('ticket_conversation_email_routes').where({ mailbox_id: first.provider_id,
        operation_tenant: first.route_operation_tenant, operation_id: first.route_operation_id }).forShare().first();
      if (!originRoute || destinationKey(originRoute) === conversationKey(conversation)) return reject();
      const origin = await destination(trx, originRoute, first, depth + 1);
      if (conversationKey(origin.conversation) !== conversationKey(conversation)) return reject();
      sourceAncestors = origin.ancestors;
    }
  }
  if (followup) {
    if (!requesterRoute || replyParent.ticket_tenant !== route.ticket_tenant || replyParent.conversation_store_tenant !== route.ticket_tenant ||
        replyParent.route_operation_tenant !== route.operation_tenant || replyParent.route_operation_id !== route.operation_id) return reject();
    const selected = await readStoredTicketConversation({ trx, storeTenant: route.ticket_tenant,
      ticket: { tenant: route.ticket_tenant, ticketId: replyParent.ticket_id } }, replyParent.conversation_id, 'update');
    if (selected.audience !== 'requester' || selected.transport !== 'email' || selected.mailbox?.tenant !== route.tenant || selected.mailbox?.id !== route.mailbox_id) return reject();
    if ((await owner.table('tickets').where('ticket_id', selected.ticket.ticketId).forShare().first('client_id'))?.client_id !== ticket.client_id) return reject();
    const targetThread = await owner.table('comment_threads').where({ ticket_id: replyParent.ticket_id, conversation_id: selected.conversationId,
      thread_id: replyParent.thread_id, collaboration_audience: 'requester' }).forShare().first();
    if (!targetThread) return reject();
    const root = await owner.table('comments').where({ thread_id: targetThread.thread_id, comment_id: targetThread.root_comment_id,
      publish_state: 'published', is_internal: false }).whereNull('deleted_at').forShare().first();
    const retained = await tenantDb(trx, route.tenant).table(RECEIPTS).where({ comment_id: targetThread.root_comment_id,
      conversation_id: selected.conversationId, provider_id: route.mailbox_id, route_operation_tenant: route.operation_tenant,
      route_operation_id: route.operation_id }).forShare().first();
    const parent = root?.metadata?.qualifiedReply;
    if (!retained || !parent || !['requester', 'customer_technician'].includes(parent.kind)) return reject();
    const binding = await owner.table('ticket_conversations').where('conversation_id', selected.conversationId).first('creation_hash');
    if (binding?.creation_hash !== followupHash(route, retained.inbox_id, selected.ticket.ticketId, selected.conversationId,
      parent.sourceTicketId, parent.sourceParentCommentId)) return reject();
    const prior = await tenantDb(trx, route.tenant).table(RECEIPTS).where({ provider_id: route.mailbox_id,
      ticket_id: parent.sourceTicketId, comment_id: parent.sourceParentCommentId,
      route_operation_tenant: route.operation_tenant, route_operation_id: route.operation_id }).forShare().first();
    let ancestors = [...sourceAncestors, conversationKey(conversation)];
    if (prior) {
      const preceding = await destination(trx, route, prior, depth + 1);
      ancestors = [...preceding.ancestors, conversationKey(preceding.conversation)];
    } else if (parent.sourceTicketId !== route.ticket_id || parent.sourceParentCommentId !== source.comment_id) return reject();
    const target = await owner.table('comments').where({ comment_id: replyParent.comment_id, thread_id: targetThread.thread_id,
      publish_state: 'published', is_internal: false }).whereNull('deleted_at').forShare().first();
    if (!target) return reject();
    return { conversation: selected, source: { ...source, comment_id: target.comment_id, thread_id: targetThread.thread_id }, privateStore: false, store: owner, ancestors };
  }
  return { conversation, source: replyParent ? { ...source, comment_id: replyParent.comment_id } : source, privateStore, store, ancestors: sourceAncestors };
}
export const admitNamedConversationEmailReply: NamedConversationReplyAdmission = (outer, input, writeRequester) => admitReply(outer, input, undefined, writeRequester);

/** Trusted review composition supplies a route only after retaining mailbox
 * administrator and destination authority. The writer still admits the source,
 * sender authentication, current route/audience and publication atomically. */
export const admitReviewedNamedConversationEmailReply = (outer: Knex.Transaction, input: Parameters<NamedConversationReplyAdmission>[1], route: any) =>
  admitReply(outer, input, route);

async function admitReply(outer: Knex.Transaction, input: Parameters<NamedConversationReplyAdmission>[1], reviewedRoute?: any,
  writeRequester?: Parameters<NamedConversationReplyAdmission>[2]): ReturnType<NamedConversationReplyAdmission> {
  if (!outer?.isTransaction || ![input.tenant, input.providerId, input.inboxId].every(conversationUuid)) throw new Error('Named replies require a qualified durable inbox transaction');
  const email = { ...input.email, from: { ...input.email.from }, to: input.email.to.map(value => ({ ...value })), cc: input.email.cc?.map(value => ({ ...value })),
    body: { ...input.email.body }, headers: { ...input.email.headers }, references: [...(input.email.references ?? [])] };
  const sourceAuth = input.senderAuth ? JSON.parse(JSON.stringify(input.senderAuth)) : null;
  input = { ...input, email, senderAuth: sourceAuth };
  try {
    return await outer.transaction(async trx => {
      const home = tenantDb(trx, input.tenant);
      const resolved = reviewedRoute ? { route: reviewedRoute, matchedBy: 'manual_review' as const, replyParent: null } : await routeFor(trx, input.tenant, input.providerId, email);
      if (!resolved) {
        // Explicit cm1/cm2 tokens retain their existing guarded admission. A
        // subject or bare sender address never chooses a vendor destination.
        if (qualifiedReplyTokenFromBody(email.body) || !await isNamedConversationCorrespondent(trx, input.tenant, input.providerId, email.from.email)) return null;
        return { outcome: 'quarantined' as const, reason: 'conversation_reply_requires_admission' as const, matchedBy: 'correspondent' as const };
      }
      if (!allowsContactSenderAttribution(sourceAuth) && !allowsInternalSenderAttribution(sourceAuth)) return reject();
      const from = address(email.from);
      const inbox = await home.table('inbound_email_inbox').where({ inbox_id: input.inboxId, provider_id: input.providerId, status: 'processing' }).forUpdate().first();
      if (!inbox?.source_object_key || !inbox.source_sha256 || inbox.source_sha256 !== email.sourceSha256 || email.tenant !== input.tenant || email.providerId !== input.providerId) return reject();
      const { route, matchedBy, replyParent } = resolved;
      if (route.tenant !== input.tenant || route.mailbox_id !== input.providerId) return reject();
      let { conversation, source, privateStore, store } = await readNamedConversationEmailDestination(trx, route, replyParent);
      if (conversation.audience !== 'requester' && !allowsContactSenderAttribution(sourceAuth)) return reject();
      const previous = await home.table(RECEIPTS).where({ provider_id: input.providerId, normalized_message_id: inbox.normalized_message_id }).forShare().first();
      if (previous) {
        if (previous.source_sha256 !== inbox.source_sha256 || previous.route_operation_tenant !== route.operation_tenant || previous.route_operation_id !== route.operation_id) return reject();
        await readNamedConversationEmailDestination(trx, route, previous);
        return { outcome: 'replied' as const, ticketId: previous.ticket_id, commentId: previous.comment_id, matchedBy };
      }
      const routing = (await home.table('email_providers').select('mailbox')).map(row => String(row.mailbox).trim().toLowerCase());
      const headers = Object.fromEntries(Object.entries(email.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
      if (routing.includes(from.email) || (conversation.audience !== 'requester' && ((headers['auto-submitted'] && headers['auto-submitted'].trim().toLowerCase() !== 'no') ||
          /^(bulk|junk|list)$/i.test(headers.precedence?.trim() ?? '')))) return { outcome: 'skipped' as const, reason: 'self_notification' as const };
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
      let requesterResult: Awaited<ReturnType<NonNullable<typeof writeRequester>>> | undefined;
      if (conversation.audience === 'requester') {
        if (!writeRequester) throw new Error('Named requester reply requires the canonical inbox writer');
        if (reviewedRoute) return reject();
        const identity = await admitNamedRequesterReplyIdentity(trx, { tenant: conversation.ticket.tenant, ticketId: conversation.ticket.ticketId,
          parentCommentId: source.comment_id, senderEmail: from.email, senderAuth: sourceAuth, envelope: source.email_envelope });
        const origin = conversation;
        let followupConversation: typeof conversation | undefined;
        requesterResult = await writeRequester({ ...identity, prepareFollowupConversation: async target => {
          await identity.assertDestination(target);
          const scope = { trx, storeTenant: origin.storeTenant, ticket: { tenant: origin.ticket.tenant, ticketId: target.ticketId } };
          let conversationId: string;
          if (origin.defaultSlot === 'requester') conversationId = (await ensureDefaultTicketConversation(scope, 'requester')).conversationId;
          else {
            conversationId = randomUUID();
            await store.table('ticket_conversations').insert({ tenant: origin.storeTenant, conversation_id: conversationId,
              ticket_tenant: origin.ticket.tenant, ticket_id: target.ticketId, name: origin.name, audience: 'requester', transport: 'email' });
          }
          await store.table('ticket_conversations').where('conversation_id', conversationId).update({ mailbox_tenant: input.tenant,
            mailbox_id: input.providerId, creation_hash: followupHash(route, input.inboxId, target.ticketId, conversationId, identity.ticketId, identity.parentCommentId) });
          followupConversation = await readStoredTicketConversation(scope, conversationId, 'update');
          return { conversationId };
        } }, matchedBy === 'thread_headers' ? 'thread_headers' : 'reply_token');
        if (requesterResult.outcome !== 'replied' && requesterResult.outcome !== 'created') return requesterResult;
        if (!requesterResult.commentId || !requesterResult.ticketId) return reject();
        conversation = followupConversation ?? origin;
        if (requesterResult.ticketId !== conversation.ticket.ticketId) return reject();
        const written = await store.table('comments').where({ comment_id: requesterResult.commentId, ticket_id: requesterResult.ticketId,
          publish_state: 'published', is_internal: false }).whereNull('deleted_at').forShare().first();
        if (!written || !await store.table('comment_threads').where({ thread_id: written.thread_id, ticket_id: requesterResult.ticketId,
          conversation_id: conversation.conversationId, collaboration_audience: 'requester' }).forShare().first()) return reject();
        commentId = written.comment_id;
        source = { ...source, thread_id: written.thread_id };
      } else if (privateStore) {
        commentId = randomUUID();
        await store.table('co_management_private_comments').insert({ tenant: conversation.storeTenant, comment_id: commentId, thread_id: source.thread_id,
          parent_comment_id: source.comment_id, actor_kind: 'external', actor_user_id: null, external_author_email: from.email,
          actor_display_name: from.name || from.email, actor_organization_name: 'External correspondent', ...plainTextContent(text), revision: 1 });
        await store.table('co_management_private_threads').where('thread_id', source.thread_id).update({ last_activity_at: trx.fn.now() });
      } else {
        // The canonical model retains reply-root, publication and internal
        // visibility invariants. No requester lifecycle or ticket-wide email runs.
        const saved = await TicketModel.createComment({ ticket_id: conversation.ticket.ticketId, parent_comment_id: source.comment_id, content: plainTextContent(text).note,
          is_internal: true, is_resolution: false, collaboration_audience: conversation.audience,
          metadata: { source: 'named_conversation_email' } }, route.ticket_tenant, trx);
        commentId = saved.comment_id;
      }
      await store.table(MESSAGES).insert({ tenant: conversation.storeTenant, comment_id: commentId, thread_id: source.thread_id,
        conversation_id: conversation.conversationId, ticket_tenant: conversation.ticket.tenant, ticket_id: conversation.ticket.ticketId,
        mailbox_tenant: input.tenant, mailbox_id: input.providerId, inbox_id: input.inboxId, envelope: JSON.stringify(envelope), proposed_recipients: JSON.stringify(proposed) });
      await home.table(RECEIPTS).insert({ tenant: input.tenant, inbox_id: input.inboxId, provider_id: input.providerId, normalized_message_id: inbox.normalized_message_id,
        source_sha256: inbox.source_sha256, ticket_tenant: conversation.ticket.tenant, ticket_id: conversation.ticket.ticketId,
        relationship_id: conversation.audience === 'requester' ? null : route.relationship_id,
        conversation_store_tenant: conversation.storeTenant, conversation_id: conversation.conversationId, thread_id: source.thread_id, comment_id: commentId,
        route_operation_tenant: route.operation_tenant, route_operation_id: route.operation_id, sender_auth: JSON.stringify(sourceAuth), envelope: JSON.stringify(envelope) });
      await rememberNamedConversationCorrespondents(trx, route, [from]);
      await store.table('ticket_conversations').where('conversation_id', conversation.conversationId).update({ status: 'open',
        revision: conversation.revision + (conversation.status === 'done' ? 1 : 0), message_version: trx.raw('message_version + 1'), updated_at: trx.fn.now() });
      // Time-based lifecycle admission can expire during policy evaluation or
      // the canonical writer even though the identity rows remain locked.
      if (requesterResult) await assertCoManagedOperationalWrite(trx, conversation.ticket.tenant);
      return requesterResult ?? { outcome: 'replied' as const, ticketId: conversation.ticket.ticketId, commentId, matchedBy };
    });
  } catch (error) {
    if (!(error instanceof ReplyRejected) && !(error instanceof CoManagedSharedWorkError) && !(error instanceof TicketConversationError && error.code === 'CONVERSATION_FORBIDDEN')) throw error;
    return { outcome: 'quarantined', reason: 'conversation_reply_requires_admission', matchedBy: /tc1:/i.test(`${email.body.text ?? ''}${email.body.html ?? ''}`) ? 'reply_token' : 'thread_headers' };
  }
}
