import { z } from 'zod';
import { BaseDomainEventPayloadSchema, uuidSchema } from './commonEventPayloadSchemas';

const messageIdSchema = uuidSchema('Message ID');
const threadIdSchema = uuidSchema('Thread ID');
const ticketIdSchema = uuidSchema('Ticket ID');

const emailAddressSchema = z.string().email().describe('Email address');
const emailListSchema = z.array(emailAddressSchema).min(1);
const providerSchema = z.string().min(1).describe('Provider identifier');

export const inboundEmailReplyReceivedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  messageId: messageIdSchema,
  threadId: threadIdSchema,
  ticketId: ticketIdSchema.optional(),
  from: emailAddressSchema,
  to: emailListSchema,
  subject: z.string().optional(),
  receivedAt: z.string().datetime().optional(),
  provider: providerSchema,
  matchedBy: z.string().min(1).describe('Reply matching strategy'),
}).describe('Payload for INBOUND_EMAIL_REPLY_RECEIVED');

export type InboundEmailReplyReceivedEventPayload = z.infer<typeof inboundEmailReplyReceivedEventPayloadSchema>;

export const outboundEmailQueuedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  messageId: messageIdSchema,
  threadId: threadIdSchema.optional(),
  ticketId: ticketIdSchema.optional(),
  from: emailAddressSchema,
  to: emailListSchema,
  cc: emailListSchema.optional(),
  subject: z.string().optional(),
  queuedAt: z.string().datetime().optional(),
  provider: providerSchema,
}).describe('Payload for OUTBOUND_EMAIL_QUEUED');

export type OutboundEmailQueuedEventPayload = z.infer<typeof outboundEmailQueuedEventPayloadSchema>;

export const outboundEmailSentEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  messageId: messageIdSchema,
  providerMessageId: z.string().min(1),
  threadId: threadIdSchema.optional(),
  ticketId: ticketIdSchema.optional(),
  sentAt: z.string().datetime().optional(),
  provider: providerSchema,
}).describe('Payload for OUTBOUND_EMAIL_SENT');

export type OutboundEmailSentEventPayload = z.infer<typeof outboundEmailSentEventPayloadSchema>;

export const outboundEmailFailedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  messageId: messageIdSchema,
  threadId: threadIdSchema.optional(),
  ticketId: ticketIdSchema.optional(),
  failedAt: z.string().datetime().optional(),
  provider: providerSchema,
  errorCode: z.string().optional(),
  errorMessage: z.string().min(1),
  retryable: z.boolean().optional(),
}).describe('Payload for OUTBOUND_EMAIL_FAILED');

export type OutboundEmailFailedEventPayload = z.infer<typeof outboundEmailFailedEventPayloadSchema>;

const bounceTypeSchema = z.enum(['hard', 'soft']).describe('Bounce type');

export const emailDeliveredEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  messageId: messageIdSchema,
  providerMessageId: z.string().min(1),
  to: emailAddressSchema,
  deliveredAt: z.string().datetime().optional(),
  provider: providerSchema,
}).describe('Payload for EMAIL_DELIVERED');

export type EmailDeliveredEventPayload = z.infer<typeof emailDeliveredEventPayloadSchema>;

export const emailBouncedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  messageId: messageIdSchema,
  providerMessageId: z.string().min(1),
  to: emailAddressSchema,
  bouncedAt: z.string().datetime().optional(),
  bounceType: bounceTypeSchema,
  smtpCode: z.string().optional(),
  smtpMessage: z.string().optional(),
}).describe('Payload for EMAIL_BOUNCED');

export type EmailBouncedEventPayload = z.infer<typeof emailBouncedEventPayloadSchema>;

export const emailComplaintReceivedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  messageId: messageIdSchema,
  providerMessageId: z.string().min(1),
  to: emailAddressSchema,
  complainedAt: z.string().datetime().optional(),
  provider: providerSchema,
  complaintType: z.string().optional(),
}).describe('Payload for EMAIL_COMPLAINT_RECEIVED');

export type EmailComplaintReceivedEventPayload = z.infer<typeof emailComplaintReceivedEventPayloadSchema>;

export const emailUnsubscribedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  recipientEmail: emailAddressSchema,
  unsubscribedAt: z.string().datetime().optional(),
  source: z.string().min(1),
  messageId: messageIdSchema.optional(),
}).describe('Payload for EMAIL_UNSUBSCRIBED');

