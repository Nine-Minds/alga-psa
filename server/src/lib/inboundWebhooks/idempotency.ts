import { evaluateExpressionSource } from '@alga-psa/workflows/runtime/expressionEngine';
import type { Knex } from 'knex';
import type { InboundWebhookIdempotencySource } from './types';

const IDEMPOTENCY_JSONATA_TIMEOUT_MS = 500;

export async function extractInboundWebhookIdempotencyKey(args: {
  source: InboundWebhookIdempotencySource | null;
  headers: Headers | Record<string, string | string[] | undefined>;
  body: unknown;
}): Promise<string | null> {
  if (!args.source) {
    return null;
  }

  if (args.source.type === 'header') {
    return extractHeaderValue(args.headers, args.source.value);
  }

  const result = await evaluateExpressionSource(
    args.source.value,
    args.body && typeof args.body === 'object' ? (args.body as Record<string, unknown>) : { value: args.body },
    IDEMPOTENCY_JSONATA_TIMEOUT_MS,
  );

  if (result === null || result === undefined) {
    return null;
  }

  const key = String(result).trim();
  return key.length > 0 ? key : null;
}

export async function findDuplicateInboundDelivery(args: {
  knex: Knex;
  tenant: string;
  inboundWebhookId: string;
  idempotencyKey: string | null;
  windowSeconds: number;
}): Promise<{ deliveryId: string; receivedAt: Date | string } | null> {
  if (!args.idempotencyKey) {
    return null;
  }

  const since = new Date(Date.now() - args.windowSeconds * 1000);
  const row = await args.knex('inbound_webhook_deliveries')
    .where({
      tenant: args.tenant,
      inbound_webhook_id: args.inboundWebhookId,
      idempotency_key: args.idempotencyKey,
    })
    .where('received_at', '>=', since)
    .whereIn('dispatch_status', ['pending', 'dispatched', 'duplicate'])
    .orderBy('received_at', 'desc')
    .first<{ delivery_id: string; received_at: Date | string }>(['delivery_id', 'received_at']);

  return row
    ? {
        deliveryId: row.delivery_id,
        receivedAt: row.received_at,
      }
    : null;
}

function extractHeaderValue(
  headers: Headers | Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  if (headers instanceof Headers) {
    const value = headers.get(name);
    return value?.trim() || null;
  }

  const requested = name.toLowerCase();
  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() !== requested || !value) {
      continue;
    }

    const normalized = Array.isArray(value) ? value[0] : value;
    return normalized?.trim() || null;
  }

  return null;
}
