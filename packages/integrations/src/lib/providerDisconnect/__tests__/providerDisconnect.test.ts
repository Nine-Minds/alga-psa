import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

/**
 * Behavioral suite for the durable provider-disconnect state machine (Xero +
 * QuickBooks Online). Fakes live at the HTTP-client seam (axios) and the DB /
 * secrets seams, so the tests drive the real service, repository, revoker and
 * status code and assert on observable state: the fake provider call log, the
 * in-memory `provider_disconnect_records` rows, the retry schedule, the audit
 * trail, and the credential gate on the ordinary sync/export load path.
 */

// ── In-memory tenantDb store ────────────────────────────────────────────────
const fakeDb = vi.hoisted(() => {
  type Row = Record<string, any>;
  const tables: Record<string, Row[]> = {
    provider_disconnect_records: [],
    audit_logs: [],
  };
  const reset = () => {
    tables.provider_disconnect_records = [];
    tables.audit_logs = [];
  };
  return { tables, reset };
});

type Cond = (row: Record<string, any>) => boolean;

class MemQuery {
  private rows: Record<string, any>[];
  private conds: Cond[];

  constructor(rows: Record<string, any>[]) {
    this.rows = rows;
    this.conds = [];
  }

  where(a: unknown, b?: unknown, c?: unknown): MemQuery {
    if (typeof a === 'function') {
      const sub = new MemQuery(this.rows);
      (a as (qb: MemQuery) => void)(sub);
      // Group conditions are OR'd (mirrors `where(fn)` producing `AND (...)`).
      this.conds.push((row) => sub.conds.some((fn) => fn(row)));
      return this;
    }
    if (b !== undefined) {
      const col = a as string;
      const op = b as string;
      const val = c as unknown;
      this.conds.push((row) => {
        const left = row[col];
        if (left == null) return false;
        const l = String(left);
        const r = String(val);
        if (op === '<=') return l <= r;
        if (op === '>=') return l >= r;
        if (op === '<') return l < r;
        if (op === '>') return l > r;
        return l === r;
      });
      return this;
    }
    for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
      this.conds.push((row) => row[k] === v);
    }
    return this;
  }

  whereNull(col: string): MemQuery {
    this.conds.push((row) => row[col] == null);
    return this;
  }

  orWhere(col: string, op: string, val: unknown): MemQuery {
    return this.where(col, op, val);
  }

  private matches(row: Record<string, any>): boolean {
    return this.conds.every((fn) => fn(row));
  }

  // Mimic PG jsonb columns: a stored `targets` string round-trips as a parsed
  // array (the repository already tolerates both shapes).
  private static normalize(row: Record<string, any>): Record<string, any> {
    if (typeof row.targets === 'string') {
      try {
        row.targets = JSON.parse(row.targets);
      } catch {
        // keep raw
      }
    }
    return row;
  }

  async first(): Promise<Record<string, any> | undefined> {
    return this.rows.find((row) => this.matches(row));
  }

  select(): Record<string, any>[] {
    return this.rows.filter((row) => this.matches(row));
  }

  insert(row: Record<string, any>): any {
    this.rows.push(MemQuery.normalize({ ...row }));
    const chain: any = {
      onConflict: () => chain,
      merge: async () => 1,
      then: (resolve: (v: number) => void, reject?: (e: unknown) => void) => Promise.resolve(1).then(resolve, reject),
    };
    return chain;
  }

  async update(patch: Record<string, any>): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      if (this.matches(row)) {
        MemQuery.normalize(Object.assign(row, patch));
        count += 1;
      }
    }
    return count;
  }

  async delete(): Promise<void> {
    const kept = this.rows.filter((row) => !this.matches(row));
    this.rows.length = 0;
    this.rows.push(...kept);
  }
}

// ── In-memory secrets ───────────────────────────────────────────────────────
const secretStore = vi.hoisted(() => {
  const map = new Map<string, string>();
  const reset = () => map.clear();
  return {
    map,
    reset,
    get: (tenant: string, name: string) => map.get(`${tenant}:${name}`) ?? null,
    set: (tenant: string, name: string, value: string) => {
      map.set(`${tenant}:${name}`, value);
    },
    delete: (tenant: string, name: string) => {
      map.delete(`${tenant}:${name}`);
    },
  };
});

const getTenantSecretMock = vi.hoisted(() =>
  vi.fn(async (tenant: string, name: string) => secretStore.get(tenant, name)),
);
const setTenantSecretMock = vi.hoisted(() =>
  vi.fn(async (tenant: string, name: string, value: string) => {
    secretStore.set(tenant, name, value);
  }),
);
const deleteTenantSecretMock = vi.hoisted(() =>
  vi.fn(async (tenant: string, name: string) => {
    secretStore.delete(tenant, name);
  }),
);

// ── Fake Xero / QBO providers at the axios seam ─────────────────────────────
const providerHarness = vi.hoisted(() => {
  const calls: Array<{ method: string; url: string; body?: unknown; authorization?: string }> = [];
  const reset = () => {
    calls.length = 0;
  };
  const fail = (status: number, data: unknown, code?: string) => {
    const err: any = new Error(`provider error ${status}`);
    err.isAxiosError = true;
    err.response = { status, data };
    if (code) err.code = code;
    return err;
  };
  const ok = (status = 204, data: unknown = {}) => ({ status, data });

  type Handler = (arg: any) => any;

  let qboRevoke: Handler = () => ok(200, {});
  let qboTokenExchange: Handler = () =>
    ok(200, { access_token: 'exchanged-at', refresh_token: 'exchanged-rt', expires_in: 3600, x_refresh_token_expires_in: 8_726_400 });
  let xeroConnection: Handler = () => ok(204);
  let xeroRefresh: Handler = () => ok(200, { access_token: 'refreshed-token' });
  let xeroGrantRevoke: Handler = () => ok(200, {});
  let xeroConnectionsList: Handler = () => ok(200, []);

  function respond(result: any): any {
    if (result?.throw) throw result.throw;
    // A handler that returned a ready-made axios-style error must propagate it.
    if (result?.isAxiosError) throw result;
    if (result?.error) return fail(result.status ?? 400, result.error);
    return ok(result?.status ?? 200, result?.data ?? {});
  }

  async function post(url: string, data?: unknown, config?: { headers?: Record<string, unknown> }): Promise<any> {
    calls.push({ method: 'post', url, body: data, authorization: config?.headers?.Authorization as string | undefined });
    // Match on path suffixes so both the real hosts and the dev-only env
    // override URLs (see the env-driven override suite below) route identically.
    // Handlers may be async (the interleaving tests pause them mid-flight).
    if (url.includes('tokens/revoke') || url.endsWith('/revoke')) {
      return respond(await qboRevoke(data));
    }
    if (url.includes('tokens/bearer')) {
      return respond(await qboTokenExchange(data));
    }
    if (url.includes('connect/revocation')) {
      return respond(await xeroGrantRevoke(data));
    }
    if (url.includes('connect/token')) {
      return respond(await xeroRefresh(data));
    }
    return ok(200, {});
  }

  async function del(url: string, config?: { headers?: Record<string, unknown> }): Promise<any> {
    calls.push({ method: 'delete', url, authorization: config?.headers?.Authorization as string | undefined });
    const connectionId = decodeURIComponent(url.substring(url.lastIndexOf('/') + 1));
    return respond(await xeroConnection(connectionId));
  }

  async function get(url: string, config?: { headers?: Record<string, unknown> }): Promise<any> {
    calls.push({ method: 'get', url, authorization: config?.headers?.Authorization as string | undefined });
    if (url.includes('/connections')) {
      return respond(await xeroConnectionsList(url));
    }
    return ok(200, {});
  }

  return {
    calls,
    reset,
    fail,
    ok,
    post,
    del,
    get,
    setQboRevoke: (h: Handler) => {
      qboRevoke = h;
    },
    setQboTokenExchange: (h: Handler) => {
      qboTokenExchange = h;
    },
    setXeroConnection: (h: Handler) => {
      xeroConnection = h;
    },
    setXeroRefresh: (h: Handler) => {
      xeroRefresh = h;
    },
    setXeroGrantRevoke: (h: Handler) => {
      xeroGrantRevoke = h;
    },
    setXeroConnectionsList: (h: Handler) => {
      xeroConnectionsList = h;
    },
  };
});

const resolveQboOAuthCredentialsMock = vi.hoisted(() =>
  vi.fn(async () => ({ clientId: 'qbo-client', clientSecret: 'qbo-secret', source: 'app' })),
);
const resolveXeroOAuthCredentialsMock = vi.hoisted(() =>
  vi.fn(async () => ({ clientId: 'xero-client', clientSecret: 'xero-secret', source: 'app' })),
);
const notifyQboConnectionChangedMock = vi.hoisted(() => vi.fn(async () => undefined));
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// ── Advisory-lock-simulating knex ───────────────────────────────────────────
// The credential-write lock (providerDisconnect/lock.ts) is a transaction-
// scoped Postgres advisory lock. Every fake knex here shares one in-memory
// lock table with the same semantics — `pg_advisory_xact_lock` blocks until
// the holder's outermost transaction settles — so the interleaving tests
// below exercise real mutual exclusion between the credential storage layer
// and disconnect initiation instead of a no-op `raw`.
const knexHarness = vi.hoisted(() => {
  // key -> waiter queue; key present in the map = lock held.
  const held = new Map<string, Array<() => void>>();
  const acquire = async (key: string): Promise<void> => {
    const waiters = held.get(key);
    if (!waiters) {
      held.set(key, []);
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
  };
  const release = (key: string): void => {
    const waiters = held.get(key);
    if (!waiters) return;
    const next = waiters.shift();
    if (next) next();
    else held.delete(key);
  };
  const nowIso = () => new Date().toISOString();
  const makeKnex = (): any => {
    const makeTrx = (heldKeys: string[]): any => ({
      fn: { now: nowIso },
      raw: async (sql: string, bindings?: unknown[]) => {
        if (typeof sql === 'string' && sql.includes('pg_advisory_xact_lock')) {
          const key = (bindings ?? []).join(' ');
          // Reentrant within a transaction, like the real advisory lock.
          if (!heldKeys.includes(key)) {
            await acquire(key);
            heldKeys.push(key);
          }
        }
        return { rows: [] };
      },
      // Nested transactions (savepoints) share the outer transaction's locks.
      transaction: async (cb: (trx: any) => Promise<any>) => cb(makeTrx(heldKeys)),
    });
    return {
      fn: { now: nowIso },
      raw: async () => ({ rows: [] }),
      transaction: async (cb: (trx: any) => Promise<any>) => {
        const heldKeys: string[] = [];
        try {
          return await cb(makeTrx(heldKeys));
        } finally {
          for (const key of heldKeys.splice(0)) release(key);
        }
      },
    };
  };
  const reset = () => held.clear();
  return { makeKnex, reset };
});

// ── Module seams ────────────────────────────────────────────────────────────
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      if (!fakeDb.tables[name]) fakeDb.tables[name] = [];
      return new MemQuery(fakeDb.tables[name]);
    },
  }),
  createTenantKnex: async () => ({
    knex: knexHarness.makeKnex(),
    tenant: 'tenant-1',
  }),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: async () => 'test-xero-verifier-key',
  getSecretProviderInstance: async () => ({
    getTenantSecret: getTenantSecretMock,
    setTenantSecret: setTenantSecretMock,
    deleteTenantSecret: deleteTenantSecretMock,
    // App-level config (redirect URIs, base URLs) is absent in tests; the
    // callback routes fall back to their localhost defaults.
    getAppSecret: async () => null,
  }),
}));

vi.mock('redis', () => ({
  createClient: vi.fn(() => {
    throw new Error('redis unavailable');
  }),
}));

vi.mock('@alga-psa/core/logger', () => ({ default: loggerMock }));

vi.mock('axios', () => ({
  default: {
    post: providerHarness.post,
    delete: providerHarness.del,
    get: providerHarness.get,
    isAxiosError: (e: any) => Boolean(e?.isAxiosError),
  },
  isAxiosError: (e: any) => Boolean(e?.isAxiosError),
}));

