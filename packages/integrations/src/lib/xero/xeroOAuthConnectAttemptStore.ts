import { createClient, type RedisClientType } from 'redis';
import { createHash } from 'crypto';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getRedisConfig } from '@alga-psa/event-bus';

// LEVERAGE: pattern redis-backed-oauth-state-store — same Redis client +
// in-memory fallback shape as microsoftEmailSetupStateStore, microsoftEmailOAuthStateStore,
// and calendar/oauthStateStore. Not shared: each store carries its own namespace, payload
// type, and TTL, and this one intentionally improves the consume path to Redis GETDEL
// (atomic single-use) rather than the read-then-delete the calendar store uses.
//
// Single-use, short-lived server-side record for a Xero OAuth connect attempt.
//
// The public `state` parameter sent through the browser is an opaque 256-bit
// nonce; everything confidential (the PKCE code_verifier) and every binding
// (tenant, initiating user, provider, redirect URI, double-submit CSRF token)
// lives in this record, keyed by the SHA-256 of that nonce. The callback
// atomically consumes the record (Redis GETDEL — a single delete-returning
// statement) before any token exchange, so a state can complete exactly once.
//
// Redis-backed with an in-memory fallback, mirroring the Microsoft email OAuth
// state stores. TTL expiry is a cleanup convenience only: consumers must check
// the embedded `expiresAt` at consume time, never rely on a sweeper.

const STATE_NAMESPACE = 'xero:connect_attempt';
const DEFAULT_TTL_SECONDS = 10 * 60;

export const XERO_CONNECT_ATTEMPT_TTL_SECONDS = DEFAULT_TTL_SECONDS;
export const XERO_CONNECT_ATTEMPT_PROVIDER = 'xero' as const;

export interface XeroConnectAttempt {
  /** Encrypted PKCE code_verifier (`enc:` + AES-256-GCM payload). */
  verifier: string;
  tenantId: string;
  userId: string;
  provider: typeof XERO_CONNECT_ATTEMPT_PROVIDER;
  redirectUri: string;
  /** Double-submit CSRF token; also set in the HttpOnly callback cookie. */
  csrf: string;
  createdAt: number;
  expiresAt: number;
}

let redisClientPromise: Promise<RedisClientType | null> | null = null;
const memoryStore = new Map<string, { attempt: XeroConnectAttempt; expiresAt: number }>();

async function getRedisClient(): Promise<RedisClientType | null> {
  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      try {
        const config = getRedisConfig();
        const secretProvider = await getSecretProviderInstance();
        const password =
          (await secretProvider.getAppSecret('redis_password')) ||
          process.env.REDIS_PASSWORD ||
          undefined;
        const client = createClient({ url: config.url, password });
        client.on('error', (error) => {
          logger.error('[XeroConnectAttemptStore] Redis client error', error);
        });
        await client.connect();
        return client as RedisClientType;
      } catch (error) {
        logger.error('[XeroConnectAttemptStore] Failed to create Redis client', error);
        return null;
      }
    })();
  }

  return redisClientPromise;
}

export function hashXeroConnectNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

function buildKey(nonce: string): string {
  return `${STATE_NAMESPACE}:${hashXeroConnectNonce(nonce)}`;
}

export async function storeXeroConnectAttempt(
  nonce: string,
  attempt: XeroConnectAttempt,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
  const key = buildKey(nonce);
  try {
    const client = await getRedisClient();
    if (client) {
      await client.set(key, JSON.stringify(attempt), { EX: ttlSeconds });
      return;
    }
  } catch (error) {
    logger.warn(
      '[XeroConnectAttemptStore] Falling back to in-memory attempt storage',
      error instanceof Error ? error.message : error
    );
  }

  memoryStore.set(key, {
    attempt,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Atomically consume the attempt bound to a nonce. Returns the record exactly
 * once; a replayed, unknown, or never-stored nonce returns `null`. In-memory
 * fallback deletes in the same synchronous step (single event-loop tick).
 */
export async function consumeXeroConnectAttempt(
  nonce: string,
  opts: { now?: number } = {}
): Promise<XeroConnectAttempt | null> {
  const key = buildKey(nonce);
  const now = opts.now ?? Date.now();

  try {
    const client = await getRedisClient();
    if (client) {
      const raw = await client.getDel(key);
      if (raw) {
        try {
          return JSON.parse(raw) as XeroConnectAttempt;
        } catch (error) {
          logger.error('[XeroConnectAttemptStore] Failed to parse stored attempt', error);
          return null;
        }
      }
    }
  } catch (error) {
    logger.warn(
      '[XeroConnectAttemptStore] Redis unavailable while consuming attempt',
      error instanceof Error ? error.message : error
    );
  }

  const stored = memoryStore.get(key);
  if (!stored) {
    return null;
  }
  memoryStore.delete(key);
  if (stored.expiresAt <= now) {
    return null;
  }
  return stored.attempt;
}

/**
 * Test support: reset the singleton Redis handle and the in-memory fallback so
 * suites start from a clean slate. Never called from application code.
 */
export function _resetXeroConnectAttemptStoreForTests(): void {
  memoryStore.clear();
  redisClientPromise = null;
}

/**
 * Test support: return the stored attempt for a nonce without consuming it, so
 * behavioral tests can prove which verifier/bindings the connect route recorded
 * for the opaque state it produced. Returns `null` when the in-memory fallback
 * holds no record for the nonce. Never called from application code.
 */
export function _peekXeroConnectAttemptForTests(nonce: string): XeroConnectAttempt | null {
  const stored = memoryStore.get(buildKey(nonce));
  return stored ? stored.attempt : null;
}
