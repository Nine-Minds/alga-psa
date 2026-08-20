import { z } from 'zod';
import { BaseDomainEventPayloadSchema } from './commonEventPayloadSchemas';

// Emitted when an inbound email provider is automatically paused after repeated,
// strictly classified unrecoverable auth failures. Worker-side runtimes (the
// email-service container, the Temporal worker) cannot import the
// @alga-psa/notifications vertical to deliver admin notifications in-process,
// so the process that performed the atomic pause publishes this event and a
// server-side subscriber creates the admin notifications where the domain
// graph loads. Mirrors the MAINTENANCE_JOB_REQUESTED worker→server hand-off.
export const inboundEmailProviderAutoPausedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  providerId: z.string().min(1).describe('Auto-paused email provider id'),
  providerName: z.string().describe('Provider display name (safe, no credentials)'),
  mailbox: z.string().describe('Monitored mailbox address'),
  providerType: z.enum(['microsoft', 'google', 'imap']).describe('Provider type'),
  authFailureCode: z.string().min(1).describe('Safe, sanitized classifier reason code'),
  pausedAt: z.string().datetime().describe('ISO timestamp of the atomic pause transition'),
}).describe('Payload for INBOUND_EMAIL_PROVIDER_AUTO_PAUSED');

export type InboundEmailProviderAutoPausedEventPayload = z.infer<
  typeof inboundEmailProviderAutoPausedEventPayloadSchema
>;
