import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Until the customer accepts, a co-managed workspace may only be reviewed and
 * accepted. Rendering the review screen is not enough: an administrator who had
 * signed up could still call any server action or API route directly.
 *
 * The real lifecycle module is used (not a stub) so the cache contract is
 * exercised end to end: a plain PSA tenant must cost no connection and no
 * statement after its first probe, and accept/decline/terminate must be visible
 * immediately after `invalidateCoManagedAwaitingAcceptance`.
 */
const mocks = vi.hoisted(() => ({
  user: { user_id: 'admin', tenant: 'workspace', user_type: 'internal' } as Record<string, unknown> | null,
  headers: new Map<string, string>(),
  getAdminConnection: vi.fn(async () => 'admin-db'),
  tenants: new Map<string, { product: string; state: string | null }>(),
  statements: [] as string[],
}));

vi.mock('./getCurrentUser', () => ({ getCurrentUserWithRevocationCheck: async () => mocks.user }));
vi.mock('./localizeActionError', () => ({ localizeActionError: async (value: unknown) => value }));
vi.mock('next/headers.js', () => ({ headers: async () => ({ get: (name: string) => mocks.headers.get(name) ?? null }) }));
vi.mock('@alga-psa/db', () => ({
  getAdminConnection: mocks.getAdminConnection,
  runWithTenant: (_tenant: string, fn: () => unknown) => fn(),
  withTransaction: async () => { throw new Error('not used'); },
  admitWrite: async () => undefined,
  // The provider reads two tables through the tenant facade; record each statement.
  tenantDb: (_db: unknown, tenant: string) => ({
    table: (name: string) => {
      const row = mocks.tenants.get(tenant);
      const result = (name === 'tenants'
        ? (row ? { product_code: row.product } : undefined)
        : (row?.state ? { state: row.state } : undefined));
      const chain = {
        whereNull: () => chain,
        first: async () => { mocks.statements.push(name); return result; },
      };
      return chain;
    },
  }),
}));
vi.mock('@alga-psa/licensing/lifecycle-error', async () => await import('../../../licensing/src/lib/co-managed-lifecycle-error'));
vi.mock('../../../licensing/src/lib/co-managed-entitlements', () => ({ getCoManagedEntitlementState: vi.fn() }));

import { withAuth, withAuthCheck, withOptionalAuth } from './withAuth';
import {
  coManagedLifecycleProvider,
  invalidateCoManagedAwaitingAcceptance,
  registerCoManagedLifecycleProvider,
  resetCoManagedAwaitingAcceptanceCache,
  resetCoManagedLifecycleProvider,
} from '../../../licensing/src/lib/co-managed-lifecycle';

// withAuth imports the published subpath; point it at the same module instance.
vi.mock('@alga-psa/licensing/lifecycle', async () => await import('../../../licensing/src/lib/co-managed-lifecycle'));

const action = vi.fn(async () => 'done');
const ordinary = withAuth(action);
const reviewStep = withAuth(action, { allowBeforeCoManagedAcceptance: true });

const multipart = () => {
  mocks.headers.set('content-type', 'multipart/form-data; boundary=----NextBoundary');
  mocks.headers.set('x-pathname', '/msp/dashboard');
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { user_id: 'admin', tenant: 'workspace', user_type: 'internal' };
  mocks.headers.clear();
  mocks.statements = [];
  mocks.tenants.clear();
  mocks.tenants.set('workspace', { product: 'co_managed', state: 'pending_acceptance' });
  mocks.tenants.set('ordinary-psa', { product: 'psa', state: null });
  resetCoManagedAwaitingAcceptanceCache();
  registerCoManagedLifecycleProvider(coManagedLifecycleProvider);
});

