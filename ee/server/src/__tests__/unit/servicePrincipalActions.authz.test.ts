// T039 (F100): service-principal server actions need an interactive internal session
// and the service_principal permission for the operation.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { value: null as Record<string, unknown> | null },
  hasPermission: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  issue: vi.fn(),
  usage: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...a: unknown[]) => unknown) => async (...args: unknown[]) => {
    if (!mocks.user.value) throw new Error('Not authenticated');
    return fn(mocks.user.value, { tenant: 't1' }, ...args);
  },
  hasPermission: mocks.hasPermission,
}));
vi.mock('@/lib/db', () => ({ createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 't1' })) }));
vi.mock('../../lib/service-principals/service', () => ({
  listServicePrincipals: mocks.list,
  createServicePrincipal: mocks.create,
  issueServicePrincipalKey: mocks.issue,
  getServicePrincipal: vi.fn(),
  updateServicePrincipal: vi.fn(),
  setServicePrincipalActive: vi.fn(),
  archiveOrDeleteServicePrincipal: vi.fn(),
  listServicePrincipalKeys: vi.fn(),
  revokeServicePrincipalKey: vi.fn(),
}));
vi.mock('../../lib/service-principals/usage', () => ({ getServicePrincipalUsage: mocks.usage }));

import {
  createServicePrincipalAction,
  getServicePrincipalUsage,
  issueServicePrincipalKeyAction,
  listServicePrincipalsAction,
} from '../../lib/actions/service-principal-actions';

describe('service principal server actions authorization (T039)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.value = { user_id: 'u1', tenant: 't1', user_type: 'internal' };
    mocks.hasPermission.mockResolvedValue(true);
    mocks.list.mockResolvedValue([]);
    mocks.create.mockResolvedValue({ user_id: 'sp' });
    mocks.usage.mockResolvedValue({ limit: 10, used: 0, remaining: 10 });
  });

  it('allows an internal user holding the permission, checking the operation-specific action', async () => {
    await expect(listServicePrincipalsAction()).resolves.toEqual([]);
    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'service_principal', 'read', expect.anything());
    await createServicePrincipalAction({ kind: 'api', name: 'x' } as never);
    expect(mocks.hasPermission).toHaveBeenLastCalledWith(expect.anything(), 'service_principal', 'create', expect.anything());
    await expect(getServicePrincipalUsage()).resolves.toMatchObject({ limit: 10 });
  });

  it.each(['service', 'client'])('refuses a %s user without touching the service', async (type) => {
    mocks.user.value = { user_id: 'u2', tenant: 't1', user_type: type };
    await expect(listServicePrincipalsAction()).rejects.toThrow(/internal user/);
    await expect(createServicePrincipalAction({ kind: 'api', name: 'x' } as never)).rejects.toThrow(/internal user/);
    await expect(issueServicePrincipalKeyAction('sp' as never)).rejects.toThrow(/internal user/);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('refuses an internal user without the permission', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    await expect(listServicePrincipalsAction()).rejects.toThrow(/permission/);
    await expect(createServicePrincipalAction({ kind: 'api', name: 'x' } as never)).rejects.toThrow(/permission/);
    await expect(getServicePrincipalUsage()).rejects.toThrow(/permission/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller', async () => {
    mocks.user.value = null;
    await expect(listServicePrincipalsAction()).rejects.toThrow(/authenticated/i);
  });
});
