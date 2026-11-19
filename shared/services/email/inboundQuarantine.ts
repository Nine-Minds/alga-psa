/**
 * Inbound email quarantine: durable record + best-effort admin notification.
 *
 * `processInboundEmailInApp` refuses some inbound messages (`outcome:
 * 'quarantined'`). Before this module the refusal left only a log line, so an
 * MSP admin could never learn that a customer's reply was dropped. Every
 * quarantine now goes through `surfaceInboundQuarantine`, which
 *
 *   1. PERSISTS an `inbound_email_quarantine` row directly with the DB handle
 *      the shared code already has. Persistence deliberately does NOT depend on
 *      any registered hook: a runtime that was mis-wired must still leave the
 *      durable record the queue page and the ticket banner read.
 *   2. Dispatches a best-effort notification hook for newly recorded rows.
 *      `shared/` cannot import `@alga-psa/notifications` (package cycle), so —
 *      exactly like inboundAuthPauseNotifier.ts — the server registers the real
 *      notifier and worker runtimes (email-service, Temporal worker) register an
 *      event publisher that the server's subscriber turns into notifications.
 *
 * Nothing here ever throws into the caller: surfacing failures are logged and
 * swallowed, and must never change a quarantine outcome.
 *
 * Never stored: message bodies, raw headers. Subject is truncated.
 */

import { createHash, randomUUID } from 'node:crypto';
import { normalizeRfc822MessageId } from './inboundEmailIdentity';
import { withTenantAdminTransaction } from './tenantAdminTransaction';
import {
  QUARANTINE_DAILY_ROW_CAP_PER_MAILBOX,
  QUARANTINE_SUBJECT_MAX_LENGTH,
  type QuarantineMatchedBy,
  type QuarantineReason,
} from './inboundQuarantineConstants';

export {
  QUARANTINE_REASONS,
  QUARANTINE_MATCHED_BY,
  QUARANTINE_STATUSES,
  QUARANTINE_SUBJECT_MAX_LENGTH,
  QUARANTINE_DAILY_ROW_CAP_PER_MAILBOX,
  QUARANTINE_DISMISSED_RETENTION_DAYS,
  QUARANTINE_NOTIFICATION_WINDOW_MINUTES,
  type QuarantineReason,
  type QuarantineMatchedBy,
  type QuarantineStatus,
} from './inboundQuarantineConstants';

export function truncateQuarantineSubject(subject: string | null | undefined): string {
  const value = typeof subject === 'string' ? subject.trim() : '';
  return value.length > QUARANTINE_SUBJECT_MAX_LENGTH
    ? `${value.slice(0, QUARANTINE_SUBJECT_MAX_LENGTH - 1)}…`
    : value;
}

/** sha256 hex of the normalized RFC 5322 Message-ID (angle brackets / `rfc822:` prefix removed). */
export function hashQuarantineMessageId(messageId: string): string {
  const normalized = normalizeRfc822MessageId(messageId) ?? messageId.trim();
  return createHash('sha256').update(normalized).digest('hex');
}

// ---------------------------------------------------------------------------
// Notification hook (best-effort; mirrors inboundAuthPauseNotifier.ts)
// ---------------------------------------------------------------------------

// LEVERAGE: pattern shared-notifier-hook — register/clear/isRegistered/assert/dispatch + event-publisher + server subscriber is written once per notification kind (auth-pause, quarantine); a generic 'runtime-hook + worker→server event' layer would make the next one a declaration
export interface InboundQuarantineNotificationParams {
  tenant: string;
  /** The persisted row. The server notifier uses it to claim the throttle window. */
  quarantineId: string;
  providerId: string;
  mailbox: string;
  sender: string;
  subject: string;
  reason: QuarantineReason;
  matchedBy: QuarantineMatchedBy | null;
  ticketId: string | null;
  ticketNumber: string | null;
  quarantinedAt: string;
}

export type InboundQuarantineNotifier = (params: InboundQuarantineNotificationParams) => Promise<void>;

let registeredNotifier: InboundQuarantineNotifier | null = null;

export function registerInboundQuarantineNotifier(notifier: InboundQuarantineNotifier): void {
  registeredNotifier = notifier;
}

export function clearInboundQuarantineNotifier(): void {
  registeredNotifier = null;
}

export function isInboundQuarantineNotifierRegistered(): boolean {
  return registeredNotifier !== null;
}

/**
 * Startup guard: logs loudly (never throws) when this runtime has no
 * notification hook. The durable row is still written without one, but admins
 * would not be told — a mis-wired deployment should be visible at boot.
 */
export function assertInboundQuarantineNotifierRegistered(entrypoint: string): boolean {
  if (isInboundQuarantineNotifierRegistered()) {
    return true;
  }
  console.error('[InboundQuarantine] NO inbound quarantine notifier registered; quarantines would be recorded but admins not notified', {
    event: 'inbound_quarantine_notifier_missing',
    entrypoint,
    remediation: 'Register a notifier (direct or event-publisher) at startup of every runtime that runs processInboundEmailInApp.',
  });
  return false;
}

