/** Wait for the sent message's persisted ticket or reply, not a wall-clock heuristic. */
export async function waitForEmailMessage({ messageId, readTickets, readComments, timeout = 15000 }: {
  messageId: string | undefined;
  readTickets: () => Promise<any[]>;
  readComments: (ticketId: string) => Promise<any[]>;
  timeout?: number;
}): Promise<void> {
  const normalize = (value: unknown) => typeof value === 'string' ? value.trim().replace(/^<|>$/g, '') : '';
  const expected = normalize(messageId);
  if (!expected) throw new Error('Send and capture an email before waiting for its processing');
  const deadline = Date.now() + timeout;
  do {
    const tickets = await readTickets();
    for (const ticket of tickets) {
      if (normalize(ticket.email_metadata?.messageId) === expected) return;
      const comments = await readComments(ticket.ticket_id);
      if (comments.some(comment => normalize(comment.metadata?.email?.messageId) === expected)) return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(250, remaining)));
  } while (Date.now() < deadline);
  throw new Error('The sent email has no matching persisted ticket or reply within the processing timeout');
}
