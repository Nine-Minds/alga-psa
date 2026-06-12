import type { Knex } from 'knex';

export async function captureInboundWebhookSampleIfRequested(args: {
  knex: Knex;
  tenant: string;
  inboundWebhookId: string;
  body: unknown;
  now?: Date;
}): Promise<boolean> {
  const now = args.now ?? new Date();
  const updated = await args.knex('inbound_webhooks')
    .where({
      tenant: args.tenant,
      inbound_webhook_id: args.inboundWebhookId,
    })
    .whereNotNull('sample_capture_expires_at')
    .andWhere('sample_capture_expires_at', '>', now)
    .andWhere((builder) => {
      builder.whereNull('sample_payload');
    })
    .update({
      sample_payload: args.body,
      sample_capture_expires_at: null,
      updated_at: args.knex.fn.now(),
    });

  return updated > 0;
}
