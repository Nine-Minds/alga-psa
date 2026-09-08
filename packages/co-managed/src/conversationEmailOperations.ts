import { admitNamedRequesterPublicationOptions } from './namedTicketConversations';
import { snapshotRequesterPublicationOptions } from '@alga-psa/shared/lib/tickets/requesterPublicationOptions';
import { assertNamedConversationDeliveryFiles, selectedNamedConversationEditorFiles, assertNamedConversationPublicationFiles, prepareNamedConversationPublicationFiles, type NamedConversationEmailFile, type NamedConversationFileStorage } from './namedConversationPublicationFiles';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withNamedTicketConversation, getNamedConversationEditorDraft, sendNamedTicketConversationDraft,
  type NamedConversationPostContext } from './namedTicketConversations';
import { withNamedConversationMailbox, type ConversationMailbox } from './conversationMailboxes';
import { snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';
import { snapshotConversationContent, type CoManagedConversationContent } from './conversationContent';
import type { CoManagedCommentInsert } from './ticketCommentCreation';
import { reviewConversationEmailDraft } from '@alga-psa/shared/lib/tickets/conversationEmailEnvelope';
import { conversationUuid, snapshotConversationReference, snapshotConversationTicket, TicketConversationError,
  type ConversationTicketReference, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import type { PublishedConversationEmail, ReviewedEmailAddress, ReviewedEmailPreview } from '@alga-psa/shared/lib/email/reviewedEmail';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedConversationAuthorSources } from './conversationPolicy';
import { rememberNamedConversationCorrespondents } from '@alga-psa/shared/services/email/namedConversationCorrespondents';
import type { CoManagedConversationItem } from './ticketConversation';
import { getClientContactVisibilityContext } from '@alga-psa/shared/lib/tickets/clientPortalVisibility.server';
import { VISIBILITY_GROUP_MISMATCH_ERROR, VISIBILITY_GROUP_MISSING_ERROR } from '@alga-psa/shared/lib/tickets/clientPortalVisibility';

export interface NamedConversationEmailRequest { operationId: string; expectedDraftRevision: number; expectedConversationRevision: number }
export interface ConversationEmailPayload {
  from: ReviewedEmailAddress; replyTo: ReviewedEmailAddress; to: ReviewedEmailAddress[]; cc: ReviewedEmailAddress[];
  subject: string; html: string; text: string; headers: Record<string, string>; files?: NamedConversationEmailFile[];
}
export interface NamedConversationEmailTransport {
  prepare(input: { mailbox: ConversationMailbox; content: CoManagedConversationContent; files: NamedConversationEmailFile[];
    envelope: { subject: string; to: ReviewedEmailAddress[]; cc: ReviewedEmailAddress[] }; headers: Record<string, string>; replyToken: string }): Promise<{ payload: ConversationEmailPayload; review: ReviewedEmailPreview }>;
  recheck(payload: ConversationEmailPayload, mailbox: ConversationMailbox): Promise<ReviewedEmailPreview>;
  send(payload: ConversationEmailPayload, review: ReviewedEmailPreview, mailbox: ConversationMailbox): Promise<{
    success: boolean; queued?: boolean; metadata?: { deliveryStatus?: string; errorCode?: string; [key: string]: unknown };
  }>;
}
type Context = Parameters<Parameters<typeof withNamedTicketConversation>[5]>[0];
const TABLE = 'ticket_conversation_email_operations';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = () => { throw new TicketConversationError('CONVERSATION_INVALID'); };
const conflict = () => { throw new TicketConversationError('CONVERSATION_CONFLICT'); };
function snapshotRequest(input: NamedConversationEmailRequest): NamedConversationEmailRequest {
  if (!input || !conversationUuid(input.operationId) || Object.keys(input).some(key => !['operationId', 'expectedDraftRevision', 'expectedConversationRevision'].includes(key)) ||
      !Number.isSafeInteger(input.expectedDraftRevision) || input.expectedDraftRevision < 1 || !Number.isSafeInteger(input.expectedConversationRevision) || input.expectedConversationRevision < 1) return invalid();
  return { operationId: input.operationId.toLowerCase(), expectedDraftRevision: input.expectedDraftRevision, expectedConversationRevision: input.expectedConversationRevision };
}
function operations(context: Context) {
  return tenantDb(context.trx, context.actor.tenant).table(TABLE).where({ actor_user_id: context.actor.userId,
    ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId,
    conversation_store_tenant: context.conversation.storeTenant, conversation_id: context.conversation.conversationId });
}
function operation(context: Context, id: string) { return operations(context).where('operation_id', id); }
async function latestEmail(context: Context) {
  const store = tenantDb(context.trx, context.conversation.storeTenant);
  const scope = { ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId, conversation_id: context.conversation.conversationId };
  const sent = store.table('ticket_conversation_publications').where({ ...scope, mode: 'send' }).whereNotNull('email_envelope')
    .select('created_at', context.trx.raw('operation_id AS id, email_envelope AS envelope, email_envelope AS defaults'));
  const received = store.table('ticket_conversation_inbound_messages').where(scope)
    .select('created_at', context.trx.raw('comment_id AS id, envelope, proposed_recipients AS defaults'));
  return context.trx.from(context.trx.unionAll([sent, received], true).as('email_history')).orderBy('created_at', 'desc').orderBy('id', 'desc').first();
}

function state(row: any) {
  const expiredAttempt = row.status === 'sending' && row.attempted_at && Date.now() - new Date(row.attempted_at).getTime() > 300000;
  return { operationId: row.operation_id, status: expiredAttempt ? 'unknown' as const : row.status as 'reviewed' | 'pending' | 'sending' | 'delivered' | 'unknown' | 'blocked',
    errorCode: row.error_code as string | null };
}
function unchanged(review: ReviewedEmailPreview, current: ReviewedEmailPreview) {
  if (current.senderRevision !== review.senderRevision || current.messageHash !== review.messageHash) return conflict();
}
function admitEmailConversation(context: Context) {
  if (context.conversation.transport !== 'email') return invalid();
}
export function prepareNamedConversationEmail(db: Knex, inputActor: CoManagedSessionActor, inputTicket: ConversationTicketReference,
  inputRef: TicketConversationReference, inputRequest: NamedConversationEmailRequest, transport: NamedConversationEmailTransport) {
  const actor = snapshotCoManagedSessionActor(inputActor), ticket = snapshotConversationTicket(inputTicket), ref = snapshotConversationReference(inputRef), request = snapshotRequest(inputRequest);
  return withNamedConversationMailbox(db, actor, ticket, ref, request.expectedConversationRevision, async (context, mailbox) => {
    admitEmailConversation(context);
    const requestHash = hash({ actor: { tenant: context.actor.tenant, userId: context.actor.userId }, ticket: context.ticket, ref, request });
    const previous = await operation(context, request.operationId).forUpdate().first();
    if (previous) {
      if (previous.request_hash !== requestHash) return conflict();
      const publicationOptions = admitNamedRequesterPublicationOptions(context, context.conversation, previous.publication_options);
      return { ...state(previous), review: previous.review as ReviewedEmailPreview, ...(publicationOptions ? { publicationOptions } : {}) };
    }
    const draft = await getNamedConversationEditorDraft(context.trx, context.actor, context.ticket, ref);
    if (!draft?.content || !draft.email || draft.revision !== request.expectedDraftRevision || draft.conversationRevision !== request.expectedConversationRevision) return conflict();
    const raw = await tenantDb(context.trx, context.actor.tenant).table('ticket_conversation_editor_drafts')
      .where({ actor_user_id: context.actor.userId, conversation_store_tenant: ref.storeTenant, conversation_id: ref.conversationId }).forShare().first('attachment_manifest', 'publication_options');
    if (!raw) return invalid();
    const publicationOptions = admitNamedRequesterPublicationOptions(context, context.conversation, raw.publication_options);
    const files = await selectedNamedConversationEditorFiles(context, raw);
    const content = snapshotConversationContent(draft.content);
    const ownRoutes = await tenantDb(context.trx, mailbox.tenant).table('email_providers').select('mailbox');
    const envelope = reviewConversationEmailDraft(draft.email, ownRoutes.map(row => row.mailbox));
    const token = `tc1:${randomBytes(32).toString('base64url')}`, tokenHash = createHash('sha256').update(token).digest('hex');
    const messageId = `<conversation-${request.operationId}@${mailbox.email.split('@')[1]}>`;
    const prior = await tenantDb(context.trx, ref.storeTenant).table('ticket_conversation_publications')
      .where({ conversation_id: ref.conversationId, mode: 'send' }).whereNotNull('email_envelope').orderBy('created_at', 'desc').first('email_envelope');
    const latest = await latestEmail(context);
    const priorId = latest?.envelope?.messageId ?? prior?.email_envelope?.messageId;
    const references = [...new Set([prior?.email_envelope?.messageId, priorId].filter(Boolean))].join(' ');
    const headers = { 'Message-ID': messageId, ...(priorId ? { 'In-Reply-To': priorId, References: references } : {}) };
    const prepared = await transport.prepare({ mailbox, content, envelope, headers, replyToken: token, files });
    if (hash(prepared.payload.files ?? []) !== hash(files) || hash(prepared.review.files) !== hash(files.map(f => ({ filename: f.fileName, contentType: f.mimeType, size: f.size }))) || !/^[0-9a-f]{64}$/.test(prepared.review.senderRevision) || !/^[0-9a-f]{64}$/.test(prepared.review.messageHash)) return invalid();
    if (prepared.review.providerType === 'microsoft' && prepared.review.from.email.toLowerCase() !== mailbox.email.toLowerCase()) return invalid();
    const [row] = await tenantDb(context.trx, context.actor.tenant).table(TABLE).insert({ tenant: context.actor.tenant, operation_id: request.operationId,
      actor_user_id: context.actor.userId, ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId, relationship_id: context.ticket.relationshipId ?? null,
      conversation_store_tenant: ref.storeTenant, conversation_id: ref.conversationId, mailbox_tenant: mailbox.tenant, mailbox_id: mailbox.id,
      draft_revision: draft.revision, conversation_revision: context.conversation.revision, request_hash: requestHash,
      publication_options: publicationOptions ? JSON.stringify(publicationOptions) : null,
      review: JSON.stringify(prepared.review), payload: JSON.stringify(prepared.payload), reply_token_hash: tokenHash, rfc_message_id: messageId }).returning('*');
    return { ...state(row), review: row.review as ReviewedEmailPreview, ...(publicationOptions ? { publicationOptions } : {}) };
  });
}
/** Confirmation commits the reviewed message, immutable envelope, inbound route,
 * publication receipt and draft cleanup together. No network delivery occurs here. */
export async function confirmNamedConversationEmail(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, input: TicketConversationReference,
  operationId: string, reviewHash: string, transport: NamedConversationEmailTransport,
  publish: (context: NamedConversationPostContext, comment: CoManagedCommentInsert) => Promise<void>, storage?: NamedConversationFileStorage) {
  const ref = snapshotConversationReference(input);
  if (!conversationUuid(operationId) || !/^[0-9a-f]{64}$/.test(reviewHash)) return Promise.reject(new TicketConversationError('CONVERSATION_INVALID'));
  const id = operationId.toLowerCase();
  if (storage) {
    const prepare = await withNamedTicketConversation(db, actor, ticket, ref, 'update', async context => {
      const row = await operation(context, id).forUpdate().first();
      if (!row || row.review.messageHash !== reviewHash) return conflict();
      if (row.status !== 'reviewed') return null;
      return withNamedConversationMailbox(context.trx, context.actor, context.ticket, ref, row.conversation_revision, async (current, mailbox) => {
        admitEmailConversation(current);
        if (row.mailbox_tenant !== mailbox.tenant || row.mailbox_id !== mailbox.id) return conflict();
        unchanged(row.review, await transport.recheck(row.payload, mailbox));
        return { operationId: id, expectedConversationRevision: row.conversation_revision, expectedDraftRevision: row.draft_revision };
      });
    });
    if (prepare) await prepareNamedConversationPublicationFiles(db, actor, ticket, ref, prepare, 'send', storage);
  }
  return withNamedTicketConversation(db, actor, ticket, ref, 'update', async context => {
    const row = await operation(context, id).forUpdate().first();
    if (!row || row.review.messageHash !== reviewHash) return conflict();
    if (row.status !== 'reviewed') return state(row);
    return withNamedConversationMailbox(context.trx, context.actor, context.ticket, ref, row.conversation_revision, async (current, mailbox) => {
      admitEmailConversation(current);
      if (row.mailbox_tenant !== mailbox.tenant || row.mailbox_id !== mailbox.id) return conflict();
      unchanged(row.review, await transport.recheck(row.payload, mailbox));
      const draft = await tenantDb(current.trx, current.actor.tenant).table('ticket_conversation_editor_drafts').where({ actor_user_id: current.actor.userId,
        conversation_store_tenant: ref.storeTenant, conversation_id: ref.conversationId, ticket_tenant: current.ticket.tenant, ticket_id: current.ticket.ticketId }).forUpdate().first();
      if (!draft || draft.revision !== row.draft_revision || draft.conversation_revision !== row.conversation_revision) return conflict();
      const publicationOptions = admitNamedRequesterPublicationOptions(current, current.conversation, row.publication_options);
      if (hash(publicationOptions) !== hash(snapshotRequesterPublicationOptions(draft.publication_options))) return conflict();
      const publishedFiles = await assertNamedConversationPublicationFiles(current, draft,
        { operationId: id, expectedConversationRevision: row.conversation_revision, expectedDraftRevision: row.draft_revision }, 'send');
      const payload = { ...row.payload, ...(publishedFiles.length ? { files: publishedFiles } : {}) };
      unchanged(row.review, await transport.recheck(payload, mailbox));
      await sendNamedTicketConversationDraft(current.trx, current.actor, current.ticket, ref,
        { operationId: id, expectedConversationRevision: row.conversation_revision, expectedDraftRevision: row.draft_revision }, publish);
      const envelope = { from: row.review.from, replyTo: row.review.replyTo, to: row.review.to, cc: row.review.cc, subject: row.review.subject,
        messageId: row.rfc_message_id, mailbox: { tenant: mailbox.tenant, id: mailbox.id }, audience: current.conversation.audience };
      await tenantDb(current.trx, ref.storeTenant).table('ticket_conversation_publications').where({ operation_id: id, conversation_id: ref.conversationId })
        .update({ email_envelope: JSON.stringify(envelope) });
      const route = { tenant: mailbox.tenant, mailbox_id: mailbox.id,
        token_hash: row.reply_token_hash, rfc_message_id: row.rfc_message_id, operation_tenant: current.actor.tenant, operation_id: id,
        ticket_tenant: current.ticket.tenant, ticket_id: current.ticket.ticketId, relationship_id: current.ticket.relationshipId ?? null,
        conversation_store_tenant: ref.storeTenant, conversation_id: ref.conversationId };
      await tenantDb(current.trx, mailbox.tenant).table('ticket_conversation_email_routes').insert(route);
      await rememberNamedConversationCorrespondents(current.trx, route, [...envelope.to, ...envelope.cc]);
      const [saved] = await operation(current, id).update({ status: 'pending', payload: JSON.stringify(payload) }).returning('*');
      return state(saved);
    });
  });
}
export function getNamedConversationEmailOperation(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, ref: TicketConversationReference, operationId: string) {
  if (!conversationUuid(operationId)) return Promise.reject(new TicketConversationError('CONVERSATION_INVALID'));
  const id = operationId.toLowerCase();
  return withNamedTicketConversation(db, actor, ticket, ref, 'read', async context => {
    const row = await operation(context, id).first();
    if (!row) return conflict();
    return state(row);
  });
}
/** Recover the author's last accepted Send after navigation or a lost response.
 * Unconfirmed private reviews are drafts, and never become a recovery send. */
export function getLatestNamedConversationEmailSend(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, ref: TicketConversationReference) {
  return withNamedTicketConversation(db, actor, ticket, ref, 'read', async context => {
    const row = await operations(context).whereNot('status', 'reviewed').orderBy('created_at', 'desc').orderBy('operation_id', 'desc').first();
    return row ? { ...state(row), reviewHash: (row.review as ReviewedEmailPreview).messageHash } : null;
  });
}
/** Only published envelope and delivery state are shared with destination
 * readers. The author's private review, payload and tokens remain unprojected. */
export async function attachPublishedConversationEmails(context: Pick<Context, 'trx' | 'ticket' | 'conversation' | 'hidden'>, items: CoManagedConversationItem[]) {
  const visible = items.filter(item => !item.deleted);
  if (!visible.length || isCoManagedReadFieldHidden(context.hidden, [...coManagedConversationAuthorSources, 'email', 'email_envelope', 'recipients', 'from', 'to', 'cc', 'subject',
    'ticket_conversation_publications', 'ticket_conversation_email_operations', 'ticket_conversation_inbound_messages', 'proposed_recipients'])) return;
  const rows = await tenantDb(context.trx, context.conversation.storeTenant).table('ticket_conversation_publications')
    .where({ ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId, conversation_id: context.conversation.conversationId, mode: 'send' })
    .whereIn('comment_id', visible.map(item => item.commentId)).whereNotNull('email_envelope')
    .select('comment_id', 'operation_id', 'actor_tenant', 'actor_user_id', 'email_envelope');
  for (const row of rows) {
    // The publication, not caller input, qualifies the narrow status lookup.
    const receipt = await tenantDb(context.trx, row.actor_tenant).table(TABLE).where({ operation_id: row.operation_id, actor_user_id: row.actor_user_id,
      ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId, conversation_store_tenant: context.conversation.storeTenant,
      conversation_id: context.conversation.conversationId }).select('status', 'attempted_at').first();
    const delivery = receipt ? state(receipt).status : 'unknown';
    if (delivery === 'reviewed') continue;
    const envelope = row.email_envelope;
    const projected: PublishedConversationEmail = { from: envelope.from, replyTo: envelope.replyTo, to: envelope.to, cc: envelope.cc, subject: envelope.subject, delivery };
    const item = visible.find(value => value.commentId === row.comment_id && value.storeTenant === context.conversation.storeTenant);
    if (item) item.email = projected;
  }
  const inbound = await tenantDb(context.trx, context.conversation.storeTenant).table('ticket_conversation_inbound_messages')
    .where({ ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId, conversation_id: context.conversation.conversationId })
    .whereIn('comment_id', visible.map(item => item.commentId)).select('comment_id', 'envelope');
  for (const row of inbound) {
    const item = visible.find(value => value.commentId === row.comment_id);
    if (!item) continue;
    const envelope = row.envelope;
    item.email = { from: envelope.from, to: envelope.to, cc: envelope.cc, subject: envelope.subject, delivery: 'received' };
    item.author = { tenant: context.conversation.storeTenant, kind: 'external', id: null, referenceId: null,
      displayName: envelope.from.name || envelope.from.email, organizationName: null };
  }
}
/** A committed sending marker precedes transport. If the process or transaction
 * disappears after SMTP acceptance, retry observes that marker and never resends.
 * An authenticated author may resume a pending send with a new current session. */
export async function deliverNamedConversationEmail(db: Knex, inputActor: CoManagedSessionActor, inputTicket: ConversationTicketReference,
  inputRef: TicketConversationReference, operationId: string, transport: NamedConversationEmailTransport) {
  if (db.isTransaction || !conversationUuid(operationId)) return invalid();
  const actor = snapshotCoManagedSessionActor(inputActor), ticket = snapshotConversationTicket(inputTicket), ref = snapshotConversationReference(inputRef), id = operationId.toLowerCase();
  const attemptId = randomUUID();
  const claimed = await withNamedTicketConversation(db, actor, ticket, ref, 'update', async context => {
    const row = await operation(context, id).forUpdate().first();
    if (!row) return conflict();
    if (row.status !== 'pending') return { ready: false as const, result: state(row) };
    return withNamedConversationMailbox(context.trx, context.actor, context.ticket, ref, row.conversation_revision, async (current, mailbox) => {
      if (row.mailbox_tenant !== mailbox.tenant || row.mailbox_id !== mailbox.id) return conflict();
      await assertNamedConversationDeliveryFiles(current, id, row.payload.files);
      unchanged(row.review, await transport.recheck(row.payload, mailbox));
      await operation(current, id).update({ status: 'sending', attempt_id: attemptId, attempted_at: current.trx.fn.now() });
      return { ready: true as const, revision: row.conversation_revision };
    });
  });
  if (!claimed.ready) return claimed.result;
  // Reacquire authority after the committed marker. Any error leaves the marker;
  // the caller can inspect the same operation but cannot blindly try SMTP again.
  return withNamedConversationMailbox(db, actor, ticket, ref, claimed.revision, async (context, mailbox) => {
    const row = await operation(context, id).forUpdate().first();
    if (!row || row.attempt_id !== attemptId || row.status !== 'sending') return conflict();
    await assertNamedConversationDeliveryFiles(context, id, row.payload.files);
    let status: 'delivered' | 'unknown' | 'blocked', errorCode: string | null = null;
    try {
      const result = await transport.send(row.payload, row.review, mailbox);
      status = result.success && !result.queued ? 'delivered' : result.metadata?.deliveryStatus === 'not_attempted' ? 'blocked' : 'unknown';
      if (status !== 'delivered') errorCode = status === 'unknown' ? 'delivery_unknown' : 'delivery_not_attempted';
    } catch { status = 'unknown'; errorCode = 'delivery_unknown'; }
    const [saved] = await operation(context, id).update({ status, error_code: errorCode, completed_at: context.trx.fn.now() }).returning('*');
    return state(saved);
  });
}

/** Editable reply defaults are projected independently from immutable history.
 * They never modify an existing author draft or grant access to a correspondent. */
export function getNamedConversationEmailDefaults(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, ref: TicketConversationReference) {
  return withNamedTicketConversation(db, actor, ticket, ref, 'read', async context => {
    if (context.conversation.transport !== 'email' || isCoManagedReadFieldHidden(context.hidden,
      [...coManagedConversationAuthorSources, 'email', 'email_envelope', 'recipients', 'from', 'to', 'cc', 'subject', 'ticket_conversation_publications', 'ticket_conversation_inbound_messages', 'proposed_recipients'])) return null;
    const row = await latestEmail(context);
    if (!row) return requesterEmailDefaults(context);
    const envelope = row.defaults;
    return { subject: envelope.subject, to: envelope.to.map((value: ReviewedEmailAddress) => value.email), cc: envelope.cc.map((value: ReviewedEmailAddress) => value.email) };
  });
}

/** Prefill an empty requester composer from the currently visible ticket, not
 * from another conversation or an unpublished draft. These are editable hints;
 * mailbox admission and reviewed Send still own external delivery. */
async function requesterEmailDefaults(context: Context) {
  if (context.conversation.audience !== 'requester' || isCoManagedReadFieldHidden(context.hidden,
    ['title', 'ticket_number', 'client_id', 'contact_name_id', 'contacts', 'contact', 'contact_email', 'client_locations'])) return null;
  const owner = tenantDb(context.trx, context.ticket.tenant);
  const ticket = await owner.table('tickets').where('ticket_id', context.ticket.ticketId).forShare().first('title', 'ticket_number', 'client_id', 'contact_name_id', 'board_id');
  if (!ticket?.client_id) return null;
  const client = await owner.table('clients').where('client_id', ticket.client_id).forShare().first('is_inactive');
  if (!client || client.is_inactive) return null;
  // LEVERAGE: pattern current-requester-recipient — empty composer hints and legacy requester delivery retain the same primary-contact/location policy.
  const contact = ticket.contact_name_id ? await owner.table('contacts').where({ contact_name_id: ticket.contact_name_id, client_id: ticket.client_id })
    .forShare().first('email', 'is_inactive') : null;
  if (ticket.contact_name_id) {
    if (!contact || contact.is_inactive) return null;
    let visibility;
    try { visibility = await getClientContactVisibilityContext(context.trx, context.ticket.tenant, ticket.contact_name_id, { lock: true }); }
    catch (error) {
      if (error instanceof Error && [VISIBILITY_GROUP_MISMATCH_ERROR, VISIBILITY_GROUP_MISSING_ERROR].includes(error.message)) return null;
      throw error;
    }
    if (visibility.clientId !== ticket.client_id || (visibility.visibleBoardIds !== null && !visibility.visibleBoardIds.includes(ticket.board_id))) return null;
  }
  let email = contact?.email?.trim();
  if (!email) {
    const locations = await owner.table('client_locations').where({ client_id: ticket.client_id, is_default: true, is_active: true }).forShare().select('email');
    if (locations.length !== 1) return null;
    email = locations[0].email?.trim();
  }
  if (!email || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)) return null;
  return { subject: `[Ticket #${ticket.ticket_number}] ${ticket.title ?? ''}`.slice(0, 255), to: [email], cc: [] as string[] };
}
