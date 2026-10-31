import { createHash } from 'node:crypto';
import { sharedWorkSeam } from '../utils/sharedWorkSeam';
import type { CommentAudience } from './commentAudience';

/**
 * Delivery seam for co-managed (shared) work.
 *
 * Native subscribers ask `coManagedDeliverySeam.resolve(tenant)` ONCE per event. For a tenant the
 * capability gate does not serve (flag off, no entitlement, FORCE_CAPABILITIES=co-managed:off, or the
 * package failed to resolve) the answer is null with zero `co_management_*` SQL, and the native path
 * runs untouched. Native code never imports @alga-psa/co-managed.
 */
export type DeliveryRecipientKind = 'msp_user' | 'customer_user' | 'requester_contact' | 'team';

export interface DeliveryRecipient {
  kind: DeliveryRecipientKind;
  /** Stable principal id (user id, contact id, team id). Never rendered. */
  principalId: string;
  /** Email address for email delivery; absent for in-app only recipients. */
  email?: string;
}

export interface CommentDeliveryPlan {
  /** Audience of the comment's thread (L4a `resolveCommentAudience`), never `is_internal`. */
  audience: CommentAudience;
  threadId: string | null;
  relationshipId: string;
  /** The MSP tenant whose users appear in `sponsorRecipients` (their inbox rows live in that tenant). */
  sponsorTenant: string;
  /** Sponsor-tenant (MSP) recipients, each already re-checked against its OWN current policy. */
  sponsorRecipients: DeliveryRecipient[];
  /** Metadata for the `cm2:` reply token minted on every mail of this plan. */
  replyTokenMetadata: CoManagedReplyTokenMetadata;
}

/** A verified inbound sender who may write into a shared conversation. */
export interface InboundCommentActor {
  tenant: string;
  userId: string;
}

export type InboundAdmission =
  | { admitted: true; audience: CommentAudience; relationshipId: string; threadId: string | null; ticketId: string; parentCommentId: string | null;
      /** Set for shared_it / organization_private: the participant to write as. Absent = requester thread (native writer). */
      actor?: InboundCommentActor }
  | { admitted: false; reason: 'legacy_token' | 'stale_generation' | 'grant_revoked' | 'not_served' | 'not_participant' | 'audience_forbidden'; acknowledge: boolean };

export interface InboundCommentWrite {
  tenant: string;
  ticketId: string;
  relationshipId: string;
  threadId: string | null;
  parentCommentId: string | null;
  audience: CommentAudience;
  actor: InboundCommentActor;
  /** Deterministic from the inbound message so a replay hits the writer's operation receipt. */
  operationId: string;
  text: string;
}

/** One routing notification still owed (a `pending`/`failed` ledger row), with everything needed to deliver it. */
export interface RoutingDelivery {
  tenant: string;
  /** `routing_in_app` | `routing_email` */
  deliveryKind: string;
  /** The handoff/assignment command's operation id. */
  sourceId: string;
  event: 'escalation_received' | 'escalation_returned' | 'ticket_assigned';
  /**
   * Who to deliver to NOW. For customer_user rows `principalId` and `email` are re-resolved from the
   * current user record at delivery time, so `email` may differ from the address captured when the row was enqueued.
   */
  recipient: DeliveryRecipient;
  /**
   * The stored ledger row's `recipient` column (captured principal id for in-app, captured lowercase email for email).
   * claim/finish MUST key on this, never on `recipient.email`, or a changed address orphans the pending row.
   * Falls back to `recipient.email ?? recipient.principalId` when absent.
   */
  ledgerRecipient?: string;
  /** Tenant in which the in-app row is created (the recipient's own tenant). */
  recipientTenant: string;
  ticketId: string;
  ticketNumber: string;
  ticketTitle: string;
  actorName: string;
  actorOrganization: string;
  /** False when the recipient's CURRENT policy no longer admits them (inactive, reassigned, or unauthorized for the ticket; no current email for an email row): skip, never send. */
  allowed: boolean;
}

