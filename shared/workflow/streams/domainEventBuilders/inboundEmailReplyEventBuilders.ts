import { normalizeEmailAddress } from '../../../lib/email/addressUtils';

/**
 * Reduce an address to a bare RFC address: strips `Display Name <addr>` /
 * `mailto:` wrapper forms, trims, and lowercases. Returns null when no
 * address-looking value is present so callers can drop or fall back.
 */
function bareEmailAddress(value: unknown): string | null {
  return normalizeEmailAddress(typeof value === 'string' ? value : null);
}

/**
 * Build the payload for `INBOUND_EMAIL_REPLY_RECEIVED`.
 *
 * The payload is validated against `inboundEmailReplyReceivedEventPayloadSchema`
 * (which extends `BaseDomainEventPayloadSchema`), so `tenantId` and `occurredAt`
 * are required, and `from`/`to` must be bare RFC email addresses. Addresses are
 * normalized here so display-name forms can never reach the schema.
 */
export function buildInboundEmailReplyReceivedPayload(params: {
  tenantId: string;
  occurredAt: string;
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
  if (!params.tenantId) throw new Error('tenantId is required');
  if (!params.occurredAt) throw new Error('occurredAt is required');
  if (!params.messageId) throw new Error('messageId is required');
  if (!params.threadId) throw new Error('threadId is required');
  if (!params.from) throw new Error('from is required');
  if (!params.to || params.to.length === 0) throw new Error('to is required');
  if (!params.provider) throw new Error('provider is required');
  if (!params.matchedBy) throw new Error('matchedBy is required');

  const from = bareEmailAddress(params.from);
  const to = params.to
    .map((recipient) => bareEmailAddress(recipient))
    .filter((recipient): recipient is string => Boolean(recipient));
  if (!from) throw new Error('from must be a valid bare email address');
  if (to.length === 0) throw new Error('to must contain at least one valid bare email address');

  return {
    tenantId: params.tenantId,
    occurredAt: params.occurredAt,
    messageId: params.messageId,
    threadId: params.threadId,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    from,
    to,
    ...(params.subject ? { subject: params.subject } : {}),
    ...(params.receivedAt ? { receivedAt: params.receivedAt } : {}),
    provider: params.provider,
    matchedBy: params.matchedBy,
  };
}
