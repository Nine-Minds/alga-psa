import type { TicketComment } from "../../api/tickets";

/**
 * The comment that opened a ticket from an inbound email carries top-level
 * `metadata.opensTicket = true` (same marker the web uses; survives client redaction).
 * Mirrors packages/tickets/src/lib/ticketOpenerComment.ts.
 */
// LEVERAGE: pattern opener-comment-predicate — mobile re-implements packages/tickets isTicketOpenerComment (no shared package in the app)
function readMetadata(metadata: unknown): Record<string, unknown> | null {
  if (typeof metadata === "string") {
    try {
      return readMetadata(JSON.parse(metadata));
    } catch {
      return null;
    }
  }
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : null;
}

export function isOpenerComment(comment: Pick<TicketComment, "metadata">): boolean {
  return readMetadata(comment.metadata)?.opensTicket === true;
}

export function openerAttachmentCount(comment: Pick<TicketComment, "metadata">): number {
  const count = readMetadata(comment.metadata)?.attachmentCount;
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/** Sender label: the resolved author, else the inbound email's name/address. */
export function openerSenderName(comment: Pick<TicketComment, "metadata" | "created_by_name">): string | null {
  if (comment.created_by_name) return comment.created_by_name;
  const email = readMetadata(readMetadata(comment.metadata)?.email);
  const name = typeof email?.fromName === "string" ? email.fromName.trim() : "";
  const address = typeof email?.fromAddress === "string" ? email.fromAddress.trim() : "";
  return name || address || null;
}