export interface CoManagedDeliveryProvider {
  /**
   * Routing deliveries still owed: ledger rows in `pending`/`failed`. With `sourceId` only that command's
   * rows (the post-commit subscriber); without it a bounded batch for the tenant (recovery).
   */
  pendingRouting(tenant: string, opts?: { sourceId?: string; limit?: number }): Promise<RoutingDelivery[]>;
  /**
   * Routing rows stuck in `sending` longer than `olderThanMs` (a crash between claim and finish): the provider
   * outcome is unknown, so they are flagged `requires_reconciliation` and never re-sent. Returns the count flagged.
   */
  flagStaleRoutingSending(tenant: string, olderThanMs: number): Promise<number>;
  /** Null when the ticket is not shared (or its grant is revoked); the native recipient step then runs unchanged. */
  planTicketComment(tenant: string, ticketId: string, commentId: string): Promise<CommentDeliveryPlan | null>;
  /**
   * Audience of a native project-task comment's thread (`projectTaskAudience`: only explicit, consistent
   * metadata makes a task comment shared; everything else is organization_private). Null when the tenant
   * is not served or the comment/thread cannot be read. Tasks have no sponsor tenant, so the plan carries
   * no sponsor recipients and no reply token.
   */
  planTaskComment(tenant: string, taskCommentId: string): Promise<{ audience: CommentAudience } | null>;
  /** Claim a ledger row; true = this caller owns the send. */
  claim(tenant: string, kind: string, sourceId: string, recipient: DeliveryRecipient): Promise<boolean>;
  finish(tenant: string, kind: string, sourceId: string, recipient: DeliveryRecipient, state: 'sent' | 'failed' | 'sending', outcome?: { error?: string; code?: string }): Promise<void>;
  /** Inbound reply-token admission for a `cm2:`/`cm1:` token (metadata from email_reply_tokens) and a sender address. */
  admitReplyToken(tenant: string, token: string, metadata: unknown, senderEmail: string | null): Promise<InboundAdmission>;
}

/**
 * Writer for admitted shared_it / organization_private email replies. The server registers it
 * (it needs the tickets-package comment adapter); images that never register it make the inbound
 * path fail retryably rather than write a reply through the wrong writer.
 */
export interface CoManagedInboundCommentWriter {
  write(input: InboundCommentWrite): Promise<{ commentId: string }>;
  /**
   * Send the ONE acknowledgement mail for a refused reply (no comment is written). Idempotent per
   * (token, sender) through the delivery ledger; never sent to automated senders.
   */
  acknowledgeRefusal(input: { tenant: string; token: string; to: string; ticketId: string; reason: string }): Promise<void>;
}
export const coManagedInboundCommentSeam = sharedWorkSeam<CoManagedInboundCommentWriter>('inbound-comment');

/** Candidate recipients the native subscriber already loaded, classified by kind. */
export interface ThreadParticipants {
  sponsorUsers: DeliveryRecipient[];
  sponsorTeams: DeliveryRecipient[];
  customerUsers: DeliveryRecipient[];
  requester: DeliveryRecipient | null;
}

/**
 * Pure audience -> recipients. The audience alone decides reach:
 *   requester            -> requester contact + customer users + sponsor users/teams
 *   shared_it            -> customer users + sponsor users/teams; never the requester
 *   organization_private -> customer-tenant users only; no sponsor tenant, no requester
 */
