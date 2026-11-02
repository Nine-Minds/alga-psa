import { beforeEach, describe, expect, it, vi } from 'vitest';

// T013 (password half): reset-token creation, verification and completion refuse non-interactive targets.
type Row = Record<string, unknown> | undefined;
const verifyMock = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ userRow: undefined as Row, tokenRow: undefined as Row, writes: [] as string[] }));

const NOW = { sql: 'now()' };
const trx = { fn: { now: () => NOW }, raw: (sql: string) => ({ sql }) } as never;

function builder(table: string, unscoped?: string) {
  const chain: Record<string, unknown> = {
    then(resolve: (v: unknown) => void) {
      if (unscoped) return resolve({ tenant: 't1', user_id: 'u1' });
      resolve(table === 'users' ? state.userRow : state.tokenRow);
    },
  };
  for (const op of ['where', 'select', 'first', 'returning', 'orderBy', 'limit', 'join']) chain[op] = () => chain;
  for (const op of ['insert', 'update', 'del']) chain[op] = () => { state.writes.push(`${table}:${op}`); return chain; };
  return chain;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async (tenantId?: string) => ({ knex: trx, tenant: tenantId }),
  withTransaction: async (_k: unknown, fn: (t: unknown) => unknown) => fn(trx),
  runWithTenant: async (_t: string, fn: () => unknown) => fn(),
  tenantDb: () => ({
    table: (name: string) => builder(name),
    unscoped: (name: string, reason: string) => builder(name, reason),
    tenantJoin: (q: unknown) => q,
  }),
}));
vi.mock('../lib/security/rateLimiting', () => ({
  checkPasswordResetLimit: async () => ({ success: true, remainingPoints: 2 }),
  formatRateLimitError: async () => 'limited',
}));
vi.mock('../lib/getCurrentUser', () => ({ getCurrentUser: async () => null }));

// The action imports the package index (next-auth); only verifyToken is needed from it.
vi.mock('@alga-psa/auth', () => ({ PasswordResetService: { verifyToken: (...a: unknown[]) => verifyMock(...a) } }));
vi.mock('../actions/useRegister', () => ({ recoverPassword: vi.fn() }));

import { PasswordResetService } from './PasswordResetService';

beforeEach(() => {
  state.userRow = undefined;
  state.tokenRow = undefined;
  state.writes.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('T013: PasswordResetService refuses non-interactive targets', () => {
  it('createResetToken refuses a requested service type and writes nothing', async () => {
    const result = await PasswordResetService.createResetToken('svc@example.test', 'service' as never, 't1');
    expect(result.success).toBe(false);
    expect(state.writes).toEqual([]);
  });

  it('a stored service row behind an interactive-type request yields the enumeration-safe dummy, no token', async () => {
    state.userRow = { user_id: 'u1', email: 'svc@example.test', user_type: 'service' };
    const result = await PasswordResetService.createResetTokenWithTransaction('svc@example.test', 'internal', trx, 't1');
    expect(result).toEqual({ success: true, tokenId: 'dummy', token: 'dummy', userId: 'dummy' });
    expect(state.writes.filter((w) => w.endsWith(':insert'))).toEqual([]);
  });

  it('verifyToken reports invalid when the stored user is a service user', async () => {
    state.tokenRow = {
      tenant: 't1', token_id: 'tok', user_id: 'u1', token_hash: 'x', email: 'svc@example.test', user_type: 'service',
      expires_at: 'later', created_at: 'earlier', used_at: null, metadata: {},
      username: 'svc', user_email: 'svc@example.test', first_name: 'S', last_name: 'P',
    };
    const result = await PasswordResetService.verifyToken('plain');
    expect(result.valid).toBe(false);
    expect(result.user).toBeUndefined();
  });

  it('completePasswordReset refuses a verified token whose user is a service user and never updates the password', async () => {
    verifyMock.mockResolvedValue({
      valid: true,
      tenant: 't1',
      user: { user_id: 'u1', username: 'svc', email: 'svc@example.test', first_name: 'S', last_name: 'P', user_type: 'service' },
      token: { token_id: 'tok' },
    } as never);
    const { completePasswordReset } = await import('../actions/auth-actions/passwordResetActions');
    const result = await completePasswordReset('plain', 'New-Password-1!');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid token');
    expect(state.writes.filter((w) => w.startsWith('users:'))).toEqual([]);
  });
});
