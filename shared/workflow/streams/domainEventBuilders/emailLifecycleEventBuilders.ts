/**
 * Builders for the inbound-receipt and outbound-send email lifecycle events.
 * Replaces the hand-built literals in BaseEmailService (OUTBOUND_EMAIL_*) and the inbound
 * email entry points (INBOUND_EMAIL_RECEIVED) so the CI contract test covers the real payloads.
 */

function requireNonEmpty(value: unknown, field: string): void {
  if (value === undefined || value === null || value === '') throw new Error(`${field} is required`);
}

function optionalThreadAndTicket(params: { threadId?: string; ticketId?: string }): Record<string, string> {
  return {
    ...(params.threadId ? { threadId: params.threadId } : {}),
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
  };
}

export function buildInboundEmailReceivedPayload(params: {
  providerId: string;
  emailData: Record<string, unknown>;
  /** Legacy top-level `tenant` field still read by older subscribers; kept alongside `tenantId`. */
  tenant?: string;
}): Record<string, unknown> {
  requireNonEmpty(params.providerId, 'providerId');
  requireNonEmpty(params.emailData, 'emailData');
  return {
    ...(params.tenant ? { tenant: params.tenant } : {}),
    providerId: params.providerId,
    emailData: params.emailData,
  };
}

export function buildOutboundEmailQueuedPayload(params: {
  messageId: string;
  threadId?: string;
  ticketId?: string;
  from: string;
  to: string[];
  cc?: string[];
  subject?: string;
  queuedAt?: string;
  provider: string;
}): Record<string, unknown> {
  requireNonEmpty(params.messageId, 'messageId');
  requireNonEmpty(params.from, 'from');
  requireNonEmpty(params.provider, 'provider');
  return {
    messageId: params.messageId,
    ...optionalThreadAndTicket(params),
    from: params.from,
    to: params.to,
    ...(params.cc?.length ? { cc: params.cc } : {}),
    subject: params.subject,
    ...(params.queuedAt ? { queuedAt: params.queuedAt } : {}),
    provider: params.provider,
  };
}

export function buildOutboundEmailSentPayload(params: {
  messageId: string;
  providerMessageId: string;
  threadId?: string;
  ticketId?: string;
  sentAt?: string;
  provider: string;
}): Record<string, unknown> {
  requireNonEmpty(params.messageId, 'messageId');
  requireNonEmpty(params.providerMessageId, 'providerMessageId');
  requireNonEmpty(params.provider, 'provider');
  return {
    messageId: params.messageId,
    providerMessageId: params.providerMessageId,
    ...optionalThreadAndTicket(params),
    ...(params.sentAt ? { sentAt: params.sentAt } : {}),
    provider: params.provider,
  };
}

export function buildOutboundEmailFailedPayload(params: {
  messageId: string;
  threadId?: string;
  ticketId?: string;
  failedAt?: string;
  provider: string;
  errorCode?: string;
  errorMessage: string;
  retryable?: boolean;
}): Record<string, unknown> {
  requireNonEmpty(params.messageId, 'messageId');
  requireNonEmpty(params.provider, 'provider');
  requireNonEmpty(params.errorMessage, 'errorMessage');
  return {
    messageId: params.messageId,
    ...optionalThreadAndTicket(params),
    ...(params.failedAt ? { failedAt: params.failedAt } : {}),
    provider: params.provider,
    ...(params.errorCode ? { errorCode: params.errorCode } : {}),
    errorMessage: params.errorMessage,
    ...(typeof params.retryable === 'boolean' ? { retryable: params.retryable } : {}),
  };
}
