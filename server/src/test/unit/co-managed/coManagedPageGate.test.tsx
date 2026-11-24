import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ served: true, admitted: true, product: 'psa' as string, tenant: 't1' as string | undefined, calls: [] as string[],
  commercial: false, operational: true, access: [] as string[], clientRead: true, permissionChecks: [] as string[] }));

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@alga-psa/auth', () => ({
  getSession: async () => ({ user: { tenant: state.tenant } }),
  getCurrentUser: async () => ({ user_id: 'u', tenant: state.tenant }),
  hasPermission: async (_user: unknown, resource: string, action: string) => { state.permissionChecks.push(`${resource}:${action}`); return state.clientRead; },
}));
vi.mock('@alga-psa/core/capability/server', () => ({
  requireCapabilityForPage: async (_cap: string, _tenant: string, mode: 'serves' | 'admits' = 'serves') => {
    state.calls.push(mode);
    if (!(mode === 'admits' ? state.served && state.admitted : state.served)) throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({ getServerTranslation: async () => ({ t: (_k: string, o?: any) => o?.defaultValue ?? _k }) }));
vi.mock('@/lib/productAccess', () => ({ getCurrentTenantProduct: async () => state.product }));
vi.mock('@/components/co-managed/CoManagedOverview', () => ({ default: () => null }));
vi.mock('@/components/co-managed/CoManagedCustomerHome', () => ({ default: () => null }));
vi.mock('@/lib/co-managed/commercialAccess', () => ({
  resolveCoManagedRootAccess: async (tenant: string) => {
    state.access.push(tenant);
    return { commercial: state.commercial, served: state.served, operational: state.served && state.operational };
  },
}));
vi.mock('@enterprise/components/co-managed/CoManagedPurchaseOverview', () => ({ default: () => null }));
vi.mock('@enterprise/components/co-managed/CoManagedPurchasePool', () => ({ default: () => null }));

import CoManagedPage, { generateMetadata } from '@/app/msp/co-managed/page';
import CoManagedPurchaseOverview from '@enterprise/components/co-managed/CoManagedPurchaseOverview';
import CoManagedPurchasePool from '@enterprise/components/co-managed/CoManagedPurchasePool';
import CoManagedOverview from '@/components/co-managed/CoManagedOverview';
import CoManagedCustomerHome from '@/components/co-managed/CoManagedCustomerHome';
import { CO_MANAGED_MENU_GROUP } from '@/config/coManagedMenu';

beforeEach(() => { state.served = true; state.admitted = true; state.product = 'psa'; state.tenant = 't1'; state.calls = []; state.commercial = false; state.operational = true; state.access = []; state.clientRead = true; state.permissionChecks = []; });

describe('/msp/co-managed page gate', () => {
  it('psa, served and admitted: the overview', async () => {
    const el: any = await CoManagedPage({});
    expect(el.type).toBe(CoManagedOverview);
  });

  it('psa, served but NOT admitted: still the overview (read of existing state), never notFound', async () => {
    state.admitted = false;
    const el: any = await CoManagedPage({});
    expect(el.type).toBe(CoManagedOverview);
    expect(state.calls).toEqual([]);
  });

  it('the menu target is this page, so a served sponsor never gets a menu item that 404s', async () => {
    expect(CO_MANAGED_MENU_GROUP.items[0].href).toBe('/msp/co-managed');
    state.admitted = false;
    await expect(CoManagedPage({})).resolves.toBeTruthy();
  });

  it('co_managed, served: the customer home (admit state irrelevant)', async () => {
    state.product = 'co_managed';
    state.admitted = false;
    const el: any = await CoManagedPage({});
    expect(el.type).toBe(CoManagedCustomerHome);
  });

  it.each(['psa', 'co_managed'])('%s, not served: notFound', async (product) => {
    state.product = product;
    state.served = false;
    state.admitted = false;
    await expect(CoManagedPage({})).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('no tenant: notFound', async () => {
    state.tenant = undefined;
    await expect(CoManagedPage({})).rejects.toThrow('NEXT_NOT_FOUND');
  });

  describe('commercial first-purchase eligibility (no entitlement, no relationship, no grants)', () => {
    const UUID = '11111111-1111-4111-8111-111111111111';

    it('not served, no co_management:read: the pool-only view, not a 404', async () => {
      state.served = false; state.admitted = false; state.commercial = true; state.operational = false;
      const el: any = await CoManagedPage({});
      expect(el.type).toBe(CoManagedPurchaseOverview);
    });

    it('a clientId query parameter grants nothing: the pool-only view receives no client', async () => {
      state.served = false; state.admitted = false; state.commercial = true; state.operational = false;
      const el: any = await CoManagedPage({ searchParams: Promise.resolve({ clientId: UUID }) });
      expect(el.type).toBe(CoManagedPurchaseOverview);
      expect(el.props).toEqual({});
    });

    it('served but without co_management:read: still the pool-only view (never the operational readers)', async () => {
      state.commercial = true; state.operational = false;
      const el: any = await CoManagedPage({});
      expect(el.type).toBe(CoManagedPurchaseOverview);
    });

    it('both paths apply: the one overview carries the pool', async () => {
      state.commercial = true; state.operational = true;
      const el: any = await CoManagedPage({ searchParams: Promise.resolve({ clientId: UUID }) });
      expect(el.type).toBe(CoManagedOverview);
      expect(el.props.initialClientId).toBe(UUID);
      expect(el.props.purchasePool.type).toBe(CoManagedPurchasePool);
      expect(el.props.purchasePool.props.clientsHref).toBe('/msp/clients');
      expect(state.permissionChecks).toEqual(['client:read']);
    });

    it('both paths apply, but the actor may not open clients: the pool gets no Clients link', async () => {
      state.commercial = true; state.operational = true; state.clientRead = false;
      const el: any = await CoManagedPage({});
      expect(el.props.purchasePool.props.clientsHref).toBeUndefined();
    });

    it('operational only: the existing overview with no pool slot', async () => {
      const el: any = await CoManagedPage({});
      expect(el.type).toBe(CoManagedOverview);
      expect(el.props.purchasePool).toBeUndefined();
    });

    it('commercial does not reach the customer home: the product boundary decides first', async () => {
      state.product = 'co_managed'; state.commercial = true;
      const el: any = await CoManagedPage({});
      expect(el.type).toBe(CoManagedCustomerHome);
    });

    it('metadata shares the decision: titled for a purchaser, empty when nothing opens', async () => {
      state.served = false; state.admitted = false; state.commercial = true; state.operational = false;
      expect(await generateMetadata()).toEqual({ title: 'Co-Managed IT' });
      state.commercial = false;
      expect(await generateMetadata()).toEqual({});
      expect(state.access).toEqual(['t1', 't1']);
    });
  });
});
