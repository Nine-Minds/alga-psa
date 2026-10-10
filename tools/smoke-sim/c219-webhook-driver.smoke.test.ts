/**
 * Smoke driver (card c219d6bf): feeds events that the live dev server actually
 * published to Redis into this branch's real webhook subscriber, payload builder,
 * signing and HTTP delivery, against the real dev DB, the real filesystem secret
 * store and a real HTTP sink. Only stand-ins: the event-bus consumption (events
 * are replayed from a JSONL file instead of a consumer group) and the Redis
 * delivery-queue hop (enqueue is captured and processWebhookDeliveryJob runs inline).
 *
 * Copy into server/src/test/ and run with SMOKE_EVENTS=<jsonl> SMOKE_OUT=<json>.
 */
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => Promise<void>>(),
  jobs: [] as any[],
}));

vi.mock('@/lib/eventBus', () => ({
  getEventBus: () => ({
    subscribe: async (eventType: string, handler: (event: unknown) => Promise<void>) => {
      state.handlers.set(eventType, handler);
    },
    unsubscribe: async (eventType: string) => {
      state.handlers.delete(eventType);
    },
  }),
}));

vi.mock('@/lib/webhooks/WebhookDeliveryQueue', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    WebhookDeliveryQueue: { getInstance: () => ({ enqueue: async (job: any) => { state.jobs.push(job); } }) },
  };
});

import { registerWebhookSubscriber } from '@/lib/eventBus/subscribers/webhookSubscriber';
import { processWebhookDeliveryJob } from '@/lib/webhooks/processWebhookDeliveryJob';

describe('c219 webhook smoke driver', () => {
  it('replays real stream events through the real webhook pipeline', async () => {
    const lines = fs.readFileSync(process.env.SMOKE_EVENTS!, 'utf8').split('\n').filter(Boolean);
    const webhookId = process.env.SMOKE_WEBHOOK_ID!;
    await registerWebhookSubscriber();
    const results: any[] = [];
    for (const line of lines) {
      const event = JSON.parse(line);
      state.jobs.length = 0;
      await state.handlers.get(event.eventType)!(event);
      for (const job of state.jobs.filter((j) => j.webhookId === webhookId)) {
        const outcome = await processWebhookDeliveryJob(job);
        results.push({ eventType: event.eventType, publicEvent: job.eventType, outcome });
      }
    }
    fs.writeFileSync(process.env.SMOKE_OUT!, JSON.stringify(results, null, 2));
    expect(results.length).toBeGreaterThan(0);
  }, 120_000);
});
