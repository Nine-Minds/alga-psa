/**
 * Detects when an inbound message is actually one of THIS tenant's own
 * outbound ticket notifications being redelivered into a different connected
 * inbound mailbox — not genuine correspondence — so the caller can suppress
 * it before any ticket/comment/watch-list mutation.
 *
 * Production incident this addresses: tenant with two connected inbound
 * mailboxes A (`hello@...`) and B (`jamie@...`). B was also the assignee /
 * watcher on tickets, so Alga's own "Ticket Updated" / "Ticket Assigned" /
 * "New Ticket" / "New Comment" notifications sent FROM A TO B were delivered
 * into B's own connected inbox and re-ingested as new inbound mail, each one
 * becoming a client comment (27 in the incident). The existing self-sent
 * guard in `processInboundEmailInApp.ts` only compares the sender against the
 * *receiving* provider's own mailbox, so an A -> B loop within the same
 * tenant slips through it entirely.
 *
 * Design (see docs referenced in the work order for full constraints):
 *
 * Tier 1 — reply-token ledger correlation (primary, header-independent).
 *   The conversation/reply token embedded in every ticket notification lives
 *   in the message BODY (a hidden div + footer line — see
 *   `sendEventEmail.ts` `applyReplyMarkers`), not in transport headers, so
 *   this tier survives providers that strip custom headers and survives
 *   Message-ID rewriting (it never looks at Message-ID/In-Reply-To/References
 *   at all — those are NOT used as loop evidence, since a genuine reply
 *   legitimately threads through them).
 *
 *   We hash the extracted token (SHA-256, same algorithm already used by
 *   `BaseEmailService.logEmailSendResult` to populate
 *   `email_sending_logs.reply_token_hash`) and look up a tenant-scoped row by
 *   that hash. A match alone is NOT sufficient — a genuine reply quoting the
 *   original notification also carries the same token. What distinguishes a
 *   real loop is that the matched outbound send's `from_address` equals
 *   *this* inbound message's sender (a human replying would have `From` =
 *   their own address, never our outbound identity) AND the matched send's
 *   recipient list contains the mailbox that is now reporting this message as
 *   "new" inbound mail (i.e. we really did address the notification to the
 *   very inbox redelivering it). Both conditions together cannot be produced
 *   by genuine correspondence, only by our own notification bouncing back.
 *
 * Tier 2 — automated-header + ledger fallback (used only when no token could
 *   be extracted from the body at all). Requires a genuine RFC 3834
 *   automated-message signal (`detectAutomatedInboundMessage`) — a human's
 *   mail client does not add `Auto-Submitted: auto-generated` — plus the same
 *   sender/recipient ledger correlation and an exact subject match, bounded
 *   to a recency window since this tier has no cryptographic tie to one
 *   specific send. This is intentionally weaker and is documented as a
 *   best-effort fallback, not a primary guarantee (see draftSummary for the
 *   per-provider header-survival findings this fallback exists to cover).
 *
 * Neither tier ever suppresses on: a bare sender-address match, a bare
 * Auto-Submitted header alone, thread-header (In-Reply-To/References)
 * membership alone, or reply-token presence alone — each of those is
 * satisfied by ordinary genuine replies too.
 */

import { createHash } from 'node:crypto';
import type { EmailMessageDetails } from '../../interfaces/inbound-email.interfaces';
import { normalizeEmailAddress } from '../../lib/email/addressUtils';
import { detectAutomatedInboundMessage, type AutomatedMessageSignal } from '../../lib/email/automatedMessage';

export type NotificationLoopTier = 'reply_token_ledger' | 'automated_header_ledger_fallback';

export interface NotificationLoopEvidence {
  conversationTokenPresent: boolean;
  tokenHashLookupAttempted: boolean;
  tokenHashMatched: boolean;
  fallbackLookupAttempted: boolean;
  fallbackLookupMatched: boolean;
  recipientMatchedLoggedSend: boolean;
  senderMatchesLoggedFromAddress: boolean;
  subjectMatchedLoggedSend: boolean;
  automated: AutomatedMessageSignal;
}

export interface NotificationLoopDetectionResult {
  isLoop: boolean;
  tier: NotificationLoopTier | null;
  matchedLogId: number | string | null;
  matchedEntityType: string | null;
  matchedEntityId: string | null;
  evidence: NotificationLoopEvidence;
}

interface EmailSendingLogRow {
  id: number | string;
  from_address: string | null;
  to_addresses: unknown;
  cc_addresses: unknown;
  bcc_addresses: unknown;
  entity_type: string | null;
  entity_id: string | null;
  subject: string | null;
  created_at: string | Date | null;
}

// Tier 2 has no cryptographic tie to one specific send (unlike the token
// hash), so it is bounded to a recency window as a sanity bound. A week
// comfortably covers retry/duplicate-delivery redeliveries without matching
// unrelated older sends that happen to share a from-address and subject.
const FALLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function hashReplyToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

function toEmailArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeSubject(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function recipientListContains(row: EmailSendingLogRow, target: string | null): boolean {
  if (!target) return false;
  const recipients = [
    ...toEmailArray(row.to_addresses),
    ...toEmailArray(row.cc_addresses),
    ...toEmailArray(row.bcc_addresses),
  ]
    .map((email) => normalizeEmailAddress(email))
    .filter((email): email is string => Boolean(email));
  return recipients.includes(target);
}

async function withTenantAdminTransaction<T>(tenantId: string, callback: (db: any) => Promise<T>): Promise<T> {
  const { withAdminTransaction, tenantDb } = await import('@alga-psa/db');
  return withAdminTransaction(async (trx: any) => callback(tenantDb(trx, tenantId)));
}

const LOG_COLUMNS = [
  'id',
  'from_address',
  'to_addresses',
  'cc_addresses',
  'bcc_addresses',
  'entity_type',
  'entity_id',
  'subject',
  'created_at',
];

async function findEmailSendingLogByReplyTokenHash(
  tenantId: string,
  tokenHash: string
): Promise<EmailSendingLogRow | null> {
  return withTenantAdminTransaction(tenantId, async (db) => {
    const row = await db
      .table('email_sending_logs')
      .select(...LOG_COLUMNS)
      .where({ reply_token_hash: tokenHash })
      .orderBy('created_at', 'desc')
      .first();
    return (row ?? null) as EmailSendingLogRow | null;
  });
}

async function findRecentEmailSendingLogBySender(
  tenantId: string,
  params: { fromAddress: string; sinceIso: string }
): Promise<EmailSendingLogRow | null> {
  return withTenantAdminTransaction(tenantId, async (db) => {
    const row = await db
      .table('email_sending_logs')
      .select(...LOG_COLUMNS)
      .where({ status: 'sent' })
      .andWhereRaw('lower(from_address) = ?', [params.fromAddress])
      .andWhereRaw('created_at >= ?', [params.sinceIso])
      .orderBy('created_at', 'desc')
      .first();
    return (row ?? null) as EmailSendingLogRow | null;
  });
}

export async function detectOutboundNotificationLoop(params: {
  tenantId: string;
  emailData: EmailMessageDetails;
  senderEmail: string | null;
  /** The mailbox address of the provider that is ingesting this message. */
  providerMailboxEmail: string | null;
  conversationToken?: string;
  now?: Date;
}): Promise<NotificationLoopDetectionResult> {
  const automated = detectAutomatedInboundMessage(params.emailData);
  const senderEmail = params.senderEmail ? normalizeEmailAddress(params.senderEmail) : null;
  const providerMailboxEmail = params.providerMailboxEmail
    ? normalizeEmailAddress(params.providerMailboxEmail)
    : null;

  const evidence: NotificationLoopEvidence = {
    conversationTokenPresent: Boolean(params.conversationToken?.trim()),
    tokenHashLookupAttempted: false,
    tokenHashMatched: false,
    fallbackLookupAttempted: false,
    fallbackLookupMatched: false,
    recipientMatchedLoggedSend: false,
    senderMatchesLoggedFromAddress: false,
    subjectMatchedLoggedSend: false,
    automated,
  };

  const notLoop = (): NotificationLoopDetectionResult => ({
    isLoop: false,
    tier: null,
    matchedLogId: null,
    matchedEntityType: null,
    matchedEntityId: null,
    evidence,
  });

  if (!senderEmail || !providerMailboxEmail) {
    return notLoop();
  }

  // Tier 1: reply-token ledger correlation.
  const token = params.conversationToken?.trim();
  if (token) {
    evidence.tokenHashLookupAttempted = true;
    let row: EmailSendingLogRow | null = null;
    try {
      row = await findEmailSendingLogByReplyTokenHash(params.tenantId, hashReplyToken(token));
    } catch (error) {
      console.warn('notificationLoopDetection: reply-token ledger lookup failed (continuing)', {
        tenantId: params.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (row) {
      evidence.tokenHashMatched = true;
      const rowFromAddress = normalizeEmailAddress(row.from_address ?? undefined);
      evidence.senderMatchesLoggedFromAddress = Boolean(rowFromAddress) && rowFromAddress === senderEmail;
      evidence.recipientMatchedLoggedSend = recipientListContains(row, providerMailboxEmail);

      if (evidence.senderMatchesLoggedFromAddress && evidence.recipientMatchedLoggedSend) {
        return {
          isLoop: true,
          tier: 'reply_token_ledger',
          matchedLogId: row.id,
          matchedEntityType: row.entity_type,
          matchedEntityId: row.entity_id,
          evidence,
        };
      }
    }
  }

  // Tier 2: fallback for messages where no token survived extraction.
  if (!automated.isAutomated) {
    return notLoop();
  }

  evidence.fallbackLookupAttempted = true;
  const sinceIso = new Date((params.now ?? new Date()).getTime() - FALLBACK_WINDOW_MS).toISOString();
  let fallbackRow: EmailSendingLogRow | null = null;
  try {
    fallbackRow = await findRecentEmailSendingLogBySender(params.tenantId, {
      fromAddress: senderEmail,
      sinceIso,
    });
  } catch (error) {
    console.warn('notificationLoopDetection: fallback ledger lookup failed (continuing)', {
      tenantId: params.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!fallbackRow) {
    return notLoop();
  }

  evidence.recipientMatchedLoggedSend = recipientListContains(fallbackRow, providerMailboxEmail);
  evidence.senderMatchesLoggedFromAddress = true; // enforced by the query's from_address filter
  evidence.subjectMatchedLoggedSend =
    normalizeSubject(fallbackRow.subject).length > 0 &&
    normalizeSubject(fallbackRow.subject) === normalizeSubject(params.emailData.subject);

  if (!evidence.recipientMatchedLoggedSend || !evidence.subjectMatchedLoggedSend) {
    return notLoop();
  }

  evidence.fallbackLookupMatched = true;
  return {
    isLoop: true,
    tier: 'automated_header_ledger_fallback',
    matchedLogId: fallbackRow.id,
    matchedEntityType: fallbackRow.entity_type,
    matchedEntityId: fallbackRow.entity_id,
    evidence,
  };
}
