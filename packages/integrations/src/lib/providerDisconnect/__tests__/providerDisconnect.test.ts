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
  let xeroConnection: Handler = () => ok(204);
  let xeroRefresh: Handler = () => ok(200, { access_token: 'refreshed-token' });
  let xeroGrantRevoke: Handler = () => ok(200, {});

  function respond(result: any): any {
    if (result?.throw) throw result.throw;
    // A handler that returned a ready-made axios-style error must propagate it.
    if (result?.isAxiosError) throw result;
    if (result?.error) return fail(result.status ?? 400, result.error);
    return ok(result?.status ?? 200, result?.data ?? {});
  }

  async function post(url: string, data?: unknown, config?: { headers?: Record<string, unknown> }): Promise<any> {
    calls.push({ method: 'post', url, body: data, authorization: config?.headers?.Authorization as string | undefined });
    if (url.includes('developer.api.intuit.com/v2/oauth2/tokens/revoke')) {
      return respond(qboRevoke(data));
    }
    if (url.includes('identity.xero.com/connect/revocation')) {
      return respond(xeroGrantRevoke(data));
    }
    if (url.includes('identity.xero.com/connect/token')) {
      return respond(xeroRefresh(data));
    }
    return ok(200, {});
  }

  async function del(url: string, config?: { headers?: Record<string, unknown> }): Promise<any> {
    calls.push({ method: 'delete', url, authorization: config?.headers?.Authorization as string | undefined });
    const connectionId = decodeURIComponent(url.substring(url.lastIndexOf('/') + 1));
    return respond(xeroConnection(connectionId));
  }

  return {
    calls,
    reset,
    fail,
    ok,
    post,
    del,
    setQboRevoke: (h: Handler) => {
      qboRevoke = h;
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

// ── Module seams ────────────────────────────────────────────────────────────
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      if (!fakeDb.tables[name]) fakeDb.tables[name] = [];
      return new MemQuery(fakeDb.tables[name]);
    },
  }),
  createTenantKnex: async () => ({
    knex: {
      fn: { now: () => new Date().toISOString() },
      transaction: async (cb: (trx: any) => Promise<any>) =>
        cb({
          fn: { now: () => new Date().toISOString() },
          transaction: async (cb2: (trx: any) => Promise<any>) => cb2(undefined),
          raw: async () => ({ rows: [] }),
        }),
      raw: async () => ({ rows: [] }),
    },
    tenant: 'tenant-1',
  }),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: getTenantSecretMock,
    setTenantSecret: setTenantSecretMock,
    deleteTenantSecret: deleteTenantSecretMock,
  }),
}));

vi.mock('@alga-psa/core/logger', () => ({ default: loggerMock }));

vi.mock('axios', () => ({
  default: {
    post: providerHarness.post,
    delete: providerHarness.del,
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
import { getStoredQboCredentialsMap, upsertStoredQboCredentials } from '../../qbo/qboClientService';
import { getStoredXeroConnections, upsertStoredXeroConnections } from '../../xero/xeroClientService';

const TENANT = 'tenant-1';

function makeKnex(): Knex {
  return {
    fn: { now: () => new Date().toISOString() },
    transaction: async (cb: any) => cb(makeKnex()),
    raw: async () => ({ rows: [] }),
  } as unknown as Knex;
}

function futureIso(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
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

function providerCalls(): Array<{ method: string; url: string; body?: unknown }> {
  return providerHarness.calls.map(({ method, url, body }) => ({ method, url, body }));
}

beforeEach(() => {
  fakeDb.reset();
  secretStore.reset();
  providerHarness.reset();
  vi.clearAllMocks();

  resolveQboOAuthCredentialsMock.mockResolvedValue({ clientId: 'qbo-client', clientSecret: 'qbo-secret', source: 'app' });
  resolveXeroOAuthCredentialsMock.mockResolvedValue({ clientId: 'xero-client', clientSecret: 'xero-secret', source: 'app' });
  providerHarness.setQboRevoke(() => providerHarness.ok(200, {}));
  providerHarness.setXeroConnection(() => providerHarness.ok(204));
  providerHarness.setXeroRefresh(() => providerHarness.ok(200, { access_token: 'refreshed-token' }));
  providerHarness.setXeroGrantRevoke(() => providerHarness.ok(200, {}));
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
    await upsertStoredQboCredentials(TENANT, {
      realmId: 'realm-a',
      accessToken: 'at-a2',
      refreshToken: 'rt-a2',
      accessTokenExpiresAt: futureIso(3600_000),
      refreshTokenExpiresAt: futureIso(86_400_000),
    });
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
});

describe('Xero disconnect state machine', () => {
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
    await upsertStoredXeroConnections(TENANT, {
      'conn-a': xeroConnectionMaterial('conn-a', 'rt-a2'),
    });
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
