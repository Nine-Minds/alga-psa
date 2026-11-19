/** Shared Stripe offer catalog against the migrated EE integration database (T001, T002, T007-catalog half). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createTestDbConnection } from '@main-test-utils/dbConfig';
import { runCatalogCommand, formatTerms } from '../../lib/stripe/offerCatalog/cli';
import { createOfferCatalog, seedFromLegacyEnv, OfferPublishError, OfferUnavailableError, CO_MANAGED_SEAT_OFFER_KEY, type CatalogScope } from '../../lib/stripe/offerCatalog';

const MASTER = '00000000-0000-4000-8000-0000000000aa';
const operator = { tenantId: MASTER, userId: 'op@nineminds.test' };
const tenantAdmin = { tenantId: '11111111-1111-4111-8111-111111111111', userId: 'admin@msp.test' };
const KEY = CO_MANAGED_SEAT_OFFER_KEY;
const TEST: CatalogScope = { stripeAccount: 'acct_1', livemode: false };

const price = (id: string, over: Record<string, unknown> = {}) => ({
  id, active: true, livemode: false, type: 'recurring', billing_scheme: 'per_unit', currency: 'eur', unit_amount: 1100, product: 'prod_seat',
  transform_quantity: null, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, ...over });

describe('stripe offer catalog (postgres)', () => {
  let db: Knex;
  let prices: Record<string, any>;
  const catalog = (scope: CatalogScope = TEST, env: Record<string, string | undefined> = {}, stripeFails = false) => createOfferCatalog({
    db, scope: async () => scope, env: { MASTER_BILLING_TENANT_ID: MASTER, ...env },
    stripe: { prices: { retrieve: async (id: string) => { if (stripeFails) throw new Error('stripe down'); if (!prices[id]) throw new Error('no such price'); return prices[id]; } } } as any,
  });

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 'stripe_offer_catalog_test', runSeeds: false });
    const migration = createRequire(import.meta.url)(path.resolve(__dirname, '../../../migrations/20261118090000_create_stripe_offer_catalog.cjs'));
    await migration.up(db); // re-running the migration changes nothing
  });
  afterAll(async () => { await db?.destroy(); });
  beforeEach(async () => {
    await db.raw('TRUNCATE stripe_offer_publications, stripe_offer_versions CASCADE');
    prices = { price_a: price('price_a'), price_b: price('price_b'), price_c: price('price_c') };
  });

  it('T001: seeding twice leaves one current version; every historical id reverse-resolves', async () => {
    const env = { STRIPE_CO_MANAGED_USER_PRICE_ID: 'price_b' };
    const c = catalog(TEST, env);
    prices.price_old = price('price_old', { active: false });
    const first = await seedFromLegacyEnv(c, operator, { historicalPriceIds: ['price_old'], productId: 'prod_seat', env });
    const second = await seedFromLegacyEnv(c, operator, { historicalPriceIds: ['price_old'], productId: 'prod_seat', env });
    expect(first.map((r) => r.outcome)).toEqual(['seeded-historical', 'seeded-current']);
    expect(second.map((r) => r.outcome)).toEqual(['already-bound', 'already-bound']);
    const rows = await db('stripe_offer_versions').orderBy('version_number');
    expect(rows.map((r) => [r.price_id, r.is_current])).toEqual([['price_old', false], ['price_b', true]]);
    expect((await c.classifyPrice(TEST, 'price_old'))).toMatchObject({ source: 'catalog', current: false, offerKey: KEY });
    expect((await c.classifyPrice(TEST, 'price_b'))).toMatchObject({ current: true });
    expect(await c.classifyPrice(TEST, 'price_unknown')).toBeNull();
    expect([...(await c.recognizedPriceIds(KEY, 'month'))].sort()).toEqual(['price_b', 'price_old']);
  });

  it('T001: competing publishes against the same reviewed version admit exactly one', async () => {
    const c = catalog();
    const seed = await c.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId: 'price_a', expectedCurrentVersionId: null, productId: 'prod_seat' });
    const settled = await Promise.allSettled(['price_b', 'price_c'].map((priceId) =>
      c.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId, expectedCurrentVersionId: seed.version.version_id })));
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const lost = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: 'STALE_EXPECTED_VERSION' });
    expect(await db('stripe_offer_versions').where({ is_current: true })).toHaveLength(1);
  });

  it('T001: competing FIRST publications admit exactly one; identical ones are idempotent', async () => {
    const c = catalog();
    const run = (priceId: string) => c.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId, expectedCurrentVersionId: null, productId: 'prod_seat' });
    const settled = await Promise.allSettled([run('price_a'), run('price_b')]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const same = await Promise.allSettled([run('price_c'), run('price_c')]);
    expect(same.every((s) => s.status === 'fulfilled' || (s as any).reason.code === 'STALE_EXPECTED_VERSION')).toBe(true);
    expect(await db('stripe_offer_versions').where({ is_current: true })).toHaveLength(1);
  });

  it('publishes, republishes idempotently, and restores an earlier binding; history is never deleted', async () => {
    const c = catalog();
    const v1 = await c.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId: 'price_a', expectedCurrentVersionId: null, productId: 'prod_seat' });
    const v2 = await c.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId: 'price_b', expectedCurrentVersionId: v1.version.version_id });
    expect(v2).toMatchObject({ changed: true, action: 'publish' });
    expect(await c.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId: 'price_b', expectedCurrentVersionId: v1.version.version_id })).toMatchObject({ changed: false, action: 'unchanged' });
    const restored = await c.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId: 'price_a', expectedCurrentVersionId: v2.version.version_id });
    expect(restored).toMatchObject({ changed: true, action: 'restore' });
    expect(restored.version.version_id).toBe(v1.version.version_id);
    expect((await c.inspect(KEY, 'month')).current?.price_id).toBe('price_a');
    expect(await db('stripe_offer_versions')).toHaveLength(2);
    expect(await db('stripe_offer_publications').orderBy('created_at').pluck('action')).toEqual(['publish', 'publish', 'restore']);
  });

  it('T002: rejection matrix changes nothing', async () => {
    const c = catalog();
    const v1 = await c.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId: 'price_a', expectedCurrentVersionId: null, productId: 'prod_seat' });
    prices.wrong_product = price('wrong_product', { product: 'prod_other' });
    prices.yearly = price('yearly', { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } });
    prices.live = price('live', { livemode: true });
    prices.inactive = price('inactive', { active: false });
    prices.tiered = price('tiered', { billing_scheme: 'tiered', unit_amount: null });
    prices.metered = price('metered', { recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } });
    prices.packaged = price('packaged', { transform_quantity: { divide_by: 5, round: 'up' } });
    prices.other_offer = price('other_offer');
    await c.publishBinding({ actor: operator, offerKey: 'some_other_offer', interval: 'month', priceId: 'other_offer', expectedCurrentVersionId: null, productId: 'prod_seat' });
    const before = JSON.stringify(await db('stripe_offer_versions').orderBy('price_id'));
    const attempt = (priceId: string, actor: any = operator, expected: string | null = v1.version.version_id) =>
      c.publishBinding({ actor, offerKey: KEY, interval: 'month', priceId, expectedCurrentVersionId: expected });
    await expect(attempt('price_b', tenantAdmin)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(attempt('price_b', null)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(attempt('wrong_product')).rejects.toMatchObject({ code: 'INVALID_CANDIDATE' });
    for (const id of ['yearly', 'inactive', 'tiered', 'metered', 'packaged']) await expect(attempt(id)).rejects.toMatchObject({ code: 'INVALID_CANDIDATE' });
    await expect(attempt('live')).rejects.toMatchObject({ code: 'WRONG_MODE' });
    await expect(attempt('other_offer')).rejects.toMatchObject({ code: 'BOUND_TO_OTHER_OFFER' });
    await expect(attempt('price_b', operator, null)).rejects.toMatchObject({ code: 'STALE_EXPECTED_VERSION' });
    await expect(attempt('missing')).rejects.toBeInstanceOf(OfferPublishError);
    expect(JSON.stringify(await db('stripe_offer_versions').orderBy('price_id'))).toBe(before);
    expect((await c.inspect(KEY, 'month')).current?.price_id).toBe('price_a');
  });

  it('keeps test/live and account namespaces independent', async () => {
    await catalog(TEST).publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId: 'price_a', expectedCurrentVersionId: null, productId: 'prod_seat' });
    const live = catalog({ stripeAccount: 'acct_1', livemode: true });
    prices.live_a = price('live_a', { livemode: true });
    await live.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId: 'live_a', expectedCurrentVersionId: null, productId: 'prod_seat' });
    expect(await live.classifyPrice({ stripeAccount: 'acct_1', livemode: true }, 'price_a')).toBeNull();
    expect(await catalog(TEST).classifyPrice(TEST, 'live_a')).toBeNull();
    expect((await catalog({ stripeAccount: 'acct_2', livemode: false }).inspect(KEY, 'month')).current).toBeNull();
  });

  it('T007: legacy env serves only unmanaged keys; managed keys fail closed and never fall back', async () => {
    const env = { STRIPE_CO_MANAGED_USER_PRICE_ID: 'price_a' };
    expect(await catalog(TEST, env).resolveCurrentOffer(KEY, 'month')).toMatchObject({ source: 'legacy_env', priceId: 'price_a', terms: { unitAmount: 1100, currency: 'eur', interval: 'month' } });
    await expect(catalog(TEST, {}).resolveCurrentOffer(KEY, 'month')).rejects.toMatchObject({ reason: 'not_configured' });
    const managed = catalog(TEST, env);
    const v1 = await managed.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId: 'price_b', expectedCurrentVersionId: null, productId: 'prod_seat' });
    expect(await managed.resolveCurrentOffer(KEY, 'month')).toMatchObject({ source: 'catalog', priceId: 'price_b', versionId: v1.version.version_id });
    // an outage or an invalid mapping fails closed, even with the env var still set
    await expect(catalog(TEST, env, true).resolveCurrentOffer(KEY, 'month')).rejects.toMatchObject({ reason: 'stripe_unavailable' });
    prices.price_b.active = false;
    await expect(managed.resolveCurrentOffer(KEY, 'month')).rejects.toMatchObject({ reason: 'invalid_mapping' });
    // ...while historical recognition keeps working for retired and for paused-offer prices
    expect(await managed.classifyPrice(TEST, 'price_b')).toMatchObject({ current: true });
    expect([...(await managed.recognizedPriceIds(KEY, 'month'))]).toEqual(['price_b']);
    // env no longer classifies once the key is managed
    expect(await managed.classifyPrice(TEST, 'price_a')).toBeNull();
    // paused: managed but nothing current
    await db('stripe_offer_versions').update({ is_current: false });
    await expect(managed.resolveCurrentOffer(KEY, 'month')).rejects.toBeInstanceOf(OfferUnavailableError);
    await expect(managed.resolveCurrentOffer(KEY, 'month')).rejects.toMatchObject({ reason: 'no_current_version' });
    expect(await managed.isOfferSellable(KEY, 'month')).toBe(false);
  });

  describe('operator CLI', () => {
    const run = async (command: string, args: string[], actor: any = operator, subs: any[] = [], env: Record<string, string> = {}) => {
      const lines: string[] = [];
      const code = await runCatalogCommand(command, args, { catalog: catalog(TEST, env), db, actor, locale: 'de', out: (l) => lines.push(l), env: { MASTER_BILLING_TENANT_ID: MASTER, ...env },
        stripe: { subscriptions: { list: async function* () { yield* subs; } } } as any });
      return { code, text: lines.join('\n') };
    };

    it('shows Stripe-derived amount, currency and interval for review and writes nothing on a dry run', async () => {
      const dry = await run('publish', ['--price=price_a', '--product=prod_seat']);
      expect(dry.text).toContain('11,00\u00a0€');
      expect(dry.text).toContain('EUR');
      expect(dry.text).toContain('month');
      expect(dry.text).toContain('Dry run');
      expect(await db('stripe_offer_versions')).toHaveLength(0);
      expect(formatTerms({ unitAmount: 1500, currency: 'jpy', interval: 'month', intervalCount: 1 }, 'en')).toContain('¥1,500');
    });

    it('publishes only with --confirm and an expected version, then restores', async () => {
      expect((await run('publish', ['--price=price_a', '--product=prod_seat', '--confirm'])).code).toBe(2);
      await run('publish', ['--price=price_a', '--product=prod_seat', '--expect=none', '--confirm']);
      const v1 = (await catalog().inspect(KEY, 'month')).current!;
      await run('publish', ['--price=price_b', `--expect=${v1.version_id}`, '--confirm']);
      const v2 = (await catalog().inspect(KEY, 'month')).current!;
      const restored = await run('restore', [`--version=${v1.version_id}`, `--expect=${v2.version_id}`, '--confirm']);
      expect(restored.text).toContain('Restored version 1');
      expect((await catalog().inspect(KEY, 'month')).current?.price_id).toBe('price_a');
    });

    it('refuses a tenant admin for every command', async () => {
      for (const command of ['inspect', 'publish', 'restore', 'seed', 'inventory', 'pause']) {
        await expect(run(command, ['--price=price_a', '--confirm'], tenantAdmin)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      }
    });

    it('F002/F014/T007: rehearses the rollout end to end: legacy, inventory, seed, rotate, pause, restore', async () => {
      const env = { STRIPE_CO_MANAGED_USER_PRICE_ID: 'price_a' };
      const c = catalog(TEST, env);
      const co = (id: string, sub: string) => ({ id: sub, status: 'active', metadata: { subscription_kind: 'co_managed' }, items: { data: [{ price: { id } }] } });
      await db.raw('CREATE TABLE IF NOT EXISTS co_managed_purchase_operations (tenant uuid, operation_id uuid, state text, price_id text, quantity int)');
      await db('co_managed_purchase_operations').del();
      try {
        // Stage 1: nothing managed. The legacy env binding sells; an in-flight operation predates pinning.
        await db('co_managed_purchase_operations').insert({ tenant: MASTER, operation_id: '44444444-4444-4444-8444-444444444444', state: 'checkout', price_id: null, quantity: 2 });
        expect(await c.resolveCurrentOffer(KEY, 'month')).toMatchObject({ source: 'legacy_env', priceId: 'price_a' });
        const subs = [co('price_a', 'sub_legacy')];
        const before = await run('inventory', [], operator, subs, env);
        expect(before.code).toBe(0);
        expect(before.text).toContain('mapped via legacy env  price_a');
        expect(before.text).toContain('1 open operation(s) predate pinning');

        // Stage 2: seed twice (idempotent); the catalog now agrees with legacy selection.
        expect((await run('seed', ['--product=prod_seat', '--confirm'], operator, [], env)).text).toContain('seeded-current');
        expect((await run('seed', ['--product=prod_seat', '--confirm'], operator, [], env)).text).toContain('already-bound');
        const v1 = (await c.inspect(KEY, 'month')).current!;
        expect((await run('inspect', [], operator, [], env)).text).toContain('matches the current version');
        expect(await c.resolveCurrentOffer(KEY, 'month')).toMatchObject({ source: 'catalog', priceId: 'price_a', versionId: v1.version_id });

        // Stage 3: first rotation. New sales use price_b; the legacy subscription still classifies.
        await run('publish', ['--price=price_b', `--expect=${v1.version_id}`, '--confirm'], operator, [], env);
        const v2 = (await c.inspect(KEY, 'month')).current!;
        expect((await c.resolveCurrentOffer(KEY, 'month')).priceId).toBe('price_b');
        expect(await c.classifyPrice(TEST, 'price_a')).toMatchObject({ source: 'catalog', current: false });
        expect((await run('inspect', [], operator, [], env)).text).toContain('DIFFERS from the current version');
        expect((await run('inventory', [], operator, [...subs, co('price_b', 'sub_new')], env)).code).toBe(0);

        // Stage 4: pause new sales. Dry run and a stale expectation write nothing.
        expect((await run('pause', [], operator, [], env)).text).toContain('Dry run');
        expect((await run('pause', ['--confirm'], operator, [], env)).code).toBe(2);
        await expect(run('pause', [`--expect=${v1.version_id}`, '--confirm'], operator, [], env)).rejects.toMatchObject({ code: 'STALE_EXPECTED_VERSION' });
        expect((await c.inspect(KEY, 'month')).current?.version_id).toBe(v2.version_id);
        expect((await run('pause', [`--expect=${v2.version_id}`, '--confirm'], operator, [], env)).text).toContain('Paused.');
        expect((await run('pause', ['--expect=none', '--confirm'], operator, [], env)).text).toContain('Already paused');
        // ...new sales fail closed and the env var is NOT revived; recognition of both prices continues.
        await expect(c.resolveCurrentOffer(KEY, 'month')).rejects.toMatchObject({ reason: 'no_current_version' });
        expect(await c.isOfferSellable(KEY, 'month')).toBe(false);
        expect([...(await c.recognizedPriceIds(KEY, 'month'))].sort()).toEqual(['price_a', 'price_b']);
        expect(await c.classifyPrice(TEST, 'price_b')).toMatchObject({ source: 'catalog', current: false });
        // ...and re-running the seed during a pause must not reopen sales.
        expect((await run('seed', ['--product=prod_seat', '--confirm'], operator, [], env)).text).toContain('new sales paused');
        expect((await c.inspect(KEY, 'month')).current).toBeNull();

        // Stage 5: restore the previous binding; the next new purchase uses it.
        expect((await run('restore', [`--version=${v1.version_id}`, '--expect=none', '--confirm'], operator, [], env)).text).toContain('Restored version 1');
        expect(await c.resolveCurrentOffer(KEY, 'month')).toMatchObject({ source: 'catalog', priceId: 'price_a', versionId: v1.version_id });
        expect(await db('stripe_offer_publications').orderBy('created_at').pluck('action')).toEqual(['seed', 'publish', 'pause', 'restore']);
        expect(await db('stripe_offer_publications').where({ action: 'pause' }).first()).toMatchObject({ from_version_id: v2.version_id, to_version_id: null });
        expect(await db('stripe_offer_versions')).toHaveLength(2);
      } finally {
        await db.raw('DROP TABLE co_managed_purchase_operations');
      }
    });

    it('refuses to pause an offer the catalog does not manage', async () => {
      await expect(run('pause', ['--expect=none', '--confirm'])).rejects.toMatchObject({ code: 'INVALID_CANDIDATE' });
    });

    it.each([
      { failed: 1, expectedCode: 2 },
      { failed: 0, expectedCode: 0 },
    ])('reports fulfillment retry totals and exits $expectedCode with $failed failures', async ({ failed, expectedCode }) => {
      const lines: string[] = [];
      const code = await runCatalogCommand('retry-fulfillments', [], {
        catalog: catalog(),
        db,
        actor: operator,
        locale: 'de',
        out: (line) => lines.push(line),
        env: { MASTER_BILLING_TENANT_ID: MASTER },
        stripe: {} as any,
        retryFulfillments: async () => ({ delivered: 2, failed, superseded: 1 }),
      });
      expect(code).toBe(expectedCode);
      expect(lines.join('\n')).toContain(`2 delivered, 1 superseded, ${failed} still failing`);
    });

    it('F002: inventory reports unmapped prices and does not map them', async () => {
      await run('publish', ['--price=price_a', '--product=prod_seat', '--expect=none', '--confirm']);
      const co = (id: string, status = 'active') => ({ id: 'sub_' + id, status, metadata: { subscription_kind: 'co_managed' }, items: { data: [{ price: { id } }] } });
      await db.raw('CREATE TABLE IF NOT EXISTS co_managed_purchase_operations (tenant uuid, operation_id uuid, state text, price_id text, quantity int)');
      await db('co_managed_purchase_operations').del();
      await db('co_managed_purchase_operations').insert([{ tenant: MASTER, operation_id: '22222222-2222-4222-8222-222222222222', state: 'checkout', price_id: 'price_mystery', quantity: 3 },
        { tenant: MASTER, operation_id: '33333333-3333-4333-8333-333333333333', state: 'preparing', price_id: null, quantity: 1 }]);
      const result = await run('inventory', [], operator, [co('price_a'), co('price_ghost'), co('price_gone', 'canceled'), { id: 'sub_other', status: 'active', metadata: {}, items: { data: [{ price: { id: 'price_pro' } }] } }]);
      expect(result.code).toBe(2);
      expect(result.text).toContain('mapped co_managed_technician_seat/month current  price_a');
      expect(result.text).toMatch(/UNMAPPED\s+price_ghost/);
      expect(result.text).toMatch(/UNMAPPED\s+price_mystery/);
      expect(result.text).not.toContain('price_gone');
      expect(result.text).not.toContain('price_pro');
      expect(result.text).toContain('predate pinning');
      expect(await db('stripe_offer_versions')).toHaveLength(1);
      await db.raw('DROP TABLE co_managed_purchase_operations');
    });
  });
});
