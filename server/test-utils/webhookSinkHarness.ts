/**
 * In-process event bus + signed-webhook sink harness for DB-backed integration
 * tests of outbound webhooks (card c219d6bf, lifted for card 378dfcbb).
 *
 * `vi.mock` factories are hoisted above imports, so a test file keeps its own
 * `vi.hoisted` state object (shape: {@link WebhookHarnessState}) and hands it to
 * the factories here:
 *
 *   const state = vi.hoisted(() => ({
 *     db: null as any, handlers: new Map(), published: [], jobs: [], pending: [],
 *     deferredErrors: [], secrets: new Map(),
 *   }));
 *   vi.mock('@alga-psa/event-bus/publishers', async () =>
 *     (await import('../../../test-utils/webhookSinkHarness')).publishersMockFactory(state));
 *   vi.mock('@/lib/eventBus', async () =>
 *     (await import('../../../test-utils/webhookSinkHarness')).eventBusMockFactory(state));
 *   vi.mock('@alga-psa/core/secrets', async () =>
 *     (await import('../../../test-utils/webhookSinkHarness')).secretsMockFactory(state));
 *
 * `publishEvent` records the event and, like the real Redis consumer, runs it
 * through `EventSchemas[eventType].parse(...)` before handing it to whatever the
 * real webhook subscriber registered through `getEventBus().subscribe`.
 */
import http from 'node:http';
import { vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

export interface WebhookHarnessState {
  db: any;
  handlers: Map<string, (event: unknown) => Promise<void>>;
  published: Array<{ eventType: string; payload: any }>;
  jobs: any[];
  pending: Array<Promise<void>>;
  deferredErrors: unknown[];
  secrets: Map<string, string>;
}

export type CapturedRequest = { headers: Record<string, string>; bodyRaw: string; body: any };

/** Delay before TICKET_RESPONSE_STATE_CHANGED reaches its consumer (see publishersMockFactory). */
const STATE_CHANGED_DELIVERY_DELAY_MS = 250;

export function publishersMockFactory(state: WebhookHarnessState) {
  return {
    publishEvent: vi.fn(async (event: { eventType: string; payload: any }) => {
      state.published.push({ eventType: event.eventType, payload: event.payload });
      const handler = state.handlers.get(event.eventType);
      if (!handler) return;

      const { EventSchemas } = await import('@alga-psa/event-bus/schemas/eventBusSchema');
      const schema = (EventSchemas as Record<string, { parse: (v: unknown) => unknown } | undefined>)[event.eventType];
      if (!schema) {
        throw new Error(`No EventSchemas entry for ${event.eventType}; refusing to skip the consumer parse`);
      }
      const parsed = schema.parse({
        id: uuidv4(),
        eventType: event.eventType,
        timestamp: new Date().toISOString(),
        payload: event.payload,
      }) as unknown;

      if (event.eventType === 'TICKET_RESPONSE_STATE_CHANGED') {
        // In production this event is consumed after the comment.added event of
        // the same transaction (separate stream messages, possibly other pods).
        // Deliver it late so the comment.added build cannot benefit from this
        // event's side effects. Tracked in state.pending and flushed by
        // flushDeferredDeliveries so no delivery crosses a test boundary.
        state.pending.push(
          new Promise<void>((resolve) => {
            setTimeout(() => {
              handler(parsed)
                .catch((error) => { state.deferredErrors.push(error); })
                .finally(resolve);
            }, STATE_CHANGED_DELIVERY_DELAY_MS);
          }),
        );
      } else {
        await handler(parsed);
      }
    }),
    publishWorkflowEvent: vi.fn(async () => {}),
  };
}

export function eventBusMockFactory(state: WebhookHarnessState) {
  return {
    getEventBus: () => ({
      subscribe: async (eventType: string, handler: (event: unknown) => Promise<void>) => {
        state.handlers.set(eventType, handler);
      },
      unsubscribe: async (eventType: string) => {
        state.handlers.delete(eventType);
      },
      publish: vi.fn(async () => {}),
    }),
  };
}

export function secretsMockFactory(state: WebhookHarnessState) {
  const getSecret = vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || '');
  return {
    getSecret,
    getSecretProviderInstance: vi.fn(async () => ({
      getAppSecret: async () => '',
      getTenantSecret: async (tenant: string, name: string) => state.secrets.get(`${tenant}/${name}`) ?? null,
      setTenantSecret: async (tenant: string, name: string, value: string) => {
        state.secrets.set(`${tenant}/${name}`, value);
      },
      deleteTenantSecret: async (tenant: string, name: string) => {
        state.secrets.delete(`${tenant}/${name}`);
      },
    })),
    secretProvider: { getSecret },
  };
}

export function createMockRedis() {
  const kv = new Map<string, string>();
  return {
    async get(key: string) { return kv.get(key) ?? null; },
    async set(key: string, value: string) { kv.set(key, value); return 'OK'; },
    async del(key: string | string[]) {
      let n = 0;
      for (const k of Array.isArray(key) ? key : [key]) if (kv.delete(k)) n += 1;
      return n;
    },
    async zAdd() { return 1; },
    async zRem() { return 1; },
    async zRangeByScore() { return []; },
    async zCard() { return 0; },
  } as any;
}

export async function startStubServer() {
  const received: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString('utf8');
      received.push({ headers: req.headers as Record<string, string>, bodyRaw, body: JSON.parse(bodyRaw) });
      res.statusCode = 200;
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function waitFor<T>(fn: () => T | undefined | false, timeoutMs = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value as T;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Await every deferred delivery and rethrow any consumer failure. */
export async function flushDeferredDeliveries(state: WebhookHarnessState): Promise<void> {
  while (state.pending.length > 0) {
    await Promise.all(state.pending.splice(0));
  }
  if (state.deferredErrors.length > 0) {
    const errors = state.deferredErrors.splice(0);
    throw new Error(`Deferred event delivery failed: ${errors.map(String).join('; ')}`);
  }
}
