import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeService } from '../../../lib/stripe/StripeService';
import { createOfferCatalog, CO_MANAGED_SEAT_OFFER_KEY, OfferUnavailableError } from '../../../lib/stripe/offerCatalog';

const mocks = vi.hoisted(() => ({ loggerError: vi.fn(), admin: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.loggerError } }));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn() }));
vi.mock('@alga-psa/licensing', () => ({ runCoManagedPurchase: vi.fn(), reconcileHostedCoManagedEntitlement: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn(), auditLog: vi.fn() }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: mocks.admin }));

const SCOPE = { stripeAccount: 'acct_test', livemode: false };
const KEY = CO_MANAGED_SEAT_OFFER_KEY;

/** A Knex stand-in whose queries fail once its pool is destroyed, like a real destroyed pool. */
function fakePool(priceIds: string[]) {
  const pool: any = (table: string) => {
    const guard = async <T>(value: T): Promise<T> => {
      if (pool.destroyed) throw new Error('Unable to acquire a connection: pool destroyed');
      return value;
    };
    const rows = table === 'stripe_offer_versions' ? priceIds.map((price_id) => ({ price_id, version_id: `v_${price_id}`, is_current: true })) : [];
    const query: any = {
      where: () => query,
      first: () => guard(rows[0]),
      select: () => guard(rows),
      distinct: () => ({ pluck: () => guard([]) }),
    };
    return query;
  };
  pool.destroyed = false;
  return pool;
}

describe('offer catalog resolves the admin pool per operation', () => {
  beforeEach(() => { mocks.loggerError.mockReset(); mocks.admin.mockReset(); });

  it('survives an admin pool rebuild without a restart (incident 2026-11-22)', async () => {
    const first = fakePool(['price_a']);
    mocks.admin.mockResolvedValue(first);
    const service = new StripeService() as any;
    service.initPromise = Promise.resolve();
    service.config = { secretKey: 'sk_test_fixture' };
    service.stripe = { prices: { retrieve: vi.fn() }, subscriptions: {}, accounts: { retrieve: async () => ({ id: 'acct_test' }) } };
    const catalog = await service.getOfferCatalog();
    expect([...await catalog.recognizedPriceIds(KEY, 'month', SCOPE)]).toEqual(['price_a']);

    // getAdminConnection() destroys its pool and builds a new one after a connection-reset wave.
    first.destroyed = true;
    const second = fakePool(['price_a', 'price_b']);
    mocks.admin.mockResolvedValue(second);

    // The memoised catalog instance is reused; each of these paths must pick up the new pool.
    expect((await service.getOfferCatalog())).toBe(catalog);
    expect([...await catalog.recognizedPriceIds(KEY, 'month', SCOPE)].sort()).toEqual(['price_a', 'price_b']);
    expect([...await catalog.recognizedPriceIds(KEY, 'month')].sort()).toEqual(['price_a', 'price_b']); // resolves the scope through the pool
    await expect(catalog.isOfferSellable(KEY, 'month')).resolves.toBe(true);
    // the webhook claim path: admits -> refreshCoManagedRecognition -> recognizedPriceIds
    expect((await service.refreshCoManagedRecognition()).size).toBe(2);
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('logs the underlying error code and message once per distinct code, never the query or price', async () => {
    const brokenQuery = () => { throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' }); };
    const queryFails = createOfferCatalog({ db: async () => brokenQuery as never, scope: async () => SCOPE, stripe: {} as never, env: {} });
    for (let i = 0; i < 3; i++) {
      await expect(queryFails.recognizedPriceIds(KEY, 'month', SCOPE)).rejects.toMatchObject({ reason: 'catalog_unavailable' });
    }
    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    const line = mocks.loggerError.mock.calls[0].join(' ');
    expect(line).toContain('ECONNRESET');
    expect(line).toContain('Connection terminated unexpectedly');
    expect(line).not.toMatch(/price_|acct_|stripe_offer_versions/);

    const otherCode = createOfferCatalog({ db: async () => (() => { throw Object.assign(new Error('too many clients'), { code: '53300' }); }) as never,
      scope: async () => SCOPE, stripe: {} as never, env: {} });
    await expect(otherCode.recognizedPriceIds(KEY, 'month', SCOPE)).rejects.toBeInstanceOf(OfferUnavailableError);
    expect(mocks.loggerError).toHaveBeenCalledTimes(2);
    expect(mocks.loggerError.mock.calls[1].join(' ')).toContain('53300');
  });

  it('treats a failing pool resolver as an outage: logs code and message, throws catalog_unavailable', async () => {
    const resolver = vi.fn().mockRejectedValue(Object.assign(new Error('password authentication failed'), { code: '28P01' }));
    const catalog = createOfferCatalog({ db: resolver, scope: async () => SCOPE, stripe: {} as never, env: {} });
    await expect(catalog.recognizedPriceIds(KEY, 'month', SCOPE)).rejects.toMatchObject({ reason: 'catalog_unavailable' });
    await expect(catalog.isOfferSellable(KEY, 'month')).resolves.toBe(false);
    expect(resolver).toHaveBeenCalledTimes(2); // resolved per operation, not cached
    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    expect(mocks.loggerError.mock.calls[0].join(' ')).toMatch(/28P01.*password authentication failed/);
  });

  it('does not log the missing-table path', async () => {
    const unmigrated = () => { throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); };
    const catalog = createOfferCatalog({ db: async () => unmigrated as never, scope: async () => SCOPE, stripe: {} as never, env: {} });
    expect([...await catalog.recognizedPriceIds(KEY, 'month', SCOPE)]).toEqual([]);
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });
});
