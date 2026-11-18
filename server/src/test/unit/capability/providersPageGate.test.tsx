import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CM L9 A2. The provider route calls the L0 serving adapter and renders
 * notFound when the capability is not served; nothing is rendered or fetched.
 */
const hoisted = vi.hoisted(() => ({
  session: { user: { tenant: 'customer-tenant' } } as any,
  served: true,
}));
class NotFound extends Error { constructor() { super('NEXT_NOT_FOUND'); } }

vi.mock('next/navigation', () => ({ notFound: () => { throw new NotFound(); } }));
vi.mock('@alga-psa/auth', () => ({ getSession: async () => hoisted.session }));
vi.mock('@alga-psa/core/capability/server', () => ({
  requireCapabilityForPage: vi.fn(async () => {
    if (!hoisted.served) throw new NotFound();
  }),
}));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: async () => ({ t: (_key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? '' }),
}));
vi.mock('@/components/co-managed/CoManagedProviderSetup', () => ({ default: () => null }));

import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import CoManagedProvidersPage, { generateMetadata } from '../../../app/msp/co-management/providers/page';

describe('/msp/co-management/providers gate (L9 A2)', () => {
  beforeEach(() => {
    hoisted.session = { user: { tenant: 'customer-tenant' } };
    hoisted.served = true;
    vi.mocked(requireCapabilityForPage).mockClear();
  });

  it("asks the adapter whether co-managed 'serves' the session tenant, then renders the shell", async () => {
    const element = await CoManagedProvidersPage();
    expect(requireCapabilityForPage).toHaveBeenCalledWith('co-managed', 'customer-tenant', 'serves');
    expect(element).toBeTruthy();
  });

  it('calls notFound when the capability is not served', async () => {
    hoisted.served = false;
    await expect(CoManagedProvidersPage()).rejects.toBeInstanceOf(NotFound);
    expect(requireCapabilityForPage).toHaveBeenCalledWith('co-managed', 'customer-tenant', 'serves');
  });

  it('calls notFound without consulting the adapter when there is no tenant', async () => {
    hoisted.session = null;
    await expect(CoManagedProvidersPage()).rejects.toBeInstanceOf(NotFound);
    expect(requireCapabilityForPage).not.toHaveBeenCalled();
  });

  it('emits the page title only when the tenant is served', async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: 'Email and Identity Providers' });
  });

  it('emits no title on the unserved path: generateMetadata gets the standard not-found, like the page', async () => {
    hoisted.served = false;
    await expect(generateMetadata()).rejects.toBeInstanceOf(NotFound);
    hoisted.session = null;
    hoisted.served = true;
    await expect(generateMetadata()).rejects.toBeInstanceOf(NotFound);
  });
});
