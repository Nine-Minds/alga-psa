import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Until the customer accepts, a co-managed workspace may only be reviewed and
 * accepted. The review screen gated rendering only, so an administrator who had
 * signed up could still call any server action or API route directly (client
 * notes, contacts, API keys, portal invitations that send real email).
 */
const mocks = vi.hoisted(() => ({
  user: { user_id: 'admin', tenant: 'workspace', user_type: 'internal' } as Record<string, unknown> | null,
  headers: new Map<string, string>(),
  awaiting: vi.fn(async () => true),
}));

vi.mock('./getCurrentUser', () => ({ getCurrentUserWithRevocationCheck: async () => mocks.user }));
vi.mock('./localizeActionError', () => ({ localizeActionError: async (value: unknown) => value }));
vi.mock('next/headers.js', () => ({ headers: async () => ({ get: (name: string) => mocks.headers.get(name) ?? null }) }));
vi.mock('@alga-psa/db', () => ({
  getAdminConnection: async () => 'admin-db',
  runWithTenant: (_tenant: string, fn: () => unknown) => fn(),
}));
vi.mock('@alga-psa/licensing', () => ({
  isCoManagedAwaitingAcceptance: mocks.awaiting,
  coManagedAcceptancePendingError: () => Object.assign(new Error('The customer administrator must accept co-management before this workspace can be used.'), { code: 'CO_MANAGED_NOT_ACTIVE' }),
}));

import { withAuth } from './withAuth';

const action = vi.fn(async () => 'done');
const ordinary = withAuth(action);
const reviewStep = withAuth(action, { allowBeforeCoManagedAcceptance: true });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { user_id: 'admin', tenant: 'workspace', user_type: 'internal' };
  mocks.headers.clear();
  mocks.awaiting.mockResolvedValue(true);
});

describe('withAuth before co-managed acceptance', () => {
  it('refuses a browser-invoked server action', async () => {
    mocks.headers.set('next-action', 'abc');
    await expect(ordinary()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    expect(mocks.awaiting).toHaveBeenCalledWith('admin-db', 'workspace');
    expect(action).not.toHaveBeenCalled();
  });

  it('refuses an API request reaching the action with the session', async () => {
    mocks.headers.set('x-pathname', '/api/v1/clients/c/notes');
    await expect(ordinary()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    expect(action).not.toHaveBeenCalled();
  });

  it('refuses a multipart server action without the next-action header before its body executes', async () => {
    mocks.headers.set('content-type', 'multipart/form-data; boundary=----NextBoundary');
    mocks.headers.set('x-pathname', '/msp/dashboard');
    await expect(ordinary()).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
    expect(mocks.awaiting).toHaveBeenCalledWith('admin-db', 'workspace');
    expect(action).not.toHaveBeenCalled();
  });

  it('runs the review and acceptance actions', async () => {
    mocks.headers.set('content-type', 'multipart/form-data; boundary=----NextBoundary');
    mocks.headers.set('x-pathname', '/msp/dashboard');
    await expect(reviewStep()).resolves.toBe('done');
    expect(mocks.awaiting).not.toHaveBeenCalled();
  });

  it('leaves direct calls while a page renders alone', async () => {
    mocks.headers.set('x-pathname', '/msp/dashboard');
    await expect(ordinary()).resolves.toBe('done');
    expect(mocks.awaiting).not.toHaveBeenCalled();
  });

  it('runs actions once the workspace is accepted', async () => {
    mocks.headers.set('content-type', 'multipart/form-data; boundary=----NextBoundary');
    mocks.headers.set('x-pathname', '/msp/dashboard');
    mocks.awaiting.mockResolvedValue(false);
    await expect(ordinary()).resolves.toBe('done');
    expect(action).toHaveBeenCalledOnce();
  });

  it('runs multipart actions for an ordinary PSA tenant', async () => {
    mocks.user = { user_id: 'admin', tenant: 'ordinary-psa', user_type: 'internal' };
    mocks.headers.set('content-type', 'multipart/form-data; boundary=----NextBoundary');
    mocks.headers.set('x-pathname', '/msp/dashboard');
    mocks.awaiting.mockResolvedValue(false);
    await expect(ordinary()).resolves.toBe('done');
    expect(mocks.awaiting).toHaveBeenCalledWith('admin-db', 'ordinary-psa');
    expect(action).toHaveBeenCalledOnce();
  });
});
