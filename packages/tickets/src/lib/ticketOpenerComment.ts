/**
 * The comment that opened a ticket from an inbound email carries a top-level
 * `metadata.opensTicket = true` (written by createCommentFromEmail, backfilled by migration
 * 20261115130000). It is top-level, not under `metadata.email`, so it survives
 * `redactCommentForClient`.
 */

function readMetadata(metadata: unknown): Record<string, unknown> | null {
  if (typeof metadata === 'string') {
    // jsonb read through some drivers/loaders arrives as a string.
    try {
      return readMetadata(JSON.parse(metadata));
    } catch {
      return null;
    }
  }
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : null;
}

export function isTicketOpenerComment(comment: { metadata?: unknown } | null | undefined): boolean {
  return readMetadata(comment?.metadata)?.opensTicket === true;
}

/** Non-inline attachment count recorded on the opener, or null when unknown / zero. */
export function getTicketOpenerAttachmentCount(comment: { metadata?: unknown } | null | undefined): number | null {
  const count = readMetadata(comment?.metadata)?.attachmentCount;
  return typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : null;
}
