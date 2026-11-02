import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  WebhookDeliveryJob,
  WebhookDeliveryProcessResult,
} from './WebhookDeliveryQueue';

/**
 * Durable suppression of event replay, independent of Redis retention and queue claims.
 * A lease serializes concurrent attempts without holding a DB transaction during HTTP.
 * Failed attempts release the lease; a successful delivery keeps its receipt permanently.
 */
export async function withWebhookDeliveryReceipt(
  knex: Knex,
  job: Pick<WebhookDeliveryJob, 'tenantId' | 'webhookId' | 'eventId'>,
  deliver: () => Promise<WebhookDeliveryProcessResult>
): Promise<WebhookDeliveryProcessResult> {
  const table = () =>
    tenantDb(knex, job.tenantId).table('webhook_event_receipts');
  const key = {
    tenant: job.tenantId,
    webhook_id: job.webhookId,
    event_id: job.eventId,
  };
  const token = randomUUID();
  const now = new Date().toISOString();
  const lease = {
    lease_token: token,
    lease_until: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
  const claimed = await table()
    .insert({ ...key, ...lease, delivered: false })
    .onConflict(['tenant', 'webhook_id', 'event_id'])
    .merge(lease)
    .where('webhook_event_receipts.delivered', false)
    .where('webhook_event_receipts.lease_until', '<=', now)
    .returning('lease_token');
  if (!claimed.length) {
    const receipt = await table().where(key).first('delivered');
    return receipt?.delivered
      ? { outcome: 'delivered' }
      : {
          outcome: 'retry',
          retryDelayMs: 5000,
          errorMessage: 'Another delivery attempt holds the event lease',
        };
  }
  let delivered = false;
  try {
    const result = await deliver();
    delivered = result.outcome === 'delivered';
    return result;
  } finally {
    await table()
      .where({ ...key, lease_token: token })
      .update({ delivered, lease_until: new Date(0).toISOString() });
  }
}
