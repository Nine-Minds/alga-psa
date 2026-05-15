import type { Knex } from 'knex';

export interface InboundWebhookConfigLookupRow {
  tenant: string;
  inbound_webhook_id: string;
  name: string;
  slug: string;
  auth_type: string;
  auth_config: Record<string, unknown>;
  idempotency_source: Record<string, unknown> | null;
  idempotency_window_seconds: number;
  handler_type: string;
  handler_config: Record<string, unknown>;
  sample_capture_expires_at: Date | string | null;
  is_active: boolean;
  rate_limit_per_minute: number;
}

export async function lookupInboundWebhookBySlug(
  knex: Knex,
  tenant: string,
  webhookSlug: string,
): Promise<InboundWebhookConfigLookupRow | null> {
  const row = await knex<InboundWebhookConfigLookupRow>('inbound_webhooks')
    .where({
      tenant,
      slug: webhookSlug,
    })
    .first([
      'tenant',
      'inbound_webhook_id',
      'name',
      'slug',
      'auth_type',
      'auth_config',
      'idempotency_source',
      'idempotency_window_seconds',
      'handler_type',
      'handler_config',
      'sample_capture_expires_at',
      'is_active',
      'rate_limit_per_minute',
    ]);

  return row ?? null;
}
