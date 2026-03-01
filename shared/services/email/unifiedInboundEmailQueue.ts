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

let redisClientPromise: Promise<RedisClientType> | null = null;

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
    return JSON.parse(value) as ClaimedUnifiedInboundEmailQueueJob;
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
  const queueDepth = await client.rPush(queueConfig.readyQueueKey, JSON.stringify(job));

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

  const payload = await client.brPopLPush(
    queueConfig.readyQueueKey,
    queueConfig.processingQueueKey,
    blockSeconds
  );
  if (!payload) {
    return null;
  }

  let job: UnifiedInboundEmailQueueJob;
  try {
    job = JSON.parse(payload) as UnifiedInboundEmailQueueJob;
  } catch {
    // Poison message path: move bad payload to DLQ and drop from processing queue.
    await client.multi()
      .lRem(queueConfig.processingQueueKey, 1, payload)
      .rPush(
        queueConfig.deadLetterQueueKey,
        JSON.stringify({
          failedAt: new Date().toISOString(),
          reason: 'invalid_queue_payload',
          rawPayload: payload,
        })
      )
      .exec();
    return null;
  }

  const now = Date.now();
  const claimRecord: ClaimedUnifiedInboundEmailQueueJob = {
    job,
    originalPayload: payload,
    consumerId: params.consumerId,
    claimedAt: new Date(now).toISOString(),
    leaseExpiresAt: new Date(now + claimTtlMs).toISOString(),
  };

  await client.multi()
    .hSet(queueConfig.inflightHashKey, job.jobId, JSON.stringify(claimRecord))
    .zAdd(queueConfig.inflightLeaseKey, {
      score: now + claimTtlMs,
      value: job.jobId,
    })
    .exec();

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
}

export async function failUnifiedInboundEmailQueueJob(params: {
  claim: ClaimedUnifiedInboundEmailQueueJob;
  error: string;
}): Promise<FailUnifiedInboundEmailQueueJobResult> {
  const queueConfig = getUnifiedInboundEmailQueueConfig();
  const client = await getRedisClient();
  const nextAttempt = (params.claim.job.attempt || 0) + 1;
  const maxAttempts = params.claim.job.maxAttempts || queueConfig.maxAttempts;

  await client.multi()
    .lRem(queueConfig.processingQueueKey, 1, params.claim.originalPayload)
    .hDel(queueConfig.inflightHashKey, params.claim.job.jobId)
    .zRem(queueConfig.inflightLeaseKey, params.claim.job.jobId)
    .exec();

  const retriedJob: UnifiedInboundEmailQueueJob = {
    ...params.claim.job,
    attempt: nextAttempt,
  };

  if (nextAttempt >= maxAttempts) {
    const queueDepth = await client.rPush(
      queueConfig.deadLetterQueueKey,
      JSON.stringify({
        failedAt: new Date().toISOString(),
        reason: params.error,
        job: retriedJob,
      })
    );
    return {
      action: 'dlq',
      attempt: nextAttempt,
      queueDepth,
    };
  }

  const queueDepth = await client.rPush(queueConfig.readyQueueKey, JSON.stringify(retriedJob));
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
    reclaimed += 1;
  }

  return reclaimed;
}
