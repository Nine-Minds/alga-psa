/**
 * V2 fenced Redis transport for the durable inbound email pipeline.
 *
 * At-least-once wake-up transport. Every transport mutation is owner-fenced by
 * comparing the job id plus a per-claim claim token inside Lua before mutating
 * the processing list, inflight hash, and lease sorted set. Redis claims are
 * NOT the domain correctness boundary — the Postgres token/version fence is.
 *
 * V2 payloads contain only a work type plus durable record ids — never MIME or
 * attachment content. Separate V2 keys keep V2 jobs invisible to old consumers
 * during the mixed-version rollout window.
 */

import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { getSecret } from '@alga-psa/core/secrets';
import type {
  ClaimedInboundEmailQueueJobV2,
  UnifiedInboundEmailQueueJobV2,
} from '../../interfaces/inbound-email.interfaces';

const DEFAULT_V2_READY_KEY = 'email:inbound:unified:v2:ready';
const DEFAULT_V2_PROCESSING_KEY = 'email:inbound:unified:v2:processing';
const DEFAULT_V2_INFLIGHT_HASH_KEY = 'email:inbound:unified:v2:inflight';
const DEFAULT_V2_INFLIGHT_LEASE_KEY = 'email:inbound:unified:v2:lease';
const DEFAULT_V2_DELAYED_KEY = 'email:inbound:unified:v2:delayed';
const DEFAULT_V2_DELAYED_DATA_KEY = 'email:inbound:unified:v2:delayed:data';
const DEFAULT_V2_DLQ_KEY = 'email:inbound:unified:v2:dlq';
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_CLAIM_TTL_MS = 120_000;
const DEFAULT_HANDLER_TIMEOUT_MS = 90_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_BLOCK_SECONDS = 1;
const CLAIM_POLL_INTERVAL_MS = 100;

const CLAIM_JOB_V2_LUA = `
local ready = KEYS[1]
local processing = KEYS[2]
local inflightHash = KEYS[3]
local inflightLease = KEYS[4]
local dlq = KEYS[5]

local nowMs = tonumber(ARGV[1])
local claimTtlMs = tonumber(ARGV[2])
local consumerId = ARGV[3]
local claimedAtIso = ARGV[4]
local leaseExpiresAtIso = ARGV[5]
local failedAtIso = ARGV[6]
local claimToken = ARGV[7]

local payload = redis.call('RPOPLPUSH', ready, processing)
if not payload then
  return cjson.encode({ status = 'empty' })
end

local ok, job = pcall(cjson.decode, payload)
if not ok or type(job) ~= 'table' or job['jobId'] == nil then
  redis.call('LREM', processing, 1, payload)
  redis.call('RPUSH', dlq, cjson.encode({
    failedAt = failedAtIso,
    reason = 'invalid_queue_payload',
    rawPayload = payload,
  }))
  return cjson.encode({ status = 'invalid', payloadLength = string.len(payload) })
end

local jobId = tostring(job['jobId'])
local claim = cjson.encode({
  job = job,
  originalPayload = payload,
  claimToken = claimToken,
  consumerId = consumerId,
  claimedAt = claimedAtIso,
  leaseExpiresAt = leaseExpiresAtIso,
})

redis.call('HSET', inflightHash, jobId, claim)
redis.call('ZADD', inflightLease, nowMs + claimTtlMs, jobId)

return cjson.encode({ status = 'claimed', claim = claim })
`;

const ACK_JOB_V2_LUA = `
local processing = KEYS[1]
local inflightHash = KEYS[2]
local inflightLease = KEYS[3]
local jobId = ARGV[1]
local claimToken = ARGV[2]
local nowMs = tonumber(ARGV[3])

local claimRaw = redis.call('HGET', inflightHash, jobId)
if not claimRaw then
  return cjson.encode({ status = 'noop', reason = 'claim_missing' })
end
local ok, claim = pcall(cjson.decode, claimRaw)
if not ok or claim['claimToken'] ~= claimToken then
  return cjson.encode({ status = 'noop', reason = 'stale_token' })
end
redis.call('LREM', processing, 1, claim['originalPayload'])
redis.call('HDEL', inflightHash, jobId)
redis.call('ZREM', inflightLease, jobId)
return cjson.encode({ status = 'acked' })
`;

