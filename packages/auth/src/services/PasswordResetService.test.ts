import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

// A recording query builder: every chained call is logged as an op, and the
// awaited result comes from the test's handler for that table. This keeps the
// assertions on what the service asks the database, not on knex internals.
type Op = [string, unknown[]];
interface Call { table: string; tenant: string; unscoped?: string; ops: Op[] }
type Handler = (call: Call) => unknown;

const calls: Call[] = [];
let handler: Handler = () => undefined;

function builder(table: string, tenant: string, unscoped?: string) {
  const call: Call = { table, tenant, unscoped, ops: [] };
  calls.push(call);
  const chain: Record<string, unknown> = {
    then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
      try { resolve(handler(call)); } catch (error) { reject(error); }
    },
  };
  for (const op of ['where', 'select', 'first', 'insert', 'returning', 'update', 'del', 'orderBy', 'limit']) {
    chain[op] = (...args: unknown[]) => { call.ops.push([op, args]); return chain; };
  }
  return chain;
}

const NOW = { sql: 'now()' };
const trx = {
  fn: { now: () => NOW },
  raw: (sql: string, bindings?: unknown[]) => ({ sql, bindings }),
} as never;

const { checkPasswordResetLimitMock, getCurrentUserMock } = vi.hoisted(() => ({
  checkPasswordResetLimitMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async (tenantId?: string) => ({ knex: trx, tenant: tenantId }),
  withTransaction: async (_knex: unknown, fn: (t: unknown) => unknown) => fn(trx),
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: (name: string) => builder(name, tenant),
    unscoped: (name: string, reason: string) => builder(name, tenant, reason),
    tenantJoin: (query: { ops: Op[] } & Record<string, unknown>, joinTable: string, left: string, right: string) => {
      const call = calls[calls.length - 1];
      call.ops.push(['tenantJoin', [joinTable, left, right]]);
      return query;
    },
  }),
}));

vi.mock('../lib/security/rateLimiting', () => ({
  checkPasswordResetLimit: (...args: unknown[]) => checkPasswordResetLimitMock(...args),
  formatRateLimitError: async (ms?: number) => `limited ${ms ?? 'unknown'}`,
}));

vi.mock('../lib/getCurrentUser', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
}));

import { PasswordResetService } from './PasswordResetService';

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const opsOf = (call: Call) => call.ops.map(([name]) => name);
const opArgs = (call: Call, name: string) => call.ops.filter(([op]) => op === name).map(([, args]) => args);
const byTable = (table: string) => calls.filter((call) => call.table === table);