vi.mock('../../qbo/qboClientService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../qbo/qboClientService')>();
  return {
    ...original,
    resolveQboOAuthCredentials: resolveQboOAuthCredentialsMock,
  };
});

vi.mock('../../xero/xeroClientService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../xero/xeroClientService')>();
  return {
    ...original,
    resolveXeroOAuthCredentials: resolveXeroOAuthCredentialsMock,
  };
});

vi.mock('../../qbo/qboConnectionChangeProvider', () => ({
  notifyQboConnectionChanged: notifyQboConnectionChangedMock,
  registerQboConnectionChangeHandler: vi.fn(),
}));

// The OAuth callback routes authenticate through these before they reach the
// disconnect gate under test: the connect/callback policy resolves the live
// user via getCurrentUserWithRevocationCheck and gates on billing_settings:update.
const USER_ID = 'user-1';
const getSessionMock = vi.hoisted(() => vi.fn(async () => ({ user: { tenant: 'tenant-1' } })));
const getCurrentUserWithRevocationCheckMock = vi.hoisted(() =>
  vi.fn(async () => ({ user_id: USER_ID, tenant: TENANT, user_type: 'internal' })),
);
const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@alga-psa/auth', () => ({
  getSession: getSessionMock,
  getCurrentUserWithRevocationCheck: getCurrentUserWithRevocationCheckMock,
  hasPermission: hasPermissionMock,
}));

const getCurrentUserMock = vi.hoisted(() => vi.fn(async () => ({ tenant: 'tenant-1' })));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: getCurrentUserMock }));

// The callback consumes the OAuth state nonce (single-use) via the shared
// accounting store before it reaches the disconnect gate under test.
const oauthStateHarness = vi.hoisted(() => {
  const states = new Map<string, { tenantId: string; initiatedAt: string }>();
  const key = (provider: 'qbo' | 'xero', nonce: string) => `${provider}:${nonce}`;
  return {
    reset: () => states.clear(),
    store: vi.fn(async (
      provider: 'qbo' | 'xero',
      nonce: string,
      record: { tenantId: string; initiatedAt: string },
    ) => {
      states.set(key(provider, nonce), record);
    }),
    consume: vi.fn(async (provider: 'qbo' | 'xero', nonce: string) => {
      const stateKey = key(provider, nonce);
      const record = states.get(stateKey) ?? null;
      states.delete(stateKey);
      return record;
    }),
    invalidate: vi.fn(async (provider: 'qbo' | 'xero', tenantId: string) => {
      for (const [stateKey, record] of states) {
        if (stateKey.startsWith(`${provider}:`) && record.tenantId === tenantId) {
          states.delete(stateKey);
        }
      }
    }),
  };
});
const storeAccountingOAuthNonceMock = oauthStateHarness.store;
const consumeAccountingOAuthNonceMock = oauthStateHarness.consume;
vi.mock('../../accountingOAuthStateStore', () => ({
  storeAccountingOAuthNonce: oauthStateHarness.store,
  consumeAccountingOAuthNonce: oauthStateHarness.consume,
  invalidateAccountingOAuthStates: oauthStateHarness.invalidate,
}));

// ── Imports under test ──────────────────────────────────────────────────────
import {
  PROVIDER_QBO,
  PROVIDER_XERO,
  XERO_GRANT_TARGET_ID,
  MAX_RETRY_ATTEMPTS,
  disconnectProvider,
  forceFinalizeProviderDisconnect,
  getProviderDisconnectStatusInfo,
  isProviderDisconnectActive,
  listDueDisconnectRecords,
} from '..';
import { getStoredQboCredentialsMap, upsertStoredQboCredentials, QBO_TOKEN_URL } from '../../qbo/qboClientService';
import { getStoredXeroConnections, upsertStoredXeroConnections } from '../../xero/xeroClientService';
import { createQboOAuthState, QBO_OAUTH_STATE_COOKIE } from '../../qbo/qboOAuthState';
import { XERO_OAUTH_CSRF_COOKIE } from '../../xero/oauthCsrf';
import {
  _resetXeroConnectAttemptStoreForTests,
  storeXeroConnectAttempt,
  XERO_CONNECT_ATTEMPT_PROVIDER,
} from '../../xero/xeroOAuthConnectAttemptStore';
import { encryptXeroVerifier } from '../../xero/xeroOAuthVerifierCipher';
import { GET as QboCallbackGET } from '../../../routes/api/integrations/qbo/callback';
import { GET as XeroCallbackGET } from '../../../routes/api/integrations/xero/callback';
import { NextRequest } from 'next/server';

const TENANT = 'tenant-1';

function makeKnex(): Knex {
  return knexHarness.makeKnex() as unknown as Knex;
}

