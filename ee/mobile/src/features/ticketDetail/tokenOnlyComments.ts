// Hides historical inbound-email comments that are nothing but automated
// reply markers (e.g. "[ALGA-REPLY-TOKEN:...]"). Regexes ported verbatim from
// stripAutomatedReplyMarkers in shared/services/email/processInboundEmailInApp.ts.
import type { TicketComment } from "../../api/tickets";
import { extractPlainTextFromSerializedRichEditorContent } from "../ticketRichText/helpers";

const MARKER_PATTERNS = [
  /\\?\[ALGA-REPLY-TOKEN[^\]\n\r]*(?:\])?/gi,
  /ALGA-REPLY-TOKEN:[^\n\r]*/gi,
  /ALGA-(?:TICKET|PROJECT|COMMENT|THREAD)-ID:[^\n\r]*/gi,
  /---\s*Please reply above this line\s*---/gi,
];

export function stripAutomatedReplyMarkers(text: string): string {
  let result = text;
  for (const pattern of MARKER_PATTERNS) {
    result = result.replace(pattern, " ");
  }
  return result.replace(/\s+/g, " ").trim();
}

export function isTokenOnlyText(text: string): boolean {
  if (!text.trim()) {
    return false;
  }
  const hasMarker = MARKER_PATTERNS.some((pattern) => text.search(pattern) !== -1);
  return hasMarker && stripAutomatedReplyMarkers(text).length === 0;
}

export function isTokenOnlyComment(comment: TicketComment): boolean {
  if (comment.kind === "event" || typeof comment.event_type === "string") {
    return false;
  }
  return isTokenOnlyText(extractPlainTextFromSerializedRichEditorContent(comment.comment_text));
}
