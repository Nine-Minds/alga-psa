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
  audience: CommentAudience;
  threadId: string | null;
  /** Reply token to mint for outbound mail (`cm2:` namespace) — see token helpers below. */
  replyToken?: { token: string; metadata: CoManagedReplyTokenMetadata };
  recipients: DeliveryRecipient[];
}

export type InboundAdmission =
  | { admitted: true; audience: CommentAudience; relationshipId: string; threadId: string | null }
  | { admitted: false; reason: 'legacy_token' | 'stale_generation' | 'grant_revoked' | 'not_served' | 'audience_unsupported'; acknowledge: boolean };

export interface CoManagedDeliveryProvider {
  /** Null when the ticket is not shared; the native recipient step then runs unchanged. */
  planTicketComment(tenant: string, ticketId: string, commentId: string): Promise<CommentDeliveryPlan | null>;
  /** Claim a ledger row; true = this caller owns the send. */
  claim(tenant: string, kind: string, sourceId: string, recipient: DeliveryRecipient): Promise<boolean>;
  finish(tenant: string, kind: string, sourceId: string, recipient: DeliveryRecipient, state: 'sent' | 'failed' | 'sending', outcome?: { error?: string; code?: string }): Promise<void>;
  /** Inbound reply-token admission for a `cm2:` token (metadata from email_reply_tokens). */
  admitReplyToken(tenant: string, token: string, metadata: unknown): Promise<InboundAdmission>;
}

export const coManagedDeliverySeam = sharedWorkSeam<CoManagedDeliveryProvider>('delivery');

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
