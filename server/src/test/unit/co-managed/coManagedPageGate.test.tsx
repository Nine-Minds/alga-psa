import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ served: true, admitted: true, product: 'psa' as string, tenant: 't1' as string | undefined, calls: [] as string[] }));

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@alga-psa/auth', () => ({ getSession: async () => ({ user: { tenant: state.tenant } }) }));
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

import CoManagedPage from '@/app/msp/co-managed/page';
import CoManagedOverview from '@/components/co-managed/CoManagedOverview';
import CoManagedCustomerHome from '@/components/co-managed/CoManagedCustomerHome';
import { CO_MANAGED_MENU_GROUP } from '@/config/coManagedMenu';

beforeEach(() => { state.served = true; state.admitted = true; state.product = 'psa'; state.tenant = 't1'; state.calls = []; });

describe('/msp/co-managed page gate', () => {
  it('psa, served and admitted: the overview', async () => {
    const el: any = await CoManagedPage({});
    expect(el.type).toBe(CoManagedOverview);
  });

  it('psa, served but NOT admitted: still the overview (read of existing state), never notFound', async () => {
    state.admitted = false;
    const el: any = await CoManagedPage({});
    expect(el.type).toBe(CoManagedOverview);
    expect(state.calls).toEqual(['serves']);
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
});