function futureIso(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

/** Drains pending macro/microtasks so a blocked promise chain provably stays blocked. */
async function flushTasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function xeroConnectionMaterial(connectionId: string, refreshToken: string) {
  return {
    connectionId,
    xeroTenantId: connectionId,
    accessToken: `access-${connectionId}`,
    accessTokenExpiresAt: futureIso(3600_000),
    refreshToken,
    refreshTokenExpiresAt: futureIso(86_400_000),
  };
}

function xeroCredentialSecret(connections: Record<string, ReturnType<typeof xeroConnectionMaterial>>): void {
  secretStore.set(TENANT, 'xero_credentials', JSON.stringify(connections));
}

async function seedXeroConnectAttempt(params: {
  nonce: string;
  csrf: string;
  initiatedAt: string;
  verifier: string;
}): Promise<string> {
  const createdAt = Date.parse(params.initiatedAt);
  await storeXeroConnectAttempt(params.nonce, {
    verifier: await encryptXeroVerifier(params.verifier),
    tenantId: TENANT,
    userId: USER_ID,
    provider: XERO_CONNECT_ATTEMPT_PROVIDER,
    redirectUri: 'http://localhost:3000/api/integrations/xero/callback',
    csrf: params.csrf,
    createdAt,
    expiresAt: Math.max(Date.now(), createdAt) + 600_000,
  });
  return params.nonce;
}

function qboCredentialSecret(realms: Record<string, { realmId: string; refreshToken: string }>): void {
  secretStore.set(TENANT, 'qbo_credentials', JSON.stringify(realms));
}

const QBO_STANDARD_SECRET = 'qbo_credentials';
const QBO_TOMBSTONE_SECRET = 'qbo_credentials_disconnect_pending';
const XERO_STANDARD_SECRET = 'xero_credentials';
const XERO_TOMBSTONE_SECRET = 'xero_credentials_disconnect_pending';

function recordRows(): Record<string, any>[] {
  return fakeDb.tables.provider_disconnect_records;
}

function auditRows(): Record<string, any>[] {
  return fakeDb.tables.audit_logs;
}

function seedPendingXeroRecordWithRevokedConnections(
  connections: Record<string, ReturnType<typeof xeroConnectionMaterial>>,
): void {
  const now = new Date().toISOString();
  secretStore.set(TENANT, XERO_TOMBSTONE_SECRET, JSON.stringify(connections));
  recordRows().push({
    tenant: TENANT,
    provider: PROVIDER_XERO,
    status: 'pending_revocation',
    targets: Object.keys(connections).map((targetId) => ({
      targetId,
      status: 'revoked',
      updatedAt: now,
    })),
    attempt_count: 1,
    next_retry_at: null,
    last_error_class: null,
    correlation_id: 'resumed-xero-disconnect',
    started_at: now,
    finalized_at: null,
    finalize_reason: null,
    updated_at: now,
  });
}

function providerCalls(): Array<{ method: string; url: string; body?: unknown }> {
  return providerHarness.calls.map(({ method, url, body }) => ({ method, url, body }));
}

beforeEach(() => {
  fakeDb.reset();
  secretStore.reset();
  providerHarness.reset();
  knexHarness.reset();
  oauthStateHarness.reset();
  _resetXeroConnectAttemptStoreForTests();
  vi.clearAllMocks();

  // Default secret-provider behavior; individual tests override to simulate
  // failures. The defaults are re-applied here so a failure simulation never
  // leaks into the next test.
  getTenantSecretMock.mockImplementation(async (tenant, name) => secretStore.get(tenant, name));
  setTenantSecretMock.mockImplementation(async (tenant, name, value) => {
    secretStore.set(tenant, name, value);
  });
  deleteTenantSecretMock.mockImplementation(async (tenant, name) => {
    secretStore.delete(tenant, name);
  });

  resolveQboOAuthCredentialsMock.mockResolvedValue({ clientId: 'qbo-client', clientSecret: 'qbo-secret', source: 'app' });
  resolveXeroOAuthCredentialsMock.mockResolvedValue({ clientId: 'xero-client', clientSecret: 'xero-secret', source: 'app' });
  providerHarness.setQboRevoke(() => providerHarness.ok(200, {}));
  providerHarness.setQboTokenExchange(() =>
    providerHarness.ok(200, { access_token: 'exchanged-at', refresh_token: 'exchanged-rt', expires_in: 3600, x_refresh_token_expires_in: 8_726_400 }),
  );
  providerHarness.setXeroConnection(() => providerHarness.ok(204));
  providerHarness.setXeroRefresh(() => providerHarness.ok(200, { access_token: 'refreshed-token' }));
  providerHarness.setXeroGrantRevoke(() => providerHarness.ok(200, {}));
  providerHarness.setXeroConnectionsList(() => providerHarness.ok(200, []));

  getSessionMock.mockResolvedValue({ user: { tenant: TENANT } });
  getCurrentUserMock.mockResolvedValue({ tenant: TENANT });
  getCurrentUserWithRevocationCheckMock.mockResolvedValue({
    user_id: USER_ID,
    tenant: TENANT,
    user_type: 'internal',
  });
  hasPermissionMock.mockResolvedValue(true);
});

describe('QuickBooks Online disconnect state machine', () => {
  it('clean success revokes each realm, deletes local credentials, finalizes, blocks sync, and audits', async () => {
    qboCredentialSecret({
      'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' },
      'realm-b': { realmId: 'realm-b', refreshToken: 'rt-b' },
    });

    const result = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, { userId: 'user-1' });

    expect(result.status).toBe('disconnected');

    // Provider-first: every realm revoked BEFORE local deletion.
    expect(providerCalls()).toEqual([
      { method: 'post', url: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke', body: { token: 'rt-a' } },
      { method: 'post', url: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke', body: { token: 'rt-b' } },
    ]);
    expect(providerCalls()[0].method).toBe('post');

    // Local credentials gone from both the standard and tombstone names.
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();

    // Terminal state.
    expect(recordRows()).toHaveLength(1);
    expect(recordRows()[0].status).toBe('finalized');
    expect(recordRows()[0].targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: 'realm-a', status: 'revoked' }),
        expect.objectContaining({ targetId: 'realm-b', status: 'revoked' }),
      ]),
    );

    // No active disconnect → sync allowed again.
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_QBO)).toBe(false);
    expect(await getProviderDisconnectStatusInfo(makeKnex(), TENANT, PROVIDER_QBO)).toMatchObject({ status: 'finalized' });

    // Audit trail with correlation id, no tokens.
    const ops = auditRows().map((row) => row.operation);
    expect(ops).toEqual(expect.arrayContaining(['disconnect_started', 'disconnect_target_revoked', 'disconnect_finalized']));
    expect(auditRows().every((row) => row.correlation_id || row.details.correlation_id)).toBe(true);
    expect(JSON.stringify(auditRows())).not.toContain('rt-a');
    expect(JSON.stringify(auditRows())).not.toContain('rt-b');
  });

  it('transient 5xx keeps credentials tombstoned, stays pending with backoff, blocks sync, and retries to completion', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    providerHarness.setQboRevoke(() => providerHarness.fail(500, { error: 'server_error' }));

    const first = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, { userId: 'user-1' });

    // Not reported as disconnected.
    expect(first.status).toBe('pending');

    // Credentials retained encrypted (tombstoned), standard name emptied.
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toContain('rt-a');

    // Pending with a future retry window and an error class.
    const row = recordRows()[0];
    expect(row.status).toBe('pending_revocation');
    expect(row.attempt_count).toBe(1);
    expect(row.last_error_class).toContain('500');
    expect(new Date(row.next_retry_at).getTime()).toBeGreaterThan(Date.now());

    // User-visible status is not "disconnected" and the sync gate is active.
    const status = await getProviderDisconnectStatusInfo(makeKnex(), TENANT, PROVIDER_QBO);
    expect(status).not.toBeNull();
    expect(status!.status).not.toBe('finalized');
    expect(status!.targets[0]).toMatchObject({ targetId: 'realm-a', status: 'pending_revocation' });
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_QBO)).toBe(true);

    // The retry schedule excludes the record until its window arrives.
    expect(await listDueDisconnectRecords(makeKnex(), TENANT)).toHaveLength(0);

    // Advancing the clock (simulating the retry job's wait) makes it due, and
    // the provider-first pass then completes the disconnect.
    recordRows()[0].next_retry_at = new Date(Date.now() - 1000).toISOString();
    providerHarness.setQboRevoke(() => providerHarness.ok(200, {}));
    expect(await listDueDisconnectRecords(makeKnex(), TENANT)).toHaveLength(1);

    const second = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, { userId: 'system', fromRetry: true });
    expect(second.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_QBO)).toBe(false);
  });

  it('a timeout is treated as transient, not success, and does not delete credentials', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    providerHarness.setQboRevoke(() => {
      throw providerHarness.fail(0, {}, 'ECONNABORTED');
    });

    const result = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});

    expect(result.status).toBe('pending');
    expect(recordRows()[0].status).toBe('pending_revocation');
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toContain('rt-a');
    expect(recordRows()[0].last_error_class).toContain('timeout');
  });

  it('invalid_grant from Intuit is idempotent success (grant already dead)', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    providerHarness.setQboRevoke(() => providerHarness.fail(400, { error: 'invalid_grant' }));

    const result = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});

    expect(result.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();
  });

  it('permanent invalid_client → failed_permanent; operator force-finalize deletes credentials with reason', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    providerHarness.setQboRevoke(() => providerHarness.fail(400, { error: 'invalid_client' }));

    const failed = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, { userId: 'user-1' });

    expect(failed.status).toBe('failed_permanent');
    expect(recordRows()[0].status).toBe('failed_permanent');
    expect(recordRows()[0].targets[0]).toMatchObject({ targetId: 'realm-a', status: 'failed_permanent' });
    expect(recordRows()[0].last_error_class).toContain('invalid_client');
    // Credential material retained for a future retry attempt / forensics.
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toContain('rt-a');

    // Force-finalize refuses while nothing is pending — here it is valid.
    const finalized = await forceFinalizeProviderDisconnect(makeKnex(), TENANT, PROVIDER_QBO, {
      userId: 'user-1',
      reason: 'Intuit app credentials are invalid; provider cannot confirm revocation.',
    });
    expect(finalized.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(recordRows()[0].finalize_reason).toContain('invalid');
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();
    expect(auditRows().map((r) => r.operation)).toContain('disconnect_force_finalized');
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_QBO)).toBe(false);
  });

  it('force-finalize is refused while a target is still retrying', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    providerHarness.setQboRevoke(() => providerHarness.fail(500, { error: 'server_error' }));
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});

    const refused = await forceFinalizeProviderDisconnect(makeKnex(), TENANT, PROVIDER_QBO, {
      userId: 'user-1',
      reason: 'skip retry',
    });
    expect(refused.status).toBe('pending');
    expect(recordRows()[0].status).toBe('pending_revocation');
  });

  it('repeated disconnect requests are idempotent at every stage', async () => {
    qboCredentialSecret({
      'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' },
      'realm-b': { realmId: 'realm-b', refreshToken: 'rt-b' },
    });

    // Stage 1: transient failure on realm-b → partial.
    providerHarness.setQboRevoke((body: any) =>
      body.token === 'rt-b' ? providerHarness.fail(429, { error: 'rate' }) : providerHarness.ok(200, {}),
    );
    const partial = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(partial.status).toBe('partial');
    expect(recordRows()[0].status).toBe('pending_revocation');

    // Stage 2: re-invoking disconnect while pending retries only the pending
    // realm and does not re-revoke the succeeded one.
    providerHarness.setQboRevoke(() => providerHarness.ok(200, {}));
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    const revokeCalls = providerCalls().filter((c) => c.url.includes('tokens/revoke'));
    const tokensRevoked = revokeCalls.map((c) => (c.body as { token: string }).token);
    expect(tokensRevoked.filter((t) => t === 'rt-a')).toHaveLength(1); // never re-revoked
    expect(tokensRevoked.filter((t) => t === 'rt-b')).toHaveLength(2); // failed + retry
    expect(recordRows()[0].status).toBe('finalized');

    // Stage 3: after finalization, another call is a stable no-op with no
    // further provider traffic.
    providerHarness.calls.length = 0;
    const again = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(again.status).toBe('already_disconnected');
    expect(providerHarness.calls).toHaveLength(0);
  });

  it('partial multi-realm: per-target results accurate, overall partial, failed target recoverable', async () => {
    qboCredentialSecret({
      'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' },
      'realm-b': { realmId: 'realm-b', refreshToken: 'rt-b' },
    });
    providerHarness.setQboRevoke((body: any) =>
      body.token === 'rt-b' ? providerHarness.fail(500, { error: 'server_error' }) : providerHarness.ok(200, {}),
    );

    const partial = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(partial.status).toBe('partial');
    expect(partial.error).toBeTruthy();

    const targets = recordRows()[0].targets as Array<{ targetId: string; status: string }>;
    expect(targets.find((t) => t.targetId === 'realm-a')).toMatchObject({ status: 'revoked' });
    expect(targets.find((t) => t.targetId === 'realm-b')).toMatchObject({ status: 'pending_revocation' });
    expect(recordRows()[0].status).toBe('pending_revocation');

    // User-visible status exposes the partial picture, never full success.
    const status = await getProviderDisconnectStatusInfo(makeKnex(), TENANT, PROVIDER_QBO);
    expect(status!.targets.find((t) => t.targetId === 'realm-a')!.status).toBe('revoked');
    expect(status!.targets.find((t) => t.targetId === 'realm-b')!.status).toBe('pending_revocation');

    // Succeeded realm's credentials are already handled; failed realm retained.
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toContain('rt-b');

    // Recover the failed realm on retry → finalized.
    providerHarness.setQboRevoke(() => providerHarness.ok(200, {}));
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, { fromRetry: true });
    expect(recordRows()[0].status).toBe('finalized');
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();
  });

  it('tombstoned credentials are unreachable from the ordinary credential-loading path', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    // The gate must live at the credential fetch, not just the UI.
    expect(Object.keys(await getStoredQboCredentialsMap(TENANT))).toEqual(['realm-a']);

    providerHarness.setQboRevoke(() => providerHarness.fail(500, { error: 'server_error' }));
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_QBO)).toBe(true);

    // Ordinary sync/export loading returns no credentials while the
    // disconnect is pending.
    expect(await getStoredQboCredentialsMap(TENANT)).toEqual({});
  });

  it('reconnect after a finalized disconnect retires the record and the next disconnect runs a real fresh cycle', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });

    // Cycle 1: disconnect completes and finalizes; credentials gone.
    const first = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(first.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();

    // Reconnect: persist fresh credentials via the OAuth storage path. The
    // stale finalized record must be retired before the new connection becomes
    // visible, and a `disconnect_record_retired` audit event must be written.
    const reconnectStartedAt = new Date(Date.parse(recordRows()[0].finalized_at) + 1).toISOString();
    await upsertStoredQboCredentials(TENANT, {
      realmId: 'realm-a',
      accessToken: 'at-a2',
      refreshToken: 'rt-a2',
      accessTokenExpiresAt: futureIso(3600_000),
      refreshTokenExpiresAt: futureIso(86_400_000),
    }, { authorizationFlowStartedAt: reconnectStartedAt });
    expect(recordRows()).toHaveLength(0);
    expect(auditRows().map((r) => r.operation)).toContain('disconnect_record_retired');
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toContain('rt-a2');
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_QBO)).toBe(false);

    // Cycle 2: force a transient provider failure so the immediate
    // tombstoning is observable mid-cycle.
    providerHarness.calls.length = 0;
    providerHarness.setQboRevoke(() => providerHarness.fail(500, { error: 'server_error' }));
    const second = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(second.status).toBe('pending');

    // The second disconnect tombstoned the fresh live credentials immediately:
    // the ordinary sync/export credential fetch is empty again.
    expect(await getStoredQboCredentialsMap(TENANT)).toEqual({});
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toContain('rt-a2');
    const revokeTokens = providerCalls()
      .filter((c) => c.url.includes('tokens/revoke'))
      .map((c) => (c.body as { token: string }).token);
    expect(revokeTokens).toEqual(['rt-a2']);

    // Retry completes the fresh cycle; the provider was really called.
    providerHarness.setQboRevoke(() => providerHarness.ok(200, {}));
    const third = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, { fromRetry: true });
    expect(third.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();
    expect(
      providerCalls().filter((c) => c.url.includes('tokens/revoke')).map((c) => (c.body as { token: string }).token),
    ).toEqual(['rt-a2', 'rt-a2']);
  });

  it('tombstone deletion failure during finalization keeps the record retryable and never finalizes over orphaned material', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    // Provider revocation succeeds; the tombstone secret deletion throws.
    deleteTenantSecretMock.mockImplementation(async (tenant, name) => {
      if (name === QBO_TOMBSTONE_SECRET) throw new Error('vault unavailable');
      secretStore.delete(tenant, name);
    });

    const first = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, { userId: 'user-1' });

    // NOT finalized: the record stays in a retryable state and keeps the
    // already-revoked target revoked.
    expect(first.status).toBe('partial');
    expect(first.error).toContain('local credential removal failed');
    expect(recordRows()[0].status).toBe('pending_revocation');
    expect(recordRows()[0].targets[0]).toMatchObject({ targetId: 'realm-a', status: 'revoked' });
    expect(recordRows()[0].last_error_class).toContain('credential_secret_deletion_failed');
    expect(recordRows()[0].finalized_at).toBeUndefined();
    expect(new Date(recordRows()[0].next_retry_at).getTime()).toBeGreaterThan(Date.now());

    // The encrypted material was retained (deletion failed), so the tombstone
    // gate still holds and sync stays blocked.
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toContain('rt-a');
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toBeNull();
    expect(await getStoredQboCredentialsMap(TENANT)).toEqual({});
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_QBO)).toBe(true);

    // A sanitized audit event records the cleanup failure — never the secret.
    expect(auditRows().map((r) => r.operation)).toContain('disconnect_cleanup_failed');
    expect(auditRows().every((r) => r.correlation_id || r.details.correlation_id)).toBe(true);
    expect(JSON.stringify(auditRows())).not.toContain('rt-a');

    // The retry schedule picks the record up once its window arrives.
    expect(await listDueDisconnectRecords(makeKnex(), TENANT)).toHaveLength(0);
    recordRows()[0].next_retry_at = new Date(Date.now() - 1000).toISOString();
    expect(await listDueDisconnectRecords(makeKnex(), TENANT)).toHaveLength(1);

    // Retry pass with deletion now working converges to finalized WITHOUT
    // re-calling the provider (the target is already revoked).
    deleteTenantSecretMock.mockImplementation(async (tenant, name) => {
      secretStore.delete(tenant, name);
    });
    providerHarness.calls.length = 0;
    const second = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, { fromRetry: true });
    expect(second.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();
    expect(providerCalls().filter((c) => c.url.includes('tokens/revoke'))).toHaveLength(0);
  });

  it('a failure between the disconnect record write and the credential tombstoning stays durable and the next pass completes it', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });

    // Initiation persists the pending record first; the credential move then
    // dies (secret store outage) before anything has been copied.
    setTenantSecretMock.mockImplementationOnce(async () => {
      throw new Error('secret store unavailable');
    });

    await expect(
      disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, { userId: 'user-1' }),
    ).rejects.toThrow('secret store unavailable');

    // Durable, retry-drivable state: the pending record exists and is due
    // immediately, the disconnect gates already hold, no credential material
    // was lost, and no provider call happened yet.
    expect(recordRows()).toHaveLength(1);
    expect(recordRows()[0].status).toBe('pending_revocation');
    expect(recordRows()[0].targets).toEqual([
      expect.objectContaining({ targetId: 'realm-a', status: 'pending_revocation' }),
    ]);
    expect(await listDueDisconnectRecords(makeKnex(), TENANT)).toHaveLength(1);
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_QBO)).toBe(true);
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toContain('rt-a');
    expect(providerHarness.calls).toHaveLength(0);
    expect(auditRows().map((r) => r.operation)).toContain('disconnect_started');

    // The next pass (same handler the scheduled retry job drives) completes
    // the interrupted tombstone move and the full disconnect.
    const retry = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, { userId: 'system', fromRetry: true });
    expect(retry.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(providerCalls()).toEqual([
      { method: 'post', url: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke', body: { token: 'rt-a' } },
    ]);
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_QBO)).toBe(false);
  });

  it('a valid-looking OAuth callback that lands while a QuickBooks disconnect is pending is rejected and never resurrects credentials', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    const signingSecret = 'race-test-state-signing-secret';
    const created = createQboOAuthState({
      tenantId: TENANT,
      userId: USER_ID,
      secret: signingSecret,
      initiatedAt: new Date(Date.now() - 1000).toISOString(),
    });
    const { stateParam, cookieValue } = created;
    await storeAccountingOAuthNonceMock('qbo', created.payload.nonce, {
      tenantId: TENANT,
      initiatedAt: created.payload.initiatedAt,
    });

    providerHarness.setQboRevoke(() => providerHarness.fail(500, { error: 'server_error' }));
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});

    // The race frame: the authorization was issued BEFORE the disconnect
    // started, the callback lands AFTER. Disconnect is pending: creds
    // tombstoned, sync blocked.
    expect(recordRows()[0].status).toBe('pending_revocation');
    expect(await getStoredQboCredentialsMap(TENANT)).toEqual({});
    const targetsBefore = JSON.stringify(recordRows()[0].targets);

    const previousEdition = process.env.EDITION;
    const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
    process.env.EDITION = 'ee';
    process.env.NEXTAUTH_SECRET = signingSecret;
    try {
      const response = await QboCallbackGET(
        new Request(
          `http://localhost:3000/api/integrations/qbo/callback?code=valid-auth-code&realmId=realm-a&state=${encodeURIComponent(stateParam)}`,
          { headers: { cookie: `${QBO_OAUTH_STATE_COOKIE}=${encodeURIComponent(cookieValue)}` } },
        ),
      );

      // Rejected with a disconnect-specific failure redirect, and the token
      // exchange never ran.
      expect(response.status).toBe(307);
      const location = response.headers.get('location') ?? '';
      expect(location).toContain('qbo_status=failure');
      expect(location).toContain('qbo_error=disconnect_in_progress');
      expect(providerHarness.calls.filter((c) => c.url.includes(QBO_TOKEN_URL))).toHaveLength(0);
    } finally {
      if (previousEdition === undefined) delete process.env.EDITION;
      else process.env.EDITION = previousEdition;
      if (previousNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
    }

    // State untouched: credentials stay tombstoned/absent for sync, the
    // disconnect record is still pending with unchanged targets, and the sync
    // gate still blocks.
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toContain('rt-a');
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toBeNull();
    expect(await getStoredQboCredentialsMap(TENANT)).toEqual({});
    expect(recordRows()[0].status).toBe('pending_revocation');
    expect(JSON.stringify(recordRows()[0].targets)).toBe(targetsBefore);
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_QBO)).toBe(true);
  });

  it('invalidates a pre-disconnect QuickBooks flow so its delayed callback cannot write after clean finalization', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    const signingSecret = 'delayed-qbo-state-signing-secret';
    const created = createQboOAuthState({
      tenantId: TENANT,
      userId: USER_ID,
      secret: signingSecret,
      initiatedAt: new Date(Date.now() - 1000).toISOString(),
    });
    await storeAccountingOAuthNonceMock('qbo', created.payload.nonce, {
      tenantId: TENANT,
      initiatedAt: created.payload.initiatedAt,
    });

    const disconnected = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(disconnected.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    const finalizedRecord = JSON.stringify(recordRows()[0]);
    providerHarness.calls.length = 0;

    const previousEdition = process.env.EDITION;
    const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
    process.env.EDITION = 'ee';
    process.env.NEXTAUTH_SECRET = signingSecret;
    try {
      const response = await QboCallbackGET(
        new Request(
          `http://localhost:3000/api/integrations/qbo/callback?code=held-code&realmId=realm-a&state=${encodeURIComponent(created.stateParam)}`,
          { headers: { cookie: `${QBO_OAUTH_STATE_COOKIE}=${encodeURIComponent(created.cookieValue)}` } },
        ),
      );
      expect(response.headers.get('location') ?? '').toContain('qbo_error=state_replayed');
    } finally {
      if (previousEdition === undefined) delete process.env.EDITION;
      else process.env.EDITION = previousEdition;
      if (previousNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
    }

    expect(providerHarness.calls.filter((c) => c.url.includes(QBO_TOKEN_URL))).toHaveLength(0);
    await expect(upsertStoredQboCredentials(TENANT, {
      realmId: 'realm-a',
      accessToken: 'stale-at',
      refreshToken: 'stale-rt',
      accessTokenExpiresAt: futureIso(3600_000),
      refreshTokenExpiresAt: futureIso(86_400_000),
    }, { authorizationFlowStartedAt: created.payload.initiatedAt })).rejects.toThrow(/started before/i);
    expect(JSON.stringify(recordRows()[0])).toBe(finalizedRecord);
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toBeNull();
    expect(await getStoredQboCredentialsMap(TENANT)).toEqual({});
  });

  it('allows a QuickBooks authorization started after finalization to reconnect and retire the finalized row', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    const finalizedAt = Date.parse(recordRows()[0].finalized_at);
    const signingSecret = 'fresh-qbo-state-signing-secret';
    const created = createQboOAuthState({
      tenantId: TENANT,
      userId: USER_ID,
      secret: signingSecret,
      initiatedAt: new Date(finalizedAt + 1).toISOString(),
    });
    await storeAccountingOAuthNonceMock('qbo', created.payload.nonce, {
      tenantId: TENANT,
      initiatedAt: created.payload.initiatedAt,
    });
    providerHarness.calls.length = 0;

    const previousEdition = process.env.EDITION;
    const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
    process.env.EDITION = 'ee';
    process.env.NEXTAUTH_SECRET = signingSecret;
    try {
      const response = await QboCallbackGET(
        new Request(
          `http://localhost:3000/api/integrations/qbo/callback?code=fresh-code&realmId=realm-new&state=${encodeURIComponent(created.stateParam)}`,
          { headers: { cookie: `${QBO_OAUTH_STATE_COOKIE}=${encodeURIComponent(created.cookieValue)}` } },
        ),
      );
      expect(response.headers.get('location') ?? '').toContain('qbo_status=success');
    } finally {
      if (previousEdition === undefined) delete process.env.EDITION;
      else process.env.EDITION = previousEdition;
      if (previousNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
    }

    expect(providerHarness.calls.filter((c) => c.url.includes(QBO_TOKEN_URL))).toHaveLength(1);
    expect(recordRows()).toHaveLength(0);
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toContain('exchanged-rt');
    expect(Object.keys(await getStoredQboCredentialsMap(TENANT))).toEqual(['realm-new']);
  });

  it('upsertStoredQboCredentials refuses to store live credentials while a QuickBooks disconnect is active', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    providerHarness.setQboRevoke(() => providerHarness.fail(500, { error: 'server_error' }));
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(recordRows()[0].status).toBe('pending_revocation');

    // A write that bypasses the callback route guard (token refresh, a direct
    // persistence call) must still fail while the disconnect is active.
    const err = await upsertStoredQboCredentials(TENANT, {
      realmId: 'realm-a',
      accessToken: 'fresh-at',
      refreshToken: 'fresh-rt',
      accessTokenExpiresAt: futureIso(3600_000),
      refreshTokenExpiresAt: futureIso(86_400_000),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err?.message)).toMatch(/being disconnected/i);

    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toContain('rt-a');
    expect(recordRows()[0].status).toBe('pending_revocation');
  });

  it('a callback credential write in flight when disconnect starts serializes with initiation and its credentials are revoked, not resurrected', async () => {
    // Forced interleaving: the callback passes the route-level disconnect
    // check AND the storage-layer gate, then its secret write is paused; a
    // disconnect is requested mid-write; the write is then released. The write
    // and disconnect initiation must serialize — the write completes first and
    // its credentials become revocation targets of the disconnect — so live
    // credentials can never land after the disconnect's sweep and survive it.
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    providerHarness.setQboTokenExchange(() =>
      providerHarness.ok(200, { access_token: 'at-b', refresh_token: 'rt-b', expires_in: 3600, x_refresh_token_expires_in: 8_726_400 }),
    );

    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let signalWriteReached!: () => void;
    const writeReached = new Promise<void>((resolve) => {
      signalWriteReached = resolve;
    });
    setTenantSecretMock.mockImplementation(async (tenant, name, value) => {
      if (name === QBO_STANDARD_SECRET) {
        signalWriteReached();
        await writeGate;
      }
      secretStore.set(tenant, name, value);
    });

    const signingSecret = 'race-test-state-signing-secret';
    const created = createQboOAuthState({ tenantId: TENANT, userId: USER_ID, secret: signingSecret });
    await storeAccountingOAuthNonceMock('qbo', created.payload.nonce, {
      tenantId: TENANT,
      initiatedAt: created.payload.initiatedAt,
    });

    const previousEdition = process.env.EDITION;
    const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
    process.env.EDITION = 'ee';
    process.env.NEXTAUTH_SECRET = signingSecret;
    try {
      const callbackPromise = QboCallbackGET(
        new Request(
          `http://localhost:3000/api/integrations/qbo/callback?code=valid-auth-code&realmId=realm-b&state=${encodeURIComponent(created.stateParam)}`,
          { headers: { cookie: `${QBO_OAUTH_STATE_COOKIE}=${encodeURIComponent(created.cookieValue)}` } },
        ),
      );
      await writeReached;

      // Disconnect requested while the callback's credential write is
      // mid-flight: initiation must wait for the write, so no disconnect
      // record may appear while the write is paused.
      const disconnectPromise = disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
      await flushTasks();
      expect(recordRows()).toHaveLength(0);

      releaseWrite();
      const response = await callbackPromise;
      expect(response.status).toBe(307);
      expect(response.headers.get('location') ?? '').toContain('qbo_status=success');

      const result = await disconnectPromise;
      expect(result.status).toBe('disconnected');
    } finally {
      if (previousEdition === undefined) delete process.env.EDITION;
      else process.env.EDITION = previousEdition;
      if (previousNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
    }

    // The raced write became part of the disconnect cycle: both realms were
    // revoked upstream, the record is finalized over both, and nothing is
    // available locally to ordinary sync.
    const revokeBodies = providerHarness.calls
      .filter((c) => c.url.includes('tokens/revoke') || c.url.endsWith('/revoke'))
      .map((c) => JSON.stringify(c.body));
    expect(revokeBodies.some((b) => b.includes('rt-a'))).toBe(true);
    expect(revokeBodies.some((b) => b.includes('rt-b'))).toBe(true);
    const record = recordRows()[0];
    expect(record.status).toBe('finalized');
    expect(record.targets.map((t: any) => t.targetId).sort()).toEqual(['realm-a', 'realm-b']);
    expect(record.targets.every((t: any) => t.status === 'revoked')).toBe(true);
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();
    expect(await getStoredQboCredentialsMap(TENANT)).toEqual({});
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_QBO)).toBe(false);
  });

  it('a callback that passed the route gate before a disconnect started cannot store credentials once the disconnect is in flight', async () => {
    // Forced interleaving: the callback passes the route-level disconnect
    // check, pauses at the token exchange, a disconnect starts and goes
    // pending, and only then does the callback proceed to store. The storage
    // layer must refuse — the check it shares with initiation is atomic, so
    // the record that now exists is always visible to it.
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    providerHarness.setQboRevoke(() => providerHarness.fail(503, { error: 'server_error' }));

    let releaseExchange!: () => void;
    const exchangeGate = new Promise<void>((resolve) => {
      releaseExchange = resolve;
    });
    let signalExchangeReached!: () => void;
    const exchangeReached = new Promise<void>((resolve) => {
      signalExchangeReached = resolve;
    });
    providerHarness.setQboTokenExchange(async () => {
      signalExchangeReached();
      await exchangeGate;
      return providerHarness.ok(200, { access_token: 'at-b', refresh_token: 'rt-b', expires_in: 3600, x_refresh_token_expires_in: 8_726_400 });
    });

    const signingSecret = 'race-test-state-signing-secret';
    const created = createQboOAuthState({ tenantId: TENANT, userId: USER_ID, secret: signingSecret });
    await storeAccountingOAuthNonceMock('qbo', created.payload.nonce, {
      tenantId: TENANT,
      initiatedAt: created.payload.initiatedAt,
    });

    const previousEdition = process.env.EDITION;
    const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
    process.env.EDITION = 'ee';
    process.env.NEXTAUTH_SECRET = signingSecret;
    try {
      const callbackPromise = QboCallbackGET(
        new Request(
          `http://localhost:3000/api/integrations/qbo/callback?code=valid-auth-code&realmId=realm-b&state=${encodeURIComponent(created.stateParam)}`,
          { headers: { cookie: `${QBO_OAUTH_STATE_COOKIE}=${encodeURIComponent(created.cookieValue)}` } },
        ),
      );
      await exchangeReached;

      // The disconnect starts while the callback is between its gate check
      // and its write, and stays pending on a transient provider failure.
      const pending = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
      expect(pending.status).toBe('pending');
      expect(recordRows()[0].status).toBe('pending_revocation');

      releaseExchange();
      const response = await callbackPromise;
      expect(response.status).toBe(307);
      const location = response.headers.get('location') ?? '';
      expect(location).toContain('qbo_status=failure');
      expect(location).toContain('qbo_error=disconnect_in_progress');
    } finally {
      if (previousEdition === undefined) delete process.env.EDITION;
      else process.env.EDITION = previousEdition;
      if (previousNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
    }

    // Nothing stored: the pending disconnect still owns only the original
    // realm's tombstoned material; the raced tokens never became credentials.
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toContain('rt-a');
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).not.toContain('rt-b');
    expect(await getStoredQboCredentialsMap(TENANT)).toEqual({});
    expect(recordRows()[0].targets.map((t: any) => t.targetId)).toEqual(['realm-a']);

    // The disconnect stays retryable and converges; nothing resurrects after.
    providerHarness.setQboRevoke(() => providerHarness.ok(200, {}));
    const done = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(done.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toBeNull();
    expect(await getStoredQboCredentialsMap(TENANT)).toEqual({});
  });
});

