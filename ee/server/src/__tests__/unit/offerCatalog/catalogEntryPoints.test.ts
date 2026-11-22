// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The server workspace transforms its imported page JSX in classic mode.
(globalThis as any).React = React;

const mocks = vi.hoisted(() => ({
  user: { user_id: 'admin', tenant: 'sponsor', user_type: 'internal' },
  resolve: vi.fn(), preview: vi.fn(), purchase: vi.fn(),
  permission: vi.fn(), tenantRow: vi.fn(),
  pageServed: true,
}));

vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: any) => (...args: any[]) => handler(mocks.user, { tenant: mocks.user.tenant }, ...args),
  getCurrentUser: async () => mocks.user,
  getSession: async () => ({ user: { tenant: mocks.user.tenant } }) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
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
vi.mock('@enterprise/components/co-managed/CoManagedPurchaseOverview', async () => import('../../../components/co-managed/CoManagedPurchaseOverview'));
vi.mock('@/components/co-managed/CoManagedPoolEditor', async () => import('../../../../../../server/src/components/co-managed/CoManagedPoolEditor'));
vi.mock('@/components/co-managed/accessRefresh', async () => import('../../../../../../server/src/components/co-managed/accessRefresh'));
vi.mock('@/lib/actions/coManagedActions', async () => import('../../../../../../server/src/lib/actions/coManagedActions'));
vi.mock('@enterprise/lib/actions/coManagedBillingActions', async () => import('../../../lib/actions/coManagedBillingActions'));
vi.mock('@enterprise/components/co-managed/CoManagedCheckout', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string; amount?: string }) =>
    options?.defaultValue ?? (options?.amount ? key + ' ' + options.amount : key);
  return {
    useTranslation: () => ({ t }),
    useFormatters: () => ({ formatCurrency: (amount: number, currency: string) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount) }),
  };
});
vi.mock('@enterprise/components/co-managed/CoManagedPurchasePool', () => ({ default: () => null }));
vi.mock('../../../lib/stripe/StripeService', () => ({ getStripeService: () => ({
  getOfferCatalog: async () => ({
    deploymentLivemode: async () => false,
    effectiveAccountSetting: async () => ({ stripeAccount: 'acct_database', priceId: 'price_database', accountSource: 'database', priceSource: 'database setting' }),
    requireSellableOffer: async () => { await mocks.resolve(); },
    resolveCurrentOffer: mocks.resolve }),
  previewCoManagedSeats: mocks.preview, purchaseCoManagedSeats: mocks.purchase, getPublishableKey: async () => 'pk_test',
}) }));
vi.mock('../../../lib/features', () => ({ isEnterpriseEdition: () => true }));
vi.mock('../../../../../../server/src/lib/features', () => ({ isEnterpriseEdition: () => true }));
vi.mock('@enterprise/lib/stripe/offerCatalog/surfaceProbe', async () => import('../../../lib/stripe/offerCatalog/surfaceProbe'));
vi.mock('@enterprise/lib/co-managed/purchaseDiscovery', async () => import('../../../lib/co-managed/purchaseDiscovery'));
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
import { loadBillingCatalogContext } from '../../../lib/stripe/offerCatalog/surfaceProbe';
import CoManagedPage from '../../../../../../server/src/app/msp/co-managed/page';
import { resolveCoManagedRootAccess } from '../../../../../../server/src/lib/co-managed/commercialAccess';
import CoManagedPurchaseOverview from '@enterprise/components/co-managed/CoManagedPurchaseOverview';
import { OfferUnavailableError } from '../../../lib/stripe/offerCatalog/types';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.user_type = 'internal';
  mocks.user.tenant = 'sponsor';
  mocks.pageServed = true;
  mocks.permission.mockResolvedValue(true);
  mocks.tenantRow.mockResolvedValue({ product_code: 'psa', plan: 'pro', billing_source: 'stripe' });
  mocks.resolve.mockResolvedValue({ source: 'catalog', priceId: 'price_database', scope: { stripeAccount: 'acct_database', livemode: false } });
  mocks.preview.mockResolvedValue({ unitAmount: 1200, monthlyTotal: 1200, amountDue: 1200, currency: 'eur', offerRef: 'version-1' });
  mocks.purchase.mockResolvedValue({ kind: 'checkout', sessionId: 'cs_test', clientSecret: 'secret' });
});

afterEach(cleanup);

describe('independent first-purchase entry points', () => {
  it('serves the overview and purchase review for a hosted Pro admin with zero seats', async () => {
    const overview = await getCoManagedPurchaseState();
    expect(overview).toMatchObject({ capacity: 0, allocated: 0, purchase: { canPurchase: true, minimumQuantity: 1 } });
    expect(await previewCoManagedSeatsAction(1)).toMatchObject({ unitAmount: 1200, offerRef: 'version-1' });
    expect(await purchaseCoManagedSeatsAction({ quantity: 1, operationId: 'purchase-1', offerRef: 'version-1' }))
      .toMatchObject({ kind: 'checkout', publishableKey: 'pk_test' });
    expect(mocks.resolve).toHaveBeenCalledTimes(4);
    expect(mocks.preview).toHaveBeenCalledTimes(1);
    expect(mocks.purchase).toHaveBeenCalledTimes(1);
  });

  it('keeps an ineligible user out and closes overview and purchase when the current price is unsellable', async () => {
    mocks.user.user_type = 'client';
    expect(await resolveCoManagedPurchaseDiscovery(mocks.user, 'sponsor')).toEqual({ eligible: false, reason: 'not_internal' });
    mocks.user.user_type = 'internal';
    mocks.resolve.mockRejectedValue(new OfferUnavailableError('no_current_version', 'no current offer'));
    expect(await getCoManagedPurchaseState()).toBeNull();
    await expect(previewCoManagedSeatsAction(1)).resolves.toEqual({ kind: 'blocked', reason: 'offer_paused' });
    await expect(purchaseCoManagedSeatsAction({ quantity: 1, operationId: 'purchase-2' })).rejects.toThrow('not available');
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.purchase).not.toHaveBeenCalled();
  });

  it('renders the actual first-purchase page for an eligible zero-seat admin and applies its access gate', async () => {
    mocks.user.tenant = 'sponsor-page';
    mocks.pageServed = false;
    expect(await resolveCoManagedPurchaseDiscovery(mocks.user, 'sponsor-page')).toEqual({ eligible: true });
    expect(await resolveCoManagedRootAccess('sponsor-page')).toEqual({ commercial: true, served: false, operational: false });
    const page = await CoManagedPage({});
    expect(page.type).toBe(CoManagedPurchaseOverview);
    expect(await loadBillingCatalogContext()).toMatchObject({ stripeAccount: 'acct_database', priceId: 'price_database', source: 'database', sellable: true });
    expect(await getCoManagedPurchaseState()).toMatchObject({ capacity: 0, allocated: 0, purchase: { canPurchase: true } });
    render(page);
    fireEvent.click(await screen.findByRole('button', { name: 'Buy co-managed seats' }));
    await vi.waitFor(() => expect(screen.getByText('coManaged.dueNow €12.00')).toBeInTheDocument());
    expect(mocks.purchase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.confirmPurchase' }));
    await vi.waitFor(() => expect(mocks.purchase).toHaveBeenCalledWith('sponsor-page', 1, expect.any(String), 'version-1'));

    mocks.user.user_type = 'client';
    await expect(CoManagedPage({})).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.user.user_type = 'internal';
    mocks.resolve.mockRejectedValue(new Error('no sellable current offer'));
    await expect(CoManagedPage({})).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
