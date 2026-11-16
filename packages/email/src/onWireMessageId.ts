/**
 * On-wire Message-ID recording (alga0002306, extends alga-2026-0002798).
 *
 * Some providers (Amazon SES directly over SMTP, Resend which relays through SES)
 * discard the Message-ID AlgaPSA puts on a message and stamp their own. Recipients
 * reply to the on-wire id, so that is the id that must live in
 * `email_sending_logs.rfc_message_id`, and it is the id later `In-Reply-To` /
 * `References` headers must name. The id AlgaPSA generated is kept in
 * `metadata.generatedRfcMessageId`.
 *
 * This module is the single contract for that, shared by every path:
 *   - `onWireMessageIdFields`  — synchronous: a provider that learns the on-wire id while
 *                                sending (SMTP SES `250 Ok`, Resend `message_id`).
 *   - `reconcileOnWireMessageId` — asynchronous: the Resend `email.sent` webhook and the
 *                                backfill learn it after the log row exists.
 * There must not be a third variant.
 *
 * ## Stored copies of the generated id (F002)
 *
 * Found by grepping every write of rfcMessageId / Message-ID / email_references /
 * references / inReplyTo / email_message_id in packages/email, shared/services/email and
 * server/src. `reconcileOnWireMessageId` rewrites each one that can feed a later
 * In-Reply-To / References header, replacing only the matching element:
 *
 *  1. email_sending_logs.rfc_message_id           — set to the on-wire id (the point of this module).
 *  2. email_sending_logs.metadata.algaDiagnostics.outbound.rfcMessageId — diagnostics copy; rewritten.
 *  3. comment_threads.email_references (text[])    — BaseEmailService.persistCommentThreadReferences;
 *                                                    element replaced, order kept, duplicates dropped.
 *  4. comment_threads.email_message_id             — BaseEmailService.logEmailSendResult reply-context
 *                                                    copy for a thread's root comment; replaced when equal.
 *  5. tickets.email_metadata.references (jsonb[])  — server/src/lib/notifications/sendEventEmail.ts
 *                                                    appendOutboundMessageIdReference; element replaced.
 *  6. tickets.email_metadata.threadRoot            — applyTicketThreadHeaders anchor; replaced only if it
 *                                                    equals the generated id (normally a synthetic
 *                                                    `<ticket-{id}@domain>` that is never a Message-ID).
 *
 * Known gaps:
 *  - Race: the send path inserts the log row only after the provider call returns, so an `email.sent`
 *    webhook can beat it (reconcile => not_found). The route answers 503 for young `email.sent` events so
 *    Resend redelivers; the later `email.delivered` carries the same message_id; the backfill
 *    (server/scripts/backfill-resend-on-wire-message-ids.ts) is the final safety net.
 *  - Generated ids stored with an upper-case domain (before generation lower-cased it) are not matched by
 *    the inbound generated-id lookup, which lower-cases the domain.
 *
 * Deliberately NOT rewritten:
 *  - tickets.email_metadata.messageId / inReplyTo and comments.metadata.email.*: these hold the
 *    customer's inbound ids, not ids we generated.
 *  - The inbound `email_metadata.references` a customer-originated ticket is created with: also
 *    customer-supplied. Anything we appended later is element-replaced under (5).
 *  - References already sent to customers on the wire. Those cannot be recalled, which is why
 *    inbound lookup also resolves the generated id (see resolveReplyTargetFromOutboundMessageId).
 */

import { normalizeRfc822MessageId } from '@alga-psa/shared/services/email/inboundEmailIdentity';

const MAX_MESSAGE_ID_LENGTH = 998;

/** Canonical stored form: bare id wrapped in one pair of angle brackets. Null if unusable. */
export function toBracketedMessageId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const bare = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1).trim() : trimmed;
  if (!bare || bare.length > MAX_MESSAGE_ID_LENGTH || /[\s<>]/.test(bare) || !bare.includes('@')) return null;
  // Domains are case-insensitive: store them lower-cased so exact-match lookups agree with
  // rfcMessageIdLookupForms (which lower-cases the domain).
  return `<${normalizeRfc822MessageId(bare) ?? bare}>`;
}

export function sameMessageId(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeRfc822MessageId(a ?? undefined);
  const nb = normalizeRfc822MessageId(b ?? undefined);
  return Boolean(na && nb && na === nb);
}

/**
 * Synchronous half of the contract. A provider that already knows the on-wire id returns
 * `rfcMessageId` = on-wire and keeps the id we generated in `metadata.generatedRfcMessageId`.
 * Returns an empty object when there is nothing to record, so the caller can spread it.
 */
export function onWireMessageIdFields(
  generatedRfcMessageId: string | null | undefined,
  onWireMessageId: string | null | undefined
): { rfcMessageId?: string; metadata?: Record<string, string> } {
  const onWire = toBracketedMessageId(onWireMessageId);
  if (!onWire) return {};
  const generated = generatedRfcMessageId?.trim() || undefined;
  if (generated && sameMessageId(generated, onWire)) {
    // The relay kept our id; nothing was replaced.
    return {};
  }
  return {
    rfcMessageId: onWire,
    metadata: {
      onWireMessageId: onWire,
      ...(generated ? { generatedRfcMessageId: generated } : {}),
    },
  };
}

export function parseJsonObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }
  return {};
}

/** Whether a metadata blob says an on-wire id was already recorded for the row. */
export function hasRecordedOnWireId(metadata: Record<string, any>): boolean {
  const has = (key: string) => typeof metadata[key] === 'string' && metadata[key].trim() !== '';
  // generatedRfcMessageId/sesMessageId are the SMTP SES (115a58ccf6) markers; onWireMessageId is ours.
  return has('onWireMessageId') || has('generatedRfcMessageId') || has('sesMessageId');
}

/**
 * Replace the element equal (ignoring brackets/domain case) to `from` with `to`, keeping order and
 * every other element, then drop later duplicates. Returns null when nothing matched.
 */
export function replaceMessageIdInList(list: unknown, from: string, to: string): string[] | null {
  if (!Array.isArray(list)) return null;
  if (!list.some((item) => typeof item === 'string' && sameMessageId(item, from))) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const next = sameMessageId(item, from) ? to : item;
    const key = normalizeRfc822MessageId(next) ?? next;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

