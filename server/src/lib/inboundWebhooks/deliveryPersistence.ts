import type { Knex } from 'knex';
import { filterInboundWebhookHeaders } from './headerFilter';
import type { InboundWebhookAuthStatus, InboundWebhookDispatchStatus } from './types';

export interface CreateInboundDeliveryInput {
  tenant: string;
  inboundWebhookId?: string | null;
  idempotencyKey?: string | null;
  requestMethod: string;
  requestPath: string;
  requestHeaders: Headers | Record<string, string | string[] | undefined>;
  requestBody?: unknown | null;
  sourceIp?: string | null;
  userAgent?: string | null;
  authStatus: InboundWebhookAuthStatus;
  dispatchStatus?: InboundWebhookDispatchStatus;
  responseStatus?: number | null;
  responseBody?: unknown | null;
  isReplay?: boolean;
  replayedFrom?: string | null;
}

export async function createInboundDelivery(
  knex: Knex,
  input: CreateInboundDeliveryInput,
): Promise<{ deliveryId: string }> {
  const [row] = await knex('inbound_webhook_deliveries')
    .insert({
      tenant: input.tenant,
      inbound_webhook_id: input.inboundWebhookId ?? null,
      idempotency_key: input.idempotencyKey ?? null,
      request_method: input.requestMethod,
      request_path: input.requestPath,
      request_headers: filterInboundWebhookHeaders(input.requestHeaders),
      request_body: input.authStatus === 'verified' ? input.requestBody ?? null : null,
      source_ip: input.sourceIp ?? null,
      user_agent: input.userAgent ?? null,
      auth_status: input.authStatus,
      dispatch_status: input.dispatchStatus ?? 'pending',
      response_status: input.responseStatus ?? null,
      response_body: input.responseBody ?? null,
      is_replay: input.isReplay ?? false,
      replayed_from: input.replayedFrom ?? null,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    })
    .returning<{ delivery_id: string }[]>('delivery_id');

  return { deliveryId: row.delivery_id };
}

export interface UpdateInboundDeliveryOutcomeInput {
  tenant: string;
  deliveryId: string;
  dispatchStatus: InboundWebhookDispatchStatus;
  handlerOutcome?: Record<string, unknown> | null;
  responseStatus: number;
  responseBody?: unknown | null;
  durationMs: number;
}

export async function updateInboundDeliveryOutcome(
  knex: Knex,
  input: UpdateInboundDeliveryOutcomeInput,
): Promise<void> {
  await knex('inbound_webhook_deliveries')
    .where({
      tenant: input.tenant,
      delivery_id: input.deliveryId,
    })
    .update({
      dispatch_status: input.dispatchStatus,
      handler_outcome: input.handlerOutcome ?? null,
      response_status: input.responseStatus,
      response_body: input.responseBody ?? null,
      duration_ms: input.durationMs,
      updated_at: knex.fn.now(),
    });
}