describe('Xero disconnect state machine', () => {
  it('a resumed record with every connection revoked appends and revokes the missing grant before finalizing', async () => {
    seedPendingXeroRecordWithRevokedConnections({
      'conn-a': xeroConnectionMaterial('conn-a', 'rt-a'),
    });
    let statusDuringGrantRevocation: string | undefined;
    providerHarness.setXeroGrantRevoke(() => {
      statusDuringGrantRevocation = recordRows()[0].status;
      return providerHarness.ok(200, {});
    });

    const result = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { fromRetry: true });

    expect(statusDuringGrantRevocation).toBe('pending_revocation');
    expect(result.status).toBe('disconnected');
    expect(providerCalls().filter((call) => call.method === 'delete')).toHaveLength(0);
    expect(providerCalls().filter((call) => call.url.includes('connect/revocation'))).toHaveLength(1);
    expect(recordRows()[0].targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: 'conn-a', status: 'revoked' }),
      expect.objectContaining({ targetId: XERO_GRANT_TARGET_ID, status: 'revoked' }),
    ]));
    expect(recordRows()[0].status).toBe('finalized');
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toBeNull();
  });

  it('a transient grant failure on a resumed record remains retryable and represents persisted revoked work as partial', async () => {
    seedPendingXeroRecordWithRevokedConnections({
      'conn-a': xeroConnectionMaterial('conn-a', 'rt-a'),
    });
    providerHarness.setXeroGrantRevoke(() => providerHarness.fail(503, { error: 'server_error' }));

    const first = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { fromRetry: true });

    expect(first.status).toBe('partial');
    expect(first.record?.status).toBe('pending_revocation');
    expect(recordRows()[0].status).toBe('pending_revocation');
    expect(recordRows()[0].finalized_at).toBeNull();
    expect(new Date(recordRows()[0].next_retry_at).getTime()).toBeGreaterThan(Date.now());
    expect(recordRows()[0].targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: 'conn-a', status: 'revoked' }),
      expect.objectContaining({ targetId: XERO_GRANT_TARGET_ID, status: 'pending_revocation' }),
    ]));
    expect(providerCalls().filter((call) => call.method === 'delete')).toHaveLength(0);
    expect(providerCalls().filter((call) => call.url.includes('connect/revocation'))).toHaveLength(1);
    expect(auditRows()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: 'disconnect_target_failed',
        details: expect.objectContaining({
          target_id: XERO_GRANT_TARGET_ID,
          result: 'transient_failure',
        }),
      }),
      expect.objectContaining({
        operation: 'disconnect_retry_started',
        details: expect.objectContaining({ result: 'pending' }),
      }),
    ]));
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toContain('rt-a');

    providerHarness.setXeroGrantRevoke(() => providerHarness.ok(200, {}));
    const second = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { fromRetry: true });

    expect(second.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(recordRows()[0].targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: 'conn-a', status: 'revoked' }),
      expect.objectContaining({ targetId: XERO_GRANT_TARGET_ID, status: 'revoked' }),
    ]));
    expect(providerCalls().filter((call) => call.method === 'delete')).toHaveLength(0);
    expect(providerCalls().filter((call) => call.url.includes('connect/revocation'))).toHaveLength(2);
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toBeNull();
  });

  it('a permanent grant failure on a resumed record is terminal with revoked connections preserved and can be force-finalized', async () => {
    seedPendingXeroRecordWithRevokedConnections({
      'conn-a': xeroConnectionMaterial('conn-a', 'rt-a'),
    });
    providerHarness.setXeroGrantRevoke(() => providerHarness.fail(400, { error: 'invalid_client' }));

    const failed = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { fromRetry: true });

    expect(failed.status).toBe('failed_permanent');
    expect(failed.record?.status).toBe('failed_permanent');
    expect(recordRows()[0].status).toBe('failed_permanent');
    expect(recordRows()[0].targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: 'conn-a', status: 'revoked' }),
      expect.objectContaining({
        targetId: XERO_GRANT_TARGET_ID,
        status: 'failed_permanent',
        errorClass: expect.stringContaining('invalid_client'),
      }),
    ]));
    expect(recordRows()[0].last_error_class).toContain('invalid_client');
    expect(providerCalls().filter((call) => call.method === 'delete')).toHaveLength(0);
    expect(providerCalls().filter((call) => call.url.includes('connect/revocation'))).toHaveLength(1);
    expect(auditRows()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: 'disconnect_target_failed',
        details: expect.objectContaining({
          target_id: XERO_GRANT_TARGET_ID,
          result: 'permanent_failure',
        }),
      }),
    ]));

    const finalized = await forceFinalizeProviderDisconnect(makeKnex(), TENANT, PROVIDER_XERO, {
      userId: 'admin-1',
      reason: 'Xero grant revocation was rejected permanently.',
    });

    expect(finalized.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toBeNull();
    expect(auditRows()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: 'disconnect_force_finalized',
        details: expect.objectContaining({ result: 'force_finalized' }),
      }),
    ]));
  });

  it('clean success deletes every connection, revokes the grant once, deletes local credentials, finalizes', async () => {
    xeroCredentialSecret({
      'conn-a': xeroConnectionMaterial('conn-a', 'rt-a'),
    });

    const result = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { userId: 'user-1' });

    expect(result.status).toBe('disconnected');

    const deleteCalls = providerCalls().filter((c) => c.method === 'delete');
    expect(deleteCalls).toEqual([
      { method: 'delete', url: 'https://api.xero.com/connections/conn-a', body: undefined },
    ]);
    const revocationCalls = providerCalls().filter((c) => c.url.includes('connect/revocation'));
    expect(revocationCalls).toHaveLength(1);

    expect(secretStore.get(TENANT, XERO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toBeNull();

    expect(recordRows()).toHaveLength(1);
    expect(recordRows()[0].status).toBe('finalized');
    const targetIds = (recordRows()[0].targets as Array<{ targetId: string; status: string }>).map((t) => t.targetId);
    expect(targetIds).toEqual(['conn-a', XERO_GRANT_TARGET_ID]);

    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_XERO)).toBe(false);
    expect(auditRows().map((r) => r.operation)).toEqual(
      expect.arrayContaining(['disconnect_started', 'disconnect_target_revoked', 'disconnect_finalized']),
    );
  });

  it('404 on connection delete counts as already-gone (idempotent provider success)', async () => {
    xeroCredentialSecret({ 'conn-a': xeroConnectionMaterial('conn-a', 'rt-a') });
    providerHarness.setXeroConnection(() => providerHarness.fail(404, { error: 'not_found' }));

    const result = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});

    expect(result.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
  });

  it('transient failure keeps credentials tombstoned, pending with backoff, blocks sync; retry completes', async () => {
    xeroCredentialSecret({ 'conn-a': xeroConnectionMaterial('conn-a', 'rt-a') });
    providerHarness.setXeroConnection(() => providerHarness.fail(500, { error: 'server_error' }));

    const first = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { userId: 'user-1' });

    expect(first.status).toBe('pending');
    expect(recordRows()[0].status).toBe('pending_revocation');
    expect(recordRows()[0].targets[0]).toMatchObject({ targetId: 'conn-a', status: 'pending_revocation' });
    expect(recordRows()[0].last_error_class).toContain('500');
    expect(new Date(recordRows()[0].next_retry_at).getTime()).toBeGreaterThan(Date.now());
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toContain('rt-a');
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_XERO)).toBe(true);

    // The grant revocation must NOT have fired while the connection is pending.
    expect(providerCalls().filter((c) => c.url.includes('connect/revocation'))).toHaveLength(0);

    // Retry: connection delete succeeds, then the grant is revoked in the same
    // pass and the disconnect finalizes.
    providerHarness.setXeroConnection(() => providerHarness.ok(204));
    const second = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { fromRetry: true });
    expect(second.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(providerCalls().filter((c) => c.url.includes('connect/revocation'))).toHaveLength(1);
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toBeNull();
  });

  it('permanent failure → failed_permanent; operator force-finalize finalizes deletion', async () => {
    xeroCredentialSecret({ 'conn-a': xeroConnectionMaterial('conn-a', 'rt-a') });
    providerHarness.setXeroConnection(() => providerHarness.fail(400, { error: 'invalid_client' }));

    const failed = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});

    expect(failed.status).toBe('failed_permanent');
    expect(recordRows()[0].status).toBe('failed_permanent');
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toContain('rt-a');
    expect(providerCalls().filter((c) => c.url.includes('connect/revocation'))).toHaveLength(0);

    const finalized = await forceFinalizeProviderDisconnect(makeKnex(), TENANT, PROVIDER_XERO, {
      userId: 'admin-1',
      reason: 'Xero app credentials invalid; cannot confirm connection removal.',
    });
    expect(finalized.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(recordRows()[0].finalize_reason).toContain('invalid');
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toBeNull();
    expect(auditRows().map((r) => r.operation)).toContain('disconnect_force_finalized');
  });

  it('401 during connection delete triggers an access-token refresh and one retry', async () => {
    xeroCredentialSecret({ 'conn-a': xeroConnectionMaterial('conn-a', 'rt-a') });
    let deletes = 0;
    providerHarness.setXeroConnection(() => {
      deletes += 1;
      return deletes === 1 ? providerHarness.fail(401, { error: 'unauthorized' }) : providerHarness.ok(204);
    });
    providerHarness.setXeroRefresh(() => providerHarness.ok(200, { access_token: 'refreshed-token' }));

    const result = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});

    expect(result.status).toBe('disconnected');
    // Two deletes: the 401 attempt plus the refreshed retry.
    expect(providerCalls().filter((c) => c.method === 'delete')).toHaveLength(2);
    expect(providerCalls().filter((c) => c.url.includes('connect/token'))).toHaveLength(1);
  });

  it('partial multi-tenant: one connection succeeds, one fails; grant only fires after the last tenant goes', async () => {
    xeroCredentialSecret({
      'conn-a': xeroConnectionMaterial('conn-a', 'rt-a'),
      'conn-b': xeroConnectionMaterial('conn-b', 'rt-b'),
    });
    providerHarness.setXeroConnection((connectionId: string) =>
      connectionId === 'conn-b' ? providerHarness.fail(500, { error: 'server_error' }) : providerHarness.ok(204),
    );

    const first = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { userId: 'user-1' });

    expect(first.status).toBe('partial');
    expect(recordRows()[0].status).toBe('pending_revocation');
    const targets = recordRows()[0].targets as Array<{ targetId: string; status: string }>;
    expect(targets.find((t) => t.targetId === 'conn-a')).toMatchObject({ status: 'revoked' });
    expect(targets.find((t) => t.targetId === 'conn-b')).toMatchObject({ status: 'pending_revocation' });
    expect(targets.some((t) => t.targetId === XERO_GRANT_TARGET_ID)).toBe(false);
    // Grant must not fire while a tenant connection is still in flight.
    expect(providerCalls().filter((c) => c.url.includes('connect/revocation'))).toHaveLength(0);

    // The user-visible status shows per-target truth, not success.
    const status = await getProviderDisconnectStatusInfo(makeKnex(), TENANT, PROVIDER_XERO);
    expect(status!.targets.find((t) => t.targetId === 'conn-a')!.status).toBe('revoked');
    expect(status!.targets.find((t) => t.targetId === 'conn-b')!.status).toBe('pending_revocation');

    // Retry: the failed connection recovers and then the grant revocation
    // fires exactly once, after the last connection is gone.
    providerHarness.setXeroConnection(() => providerHarness.ok(204));
    const second = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { fromRetry: true });
    expect(second.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    const grantCalls = providerCalls().filter((c) => c.url.includes('connect/revocation'));
    expect(grantCalls).toHaveLength(1);
    const finalTargets = recordRows()[0].targets as Array<{ targetId: string; status: string }>;
    expect(finalTargets.find((t) => t.targetId === XERO_GRANT_TARGET_ID)).toMatchObject({ status: 'revoked' });
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toBeNull();
  });

  it('tombstoned Xero credentials are unreachable from the ordinary connection-loading path', async () => {
    xeroCredentialSecret({ 'conn-a': xeroConnectionMaterial('conn-a', 'rt-a') });
    expect(Object.keys(await getStoredXeroConnections(TENANT))).toEqual(['conn-a']);

    providerHarness.setXeroConnection(() => providerHarness.fail(500, { error: 'server_error' }));
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});

    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_XERO)).toBe(true);
    expect(await getStoredXeroConnections(TENANT)).toEqual({});
  });

  it('repeated disconnect requests are idempotent and never resurrect credentials', async () => {
    xeroCredentialSecret({ 'conn-a': xeroConnectionMaterial('conn-a', 'rt-a') });
    providerHarness.setXeroConnection(() => providerHarness.fail(500, { error: 'server_error' }));

    const first = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});
    expect(first.status).toBe('pending');

    // Pending re-invocation resumes retry (bounded by backoff in the job) but
    // never writes anything back to the standard credential name.
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});
    expect(secretStore.get(TENANT, XERO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toContain('rt-a');

    // After finalization, further calls are stable no-ops.
    providerHarness.setXeroConnection(() => providerHarness.ok(204));
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { fromRetry: true });
    expect(recordRows()[0].status).toBe('finalized');

    providerHarness.calls.length = 0;
    const again = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});
    expect(again.status).toBe('already_disconnected');
    expect(providerHarness.calls).toHaveLength(0);
    expect(secretStore.get(TENANT, XERO_STANDARD_SECRET)).toBeNull();
  });

  it('reconnect after a finalized disconnect retires the record and the next disconnect runs a real fresh cycle', async () => {
    xeroCredentialSecret({ 'conn-a': xeroConnectionMaterial('conn-a', 'rt-a') });

    // Cycle 1: disconnect completes and finalizes; credentials gone.
    const first = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});
    expect(first.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(secretStore.get(TENANT, XERO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toBeNull();

    // Reconnect: persist fresh credentials via the OAuth storage path. The
    // stale finalized record must be retired before the new connection becomes
    // visible, and a `disconnect_record_retired` audit event must be written.
    const reconnectStartedAt = new Date(Date.parse(recordRows()[0].finalized_at) + 1).toISOString();
    await upsertStoredXeroConnections(TENANT, {
      'conn-a': xeroConnectionMaterial('conn-a', 'rt-a2'),
    }, { authorizationFlowStartedAt: reconnectStartedAt });
    expect(recordRows()).toHaveLength(0);
    expect(auditRows().map((r) => r.operation)).toContain('disconnect_record_retired');
    expect(secretStore.get(TENANT, XERO_STANDARD_SECRET)).toContain('rt-a2');
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_XERO)).toBe(false);

    // Cycle 2: force a transient provider failure so the immediate
    // tombstoning is observable mid-cycle.
    providerHarness.calls.length = 0;
    providerHarness.setXeroConnection(() => providerHarness.fail(500, { error: 'server_error' }));
    const second = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});
    expect(second.status).toBe('pending');

    // The second disconnect tombstoned the fresh live credentials immediately:
    // the ordinary sync/export connection fetch is empty again.
    expect(await getStoredXeroConnections(TENANT)).toEqual({});
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toContain('rt-a2');
    const deleteIds = providerCalls()
      .filter((c) => c.method === 'delete')
      .map((c) => c.url.substring(c.url.lastIndexOf('/') + 1));
    expect(deleteIds).toEqual(['conn-a']);

    // Retry completes the fresh cycle (connection delete + grant revocation);
    // the provider was really called.
    providerHarness.setXeroConnection(() => providerHarness.ok(204));
    const third = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { fromRetry: true });
    expect(third.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toBeNull();
    expect(providerCalls().filter((c) => c.method === 'delete')).toHaveLength(2);
  });

  it('tombstone deletion failure during Xero finalization keeps the record retryable and never finalizes over orphaned material', async () => {
    xeroCredentialSecret({ 'conn-a': xeroConnectionMaterial('conn-a', 'rt-a') });
    // Connection delete and grant revocation succeed; the tombstone deletion throws.
    deleteTenantSecretMock.mockImplementation(async (tenant, name) => {
      if (name === XERO_TOMBSTONE_SECRET) throw new Error('vault unavailable');
      secretStore.delete(tenant, name);
    });

    const first = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { userId: 'user-1' });

    // NOT finalized: retryable record, revoked targets preserved.
    expect(first.status).toBe('partial');
    expect(recordRows()[0].status).toBe('pending_revocation');
    const targets = recordRows()[0].targets as Array<{ targetId: string; status: string }>;
    expect(targets.find((t) => t.targetId === 'conn-a')).toMatchObject({ status: 'revoked' });
    expect(targets.find((t) => t.targetId === XERO_GRANT_TARGET_ID)).toMatchObject({ status: 'revoked' });
    expect(recordRows()[0].last_error_class).toContain('credential_secret_deletion_failed');
    expect(recordRows()[0].finalized_at).toBeUndefined();

    // Provider revocation already burned the work: the retry pass must NOT
    // re-delete the connection or re-revoke the grant.
    expect(providerCalls().filter((c) => c.method === 'delete')).toHaveLength(1);
    expect(providerCalls().filter((c) => c.url.includes('connect/revocation'))).toHaveLength(1);

    // Tombstone retained → sync still blocked.
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toContain('rt-a');
    expect(await getStoredXeroConnections(TENANT)).toEqual({});
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_XERO)).toBe(true);

    expect(auditRows().map((r) => r.operation)).toContain('disconnect_cleanup_failed');
    expect(JSON.stringify(auditRows())).not.toContain('rt-a');

    // Retry with deletion working converges without re-calling the provider.
    deleteTenantSecretMock.mockImplementation(async (tenant, name) => {
      secretStore.delete(tenant, name);
    });
    providerHarness.calls.length = 0;
    const second = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { fromRetry: true });
    expect(second.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toBeNull();
    expect(providerHarness.calls).toHaveLength(0);
  });

  it('a half-completed credential move after the record write is finished by the next pass, which then completes the disconnect', async () => {
    xeroCredentialSecret({
      'conn-1': xeroConnectionMaterial('conn-1', 'xrt-1'),
      'conn-2': xeroConnectionMaterial('conn-2', 'xrt-2'),
    });

    // The move copies credentials to the tombstone name, then the live-secret
    // delete dies — the other half of the initiation crash window.
    deleteTenantSecretMock.mockImplementationOnce(async () => {
      throw new Error('secret store unavailable');
    });

    await expect(
      disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { userId: 'user-1' }),
    ).rejects.toThrow('secret store unavailable');

    // Durable: pending record with both connection targets, due immediately,
    // gates active, tombstone copy retained, no provider call yet.
    expect(recordRows()[0].status).toBe('pending_revocation');
    expect((recordRows()[0].targets as Array<{ targetId: string }>).map((t) => t.targetId).sort()).toEqual([
      'conn-1',
      'conn-2',
    ]);
    expect(await listDueDisconnectRecords(makeKnex(), TENANT)).toHaveLength(1);
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_XERO)).toBe(true);
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toContain('xrt-1');
    expect(secretStore.get(TENANT, XERO_STANDARD_SECRET)).toContain('xrt-1');
    expect(providerHarness.calls).toHaveLength(0);

    // The next pass finishes the interrupted move (the lingering live copy is
    // removed; the tombstoned material stays authoritative) and drives the
    // multi-connection cleanup plus the grant revocation to completion.
    const retry = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, { userId: 'system', fromRetry: true });
    expect(retry.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(secretStore.get(TENANT, XERO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toBeNull();
    expect(providerCalls().filter((c) => c.method === 'delete')).toHaveLength(2);
    expect(providerCalls().filter((c) => c.url.includes('connect/revocation'))).toHaveLength(1);
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_XERO)).toBe(false);
  });

  it('a valid-looking OAuth callback that lands while a Xero disconnect is pending is rejected and never resurrects connections', async () => {
    xeroCredentialSecret({ 'conn-a': xeroConnectionMaterial('conn-a', 'rt-a') });
    const csrfToken = 'a'.repeat(64);
    const nonce = 'race-test-nonce';
    const initiatedAt = new Date(Date.now() - 1000).toISOString();
    const state = await seedXeroConnectAttempt({ nonce, csrf: csrfToken, initiatedAt, verifier: 'race-verifier' });

    providerHarness.setXeroConnection(() => providerHarness.fail(500, { error: 'server_error' }));
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});

    // The race frame: the authorization was issued BEFORE the disconnect
    // started, the callback lands AFTER. Disconnect is pending: connections
    // tombstoned, sync blocked.
    expect(recordRows()[0].status).toBe('pending_revocation');
    expect(await getStoredXeroConnections(TENANT)).toEqual({});
    const targetsBefore = JSON.stringify(recordRows()[0].targets);

    const previousEdition = process.env.EDITION;
    process.env.EDITION = 'ee';
    try {
      const response = await XeroCallbackGET(
        new NextRequest(
          `http://localhost:3000/api/integrations/xero/callback?code=valid-auth-code&state=${state}`,
          { headers: { cookie: `${XERO_OAUTH_CSRF_COOKIE.name}=${csrfToken}` } },
        ),
      );

      // Rejected with a disconnect-specific failure redirect, and neither the
      // token exchange nor the connections fetch ran.
      expect(response.status).toBe(307);
      const location = response.headers.get('location') ?? '';
      expect(location).toContain('xero_status=failure');
      expect(location).toContain('xero_error=disconnect_in_progress');
      expect(providerHarness.calls.filter((c) => c.url.includes('identity.xero.com/connect/token'))).toHaveLength(0);
    } finally {
      if (previousEdition === undefined) delete process.env.EDITION;
      else process.env.EDITION = previousEdition;
    }

    // State untouched: connections stay tombstoned/absent for sync, the
    // disconnect record is still pending with unchanged targets, and the sync
    // gate still blocks.
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toContain('rt-a');
    expect(secretStore.get(TENANT, XERO_STANDARD_SECRET)).toBeNull();
    expect(await getStoredXeroConnections(TENANT)).toEqual({});
    expect(recordRows()[0].status).toBe('pending_revocation');
    expect(JSON.stringify(recordRows()[0].targets)).toBe(targetsBefore);
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_XERO)).toBe(true);
  });

  it('invalidates a pre-disconnect Xero flow so its delayed callback cannot write after clean finalization', async () => {
    xeroCredentialSecret({ 'conn-a': xeroConnectionMaterial('conn-a', 'rt-a') });
    const csrfToken = 'b'.repeat(64);
    const nonce = 'delayed-xero-nonce';
    const initiatedAt = new Date(Date.now() - 1000).toISOString();
    const state = await seedXeroConnectAttempt({ nonce, csrf: csrfToken, initiatedAt, verifier: 'delayed-verifier' });

    const disconnected = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});
    expect(disconnected.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    const finalizedRecord = JSON.stringify(recordRows()[0]);
    providerHarness.calls.length = 0;

    const previousEdition = process.env.EDITION;
    process.env.EDITION = 'ee';
    try {
      const response = await XeroCallbackGET(
        new NextRequest(
          `http://localhost:3000/api/integrations/xero/callback?code=held-code&state=${state}`,
          { headers: { cookie: `${XERO_OAUTH_CSRF_COOKIE.name}=${csrfToken}` } },
        ),
      );
      expect(response.headers.get('location') ?? '').toContain('xero_error=state_replayed');
    } finally {
      if (previousEdition === undefined) delete process.env.EDITION;
      else process.env.EDITION = previousEdition;
    }

    expect(providerHarness.calls.filter((c) => c.url.includes('connect/token'))).toHaveLength(0);
    await expect(upsertStoredXeroConnections(TENANT, {
      'conn-stale': xeroConnectionMaterial('conn-stale', 'stale-rt'),
    }, { authorizationFlowStartedAt: initiatedAt })).rejects.toThrow(/started before/i);
    expect(JSON.stringify(recordRows()[0])).toBe(finalizedRecord);
    expect(secretStore.get(TENANT, XERO_STANDARD_SECRET)).toBeNull();
    expect(await getStoredXeroConnections(TENANT)).toEqual({});
  });

  it('allows a Xero authorization started after finalization to reconnect and retire the finalized row', async () => {
    xeroCredentialSecret({ 'conn-a': xeroConnectionMaterial('conn-a', 'rt-a') });
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});
    const initiatedAt = new Date(Date.parse(recordRows()[0].finalized_at) + 1).toISOString();
    const csrfToken = 'c'.repeat(64);
    const nonce = 'fresh-xero-nonce';
    const state = await seedXeroConnectAttempt({ nonce, csrf: csrfToken, initiatedAt, verifier: 'fresh-verifier' });
    providerHarness.setXeroRefresh(() => providerHarness.ok(200, {
      access_token: 'fresh-at',
      refresh_token: 'fresh-rt',
      expires_in: 1800,
      refresh_token_expires_in: 7_776_000,
    }));
    providerHarness.setXeroConnectionsList(() => providerHarness.ok(200, [
      { id: 'conn-new', tenantId: 'xero-new', tenantName: 'New Org' },
    ]));
    providerHarness.calls.length = 0;

    const previousEdition = process.env.EDITION;
    process.env.EDITION = 'ee';
    try {
      const response = await XeroCallbackGET(
        new NextRequest(
          `http://localhost:3000/api/integrations/xero/callback?code=fresh-code&state=${state}`,
          { headers: { cookie: `${XERO_OAUTH_CSRF_COOKIE.name}=${csrfToken}` } },
        ),
      );
      expect(response.headers.get('location') ?? '').toContain('xero_status=success');
    } finally {
      if (previousEdition === undefined) delete process.env.EDITION;
      else process.env.EDITION = previousEdition;
    }

    expect(providerHarness.calls.filter((c) => c.url.includes('connect/token'))).toHaveLength(1);
    expect(recordRows()).toHaveLength(0);
    expect(secretStore.get(TENANT, XERO_STANDARD_SECRET)).toContain('fresh-rt');
    expect(Object.keys(await getStoredXeroConnections(TENANT))).toEqual(['conn-new']);
  });

  it('upsertStoredXeroConnections refuses to store live connections while a Xero disconnect is active', async () => {
    xeroCredentialSecret({ 'conn-a': xeroConnectionMaterial('conn-a', 'rt-a') });
    providerHarness.setXeroConnection(() => providerHarness.fail(500, { error: 'server_error' }));
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});
    expect(recordRows()[0].status).toBe('pending_revocation');

    const err = await upsertStoredXeroConnections(TENANT, {
      'conn-a': xeroConnectionMaterial('conn-a', 'fresh-rt'),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err?.message)).toMatch(/being disconnected/i);

    expect(secretStore.get(TENANT, XERO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toContain('rt-a');
    expect(recordRows()[0].status).toBe('pending_revocation');
  });

  it('a callback connection write in flight when disconnect starts serializes with initiation and its connections are revoked, not resurrected', async () => {
    // Forced interleaving: the callback passes the route-level disconnect
    // check AND the storage-layer gate, then its secret write is paused; a
    // disconnect is requested mid-write; the write is then released. The write
    // and disconnect initiation must serialize — the write completes first and
    // its connections become revocation targets of the disconnect — so live
    // connections can never land after the disconnect's sweep and survive it.
    xeroCredentialSecret({ 'conn-a': xeroConnectionMaterial('conn-a', 'rt-a') });
    providerHarness.setXeroRefresh(() =>
      providerHarness.ok(200, { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 1800, refresh_token_expires_in: 7_776_000 }),
    );
    providerHarness.setXeroConnectionsList(() =>
      providerHarness.ok(200, [{ id: 'conn-b', tenantId: 'xt-b', tenantName: 'Org B' }]),
    );

    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let signalWriteReached!: () => void;
    const writeReached = new Promise<void>((resolve) => {
      signalWriteReached = resolve;
    });
    setTenantSecretMock.mockImplementation(async (tenant, name, value) => {
      if (name === XERO_STANDARD_SECRET) {
        signalWriteReached();
        await writeGate;
      }
      secretStore.set(tenant, name, value);
    });

    const csrfToken = 'a'.repeat(64);
    const nonce = 'race-write-nonce';
    const initiatedAt = new Date().toISOString();
    const state = await seedXeroConnectAttempt({ nonce, csrf: csrfToken, initiatedAt, verifier: 'race-verifier' });

    const previousEdition = process.env.EDITION;
    process.env.EDITION = 'ee';
    try {
      const callbackPromise = XeroCallbackGET(
        new NextRequest(
          `http://localhost:3000/api/integrations/xero/callback?code=valid-auth-code&state=${state}`,
          { headers: { cookie: `${XERO_OAUTH_CSRF_COOKIE.name}=${csrfToken}` } },
        ),
      );
      await writeReached;

      // Disconnect requested while the callback's connection write is
      // mid-flight: initiation must wait for the write, so no disconnect
      // record may appear while the write is paused.
      const disconnectPromise = disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});
      await flushTasks();
      expect(recordRows()).toHaveLength(0);

      releaseWrite();
      const response = await callbackPromise;
      expect(response.status).toBe(307);
      expect(response.headers.get('location') ?? '').toContain('xero_status=success');

      const result = await disconnectPromise;
      expect(result.status).toBe('disconnected');
    } finally {
      if (previousEdition === undefined) delete process.env.EDITION;
      else process.env.EDITION = previousEdition;
    }

    // The raced write became part of the disconnect cycle: both connections
    // were deleted upstream, the grant was revoked after the last one, the
    // record is finalized over all targets, and nothing is available locally
    // to ordinary sync.
    const deleteUrls = providerHarness.calls.filter((c) => c.method === 'delete').map((c) => c.url);
    expect(deleteUrls.some((url) => url.endsWith('/conn-a'))).toBe(true);
    expect(deleteUrls.some((url) => url.endsWith('/conn-b'))).toBe(true);
    expect(providerHarness.calls.some((c) => c.url.includes('connect/revocation'))).toBe(true);
    const record = recordRows()[0];
    expect(record.status).toBe('finalized');
    expect(record.targets.map((t: any) => t.targetId).sort()).toEqual([XERO_GRANT_TARGET_ID, 'conn-a', 'conn-b']);
    expect(record.targets.every((t: any) => t.status === 'revoked')).toBe(true);
    expect(secretStore.get(TENANT, XERO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toBeNull();
    expect(await getStoredXeroConnections(TENANT)).toEqual({});
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_XERO)).toBe(false);
  });

  it('a callback that passed the route gate before a disconnect started cannot store connections once the disconnect is in flight', async () => {
    // Forced interleaving: the callback passes the route-level disconnect
    // check, pauses at the token exchange, a disconnect starts and goes
    // pending, and only then does the callback proceed to store. The storage
    // layer must refuse — the check it shares with initiation is atomic, so
    // the record that now exists is always visible to it.
    xeroCredentialSecret({ 'conn-a': xeroConnectionMaterial('conn-a', 'rt-a') });
    providerHarness.setXeroConnection(() => providerHarness.fail(503, { error: 'server_error' }));
    providerHarness.setXeroConnectionsList(() =>
      providerHarness.ok(200, [{ id: 'conn-b', tenantId: 'xt-b', tenantName: 'Org B' }]),
    );

    let releaseExchange!: () => void;
    const exchangeGate = new Promise<void>((resolve) => {
      releaseExchange = resolve;
    });
    let signalExchangeReached!: () => void;
    const exchangeReached = new Promise<void>((resolve) => {
      signalExchangeReached = resolve;
    });
    providerHarness.setXeroRefresh(async () => {
      signalExchangeReached();
      await exchangeGate;
      return providerHarness.ok(200, { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 1800, refresh_token_expires_in: 7_776_000 });
    });

    const csrfToken = 'a'.repeat(64);
    const nonce = 'race-gate-nonce';
    const initiatedAt = new Date().toISOString();
    const state = await seedXeroConnectAttempt({ nonce, csrf: csrfToken, initiatedAt, verifier: 'race-verifier' });

    const previousEdition = process.env.EDITION;
    process.env.EDITION = 'ee';
    try {
      const callbackPromise = XeroCallbackGET(
        new NextRequest(
          `http://localhost:3000/api/integrations/xero/callback?code=valid-auth-code&state=${state}`,
          { headers: { cookie: `${XERO_OAUTH_CSRF_COOKIE.name}=${csrfToken}` } },
        ),
      );
      await exchangeReached;

      // The disconnect starts while the callback is between its gate check
      // and its write, and stays pending on a transient provider failure.
      const pending = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});
      expect(pending.status).toBe('pending');
      expect(recordRows()[0].status).toBe('pending_revocation');

      releaseExchange();
      const response = await callbackPromise;
      expect(response.status).toBe(307);
      const location = response.headers.get('location') ?? '';
      expect(location).toContain('xero_status=failure');
      expect(location).toContain('xero_error=disconnect_in_progress');
    } finally {
      if (previousEdition === undefined) delete process.env.EDITION;
      else process.env.EDITION = previousEdition;
    }

    // Nothing stored: the pending disconnect still owns only the original
    // connection's tombstoned material; the raced tokens never became
    // connections.
    expect(secretStore.get(TENANT, XERO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).toContain('rt-a');
    expect(secretStore.get(TENANT, XERO_TOMBSTONE_SECRET)).not.toContain('rt-new');
    expect(await getStoredXeroConnections(TENANT)).toEqual({});
    expect(recordRows()[0].targets.map((t: any) => t.targetId)).toEqual(['conn-a']);

    // The disconnect stays retryable and converges; nothing resurrects after.
    providerHarness.setXeroConnection(() => providerHarness.ok(204));
    const done = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});
    expect(done.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(secretStore.get(TENANT, XERO_STANDARD_SECRET)).toBeNull();
    expect(await getStoredXeroConnections(TENANT)).toEqual({});
  });
});

