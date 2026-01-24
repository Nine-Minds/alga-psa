function requireNonEmpty(value: string, field: string): string {
  if (!value) throw new Error(`${field} is required`);
  return value;
}

function withOptionalTimestamp(field: string, value?: string): Record<string, unknown> {
  return value ? { [field]: value } : {};
}

export type SurveyType = 'csat' | 'nps' | 'custom';
export type NotificationChannel = 'email' | 'sms' | 'in_app' | 'push';

export function buildSurveySentPayload(params: {
  surveyId: string;
  surveyType: SurveyType;
  recipientId: string;
  ticketId?: string;
  sentAt?: string;
  channel: NotificationChannel;
  templateId?: string;
}): Record<string, unknown> {
  requireNonEmpty(params.surveyId, 'surveyId');
  requireNonEmpty(params.surveyType, 'surveyType');
  requireNonEmpty(params.recipientId, 'recipientId');
  requireNonEmpty(params.channel, 'channel');

  return {
    surveyId: params.surveyId,
    surveyType: params.surveyType,
    recipientId: params.recipientId,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    ...withOptionalTimestamp('sentAt', params.sentAt),
    channel: params.channel,
    ...(params.templateId ? { templateId: params.templateId } : {}),
  };
}

export function buildSurveyResponseReceivedPayload(params: {
  surveyId: string;
  responseId: string;
  recipientId: string;
  ticketId?: string;
  respondedAt?: string;
  score: number;
  comment?: string;
}): Record<string, unknown> {
  requireNonEmpty(params.surveyId, 'surveyId');
  requireNonEmpty(params.responseId, 'responseId');
  requireNonEmpty(params.recipientId, 'recipientId');
  if (typeof params.score !== 'number' || Number.isNaN(params.score)) throw new Error('score is required');

  return {
    surveyId: params.surveyId,
    responseId: params.responseId,
    recipientId: params.recipientId,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    ...withOptionalTimestamp('respondedAt', params.respondedAt),
    score: params.score,
    ...(params.comment ? { comment: params.comment } : {}),
  };
}

export function buildSurveyReminderSentPayload(params: {
  surveyId: string;
  recipientId: string;
  ticketId?: string;
  sentAt?: string;
  channel: NotificationChannel;
  reminderNumber: number;
}): Record<string, unknown> {
  requireNonEmpty(params.surveyId, 'surveyId');
  requireNonEmpty(params.recipientId, 'recipientId');
  requireNonEmpty(params.channel, 'channel');
  if (!Number.isInteger(params.reminderNumber) || params.reminderNumber <= 0) {
    throw new Error('reminderNumber must be a positive integer');
  }

  return {
    surveyId: params.surveyId,
    recipientId: params.recipientId,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    ...withOptionalTimestamp('sentAt', params.sentAt),
    channel: params.channel,
    reminderNumber: params.reminderNumber,
  };
}

export function buildSurveyExpiredPayload(params: {
  surveyId: string;
  recipientId: string;
  ticketId?: string;
  expiredAt?: string;
}): Record<string, unknown> {
  requireNonEmpty(params.surveyId, 'surveyId');
  requireNonEmpty(params.recipientId, 'recipientId');

  return {
    surveyId: params.surveyId,
    recipientId: params.recipientId,
    ...(params.ticketId ? { ticketId: params.ticketId } : {}),
    ...withOptionalTimestamp('expiredAt', params.expiredAt),
  };
}

export type CsatWindow = 'daily' | 'weekly' | 'monthly';
export type CsatScopeType = 'agent' | 'team' | 'org';

export function buildCsatAlertTriggeredPayload(params: {
  window: CsatWindow;
  score: number;
  threshold: number;
  triggeredAt?: string;
  scopeType: CsatScopeType;
  scopeId?: string;
  baseline?: number;
  delta?: number;
}): Record<string, unknown> {
  requireNonEmpty(params.window, 'window');
  if (typeof params.score !== 'number' || Number.isNaN(params.score)) throw new Error('score is required');
  if (typeof params.threshold !== 'number' || Number.isNaN(params.threshold)) throw new Error('threshold is required');
  requireNonEmpty(params.scopeType, 'scopeType');

  return {
    window: params.window,
    score: params.score,
    ...(typeof params.baseline === 'number' ? { baseline: params.baseline } : {}),
    ...(typeof params.delta === 'number' ? { delta: params.delta } : {}),
    threshold: params.threshold,
    ...withOptionalTimestamp('triggeredAt', params.triggeredAt),
    scopeType: params.scopeType,
    ...(params.scopeId ? { scopeId: params.scopeId } : {}),
  };
}