const FAIL_JOB_V2_LUA = `
local ready = KEYS[1]
local processing = KEYS[2]
local inflightHash = KEYS[3]
local inflightLease = KEYS[4]
local dlq = KEYS[5]
local jobId = ARGV[1]
local claimToken = ARGV[2]
local errorMsg = ARGV[3]
local maxAttempts = tonumber(ARGV[4])

local claimRaw = redis.call('HGET', inflightHash, jobId)
if not claimRaw then
  return cjson.encode({ status = 'noop', reason = 'claim_missing' })
end
local ok, claim = pcall(cjson.decode, claimRaw)
if not ok or claim['claimToken'] ~= claimToken then
  return cjson.encode({ status = 'noop', reason = 'stale_token' })
end

local payload = claim['originalPayload']
redis.call('LREM', processing, 1, payload)

local job = claim['job']
local nextAttempt = (tonumber(job['attempt']) or 0) + 1
if nextAttempt >= maxAttempts then
  redis.call('HDEL', inflightHash, jobId)
  redis.call('ZREM', inflightLease, jobId)
  local retriedJob = cjson.decode(payload)
  retriedJob['attempt'] = nextAttempt
  redis.call('RPUSH', dlq, cjson.encode({
    failedAt = cjson.encode({ _ts = os.time() }),
    reason = errorMsg,
    job = retriedJob,
  }))
  return cjson.encode({ status = 'dlq', attempt = nextAttempt })
end

local retriedJob = cjson.decode(payload)
retriedJob['attempt'] = nextAttempt
redis.call('RPUSH', ready, cjson.encode(retriedJob))
redis.call('HDEL', inflightHash, jobId)
redis.call('ZREM', inflightLease, jobId)
return cjson.encode({ status = 'retried', attempt = nextAttempt })
`;

const DEFER_JOB_V2_LUA = `
local processing = KEYS[1]
local inflightHash = KEYS[2]
local inflightLease = KEYS[3]
local delayed = KEYS[4]
local delayedData = KEYS[5]
local jobId = ARGV[1]
local claimToken = ARGV[2]
local untilMs = ARGV[3]

local claimRaw = redis.call('HGET', inflightHash, jobId)
if not claimRaw then
  return cjson.encode({ status = 'noop', reason = 'claim_missing' })
end
local ok, claim = pcall(cjson.decode, claimRaw)
if not ok or claim['claimToken'] ~= claimToken then
  return cjson.encode({ status = 'noop', reason = 'stale_token' })
end

redis.call('LREM', processing, 1, claim['originalPayload'])
redis.call('HSET', delayedData, jobId, claim['originalPayload'])
redis.call('ZADD', delayed, tonumber(untilMs), jobId)
redis.call('HDEL', inflightHash, jobId)
redis.call('ZREM', inflightLease, jobId)
return cjson.encode({ status = 'deferred', untilMs = tonumber(untilMs) })
`;

const RENEW_JOB_V2_LUA = `
local inflightLease = KEYS[1]
local inflightHash = KEYS[2]
local jobId = ARGV[1]
local claimToken = ARGV[2]
local expiresAtMs = ARGV[3]

local claimRaw = redis.call('HGET', inflightHash, jobId)
if not claimRaw then
  return cjson.encode({ status = 'noop', reason = 'claim_missing' })
end
local ok, claim = pcall(cjson.decode, claimRaw)
if not ok or claim['claimToken'] ~= claimToken then
  return cjson.encode({ status = 'noop', reason = 'stale_token' })
end
redis.call('ZADD', inflightLease, tonumber(expiresAtMs), jobId)
return cjson.encode({ status = 'renewed' })
`;

