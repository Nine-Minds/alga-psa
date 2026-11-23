/**
 * Journey: the hosted 15-day Seat trial on a deployment configured ONLY through the database offer
 * catalog (stripe_offer_catalog_settings + stripe_offer_versions), with STRIPE_CO_MANAGED_USER_PRICE_ID
 * and STRIPE_ACCOUNT_ID unset. The trial callers run with no `withBillingCatalogContext`, so the answer
 * must come from the loader that EE's surfaceProbe registers with @alga-psa/licensing.
 *
 * Real: migrated PostgreSQL, OfferCatalog, trial and capability code, the surface gate and loader.
 * Stubbed: auth/session, RBAC, and the two StripeService methods that call Stripe over the network
 * (`refreshSeatTrialBase`, the live price read in `coManagedSeatPrice`).
 */
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { buildMergedEeMigrationsDir } from '../../../test-utils/eeMigrations';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser, ensureContactWithEmail } from '../../../test-utils/testDataFactory';

const holder = vi.hoisted(() => ({ db: null as unknown as Knex, user: { user_id: 'admin', tenant: '', user_type: 'internal' } }));

vi.mock('@alga-psa/core/features', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/core/features')>(),
  isEnterprise: true,
  isFeatureFlagEnabled: async () => true,
}));
vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: async () => holder.user,
  getSession: async () => ({ user: holder.user }),
  withAuth: (work: (...args: any[]) => unknown) => (...args: unknown[]) => work(holder.user, { tenant: holder.user.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/db', async (original) => ({
  ...await original<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: holder.db }),
  getAdminConnection: async () => holder.db,
}));
vi.mock('@alga-psa/db/admin', async (original) => ({ ...await original<typeof import('@alga-psa/db/admin')>(), getAdminConnection: async () => holder.db }));
vi.mock('@alga-psa/db/admin.js', async (original) => ({ ...await original<typeof import('@alga-psa/db/admin.js')>(), getAdminConnection: async () => holder.db }));
vi.mock('@/lib/db/db', () => ({ getConnection: async () => holder.db }));
vi.mock('@alga-psa/core/capability/server', async () => {
  const { admits } = await import('@alga-psa/core/capability');
  return { requireCapabilityForAction: async (key: 'co-managed-seat', tenant: string) => {
    if (!(await admits(key, tenant)).admitted) throw new Error('Capability not admitted');
  } };
});
vi.mock('../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: vi.fn() }));
vi.mock('../../lib/co-managed/admitSponsor', () => ({ admitCoManagedSponsor: vi.fn() }));
vi.mock('@alga-psa/core/secrets', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/core/secrets')>(),
  getSecretProviderInstance: vi.fn(async () => ({ getAppSecret: vi.fn(async () => undefined), getTenantSecret: vi.fn(async () => undefined) })),
}));
vi.mock('@alga-psa/email', async (original) => ({ ...await original<typeof import('@alga-psa/email')>(), sendTeamInvitationEmail: vi.fn(async () => true) }));
vi.mock('@alga-psa/authorization/clientScopeAuthorization', () => ({
  createClientScopeContext: async () => ({ permits: async () => true }),
}));

const describeDb = await describeWithDb();


