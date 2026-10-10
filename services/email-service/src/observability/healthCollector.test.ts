import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHealthCollector } from './healthCollector';
import { createInboundEmailMetrics } from './registry';
import type { InboundEmailHealthSnapshot } from '@alga-psa/shared/services/email/inboundEmailHealthSnapshot';

function snap(expired: number, paused = 0): InboundEmailHealthSnapshot {
  return {
    collectedAt: new Date().toISOString(),
    providers: [{ providerType: 'microsoft', status: 'connected', count: 2 }],
    paused: paused ? [{ providerType: 'microsoft', reason: 'auth_failure', code: 'microsoft:invalid_client', count: paused }] : [],
    authFailing: [],
    microsoft: {
      subscriptions: { healthy: 0, expiring_lt_12h: 0, expired, missing: 0 },
      deliveryMode: { webhook: 2, polling: 0 },
      silentWebhooks: 0,
    },
    gmail: { watches: { healthy: 0, expiring_lt_12h: 0, expired: 0, missing: 0 } },
    sync: { stale: { imap: 0, microsoft: 0, google: 0 }, oldestLivenessAgeSeconds: {} },
    durable: null,
  };
}
const depths = (dlq = 0) => ({ v1: { ready: 0, processing: 0, inflight: 0, dlq }, v2: null });

async function value(metrics: ReturnType<typeof createInboundEmailMetrics>, name: string, labels: Record<string, string> = {}) {
  const family = (await metrics.register.getMetricsAsJSON()).find((f) => f.name === name) as any;
  const sample = family?.values.find((v: any) => Object.entries(labels).every(([k, val]) => v.labels[k] === val));
  return sample?.value as number | undefined;
}

afterEach(() => vi.useRealTimers());

describe('health collector', () => {
  it('sets gauges and resets label sets that dropped away', async () => {
    const metrics = createInboundEmailMetrics();
    const snapshots = [snap(2, 11), snap(0, 0)];
    const collector = createHealthCollector({
      metrics,
      collectSnapshot: async () => snapshots.shift()!,
      readQueueDepths: async () => depths(),
    });
    await collector.tick();
    expect(await value(metrics, 'alga_inbound_email_microsoft_subscriptions', { state: 'expired' })).toBe(2);
    expect(
      await value(metrics, 'alga_inbound_email_providers_paused', { code: 'microsoft:invalid_client' })
    ).toBe(11);
    expect(await value(metrics, 'alga_inbound_email_health_collector_last_success_timestamp_seconds')).toBeGreaterThan(0);

    await collector.tick();
    expect(await value(metrics, 'alga_inbound_email_microsoft_subscriptions', { state: 'expired' })).toBe(0);
    // A label set that disappeared is gone rather than stuck at its last value.
    expect(await value(metrics, 'alga_inbound_email_providers_paused')).toBeUndefined();
  });

  it('keeps last values, counts a failure and leaves last_success alone when the DB part fails', async () => {
    const metrics = createInboundEmailMetrics();
    let fail = false;
    const collector = createHealthCollector({
      metrics,
      collectSnapshot: async () => {
        if (fail) throw new Error('db down');
        return snap(3);
      },
      readQueueDepths: async () => depths(),
    });
    await collector.tick();
    const lastSuccess = await value(metrics, 'alga_inbound_email_health_collector_last_success_timestamp_seconds');
    fail = true;
    await expect(collector.tick()).resolves.toBeUndefined();
    expect(await value(metrics, 'alga_inbound_email_microsoft_subscriptions', { state: 'expired' })).toBe(3);
    expect(await value(metrics, 'alga_inbound_email_health_collector_failures_total')).toBe(1);
    expect(await value(metrics, 'alga_inbound_email_health_collector_last_success_timestamp_seconds')).toBe(lastSuccess);
    expect(collector.getCache().lastTick).toEqual({ dbOk: false, redisOk: true });
  });

  it('isolates a Redis failure from the DB part', async () => {
    const metrics = createInboundEmailMetrics();
    const collector = createHealthCollector({
      metrics,
      collectSnapshot: async () => snap(1),
      readQueueDepths: async () => {
        throw new Error('redis down');
      },
    });
    await expect(collector.tick()).resolves.toBeUndefined();
    expect(await value(metrics, 'alga_inbound_email_microsoft_subscriptions', { state: 'expired' })).toBe(1);
    expect(await value(metrics, 'alga_inbound_email_health_collector_failures_total')).toBe(1);
    expect(collector.getCache().lastTick).toEqual({ dbOk: true, redisOk: false });
    expect(collector.getCache().lastSuccessAtMs).toBeNull();
  });

  it('is single-flight', async () => {
    const metrics = createInboundEmailMetrics();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const collectSnapshot = vi.fn(async () => {
      await gate;
      return snap(0);
    });
    const collector = createHealthCollector({ metrics, collectSnapshot, readQueueDepths: async () => depths() });
    const a = collector.tick();
    const b = collector.tick();
    release();
    await Promise.all([a, b]);
    expect(collectSnapshot).toHaveBeenCalledTimes(1);
  });

  it('tracks DLQ growth across ticks', async () => {
    const metrics = createInboundEmailMetrics();
    const seq = [0, 0, 3];
    const collector = createHealthCollector({
      metrics,
      collectSnapshot: async () => snap(0),
      readQueueDepths: async () => depths(seq.shift()!),
    });
    await collector.tick();
    await collector.tick();
    expect(collector.getCache().dlqGrowthLastHour).toBe(0);
    await collector.tick();
    expect(collector.getCache().dlqGrowthLastHour).toBe(3);
  });

  it('runs on a timer after start() and stops on stop()', async () => {
    vi.useFakeTimers();
    const metrics = createInboundEmailMetrics();
    const collectSnapshot = vi.fn(async () => snap(0));
    const collector = createHealthCollector({
      metrics,
      collectSnapshot,
      readQueueDepths: async () => depths(),
      intervalMs: 1_000,
      random: () => 0.5,
    });
    collector.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(collectSnapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(collectSnapshot).toHaveBeenCalledTimes(2);
    collector.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(collectSnapshot).toHaveBeenCalledTimes(2);
  });
});