export type EmailUnsubscribedEventPayload = z.infer<typeof emailUnsubscribedEventPayloadSchema>;

const notificationChannelSchema = z.enum(['email', 'sms', 'in_app', 'push']).describe('Notification channel');

export const notificationSentEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  notificationId: z.string().uuid(),
  channel: notificationChannelSchema,
  recipientId: z.string().min(1),
  sentAt: z.string().datetime().optional(),
  templateId: z.string().optional(),
  contextType: z.string().optional(),
  contextId: z.string().optional(),
}).describe('Payload for NOTIFICATION_SENT');

export type NotificationSentEventPayload = z.infer<typeof notificationSentEventPayloadSchema>;

export const notificationDeliveredEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  notificationId: z.string().uuid(),
  channel: notificationChannelSchema,
  recipientId: z.string().min(1),
  deliveredAt: z.string().datetime().optional(),
  providerMessageId: z.string().optional(),
}).describe('Payload for NOTIFICATION_DELIVERED');

export type NotificationDeliveredEventPayload = z.infer<typeof notificationDeliveredEventPayloadSchema>;

export const notificationFailedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  notificationId: z.string().uuid(),
  channel: notificationChannelSchema,
  recipientId: z.string().min(1),
  failedAt: z.string().datetime().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().min(1),
  retryable: z.boolean().optional(),
}).describe('Payload for NOTIFICATION_FAILED');

export type NotificationFailedEventPayload = z.infer<typeof notificationFailedEventPayloadSchema>;

export const notificationReadEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  notificationId: z.string().uuid(),
  channel: notificationChannelSchema,
  recipientId: z.string().min(1),
  readAt: z.string().datetime().optional(),
  client: z.string().optional(),
}).describe('Payload for NOTIFICATION_READ');

export type NotificationReadEventPayload = z.infer<typeof notificationReadEventPayloadSchema>;

const surveyTypeSchema = z.enum(['csat', 'nps', 'custom']).describe('Survey type');

export const surveySentEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  surveyId: z.string().uuid(),
  surveyType: surveyTypeSchema,
  recipientId: z.string().min(1),
  ticketId: ticketIdSchema.optional(),
  sentAt: z.string().datetime().optional(),
  channel: notificationChannelSchema,
  templateId: z.string().optional(),
}).describe('Payload for SURVEY_SENT');

export type SurveySentEventPayload = z.infer<typeof surveySentEventPayloadSchema>;

export const surveyResponseReceivedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  surveyId: z.string().uuid(),
  responseId: z.string().uuid(),
  recipientId: z.string().min(1),
  ticketId: ticketIdSchema.optional(),
  respondedAt: z.string().datetime().optional(),
  score: z.number(),
  comment: z.string().optional(),
}).describe('Payload for SURVEY_RESPONSE_RECEIVED');

export type SurveyResponseReceivedEventPayload = z.infer<typeof surveyResponseReceivedEventPayloadSchema>;

export const surveyReminderSentEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  surveyId: z.string().uuid(),
  recipientId: z.string().min(1),
  ticketId: ticketIdSchema.optional(),
  sentAt: z.string().datetime().optional(),
  channel: notificationChannelSchema,
  reminderNumber: z.number().int().positive(),
}).describe('Payload for SURVEY_REMINDER_SENT');

export type SurveyReminderSentEventPayload = z.infer<typeof surveyReminderSentEventPayloadSchema>;

export const surveyExpiredEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  surveyId: z.string().uuid(),
  recipientId: z.string().min(1),
  ticketId: ticketIdSchema.optional(),
  expiredAt: z.string().datetime().optional(),
}).describe('Payload for SURVEY_EXPIRED');

export type SurveyExpiredEventPayload = z.infer<typeof surveyExpiredEventPayloadSchema>;

const csatWindowSchema = z.enum(['daily', 'weekly', 'monthly']).describe('Alert window');
const csatScopeTypeSchema = z.enum(['agent', 'team', 'org']).describe('Alert scope type');

export const csatAlertTriggeredEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  window: csatWindowSchema,
  score: z.number(),
  baseline: z.number().optional(),
  delta: z.number().optional(),
  threshold: z.number(),
  triggeredAt: z.string().datetime().optional(),
  scopeType: csatScopeTypeSchema,
  scopeId: z.string().optional(),
}).describe('Payload for CSAT_ALERT_TRIGGERED');

export type CsatAlertTriggeredEventPayload = z.infer<typeof csatAlertTriggeredEventPayloadSchema>;