describeDb('co-managed Seat trial resolves the offer at the gate (database catalog only)', { shuffle: false }, () => {
  let migrationsDir: string;
  let tenant: string;
  let clientId: string;
  let contactId: string;
  const ACCOUNT = 'acct_database_only';
  const PRICE = 'price_database_only';

  /** An eligible hosted Pro sponsor: active base subscription, no trial, no entitlement. Signs in as its admin. */
  async function sponsorFixture() {
    const db = holder.db;
    const sponsor = await createTenant(db, 'Database-only sponsor', { productCode: 'psa' });
    await db('tenants').where({ tenant: sponsor }).update({ billing_source: 'stripe', plan: 'pro', licensed_user_count: 1 });
    holder.user.tenant = sponsor;
    holder.user.user_id = await createUser(db, sponsor);
    const [customer] = await db('stripe_customers').insert({ tenant: sponsor, stripe_customer_external_id: 'cus_' + sponsor, email: 'msp@example.test' }).returning('*');
    const [product] = await db('stripe_products').insert({ tenant: sponsor, stripe_product_external_id: 'prod_' + sponsor, name: 'Pro', product_type: 'license' }).returning('*');
    const [price] = await db('stripe_prices').insert({ tenant: sponsor, stripe_price_external_id: 'price_' + sponsor,
      stripe_product_id: product.stripe_product_id, unit_amount: 2900 }).returning('*');
    await db('stripe_subscriptions').insert({ tenant: sponsor, stripe_subscription_external_id: 'sub_' + sponsor,
      stripe_customer_id: customer.stripe_customer_id, stripe_price_id: price.stripe_price_id, status: 'active',
      current_period_end: new Date(Date.now() + 30 * 86_400_000) });
    const client = await createClient(db, sponsor, `Pilot client ${randomUUID()}`);
    const contact = await ensureContactWithEmail(db, sponsor, client, randomUUID() + '@example.test', 'Pilot Technician');
    return { tenant: sponsor, clientId: client, contactId: contact };
  }

  beforeAll(async () => {
    migrationsDir = buildMergedEeMigrationsDir();
    holder.db = await createTestDbConnection({ databaseName: 'seat_trial_offer_at_gate_test', migrationsDir });
    vi.stubEnv('STRIPE_CO_MANAGED_USER_PRICE_ID', undefined);
    vi.stubEnv('STRIPE_ACCOUNT_ID', undefined);
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_database_only');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_database_only');
    vi.stubEnv('MASTER_BILLING_TENANT_ID', randomUUID());
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_database_only');
    vi.stubEnv('CAPABILITY_CACHE_TTL_MS', '0');
    delete process.env.FORCE_CAPABILITIES;
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';

    ({ tenant, clientId, contactId } = await sponsorFixture());
  }, 300_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await holder.db?.destroy();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  });

  it('offers, admits and starts the trial from the database catalog, and closes when it is removed', async () => {
    // Importing the EE actions pulls in surfaceProbe, which registers the loader (as the entry points do).
    await import('@ee/lib/stripe/offerCatalog/surfaceProbe');
    const { getStripeService } = await import('@ee/lib/stripe/StripeService');
    const { getSeatTrialOfferAction, prepareCoManagedSeatTrialAction } = await import('@ee/lib/actions/coManagedSeatTrialActions');
    const { admits } = await import('@alga-psa/core/capability');
    await import('@alga-psa/co-managed/seatCapability');
    const { registerFeatureFlagChecker } = await import('@alga-psa/core/features');
    registerFeatureFlagChecker(async () => true);

    const service = getStripeService();
    await service.getOfferCatalog();
    vi.spyOn(service['stripe'].accounts, 'retrieve').mockRejectedValue(new Error('account reads denied'));
    vi.spyOn(service['stripe'].prices, 'retrieve').mockResolvedValue({
      id: PRICE, object: 'price', product: 'prod_database_only', livemode: false, active: true, type: 'recurring', billing_scheme: 'per_unit',
      unit_amount: 1149, currency: 'eur', transform_quantity: null, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    } as never);
    vi.spyOn(service, 'refreshSeatTrialBase').mockResolvedValue(undefined as never);

    await holder.db('stripe_offer_versions').insert({ stripe_account: ACCOUNT, livemode: false,
      offer_key: 'co_managed_technician_seat', billing_interval: 'month', version_number: 1,
      price_id: PRICE, product_id: 'prod_database_only', is_current: true, published_by: 'fixture' });
    await holder.db('stripe_offer_catalog_settings').insert({ stripe_account: ACCOUNT, livemode: false, price_id: PRICE, updated_by: 'fixture' });

    // No withBillingCatalogContext anywhere on these paths.
    expect(await getSeatTrialOfferAction()).toMatchObject({ intake: true, canStart: true, price: { unitAmount: 1149, currency: 'eur' } });
    expect((await admits('co-managed-seat', tenant)).admitted).toBe(true);
    const prepared = await prepareCoManagedSeatTrialAction({ clientId, contactId, operationId: randomUUID(), boards: [] });
    expect(prepared).toMatchObject({ trialId: expect.any(String) });
    expect(await holder.db('co_managed_seat_trials').where({ tenant }).first()).toMatchObject({ state: 'pending' });

    // One eligibility rule: a sponsor prepare would refuse is not offered the invite either. Capability and catalog
    // still admit it; only the sponsor's own entitlement (an admin grant, not hosted) makes it ineligible.
    const ineligible = await sponsorFixture();
    await holder.db('co_managed_entitlements').insert({ tenant: ineligible.tenant, source: 'admin_grant', source_reference: 'grant_' + ineligible.tenant,
      capacity: 3, verified_at: new Date(), valid_until: new Date(Date.now() + 86_400_000) });
    expect((await admits('co-managed-seat', ineligible.tenant)).admitted).toBe(true);
    expect(await getSeatTrialOfferAction()).toBeNull();
    await expect(prepareCoManagedSeatTrialAction({ clientId: ineligible.clientId, contactId: ineligible.contactId, operationId: randomUUID(), boards: [] }))
      .resolves.toEqual({ rejected: true, errorCode: 'SPONSOR_NOT_ELIGIBLE' });
    expect(await holder.db('co_managed_seat_trials').where({ tenant: ineligible.tenant })).toHaveLength(0);

    // Remove the catalog. A second eligible sponsor (the first now holds a trial entitlement) is refused.
    await holder.db('stripe_offer_catalog_settings').delete();
    await holder.db('stripe_offer_versions').delete();
    const other = await sponsorFixture();
    expect(await getSeatTrialOfferAction()).toBeNull();
    expect((await admits('co-managed-seat', other.tenant)).admitted).toBe(false);
    await expect(prepareCoManagedSeatTrialAction({ clientId: other.clientId, contactId: other.contactId, operationId: randomUUID(), boards: [] }))
      .rejects.toThrow();
    expect(await holder.db('co_managed_seat_trials').where({ tenant: other.tenant })).toHaveLength(0);
  }, 120_000);
});
