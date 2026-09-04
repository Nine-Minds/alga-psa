/**
 * Single-use OAuth state store for the QuickBooks Online and Xero connect
 * flows.
 *
 * A callback must atomically consume the state issued by the connect route so
 * the same signed state cannot be replayed to complete a second connection.
 * Consuming is an atomic delete: exactly one callback presentation wins, and
 * every later presentation fails closed. Redis-backed with an in-memory
 * fallback, mirroring the Microsoft email and calendar OAuth state stores.
 *
 * The server-side record also carries tenant and initiation-time provenance.
 * Disconnect initiation can therefore invalidate every outstanding flow for a
 * tenant/provider, while callbacks get a trusted timestamp that cannot be
 * advanced by editing provider-returned state.
 */

import { createClient, type RedisClientType } from 'redis';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getRedisConfig } from '@alga-psa/event-bus';

export type AccountingOAuthProvider = 'qbo' | 'xero';

const STATE_NAMESPACE = 'accounting:oauth';
const DEFAULT_TTL_SECONDS = 10 * 60;

let redisClientPromise: Promise<RedisClientType | null> | null = null;
export interface AccountingOAuthStateRecord {
  tenantId: string;
  initiatedAt: string;
}

interface StoredAccountingOAuthState extends AccountingOAuthStateRecord {
  expiresAt: number;
}

const memoryStore = new Map<string, StoredAccountingOAuthState>();

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
          logger.error('[AccountingOAuthStateStore] Redis client error', error);
        });
        await client.connect();
        return client as RedisClientType;
      } catch (error) {
        logger.error('[AccountingOAuthStateStore] Failed to create Redis client', error);
        return null;
      }
    })();
  }

  return redisClientPromise;
}

function buildKey(provider: AccountingOAuthProvider, nonce: string): string {
  return `${STATE_NAMESPACE}:${provider}:${nonce}`;
}

function buildTenantIndexKey(provider: AccountingOAuthProvider, tenantId: string): string {
  return `${STATE_NAMESPACE}:${provider}:tenant:${tenantId}`;
}

function parseRecord(value: string | null): AccountingOAuthStateRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<AccountingOAuthStateRecord>;
    if (typeof parsed.tenantId !== 'string' || typeof parsed.initiatedAt !== 'string') {
      return null;
    }
    if (!Number.isFinite(Date.parse(parsed.initiatedAt))) return null;
    return { tenantId: parsed.tenantId, initiatedAt: parsed.initiatedAt };
  } catch {
    return null;
  }
}

export async function storeAccountingOAuthNonce(
  provider: AccountingOAuthProvider,
  nonce: string,
  record: AccountingOAuthStateRecord,
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<void> {
  const key = buildKey(provider, nonce);
  const indexKey = buildTenantIndexKey(provider, record.tenantId);
  if (!Number.isFinite(Date.parse(record.initiatedAt))) {
    throw new Error('Accounting OAuth state requires a valid initiation timestamp.');
  }
  try {
    const client = await getRedisClient();
    if (client) {
      await client
        .multi()
        .set(key, JSON.stringify(record), { EX: ttlSeconds })
        .sAdd(indexKey, nonce)
        .expire(indexKey, ttlSeconds)
        .exec();
      return;
    }
  } catch (error) {
    logger.warn(
      '[AccountingOAuthStateStore] Falling back to in-memory nonce storage',
      error instanceof Error ? error.message : error
    );
  }

  memoryStore.set(key, {
    ...record,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Atomically mark a state as used. Returns `true` only on the first successful
 * consume; a replayed state (second use of the same nonce) returns `false`, as
 * does an unknown or expired nonce.
 */
export async function consumeAccountingOAuthNonce(
  provider: AccountingOAuthProvider,
  nonce: string
): Promise<AccountingOAuthStateRecord | null> {
  const key = buildKey(provider, nonce);
  try {
    const client = await getRedisClient();
    if (client) {
      const value = await client.getDel(key);
      const record = parseRecord(value);
      if (record) {
        await client.sRem(buildTenantIndexKey(provider, record.tenantId), nonce);
      }
      return record;
    }
  } catch (error) {
    logger.warn(
      '[AccountingOAuthStateStore] Redis unavailable while consuming nonce',
      error instanceof Error ? error.message : error
    );
  }

  const stored = memoryStore.get(key);
  memoryStore.delete(key);
  if (!stored || stored.expiresAt <= Date.now()) return null;
  return { tenantId: stored.tenantId, initiatedAt: stored.initiatedAt };
}

/** Invalidates every unconsumed authorization flow for one tenant/provider. */
export async function invalidateAccountingOAuthStates(
  provider: AccountingOAuthProvider,
  tenantId: string
): Promise<void> {
  const indexKey = buildTenantIndexKey(provider, tenantId);
  try {
    const client = await getRedisClient();
    if (client) {
      const nonces = await client.sMembers(indexKey);
      const keys = nonces.map((nonce) => buildKey(provider, nonce));
      if (keys.length > 0) await client.del(keys);
      await client.del(indexKey);
    }
  } catch (error) {
    logger.warn(
      '[AccountingOAuthStateStore] Redis unavailable while invalidating tenant states',
      error instanceof Error ? error.message : error
    );
  }

  const prefix = `${STATE_NAMESPACE}:${provider}:`;
  for (const [key, stored] of memoryStore) {
    if (key.startsWith(prefix) && stored.tenantId === tenantId) {
      memoryStore.delete(key);
    }
  }
}