describe('provider disconnect — shared behavior', () => {
  it('disconnecting with nothing connected records a finalized marker and is a stable no-op', async () => {
    const qboResult = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(qboResult.status).toBe('no_credentials');
    expect(recordRows()[0].status).toBe('finalized');

    const again = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(again.status).toBe('already_disconnected');
    expect(providerHarness.calls).toHaveLength(0);
  });

  it('retry-budget exhaustion turns a persistently transient target into an operator-finalizable state', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    providerHarness.setQboRevoke(() => providerHarness.fail(500, { error: 'server_error' }));

    // First pass goes pending (attempt 1) — the provider keeps failing.
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, { userId: 'user-1' });
    expect(recordRows()[0].status).toBe('pending_revocation');

    // Simulate the retry job having spent the bounded budget over time.
    recordRows()[0].attempt_count = MAX_RETRY_ATTEMPTS;
    const callsBeforeExhaust = providerHarness.calls.length;

    const exhausted = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, { fromRetry: true });

    expect(exhausted.status).toBe('failed_permanent');
    expect(recordRows()[0].status).toBe('failed_permanent');
    expect(recordRows()[0].next_retry_at).toBeNull();
    expect(recordRows()[0].last_error_class).toBe('retry_budget_exhausted');
    expect(recordRows()[0].targets[0]).toMatchObject({ targetId: 'realm-a', status: 'failed_permanent' });
    // The exhausting pass made no further provider calls.
    expect(providerHarness.calls.length).toBe(callsBeforeExhaust);
    // A single audit event marks the budget crossing.
    const budgetEvents = auditRows().filter((r) => r.operation === 'disconnect_retry_budget_exhausted');
    expect(budgetEvents).toHaveLength(1);

    // Operator force-finalize now succeeds with reason + audit.
    const finalized = await forceFinalizeProviderDisconnect(makeKnex(), TENANT, PROVIDER_QBO, {
      userId: 'admin-1',
      reason: 'Provider kept failing for over a day; operator confirms local removal.',
    });
    expect(finalized.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(recordRows()[0].finalize_reason).toContain('operator confirms');
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();
    expect(auditRows().map((r) => r.operation)).toContain('disconnect_force_finalized');
  });

  it('force-finalize is still refused while the retry budget is not yet exhausted', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    providerHarness.setQboRevoke(() => providerHarness.fail(500, { error: 'server_error' }));

    await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(recordRows()[0].status).toBe('pending_revocation');
    expect(recordRows()[0].attempt_count).toBeLessThan(MAX_RETRY_ATTEMPTS);

    const refused = await forceFinalizeProviderDisconnect(makeKnex(), TENANT, PROVIDER_QBO, {
      userId: 'admin-1',
      reason: 'skip the retry budget',
    });
    expect(refused.status).toBe('pending');
    expect(recordRows()[0].status).toBe('pending_revocation');
    expect(recordRows()[0].finalize_reason).toBeUndefined();
  });

  it('force-finalize does not report success when its audit event cannot be persisted', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    providerHarness.setQboRevoke(() => providerHarness.fail(401, { error: 'invalid_client' }));
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(recordRows()[0].status).toBe('failed_permanent');

    // The audit write inside the terminal transaction dies (audit store
    // unavailable) — the transition must not commit or be reported as done.
    const failingKnex = {
      fn: { now: () => new Date().toISOString() },
      transaction: async (cb: any) =>
        cb({
          fn: { now: () => new Date().toISOString() },
          raw: async () => {
            throw new Error('audit store unavailable');
          },
        }),
      raw: async () => ({ rows: [] }),
    } as unknown as Knex;

    await expect(
      forceFinalizeProviderDisconnect(failingKnex, TENANT, PROVIDER_QBO, {
        userId: 'admin-1',
        reason: 'provider tenant deleted upstream',
      }),
    ).rejects.toThrow('audit store unavailable');

    // Still operator-actionable, never finalized without its audit row.
    expect(recordRows()[0].status).toBe('failed_permanent');
    expect(recordRows()[0].finalize_reason).toBeUndefined();
    expect(auditRows().map((r) => r.operation)).not.toContain('disconnect_force_finalized');
    expect(await isProviderDisconnectActive(makeKnex(), TENANT, PROVIDER_QBO)).toBe(true);

    // Retrying once the audit store is healthy converges: finalized WITH the
    // audit event, even though the failed attempt already deleted the secret.
    const retry = await forceFinalizeProviderDisconnect(makeKnex(), TENANT, PROVIDER_QBO, {
      userId: 'admin-1',
      reason: 'provider tenant deleted upstream',
    });
    expect(retry.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    expect(recordRows()[0].finalize_reason).toBe('provider tenant deleted upstream');
    expect(auditRows().map((r) => r.operation)).toContain('disconnect_force_finalized');
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();
  });

  it('finalized record with no credentials anywhere still returns already_disconnected', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(recordRows()[0].status).toBe('finalized');
    // Finalization cleared both the live and tombstoned credential names.
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();

    providerHarness.calls.length = 0;
    const again = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(again.status).toBe('already_disconnected');
    expect(providerHarness.calls).toHaveLength(0);
    expect(recordRows()[0].status).toBe('finalized');
  });

  it('finalized record with live credentials starts a fresh cycle with a new correlation id (defense in depth)', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });

    // Cycle 1 completes and finalizes.
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(recordRows()[0].status).toBe('finalized');
    const firstCorrelationId = recordRows()[0].correlation_id;
    expect(firstCorrelationId).toBeTruthy();

    // Simulate a reconnect path that failed to retire the row: fresh live
    // credentials are stored while the finalized record is left in place.
    qboCredentialSecret({ 'realm-b': { realmId: 'realm-b', refreshToken: 'rt-b' } });
    expect(recordRows()).toHaveLength(1);
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toContain('rt-b');

    providerHarness.calls.length = 0;
    const result = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});

    // A fresh cycle ran against the current live credentials — not a
    // short-circuit.
    expect(result.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    // New cycle: new correlation id, targets recomputed from live credentials.
    expect(recordRows()[0].correlation_id).not.toBe(firstCorrelationId);
    const targets = recordRows()[0].targets as Array<{ targetId: string; status: string }>;
    expect(targets).toEqual([expect.objectContaining({ targetId: 'realm-b', status: 'revoked' })]);
    const revokeTokens = providerCalls()
      .filter((c) => c.url.includes('tokens/revoke'))
      .map((c) => (c.body as { token: string }).token);
    expect(revokeTokens).toEqual(['rt-b']);
    expect(revokeTokens).not.toContain('rt-a');
    expect(secretStore.get(TENANT, QBO_STANDARD_SECRET)).toBeNull();
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();
  });

  it('failed_permanent record with live credentials also starts a fresh cycle (reconnect supersedes a stale operator state)', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    providerHarness.setQboRevoke(() => providerHarness.fail(400, { error: 'invalid_client' }));

    // Cycle 1 lands in the operator-actionable terminal state.
    const failed = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(failed.status).toBe('failed_permanent');
    expect(recordRows()[0].status).toBe('failed_permanent');

    // Fresh live credentials appear (a reconnect that bypassed the guarded
    // connect route, e.g. a manual secret write). The stale tombstoned material
    // from the failed cycle must NOT become the next cycle's targets.
    qboCredentialSecret({ 'realm-b': { realmId: 'realm-b', refreshToken: 'rt-b' } });

    providerHarness.calls.length = 0;
    providerHarness.setQboRevoke(() => providerHarness.ok(200, {}));
    const result = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(result.status).toBe('disconnected');
    expect(recordRows()[0].status).toBe('finalized');
    const revokeTokens = providerCalls()
      .filter((c) => c.url.includes('tokens/revoke'))
      .map((c) => (c.body as { token: string }).token);
    expect(revokeTokens).toEqual(['rt-b']);
    expect(recordRows()[0].targets as Array<{ targetId: string }>).toEqual([
      expect.objectContaining({ targetId: 'realm-b' }),
    ]);
  });

  it('never logs tokens, secrets, or raw provider bodies', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-secret-token-value' } });
    // The provider body carries a distinctive description that must never
    // appear in logs or audit rows (only the sanitized error class may).
    providerHarness.setQboRevoke(() =>
      providerHarness.fail(500, { error: 'server_error', error_description: 'distinctive-raw-body-leak' }),
    );

    await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});

    const logged = JSON.stringify([
      ...loggerMock.info.mock.calls,
      ...loggerMock.warn.mock.calls,
      ...loggerMock.error.mock.calls,
    ]);
    expect(logged).not.toContain('rt-secret-token-value');
    expect(logged).not.toContain('distinctive-raw-body-leak');
    expect(JSON.stringify(auditRows())).not.toContain('rt-secret-token-value');
    expect(JSON.stringify(auditRows())).not.toContain('distinctive-raw-body-leak');
  });
});

