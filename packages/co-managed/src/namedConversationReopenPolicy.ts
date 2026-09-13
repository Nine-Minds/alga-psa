import type { Knex } from 'knex';
import { randomUUID, createHash } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import type { EmailMessageDetails } from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import {
  loadInboundReplyPolicyContext,
  resolveBoardReopenStatusTarget,
  applyInboundReplyReopenTransition,
  isClosedTicketBeyondReopenCutoff,
} from '@alga-psa/shared/services/email/processInboundEmailInApp';
import { checkInboundReopenRateLimit } from '@alga-psa/shared/services/email/inboundReopenRateLimiter';
import { detectAutomatedInboundMessage } from '@alga-psa/shared/lib/email/automatedMessage';
import { resolveInboundReplyAcknowledgementDecider } from '@alga-psa/shared/services/email/inboundReplyAcknowledgementDecider';

export type SideConversationReopenOutcome =
  | { action: 'none' }
  | { action: 'comment_only'; reason: 'cutoff_exceeded' | 'automated_message' | 'ai_ack' | 'rate_limited' }
  | { action: 'reopened'; statusId: string; source: 'explicit' | 'board_default' };

/**
 * F065 precheck: whether a side-conversation reply on a closed ticket should
 * be routed into a follow-up ticket instead of attaching to the closed one.
 * Deliberately lighter than {@link evaluateSideConversationReopenPolicy} — it
 * only asks the ONE question that has to be answered before any message is
 * written (so the caller can choose a destination up front), not the full
 * automated/ack/rate-limit sequence that only matters when staying on the
 * existing ticket.
 */
export async function isSideConversationCutoffExceeded(trx: Knex.Transaction, input: {
  tenantId: string; ticketId: string; email: EmailMessageDetails;
}): Promise<boolean> {
  const policy = await loadInboundReplyPolicyContext({ tenantId: input.tenantId, ticketId: input.ticketId, existingConnection: trx });
  if (!policy || !policy.ticketIsClosed || !policy.inboundReplyReopenEnabled) return false;
  const board = await tenantDb(trx, input.tenantId).table('boards').where('board_id', policy.boardId)
    .first('inbound_reply_reopen_side_conversations_enabled');
  if (!board?.inbound_reply_reopen_side_conversations_enabled) return false;
  return isClosedTicketBeyondReopenCutoff({ closedAt: policy.closedAt, receivedAt: input.email.receivedAt, cutoffHours: policy.inboundReplyReopenCutoffHours });
}

/** Deterministic per-route dedup key: EVERY late reply that resolves back to
 * the same original accepted route must land on the SAME follow-up ticket,
 * not a fresh one each time. Keyed by the route identity, not by the inbound
 * message, so a second (and third, ...) late reply finds the first follow-up
 * instead of creating another. */
function followupConversationHash(route: { tenant: string; mailboxId: string; operationTenant: string; operationId: string }): string {
  return createHash('sha256').update(JSON.stringify(['side-conversation-followup', route.tenant, route.mailboxId, route.operationTenant, route.operationId])).digest('hex');
}

/**
 * F065: PRD §7's "route into an equivalent side conversation on the
 * follow-up" for a cutoff-exceeded side reply, reusing the existing
 * follow-up-ticket policy (a fresh open ticket, same client/board/priority)
 * the requester path already has via `prepareFollowupConversation`. A vendor
 * reply carries no client/contact identity of its own to resolve — unlike an
 * unmatched requester email — so the new ticket clones the closed ticket's
 * own attributes rather than deriving them from the message.
 *
 * Find-or-create: a second (or third...) late reply to the SAME original
 * route reuses the first follow-up rather than spawning another. Safe
 * without a dedicated unique constraint because the caller already holds a
 * `FOR UPDATE` lock on the original conversation row (via
 * `readNamedConversationEmailDestination`) before this runs, which
 * serializes concurrent redirects for the same original conversation.
 *
 * Creates a brand-new open ticket and an equivalent (same name/audience,
 * email transport, same mailbox) side conversation on it, in the SAME
 * transaction as the message write that will land there — never a
 * side-effect the caller could observe without also observing the reply.
 * The canonical `TICKET_CREATED`/`TICKET_ASSIGNED` events fire through the
 * same transactional workflow-event publisher inbound email creation
 * normally uses (`createTicketFromEmail`), so assignment/notification/SLA
 * start behave exactly as they would for any other inbound-created ticket —
 * this is not a silent, unobservable ticket.
 */