const RECLAIM_EXPIRED_V2_LUA = `
local ready = KEYS[1]
local processing = KEYS[2]
local inflightHash = KEYS[3]
local inflightLease = KEYS[4]
local nowMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

local expired = redis.call('ZRANGEBYSCORE', inflightLease, 0, nowMs, 'LIMIT', 0, limit)
local reclaimed = 0
for _, jobId in ipairs(expired) do
  local claimRaw = redis.call('HGET', inflightHash, jobId)
  if not claimRaw then
    redis.call('ZREM', inflightLease, jobId)
  else
    local ok, claim = pcall(cjson.decode, claimRaw)
    if not ok then
      redis.call('ZREM', inflightLease, jobId)
      redis.call('HDEL', inflightHash, jobId)
    else
      redis.call('LREM', processing, 1, claim['originalPayload'])
      redis.call('RPUSH', ready, claim['originalPayload'])
      redis.call('HDEL', inflightHash, jobId)
      redis.call('ZREM', inflightLease, jobId)
      reclaimed = reclaimed + 1
    end
  end
end
return cjson.encode({ status = 'done', reclaimed = reclaimed })
`;

const PUMP_DELAYED_V2_LUA = `
local ready = KEYS[1]
local delayed = KEYS[2]
local delayedData = KEYS[3]
local nowMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

local due = redis.call('ZRANGEBYSCORE', delayed, 0, nowMs, 'LIMIT', 0, limit)
local pumped = 0
for _, jobId in ipairs(due) do
  local payload = redis.call('HGET', delayedData, jobId)
  if payload then
    redis.call('RPUSH', ready, payload)
    redis.call('HDEL', delayedData, jobId)
  end
  redis.call('ZREM', delayed, jobId)
  pumped = pumped + 1
end
return cjson.encode({ status = 'done', pumped = pumped })
`;

let redisClientPromise: Promise<RedisClientType> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export interface UnifiedInboundEmailQueueV2Config {
  readyQueueKey: string;
  processingQueueKey: string;
  inflightHashKey: string;
  inflightLeaseKey: string;
  delayedKey: string;
  delayedDataKey: string;
  deadLetterQueueKey: string;
  maxAttempts: number;
  claimTtlMs: number;
  handlerTimeoutMs: number;
  heartbeatIntervalMs: number;
  claimBlockSeconds: number;
}

export function getUnifiedInboundEmailQueueV2Config(): UnifiedInboundEmailQueueV2Config {
  const claimTtlMs = parsePositiveInteger(
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_CLAIM_TTL_MS,
    DEFAULT_CLAIM_TTL_MS
  );
  const handlerTimeoutMs = parsePositiveInteger(
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_JOB_TIMEOUT_MS,
    DEFAULT_HANDLER_TIMEOUT_MS
  );
  const heartbeatIntervalMs = parsePositiveInteger(
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_HEARTBEAT_INTERVAL_MS,
    DEFAULT_HEARTBEAT_INTERVAL_MS
  );
  return {
    readyQueueKey: (process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_READY_KEY || '').trim() || DEFAULT_V2_READY_KEY,
    processingQueueKey:
      (process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_PROCESSING_KEY || '').trim() || DEFAULT_V2_PROCESSING_KEY,
    inflightHashKey:
      (process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_INFLIGHT_HASH_KEY || '').trim() || DEFAULT_V2_INFLIGHT_HASH_KEY,
    inflightLeaseKey:
      (process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_INFLIGHT_LEASE_KEY || '').trim() || DEFAULT_V2_INFLIGHT_LEASE_KEY,
    delayedKey: (process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_DELAYED_KEY || '').trim() || DEFAULT_V2_DELAYED_KEY,
    delayedDataKey:
      (process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_DELAYED_DATA_KEY || '').trim() || DEFAULT_V2_DELAYED_DATA_KEY,
    deadLetterQueueKey:
      (process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_DLQ_KEY || '').trim() || DEFAULT_V2_DLQ_KEY,
    maxAttempts: parsePositiveInteger(
      process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS
    ),
    claimTtlMs,
    handlerTimeoutMs,
    heartbeatIntervalMs,
    claimBlockSeconds: parsePositiveInteger(
      process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_BLOCK_SECONDS,
      DEFAULT_BLOCK_SECONDS
    ),
  };
}

