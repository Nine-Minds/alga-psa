import { ApplicationFailure, Context } from '@temporalio/activity';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getRedisClient, getRedisConfig } from '@alga-psa/event-bus';
import {
  backoffDelayMs,
  parseCallControlMessage,
  parseParticipantEntity,
  THREECX_REMOVE,
  THREECX_UPSERT,
  ThreecxParticipantTracker,
  trimBaseUrl,
  type ThreecxCallEvent,
  type ThreecxParticipant,
} from './threecxCallControlEvents.js';

const THREECX_PROVIDER = '3cx';
const DEFAULT_SECRET_NAME = 'threecx-pbx-client-secret';

// Mirrors ee/packages/threecx/src/lib/pbx/token.ts: the PBX allows one live
// token per app, so the worker shares the server's Redis cache and lock.
const TOKEN_TTL_SAFETY_SECONDS = 60;
const LOCK_TTL_MS = 15_000;
const LOCK_WAIT_MS = 200;
const LOCK_WAIT_ROUNDS = 50;

export const THREECX_RUN_DURATION_MS = 60 * 60 * 1000;
export const THREECX_FAILURE_BUDGET_MS = 10 * 60 * 1000;
export const THREECX_HEARTBEAT_INTERVAL_MS = 15_000;

// ---------------------------------------------------------------------------
// Tenant config (tolerant re-implementation of parseThreecxConfig — the worker
// cannot import the src-consumed @alga-psa/ee-threecx package).
// ---------------------------------------------------------------------------

export interface ThreecxWorkerPbxConfig {
  baseUrl: string;
  clientId: string;
  clientSecretRef: string;
  /** DNs with a user mapping; only these can raise an incoming-call card. */
  mappedDns: Set<string>;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseThreecxWorkerConfig(raw: unknown): ThreecxWorkerPbxConfig | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const config = obj(value);
  const pbx = obj(config.pbx);
  const baseUrl = rewriteEmulatorHost(str(pbx.baseUrl));
  const clientId = str(pbx.clientId);
  if (!baseUrl || !clientId) return null;
  const mappedDns = new Set<string>();
  for (const item of Array.isArray(config.extensions) ? config.extensions : []) {
    const extension = obj(item);
    const dn = str(extension.dn);
    if (dn && str(extension.userId)) mappedDns.add(dn);
  }
  return { baseUrl, clientId, clientSecretRef: str(pbx.clientSecretRef) ?? DEFAULT_SECRET_NAME, mappedDns };
}

/**
 * The card stores the PBX address as the server sees it. In emulator mode the
 * emulator runs on the developer's host, which this containerised worker
 * reaches as `host.docker.internal`, never as `localhost`.
 */
export function rewriteEmulatorHost(baseUrl: string | null): string | null {
  if (!baseUrl) return baseUrl;
  const mode = process.env.THREECX_EMULATOR_MODE?.trim().toLowerCase();
  if (mode !== 'true' && mode !== '1') return baseUrl;
  const host = process.env.THREECX_EMULATOR_WORKER_HOST?.trim() || 'host.docker.internal';
  return baseUrl.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/i, `$1${host}`);
}

export async function loadThreecxRow(tenantId: string): Promise<{ provider_id: string; config: unknown } | undefined> {
  const { knex } = await createTenantKnex(tenantId);
  return tenantDb(knex, tenantId).table('telephony_providers').where({ provider: THREECX_PROVIDER }).first();
}

export async function markPbxError(tenantId: string, message: string): Promise<void> {
  const { knex } = await createTenantKnex(tenantId);
  const row = await loadThreecxRow(tenantId);
  if (!row) return;
  const config = typeof row.config === 'string' ? obj(JSON.parse(row.config)) : obj(row.config);
  const next = {
    ...config,
    pbx: { ...obj(config.pbx), status: 'error', lastError: message, lastCheckedAt: new Date().toISOString() },
  };
  await tenantDb(knex, tenantId)
    .table('telephony_providers')
    .where({ provider_id: row.provider_id })
    .update({ config: JSON.stringify(next), updated_at: knex.fn.now() });
}

// ---------------------------------------------------------------------------
// Shared PBX token cache
// ---------------------------------------------------------------------------

interface TokenStore {
  get(key: string): Promise<string | null>;
  setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  acquireLock(key: string, ttlMs: number): Promise<boolean>;
  releaseLock(key: string): Promise<void>;
}

class MemoryTokenStore implements TokenStore {
  private values = new Map<string, { value: string; expiresAt: number }>();
  private locks = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    const entry = this.values.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
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

type RedisLike = Awaited<ReturnType<typeof getRedisClient>>;

class RedisTokenStore implements TokenStore {
  constructor(private readonly client: RedisLike) {}

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
    return (await this.client.set(`${key}:lock`, '1', { NX: true, PX: ttlMs })) === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.client.del(`${key}:lock`);
  }
}