export function recipientsForAudience(audience: CommentAudience, p: ThreadParticipants): DeliveryRecipient[] {
  const out: DeliveryRecipient[] = [];
  switch (audience) {
    case 'requester':
      if (p.requester) out.push(p.requester);
      out.push(...p.customerUsers, ...p.sponsorUsers, ...p.sponsorTeams);
      break;
    case 'shared_it':
      out.push(...p.customerUsers, ...p.sponsorUsers, ...p.sponsorTeams);
      break;
    case 'organization_private':
      out.push(...p.customerUsers);
      break;
    default:
      return [];
  }
  const seen = new Set<string>();
  return out.filter((r) => {
    const key = `${r.kind}:${r.principalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const coManagedDeliverySeam = sharedWorkSeam<CoManagedDeliveryProvider>('delivery');

/**
 * Workflow ticket-mutation authority (L4a `retainCoManagedWorkflowTicketAuthority`). The workflow runtime
 * lives in shared/ and cannot import the co-managed package, so it asks this seam: not served / not
 * registered answers null with 0 SQL and the native action runs unchanged.
 */
export interface CoManagedWorkflowTicketAuthority {
  retain(trx: unknown, input: { tenant: string; ticketId: string; workflowRunId: string; actorUserId: string; fields: string[]; readFields: string[] }): Promise<void>;
}
export const coManagedWorkflowTicketSeam = sharedWorkSeam<CoManagedWorkflowTicketAuthority>('workflow-ticket');

// ---- reply-token namespace ------------------------------------------------------------------

export const CM2_TOKEN_PREFIX = 'cm2:';
export const CM1_TOKEN_PREFIX = 'cm1:';

export interface CoManagedReplyTokenMetadata {
  namespace: 'cm';
  version: 2;
  relationshipId: string;
  /** Count of `access_revoked` handoffs at mint time; a later revoke makes the token stale. */
  grantGeneration: number;
  threadId: string | null;
}

export type ReplyTokenClass = 'native' | 'cm1' | 'cm2';

/** Pure prefix check. A native (psa) token costs this one string compare and nothing else. */
export function classifyReplyToken(token: string | null | undefined): ReplyTokenClass {
  const t = (token ?? '').trim().toLowerCase();
  if (t.startsWith(CM2_TOKEN_PREFIX)) return 'cm2';
  if (t.startsWith(CM1_TOKEN_PREFIX)) return 'cm1';
  return 'native';
}

export function mintCm2Token(uuid: string): string {
  return `${CM2_TOKEN_PREFIX}${uuid}`;
}

/** Returns validated metadata, or null when malformed (caller falls through to thread headers). */
export function parseCm2Metadata(raw: unknown): CoManagedReplyTokenMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.namespace !== 'cm' || m.version !== 2) return null;
  if (typeof m.relationshipId !== 'string' || !m.relationshipId) return null;
  if (typeof m.grantGeneration !== 'number' || !Number.isInteger(m.grantGeneration) || m.grantGeneration < 0) return null;
  const threadId = typeof m.threadId === 'string' ? m.threadId : null;
  return { namespace: 'cm', version: 2, relationshipId: m.relationshipId, grantGeneration: m.grantGeneration, threadId };
}

export type TokenDecision =
  | { action: 'native' }
  | { action: 'fall_through' }
  | { action: 'refuse'; reason: 'legacy_token' | 'stale_generation'; acknowledge: true }
  | { action: 'admit'; metadata: CoManagedReplyTokenMetadata };

/**
 * Pure decision for an inbound token given the CURRENT grant generation (supplied by the provider
 * after a served-gate check). Refusal happens before any comment write.
 */
export function decideReplyToken(token: string | null | undefined, metadata: unknown, currentGeneration: number | null): TokenDecision {
  const cls = classifyReplyToken(token);
  if (cls === 'native') return { action: 'native' };
  if (cls === 'cm1') return { action: 'refuse', reason: 'legacy_token', acknowledge: true };
  const parsed = parseCm2Metadata(metadata);
  if (!parsed) return { action: 'fall_through' };
  if (currentGeneration === null || parsed.grantGeneration !== currentGeneration) {
    return { action: 'refuse', reason: 'stale_generation', acknowledge: true };
  }
  return { action: 'admit', metadata: parsed };
}

/** Operation id for an admitted inbound write: deterministic per (message, ticket) so a replay finds its command receipt. */
export function coManagedInboundOperationId(tenant: string, ticketId: string, messageKey: string): string {
  const hex = createHash('sha256').update(`co-managed-inbound:${tenant}:${ticketId}:${messageKey}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