/**
 * Fail-fast startup validation: claim TTL must be at least handler timeout plus
 * one heartbeat interval, otherwise the old 60/90 mismatch is recreated.
 */
export function assertDurableQueueTtlConfiguration(config?: UnifiedInboundEmailQueueV2Config): void {
  const cfg = config ?? getUnifiedInboundEmailQueueV2Config();
  const minimum = cfg.handlerTimeoutMs + cfg.heartbeatIntervalMs;
  if (cfg.claimTtlMs < minimum) {
    throw new Error(
      `UnifiedInboundEmailQueueV2 misconfiguration: claim TTL (${cfg.claimTtlMs}ms) is less than ` +
        `handler timeout (${cfg.handlerTimeoutMs}ms) plus one heartbeat interval (${cfg.heartbeatIntervalMs}ms) ` +
        `(minimum ${minimum}ms). This re-creates the 60/90 lease loss that lost inbound email.`
    );
  }
}

async function getRedisClient(): Promise<RedisClientType> {
  if (redisClientPromise) {
    return redisClientPromise;
  }

  redisClientPromise = (async () => {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = process.env.REDIS_PORT || '6379';
    const password = await getSecret('redis_password', 'REDIS_PASSWORD');

    const options: Parameters<typeof createClient>[0] = {
      url: `redis://${host}:${port}`,
    };

    if (password) {
      (options as any).password = password;
    }

    const client = createClient(options);
    client.on('error', (error) => {
      console.error('[UnifiedInboundEmailQueueV2] Redis client error:', error);
    });
    await client.connect();
    return client as RedisClientType;
  })();

  return redisClientPromise;
}

export async function getInboundEmailDurableRedisClient(): Promise<RedisClientType> {
  return getRedisClient();
}

function getJobLogFields(job: UnifiedInboundEmailQueueJobV2): Record<string, string | number | null> {
  return {
    jobId: job.jobId,
    schemaVersion: job.schemaVersion,
    workType: job.workType,
    tenantId: job.tenantId,
    recordId: job.recordId,
    inboxId: job.inboxId ?? null,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
  };
}

function buildV2Job(input: {
  workType: UnifiedInboundEmailQueueJobV2['workType'];
  tenantId: string;
  recordId: string;
  inboxId?: string;
  maxAttempts?: number;
}): UnifiedInboundEmailQueueJobV2 {
  const cfg = getUnifiedInboundEmailQueueV2Config();
  return {
    schemaVersion: 2,
    workType: input.workType,
    tenantId: input.tenantId,
    recordId: input.recordId,
    inboxId: input.inboxId,
    jobId: randomUUID(),
    enqueuedAt: new Date().toISOString(),
    attempt: 0,
    maxAttempts: input.maxAttempts && input.maxAttempts > 0 ? Math.floor(input.maxAttempts) : cfg.maxAttempts,
  };
}

