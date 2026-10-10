/**
 * Fleet health collector.
 *
 * A single-flight loop (default 60s): never runs per scrape and never throws.
 * The DB part and the Redis part fail independently; a failed part keeps its
 * last values, a failed tick increments the failure counter and leaves
 * `last_success` unchanged. The gauges are identical on every replica, so
 * alerts use `max()` (no leader election).
 */

import logger from '@alga-psa/core/logger';
import type { InboundEmailHealthSnapshot } from '@alga-psa/shared/services/email/inboundEmailHealthSnapshot';
import type { InboundEmailMetrics } from './registry';
import { withTimeout } from './readiness';

export const DEFAULT_COLLECT_INTERVAL_MS = 60_000;
export const REDIS_READ_TIMEOUT_MS = 2_000;
const DLQ_HISTORY_SAMPLES = 60;

export interface QueueDepths {
  ready: number;
  processing: number;
  inflight: number;
  dlq: number;
  /** V2 only. */
  delayed?: number;
}

export interface QueueDepthSnapshot {
  v1: QueueDepths;
  v2: QueueDepths | null;
}

export interface HealthCollectorDeps {
  metrics: InboundEmailMetrics;
  collectSnapshot: () => Promise<InboundEmailHealthSnapshot>;
  readQueueDepths: () => Promise<QueueDepthSnapshot>;
  intervalMs?: number;
  now?: () => number;
  random?: () => number;
}

export interface CollectorCache {
  snapshot: InboundEmailHealthSnapshot | null;
  snapshotAtMs: number | null;
  queues: QueueDepthSnapshot | null;
  queuesAtMs: number | null;
  /** Growth of the V1 DLQ across the retained samples (~1h); never negative. */
  dlqGrowthLastHour: number;
  lastSuccessAtMs: number | null;
  startedAtMs: number;
  intervalMs: number;
  lastTick: { dbOk: boolean; redisOk: boolean } | null;
}