let tokenStorePromise: Promise<TokenStore> | null = null;

function tokenStore(): Promise<TokenStore> {
  if (!tokenStorePromise) {
    tokenStorePromise = getRedisClient()
      .then((client) => new RedisTokenStore(client))
      .catch((error) => {
        Context.current().log.warn('[3CX] Redis unavailable; PBX tokens cached in memory for this worker', {
          error: error instanceof Error ? error.message : String(error),
        });
        return new MemoryTokenStore();
      });
  }
  return tokenStorePromise;
}

function threecxTokenKey(tenantId: string): string {
  let prefix = 'alga-psa:';
  try {
    prefix = getRedisConfig().prefix ?? prefix;
  } catch {
    // config validation failure: fall back to the default prefix
  }
  return `${prefix}threecx:token:${tenantId}`;
}

export class ThreecxTokenError extends Error {
  constructor(message: string, public readonly status: number | null) {
    super(message);
    this.name = 'ThreecxTokenError';
  }
}

export interface PbxCredentials {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

async function requestToken(credentials: PbxCredentials): Promise<{ accessToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: 'client_credentials',
  });
  let response: Response;
  try {
    response = await fetch(`${trimBaseUrl(credentials.baseUrl)}/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
  } catch (error) {
    throw new ThreecxTokenError(`Could not reach the PBX: ${error instanceof Error ? error.message : String(error)}`, null);
  }
  if (!response.ok) {
    throw new ThreecxTokenError(`The PBX refused the credentials (${response.status})`, response.status);
  }
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const accessToken = payload && typeof payload.access_token === 'string' ? payload.access_token : null;
  if (!accessToken) throw new ThreecxTokenError('The PBX token response carried no access_token.', response.status);
  const expiresIn = payload && typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
  return { accessToken, expiresIn };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getSharedAccessToken(tenantId: string, credentials: PbxCredentials, force: boolean): Promise<string> {
  const store = await tokenStore();
  const key = threecxTokenKey(tenantId);
  if (force) {
    await store.del(key);
  } else {
    const cached = await store.get(key);
    if (cached) return cached;
  }
  for (let round = 0; round < LOCK_WAIT_ROUNDS; round += 1) {
    if (await store.acquireLock(key, LOCK_TTL_MS)) {
      try {
        const again = await store.get(key);
        if (again && !force) return again;
        const token = await requestToken(credentials);
        await store.setWithTtl(key, token.accessToken, Math.max(30, token.expiresIn - TOKEN_TTL_SAFETY_SECONDS));
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

// ---------------------------------------------------------------------------
// Socket session (dependency-injected so it runs under test without ws/Redis/DB)
// ---------------------------------------------------------------------------

export interface CallControlSocket {
  on(event: 'open', listener: () => void): unknown;
  on(event: 'message', listener: (data: unknown) => void): unknown;
  on(event: 'close', listener: (code: number, reason?: unknown) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(
    event: 'unexpected-response',
    listener: (request: { destroy?: () => void; abort?: () => void }, response: { statusCode?: number }) => void,
  ): unknown;
  close(): void;
  terminate(): void;
}

export interface ThreecxSessionLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface ThreecxSessionDeps {
  tenantId: string;
  mappedDns: Set<string>;
  getToken(force: boolean): Promise<string>;
  openSocket(token: string): CallControlSocket;
  fetchParticipant(entity: string, token: string): Promise<{ status: number; body: unknown }>;
  forward(event: ThreecxCallEvent): Promise<void>;
  heartbeat(): void;
  /** Rejects when Temporal cancels the activity. */
  cancelled: Promise<never>;
  onPersistentFailure(message: string): Promise<void>;
  log: ThreecxSessionLogger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  runDurationMs?: number;
  failureBudgetMs?: number;
  heartbeatIntervalMs?: number;
}

function decodeSocketData(data: unknown): unknown {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data.filter(Buffer.isBuffer)).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data;
}

export interface ThreecxSessionResult {
  reason: 'deadline' | 'cancelled';
  forwarded: number;
  connections: number;
}

export async function runThreecxCallControlSession(deps: ThreecxSessionDeps): Promise<ThreecxSessionResult> {
  const now = deps.now ?? (() => Date.now());
  const runDurationMs = deps.runDurationMs ?? THREECX_RUN_DURATION_MS;
  const failureBudgetMs = deps.failureBudgetMs ?? THREECX_FAILURE_BUDGET_MS;
  const deadline = now() + runDurationMs;
  const tracker = new ThreecxParticipantTracker();

  let cancelled = false;
  const live: { socket: CallControlSocket | null } = { socket: null };
  let wake: (() => void) | null = null;
  let forwarded = 0;
  let connections = 0;
  let attempt = 0;
  let failingSince: number | null = null;
  let forceToken = false;

  deps.cancelled.catch(() => {
    cancelled = true;
    live.socket?.close();
    wake?.();
  });

  const pause = (ms: number): Promise<void> => {
    if (deps.sleep) return deps.sleep(ms);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        wake = null;
        resolve();
      }, ms);
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
    });
  };

  const noteFailure = async (message: string): Promise<void> => {
    failingSince ??= now();
    deps.log.warn('[3CX] Call Control connection failed', { tenantId: deps.tenantId, attempt, message });
    if (now() - failingSince >= failureBudgetMs) {
      await deps.onPersistentFailure(message);
      throw ApplicationFailure.create({ message: `3CX Call Control unreachable for 10 minutes: ${message}` });
    }
  };

  const emit = async (event: ThreecxCallEvent | null): Promise<void> => {
    if (!event) return;
    try {
      await deps.forward(event);
      forwarded += 1;
    } catch (error) {
      deps.log.error('[3CX] Failed to forward call event', {
        tenantId: deps.tenantId,
        kind: event.kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleMessage = async (raw: unknown, token: () => string, setToken: (next: string) => void): Promise<void> => {
    const message = parseCallControlMessage(decodeSocketData(raw));
    if (!message) return;
    const ref = parseParticipantEntity(message.entity);
    if (!ref) return;
    if (message.eventType === THREECX_REMOVE) {
      await emit(tracker.applyRemove(ref));
      return;
    }
    if (message.eventType !== THREECX_UPSERT || !deps.mappedDns.has(ref.dn)) return;

    let response = await deps.fetchParticipant(message.entity, token());
    if (response.status === 401) {
      setToken(await deps.getToken(true));
      response = await deps.fetchParticipant(message.entity, token());
    }
    if (response.status < 200 || response.status >= 300) {
      deps.log.warn('[3CX] Participant fetch failed', { tenantId: deps.tenantId, entity: message.entity, status: response.status });
      return;
    }
    await emit(
      tracker.applyUpsert({
        sequence: message.sequence,
        dn: ref.dn,
        participantId: ref.participantId,
        participant: obj(response.body) as ThreecxParticipant,
        mappedDns: deps.mappedDns,
      }),
    );
  };

  const connectOnce = (initialToken: string): Promise<{ opened: boolean; unauthorized: boolean; error: string }> =>
    new Promise((resolve) => {
      let token = initialToken;
      let opened = false;
      let unauthorized = false;
      let lastError = '';
      let settled = false;
      let chain: Promise<void> = Promise.resolve();
      const socket = deps.openSocket(token);
      live.socket = socket;

      const finish = (error: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadlineTimer);
        live.socket = null;
        resolve({ opened, unauthorized, error });
      };
      const deadlineTimer = setTimeout(() => socket.close(), Math.max(0, deadline - now()));
      if (cancelled) socket.close();

      socket.on('open', () => {
        opened = true;
        connections += 1;
        attempt = 0;
        failingSince = null;
        deps.log.info('[3CX] Call Control socket open', { tenantId: deps.tenantId, mappedDns: deps.mappedDns.size });
      });
      socket.on('unexpected-response', (request, response) => {
        unauthorized = response.statusCode === 401;
        lastError = `handshake rejected (${response.statusCode ?? 'unknown'})`;
        request.destroy?.();
        request.abort?.();
        finish(lastError);
      });
      socket.on('error', (error) => {
        lastError = error.message;
      });
      socket.on('close', (code) => finish(lastError || `socket closed (${code})`));
      socket.on('message', (data) => {
        chain = chain
          .then(() => handleMessage(data, () => token, (next) => (token = next)))
          .catch((error) => {
            deps.log.warn('[3CX] Call Control message handling failed', {
              tenantId: deps.tenantId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      });
    });

  const heartbeatTimer = setInterval(() => deps.heartbeat(), deps.heartbeatIntervalMs ?? THREECX_HEARTBEAT_INTERVAL_MS);
  deps.heartbeat();

  try {
    while (!cancelled && now() < deadline) {
      let token: string;
      try {
        token = await deps.getToken(forceToken);
        forceToken = false;
      } catch (error) {
        if (error instanceof ThreecxTokenError && error.status === 401) forceToken = true;
        await noteFailure(error instanceof Error ? error.message : String(error));
        attempt += 1;
        await pause(backoffDelayMs(attempt));
        continue;
      }

      const outcome = await connectOnce(token);
      if (cancelled || now() >= deadline) break;
      if (outcome.unauthorized) forceToken = true;
      if (!outcome.opened) await noteFailure(outcome.error);
      else deps.log.warn('[3CX] Call Control socket closed; reconnecting', { tenantId: deps.tenantId, error: outcome.error });
      attempt += 1;
      await pause(backoffDelayMs(attempt));
    }
  } finally {
    clearInterval(heartbeatTimer);
    live.socket?.close();
  }

  return { reason: cancelled ? 'cancelled' : 'deadline', forwarded, connections };
}
