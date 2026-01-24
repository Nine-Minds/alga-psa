export function buildEmailDeliveredPayload(params: {
  messageId: string;
  providerMessageId: string;
  to: string;
  deliveredAt?: string;
  provider: string;
}): Record<string, unknown> {
  if (!params.messageId) throw new Error('messageId is required');
  if (!params.providerMessageId) throw new Error('providerMessageId is required');
  if (!params.to) throw new Error('to is required');
  if (!params.provider) throw new Error('provider is required');

  return {
    messageId: params.messageId,
    providerMessageId: params.providerMessageId,
    to: params.to,
    ...(params.deliveredAt ? { deliveredAt: params.deliveredAt } : {}),
    provider: params.provider,
  };
}

export function buildEmailBouncedPayload(params: {
  messageId: string;
  providerMessageId: string;
  to: string;
  bouncedAt?: string;
  bounceType: 'hard' | 'soft';
  smtpCode?: string;
  smtpMessage?: string;
}): Record<string, unknown> {
  if (!params.messageId) throw new Error('messageId is required');
  if (!params.providerMessageId) throw new Error('providerMessageId is required');
  if (!params.to) throw new Error('to is required');
  if (!params.bounceType) throw new Error('bounceType is required');

  return {
    messageId: params.messageId,
    providerMessageId: params.providerMessageId,
    to: params.to,
    ...(params.bouncedAt ? { bouncedAt: params.bouncedAt } : {}),
    bounceType: params.bounceType,
    ...(params.smtpCode ? { smtpCode: params.smtpCode } : {}),
    ...(params.smtpMessage ? { smtpMessage: params.smtpMessage } : {}),
  };
}

export function buildEmailComplaintReceivedPayload(params: {
  messageId: string;
  providerMessageId: string;
  to: string;
  complainedAt?: string;
  provider: string;
  complaintType?: string;
}): Record<string, unknown> {
  if (!params.messageId) throw new Error('messageId is required');
  if (!params.providerMessageId) throw new Error('providerMessageId is required');
  if (!params.to) throw new Error('to is required');
  if (!params.provider) throw new Error('provider is required');

  return {
    messageId: params.messageId,
    providerMessageId: params.providerMessageId,
    to: params.to,
    ...(params.complainedAt ? { complainedAt: params.complainedAt } : {}),
    provider: params.provider,
    ...(params.complaintType ? { complaintType: params.complaintType } : {}),
  };
}

export function buildEmailUnsubscribedPayload(params: {
  recipientEmail: string;
  unsubscribedAt?: string;
  source: string;
  messageId?: string;
}): Record<string, unknown> {
  if (!params.recipientEmail) throw new Error('recipientEmail is required');
  if (!params.source) throw new Error('source is required');

  return {
    recipientEmail: params.recipientEmail,
    ...(params.unsubscribedAt ? { unsubscribedAt: params.unsubscribedAt } : {}),
    source: params.source,
    ...(params.messageId ? { messageId: params.messageId } : {}),
  };
}

