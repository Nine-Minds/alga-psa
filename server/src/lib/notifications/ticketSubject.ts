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

/**
 * Build the uniform customer-facing ticket subject:
 * `<leading Re:/Fwd: prefix>[Ticket #<number>] <ticket title>`.
 *
 * The event type is deliberately absent so every email about one ticket carries
 * the same subject and mail clients can group them into one conversation. The
 * rendered (per-event) subject only contributes its reply/forward prefix. The
 * title is the ticket's current title (a rename may start a new conversation).
 *
 * With no ticket number the rendered subject is returned unchanged.
 */
export function buildUniformTicketSubject(
  renderedSubject: string,
  ticketNumber: unknown,
  title: unknown,
): string {
  const num =
    typeof ticketNumber === 'string' || typeof ticketNumber === 'number'
      ? String(ticketNumber).trim()
      : '';
  if (!num) {
    return renderedSubject;
  }
  const replyPrefix = renderedSubject.match(/^((?:re|fwd|fw)\s*:\s*)+/i)?.[0] ?? '';
  const cleanTitle = (typeof title === 'string' ? title : '').replace(/[\r\n]+/g, ' ').trim();
  return `${replyPrefix}[Ticket #${num}] ${cleanTitle}`.replace(/[\r\n]+/g, ' ').trim();
}
