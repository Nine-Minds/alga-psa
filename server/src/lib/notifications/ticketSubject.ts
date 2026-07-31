/**
 * Ensure a ticket email's subject carries a stable `[Ticket #N]` token so every
 * notification for the ticket presents consistently and gives mail clients a
 * secondary grouping signal alongside the RFC threading headers.
 *
 * Idempotent (won't double-tag an already-tagged subject) and preserves any
 * leading Re:/Fwd: prefix so reply-subject matching survives.
 */
export function normalizeTicketSubject(subject: string, ticketNumber: unknown): string {
  const num =
    typeof ticketNumber === 'string' || typeof ticketNumber === 'number'
      ? String(ticketNumber).trim()
      : '';
  if (!num || /\[ticket\s*#/i.test(subject)) {
    return subject;
  }
  const tag = `[Ticket #${num}]`;
  const replyPrefix = subject.match(/^((?:re|fwd|fw)\s*:\s*)+/i)?.[0] ?? '';
  const rest = subject.slice(replyPrefix.length);
  return `${replyPrefix}${tag} ${rest}`.trim();
}
