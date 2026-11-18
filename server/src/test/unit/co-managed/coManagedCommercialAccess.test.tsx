import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { user_id: 'u1', tenant: 't1', user_type: 'internal' } as any | null,
  served: false, permissions: new Set<string>(), decision: { eligible: true } as { eligible: boolean },
  servesCalls: [] as string[], discoveryCalls: [] as string[], product: 'psa', enforced: [] as string[],
}));

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: async () => state.user,
  getSession: async () => (state.user ? { user: { tenant: state.user.tenant } } : null),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async (_u: unknown, resource: string, action: string) => state.permissions.has(`${resource}:${action}`) }));
vi.mock('@alga-psa/core/capability', () => ({ serves: async (_c: string, tenant: string) => { state.servesCalls.push(tenant); return { served: state.served }; } }));
vi.mock('@alga-psa/core/capability/server', () => ({
  requireCapabilityForPage: async () => { if (!state.served) throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('@enterprise/lib/co-managed/purchaseDiscovery', () => ({
  resolveCoManagedPurchaseDiscovery: async (_user: unknown, tenant: string) => { state.discoveryCalls.push(tenant); return state.decision; },
}));
vi.mock('@/lib/serverProductRouteGuard', () => ({ enforceServerProductRoute: async ({ pathname }: { pathname: string }) => { state.enforced.push(pathname); return null; } }));
vi.mock('@/app/msp/_components/WorkspaceRouteLayout', () => ({ default: ({ children }: any) => children }));
vi.mock('../../../app/msp/_components/WorkspaceRouteLayout', () => ({ default: ({ children }: any) => children }));

import { resolveCoManagedRootAccess } from '@/lib/co-managed/commercialAccess';
import Layout from '@/app/msp/co-managed/layout';

beforeEach(() => {
  state.user = { user_id: 'u1', tenant: 't1', user_type: 'internal' };
  state.served = false; state.permissions = new Set(); state.decision = { eligible: true };
  state.servesCalls = []; state.discoveryCalls = []; state.enforced = [];
});

describe('the two access facts for the overview root', () => {
  it('commercial eligibility alone: no participation, no co_management:read', async () => {
    expect(await resolveCoManagedRootAccess('t1')).toEqual({ commercial: true, served: false, operational: false });
    expect(state.discoveryCalls).toEqual(['t1']);
  });

  it('operational needs the capability served AND co_management:read, never one alone', async () => {
    state.decision = { eligible: false };
    state.served = true;
    expect(await resolveCoManagedRootAccess('t1')).toEqual({ commercial: false, served: true, operational: false });
    state.permissions = new Set(['co_management:read']);
    expect(await resolveCoManagedRootAccess('t1')).toEqual({ commercial: false, served: true, operational: true });
    state.served = false;
    expect(await resolveCoManagedRootAccess('t1')).toEqual({ commercial: false, served: false, operational: false });
  });

  it('both paths can hold at once and stay separate facts', async () => {
    state.served = true; state.permissions = new Set(['co_management:read']);
    expect(await resolveCoManagedRootAccess('t1')).toEqual({ commercial: true, served: true, operational: true });
  });

  it('an unauthenticated session or another tenant\'s principal gets neither', async () => {
    state.user = null;
    expect(await resolveCoManagedRootAccess('t1')).toMatchObject({ commercial: false, operational: false });
    state.user = { user_id: 'u2', tenant: 'other', user_type: 'internal' };
    state.permissions = new Set(['co_management:read']); state.served = true;
    expect(await resolveCoManagedRootAccess('t1')).toEqual({ commercial: false, served: true, operational: false });
    expect(state.discoveryCalls).toEqual([]);
  });

  it('a client portal user never holds operational access, even with the permission string', async () => {
    state.user = { user_id: 'c1', tenant: 't1', user_type: 'client' };
    state.served = true; state.permissions = new Set(['co_management:read']); state.decision = { eligible: false };
    expect(await resolveCoManagedRootAccess('t1')).toEqual({ commercial: false, served: true, operational: false });
  });
});

describe('/msp/co-managed root layout', () => {
  const render = (tenant: string | null = 't1') => { state.user = tenant ? { ...state.user, tenant } : null; return Layout({ children: 'child' as any }); };

  it('an eligible purchaser enters without participation, and the product boundary still runs', async () => {
    await expect(render()).resolves.toBeTruthy();
    expect(state.enforced).toEqual(['/msp/co-managed']);
  });

  it('a served sponsor enters as before', async () => {
    state.decision = { eligible: false }; state.served = true;
    await expect(render()).resolves.toBeTruthy();
  });

  it('neither eligible nor served: not found (the community stub, a closed gate or a plain tenant)', async () => {
    state.decision = { eligible: false };
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(state.enforced).toEqual([]);
  });

  it('no session: not found', async () => {
    await expect(render(null)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
