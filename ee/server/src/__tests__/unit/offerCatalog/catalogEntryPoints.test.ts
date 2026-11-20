import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// The server workspace transforms its imported page JSX in classic mode.
(globalThis as any).React = React;

const mocks = vi.hoisted(() => ({
  user: { user_id: 'admin', tenant: 'sponsor', user_type: 'internal' },
  scope: vi.fn(), setting: vi.fn(), resolve: vi.fn(), preview: vi.fn(), purchase: vi.fn(),
  permission: vi.fn(), tenantRow: vi.fn(),
  pageServed: true, pageOperational: false,
}));

vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: any) => (...args: any[]) => handler(mocks.user, { tenant: 'sponsor' }, ...args),
  getSession: async () => ({ user: { tenant: 'sponsor' } }) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ table: (name: string) => name === 'tenants' ? { first: mocks.tenantRow } : {
    whereIn: () => ({ select: () => ({ first: async () => undefined }) }),
  } }),
}));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForAction: vi.fn(), requireCapabilityForPage: async () => {
  if (!mocks.pageServed) throw new Error('NEXT_NOT_FOUND');
} }));
vi.mock('@alga-psa/core/capability', () => ({ admits: vi.fn(async () => ({ admitted: true })), serves: async () => ({ served: mocks.pageServed }),
  forcedValue: () => null, capabilityFeatureFlag: () => 'release-v2-0-feature' }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: async () => true }));
vi.mock('@/lib/productAccess', () => ({ getCurrentTenantProduct: async () => 'psa' }));
vi.mock('@/components/co-managed/CoManagedOverview', () => ({ default: () => null }));
vi.mock('@/components/co-managed/CoManagedCustomerHome', () => ({ default: () => null }));
vi.mock('@enterprise/components/co-managed/CoManagedPurchaseOverview', () => ({ default: () => null }));
vi.mock('@enterprise/components/co-managed/CoManagedPurchasePool', () => ({ default: () => null }));
vi.mock('@/lib/co-managed/commercialAccess', () => ({ resolveCoManagedRootAccess: async () => ({
  commercial: mocks.user.user_type === 'internal' && await mocks.resolve().then(() => true, () => false),
  served: mocks.pageServed, operational: mocks.pageOperational,
}) }));
vi.mock('../../../lib/stripe/StripeService', () => ({ getStripeService: () => ({
  getOfferCatalog: async () => ({ scope: mocks.scope, inspectAccountSetting: mocks.setting,
    deploymentLivemode: async () => false,
    effectiveAccountSetting: async () => ({ stripeAccount: 'acct_database', priceId: 'price_database', accountSource: 'database', priceSource: 'database setting' }),
    resolveCurrentOffer: mocks.resolve }),
  previewCoManagedSeats: mocks.preview, purchaseCoManagedSeats: mocks.purchase, getPublishableKey: async () => 'pk_test',
}) }));
vi.mock('../../../../../../server/src/lib/features', () => ({ isEnterpriseEdition: () => true }));
vi.mock('@enterprise/lib/stripe/offerCatalog/surfaceProbe', async () => import('../../../lib/stripe/offerCatalog/surfaceProbe'));
vi.mock('../../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: vi.fn() }));
vi.mock('../../../lib/co-managed/admitSponsor', () => ({ admitCoManagedSponsor: vi.fn() }));
vi.mock('@alga-psa/co-managed', () => ({
  getCoManagedManagementOptions: vi.fn(), getCoManagedManagementStatus: vi.fn(), changeCoManagedAllocationForActor: vi.fn(),
  getCoManagedClientManagement: vi.fn(), getCoManagedClientOverview: vi.fn(),
}));
vi.mock('@alga-psa/licensing', async (importOriginal: () => Promise<typeof import('@alga-psa/licensing')>) => {
  const actual = await importOriginal();
  return { ...actual, getCoManagedEntitlementState: async () => ({ capacity: 0, allocated: 0 }),
    getLicenseStateRow: async () => null, readCoManagedFirstPurchasePhase: async () => ({ phase: 'never_started' }) };
});

import { getCoManagedPurchaseState } from '../../../../../../server/src/lib/actions/coManagedActions';
import { previewCoManagedSeatsAction, purchaseCoManagedSeatsAction } from '../../../lib/actions/coManagedBillingActions';
import { resolveCoManagedPurchaseDiscovery } from '../../../lib/co-managed/purchaseDiscovery';
import CoManagedPage from '../../../../../../server/src/app/msp/co-managed/page';
import CoManagedPurchaseOverview from '@enterprise/components/co-managed/CoManagedPurchaseOverview';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.user_type = 'internal';
  mocks.pageServed = true; mocks.pageOperational = false;
  mocks.permission.mockResolvedValue(true);
  mocks.tenantRow.mockResolvedValue({ product_code: 'psa', plan: 'pro', billing_source: 'stripe' });
  mocks.scope.mockResolvedValue({ stripeAccount: 'acct_database', livemode: false });
  mocks.setting.mockResolvedValue({ stripe_account: 'acct_database', price_id: 'price_database' });
  mocks.resolve.mockResolvedValue({ source: 'catalog', priceId: 'price_database' });
  mocks.preview.mockResolvedValue({ unitAmount: 1200, monthlyTotal: 1200, amountDue: 1200, currency: 'eur', offerRef: 'version-1' });
  mocks.purchase.mockResolvedValue({ kind: 'checkout', sessionId: 'cs_test', clientSecret: 'secret' });
});

