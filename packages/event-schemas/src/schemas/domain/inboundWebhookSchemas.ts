import { z } from 'zod';

/**
 * Headers carried by the inbound webhook envelope. Sensitive headers (authorization,
 * cookie, set-cookie, proxy-authorization, x-api-key) are stripped server-side.
 */
const inboundWebhookHeadersSchema = z
  .record(z.union([z.string(), z.array(z.string())]))
  .describe('Filtered request headers from the incoming request');

/**
 * Common nested shape for monitoring-style payloads (RMM alerts, SIEM events, etc.).
 * Catchall on every level keeps the schema permissive — any payload field can still be
 * passed through — while exposing the common keys so the workflow designer's reference
 * picker can drill into payload.body.alert.<field> directly.
 */
const inboundWebhookAlertSchema = z
  .object({
    id: z.string().optional().describe('External alert identifier'),
    ticket_number: z.string().optional().describe('Alga ticket number to target'),
    ticket_external_ref: z.string().optional().describe('External reference of an Alga ticket'),
    severity: z.string().optional().describe('Alert severity / priority'),
    subject: z.string().optional().describe('Alert subject or short title'),
    body: z.string().optional().describe('Alert body / detail text'),
    source: z.string().optional().describe('Originating source identifier'),
    device: z
      .object({
        hostname: z.string().optional().describe('Device hostname'),
        ip: z.string().optional().describe('Device IP address'),
        external_id: z.string().optional().describe('External device identifier'),
      })
      .catchall(z.unknown())
      .optional()
      .describe('Device or asset context, if the alert is asset-bound'),
  })
  .catchall(z.unknown())
  .describe('Common alert payload shape');

const inboundWebhookEventSchema = z
  .object({
    type: z.string().optional().describe('Event type identifier'),
    id: z.string().optional().describe('External event identifier'),
  })
  .catchall(z.unknown())
  .describe('Common event payload shape');

/**
 * Envelope delivered to workflows when an inbound webhook fires with handler_type='workflow'.
 * Mirrors the `WorkflowWebhookEnvelope` type in
 * `server/src/lib/inboundWebhooks/types.ts`.
 *
 * `body` is shaped as a permissive object with two common nested shapes (`alert`, `event`)
 * pre-typed so the workflow designer's reference picker can drill into typical RMM /
 * SIEM / alerting payloads. Catchall(unknown) on every level means non-conforming
 * payloads still pass through unchanged.
 */
export const inboundWebhookBodySchema = z
  .object({
    alert: inboundWebhookAlertSchema.optional(),
    event: inboundWebhookEventSchema.optional(),
  })
  .catchall(z.unknown())
  .describe('Parsed JSON request body as received from the external system');

export const inboundWebhookReceivedEventPayloadSchema = z
  .object({
    source: z.string().describe('Inbound webhook slug that received the request'),
    body: inboundWebhookBodySchema,
    headers: inboundWebhookHeadersSchema,
    verified: z.literal(true).describe('Always true; auth verification has already passed'),
    delivery_id: z.string().uuid().describe('Inbound webhook delivery row UUID'),
    idempotency_key: z
      .string()
      .nullable()
      .describe('Idempotency key extracted from header or JSONata expression, or null'),
    received_at: z.string().datetime().describe('ISO timestamp when the request was received'),
  })
  .describe('Payload for INBOUND_WEBHOOK_RECEIVED');

export type InboundWebhookReceivedEventPayload = z.infer<typeof inboundWebhookReceivedEventPayloadSchema>;