export async function createSideConversationFollowup(trx: Knex.Transaction, input: {
  originalTicket: { tenant: string; ticketId: string };
  originalConversationId: string;
  conversationName: string;
  audience: 'shared_it' | 'organization_private';
  storeTenant: string;
  relationshipId?: string | null;
  mailboxTenant: string;
  mailboxId: string;
  route: { tenant: string; mailboxId: string; operationTenant: string; operationId: string };
}): Promise<{ ticketId: string; conversationId: string; threadId: string }> {
  const owner = tenantDb(trx, input.originalTicket.tenant);
  const store = tenantDb(trx, input.storeTenant);
  const hash = followupConversationHash(input.route);
  const existing = await store.table('ticket_conversations').where({ tenant: input.storeTenant, creation_hash: hash }).first('ticket_id', 'conversation_id');
  if (existing) return { ticketId: existing.ticket_id, conversationId: existing.conversation_id, threadId: randomUUID() };

  const original = await owner.table('tickets').where('ticket_id', input.originalTicket.ticketId).forShare()
    .first('title', 'client_id', 'contact_name_id', 'board_id', 'priority_id', 'category_id', 'subcategory_id', 'location_id', 'attributes');
  if (!original) throw new Error('Original ticket not found for side-conversation follow-up');
  const { TicketModel } = await import('@alga-psa/shared/models/ticketModel');
  const { WorkflowEventPublisher } = await import('@alga-psa/shared/workflow/adapters/workflowEventPublisher');
  const openStatusId = original.board_id ? await TicketModel.getDefaultStatusId(input.originalTicket.tenant, trx, original.board_id) : null;
  // Never chain "(follow-up ...)" onto an already-followed-up title — cap
  // growth at one hop; the back-reference below is what actually links the
  // chain, not the title text.
  const suffix = ' (follow-up — original reply arrived after the reopen window)';
  const title = original.title.includes('(follow-up —') ? original.title : `${original.title}${suffix}`;
  const board = original.board_id ? await owner.table('boards').where('board_id', original.board_id).first('default_assigned_to') : null;
  const eventPublisher = new WorkflowEventPublisher({ transaction: trx });
  const created = await TicketModel.createTicketWithRetry({
    title, ticket_origin: 'inbound_email', source: 'email',
    ...(original.client_id ? { client_id: original.client_id } : {}),
    ...(original.contact_name_id ? { contact_id: original.contact_name_id } : {}),
    ...(original.board_id ? { board_id: original.board_id } : {}),
    ...(original.priority_id ? { priority_id: original.priority_id } : {}),
    ...(original.category_id ? { category_id: original.category_id } : {}),
    ...(original.subcategory_id ? { subcategory_id: original.subcategory_id } : {}),
    ...(original.location_id ? { location_id: original.location_id } : {}),
    ...(openStatusId ? { status_id: openStatusId } : {}),
    ...(board?.default_assigned_to ? { assigned_to: board.default_assigned_to } : {}),
    // Back-reference so the follow-up chain is traceable without relying on title text.
    attributes: { ...(original.attributes && typeof original.attributes === 'object' ? original.attributes : {}),
      followupOfTicketId: input.originalTicket.ticketId, followupOfConversationId: input.originalConversationId },
  }, input.originalTicket.tenant, trx, {}, eventPublisher, undefined, undefined, 3);
  if (board?.default_assigned_to) {
    try { await eventPublisher.publishTicketAssigned({ tenantId: input.originalTicket.tenant, ticketId: created.ticket_id, userId: board.default_assigned_to }); }
    catch (error) { console.error('Failed to publish TICKET_ASSIGNED event for side-conversation follow-up ticket:', error); }
  }
  const conversationId = randomUUID();
  await store.table('ticket_conversations').insert({ tenant: input.storeTenant, conversation_id: conversationId,
    ticket_tenant: input.originalTicket.tenant, ticket_id: created.ticket_id, relationship_id: input.relationshipId ?? null,
    name: input.conversationName, audience: input.audience, transport: 'email', creation_hash: hash,
    mailbox_tenant: input.mailboxTenant, mailbox_id: input.mailboxId });
  // A cross-org follow-up (Shared IT visible to the sponsor, or a private
  // vendor conversation) needs the SAME collaboration authority the sponsor
  // technician already held on the closed original — a brand-new ticket
  // otherwise has no `co_management_ticket_work`/`co_managed_ticket_references`
  // row at all, so the sponsor could create the conversation container but
  // never actually be authorized to read/write it. Mirrors
  // `escalateCoManagedTicket`'s own row shapes (ticketHandoffs.ts), with two
  // deliberate departures for safety: (1) if the sponsor's authority on the
  // original came only from a REVOKED per-ticket grant (not board scope),
  // the follow-up copies that revoked state rather than handing back a fresh
  // active grant — carrying a follow-up forward must never be an
  // authorization escalation; (2) the sponsor's destination board/client are
  // verified to still exist and be active first (this module's analogue of
  // `escalateCoManagedTicket`'s `DESTINATION_UNAVAILABLE` check), so a
  // deactivated/deleted sponsor board can never produce a dangling reference.
  if (input.relationshipId) {
    const relationship = await owner.table('co_management_relationships').where('relationship_id', input.relationshipId).forShare().first();
    if (relationship) {
      const sponsor = tenantDb(trx, relationship.sponsor_tenant);
      const [sponsorBoard, sponsorClient, originalWork] = await Promise.all([
        sponsor.table('boards').where({ board_id: relationship.escalation_board_id, is_inactive: false }).first('board_id'),
        sponsor.table('clients').where('client_id', relationship.sponsor_client_id).first('client_id'),
        owner.table('co_management_ticket_work').where({ relationship_id: input.relationshipId, ticket_id: input.originalTicket.ticketId }).first('grant_revoked_at'),
      ]);
      if (sponsorBoard && sponsorClient) {
        const revoked = Boolean(originalWork?.grant_revoked_at);
        const workId = randomUUID(), now = trx.fn.now();
        await owner.table('co_management_ticket_work').insert({ tenant: input.originalTicket.tenant, relationship_id: input.relationshipId,
          ticket_id: created.ticket_id, work_id: workId, revision: 1, responsibility: 'msp', can_collaborate: !revoked,
          first_escalated_at: now, last_transition_at: now, ...(revoked ? { grant_revoked_at: now } : {}) });
        await sponsor.table('co_managed_ticket_references').insert({ tenant: relationship.sponsor_tenant, customer_tenant: input.originalTicket.tenant,
          relationship_id: input.relationshipId, ticket_id: created.ticket_id, reference_id: randomUUID(), work_id: workId,
          client_id: relationship.sponsor_client_id, board_id: relationship.escalation_board_id, created_at: now, updated_at: now });
      }
    }
  }
  return { ticketId: created.ticket_id, conversationId, threadId: randomUUID() };
}

