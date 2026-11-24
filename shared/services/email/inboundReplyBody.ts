/**
 * Which body an inbound email is stored from.
 *
 * Shared by the in-app inbound processor and the workflow email actions so both
 * seams make the same decision: a successful parse owns the stored body. When the
 * reply parser's safety net rejects its own HTML trim it returns `sanitizedHtml:
 * undefined` and the text result, and reviving the raw body there stores every
 * level of quoted history the parser had just removed (alga-2026-0003353).
 *
 * Pure string handling only — no database or BlockNote dependency — so action
 * registries can import it without pulling the inbound processor along.
 */
import { hasHtmlMediaContent, htmlToVisibleText } from '../../lib/email/replyParser';

/** The text/html pair of an inbound message body. */
export interface InboundEmailBodyParts {
  text?: string;
  html?: string;
}

/** Markers our own notifications add, which carry no reply content of their own. */
export function stripAutomatedReplyMarkers(text: string): string {
  return text
    .replace(/\\?\[ALGA-REPLY-TOKEN[^\]\n\r]*(?:\])?/gi, ' ')
    .replace(/ALGA-REPLY-TOKEN:[^\n\r]*/gi, ' ')
    .replace(/ALGA-(?:TICKET|PROJECT|COMMENT|THREAD)-ID:[^\n\r]*/gi, ' ')
    .replace(/---\s*Please reply above this line\s*---/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Body a comment is built from. A successful parse owns the result: an undefined
 * `sanitizedHtml` means the parser's safety net rejected its own HTML trim, so the
 * comment must come from `sanitizedText`. The raw body stays the fallback only when
 * parsing threw and there is no parse result at all.
 */
export function replyBodyForComment(
  parsedEmail: any,
  body: InboundEmailBodyParts | undefined,
): InboundEmailBodyParts {
  if (parsedEmail) {
    return { html: parsedEmail.sanitizedHtml, text: parsedEmail.sanitizedText };
  }
  return { html: body?.html, text: body?.text };
}

export function hasSubstantiveReplyContent(
  parsedEmail: any,
  body: InboundEmailBodyParts | undefined,
): boolean {
  const candidateText =
    parsedEmail?.sanitizedText ??
    parsedEmail?.text ??
    body?.text ??
    '';

  if (String(candidateText).trim()) return stripAutomatedReplyMarkers(String(candidateText)).length > 0;
  // HTML-only mail has no sanitizedText in the reply parser. Use its existing
  // HTML text projection, without reviving quoted HTML when a text part exists.
  if (body?.text?.trim()) return false;
  const html = replyBodyForComment(parsedEmail, body).html ?? '';
  return hasHtmlMediaContent(html) || stripAutomatedReplyMarkers(htmlToVisibleText(html)).length > 0;
}

/**
 * Body to store, with nothing-was-written collapsed to an empty body.
 *
 * The in-app processor skips a token-only email outright before it reaches a
 * comment; the workflow definition has no such step, so its actions apply the same
 * judgement here. An empty `sanitizedText` from a successful parse is the parser's
 * signal that the reply held nothing above the Alga boundary, and the HTML side of
 * the same mail must not be stored in its place.
 */
export function substantiveReplyBody(
  parsedEmail: any,
  body: InboundEmailBodyParts | undefined,
): InboundEmailBodyParts {
  return hasSubstantiveReplyContent(parsedEmail, body) ? replyBodyForComment(parsedEmail, body) : {};
}
