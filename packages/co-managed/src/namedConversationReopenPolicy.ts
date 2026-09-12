import type { Knex } from 'knex';
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

  // F064: cutoff precedence before automated/ack suppression, matching the
  // legacy requester ordering exactly.
  if (isClosedTicketBeyondReopenCutoff({ closedAt: policy.closedAt, receivedAt: input.email.receivedAt, cutoffHours: policy.inboundReplyReopenCutoffHours })) {
    // F065: the equivalent side-conversation follow-up-ticket routing is not
    // performed here (see SCRATCHPAD); the reply stays attached to the
    // existing closed ticket's side conversation without reopening it.
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
