/**
 * T003 (entry points): the billing catalog context loads at most once per request at the real entry points
 * that reach the co-managed offer gate, however many gate checks the request makes, and a second request
 * loads again (nothing outlives the request, so an operator's set-account shows on the next one).
 *
 * Real: withAuth (the action wrapper that opens the request scope), the action bodies, resolveCoManagedRootAccess
 * (the /msp/co-managed layout+page+metadata data function), canDiscoverSeatTrial, isCoManagedSeatEligible,
 * the capability engine (cache off, so every admits() reaches the resolver) and the licensing gate.
 * Stubbed: the registered loader (a counter), the database, Stripe, permissions and the session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({
  user: { user_id: 'actor', tenant: 'sponsor', user_type: 'internal' } as Record<string, unknown>,
  // An eligible hosted Pro sponsor. The actor operates co-managed IT but holds no billing permission, so the
  // root resolves to the trial path (commercial discovery needs account_management); `billing` opens it.
  plan: 'pro',
  billingSource: 'stripe',
  billing: false,
  gateChecks: 0,
}));

vi.mock('@alga-psa/core/features', async (importOriginal) => ({
  ...await importOriginal(),
  isEnterprise: true,
  isFeatureFlagEnabled: async () => true,
  evaluateFeatureFlag: async () => ({ status: 'evaluated', enabled: true }),
}));
// The REAL withAuth opens the request scope under test; only its session lookup is replaced.
vi.mock('../../../../../packages/auth/src/lib/getCurrentUser', () => ({ getCurrentUserWithRevocationCheck: async () => holder.user }));
vi.mock('@alga-psa/auth', async () => ({
  ...await vi.importActual<typeof import('../../../../../packages/auth/src/lib/withAuth')>('../../../../../packages/auth/src/lib/withAuth'),
  getCurrentUser: async () => holder.user,
  getSession: async () => ({ user: holder.user }),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async (_user: unknown, resource: string) => resource !== 'account_management' || holder.billing }));
vi.mock('@alga-psa/authorization/clientScopeAuthorization', () => ({ createClientScopeContext: async () => ({ permits: async () => true }) }));
vi.mock('@alga-psa/core/capability/server', async () => {
  const { admits } = await import('@alga-psa/core/capability');
  return { requireCapabilityForAction: async (key: 'co-managed-seat', tenant: string) => {
    if (!(await admits(key, tenant)).admitted) throw new Error('Capability not admitted');
  } };
});
vi.mock('@alga-psa/core/capability', async (importOriginal) => ({
  ...await importOriginal(),
  serves: async () => ({ served: true }),
}));
// Count gate checks without changing the answer.
vi.mock('@alga-psa/licensing', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, getLicenseStateRow: async () => null,
    isCoManagedPurchaseSurfaceOpen: async (tenant: string) => { holder.gateChecks += 1; return actual.isCoManagedPurchaseSurfaceOpen(tenant); } };
});
vi.mock('@alga-psa/db', async (importOriginal) => {
  const rows = (name: string) => ({
    tenants: { product_code: 'psa', plan: holder.plan, billing_source: holder.billingSource },
    co_managed_trial_sponsors: { tenant: 'sponsor' },
  } as Record<string, unknown>)[name];
  const chain = (name: string): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    for (const method of ['where', 'whereNot', 'orWhereNotNull', 'orWhereRaw', 'select', 'join']) self[method] = () => self;
    self.first = async () => rows(name);
    return self;
  };
  const knex = { fn: { now: () => new Date() } };
  return { ...await importOriginal(),
    createTenantKnex: async () => ({ knex }), getAdminConnection: async () => knex,
    tenantDb: () => ({ table: chain }) };
});
vi.mock('../../lib/stripe/StripeService', () => ({ getStripeService: () => ({
  coManagedSeatPrice: async () => ({ priceId: 'price_x', unitAmount: 2900, currency: 'usd' }),
  refreshSeatTrialBase: async () => undefined,
}) }));
vi.mock('../../lib/co-managed/seatTrial', () => ({
  prepareCoManagedSeatTrial: async () => ({ trialId: 'trial', arrangementId: 'arr', assignmentId: 'asg' }),
  readCoManagedSeatTrialAdmission: vi.fn(), replaceCoManagedSeatTrialTechnician: vi.fn(),
  resumeCoManagedSeatTrialInvitation: vi.fn(), cancelCoManagedSeatTrial: vi.fn(),
}));
vi.mock('../../lib/co-managed/seatTrialConversion', () => ({ usePaidSeatForTrial: vi.fn() }));
vi.mock('../../lib/co-managed/seatTrialAnalytics', () => ({ reportSeatTrialMilestones: vi.fn() }));
vi.mock('../../../../../server/src/lib/co-managed/browserActor', () => ({ coManagedBrowserActor: vi.fn() }));
vi.mock('../../../../../server/src/lib/co-managed/admitSponsor', () => ({ admitCoManagedSponsor: vi.fn() }));
// In this vitest config `@enterprise` resolves to the CE stubs; the root resolver must see the real EE modules.
vi.mock('@enterprise/lib/co-managed/seatTrialDiscovery', () => vi.importActual('../../lib/co-managed/seatTrialDiscovery'));
vi.mock('@enterprise/lib/co-managed/purchaseDiscovery', () => vi.importActual('../../lib/co-managed/purchaseDiscovery'));
vi.mock('@alga-psa/email', () => ({ sendTeamInvitationEmail: vi.fn(async () => true) }));

import { registerBillingCatalogContextLoader, type BillingCatalogContext } from '@alga-psa/licensing';
import { getSeatTrialOfferAction, prepareCoManagedSeatTrialAction } from '../../lib/actions/coManagedSeatTrialActions';
import { getCoManagedPurchaseDiscoveryAction } from '../../lib/actions/coManagedPurchaseDiscoveryActions';
import { canDiscoverSeatTrial } from '../../lib/co-managed/seatTrialDiscovery';
import { resolveCoManagedRootAccess } from '../../../../../server/src/lib/co-managed/commercialAccess';
import '@alga-psa/co-managed/seatCapability';

const sellable: BillingCatalogContext = { mode: 'test', stripeAccount: 'acct_db', priceId: 'price_db', source: 'database', sellable: true };
const unconfigured: BillingCatalogContext = { mode: 'test', stripeAccount: null, priceId: null, source: 'unconfigured', sellable: false };
const loader = vi.fn(async (): Promise<BillingCatalogContext> => sellable);

beforeEach(() => {
  process.env.CAPABILITY_CACHE_TTL_MS = '0'; // every admits() reaches the eligibility resolver and the gate
  delete process.env.STRIPE_CO_MANAGED_USER_PRICE_ID;
  delete process.env.FORCE_CAPABILITIES;
  loader.mockReset().mockResolvedValue(sellable);
  registerBillingCatalogContextLoader(loader);
  holder.plan = 'pro';
  holder.billingSource = 'stripe';
  holder.billing = false;
  holder.gateChecks = 0;
});

describe('catalog context loads once per request at the entry points', () => {
  const entryPoints: Array<[string, () => Promise<unknown>, (result: any) => void]> = [
    ['getSeatTrialOfferAction', () => getSeatTrialOfferAction(), (r) => expect(r).toMatchObject({ intake: true, canStart: true })],
    ['prepareCoManagedSeatTrialAction (withTrialIntake)', () => prepareCoManagedSeatTrialAction({ clientId: 'c', contactId: 'k', operationId: 'o', boards: [] }),
      (r) => expect(r).toMatchObject({ trialId: 'trial' })],
    ['getCoManagedPurchaseDiscoveryAction (canDiscoverSeatTrial)', () => getCoManagedPurchaseDiscoveryAction(), (r) => expect(r).toBe(true)],
    ['resolveCoManagedRootAccess, trial path (/msp/co-managed render)', () => resolveCoManagedRootAccess('sponsor'), (r) => expect(r).toMatchObject({ trial: true })],
  ];

  it.each(entryPoints)('%s: one load for several gate checks, and a second request loads again', async (_name, call, check) => {
    check(await call());
    expect(holder.gateChecks).toBeGreaterThanOrEqual(2); // the surface check plus the capability's eligibility check
    expect(loader).toHaveBeenCalledTimes(1);

    loader.mockClear();
    holder.gateChecks = 0;
    check(await call());
    expect(loader).toHaveBeenCalledTimes(1); // a new request: no cross-request cache
  });

  it('resolveCoManagedRootAccess on the commercial path also loads once', async () => {
    holder.billing = true;
    expect(await resolveCoManagedRootAccess('sponsor')).toMatchObject({ commercial: true });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('a change of the account setting is visible on the very next request', async () => {
    expect(await getSeatTrialOfferAction()).toMatchObject({ canStart: true });
    loader.mockResolvedValue(unconfigured);
    expect(await getSeatTrialOfferAction()).toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('fails closed under a scope when the loader throws, even with the legacy env var set', async () => {
    process.env.STRIPE_CO_MANAGED_USER_PRICE_ID = 'price_env';
    loader.mockRejectedValue(new Error('catalog down'));
    expect(await getSeatTrialOfferAction()).toBeNull();
    await expect(prepareCoManagedSeatTrialAction({ clientId: 'c', contactId: 'k', operationId: 'o', boards: [] })).rejects.toThrow();
    delete process.env.STRIPE_CO_MANAGED_USER_PRICE_ID;
  });

  it('one eligibility rule: a sponsor prepare refuses is neither discovered nor offered the trial', async () => {
    holder.billingSource = 'manual';
    expect(await canDiscoverSeatTrial(holder.user as never, 'sponsor')).toBe(false);
    expect(await resolveCoManagedRootAccess('sponsor')).not.toHaveProperty('trial');
    expect(await getSeatTrialOfferAction()).toBeNull();
  });

  it('canDiscoverSeatTrial called directly (no entry scope) still answers the same, loading per check', async () => {
    expect(await canDiscoverSeatTrial(holder.user as never, 'sponsor')).toBe(true);
    expect(loader.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
