/**
 * Pure builder for the `/status` body (schema version 1).
 *
 * The overall status is the worst severity among the reasons (`ok` when there
 * are none). Every count is fleet-level; nothing here can name a tenant.
 */

import type { InboundEmailHealthSnapshot } from '@alga-psa/shared/services/email/inboundEmailHealthSnapshot';
import type { CollectorCache, QueueDepths } from './healthCollector';
import type { ReadinessChecks } from './readiness';

export const STATUS_SCHEMA_VERSION = 1;
export const READY_BACKLOG_THRESHOLD = 500;
export const COLLECTOR_STALE_INTERVALS = 3;
export const COLLECTOR_NEVER_SUCCEEDED_AFTER_MS = 5 * 60_000;

export type StatusSeverity = 'info' | 'degraded' | 'down';
export type OverallStatus = 'ok' | 'degraded' | 'down';

export interface StatusReason {
  code: string;
  severity: StatusSeverity;
  message: string;
  count?: number;
}

export interface StatusInput {
  nowMs: number;
  checks: ReadinessChecks;
  collector: CollectorCache;
  imap: { activeListeners: number; providersLeased: number };
}

const EMPTY_STATES = { healthy: 0, expiring_lt_12h: 0, expired: 0, missing: 0 };

function iso(ms: number | null | undefined): string | null {
  return typeof ms === 'number' ? new Date(ms).toISOString() : null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function sum(rows: Array<{ count: number }>): number {
  return rows.reduce((a, r) => a + r.count, 0);
}

export function buildStatusSummary(input: StatusInput) {
  const { nowMs, checks, collector, imap } = input;
  const snap: InboundEmailHealthSnapshot | null = collector.snapshot;
  const queues = collector.queues;
  const reasons: StatusReason[] = [];
  const add = (r: StatusReason) => reasons.push(r);

  // ---- down ---------------------------------------------------------------
  if (!checks.db.ok) add({ code: 'db_unreachable', severity: 'down', message: 'The database is unreachable' });
  if (!checks.redis.ok) add({ code: 'redis_unreachable', severity: 'down', message: 'Redis is unreachable' });
  if (!checks.consumer_v1.ok) {
    add({ code: 'consumer_v1_stale', severity: 'down', message: 'The inbound email queue consumer has stopped making progress' });
  }
  if (checks.consumer_v2 && !checks.consumer_v2.ok) {
    add({ code: 'consumer_v2_stale', severity: 'down', message: 'The durable inbound email queue consumer has stopped making progress' });
  }

  // ---- degraded -----------------------------------------------------------
  if (snap) {
    const expired = snap.microsoft.subscriptions.expired;
    if (expired > 0) {
      add({ code: 'microsoft_subscriptions_expired', severity: 'degraded', count: expired,
        message: `${plural(expired, 'Microsoft subscription has', 'Microsoft subscriptions have')} expired` });
    }
    const authPaused = sum(snap.paused.filter((p) => p.reason === 'auth_failure'));
    if (authPaused > 0) {
      add({ code: 'providers_auth_paused', severity: 'degraded', count: authPaused,
        message: `${plural(authPaused, 'provider is', 'providers are')} paused after authentication failures` });
    }
    const authFailing = sum(snap.authFailing);
    if (authFailing > 0) {
      add({ code: 'providers_auth_failing', severity: 'degraded', count: authFailing,
        message: `${plural(authFailing, 'provider is', 'providers are')} failing authentication` });
    }
    const stale = Object.values(snap.sync.stale).reduce((a, n) => a + n, 0);
    if (stale > 0) {
      add({ code: 'sync_stale', severity: 'degraded', count: stale,
        message: `${plural(stale, 'provider has', 'providers have')} not synced recently` });
    }
    const gmailExpired = snap.gmail.watches.expired;
    if (gmailExpired > 0) {
      add({ code: 'gmail_watches_expired', severity: 'degraded', count: gmailExpired,
        message: `${plural(gmailExpired, 'Gmail watch has', 'Gmail watches have')} expired` });
    }
  }
  if (collector.dlqGrowthLastHour > 0) {
    add({ code: 'dlq_growing', severity: 'degraded', count: collector.dlqGrowthLastHour,
      message: `The dead-letter queue grew by ${collector.dlqGrowthLastHour} in the last hour` });
  }
  if (queues && queues.v1.ready > READY_BACKLOG_THRESHOLD) {
    add({ code: 'queue_backlog', severity: 'degraded', count: queues.v1.ready,
      message: `${queues.v1.ready} inbound email jobs are waiting in the ready queue` });
  }
  const intervalSeconds = Math.round(collector.intervalMs / 1000);
  const collectorAgeMs = collector.lastSuccessAtMs === null ? null : nowMs - collector.lastSuccessAtMs;
  const collectorStale =
    collectorAgeMs === null
      ? nowMs - collector.startedAtMs > COLLECTOR_NEVER_SUCCEEDED_AFTER_MS
      : collectorAgeMs > COLLECTOR_STALE_INTERVALS * collector.intervalMs;
  if (collectorStale) {
    add({ code: 'health_data_stale', severity: 'degraded', message: 'Fleet health data has not been refreshed recently' });
  }

  // ---- info ---------------------------------------------------------------
  if (queues && queues.v1.dlq > 0 && collector.dlqGrowthLastHour === 0) {
    add({ code: 'dlq_nonzero', severity: 'info', count: queues.v1.dlq,
      message: `${queues.v1.dlq} jobs sit in the dead-letter queue (not growing)` });
  }
  if (snap && snap.microsoft.deliveryMode.polling > 0) {
    const n = snap.microsoft.deliveryMode.polling;
    add({ code: 'microsoft_polling_providers', severity: 'info', count: n,
      message: `${plural(n, 'Microsoft provider uses', 'Microsoft providers use')} polling delivery` });
  }
  if (snap) {
    const manual = sum(snap.paused.filter((p) => p.reason === 'manual'));
    if (manual > 0) {
      add({ code: 'providers_paused_manual', severity: 'info', count: manual,
        message: `${plural(manual, 'provider is', 'providers are')} manually paused` });
    }
  }

  const rank: Record<StatusSeverity, number> = { down: 0, degraded: 1, info: 2 };
  reasons.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const status: OverallStatus = reasons.some((r) => r.severity === 'down')
    ? 'down'
    : reasons.some((r) => r.severity === 'degraded')
      ? 'degraded'
      : 'ok';

  const beat = (c: ReadinessChecks['consumer_v1'] | undefined) =>
    c
      ? {
          lastTickAt: iso(c.lastTickMs),
          ageSeconds: typeof c.lastTickMs === 'number' ? Math.max(0, Math.round((nowMs - c.lastTickMs) / 1000)) : null,
          stale: !c.ok,
        }
      : null;
  const depth = (d: QueueDepths | null | undefined, growth?: number) =>
    d ? { ...d, ...(growth === undefined ? {} : { dlqGrowthLastHour: growth }) } : null;

  const byTypeAndStatus: Record<string, Record<string, number>> = {};
  for (const p of snap?.providers ?? []) {
    (byTypeAndStatus[p.providerType] ??= {})[p.status] = p.count;
  }

  return {
    version: STATUS_SCHEMA_VERSION,
    service: 'email-service' as const,
    status,
    generatedAt: new Date(nowMs).toISOString(),
    reasons,
    consumer: { v1: beat(checks.consumer_v1), v2: beat(checks.consumer_v2) },
    dependencies: { db: { ok: checks.db.ok }, redis: { ok: checks.redis.ok } },
    queue: { v1: depth(queues?.v1, collector.dlqGrowthLastHour), v2: depth(queues?.v2) },
    imap: { activeListeners: imap.activeListeners, providersLeased: imap.providersLeased },
    providers: {
      byTypeAndStatus,
      paused: snap?.paused ?? [],
      authFailing: snap?.authFailing ?? [],
    },
    microsoft: snap?.microsoft ?? {
      subscriptions: { ...EMPTY_STATES },
      deliveryMode: { webhook: 0, polling: 0 },
      silentWebhooks: 0,
    },
    gmail: snap?.gmail ?? { watches: { ...EMPTY_STATES } },
    sync: snap?.sync ?? { stale: { imap: 0, microsoft: 0, google: 0 }, oldestLivenessAgeSeconds: {} },
    collector: {
      lastSuccessAt: iso(collector.lastSuccessAtMs),
      ageSeconds: collectorAgeMs === null ? null : Math.round(collectorAgeMs / 1000),
      intervalSeconds,
    },
  };
}

export type StatusSummary = ReturnType<typeof buildStatusSummary>;
