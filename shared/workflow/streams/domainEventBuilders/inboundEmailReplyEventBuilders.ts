export function buildInboundEmailReplyReceivedPayload(params: {
  messageId: string;
  threadId: string;
  ticketId?: string;
  from: string;
  to: string[];
  subject?: string;
  receivedAt?: string;
  provider: string;
  matchedBy: string;
}): Record<string, unknown> {
  if (!params.messageId) throw new Error('messageId is required');
  if (!params.threadId) throw new Error('threadId is required');
  if (!params.from) throw new Error('from is required');
  if (!params.to || params.to.length === 0) throw new Error('to is required');
  if (!params.provider) throw new Error('provider is required');
  if (!params.matchedBy) throw new Error('matchedBy is required');

  return {
    messageId: params.messageId,
    threadId: params.threadId,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    from: params.from,
    to: params.to,
    ...(params.subject ? { subject: params.subject } : {}),
    ...(params.receivedAt ? { receivedAt: params.receivedAt } : {}),
    provider: params.provider,
    matchedBy: params.matchedBy,
  };
}

