import { createClient, type RedisClientType } from 'redis';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getRedisConfig } from '@alga-psa/event-bus';
import { getThreecxProviderConfig } from '../providerState';

export const THREECX_PBX_SECRET_NAME = 'threecx-pbx-client-secret';

/** Seconds shaved off the PBX lifetime so a cached token never expires mid-call. */
const TOKEN_TTL_SAFETY_SECONDS = 60;
const LOCK_TTL_MS = 15_000;
const LOCK_WAIT_MS = 200;
const LOCK_WAIT_ROUNDS = 50;

export interface ThreecxTokenStore {
  get(key: string): Promise<string | null>;
  setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Returns true when this caller now holds the lock. */
  acquireLock(key: string, ttlMs: number): Promise<boolean>;
  releaseLock(key: string): Promise<void>;
}

export class ThreecxTokenError extends Error {
  constructor(message: string, public readonly status: number | null) {
    super(message);
    this.name = 'ThreecxTokenError';
  }
}

/** The PBX allows one live token per API app, so every process shares this cache. */
export function threecxTokenKey(tenantId: string): string {
  const prefix = safePrefix();
  return `${prefix}threecx:token:${tenantId}`;
}

function safePrefix(): string {
  try {
    return getRedisConfig().prefix ?? 'alga-psa:';
  } catch {
    return 'alga-psa:';
  }
}

class MemoryTokenStore implements ThreecxTokenStore {
  private values = new Map<string, { value: string; expiresAt: number }>();
  private locks = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }

  async setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
  }

  async acquireLock(key: string, ttlMs: number): Promise<boolean> {
    const until = this.locks.get(key);
    if (until && until > Date.now()) return false;
    this.locks.set(key, Date.now() + ttlMs);
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    this.locks.delete(key);
  }
}

class RedisTokenStore implements ThreecxTokenStore {
  constructor(private readonly client: RedisClientType) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, { EX: Math.max(1, Math.floor(ttlSeconds)) });
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async acquireLock(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.client.set(`${key}:lock`, '1', { NX: true, PX: ttlMs });
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.client.del(`${key}:lock`);
  }
}

let storePromise: Promise<ThreecxTokenStore> | null = null;
let storeOverride: ThreecxTokenStore | null = null;

/** Tests and single-process tools inject a store; everything else shares Redis. */
export function setThreecxTokenStore(store: ThreecxTokenStore | null): void {
  storeOverride = store;
}

async function defaultStore(): Promise<ThreecxTokenStore> {
  if (storeOverride) return storeOverride;
  if (!storePromise) {
    storePromise = (async () => {
      try {
        const config = getRedisConfig();
        const secretProvider = await getSecretProviderInstance();
        const password =
          (await secretProvider.getAppSecret('redis_password')) || process.env.REDIS_PASSWORD || undefined;
        const client = createClient({ url: config.url, password });
        client.on('error', (error) => {
          logger.error('[3CX] Redis token store error', error);
        });
        await client.connect();
        return new RedisTokenStore(client as RedisClientType);
      } catch (error) {
        logger.warn('[3CX] Redis unavailable; PBX tokens are cached in memory for this process', {
          error: error instanceof Error ? error.message : String(error),
        });
        return new MemoryTokenStore();
      }
    })();
  }
  return storePromise;
}

export interface ThreecxTokenResponse {
  accessToken: string;
  expiresIn: number;
}

export interface ThreecxPbxCredentials {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export type ThreecxFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function trimBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/**
 * `POST /connect/token` with client credentials. The 3CX docs call for a
 * form-encoded body; both the SDK and the examples send the same three fields.
 */
export async function requestThreecxToken(
  credentials: ThreecxPbxCredentials,
  fetchImpl: ThreecxFetch = fetch,
): Promise<ThreecxTokenResponse> {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: 'client_credentials',
  });
  let response: Response;
  try {
    response = await fetchImpl(`${trimBaseUrl(credentials.baseUrl)}/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
  } catch (error) {
    throw new ThreecxTokenError(
      `Could not reach the PBX: ${error instanceof Error ? error.message : String(error)}`,
      null,
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ThreecxTokenError(
      `The PBX refused the credentials (${response.status})${text ? `: ${text.slice(0, 200)}` : ''}`,
      response.status,
    );
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const accessToken = payload && typeof payload.access_token === 'string' ? payload.access_token : null;
  const expiresIn = payload && typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
  if (!accessToken) {
    throw new ThreecxTokenError('The PBX token response carried no access_token.', response.status);
  }
  return { accessToken, expiresIn };
}

export async function resolveThreecxPbxCredentials(tenantId: string): Promise<ThreecxPbxCredentials | null> {
  const loaded = await getThreecxProviderConfig(tenantId);
  const pbx = loaded?.config.pbx;
  if (!pbx?.baseUrl || !pbx.clientId || !pbx.clientSecretRef) return null;
  const secretProvider = await getSecretProviderInstance();
  const clientSecret = await secretProvider.getTenantSecret(tenantId, pbx.clientSecretRef);
  if (!clientSecret) return null;
  return { baseUrl: pbx.baseUrl, clientId: pbx.clientId, clientSecret };
}

export interface GetThreecxAccessTokenOptions {
  force?: boolean;
  credentials?: ThreecxPbxCredentials;
  fetchImpl?: ThreecxFetch;
  store?: ThreecxTokenStore;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cached bearer token for the tenant's PBX app. A miss refreshes under a
 * short lock so concurrent callers (server replicas, the Temporal worker)
 * produce one token request instead of racing the PBX's single-token rule.
 */
export async function getThreecxAccessToken(
  tenantId: string,
  options: GetThreecxAccessTokenOptions = {},
): Promise<string> {
  const store = options.store ?? (await defaultStore());
  const key = threecxTokenKey(tenantId);

  if (!options.force) {
    const cached = await store.get(key);
    if (cached) return cached;
  } else {
    await store.del(key);
  }

  const credentials = options.credentials ?? (await resolveThreecxPbxCredentials(tenantId));
  if (!credentials) {
    throw new ThreecxTokenError('The PBX API credentials are not configured.', null);
  }

  for (let round = 0; round < LOCK_WAIT_ROUNDS; round += 1) {
    if (await store.acquireLock(key, LOCK_TTL_MS)) {
      try {
        const again = await store.get(key);
        if (again && !options.force) return again;
        const token = await requestThreecxToken(credentials, options.fetchImpl);
        const ttl = Math.max(30, token.expiresIn - TOKEN_TTL_SAFETY_SECONDS);
        await store.setWithTtl(key, token.accessToken, ttl);
        return token.accessToken;
      } finally {
        await store.releaseLock(key);
      }
    }
    await sleep(LOCK_WAIT_MS);
    const raced = await store.get(key);
    if (raced) return raced;
  }
  throw new ThreecxTokenError('Timed out waiting for another process to refresh the PBX token.', null);
}

export async function invalidateThreecxToken(tenantId: string, store?: ThreecxTokenStore): Promise<void> {
  const target = store ?? (await defaultStore());
  await target.del(threecxTokenKey(tenantId));
}
