/**
 * RFC 3834 / RFC 5230 automated-message handling for inbound and outbound mail.
 *
 * Inbound  - `detectAutomatedInboundMessage()` recognizes auto-replies, vacation/OOO
 *            responses, delivery-status bounces, and bulk/list mail so callers can avoid
 *            acting on them (e.g. reopening a closed ticket on an auto-acknowledgement,
 *            which produces a notification -> auto-reply -> reopen email loop). Detection
 *            is header-based on purpose: body heuristics risk suppressing genuine human
 *            replies. To also stop non-compliant responders, layer a per-sender rate
 *            limit (RFC 5230 vacation semantics) on top of this.
 *
 * Outbound - `AUTO_GENERATED_MAIL_HEADERS` marks our own system notifications so that
 *            well-behaved recipient systems do not auto-respond to them (RFC 3834 sec 5;
 *            `X-Auto-Response-Suppress` for Microsoft Exchange). These headers do NOT
 *            stop a human from replying.
 *
 * Relevant standards: RFC 3834 (Auto-Submitted), RFC 5230 (Sieve vacation), RFC 5321
 * (null reverse-path), RFC 3462/3464 (delivery-status reports), RFC 2919/2369 (List-*),
 * plus the de-facto `Precedence`, `X-Auto-Response-Suppress`, `X-Autoreply` headers.
 */

import type { EmailMessageDetails } from '../../interfaces/inbound-email.interfaces';

/** Header names consulted when classifying inbound mail (lower-cased for matching). */
const RELEVANT_INBOUND_HEADER_NAMES = [
  'auto-submitted',
  'precedence',
  'return-path',
  'content-type',
  'x-auto-response-suppress',
  'x-autoreply',
  'x-autorespond',
  'x-loop',
  'list-id',
  'list-unsubscribe',
  'list-help',
  'list-post',
  'list-subscribe',
  'list-archive',
  'list-owner',
] as const;

export type AutomatedMessageReason =
  | 'auto-submitted'
  | 'null-return-path'
  | 'delivery-status-report'
  | 'list-header'
  | 'precedence-bulk'
  | 'x-auto-response-suppress'
  | 'x-autoreply'
  | 'x-loop';

export interface AutomatedMessageSignal {
  /** True when the message looks machine-generated (auto-reply, vacation, bounce, bulk/list). */
  isAutomated: boolean;
  /** Stable machine-readable reason code, or null when not automated. */
  reason: AutomatedMessageReason | null;
  /** Human-readable detail (e.g. the offending header value) for diagnostics. */
  detail: string | null;
}

function buildHeaderLookup(
  headers: Record<string, string> | undefined
): (name: string) => string | null {
  const normalized = new Map<string, string>();
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof key === 'string' && typeof value === 'string') {
        normalized.set(key.trim().toLowerCase(), value);
      }
    }
  }
  return (name: string) => {
    const found = normalized.get(name.toLowerCase());
    return typeof found === 'string' ? found.trim() : null;
  };
}

/**
 * Project the standards-relevant headers from an inbound message for persistence and
 * forensics. (The previous metadata snapshot dropped these, which made auto-reply loops
 * hard to diagnose after the fact.) Returns a lower-cased-key map of only present headers.
 */
export function extractRelevantInboundHeaders(
  emailData: Pick<EmailMessageDetails, 'headers'>
): Record<string, string> {
  const get = buildHeaderLookup(emailData.headers);
  const out: Record<string, string> = {};
  for (const name of RELEVANT_INBOUND_HEADER_NAMES) {
    const value = get(name);
    if (value) {
      out[name] = value;
    }
  }
  return out;
}

/** Reduce a header value to its leading token, dropping params/comments ("auto-replied (vacation)" -> "auto-replied"). */
function headerToken(value: string): string {
  return value.split(';')[0]?.split('(')[0]?.trim().toLowerCase() ?? '';
}

/**
 * Detect machine-generated inbound mail. Returns the first matching signal so the reason
 * is deterministic. Header-only by design (see file header).
 */
export function detectAutomatedInboundMessage(
  emailData: Pick<EmailMessageDetails, 'headers'>
): AutomatedMessageSignal {
  const get = buildHeaderLookup(emailData.headers);
  const automated = (reason: AutomatedMessageReason, detail: string | null): AutomatedMessageSignal => ({
    isAutomated: true,
    reason,
    detail,
  });

  // RFC 3834 sec 5: any Auto-Submitted value other than "no" marks automatic submission.
  const autoSubmitted = get('auto-submitted');
  if (autoSubmitted && headerToken(autoSubmitted) !== 'no') {
    return automated('auto-submitted', autoSubmitted);
  }

  // RFC 5321: a null reverse-path (<>) is used by bounces and most auto-responses.
  const returnPath = get('return-path');
  if (returnPath && returnPath.replace(/\s/g, '') === '<>') {
    return automated('null-return-path', returnPath);
  }

  // RFC 3462/3464: delivery-status / disposition-notification reports are bounces/MDNs.
  const contentType = get('content-type');
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (
      ct.includes('multipart/report') &&
      (ct.includes('report-type=delivery-status') || ct.includes('report-type=disposition-notification'))
    ) {
      return automated('delivery-status-report', contentType);
    }
  }

  // RFC 2919 / RFC 2369: presence of any List-* header indicates list/bulk mail.
  for (const name of [
    'list-id',
    'list-unsubscribe',
    'list-post',
    'list-help',
    'list-subscribe',
    'list-archive',
    'list-owner',
  ]) {
    const value = get(name);
    if (value) {
      return automated('list-header', `${name}: ${value}`);
    }
  }

  // De-facto: Precedence bulk/list/junk/auto-reply marks non-personal mail.
  const precedence = get('precedence');
  if (precedence) {
    const token = headerToken(precedence).replace(/[\s_]+/g, '-');
    if (['bulk', 'list', 'junk', 'auto-reply', 'auto-replied', 'auto-notified'].includes(token)) {
      return automated('precedence-bulk', precedence);
    }
  }

  // Microsoft Exchange: presence of X-Auto-Response-Suppress on inbound mail signals an automated sender.
  const suppress = get('x-auto-response-suppress');
  if (suppress) {
    return automated('x-auto-response-suppress', suppress);
  }

  // De-facto auto-responder markers.
  const xAutoreply = get('x-autoreply');
  if (xAutoreply && xAutoreply.toLowerCase() !== 'no') {
    return automated('x-autoreply', xAutoreply);
  }
  const xAutorespond = get('x-autorespond');
  if (xAutorespond) {
    return automated('x-autoreply', xAutorespond);
  }
  const xLoop = get('x-loop');
  if (xLoop) {
    return automated('x-loop', xLoop);
  }

  return { isAutomated: false, reason: null, detail: null };
}

/**
 * Headers to attach to OUTBOUND system-generated notifications so that compliant
 * recipient systems do not auto-reply to them (RFC 3834 sec 5; `X-Auto-Response-Suppress`
 * for Exchange). These do NOT prevent humans from replying.
 */
export const AUTO_GENERATED_MAIL_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Auto-Submitted': 'auto-generated',
  'X-Auto-Response-Suppress': 'OOF, AutoReply, AutoForward',
});