export async function enqueueInboundEmailDurableJob(input: {
  workType: UnifiedInboundEmailQueueJobV2['workType'];
  tenantId: string;
  recordId: string;
  inboxId?: string;
  maxAttempts?: number;
}): Promise<{ job: UnifiedInboundEmailQueueJobV2; queueDepth: number }> {
  const cfg = getUnifiedInboundEmailQueueV2Config();
  const client = await getRedisClient();
  const job = buildV2Job(input);
  let queueDepth: number;
  try {
    queueDepth = await client.rPush(cfg.readyQueueKey, JSON.stringify(job));
  } catch (error: any) {
    console.error('[UnifiedInboundEmailQueueV2] enqueue_failed', {
      event: 'inbound_email_queue_v2_enqueue_failed',
      ...getJobLogFields(job),
      error: error?.message || String(error),
    });
    throw error;
  }
  console.log('[UnifiedInboundEmailQueueV2] enqueue', {
    event: 'inbound_email_queue_v2_enqueue',
    ...getJobLogFields(job),
    queueDepth,
  });
  return { job, queueDepth };
}

function parseClaimRecordV2(value: string): ClaimedInboundEmailQueueJobV2 | null {
  try {
    const parsed = JSON.parse(value) as ClaimedInboundEmailQueueJobV2;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.job || typeof parsed.job !== 'object') return null;
    if (typeof parsed.originalPayload !== 'string') return null;
    if (typeof parsed.claimToken !== 'string') return null;
    if (typeof parsed.consumerId !== 'string') return null;
    if (typeof parsed.job.jobId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function claimInboundEmailDurableJob(params: {
  consumerId: string;
  blockSeconds?: number;
  claimTtlMs?: number;
}): Promise<ClaimedInboundEmailQueueJobV2 | null> {
  const cfg = getUnifiedInboundEmailQueueV2Config();
  const client = await getRedisClient();
  const blockSeconds = Math.max(0, params.blockSeconds ?? cfg.claimBlockSeconds);
  const claimTtlMs = Math.max(1, params.claimTtlMs ?? cfg.claimTtlMs);
  const deadline = Date.now() + blockSeconds * 1000;
  let claimRecord: ClaimedInboundEmailQueueJobV2 | null = null;

  while (!claimRecord) {
    await pumpDueDelayedInboundEmailDurableJobs(client, cfg, 50);
    const now = Date.now();
    const claimedAt = new Date(now).toISOString();
    const leaseExpiresAt = new Date(now + claimTtlMs).toISOString();
    const failedAt = claimedAt;
    const claimToken = randomUUID();

    const rawResult = await (client as any).eval(CLAIM_JOB_V2_LUA, {
      keys: [
        cfg.readyQueueKey,
        cfg.processingQueueKey,
        cfg.inflightHashKey,
        cfg.inflightLeaseKey,
        cfg.deadLetterQueueKey,
      ],
      arguments: [
        String(now),
        String(claimTtlMs),
        params.consumerId,
        claimedAt,
        leaseExpiresAt,
        failedAt,
        claimToken,
      ],
    });

    const parsedResult = typeof rawResult === 'string' ? parseClaimRecordV2(rawResult) : null;
    let envelope: any = null;
    if (!parsedResult) {
      if (typeof rawResult === 'string') {
        try {
          envelope = JSON.parse(rawResult);
        } catch {
          envelope = null;
        }
      } else {
        envelope = rawResult;
      }
    }

    if (parsedResult) {
      claimRecord = parsedResult;
      break;
    }

    if (!envelope || typeof envelope !== 'object') {
      if (Date.now() >= deadline) return null;
      await sleep(CLAIM_POLL_INTERVAL_MS);
      continue;
    }

    if ((envelope as any).status === 'empty') {
      if (Date.now() >= deadline) return null;
      await sleep(CLAIM_POLL_INTERVAL_MS);
      continue;
    }

    if ((envelope as any).status === 'invalid') {
      console.error('[UnifiedInboundEmailQueueV2] invalid_payload_dlq', {
        event: 'inbound_email_queue_v2_invalid_payload_dlq',
        payloadLength: Number((envelope as any).payloadLength || 0),
      });
      if (Date.now() >= deadline) return null;
      continue;
    }

    if ((envelope as any).status === 'claimed' && typeof (envelope as any).claim === 'string') {
      const parsedClaim = parseClaimRecordV2((envelope as any).claim);
      if (parsedClaim) {
        claimRecord = parsedClaim;
        break;
      }
    }

    if (Date.now() >= deadline) return null;
    await sleep(CLAIM_POLL_INTERVAL_MS);
  }

  console.log('[UnifiedInboundEmailQueueV2] consume_start', {
    event: 'inbound_email_queue_v2_consume_start',
    ...getJobLogFields(claimRecord.job),
    consumerId: params.consumerId,
    claimTtlMs,
  });

  return claimRecord;
}

export async function ackInboundEmailDurableJob(
  claim: ClaimedInboundEmailQueueJobV2
): Promise<{ status: 'acked' | 'noop' }> {
  const cfg = getUnifiedInboundEmailQueueV2Config();
  const client = await getRedisClient();
  const result = await (client as any).eval(ACK_JOB_V2_LUA, {
    keys: [cfg.processingQueueKey, cfg.inflightHashKey, cfg.inflightLeaseKey],
    arguments: [claim.job.jobId, claim.claimToken, String(Date.now())],
  });
  const parsed = typeof result === 'string' ? JSON.parse(result) : result;
  if (parsed?.status === 'noop') {
    console.warn('[UnifiedInboundEmailQueueV2] ack_noop', {
      event: 'inbound_email_queue_v2_stale_ack',
      ...getJobLogFields(claim.job),
      reason: parsed.reason,
    });
    return { status: 'noop' };
  }
  console.log('[UnifiedInboundEmailQueueV2] ack', {
    event: 'inbound_email_queue_v2_ack',
    ...getJobLogFields(claim.job),
    consumerId: claim.consumerId,
  });
  return { status: 'acked' };
}

export async function failInboundEmailDurableJob(params: {
  claim: ClaimedInboundEmailQueueJobV2;
  error: string;
}): Promise<{ action: 'retried' | 'dlq' | 'noop'; attempt: number }> {
  const cfg = getUnifiedInboundEmailQueueV2Config();
  const client = await getRedisClient();
  const result = await (client as any).eval(FAIL_JOB_V2_LUA, {
    keys: [
      cfg.readyQueueKey,
      cfg.processingQueueKey,
      cfg.inflightHashKey,
      cfg.inflightLeaseKey,
      cfg.deadLetterQueueKey,
    ],
    arguments: [
      params.claim.job.jobId,
      params.claim.claimToken,
      params.error,
      String(cfg.maxAttempts),
    ],
  });
  const parsed = typeof result === 'string' ? JSON.parse(result) : result;
  if (parsed?.status === 'noop') {
    console.warn('[UnifiedInboundEmailQueueV2] fail_noop', {
      event: 'inbound_email_queue_v2_stale_fail',
      ...getJobLogFields(params.claim.job),
      reason: parsed.reason,
    });
    return { action: 'noop', attempt: params.claim.job.attempt };
  }
  const attempt = Number(parsed?.attempt ?? params.claim.job.attempt + 1);
  if (parsed?.status === 'dlq') {
    console.error('[UnifiedInboundEmailQueueV2] dlq', {
      event: 'inbound_email_queue_v2_dlq',
      ...getJobLogFields(params.claim.job),
      attempt,
      reason: params.error,
      consumerId: params.claim.consumerId,
    });
    return { action: 'dlq', attempt };
  }
  console.warn('[UnifiedInboundEmailQueueV2] retry', {
    event: 'inbound_email_queue_v2_retry',
    ...getJobLogFields(params.claim.job),
    attempt,
    reason: params.error,
    consumerId: params.claim.consumerId,
  });
  return { action: 'retried', attempt };
}

export async function deferInboundEmailDurableJob(params: {
  claim: ClaimedInboundEmailQueueJobV2;
  untilIso: string;
  reason?: string;
}): Promise<{ status: 'deferred' | 'noop' }> {
  const cfg = getUnifiedInboundEmailQueueV2Config();
  const client = await getRedisClient();
  const untilMs = Math.max(Date.now(), new Date(params.untilIso).getTime());
  const result = await (client as any).eval(DEFER_JOB_V2_LUA, {
    keys: [
      cfg.processingQueueKey,
      cfg.inflightHashKey,
      cfg.inflightLeaseKey,
      cfg.delayedKey,
      cfg.delayedDataKey,
    ],
    arguments: [params.claim.job.jobId, params.claim.claimToken, String(untilMs)],
  });
  const parsed = typeof result === 'string' ? JSON.parse(result) : result;
  if (parsed?.status === 'noop') {
    console.warn('[UnifiedInboundEmailQueueV2] defer_noop', {
      event: 'inbound_email_queue_v2_stale_defer',
      ...getJobLogFields(params.claim.job),
      reason: parsed.reason,
    });
    return { status: 'noop' };
  }
  console.log('[UnifiedInboundEmailQueueV2] defer', {
    event: 'inbound_email_queue_v2_defer',
    ...getJobLogFields(params.claim.job),
    untilMs: Number(parsed?.untilMs ?? untilMs),
    reason: params.reason ?? null,
    consumerId: params.claim.consumerId,
  });
  return { status: 'deferred' };
}

/**
 * Renew a Redis claim. Returns false when the caller no longer owns the claim
 * (superseded by reclaim). The caller must stop before any fenced terminal write.
 */
export async function renewInboundEmailDurableQueueClaim(claim: ClaimedInboundEmailQueueJobV2): Promise<boolean> {
  const cfg = getUnifiedInboundEmailQueueV2Config();
  const client = await getRedisClient();
  const expiresAtMs = Date.now() + cfg.claimTtlMs;
  const result = await (client as any).eval(RENEW_JOB_V2_LUA, {
    keys: [cfg.inflightLeaseKey, cfg.inflightHashKey],
    arguments: [claim.job.jobId, claim.claimToken, String(expiresAtMs)],
  });
  const parsed = typeof result === 'string' ? JSON.parse(result) : result;
  return parsed?.status === 'renewed';
}

export async function reclaimExpiredInboundEmailDurableJobs(limit: number = 20): Promise<number> {
  const cfg = getUnifiedInboundEmailQueueV2Config();
  const client = await getRedisClient();
  const result = await (client as any).eval(RECLAIM_EXPIRED_V2_LUA, {
    keys: [cfg.readyQueueKey, cfg.processingQueueKey, cfg.inflightHashKey, cfg.inflightLeaseKey],
    arguments: [String(Date.now()), String(Math.max(1, limit))],
  });
  const parsed = typeof result === 'string' ? JSON.parse(result) : result;
  const reclaimed = Number(parsed?.reclaimed ?? 0);
  if (reclaimed > 0) {
    console.warn('[UnifiedInboundEmailQueueV2] reclaim', {
      event: 'inbound_email_queue_v2_reclaim',
      reclaimed,
      consumerId: 'reclaim-sweep',
    });
  }
  return reclaimed;
}

export async function pumpDueDelayedInboundEmailDurableJobs(
  clientOverride?: RedisClientType,
  cfgOverride?: UnifiedInboundEmailQueueV2Config,
  limit: number = 50
): Promise<number> {
  const cfg = cfgOverride ?? getUnifiedInboundEmailQueueV2Config();
  const client = clientOverride ?? (await getRedisClient());
  const result = await (client as any).eval(PUMP_DELAYED_V2_LUA, {
    keys: [cfg.readyQueueKey, cfg.delayedKey, cfg.delayedDataKey],
    arguments: [String(Date.now()), String(Math.max(1, limit))],
  });
  const parsed = typeof result === 'string' ? JSON.parse(result) : result;
  return Number(parsed?.pumped ?? 0);
}