describe('env-driven provider endpoint overrides (dev-only, default to real hosts)', () => {
  const OVERRIDES: Record<string, string> = {
    QBO_OAUTH_REVOKE_URL: 'http://127.0.0.1:4901/qbo/oauth2/v1/revoke',
    XERO_OAUTH_TOKEN_URL: 'http://127.0.0.1:4901/xero/connect/token',
    XERO_CONNECTIONS_URL: 'http://127.0.0.1:4901/xero/connections',
    XERO_REVOCATION_URL: 'http://127.0.0.1:4901/xero/connect/revocation',
  };

  const clearOverrides = () => {
    for (const key of Object.keys(OVERRIDES)) {
      delete process.env[key];
    }
  };

  beforeEach(() => {
    clearOverrides();
  });

  afterEach(() => {
    clearOverrides();
  });

  it('points the QBO revoker at the override URL without changing default behavior when unset', async () => {
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });

    // Default (no env): the real Intuit host.
    await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(providerCalls()).toEqual([
      { method: 'post', url: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke', body: { token: 'rt-a' } },
    ]);
    expect(secretStore.get(TENANT, QBO_TOMBSTONE_SECRET)).toBeNull();

    // Override set: the disconnect revoker targets the simulator.
    providerHarness.reset();
    qboCredentialSecret({ 'realm-a': { realmId: 'realm-a', refreshToken: 'rt-a' } });
    process.env.QBO_OAUTH_REVOKE_URL = OVERRIDES.QBO_OAUTH_REVOKE_URL;

    const result = await disconnectProvider(makeKnex(), TENANT, PROVIDER_QBO, {});
    expect(result.status).toBe('disconnected');
    expect(providerCalls()).toEqual([
      { method: 'post', url: OVERRIDES.QBO_OAUTH_REVOKE_URL, body: { token: 'rt-a' } },
    ]);
    expect(recordRows()[0].status).toBe('finalized');
  });

  it('points the Xero refresh, connection delete, and grant revocation at the override URLs', async () => {
    // Expire the access token so the revoker must refresh through the token
    // endpoint before deleting the connection, exercising all three overrides.
    xeroCredentialSecret({
      'conn-a': {
        connectionId: 'conn-a',
        xeroTenantId: 'conn-a',
        accessToken: 'access-conn-a',
        accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        refreshToken: 'rt-xero',
        refreshTokenExpiresAt: futureIso(86_400_000),
      },
    });
    Object.assign(process.env, OVERRIDES);

    const result = await disconnectProvider(makeKnex(), TENANT, PROVIDER_XERO, {});
    expect(result.status).toBe('disconnected');

    const urls = providerCalls().map((c) => c.url);
    expect(urls).toContain(OVERRIDES.XERO_OAUTH_TOKEN_URL);
    expect(urls).toContain(`${OVERRIDES.XERO_CONNECTIONS_URL}/conn-a`);
    expect(urls).toContain(OVERRIDES.XERO_REVOCATION_URL);
    // No production host was reached.
    expect(JSON.stringify(providerCalls())).not.toContain('https://api.xero.com');
    expect(JSON.stringify(providerCalls())).not.toContain('https://identity.xero.com');
    expect(JSON.stringify(providerCalls())).not.toContain('https://developer.api.intuit.com');
    expect(recordRows()[0].status).toBe('finalized');
  });
});