describe('independent first-purchase entry points', () => {
  it('serves the overview and purchase review for a hosted Pro admin with zero seats', async () => {
    const overview = await getCoManagedPurchaseState();
    expect(overview).toMatchObject({ capacity: 0, allocated: 0, purchase: { canPurchase: true, minimumQuantity: 1 } });
    expect(await previewCoManagedSeatsAction(1)).toMatchObject({ unitAmount: 1200, offerRef: 'version-1' });
    expect(await purchaseCoManagedSeatsAction({ quantity: 1, operationId: 'purchase-1', offerRef: 'version-1' }))
      .toMatchObject({ kind: 'checkout', publishableKey: 'pk_test' });
    expect(mocks.resolve).toHaveBeenCalledTimes(3);
    expect(mocks.preview).toHaveBeenCalledTimes(1);
    expect(mocks.purchase).toHaveBeenCalledTimes(1);
  });

  it('keeps an ineligible user out and closes overview and purchase when the current price is unsellable', async () => {
    mocks.user.user_type = 'client';
    expect(await resolveCoManagedPurchaseDiscovery(mocks.user, 'sponsor')).toEqual({ eligible: false, reason: 'not_internal' });
    mocks.user.user_type = 'internal';
    mocks.resolve.mockRejectedValue(new Error('no current offer'));
    expect(await getCoManagedPurchaseState()).toBeNull();
    await expect(previewCoManagedSeatsAction(1)).rejects.toThrow('not available');
    await expect(purchaseCoManagedSeatsAction({ quantity: 1, operationId: 'purchase-2' })).rejects.toThrow('not available');
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.purchase).not.toHaveBeenCalled();
  });

  it('renders the actual first-purchase page for an eligible zero-seat admin and applies its access gate', async () => {
    mocks.pageServed = false;
    const page = await CoManagedPage({});
    expect(page.type).toBe(CoManagedPurchaseOverview);
    expect(await previewCoManagedSeatsAction(1)).toMatchObject({ unitAmount: 1200, offerRef: 'version-1' });
    expect(await purchaseCoManagedSeatsAction({ quantity: 1, operationId: 'purchase-page', offerRef: 'version-1' }))
      .toMatchObject({ kind: 'checkout' });

    mocks.user.user_type = 'client';
    await expect(CoManagedPage({})).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.user.user_type = 'internal';
    mocks.resolve.mockRejectedValue(new Error('no sellable current offer'));
    await expect(CoManagedPage({})).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
