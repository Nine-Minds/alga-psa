import { describe, expect, it } from 'vitest';
import { buildStatusSummary, type StatusInput } from './statusSummary';
import type { CollectorCache } from './healthCollector';
import type { InboundEmailHealthSnapshot } from '@alga-psa/shared/services/email/inboundEmailHealthSnapshot';

const NOW = Date.parse('2026-10-10T12:00:00Z');

function baseSnapshot(): InboundEmailHealthSnapshot {
  return {
    collectedAt: new Date(NOW).toISOString(),
    providers: [{ providerType: 'microsoft', status: 'connected', count: 4 }],
    paused: [],
    authFailing: [],
    microsoft: {
      subscriptions: { healthy: 4, expiring_lt_12h: 0, expired: 0, missing: 0 },
      deliveryMode: { webhook: 4, polling: 0 },
      silentWebhooks: 0,
    },
    gmail: { watches: { healthy: 0, expiring_lt_12h: 0, expired: 0, missing: 0 } },
    sync: { stale: { imap: 0, microsoft: 0, google: 0 }, oldestLivenessAgeSeconds: {} },
    durable: null,
  };
}

function input(over: {
  snapshot?: (s: InboundEmailHealthSnapshot) => void;
  collector?: Partial<CollectorCache>;
  checks?: Partial<StatusInput['checks']>;
  readyDepth?: number;
  dlq?: number;
} = {}): StatusInput {
  const snapshot = baseSnapshot();
  over.snapshot?.(snapshot);
  return {
    nowMs: NOW,
    checks: {
      db: { ok: true },
      redis: { ok: true },
      consumer_v1: { ok: true, lastTickMs: NOW - 1_000 },
      ...over.checks,
    },
    collector: {
      snapshot,
      snapshotAtMs: NOW - 10_000,
      queues: { v1: { ready: over.readyDepth ?? 0, processing: 0, inflight: 0, dlq: over.dlq ?? 0 }, v2: null },
      queuesAtMs: NOW - 10_000,
      dlqGrowthLastHour: 0,
      lastSuccessAtMs: NOW - 10_000,
      startedAtMs: NOW - 3_600_000,
      intervalMs: 60_000,
      lastTick: { dbOk: true, redisOk: true },
      ...over.collector,
    },
    imap: { activeListeners: 4, providersLeased: 2 },
  };
}