export async function dispatchInboundQuarantineNotification(
  params: InboundQuarantineNotificationParams
): Promise<void> {
  if (!registeredNotifier) {
    console.warn('[InboundQuarantine] no quarantine notifier registered; row recorded without admin notification', {
      tenant: params.tenant,
      quarantineId: params.quarantineId,
      reason: params.reason,
    });
    return;
  }
  try {
    await registeredNotifier(params);
  } catch (error) {
    console.warn('[InboundQuarantine] quarantine notification delivery failed', {
      tenant: params.tenant,
      quarantineId: params.quarantineId,
      reason: params.reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Persistence (direct; independent of hook registration)
// ---------------------------------------------------------------------------

export interface InboundQuarantineRecordInput {
  tenant: string;
  providerId: string;
  /** RFC 5322 Message-ID of the refused message (`emailData.id`). */
  messageId: string;
  sender: string | null;
  subject: string | null;
  receivedAt: string | null;
  reason: QuarantineReason;
  matchedBy: QuarantineMatchedBy | null;
  ticketId: string | null;
}

export type InboundQuarantineRecordResult =
  | { status: 'inserted'; notification: InboundQuarantineNotificationParams }
  | { status: 'duplicate' }
  | { status: 'capped' };

const TABLE = 'inbound_email_quarantine';

export async function recordInboundQuarantine(
  input: InboundQuarantineRecordInput
): Promise<InboundQuarantineRecordResult> {
  const messageIdHash = hashQuarantineMessageId(input.messageId);
  const subject = truncateQuarantineSubject(input.subject);
  const sender = (input.sender ?? '').trim();

  return withTenantAdminTransaction(input.tenant, async (trx: any, db: any) => {
    const provider = await db.table('email_providers')
      .where({ id: input.providerId })
      .first('mailbox');
    const mailbox: string = provider?.mailbox ?? '';

    let ticketNumber: string | null = null;
    if (input.ticketId) {
      const ticket = await db.table('tickets')
        .where({ ticket_id: input.ticketId })
        .first('ticket_number');
      ticketNumber = ticket?.ticket_number != null ? String(ticket.ticket_number) : null;
    }

    // Per-mailbox-per-day cap: a flood must not fill the table. Duplicates
    // (redelivery) are not counted against the cap because they insert nothing.
    const existing = await db.table(TABLE)
      .where({ provider_id: input.providerId, message_id_hash: messageIdHash })
      .first('id');
    if (existing) return { status: 'duplicate' } as const;

    const countRow = await db.table(TABLE)
      .where({ provider_id: input.providerId })
      .where('quarantined_at', '>=', trx.raw("date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'"))
      .count('id as count')
      .first();
    if (Number(countRow?.count ?? 0) >= QUARANTINE_DAILY_ROW_CAP_PER_MAILBOX) {
      console.warn('[InboundQuarantine] per-mailbox daily quarantine row cap reached; row not stored', {
        tenant: input.tenant,
        providerId: input.providerId,
        cap: QUARANTINE_DAILY_ROW_CAP_PER_MAILBOX,
      });
      return { status: 'capped' } as const;
    }

    const id = randomUUID();
    const quarantinedAt = new Date().toISOString();
    const receivedAt = input.receivedAt && !Number.isNaN(Date.parse(input.receivedAt))
      ? new Date(input.receivedAt).toISOString()
      : quarantinedAt;
    const inserted = await db.table(TABLE)
      .insert({
        tenant: input.tenant,
        id,
        provider_id: input.providerId,
        mailbox,
        sender,
        subject,
        received_at: receivedAt,
        quarantined_at: quarantinedAt,
        reason: input.reason,
        matched_by: input.matchedBy,
        ticket_id: input.ticketId,
        ticket_number: ticketNumber,
        message_id_hash: messageIdHash,
        status: 'open',
      })
      .onConflict(['tenant', 'provider_id', 'message_id_hash'])
      .ignore()
      .returning('id');
    if (!Array.isArray(inserted) || inserted.length === 0) return { status: 'duplicate' } as const;

    return {
      status: 'inserted',
      notification: {
        tenant: input.tenant,
        quarantineId: id,
        providerId: input.providerId,
        mailbox,
        sender,
        subject,
        reason: input.reason,
        matchedBy: input.matchedBy,
        ticketId: input.ticketId,
        ticketNumber,
        quarantinedAt,
      },
    } as const;
  });
}

/**
 * The surfacing dispatch called from the single `quarantined(...)` choke point
 * in processInboundEmailInApp. Persist first (no hook dependency), then notify
 * only for newly recorded rows (redelivery must not re-notify). Never throws.
 */
export async function surfaceInboundQuarantine(input: InboundQuarantineRecordInput): Promise<void> {
  try {
    const result = await recordInboundQuarantine(input);
    if (result.status === 'inserted') {
      await dispatchInboundQuarantineNotification(result.notification);
    }
  } catch (error) {
    console.error('[InboundQuarantine] failed to surface quarantined inbound email (outcome unchanged)', {
      tenant: input.tenant,
      providerId: input.providerId,
      reason: input.reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
