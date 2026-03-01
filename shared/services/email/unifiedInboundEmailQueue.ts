import { randomUUID } from 'crypto';
import { createClient, type RedisClientType } from 'redis';
import { getSecret } from '@alga-psa/core/secrets';
import type {
  GoogleInboundEmailPointer,
  ImapInboundEmailPointer,
  MicrosoftInboundEmailPointer,
  UnifiedInboundEmailQueueJob,
} from '../../interfaces/inbound-email.interfaces';

const DEFAULT_QUEUE_KEY = 'email:inbound:unified:pointer:ready';
const DEFAULT_MAX_ATTEMPTS = 5;

let redisClientPromise: Promise<RedisClientType> | null = null;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function getUnifiedInboundEmailQueueConfig(): {
  queueKey: string;
  maxAttempts: number;
} {
  return {
    queueKey: (process.env.UNIFIED_INBOUND_EMAIL_QUEUE_KEY || '').trim() || DEFAULT_QUEUE_KEY,
    maxAttempts: parsePositiveInteger(
      process.env.UNIFIED_INBOUND_EMAIL_QUEUE_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS
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

export async function enqueueUnifiedInboundEmailQueueJob(
  input: UnifiedInboundEmailQueueJobInput
): Promise<EnqueueUnifiedInboundEmailQueueJobResult> {
  const queueConfig = getUnifiedInboundEmailQueueConfig();
  const client = await getRedisClient();
  const job = buildUnifiedInboundEmailQueueJob(input);
  const queueDepth = await client.rPush(queueConfig.queueKey, JSON.stringify(job));

  return {
    job,
    queueDepth,
  };
}
