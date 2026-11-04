import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHealthServer } from './healthServer';
import { createInboundEmailMetrics, METRIC_PREFIX } from './registry';
import { createReadiness, type ConsumerHeartbeatSource } from './readiness';
import { createHealthCollector } from './healthCollector';

let server: http.Server | undefined;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

const healthyConsumer = (): ConsumerHeartbeatSource => ({
  lastSuccessfulTickAt: Date.now(),
  heartbeatStaleAfterMs: 120_000,
  startedAt: Date.now() - 10_000,
});

async function boot(opts: {
  checkDb?: () => Promise<unknown>;
  checkRedis?: () => Promise<unknown>;
  consumer?: ConsumerHeartbeatSource | undefined;
  metricsEnabled?: boolean;
  timeoutMs?: number;
} = {}) {
  const metrics = createInboundEmailMetrics({ durableMode: 'off' });
  const collector = createHealthCollector({
    metrics,
    collectSnapshot: async () => {
      throw new Error('not used');
    },
    readQueueDepths: async () => {
      throw new Error('not used');
    },
  });
  const consumer = 'consumer' in opts ? opts.consumer : healthyConsumer();
  const readiness = createReadiness({
    checkDb: opts.checkDb ?? (async () => undefined),
    checkRedis: opts.checkRedis ?? (async () => undefined),
    consumerV1: () => consumer,
    consumerV2: () => undefined,
    timeoutMs: opts.timeoutMs ?? 200,
  });
  server = createHealthServer({
    metrics,
    readiness,
    getCollectorCache: () => collector.getCache(),
    getImapStats: () => ({ activeListeners: 1, providersLeased: 1 }),
    metricsEnabled: opts.metricsEnabled ?? true,
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (path: string) => {
    const res = await fetch(base + path);
    return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
  };
}

describe('health server', () => {
  it('/health is 200 even when every check fails', async () => {
    const get = await boot({
      checkDb: async () => {
        throw new Error('x');
      },
      checkRedis: async () => {
        throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
      },
      consumer: undefined,
    });
    const res = await get('/health?probe=1');
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });

  it('/ready is 200 with check shapes when everything is healthy', async () => {
    const get = await boot();
    const res = await get('/ready');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.status).toBe('ready');
    expect(body.checks.db.ok).toBe(true);
    expect(body.checks.redis.ok).toBe(true);
    expect(body.checks.consumer_v1.ok).toBe(true);
    expect(body.checks.consumer_v2).toBeUndefined();
  });

  it('/ready is 503 with a fixed error string on refusal and on timeout', async () => {
    const get = await boot({
      checkRedis: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:6379'), { code: 'ECONNREFUSED' });
      },
      checkDb: () => new Promise(() => undefined), // hangs -> timeout path
      timeoutMs: 100,
    });
    const res = await get('/ready');
    expect(res.status).toBe(503);
    const body = JSON.parse(res.text);
    expect(body.status).toBe('not_ready');
    expect(body.checks.redis).toMatchObject({ ok: false, error: 'refused' });
    expect(body.checks.db).toMatchObject({ ok: false, error: 'timeout' });
    expect(res.text).not.toContain('10.0.0.1');
  });

  it('/ready is 503 for a wedged consumer but not for fleet-health conditions', async () => {
    const wedged = await boot({
      consumer: { lastSuccessfulTickAt: Date.now() - 600_000, heartbeatStaleAfterMs: 120_000, startedAt: Date.now() - 900_000 },
    });
    const res = await wedged('/ready');
    expect(res.status).toBe(503);
    expect(JSON.parse(res.text).checks.consumer_v1).toMatchObject({ ok: false, error: 'stale' });
  });

  it('/ready passes the heartbeat during startup grace', async () => {
    const get = await boot({ consumer: { lastSuccessfulTickAt: null, heartbeatStaleAfterMs: 120_000, startedAt: Date.now() - 5_000 } });
    const res = await get('/ready');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text).checks.consumer_v1).toMatchObject({ ok: true, starting: true });
  });

  it('/metrics serves the registry with its content type and every family', async () => {
    const get = await boot();
    const res = await get('/metrics');
    expect(res.status).toBe(200);
    expect(res.type).toContain('text/plain');
    for (const name of ['queue_jobs_total', 'messages_total', 'queue_depth', 'microsoft_subscriptions', 'health_collector_failures_total', 'service_info']) {
      expect(res.text).toContain(`# TYPE ${METRIC_PREFIX}${name} `);
    }
  });

  it('/metrics is 404 when disabled', async () => {
    const get = await boot({ metricsEnabled: false });
    expect((await get('/metrics')).status).toBe(404);
    expect((await get('/health')).status).toBe(200);
  });

  it('/status is always HTTP 200 with the verdict in the body', async () => {
    const get = await boot({
      checkRedis: async () => {
        throw new Error('down');
      },
    });
    const res = await get('/status');
    expect(res.status).toBe(200);
    expect(res.type).toContain('application/json');
    const body = JSON.parse(res.text);
    expect(body.version).toBe(1);
    expect(body.status).toBe('down');
    expect(body.reasons.some((r: any) => r.code === 'redis_unreachable')).toBe(true);
  });

  it('unknown paths are 404', async () => {
    const get = await boot();
    expect((await get('/nope')).status).toBe(404);
  });
});
