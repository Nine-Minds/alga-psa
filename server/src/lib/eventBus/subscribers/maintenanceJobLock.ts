import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import logger from '@alga-psa/core/logger';
import { getRedisClient } from '@/config/redisConfig';

// One run per maintenance job at a time, cluster-wide. Temporal re-emits on
// schedule whether or not the previous run finished, and the event bus reclaims
// a message idle for 30 s, so a slow fan-out would otherwise be run twice.
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const KEY_PREFIX = 'alga:maintenance-job-lock:';
const RELEASE_IF_OWNER = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0';

export interface MaintenanceLockClient {
  set(key: string, value: string, options: { NX: true; PX: number }): Promise<string | null>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

export interface MaintenanceJobLock {
  release(): Promise<void>;
}

let clientPromise: Promise<MaintenanceLockClient> | null = null;

async function defaultClient(): Promise<MaintenanceLockClient> {
  if (!clientPromise) {
    clientPromise = (getRedisClient() as Promise<MaintenanceLockClient>).catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

const noopLock: MaintenanceJobLock = { release: async () => undefined };

// Returns null when another run of this job currently holds the lock. Redis
// trouble fails open: the event bus itself needs Redis, so this is rare, and
// a duplicate run beats a maintenance blackout.
export async function acquireMaintenanceJobLock(
  jobName: string,
  options: { ttlMs?: number; client?: MaintenanceLockClient } = {},
): Promise<MaintenanceJobLock | null> {
  const key = `${KEY_PREFIX}${jobName}`;
  const owner = `${hostname()}:${process.pid}:${randomUUID()}`;
  let client: MaintenanceLockClient;
  try {
    client = options.client ?? (await defaultClient());
    const result = await client.set(key, owner, { NX: true, PX: options.ttlMs ?? DEFAULT_TTL_MS });
    if (result !== 'OK') {
      return null;
    }
  } catch (error) {
    logger.warn('[MaintenanceJobLock] Lock unavailable, running without it', {
      jobName,
      error: error instanceof Error ? error.message : String(error),
    });
    return noopLock;
  }
  return {
    release: async () => {
      try {
        await client.eval(RELEASE_IF_OWNER, { keys: [key], arguments: [owner] });
      } catch (error) {
        logger.warn('[MaintenanceJobLock] Release failed; the lock expires on its own', {
          jobName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