/**
 * F060/F062-F067: extends the existing legacy inbound-reply reopen policy
 * (`inbound_reply_reopen_enabled`, cutoff, explicit status, ai-ack
 * suppression, rate limiting) to a named-conversation side reply (vendor or
 * Shared IT audience — never Requester; requester named replies already flow
 * through the canonical `processInboundEmailInApp` engine directly).
 *
 * Reuses the same board-policy loader, cutoff/status/rate-limit helpers and
 * canonical reopen transition the legacy requester path uses, gated by the
 * additional per-board `inbound_reply_reopen_side_conversations_enabled`
 * opt-in (default off, no effect unless the master switch is also on). Never
 * invoked for automated/AI/system traffic: the caller only reaches this after
 * `recordNamedConversationAttention` accepts the message as substantive human
 * correspondence, which already applies the same noise classification the
 * legacy path relies on.
 *
 * Must be called with the SAME admin transaction the named-conversation
 * writer is committing in (`existingConnection`), so a rejected/rolled-back
 * write can never leave a ticket reopened without its triggering message, and
 * a reopen can never partially commit ahead of the conversation/attention
 * update it depends on.
 */
export async function evaluateSideConversationReopenPolicy(trx: Knex.Transaction, input: {
  tenantId: string;
  ticketId: string;
  email: EmailMessageDetails;
  text: string;
  updatedByUserId?: string | null;
}): Promise<SideConversationReopenOutcome> {
  const policy = await loadInboundReplyPolicyContext({ tenantId: input.tenantId, ticketId: input.ticketId, existingConnection: trx });
  if (!policy || !policy.ticketIsClosed || !policy.inboundReplyReopenEnabled) return { action: 'none' };

  const board = await tenantDb(trx, input.tenantId).table('boards').where('board_id', policy.boardId)
    .first('inbound_reply_reopen_side_conversations_enabled');
  if (!board?.inbound_reply_reopen_side_conversations_enabled) return { action: 'none' };

  // F064/F065: cutoff precedence before automated/ack suppression, matching
  // the legacy requester ordering exactly. In normal operation the caller
  // already checked `isSideConversationCutoffExceeded` BEFORE writing the
  // message and redirected to a follow-up ticket if so (see
  // `createSideConversationFollowup` and its call site in
  // `inboundNamedConversationEmail.ts`), so this ticket is generally not
  // still closed-and-cutoff-exceeded by the time this runs. Kept as a
  // defensive second check (e.g. a caller that reuses this function directly
  // without the precheck) rather than assumed unreachable.
  if (isClosedTicketBeyondReopenCutoff({ closedAt: policy.closedAt, receivedAt: input.email.receivedAt, cutoffHours: policy.inboundReplyReopenCutoffHours })) {
    return { action: 'comment_only', reason: 'cutoff_exceeded' };
  }

  if (detectAutomatedInboundMessage(input.email).isAutomated) return { action: 'comment_only', reason: 'automated_message' };

  if (policy.inboundReplyAiAckSuppressionEnabled) {
    const decider = await resolveInboundReplyAcknowledgementDecider();
    const ack = await decider.decide({ tenantId: input.tenantId, boardId: policy.boardId, ticketId: input.ticketId,
      subject: input.email.subject ?? '', text: input.text });
    if (ack.decision === 'ACK') return { action: 'comment_only', reason: 'ai_ack' };
  }

  const rateLimit = await checkInboundReopenRateLimit({ tenantId: input.tenantId, ticketId: input.ticketId });
  if (!rateLimit.allowed) return { action: 'comment_only', reason: 'rate_limited' };

  // F067: canonical reopen lifecycle effects — the same status resolution and
  // ticket transition (activity row, is_closed/closed_at reset) the legacy
  // requester path uses. This never touches bundle-reopen or SLA machinery,
  // so it cannot be misclassified as a qualifying child/requester reply (F066).
  const target = await resolveBoardReopenStatusTarget({ tenantId: input.tenantId, boardId: policy.boardId,
    explicitStatusId: policy.inboundReplyReopenStatusId, existingConnection: trx });
  await applyInboundReplyReopenTransition({ tenantId: input.tenantId, ticketId: input.ticketId, statusId: target.statusId,
    updatedByUserId: input.updatedByUserId ?? undefined, existingConnection: trx });
  return { action: 'reopened', statusId: target.statusId, source: target.source };
}