describe('withAuth before co-managed acceptance', () => {
  it('refuses a browser-invoked server action', async () => {
    mocks.headers.set('next-action', 'abc');
    await expect(ordinary()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    expect(action).not.toHaveBeenCalled();
  });

  it('refuses an API request reaching the action with the session', async () => {
    mocks.headers.set('x-pathname', '/api/v1/clients/c/notes');
    await expect(ordinary()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    expect(action).not.toHaveBeenCalled();
  });

  it('refuses a multipart submission without the next-action header before its body runs', async () => {
    multipart();
    await expect(ordinary()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    expect(action).not.toHaveBeenCalled();
  });

  it('runs the get/accept/decline review actions', async () => {
    multipart();
    await expect(reviewStep()).resolves.toBe('done');
    expect(mocks.statements).toEqual([]);
    expect(mocks.getAdminConnection).not.toHaveBeenCalled();
  });

  it('leaves direct calls while a page renders alone', async () => {
    mocks.headers.set('x-pathname', '/msp/dashboard');
    await expect(ordinary()).resolves.toBe('done');
    expect(mocks.statements).toEqual([]);
  });

  it('ignores a similar-looking content type', async () => {
    mocks.headers.set('content-type', 'application/json');
    mocks.headers.set('x-pathname', '/msp/dashboard');
    await expect(ordinary()).resolves.toBe('done');
  });

  it('sees acceptance and termination immediately after pending requests', async () => {
    multipart();
    await expect(ordinary()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    // Acceptance committed in another process, without local invalidation.
    mocks.tenants.set('workspace', { product: 'co_managed', state: 'active' });
    await expect(ordinary()).resolves.toBe('done');

    for (const next of ['terminated'] as const) {
      mocks.tenants.set('workspace', { product: 'co_managed', state: 'pending_acceptance' });
      invalidateCoManagedAwaitingAcceptance('workspace');
      await expect(ordinary()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
      mocks.tenants.set('workspace', { product: 'co_managed', state: next });
      invalidateCoManagedAwaitingAcceptance('workspace');
      await expect(ordinary()).resolves.toBe('done');
    }
  });

  it('plain PSA tenants cost one probe per process, then no connection and no statement', async () => {
    mocks.user = { user_id: 'admin', tenant: 'ordinary-psa', user_type: 'internal' };
    multipart();
    await expect(ordinary()).resolves.toBe('done');
    expect(mocks.statements).toEqual(['tenants']);
    expect(mocks.getAdminConnection).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i += 1) await expect(ordinary()).resolves.toBe('done');
    expect(mocks.statements).toEqual(['tenants']);
    expect(mocks.getAdminConnection).toHaveBeenCalledTimes(1);
  });

  it('is inert with no co-managed provider registered', async () => {
    resetCoManagedLifecycleProvider();
    multipart();
    await expect(ordinary()).resolves.toBe('done');
    expect(mocks.getAdminConnection).not.toHaveBeenCalled();
    expect(mocks.statements).toEqual([]);
  });
});

describe.each([
  ['withOptionalAuth', () => withOptionalAuth(action), () => withOptionalAuth(action, { allowBeforeCoManagedAcceptance: true })],
  ['withAuthCheck', () => withAuthCheck(action), () => withAuthCheck(action, { allowBeforeCoManagedAcceptance: true })],
])('%s before co-managed acceptance', (_name, make, makeExempt) => {
  it('refuses a browser-invoked server action', async () => {
    mocks.headers.set('next-action', 'abc');
    await expect(make()()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    expect(action).not.toHaveBeenCalled();
  });

  it('refuses an API request and a multipart submission', async () => {
    mocks.headers.set('x-pathname', '/api/v1/clients/c/notes');
    await expect(make()()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    mocks.headers.clear();
    multipart();
    await expect(make()()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    expect(action).not.toHaveBeenCalled();
  });

  it('passes on an RSC render', async () => {
    mocks.headers.set('x-pathname', '/msp/dashboard');
    await expect(make()()).resolves.toBe('done');
  });

  it('passes when allowBeforeCoManagedAcceptance is set', async () => {
    mocks.headers.set('next-action', 'abc');
    await expect(makeExempt()()).resolves.toBe('done');
    expect(mocks.getAdminConnection).not.toHaveBeenCalled();
  });

  it('passes for a non-pending tenant', async () => {
    mocks.user = { user_id: 'admin', tenant: 'ordinary-psa', user_type: 'internal' };
    mocks.headers.set('next-action', 'abc');
    await expect(make()()).resolves.toBe('done');
  });
});

describe('withOptionalAuth without a user', () => {
  it('runs unguarded', async () => {
    mocks.user = null;
    mocks.headers.set('next-action', 'abc');
    await expect(withOptionalAuth(action)()).resolves.toBe('done');
    expect(mocks.getAdminConnection).not.toHaveBeenCalled();
  });
});
