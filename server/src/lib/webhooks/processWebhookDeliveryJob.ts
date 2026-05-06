import crypto from 'node:crypto';

import { TokenBucketRateLimiter } from '@alga-psa/email';

import {
  WebhookDeliveryJob,
  type WebhookDeliveryProcessResult,
} from './WebhookDeliveryQueue';
import { maybeAutoDisable } from './autoDisable';
import { computeBackoff } from './backoff';
import { performWebhookDeliveryRequest } from './delivery';
import { emitWebhookMetric } from './metrics';
import { WEBHOOK_SIGNATURE_HEADER, signRequest } from './sign';
import { webhookModel } from './webhookModel';

const WEBHOOK_ID_HEADER = 'X-Alga-Webhook-Id';
const EVENT_ID_HEADER = 'X-Alga-Event-Id';
const EVENT_TYPE_HEADER = 'X-Alga-Event-Type';
const DELIVERY_ID_HEADER = 'X-Alga-Delivery-Id';
const DELIVERY_ATTEMPT_HEADER = 'X-Alga-Delivery-Attempt';

type WebhookRequestDescriptor<TPayload> = {
  webhookId: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
  payload: TPayload;
  attempt: number;
};

export type WebhookEnvelope<TPayload = WebhookDeliveryJob['payload']> = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  tenant_id: string;
  data: TPayload;
};

export async function processWebhookDeliveryJob(
  job: WebhookDeliveryJob,
): Promise<WebhookDeliveryProcessResult> {
  const webhook = await webhookModel.getById(job.webhookId, job.tenantId);
  if (!webhook || !webhook.isActive) {
    return {
      outcome: 'abandoned',
      errorMessage: `Webhook ${job.webhookId} is missing or inactive`,
    };
  }

  const rateLimit = await TokenBucketRateLimiter.getInstance().tryConsume(
    'webhook-out',
    job.tenantId,
    job.webhookId,
  );
  if (!rateLimit.allowed) {
    emitWebhookMetric('webhook_deliveries_total', {
      tenant: job.tenantId,
      webhook_id: job.webhookId,
      outcome: 'rate_limited',
    }, 'warn');
    return {
      outcome: 'retry',
      retryDelayMs: rateLimit.retryAfterMs ?? computeBackoff(job.attempt),
      errorMessage: 'Outbound webhook delivery rate limited',
    };
  }

  const signingSecret = await webhookModel.getSigningSecret(job.webhookId, job.tenantId);
  if (!signingSecret) {
    return {
      outcome: 'abandoned',
      errorMessage: `Signing secret not found for webhook ${job.webhookId}`,
    };
  }

  const deliveryId = crypto.randomUUID();
  const envelope = buildWebhookEnvelope(job.tenantId, job);
  const requestBody = JSON.stringify(envelope);
  const signature = signRequest(
    signingSecret,
    requestBody,
    Math.floor(Date.now() / 1000),
  );
  const requestHeaders = buildSignedWebhookRequestHeaders({
    deliveryId,
    request: job,
    signature,
    customHeaders: webhook.customHeaders,
  });

  const deliveryResult = await performWebhookDeliveryRequest({
    webhook_id: job.webhookId,
    url: webhook.url,
    method: webhook.method,
    headers: requestHeaders,
    payload: envelope,
    verify_ssl: webhook.verifySsl,
  });

  const completedAt = new Date();
  const shouldRetry = !deliveryResult.success && deliveryResult.error_type !== 'ssrf' && job.attempt < 5;
  const status = deliveryResult.success
    ? 'delivered'
    : shouldRetry
      ? 'retrying'
      : 'abandoned';
  const retryDelayMs = shouldRetry ? computeBackoff(job.attempt) : undefined;

  await webhookModel.recordDelivery({
    tenant: job.tenantId,
    deliveryId,
    webhookId: job.webhookId,
    eventId: job.eventId,
    eventType: job.eventType,
    requestHeaders,
    requestBody: envelope,
    responseStatusCode: deliveryResult.status_code ?? null,
    responseHeaders: deliveryResult.response_headers ?? null,
    responseBody: deliveryResult.response_body ?? null,
    status,
    attemptNumber: job.attempt,
    durationMs: deliveryResult.duration_ms ?? null,
    errorMessage: deliveryResult.error_message ?? null,
    nextRetryAt: retryDelayMs ? new Date(Date.now() + retryDelayMs) : null,
    isTest: false,
    attemptedAt: completedAt,
    completedAt,
  });

  emitWebhookMetric('webhook_deliveries_total', {
    tenant: job.tenantId,
    webhook_id: job.webhookId,
    outcome: status,
  });
  emitWebhookMetric('webhook_delivery_duration_ms', {
    tenant: job.tenantId,
    webhook_id: job.webhookId,
    duration_ms: deliveryResult.duration_ms ?? null,
  });

  const updatedWebhook = await webhookModel.updateStats({
    tenant: job.tenantId,
    webhookId: job.webhookId,
    succeeded: deliveryResult.success,
    deliveredAt: completedAt,
  });

  if (!deliveryResult.success && updatedWebhook) {
    await maybeAutoDisable(updatedWebhook);
  }

  if (deliveryResult.success) {
    return { outcome: 'delivered' };
  }

  if (shouldRetry) {
    return {
      outcome: 'retry',
      retryDelayMs,
      errorMessage: deliveryResult.error_message ?? 'Webhook delivery failed',
    };
  }

  return {
    outcome: 'abandoned',
    errorMessage: deliveryResult.error_message ?? 'Webhook delivery failed',
  };
}

export function buildWebhookEnvelope<TPayload>(
  tenantId: string,
  request: WebhookRequestDescriptor<TPayload>,
): WebhookEnvelope<TPayload> {
  return {
    event_id: request.eventId,
    event_type: request.eventType,
    occurred_at: request.occurredAt,
    tenant_id: tenantId,
    data: request.payload,
  };
}

export function buildSignedWebhookRequestHeaders(input: {
  deliveryId: string;
  request: WebhookRequestDescriptor<unknown>;
  signature: string;
  customHeaders: Record<string, string> | null;
}): Record<string, string> {
  return {
    ...(input.customHeaders ?? {}),
    'content-type': 'application/json',
    [WEBHOOK_SIGNATURE_HEADER]: input.signature,
    [WEBHOOK_ID_HEADER]: input.request.webhookId,
    [EVENT_ID_HEADER]: input.request.eventId,
    [EVENT_TYPE_HEADER]: input.request.eventType,
    [DELIVERY_ID_HEADER]: input.deliveryId,
    [DELIVERY_ATTEMPT_HEADER]: String(input.request.attempt),
  };
}
