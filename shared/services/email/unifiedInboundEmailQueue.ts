import { randomUUID } from 'crypto';
import { createClient, type RedisClientType } from 'redis';
import { getSecret } from '@alga-psa/core/secrets';
import type {
  GoogleInboundEmailPointer,
  ImapInboundEmailPointer,
  MicrosoftInboundEmailPointer,
  UnifiedInboundEmailQueueJob,
} from '../../interfaces/inbound-email.interfaces';

const DEFAULT_READY_QUEUE_KEY = 'email:inbound:unified:pointer:ready';
const DEFAULT_PROCESSING_QUEUE_KEY = 'email:inbound:unified:pointer:processing';
const DEFAULT_INFLIGHT_HASH_KEY = 'email:inbound:unified:pointer:inflight';
const DEFAULT_INFLIGHT_LEASE_KEY = 'email:inbound:unified:pointer:lease';
const DEFAULT_DLQ_QUEUE_KEY = 'email:inbound:unified:pointer:dlq';
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_CLAIM_TTL_MS = 60_000;
const DEFAULT_BLOCK_SECONDS = 1;
const CLAIM_POLL_INTERVAL_MS = 100;

const CLAIM_JOB_LUA = `
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
  return cjson.encode({
    status = 'invalid',
    payloadLength = string.len(payload),
  })
end

local jobId = tostring(job['jobId'])
local claim = cjson.encode({
  job = job,
  originalPayload = payload,
  consumerId = consumerId,
  claimedAt = claimedAtIso,
  leaseExpiresAt = leaseExpiresAtIso,
})

redis.call('HSET', inflightHash, jobId, claim)
redis.call('ZADD', inflightLease, nowMs + claimTtlMs, jobId)

return cjson.encode({
  status = 'claimed',
  claim = claim,
})
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

export interface UnifiedInboundEmailQueueConfig {
  readyQueueKey: string;
  processingQueueKey: string;
  inflightHashKey: string;
  inflightLeaseKey: string;
  deadLetterQueueKey: string;
  maxAttempts: number;
  claimTtlMs: number;
  claimBlockSeconds: number;
}

export function getUnifiedInboundEmailQueueConfig(): UnifiedInboundEmailQueueConfig {
  return {
    readyQueueKey: (process.env.UNIFIED_INBOUND_EMAIL_QUEUE_KEY || '').trim() || DEFAULT_READY_QUEUE_KEY,
    processingQueueKey:
      (process.env.UNIFIED_INBOUND_EMAIL_PROCESSING_QUEUE_KEY || '').trim() ||
      DEFAULT_PROCESSING_QUEUE_KEY,
    inflightHashKey:
      (process.env.UNIFIED_INBOUND_EMAIL_INFLIGHT_HASH_KEY || '').trim() || DEFAULT_INFLIGHT_HASH_KEY,
    inflightLeaseKey:
      (process.env.UNIFIED_INBOUND_EMAIL_INFLIGHT_LEASE_KEY || '').trim() || DEFAULT_INFLIGHT_LEASE_KEY,
    deadLetterQueueKey:
      (process.env.UNIFIED_INBOUND_EMAIL_DLQ_KEY || '').trim() || DEFAULT_DLQ_QUEUE_KEY,
    maxAttempts: parsePositiveInteger(
      process.env.UNIFIED_INBOUND_EMAIL_QUEUE_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS
    ),
    claimTtlMs: parsePositiveInteger(
      process.env.UNIFIED_INBOUND_EMAIL_QUEUE_CLAIM_TTL_MS,
      DEFAULT_CLAIM_TTL_MS
    ),
    claimBlockSeconds: parsePositiveInteger(
      process.env.UNIFIED_INBOUND_EMAIL_QUEUE_BLOCK_SECONDS,
      DEFAULT_BLOCK_SECONDS
    ),
  };
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
      console.error('[UnifiedInboundEmailQueue] Redis client error:', error);
    });
    await client.connect();
    return client as RedisClientType;
  })();

  return redisClientPromise;
}

export type UnifiedInboundEmailQueueJobInput =
  | {
      tenantId: string;
      providerId: string;
      provider: 'microsoft';
      pointer: MicrosoftInboundEmailPointer;
      maxAttempts?: number;
    }
  | {
      tenantId: string;
      providerId: string;
      provider: 'google';
      pointer: GoogleInboundEmailPointer;
      maxAttempts?: number;
    }
  | {
      tenantId: string;
      providerId: string;
      provider: 'imap';
      pointer: ImapInboundEmailPointer;
      maxAttempts?: number;
    };

export interface EnqueueUnifiedInboundEmailQueueJobResult {
  job: UnifiedInboundEmailQueueJob;
  queueDepth: number;
}

export interface ClaimedUnifiedInboundEmailQueueJob {
  job: UnifiedInboundEmailQueueJob;
  originalPayload: string;
  consumerId: string;
  claimedAt: string;
  leaseExpiresAt: string;
}

export interface FailUnifiedInboundEmailQueueJobResult {
  action: 'retried' | 'dlq';
  attempt: number;
  queueDepth: number;
}

function getPointerLogFields(
  provider: UnifiedInboundEmailQueueJob['provider'],
  pointer: MicrosoftInboundEmailPointer | GoogleInboundEmailPointer | ImapInboundEmailPointer
): Record<string, string | number | null> {
  if (provider === 'microsoft') {
    const microsoftPointer = pointer as MicrosoftInboundEmailPointer;
    return {
      pointerMessageId: microsoftPointer.messageId,
      pointerSubscriptionId: microsoftPointer.subscriptionId,
      pointerResource: microsoftPointer.resource || null,
    };
  }

  if (provider === 'google') {
    const googlePointer = pointer as GoogleInboundEmailPointer;
    return {
      pointerHistoryId: googlePointer.historyId,
      pointerEmailAddress: googlePointer.emailAddress || null,
      pointerPubsubMessageId: googlePointer.pubsubMessageId || null,
    };
  }

  const imapPointer = pointer as ImapInboundEmailPointer;
  return {
    pointerUid: imapPointer.uid,
    pointerMailbox: imapPointer.mailbox,
    pointerUidValidity: imapPointer.uidValidity || null,
    pointerMessageId: imapPointer.messageId || null,
  };
}

function getJobLogFields(job: UnifiedInboundEmailQueueJob): Record<string, string | number | null> {
  return {
    jobId: job.jobId,
    provider: job.provider,
    tenantId: job.tenantId,
    providerId: job.providerId,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    ...getPointerLogFields(job.provider, job.pointer),
  };
}

function buildUnifiedInboundEmailQueueJob(
  input: UnifiedInboundEmailQueueJobInput
): UnifiedInboundEmailQueueJob {
  const queueConfig = getUnifiedInboundEmailQueueConfig();
  const maxAttempts =
    input.maxAttempts && input.maxAttempts > 0
      ? Math.floor(input.maxAttempts)
      : queueConfig.maxAttempts;
  const base = {
    jobId: randomUUID(),
    schemaVersion: 1 as const,
    tenantId: input.tenantId,
    providerId: input.providerId,
    enqueuedAt: new Date().toISOString(),
    attempt: 0,
    maxAttempts,
  };

  switch (input.provider) {
    case 'microsoft':
      return {
        ...base,
        provider: 'microsoft',
        pointer: input.pointer,
      };
    case 'google':
      return {
        ...base,
        provider: 'google',
        pointer: input.pointer,
      };
    case 'imap':
      return {
        ...base,
        provider: 'imap',
        pointer: input.pointer,
      };
    default:
      throw new Error(`Unsupported provider type: ${(input as any)?.provider}`);
  }
}

function parseClaimRecord(value: string): ClaimedUnifiedInboundEmailQueueJob | null {
  try {
    const parsed = JSON.parse(value) as ClaimedUnifiedInboundEmailQueueJob;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.job || typeof parsed.job !== 'object') return null;
    if (typeof parsed.originalPayload !== 'string') return null;
    if (typeof parsed.consumerId !== 'string') return null;
    if (typeof (parsed.job as any).jobId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

const FORBIDDEN_POINTER_PAYLOAD_KEYS = new Set([
  'emailData',
  'attachments',
  'rawMime',
  'rawMimeBase64',
  'sourceMimeBase64',
  'rawSourceBase64',
  'body',
  'content',
]);

function assertPointerOnlyPayload(input: UnifiedInboundEmailQueueJobInput): void {
  const inputAsAny = input as any;
  for (const key of Object.keys(inputAsAny)) {
    if (FORBIDDEN_POINTER_PAYLOAD_KEYS.has(key)) {
      throw new Error(`Queue payload must be pointer-only; forbidden field found: ${key}`);
    }
  }

  const stack: unknown[] = [input.pointer];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;

    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (FORBIDDEN_POINTER_PAYLOAD_KEYS.has(key)) {
        throw new Error(`Queue pointer payload must not contain field: ${key}`);
      }
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
}

export async function enqueueUnifiedInboundEmailQueueJob(
  input: UnifiedInboundEmailQueueJobInput
): Promise<EnqueueUnifiedInboundEmailQueueJobResult> {
  assertPointerOnlyPayload(input);
  const queueConfig = getUnifiedInboundEmailQueueConfig();
  const client = await getRedisClient();
  const job = buildUnifiedInboundEmailQueueJob(input);
  let queueDepth: number;
  try {
    queueDepth = await client.rPush(queueConfig.readyQueueKey, JSON.stringify(job));
  } catch (error: any) {
    console.error('[UnifiedInboundEmailQueue] enqueue_failed', {
      event: 'inbound_email_queue_enqueue_failed',
      ...getJobLogFields(job),
      error: error?.message || String(error),
    });
    throw error;
  }

  console.log('[UnifiedInboundEmailQueue] enqueue', {
    event: 'inbound_email_queue_enqueue',
    ...getJobLogFields(job),
    queueDepth,
  });

  return {
    job,
    queueDepth,
  };
}

export async function claimUnifiedInboundEmailQueueJob(params: {
  consumerId: string;
  blockSeconds?: number;
  claimTtlMs?: number;
}): Promise<ClaimedUnifiedInboundEmailQueueJob | null> {
  const queueConfig = getUnifiedInboundEmailQueueConfig();
  const client = await getRedisClient();
  const blockSeconds = Math.max(0, params.blockSeconds ?? queueConfig.claimBlockSeconds);
  const claimTtlMs = Math.max(1, params.claimTtlMs ?? queueConfig.claimTtlMs);
  const deadline = Date.now() + blockSeconds * 1000;
  let claimRecord: ClaimedUnifiedInboundEmailQueueJob | null = null;

  while (!claimRecord) {
    const now = Date.now();
    const claimedAt = new Date(now).toISOString();
    const leaseExpiresAt = new Date(now + claimTtlMs).toISOString();
    const failedAt = claimedAt;

    const rawResult = await (client as any).eval(CLAIM_JOB_LUA, {
      keys: [
        queueConfig.readyQueueKey,
        queueConfig.processingQueueKey,
        queueConfig.inflightHashKey,
        queueConfig.inflightLeaseKey,
        queueConfig.deadLetterQueueKey,
      ],
      arguments: [
        String(now),
        String(claimTtlMs),
        params.consumerId,
        claimedAt,
        leaseExpiresAt,
        failedAt,
      ],
    });

    const parsedResult = typeof rawResult === 'string' ? parseClaimRecord(rawResult) : null;
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
      // Backward compatibility if eval ever returns a direct claim payload.
      claimRecord = parsedResult;
      break;
    }

    if (!envelope || typeof envelope !== 'object') {
      if (Date.now() >= deadline) {
        return null;
      }
      await sleep(CLAIM_POLL_INTERVAL_MS);
      continue;
    }

    if ((envelope as any).status === 'empty') {
      if (Date.now() >= deadline) {
        return null;
      }
      await sleep(CLAIM_POLL_INTERVAL_MS);
      continue;
    }

    if ((envelope as any).status === 'invalid') {
      console.error('[UnifiedInboundEmailQueue] invalid_payload_dlq', {
        event: 'inbound_email_queue_invalid_payload_dlq',
        reason: 'invalid_queue_payload',
        payloadLength: Number((envelope as any).payloadLength || 0),
      });
      if (Date.now() >= deadline) {
        return null;
      }
      continue;
    }

    if ((envelope as any).status === 'claimed' && typeof (envelope as any).claim === 'string') {
      const parsedClaim = parseClaimRecord((envelope as any).claim);
      if (parsedClaim) {
        claimRecord = parsedClaim;
        break;
      }
    }

    if (Date.now() >= deadline) {
      return null;
    }
    await sleep(CLAIM_POLL_INTERVAL_MS);
  }

  console.log('[UnifiedInboundEmailQueue] consume_start', {
    event: 'inbound_email_queue_consume_start',
    ...getJobLogFields(claimRecord.job),
    consumerId: params.consumerId,
    claimTtlMs,
  });

  return claimRecord;
}

export async function ackUnifiedInboundEmailQueueJob(
  claim: ClaimedUnifiedInboundEmailQueueJob
): Promise<void> {
  const queueConfig = getUnifiedInboundEmailQueueConfig();
  const client = await getRedisClient();

  await client.multi()
    .lRem(queueConfig.processingQueueKey, 1, claim.originalPayload)
    .hDel(queueConfig.inflightHashKey, claim.job.jobId)
    .zRem(queueConfig.inflightLeaseKey, claim.job.jobId)
    .exec();

  console.log('[UnifiedInboundEmailQueue] ack', {
    event: 'inbound_email_queue_ack',
    ...getJobLogFields(claim.job),
    consumerId: claim.consumerId,
  });
}

export async function failUnifiedInboundEmailQueueJob(params: {
  claim: ClaimedUnifiedInboundEmailQueueJob;
  error: string;
}): Promise<FailUnifiedInboundEmailQueueJobResult> {
  const queueConfig = getUnifiedInboundEmailQueueConfig();
  const client = await getRedisClient();
  const nextAttempt = (params.claim.job.attempt || 0) + 1;
  const maxAttempts = params.claim.job.maxAttempts || queueConfig.maxAttempts;

  const retriedJob: UnifiedInboundEmailQueueJob = {
    ...params.claim.job,
    attempt: nextAttempt,
  };

  if (nextAttempt >= maxAttempts) {
    const execResult = await client.multi()
      .lRem(queueConfig.processingQueueKey, 1, params.claim.originalPayload)
      .hDel(queueConfig.inflightHashKey, params.claim.job.jobId)
      .zRem(queueConfig.inflightLeaseKey, params.claim.job.jobId)
      .rPush(
        queueConfig.deadLetterQueueKey,
        JSON.stringify({
          failedAt: new Date().toISOString(),
          reason: params.error,
          job: retriedJob,
        })
      )
      .exec();
    const queueDepthRaw = Array.isArray(execResult) ? execResult[execResult.length - 1] : null;
    const queueDepth = Number.isFinite(Number(queueDepthRaw)) ? Number(queueDepthRaw) : 0;
    console.error('[UnifiedInboundEmailQueue] dlq', {
      event: 'inbound_email_queue_dlq',
      ...getJobLogFields(retriedJob),
      attempt: nextAttempt,
      maxAttempts,
      queueDepth,
      reason: params.error,
      consumerId: params.claim.consumerId,
    });
    return {
      action: 'dlq',
      attempt: nextAttempt,
      queueDepth,
    };
  }

  const execResult = await client.multi()
    .lRem(queueConfig.processingQueueKey, 1, params.claim.originalPayload)
    .hDel(queueConfig.inflightHashKey, params.claim.job.jobId)
    .zRem(queueConfig.inflightLeaseKey, params.claim.job.jobId)
    .rPush(queueConfig.readyQueueKey, JSON.stringify(retriedJob))
    .exec();
  const queueDepthRaw = Array.isArray(execResult) ? execResult[execResult.length - 1] : null;
  const queueDepth = Number.isFinite(Number(queueDepthRaw)) ? Number(queueDepthRaw) : 0;
  console.warn('[UnifiedInboundEmailQueue] retry', {
    event: 'inbound_email_queue_retry',
    ...getJobLogFields(retriedJob),
    attempt: nextAttempt,
    maxAttempts,
    queueDepth,
    reason: params.error,
    consumerId: params.claim.consumerId,
  });
  return {
    action: 'retried',
    attempt: nextAttempt,
    queueDepth,
  };
}

export async function reclaimExpiredUnifiedInboundEmailQueueJobs(
  limit: number = 20
): Promise<number> {
  const queueConfig = getUnifiedInboundEmailQueueConfig();
  const client = await getRedisClient();
  const now = Date.now();
  const reclaimedJobIds = await client.zRangeByScore(
    queueConfig.inflightLeaseKey,
    0,
    now,
    { LIMIT: { offset: 0, count: Math.max(1, limit) } }
  );

  let reclaimed = 0;
  for (const jobId of reclaimedJobIds) {
    const claimRecordRaw = await client.hGet(queueConfig.inflightHashKey, jobId);
    if (!claimRecordRaw) {
      await client.zRem(queueConfig.inflightLeaseKey, jobId);
      continue;
    }

    const claimRecord = parseClaimRecord(claimRecordRaw);
    if (!claimRecord) {
      await client.multi()
        .hDel(queueConfig.inflightHashKey, jobId)
        .zRem(queueConfig.inflightLeaseKey, jobId)
        .exec();
      continue;
    }

    await client.multi()
      .lRem(queueConfig.processingQueueKey, 1, claimRecord.originalPayload)
      .hDel(queueConfig.inflightHashKey, jobId)
      .zRem(queueConfig.inflightLeaseKey, jobId)
      .rPush(queueConfig.readyQueueKey, claimRecord.originalPayload)
      .exec();
    console.warn('[UnifiedInboundEmailQueue] reclaim', {
      event: 'inbound_email_queue_reclaim',
      ...getJobLogFields(claimRecord.job),
      consumerId: claimRecord.consumerId,
      claimAgeMs: now - new Date(claimRecord.claimedAt).getTime(),
    });
    reclaimed += 1;
  }

  return reclaimed;
}