const cases: Array<{ name: string; input: StatusInput; status: string; code?: string; severity?: string }> = [
  { name: 'healthy fleet is ok', input: input(), status: 'ok' },
  {
    name: 'expired Microsoft subscription is degraded',
    input: input({ snapshot: (s) => (s.microsoft.subscriptions.expired = 2) }),
    status: 'degraded',
    code: 'microsoft_subscriptions_expired',
  },
  {
    name: 'auth-paused providers are degraded',
    input: input({ snapshot: (s) => s.paused.push({ providerType: 'microsoft', reason: 'auth_failure', code: 'microsoft:invalid_client', count: 11 }) }),
    status: 'degraded',
    code: 'providers_auth_paused',
  },
  {
    name: 'auth-failing providers are degraded',
    input: input({ snapshot: (s) => s.authFailing.push({ providerType: 'microsoft', code: 'microsoft:invalid_client', count: 1 }) }),
    status: 'degraded',
    code: 'providers_auth_failing',
  },
  { name: 'DLQ growth is degraded', input: input({ dlq: 5, collector: { dlqGrowthLastHour: 2 } }), status: 'degraded', code: 'dlq_growing' },
  { name: 'ready backlog > 500 is degraded', input: input({ readyDepth: 501 }), status: 'degraded', code: 'queue_backlog' },
  { name: 'stale sync is degraded', input: input({ snapshot: (s) => (s.sync.stale.imap = 1) }), status: 'degraded', code: 'sync_stale' },
  { name: 'expired Gmail watch is degraded', input: input({ snapshot: (s) => (s.gmail.watches.expired = 1) }), status: 'degraded', code: 'gmail_watches_expired' },
  {
    name: 'collector older than 3 intervals is degraded',
    input: input({ collector: { lastSuccessAtMs: NOW - 200_000 } }),
    status: 'degraded',
    code: 'health_data_stale',
  },
  {
    name: 'collector that never succeeded after 5 minutes is degraded',
    input: input({ collector: { lastSuccessAtMs: null, startedAtMs: NOW - 400_000 } }),
    status: 'degraded',
    code: 'health_data_stale',
  },
  {
    name: 'collector that has not yet had 5 minutes is fine',
    input: input({ collector: { lastSuccessAtMs: null, startedAtMs: NOW - 30_000 } }),
    status: 'ok',
  },
  { name: 'Redis down is down', input: input({ checks: { redis: { ok: false, error: 'refused' } } }), status: 'down', code: 'redis_unreachable' },
  { name: 'DB down is down', input: input({ checks: { db: { ok: false, error: 'timeout' } } }), status: 'down', code: 'db_unreachable' },
  {
    name: 'stale V1 heartbeat is down',
    input: input({ checks: { consumer_v1: { ok: false, error: 'stale', lastTickMs: NOW - 500_000 } } }),
    status: 'down',
    code: 'consumer_v1_stale',
  },
  {
    name: 'stale V2 heartbeat is down',
    input: input({ checks: { consumer_v2: { ok: false, error: 'stale', lastTickMs: NOW - 500_000 } } }),
    status: 'down',
    code: 'consumer_v2_stale',
  },
  { name: 'non-zero but flat DLQ is info only', input: input({ dlq: 3 }), status: 'ok', code: 'dlq_nonzero', severity: 'info' },
  {
    name: 'polling providers are info only',
    input: input({ snapshot: (s) => (s.microsoft.deliveryMode.polling = 2) }),
    status: 'ok',
    code: 'microsoft_polling_providers',
    severity: 'info',
  },
  {
    name: 'manual pauses are info only',
    input: input({ snapshot: (s) => s.paused.push({ providerType: 'imap', reason: 'manual', code: 'none', count: 1 }) }),
    status: 'ok',
    code: 'providers_paused_manual',
    severity: 'info',
  },
];

describe('buildStatusSummary severity rules', () => {
  it.each(cases)('$name', ({ input: i, status, code, severity }) => {
    const summary = buildStatusSummary(i);
    expect(summary.status).toBe(status);
    if (code) {
      const reason = summary.reasons.find((r) => r.code === code);
      expect(reason, `reason ${code}`).toBeDefined();
      if (severity) expect(reason!.severity).toBe(severity);
    } else {
      expect(summary.reasons).toEqual([]);
    }
  });

  it('takes the worst severity and lists it first', () => {
    const summary = buildStatusSummary(
      input({ checks: { redis: { ok: false } }, snapshot: (s) => (s.microsoft.subscriptions.expired = 1) })
    );
    expect(summary.status).toBe('down');
    expect(summary.reasons.map((r) => r.severity)).toEqual(['down', 'degraded']);
  });

  it('has the version 1 shape', () => {
    const summary = buildStatusSummary(input());
    expect(Object.keys(summary).sort()).toEqual(
      ['collector', 'consumer', 'dependencies', 'generatedAt', 'gmail', 'imap', 'microsoft', 'providers', 'queue', 'reasons', 'service', 'status', 'sync', 'version'].sort()
    );
    expect(summary.version).toBe(1);
    expect(summary.service).toBe('email-service');
    expect(summary.consumer.v1).toEqual({ lastTickAt: new Date(NOW - 1000).toISOString(), ageSeconds: 1, stale: false });
    expect(summary.consumer.v2).toBeNull();
    expect(summary.queue.v2).toBeNull();
    expect(summary.collector).toEqual({ lastSuccessAt: new Date(NOW - 10_000).toISOString(), ageSeconds: 10, intervalSeconds: 60 });
  });
});