beforeEach(() => {
  calls.length = 0;
  handler = () => undefined;
  checkPasswordResetLimitMock.mockReset().mockResolvedValue({ success: true, remainingPoints: 2 });
  getCurrentUserMock.mockReset().mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('token primitives', () => {
  it('generates 32 random bytes as hex and never repeats', () => {
    const a = PasswordResetService.generateSecureToken();
    const b = PasswordResetService.generateSecureToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('hashes with SHA-256', () => {
    expect(PasswordResetService.hashToken('abc')).toBe(sha256('abc'));
  });

  it('compares in constant shape: equal, different, different length', () => {
    expect(PasswordResetService.secureCompare('abcd', 'abcd')).toBe(true);
    expect(PasswordResetService.secureCompare('abcd', 'abce')).toBe(false);
    expect(PasswordResetService.secureCompare('abcd', 'abc')).toBe(false);
  });
});

describe('createResetTokenWithTransaction', () => {
  const user = { user_id: 'u1', email: 'ada@example.com' };

  it('refuses when the rate limit is exhausted and touches nothing', async () => {
    checkPasswordResetLimitMock.mockResolvedValue({ success: false, msBeforeNext: 60_000 });
    const result = await PasswordResetService.createResetTokenWithTransaction('Ada@Example.com', 'internal', trx, 't1');
    expect(result).toEqual({ success: false, error: 'limited 60000' });
    expect(calls).toHaveLength(0);
  });

  it('answers an unknown email exactly like a known one without creating anything', async () => {
    handler = () => undefined;
    const result = await PasswordResetService.createResetTokenWithTransaction('Nobody@Example.com', 'client', trx, 't1');
    expect(result).toEqual({ success: true, tokenId: 'dummy', token: 'dummy', userId: 'dummy' });
    const lookup = byTable('users')[0];
    expect(lookup.tenant).toBe('t1');
    expect(opArgs(lookup, 'where')[0]).toEqual([{ email: 'nobody@example.com', user_type: 'client', is_inactive: false }]);
    expect(byTable('password_reset_tokens').some((call) => opsOf(call).includes('insert'))).toBe(false);
  });

  it('purges expired tokens, invalidates the previous ones and stores only the hash', async () => {
    handler = (call) => {
      if (call.table === 'users') return user;
      if (opsOf(call).includes('insert')) return [{ token_id: 'tok-1', user_id: 'u1' }];
      return 1;
    };
    const result = await PasswordResetService.createResetTokenWithTransaction('ada@example.com', 'internal', trx, 't1');
    expect(result.success).toBe(true);
    expect(result).toMatchObject({ tokenId: 'tok-1', userId: 'u1' });
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);

    const tokenCalls = byTable('password_reset_tokens');
    expect(tokenCalls.every((call) => call.tenant === 't1')).toBe(true);

    const purge = tokenCalls.find((call) => opsOf(call).includes('del'))!;
    expect(opArgs(purge, 'where')[0]).toEqual(['expires_at', '<', NOW]);

    const invalidate = tokenCalls.find((call) => opsOf(call).includes('update'))!;
    expect(opArgs(invalidate, 'where')[0]).toEqual([{ user_id: 'u1', used_at: null }]);
    const [patch] = opArgs(invalidate, 'update')[0] as [{ used_at: unknown; metadata: { sql: string; bindings: string[] } }];
    expect(patch.used_at).toBe(NOW);
    expect(JSON.parse(patch.metadata.bindings[0])).toMatchObject({ invalidated: true, reason: 'new_token_requested' });

    const insert = tokenCalls.find((call) => opsOf(call).includes('insert'))!;
    const [row] = opArgs(insert, 'insert')[0] as [Record<string, unknown>];
    expect(row.token_hash).toBe(sha256(result.token!));
    expect(JSON.stringify(row)).not.toContain(result.token);
    expect(row).toMatchObject({ tenant: 't1', user_id: 'u1', email: 'ada@example.com', user_type: 'internal' });
    expect(row.expires_at).toEqual({ sql: "now() + interval '1 hour'", bindings: undefined });
    expect(opArgs(insert, 'returning')[0]).toEqual([['token_id', 'user_id']]);
  });

  it('turns a database failure into a generic error', async () => {
    handler = () => { throw new Error('connection reset by peer'); };
    const result = await PasswordResetService.createResetTokenWithTransaction('ada@example.com', 'internal', trx, 't1');
    expect(result).toEqual({ success: false, error: 'Failed to create reset token' });
  });
});

describe('createResetToken', () => {
  it('requires a tenant context', async () => {
    const result = await PasswordResetService.createResetToken('ada@example.com');
    expect(result).toEqual({ success: false, error: 'Tenant context is required' });
    expect(calls).toHaveLength(0);
  });

  it('runs the transactional flow for the given tenant', async () => {
    handler = () => undefined;
    const result = await PasswordResetService.createResetToken('ada@example.com', 'internal', 't9');
    expect(result.success).toBe(true);
    expect(byTable('users')[0].tenant).toBe('t9');
  });
});

describe('verifyToken', () => {
  it('discovers the tenant by hash only, unused and unexpired', async () => {
    handler = () => undefined;
    const result = await PasswordResetService.verifyToken('plain-token');
    expect(result).toEqual({ valid: false, error: 'Invalid or expired reset token' });
    const discovery = calls[0];
    expect(discovery.unscoped).toMatch(/tenant discovery/);
    expect(opArgs(discovery, 'where')).toEqual([
      [{ token_hash: sha256('plain-token'), used_at: null }],
      ['expires_at', '>', NOW],
    ]);
    expect(JSON.stringify(calls)).not.toContain('plain-token');
  });

  it('returns the user and token from the token tenant after purging that tenant', async () => {
    const row = {
      tenant: 't2', token_id: 'tok-1', user_id: 'u1', token_hash: sha256('plain-token'), email: 'ada@example.com',
      user_type: 'client', expires_at: 'later', created_at: 'earlier', used_at: null, metadata: { requested_by: 'u1' },
      username: 'ada', user_email: 'ada@example.com', first_name: 'Ada', last_name: 'L',
    };
    handler = (call) => {
      if (call.unscoped) return { tenant: 't2', user_id: 'u1' };
      if (opsOf(call).includes('del')) return 0;
      return row;
    };
    const result = await PasswordResetService.verifyToken('plain-token', 'ignored-context-tenant');
    expect(result.valid).toBe(true);
    expect(result.tenant).toBe('t2');
    expect(result.user).toEqual({ user_id: 'u1', username: 'ada', email: 'ada@example.com', first_name: 'Ada', last_name: 'L', user_type: 'client' });
    expect(result.token).toMatchObject({ token_id: 'tok-1', token_hash: sha256('plain-token'), metadata: { requested_by: 'u1' } });

    const scoped = calls.filter((call) => !call.unscoped);
    expect(scoped.every((call) => call.tenant === 't2')).toBe(true);
    expect(opArgs(scoped[0], 'where')[0]).toEqual(['expires_at', '<', NOW]);
    const lookup = scoped[1];
    expect(lookup.table).toBe('password_reset_tokens as prt');
    expect(opArgs(lookup, 'tenantJoin')[0]).toEqual(['users as u', 'prt.user_id', 'u.user_id']);
    expect(opArgs(lookup, 'where')).toEqual([
      [{ 'prt.token_hash': sha256('plain-token'), 'prt.used_at': null }],
      ['prt.expires_at', '>', NOW],
    ]);
  });

  it('is invalid when the scoped lookup no longer finds the token', async () => {
    handler = (call) => (call.unscoped ? { tenant: 't2', user_id: 'u1' } : undefined);
    const result = await PasswordResetService.verifyToken('plain-token');
    expect(result).toEqual({ valid: false, error: 'Invalid or expired reset token' });
  });

  it('turns a database failure into a generic error', async () => {
    handler = () => { throw new Error('boom'); };
    expect(await PasswordResetService.verifyToken('plain-token')).toEqual({ valid: false, error: 'Failed to verify token' });
  });
});

describe('markTokenAsUsed', () => {
  it('is false for an unknown or already used token', async () => {
    handler = () => undefined;
    expect(await PasswordResetService.markTokenAsUsed('plain-token')).toBe(false);
    expect(calls).toHaveLength(1);
    expect(opArgs(calls[0], 'where')[0]).toEqual([{ token_hash: sha256('plain-token'), used_at: null }]);
  });

  it('stamps used_at once, in the token tenant, and reports whether a row changed', async () => {
    handler = (call) => (call.unscoped ? { tenant: 't3' } : 1);
    expect(await PasswordResetService.markTokenAsUsed('plain-token')).toBe(true);
    const update = calls[1];
    expect(update.tenant).toBe('t3');
    expect(opArgs(update, 'where')[0]).toEqual([{ token_hash: sha256('plain-token'), used_at: null }]);
    const [patch] = opArgs(update, 'update')[0] as [{ used_at: unknown; metadata: { bindings: string[] } }];
    expect(patch.used_at).toBe(NOW);
    expect(JSON.parse(patch.metadata.bindings[0])).toMatchObject({ used: true });

    handler = (call) => (call.unscoped ? { tenant: 't3' } : 0);
    expect(await PasswordResetService.markTokenAsUsed('plain-token')).toBe(false);
  });

  it('is false on a database failure', async () => {
    handler = () => { throw new Error('boom'); };
    expect(await PasswordResetService.markTokenAsUsed('plain-token')).toBe(false);
  });
});

describe('getResetHistory', () => {
  it('reads the ten newest tokens for the user in the given tenant', async () => {
    handler = () => [{ token_id: 'a' }, { token_id: 'b' }];
    const history = await PasswordResetService.getResetHistory('u1', 't4');
    expect(history).toEqual([{ token_id: 'a' }, { token_id: 'b' }]);
    const call = calls[0];
    expect(call.tenant).toBe('t4');
    expect(opArgs(call, 'where')[0]).toEqual([{ user_id: 'u1' }]);
    expect(opArgs(call, 'orderBy')[0]).toEqual(['created_at', 'desc']);
    expect(opArgs(call, 'limit')[0]).toEqual([10]);
  });

  it('falls back to the current user tenant and is empty without one', async () => {
    getCurrentUserMock.mockResolvedValue({ tenant: 't5' });
    handler = () => [];
    await PasswordResetService.getResetHistory('u1');
    expect(calls[0].tenant).toBe('t5');

    calls.length = 0;
    getCurrentUserMock.mockResolvedValue(null);
    expect(await PasswordResetService.getResetHistory('u1')).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('cleanupExpiredTokens', () => {
  it('deletes expired tokens for the tenant and returns the count', async () => {
    handler = () => 3;
    expect(await PasswordResetService.cleanupExpiredTokens(undefined, 't6')).toBe(3);
    expect(calls[0].tenant).toBe('t6');
    expect(opsOf(calls[0])).toEqual(['where', 'del']);
    expect(opArgs(calls[0], 'where')[0]).toEqual(['expires_at', '<', NOW]);
  });

  it('uses a provided transaction and reports zero without a tenant', async () => {
    handler = () => 0;
    expect(await PasswordResetService.cleanupExpiredTokens(trx, 't6')).toBe(0);
    calls.length = 0;
    expect(await PasswordResetService.cleanupExpiredTokens()).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
