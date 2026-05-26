import type { WorkflowWebhookEnvelope } from './types';

export interface BuildWorkflowWebhookEnvelopeInput {
  webhookSlug: string;
  body: unknown;
  headers: Record<string, string | string[]>;
  deliveryId: string;
  idempotencyKey?: string | null;
  receivedAt?: Date | string;
}

export function buildWorkflowWebhookEnvelope(input: BuildWorkflowWebhookEnvelopeInput): WorkflowWebhookEnvelope {
  return {
    source: input.webhookSlug,
    body: input.body,
    headers: input.headers,
    verified: true,
    delivery_id: input.deliveryId,
    idempotency_key: input.idempotencyKey ?? null,
    received_at: input.receivedAt ? new Date(input.receivedAt).toISOString() : new Date().toISOString(),
  };
}
