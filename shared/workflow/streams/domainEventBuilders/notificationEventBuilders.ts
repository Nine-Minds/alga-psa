function requireNonEmpty(value: string, field: string): string {
  if (!value) throw new Error(`${field} is required`);
  return value;
}

function withOptionalTimestamp(field: string, value?: string): Record<string, unknown> {
  return value ? { [field]: value } : {};
}

export type NotificationChannel = 'email' | 'sms' | 'in_app' | 'push';

export function buildNotificationSentPayload(params: {
  notificationId: string;
  channel: NotificationChannel;
  recipientId: string;
  sentAt?: string;
  templateId?: string;
  contextType?: string;
  contextId?: string;
}): Record<string, unknown> {
  requireNonEmpty(params.notificationId, 'notificationId');
  requireNonEmpty(params.channel, 'channel');
  requireNonEmpty(params.recipientId, 'recipientId');

  return {
    notificationId: params.notificationId,
    channel: params.channel,
    recipientId: params.recipientId,
    ...withOptionalTimestamp('sentAt', params.sentAt),
    ...(params.templateId ? { templateId: params.templateId } : {}),
    ...(params.contextType ? { contextType: params.contextType } : {}),
    ...(params.contextId ? { contextId: params.contextId } : {}),
  };
}

export function buildNotificationDeliveredPayload(params: {
  notificationId: string;
  channel: NotificationChannel;
  recipientId: string;
  deliveredAt?: string;
  providerMessageId?: string;
}): Record<string, unknown> {
  requireNonEmpty(params.notificationId, 'notificationId');
  requireNonEmpty(params.channel, 'channel');
  requireNonEmpty(params.recipientId, 'recipientId');

  return {
    notificationId: params.notificationId,
    channel: params.channel,
    recipientId: params.recipientId,
    ...withOptionalTimestamp('deliveredAt', params.deliveredAt),
    ...(params.providerMessageId ? { providerMessageId: params.providerMessageId } : {}),
  };
}

export function buildNotificationFailedPayload(params: {
  notificationId: string;
  channel: NotificationChannel;
  recipientId: string;
  failedAt?: string;
  errorCode?: string;
  errorMessage: string;
  retryable?: boolean;
}): Record<string, unknown> {
  requireNonEmpty(params.notificationId, 'notificationId');
  requireNonEmpty(params.channel, 'channel');
  requireNonEmpty(params.recipientId, 'recipientId');
  requireNonEmpty(params.errorMessage, 'errorMessage');

  return {
    notificationId: params.notificationId,
    channel: params.channel,
    recipientId: params.recipientId,
    ...withOptionalTimestamp('failedAt', params.failedAt),
    ...(params.errorCode ? { errorCode: params.errorCode } : {}),
    errorMessage: params.errorMessage,
    ...(typeof params.retryable === 'boolean' ? { retryable: params.retryable } : {}),
  };
}

export function buildNotificationReadPayload(params: {
  notificationId: string;
  channel: NotificationChannel;
  recipientId: string;
  readAt?: string;
  client?: string;
}): Record<string, unknown> {
  requireNonEmpty(params.notificationId, 'notificationId');
  requireNonEmpty(params.channel, 'channel');
  requireNonEmpty(params.recipientId, 'recipientId');

  return {
    notificationId: params.notificationId,
    channel: params.channel,
    recipientId: params.recipientId,
    ...withOptionalTimestamp('readAt', params.readAt),
    ...(params.client ? { client: params.client } : {}),
  };
}

