import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const inboundWebhookActionsSource = readFileSync(
  path.resolve(process.cwd(), 'src/lib/actions/inboundWebhookActions.ts'),
  'utf8',
);

describe('inbound webhook replay source contract', () => {
  it('T163: replay dispatches against the current webhook config', () => {
    expect(inboundWebhookActionsSource).toContain('export const replayInboundDelivery = withAuth');
    expect(inboundWebhookActionsSource).toContain("knex<InboundWebhookRow>('inbound_webhooks')");
    expect(inboundWebhookActionsSource).toContain('where({ tenant, inbound_webhook_id: original.inbound_webhook_id })');
    expect(inboundWebhookActionsSource).toContain('if (!webhook || !webhook.is_active)');
    expect(inboundWebhookActionsSource).toContain('await dispatchAndRecordOutcome({');
    expect(inboundWebhookActionsSource).toContain('webhook,');
    expect(inboundWebhookActionsSource).toContain('deliveryId: replayDeliveryId');
  });

  it('T164: replayed deliveries link back to the original delivery', () => {
    expect(inboundWebhookActionsSource).toContain('const { deliveryId: replayDeliveryId } = await createInboundDelivery(knex, {');
    expect(inboundWebhookActionsSource).toContain('isReplay: true');
    expect(inboundWebhookActionsSource).toContain('replayedFrom: original.delivery_id');
    expect(inboundWebhookActionsSource).toContain('return fetchInboundDeliveryById(knex, tenant, replayDeliveryId)');
  });
});
