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

// Emitted when processInboundEmailInApp quarantines an inbound message and the
// row has already been persisted (persistence is direct and never depends on
// this event). Worker runtimes publish it so the server-side subscriber can
// notify tenant admins where the notifications vertical loads. `reason` is the
// closed QUARANTINE_REASONS set from shared/services/email/inboundQuarantine.ts;
// it is a plain string here because event-schemas must not depend on shared/.
// LEVERAGE: friction quarantine-reason-enum — the closed reason list is restated in the DB check constraint, the locale files and (as a string) here
export const inboundEmailQuarantinedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  quarantineId: z.string().min(1).describe('Persisted inbound_email_quarantine row id'),
  providerId: z.string().min(1).describe('Mailbox provider id'),
  mailbox: z.string().describe('Monitored mailbox address'),
  sender: z.string().describe('Sender address of the refused message'),
  subject: z.string().describe('Truncated subject of the refused message'),
  reason: z.string().min(1).describe('Closed quarantine reason code'),
  matchedBy: z.enum(['thread_headers', 'reply_token']).nullable().describe('How the ticket was matched'),
  ticketId: z.string().nullable().describe('Matched ticket id, if any'),
  ticketNumber: z.string().nullable().describe('Matched ticket number, if any'),
  quarantinedAt: z.string().datetime().describe('ISO timestamp the quarantine was recorded'),
}).describe('Payload for INBOUND_EMAIL_QUARANTINED');

export type InboundEmailQuarantinedEventPayload = z.infer<typeof inboundEmailQuarantinedEventPayloadSchema>;