export function readCollectIntervalMsFromEnv(): number {
  const parsed = Number(process.env.EMAIL_SERVICE_HEALTH_COLLECT_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 1_000 ? Math.floor(parsed) : DEFAULT_COLLECT_INTERVAL_MS;
}

function resetAll(gauges: Array<{ reset(): void }>) {
  for (const g of gauges) g.reset();
}

function applySnapshot(metrics: InboundEmailMetrics, s: InboundEmailHealthSnapshot) {
  const f = metrics.fleet;
  resetAll([
    f.providers,
    f.providersPaused,
    f.providersAuthFailing,
    f.microsoftSubscriptions,
    f.microsoftDeliveryMode,
    f.gmailWatches,
    f.oldestLivenessAge,
    f.providersSyncStale,
    f.durableInbox,
  ]);
  for (const p of s.providers) f.providers.set({ provider_type: p.providerType, status: p.status }, p.count);
  for (const p of s.paused) {
    f.providersPaused.set({ provider_type: p.providerType, reason: p.reason, code: p.code }, p.count);
  }
  for (const p of s.authFailing) f.providersAuthFailing.set({ provider_type: p.providerType, code: p.code }, p.count);
  for (const [state, n] of Object.entries(s.microsoft.subscriptions)) f.microsoftSubscriptions.set({ state }, n);
  for (const [mode, n] of Object.entries(s.microsoft.deliveryMode)) f.microsoftDeliveryMode.set({ mode }, n);
  f.microsoftWebhooksSilent.set(s.microsoft.silentWebhooks);
  for (const [state, n] of Object.entries(s.gmail.watches)) f.gmailWatches.set({ state }, n);
  for (const [type, n] of Object.entries(s.sync.stale)) f.providersSyncStale.set({ provider_type: type }, n);
  for (const [type, age] of Object.entries(s.sync.oldestLivenessAgeSeconds)) {
    if (typeof age === 'number') f.oldestLivenessAge.set({ provider_type: type }, age);
  }
  if (s.durable) {
    for (const [status, n] of Object.entries(s.durable.inbox)) f.durableInbox.set({ status }, n);
    f.durableOutboxPending.set(s.durable.outboxPending);
    f.durableOldestOutboxAge.set(s.durable.oldestPendingOutboxAgeSeconds);
    f.durableArtifactsPending.set(s.durable.artifactsPending);
  } else {
    f.durableOutboxPending.reset();
    f.durableOldestOutboxAge.reset();
    f.durableArtifactsPending.reset();
  }
}

function applyQueues(metrics: InboundEmailMetrics, q: QueueDepthSnapshot) {
  const g = metrics.fleet.queueDepth;
  g.reset();
  for (const [queue, depths] of [['v1', q.v1], ['v2', q.v2]] as const) {
    if (!depths) continue;
    g.set({ queue, state: 'ready' }, depths.ready);
    g.set({ queue, state: 'processing' }, depths.processing);
    g.set({ queue, state: 'inflight' }, depths.inflight);
    g.set({ queue, state: 'dlq' }, depths.dlq);
    if (depths.delayed !== undefined) g.set({ queue, state: 'delayed' }, depths.delayed);
  }
}

export function createHealthCollector(deps: HealthCollectorDeps) {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const intervalMs = deps.intervalMs ?? readCollectIntervalMsFromEnv();
  const dlqHistory: number[] = [];
  const cache: CollectorCache = {
    snapshot: null,
    snapshotAtMs: null,
    queues: null,
    queuesAtMs: null,
    dlqGrowthLastHour: 0,
    lastSuccessAtMs: null,
    startedAtMs: now(),
    intervalMs,
    lastTick: null,
  };
  let running: Promise<void> | null = null;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  async function tickInner(): Promise<void> {
    const started = now();
    let dbOk = true;
    let redisOk = true;

    const [dbResult, redisResult] = await Promise.allSettled([deps.collectSnapshot(), deps.readQueueDepths()]);

    if (dbResult.status === 'fulfilled') {
      applySnapshot(deps.metrics, dbResult.value);
      cache.snapshot = dbResult.value;
      cache.snapshotAtMs = now();
    } else {
      dbOk = false;
      logger.warn('[HealthCollector] DB snapshot failed', {
        event: 'inbound_email_health_collector_failed',
        part: 'db',
        errorName: (dbResult.reason as Error | undefined)?.name ?? 'Error',
      });
    }

    if (redisResult.status === 'fulfilled') {
      applyQueues(deps.metrics, redisResult.value);
      cache.queues = redisResult.value;
      cache.queuesAtMs = now();
      dlqHistory.push(redisResult.value.v1.dlq);
      if (dlqHistory.length > DLQ_HISTORY_SAMPLES) dlqHistory.shift();
      cache.dlqGrowthLastHour = Math.max(0, redisResult.value.v1.dlq - dlqHistory[0]);
    } else {
      redisOk = false;
      logger.warn('[HealthCollector] Redis depth read failed', {
        event: 'inbound_email_health_collector_failed',
        part: 'redis',
        errorName: (redisResult.reason as Error | undefined)?.name ?? 'Error',
      });
    }

    cache.lastTick = { dbOk, redisOk };
    deps.metrics.collector.lastDuration.set((now() - started) / 1000);
    if (dbOk && redisOk) {
      cache.lastSuccessAtMs = now();
      deps.metrics.collector.lastSuccess.set(cache.lastSuccessAtMs / 1000);
    } else {
      deps.metrics.collector.failures.inc();
    }
  }

  /** Runs one collection. Single-flight: a call while one is running joins it. Never throws. */
  function tick(): Promise<void> {
    if (running) return running;
    running = (async () => {
      try {
        await tickInner();
      } catch (error) {
        // Defensive: tickInner already isolates both parts.
        cache.lastTick = { dbOk: false, redisOk: false };
        deps.metrics.collector.failures.inc();
        logger.warn('[HealthCollector] Unexpected collector error', {
          event: 'inbound_email_health_collector_failed',
          errorName: (error as Error | undefined)?.name ?? 'Error',
        });
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function schedule() {
    if (stopped) return;
    const jitter = 1 + (random() - 0.5) * 0.2; // +-10%
    timer = setTimeout(() => {
      void tick().finally(schedule);
    }, Math.round(intervalMs * jitter));
    timer.unref?.();
  }

  return {
    tick,
    start() {
      stopped = false;
      void tick().finally(schedule);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    getCache: (): CollectorCache => cache,
  };
}

export type HealthCollector = ReturnType<typeof createHealthCollector>;

// ---------------------------------------------------------------------------
// Real dependencies (kept out of the unit tests, which inject fakes)
// ---------------------------------------------------------------------------

export async function collectRealSnapshot(): Promise<InboundEmailHealthSnapshot> {
  const [{ getAdminConnection }, snapshotModule, durableStore] = await Promise.all([
    import('@alga-psa/db/admin'),
    import('@alga-psa/shared/services/email/inboundEmailHealthSnapshot'),
    import('@alga-psa/shared/services/email/inboundEmailDurableStore'),
  ]);
  const knex = await getAdminConnection();
  return snapshotModule.collectInboundEmailHealthSnapshot({
    knex,
    thresholds: snapshotModule.readInboundEmailHealthThresholdsFromEnv(),
    includeDurable: durableStore.getInboundDurableMode() !== 'off',
  });
}

type RedisDepthClient = {
  lLen(key: string): Promise<number>;
  hLen(key: string): Promise<number>;
  zCard(key: string): Promise<number>;
};

async function readDepths(
  client: RedisDepthClient,
  keys: { readyQueueKey: string; processingQueueKey: string; inflightHashKey: string; deadLetterQueueKey: string; delayedKey?: string }
): Promise<QueueDepths> {
  const [ready, processing, inflight, dlq, delayed] = await Promise.all([
    client.lLen(keys.readyQueueKey),
    client.lLen(keys.processingQueueKey),
    client.hLen(keys.inflightHashKey),
    client.lLen(keys.deadLetterQueueKey),
    keys.delayedKey ? client.zCard(keys.delayedKey) : Promise.resolve(undefined),
  ]);
  return delayed === undefined ? { ready, processing, inflight, dlq } : { ready, processing, inflight, dlq, delayed };
}

export async function readRealQueueDepths(): Promise<QueueDepthSnapshot> {
  const [queue, queueV2, durableStore] = await Promise.all([
    import('@alga-psa/shared/services/email/unifiedInboundEmailQueue'),
    import('@alga-psa/shared/services/email/unifiedInboundEmailQueueV2'),
    import('@alga-psa/shared/services/email/inboundEmailDurableStore'),
  ]);
  const v1 = await withTimeout(
    async () => readDepths((await queue.getInboundEmailRedisClient()) as unknown as RedisDepthClient, queue.getUnifiedInboundEmailQueueConfig()),
    REDIS_READ_TIMEOUT_MS
  );
  let v2: QueueDepths | null = null;
  if (durableStore.getInboundDurableMode() !== 'off') {
    v2 = await withTimeout(
      async () =>
        readDepths(
          (await queueV2.getInboundEmailDurableRedisClient()) as unknown as RedisDepthClient,
          queueV2.getUnifiedInboundEmailQueueV2Config()
        ),
      REDIS_READ_TIMEOUT_MS
    );
  }
  return { v1, v2 };
}
