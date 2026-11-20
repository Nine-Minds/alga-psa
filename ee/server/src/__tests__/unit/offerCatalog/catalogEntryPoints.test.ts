import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { user_id: 'admin', tenant: 'sponsor', user_type: 'internal' },
  scope: vi.fn(), setting: vi.fn(), resolve: vi.fn(), preview: vi.fn(), purchase: vi.fn(),
  permission: vi.fn(), tenantRow: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: any) => (...args: any[]) => handler(mocks.user, { tenant: 'sponsor' }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ table: (name: string) => name === 'tenants' ? { first: mocks.tenantRow } : {
    whereIn: () => ({ select: () => ({ first: async () => undefined }) }),
  } }),
}));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForAction: vi.fn() }));
vi.mock('@alga-psa/core/capability', () => ({ admits: vi.fn(async () => ({ admitted: true })),
  forcedValue: () => null, capabilityFeatureFlag: () => 'release-v2-0-feature' }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: async () => true }));
vi.mock('../../../lib/stripe/StripeService', () => ({ getStripeService: () => ({
  getOfferCatalog: async () => ({ scope: mocks.scope, inspectAccountSetting: mocks.setting, resolveCurrentOffer: mocks.resolve }),
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

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.user_type = 'internal';
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
});
