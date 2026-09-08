import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, getCoManagedOperationalState } from '@alga-psa/licensing';
import { parseEmailReply, htmlToVisibleText } from '@alga-psa/shared/lib/email/replyParser';
import { verifySenderAuthentication, allowsContactSenderAttribution } from '@alga-psa/shared/lib/email/senderAuthVerification';
import { conversationUuid, snapshotConversationReference, snapshotConversationTicket, TicketConversationError,
  type ConversationTicketReference, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';
import { hasCoManagedLocalPermission } from './localPermission';
import { withNamedConversationMailbox } from './conversationMailboxes';
import { getNamedTicketConversation } from './namedTicketConversations';
import { admitReviewedNamedConversationEmailReply } from './inboundNamedConversationEmail';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

const RESOLUTIONS = 'ticket_conversation_reply_resolutions';
const REASON = 'quarantined:conversation_reply_requires_admission';
const forbidden = (): never => { throw new TicketConversationError('CONVERSATION_FORBIDDEN'); };
const conflict = (): never => { throw new TicketConversationError('CONVERSATION_CONFLICT'); };
const invalid = (): never => { throw new TicketConversationError('CONVERSATION_INVALID'); };

/** Held source is a mailbox administration surface, not a ticket projection.
 * Access to one possible shared destination must not disclose a private source
 * or other candidates. Foreign mailbox delegation never grants this review. */
async function withReviewAuthority<T>(db: Knex, input: CoManagedSessionActor, work: (trx: Knex.Transaction, actor: CoManagedSessionActor) => Promise<T>) {
  const actor = snapshotCoManagedSessionActor(input);
  return withTransaction(db, async trx => {
    await getCoManagedOperationalState(trx, actor.tenant);
    await lockCoManagedSessionIdentity(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'ticket_settings', 'update', true)) return forbidden();
    await assertCoManagedSessionUnexpired(trx, actor);
    const result = await work(trx, actor);
    await assertCoManagedSessionUnexpired(trx, actor);
    return result;
  });
}
async function heldInbox(trx: Knex.Transaction, tenant: string, inboxId: string) {
  if (!conversationUuid(inboxId)) return invalid();
  const inbox = await tenantDb(trx, tenant).table('inbound_email_inbox').where({ inbox_id: inboxId.toLowerCase(), status: 'skipped', outcome_reason: REASON }).first();
  if (!inbox?.source_sha256 || !inbox.source_object_key || inbox.legacy_imported) return conflict();
  return inbox;
}
export function listNamedReplyReviews(db: Knex, actor: CoManagedSessionActor, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0) return Promise.reject(new TicketConversationError('CONVERSATION_INVALID'));
  return withReviewAuthority(db, actor, async (trx, current) => {
    const home = tenantDb(trx, current.tenant);
    const rows = await home.table('inbound_email_inbox').where({ status: 'skipped', outcome_reason: REASON, legacy_imported: false })
      .orderBy('received_at', 'asc').orderBy('inbox_id', 'asc').limit(51).offset(offset)
      .select('inbox_id', 'provider_id', 'envelope', 'received_at');
    const mailboxes = await home.table('email_providers').select('id', 'mailbox');
    return { items: rows.slice(0, 50).map(row => ({ inboxId: row.inbox_id as string,
      mailbox: String(mailboxes.find(mailbox => mailbox.id === row.provider_id)?.mailbox ?? ''),
      subject: String(row.envelope?.subject ?? ''), from: String(row.envelope?.from?.email ?? ''), receivedAt: new Date(row.received_at).toISOString() })),
      hasMore: rows.length > 50 };
  });
}
async function loadSource(inbox: any) {
  const { readStagedSourceMime, parseStagedMimeIntoEmailDetails } = await import('@alga-psa/shared/services/email/inboundEmailSourceStager');
  const rawMime = await readStagedSourceMime({ tenant: inbox.tenant, providerId: inbox.provider_id, objectKey: inbox.source_object_key, expectedSha256: inbox.source_sha256 });
  const parsed = await parseStagedMimeIntoEmailDetails({ tenant: inbox.tenant, providerId: inbox.provider_id, providerType: inbox.provider_type,
    rawMime, fallbackProviderMessageId: inbox.provider_message_id });
  if (parsed.emailData.sourceSha256 !== inbox.source_sha256 || parsed.emailData.tenant !== inbox.tenant || parsed.emailData.providerId !== inbox.provider_id) return conflict();
  return parsed.emailData;
}
function sourcePreview(email: Awaited<ReturnType<typeof loadSource>>) {
  const parsed = parseEmailReply({ text: email.body.text ?? '', html: email.body.html });
  const text = (parsed.sanitizedText ?? (email.body.text?.trim() ? '' : htmlToVisibleText(parsed.sanitizedHtml ?? ''))).trim();
  const authentication = Object.entries(email.headers ?? {}).find(([key]) => key.toLowerCase() === 'authentication-results')?.[1];
  const verified = allowsContactSenderAttribution(verifySenderAuthentication(authentication, email.from.email.trim().toLowerCase()));
  return { from: email.from, to: email.to, cc: email.cc ?? [], subject: email.subject, text,
    attachments: (email.attachments ?? []).map(file => ({ name: file.name, size: file.size })),
    canResolve: verified && Boolean(text) && text.length <= 100000 };
}
export interface NamedReplyReviewDestination {
  ticket: ConversationTicketReference; conversation: TicketConversationReference; revision: number; name: string; audience: string; ticketNumber: string | null;
}
export async function getNamedReplyReview(db: Knex, actor: CoManagedSessionActor, inboxId: string) {
  const initial = await withReviewAuthority(db, actor, (trx, current) => heldInbox(trx, current.tenant, inboxId));
  const email = await loadSource(initial);
  return withReviewAuthority(db, actor, async (trx, current) => {
    const inbox = await heldInbox(trx, current.tenant, inboxId);
    if (inbox.source_sha256 !== initial.source_sha256 || inbox.provider_id !== initial.provider_id) return conflict();
    // Offer only current writable vendor destinations using this same mailbox.
    const routes = await tenantDb(trx, current.tenant).table('ticket_conversation_email_routes').where('mailbox_id', inbox.provider_id)
      .distinctOn('conversation_store_tenant', 'conversation_id').orderBy('conversation_store_tenant').orderBy('conversation_id').orderBy('created_at', 'desc').select('*');
    const destinations: NamedReplyReviewDestination[] = [];
    for (const route of routes) {
      const ticket = { tenant: route.ticket_tenant, ticketId: route.ticket_id, ...(route.relationship_id ? { relationshipId: route.relationship_id } : {}) };
      const conversation = { storeTenant: route.conversation_store_tenant, conversationId: route.conversation_id };
      try {
        const selected = await getNamedTicketConversation(trx, current, ticket, conversation);
        await withNamedConversationMailbox(trx, current, ticket, conversation, selected.revision, async (context, mailbox) => {
          if (mailbox.tenant === current.tenant && mailbox.id === inbox.provider_id && context.conversation.audience !== 'requester') {
            const row = isCoManagedReadFieldHidden(context.hidden, ['ticket_number']) ? null
              : await tenantDb(trx, ticket.tenant).table('tickets').where('ticket_id', ticket.ticketId).first('ticket_number');
            destinations.push({ ticket, conversation, revision: context.conversation.revision, name: context.conversation.name,
              audience: context.conversation.audience, ticketNumber: row?.ticket_number ?? null });
          }
        });
      } catch (error: any) {
        if (!['CONVERSATION_FORBIDDEN', 'CO_MANAGED_SHARED_WORK_FORBIDDEN', 'CO_MANAGED_READ_ONLY', 'CO_MANAGED_SUSPENDED'].includes(error?.code)) throw error;
      }
    }
    return { inboxId, sourceSha256: inbox.source_sha256 as string, ...sourcePreview(email), destinations };
  });
}
export interface ResolveNamedReplyReviewRequest {
  inboxId: string; operationId: string; sourceSha256: string; ticket: ConversationTicketReference;
  conversation: TicketConversationReference; expectedConversationRevision: number;
}
export async function resolveNamedReplyReview(db: Knex, inputActor: CoManagedSessionActor, input: ResolveNamedReplyReviewRequest) {
  const actor = snapshotCoManagedSessionActor(inputActor), ticket = snapshotConversationTicket(input.ticket), conversation = snapshotConversationReference(input.conversation);
  if (![input.inboxId, input.operationId].every(conversationUuid) || !/^[0-9a-f]{64}$/.test(input.sourceSha256) ||
    !Number.isSafeInteger(input.expectedConversationRevision) || input.expectedConversationRevision < 1) return invalid();
  const request = { inboxId: input.inboxId.toLowerCase(), operationId: input.operationId.toLowerCase(), sourceSha256: input.sourceSha256,
    ticket, conversation, expectedConversationRevision: input.expectedConversationRevision };
  const requestHash = createHash('sha256').update(JSON.stringify({ actor: { tenant: actor.tenant, userId: actor.userId }, ...request })).digest('hex');
  const replay = (trx: Knex.Transaction) => tenantDb(trx, actor.tenant).table(RESOLUTIONS).where('operation_id', request.operationId).first();
  const result = (row: any) => {
    if (row.request_hash !== requestHash || row.actor_user_id !== actor.userId) return conflict();
    return { commentId: row.comment_id as string, ticket, conversation };
  };
  const initial = await withReviewAuthority(db, actor, async trx => {
    const previous = await replay(trx);
    if (previous) { await getNamedTicketConversation(trx, actor, ticket, conversation); return { previous }; }
    return { inbox: await heldInbox(trx, actor.tenant, request.inboxId) };
  });
  if (initial.previous) return result(initial.previous);
  if (initial.inbox.source_sha256 !== request.sourceSha256) return conflict();
  const emailData = await loadSource(initial.inbox);
  return withReviewAuthority(db, actor, async trx => {
    await assertCoManagedOperationalWrite(trx, actor.tenant);
    return withNamedConversationMailbox(trx, actor, ticket, conversation, request.expectedConversationRevision, async (context, mailbox) => {
      if (mailbox.tenant !== actor.tenant || mailbox.id !== initial.inbox.provider_id || context.conversation.audience === 'requester') return forbidden();
      // Serialize different reviewers/destinations on the original inbox first.
      await tenantDb(trx, actor.tenant).table('inbound_email_inbox').where('inbox_id', request.inboxId).forUpdate().first();
      const previous = await replay(trx);
      if (previous) return result(previous);
      const route = await tenantDb(trx, actor.tenant).table('ticket_conversation_email_routes').where({ mailbox_id: mailbox.id,
        ticket_tenant: ticket.tenant, ticket_id: ticket.ticketId, conversation_store_tenant: conversation.storeTenant, conversation_id: conversation.conversationId })
        .orderBy('created_at', 'desc').forShare().first();
      if (!route) return forbidden();
      const { resolveQuarantinedNamedReply } = await import('@alga-psa/shared/services/email/inboundEmailCoreProcessor');
      const published = await resolveQuarantinedNamedReply(trx, { tenant: actor.tenant, providerId: mailbox.id, inboxId: request.inboxId,
        sourceSha256: request.sourceSha256, operationId: request.operationId, emailData,
        admission: (connection, source) => admitReviewedNamedConversationEmailReply(connection, source, route) });
      await tenantDb(trx, actor.tenant).table(RESOLUTIONS).insert({ tenant: actor.tenant, operation_id: request.operationId, inbox_id: request.inboxId,
        actor_user_id: actor.userId, request_hash: requestHash, source_sha256: request.sourceSha256, ticket_tenant: ticket.tenant, ticket_id: ticket.ticketId,
        relationship_id: ticket.relationshipId ?? null, conversation_store_tenant: conversation.storeTenant, conversation_id: conversation.conversationId, comment_id: published.commentId });
      return { commentId: published.commentId, ticket, conversation };
    });
  });
}
