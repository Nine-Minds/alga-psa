/**
 * The shared Stripe offer catalog (resolver, reverse lookup, publication).
 *
 * Every reader of "which Stripe Price is this offer" goes through here and must say which of two
 * questions it is asking:
 *   - NEW-SALE selection  -> `resolveCurrentOffer` (current version, validated against Stripe,
 *                            fails closed once a key is managed);
 *   - RECOGNITION         -> `classifyPrice` / `recognizedPriceIds` (every version ever bound,
 *                            retired included; reads only the catalog, never judges Stripe's
 *                            active flag, so it keeps working while new sales are paused).
 *
 * Platform-only: this module and its tables exist in EE; CE has no catalog (F015).
 */
import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { forgetBillingCatalogRequest, memoiseInBillingCatalogRequest } from '@alga-psa/licensing/billing-catalog-scope';
import {
  CO_MANAGED_SEAT_OFFER_KEY, LEGACY_ENV_BINDINGS, OfferPublishError, OfferUnavailableError,
  type BillingInterval, type CatalogDeps, type EnvLike, type CatalogOperator, type CatalogScope, type ClassifiedPrice,
  type OfferVersionRow, type PublishAction, type PublishResult, type ResolvedOffer,
} from './types';
import { assertCatalogOperator } from './operatorAuth';
import { priceProblems, priceProductId, termsOf } from './priceValidation';

const VERSIONS = 'stripe_offer_versions';
const PUBLICATIONS = 'stripe_offer_publications';
const PG_UNDEFINED_TABLE = '42P01';
const PG_UNIQUE_VIOLATION = '23505';

const dbCode = (error: unknown): string | undefined => (error as { code?: string })?.code;
/** Knex rewrites a failed query's message as "<sql> - <driver message>"; keep only the driver message. */
const KNEX_SQL_PREFIX = /^\s*(?:select|insert|update|delete|with)\b[\s\S]*? - /i;
const driverMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(KNEX_SQL_PREFIX, '');
const identity = (scope: CatalogScope, offerKey: string, interval: BillingInterval) =>
  ({ stripe_account: scope.stripeAccount, livemode: scope.livemode, offer_key: offerKey, billing_interval: interval });

export interface EffectiveCatalogAccountSetting {
  livemode: boolean;
  stripeAccount: string | null;
  priceId: string | null;
  accountSource: 'database' | 'environment bootstrap' | 'Stripe key owner' | 'catalog history' | 'unconfigured' | 'ambiguous';
  priceSource: 'database setting' | 'database catalog' | 'environment bootstrap' | 'unconfigured' | 'ambiguous';
  historicalAccounts: string[];
}

/** Legacy binding for a key: only offers the catalog does not manage yet. */
export function legacyEnvPriceId(offerKey: string, interval: BillingInterval, env: EnvLike = process.env): string | undefined {
  const binding = LEGACY_ENV_BINDINGS[offerKey];
  return binding && binding.interval === interval ? env[binding.env] || undefined : undefined;
}

export function createOfferCatalog(deps: CatalogDeps) {
  const env = deps.env ?? process.env;

  /** One line per distinct error code per process; never the query, account or price ID. */
  const loggedErrorCodes = new Set<string>();
  function logUnavailableOnce(error: unknown): void {
    const code = dbCode(error) ?? 'unknown';
    if (loggedErrorCodes.has(code)) return;
    loggedErrorCodes.add(code);
    logger.error(`[OfferCatalog] catalog_unavailable: code=${code} message=${driverMessage(error)}`);
  }

  /** Resolve the current admin pool for ONE operation. A failing resolver is an outage like any failing query. */
  async function connect(): Promise<Knex> {
    try { return await deps.db(); } catch (error) {
      logUnavailableOnce(error);
      throw new OfferUnavailableError('catalog_unavailable', 'The offer catalog is unavailable.', error);
    }
  }

  /** Run a catalog query. A catalog that has not been migrated yet manages nothing. */
  async function guarded<T>(work: () => Promise<T>, whenMissingTable: T): Promise<T> {
    try { return await work(); } catch (error) {
      if (dbCode(error) === PG_UNDEFINED_TABLE) return whenMissingTable;
      logUnavailableOnce(error);
      throw new OfferUnavailableError('catalog_unavailable', 'The offer catalog is unavailable.', error);
    }
  }

  /** Is `offerKey` governed by the catalog (has any version in this scope)? */
  async function isManaged(scope: CatalogScope, offerKey: string, interval: BillingInterval, db: Knex): Promise<boolean> {
    return guarded(async () => Boolean(await db(VERSIONS).where(identity(scope, offerKey, interval)).first('version_id')), false);
  }

  async function isManagedAnywhere(offerKey: string, interval: BillingInterval, db: Knex): Promise<boolean> {
    return guarded(async () => Boolean(await db(VERSIONS)
      .where({ offer_key: offerKey, billing_interval: interval }).first('version_id')), false);
  }

  async function currentVersion(scope: CatalogScope, offerKey: string, interval: BillingInterval, db: Knex): Promise<OfferVersionRow | undefined> {
    return db(VERSIONS).where({ ...identity(scope, offerKey, interval), is_current: true }).first();
  }

  async function syncConfiguredPrice(trx: Knex.Transaction, scope: CatalogScope, actor: string, priceId: string): Promise<void> {
    if (!(await trx.schema.hasTable('stripe_offer_catalog_settings'))) return;
    const setting = await trx('stripe_offer_catalog_settings').where({ livemode: scope.livemode }).forUpdate().first();
    if (!setting || setting.stripe_account !== scope.stripeAccount || setting.price_id === priceId) return;
    await trx('stripe_offer_catalog_settings').where({ livemode: scope.livemode }).update({ price_id: priceId, updated_by: actor, updated_at: trx.fn.now() });
    if (await trx.schema.hasTable('stripe_offer_catalog_setting_audit')) await trx('stripe_offer_catalog_setting_audit').insert({
      livemode: scope.livemode, operator: actor, previous_account: setting.stripe_account, previous_price_id: setting.price_id,
      new_account: scope.stripeAccount, new_price_id: priceId,
    });
  }

  async function scopeOrNull(db: Knex): Promise<CatalogScope | null> {
    try { return await deps.scope(db); } catch { return null; }
  }

  /**
   * NEW-SALE selection. Account and mode come from trusted configuration. Returns the offer,
   * version, Price ID and terms re-read from Stripe. Once the key is managed, a missing current
   * version, an invalid mapping or an outage throws; it never falls back to the env var.
   */
  async function resolveCurrentOffer(offerKey: string, interval: BillingInterval): Promise<ResolvedOffer> {
    const db = await connect();
    const scope = await scopeOrNull(db);
    if (!scope) {
      // Without a scope we cannot tell whether this key is managed. Only a key that no scope manages
      // (and an unmigrated catalog) may use the legacy binding; otherwise fail closed.
      const legacy = legacyEnvPriceId(offerKey, interval, env);
      if (await isManagedAnywhere(offerKey, interval, db) || !legacy) throw new OfferUnavailableError('scope_unavailable', 'The Stripe account and mode for the offer catalog could not be determined.');
      return legacyOffer(offerKey, interval, legacy, null);
    }
    if (!(await isManaged(scope, offerKey, interval, db))) {
      const legacy = legacyEnvPriceId(offerKey, interval, env);
      if (!legacy) throw new OfferUnavailableError('not_configured', 'This offer has no price configured.');
      return legacyOffer(offerKey, interval, legacy, scope);
    }
    const version = await guarded(() => currentVersion(scope, offerKey, interval, db), undefined);
    if (!version) throw new OfferUnavailableError('no_current_version', 'New purchases of this offer are paused: no current price is published.');
    let price;
    try { price = await deps.stripe.prices.retrieve(version.price_id, { stripeAccount: scope.stripeAccount }); } catch (error) {
      throw new OfferUnavailableError('stripe_unavailable', 'The current price could not be validated with Stripe.', error);
    }
    const problems = price.id === version.price_id ? priceProblems(price, { interval, livemode: scope.livemode, productId: version.product_id, requireActive: true }) : ['Stripe returned a different price'];
    if (problems.length) throw new OfferUnavailableError('invalid_mapping', `The current price for this offer is not sellable: ${problems.join('; ')}.`);
    return { source: 'catalog', offerKey, interval, versionId: version.version_id, versionNumber: version.version_number,
      priceId: version.price_id, productId: version.product_id, terms: termsOf(price), scope };
  }

  async function legacyOffer(offerKey: string, interval: BillingInterval, priceId: string, scope: CatalogScope | null): Promise<ResolvedOffer> {
    let price;
    try { price = await deps.stripe.prices.retrieve(priceId, scope ? { stripeAccount: scope.stripeAccount } : undefined); } catch (error) {
      throw new OfferUnavailableError('stripe_unavailable', 'The configured price could not be validated with Stripe.', error);
    }
    const problems = priceProblems(price, { interval, livemode: scope?.livemode ?? price.livemode, requireActive: true });
    if (problems.length) throw new OfferUnavailableError('invalid_mapping', `The configured price is not sellable: ${problems.join('; ')}.`);
    return { source: 'legacy_env', offerKey, interval, versionId: null, versionNumber: null, priceId, productId: priceProductId(price),
      terms: termsOf(price), scope: scope ?? { stripeAccount: 'unscoped', livemode: price.livemode } };
  }

  /**
   * RECOGNITION: reverse lookup of the Price actually billed, retired versions included. Null means
   * unmapped. Reads only the catalog (plus the legacy binding for unmanaged keys).
   */
  async function classifyPrice(scope: CatalogScope, priceId: string): Promise<ClassifiedPrice | null> {
    const db = await connect();
    const row = await guarded(async () => db(VERSIONS)
      .where({ stripe_account: scope.stripeAccount, livemode: scope.livemode, price_id: priceId }).first(), undefined);
    if (row) return { source: 'catalog', offerKey: row.offer_key, interval: row.billing_interval, versionId: row.version_id, current: row.is_current };
    for (const [offerKey, binding] of Object.entries(LEGACY_ENV_BINDINGS)) {
      if (env[binding.env] === priceId && !(await isManaged(scope, offerKey, binding.interval, db))) {
        return { source: 'legacy_env', offerKey, interval: binding.interval, versionId: null, current: true };
      }
    }
    return null;
  }

  /** Every Price ID that is, or ever was, bound to the offer in this scope. */
  async function recognizedPriceIds(offerKey: string, interval: BillingInterval, requestedScope?: CatalogScope): Promise<Set<string>> {
    const db = await connect();
    const scope = requestedScope ?? await scopeOrNull(db);
    if (!scope) {
      // Scope unknown: only a key no scope manages may be recognised through the legacy binding.
      const legacy = legacyEnvPriceId(offerKey, interval, env);
      if (await isManagedAnywhere(offerKey, interval, db)) throw new OfferUnavailableError('scope_unavailable', 'The Stripe account and mode for the offer catalog could not be determined.');
      return new Set(legacy ? [legacy] : []); // nothing managed, nothing configured: inert
    }
    const rows = await guarded(() => db(VERSIONS).where(identity(scope, offerKey, interval)).select('price_id') as Promise<Array<{ price_id: string }>>, []);
    const ids = new Set(rows.map((row) => row.price_id));
    if (!rows.length) {
      const legacy = legacyEnvPriceId(offerKey, interval, env);
      if (legacy) ids.add(legacy);
    }
    return ids;
  }

  /** Admission to the purchase surface, independent of the price an existing pool is billed at. */
  async function requireSellableOffer(offerKey: string, interval: BillingInterval): Promise<void> {
    const db = await connect();
    const legacy = legacyEnvPriceId(offerKey, interval, env);
    if (!legacy && !(await isManagedAnywhere(offerKey, interval, db))) {
      throw new OfferUnavailableError('not_configured', 'This offer has no price configured.');
    }
    const scope = await scopeOrNull(db);
    if (!scope) throw new OfferUnavailableError('scope_unavailable', 'The Stripe account and mode could not be determined.');
    if (!(await isManaged(scope, offerKey, interval, db))) {
      if (legacy) return;
      throw new OfferUnavailableError('not_configured', 'This offer has no price configured in this scope.');
    }
    if (!await guarded(() => currentVersion(scope, offerKey, interval, db), undefined)) {
      throw new OfferUnavailableError('no_current_version', 'New purchases are paused until a price is published.');
    }
  }

  async function isOfferSellable(offerKey: string, interval: BillingInterval): Promise<boolean> {
    try {
      await requireSellableOffer(offerKey, interval);
      return true;
    } catch (error) {
      if (error instanceof OfferUnavailableError) return false;
      throw error;
    }
  }

  async function getVersion(versionId: string): Promise<OfferVersionRow | undefined> {
    return (await connect())(VERSIONS).where({ version_id: versionId }).first();
  }

  /** Operator review: the current binding plus history, with the current price re-read from Stripe. */
  async function inspect(offerKey: string, interval: BillingInterval) {
    const db = await connect();
    const scope = await deps.scope(db);
    const versions: OfferVersionRow[] = await db(VERSIONS).where(identity(scope, offerKey, interval)).orderBy('version_number', 'desc');
    return { scope, versions, current: versions.find((version) => version.is_current) ?? null, legacyEnvPriceId: legacyEnvPriceId(offerKey, interval, env) ?? null };
  }

  async function inspectAccountSetting(livemode: boolean) {
    const db = await connect();
    return guarded(async () => db('stripe_offer_catalog_settings').where({ livemode }).first(), null);
  }

  async function deploymentLivemode(db?: Knex): Promise<boolean> {
    return deps.livemode ? deps.livemode() : (await deps.scope(db)).livemode;
  }

  async function historicalAccounts(livemode: boolean, handle?: Knex): Promise<string[]> {
    const db = handle ?? await connect();
    return guarded(async () => db(VERSIONS).where({ offer_key: CO_MANAGED_SEAT_OFFER_KEY, billing_interval: 'month', livemode })
      .distinct('stripe_account').pluck('stripe_account'), []);
  }

  async function historicalScopeForPrice(priceId: string, livemode?: boolean, handle?: Knex): Promise<CatalogScope | null> {
    const db = handle ?? await connect();
    const query = db(VERSIONS).where({ price_id: priceId, offer_key: CO_MANAGED_SEAT_OFFER_KEY, billing_interval: 'month' });
    if (livemode !== undefined) query.where({ livemode });
    const rows: Array<{ stripe_account: string; livemode: boolean }> = await guarded(async () => query.distinct('stripe_account', 'livemode'), []);
    return rows.length === 1 ? { stripeAccount: rows[0].stripe_account, livemode: rows[0].livemode } : null;
  }

  async function effectiveAccountSetting(livemode: boolean, handle?: Knex): Promise<EffectiveCatalogAccountSetting> {
    const db = handle ?? await connect();
    const setting = await guarded(async () => db('stripe_offer_catalog_settings').where({ livemode }).first(), null);
    const accounts = await historicalAccounts(livemode, db);
    const applies = (await deploymentLivemode(db)) === livemode;
    const bootstrapAccount = applies ? env.STRIPE_ACCOUNT_ID || null : null;
    let stripeAccount: string | null = null;
    let accountSource: EffectiveCatalogAccountSetting['accountSource'] = 'unconfigured';
    if (setting) {
      stripeAccount = setting.stripe_account;
      accountSource = 'database';
    } else if (bootstrapAccount) {
      stripeAccount = bootstrapAccount;
      accountSource = 'environment bootstrap';
    } else if (accounts.length === 1) {
      stripeAccount = accounts[0];
      accountSource = 'catalog history';
    } else if (accounts.length > 1) {
      accountSource = 'ambiguous';
    } else if (applies && env.STRIPE_CO_MANAGED_USER_PRICE_ID) {
      // Before the catalog was introduced, a deployment could configure just the Price.
      // Use the key's merchant for both the review and the locked purchase checks.
      const scope = await scopeOrNull(db);
      if (scope && scope.livemode === livemode) {
        stripeAccount = scope.stripeAccount;
        accountSource = 'Stripe key owner';
      }
    }

    let priceId: string | null = null;
    let priceSource: EffectiveCatalogAccountSetting['priceSource'] = 'unconfigured';
    if (setting) {
      priceId = setting.price_id;
      priceSource = 'database setting';
    } else if (accountSource === 'ambiguous') {
      priceSource = 'ambiguous';
    } else if (stripeAccount) {
      const current = await guarded(async () => currentVersion({ stripeAccount: stripeAccount!, livemode }, CO_MANAGED_SEAT_OFFER_KEY, 'month', db), undefined);
      if (current) {
        priceId = current.price_id;
        priceSource = 'database catalog';
      }
    }
    if (!priceId && priceSource !== 'ambiguous' && accounts.length === 0 && applies && env.STRIPE_CO_MANAGED_USER_PRICE_ID) {
      priceId = env.STRIPE_CO_MANAGED_USER_PRICE_ID;
      priceSource = 'environment bootstrap';
    }
    return { livemode, stripeAccount, priceId, accountSource, priceSource, historicalAccounts: accounts };
  }

  async function setAccountSetting(input: { actor: CatalogOperator | null | undefined; livemode: boolean; stripeAccount: string;
    priceId: string; expectedAccount: string | null; expectedPriceId: string | null; confirmSwitch: boolean }) {
    const actor = assertCatalogOperator(input.actor, env);
    if (!/^acct_[A-Za-z0-9]+$/.test(input.stripeAccount) || !/^price_[A-Za-z0-9]+$/.test(input.priceId)) {
      throw new OfferPublishError('INVALID_CANDIDATE', 'A valid Stripe account ID and Price ID are required.');
    }
    const db = await connect();
    const currentLivemode = await deploymentLivemode(db);
    if (currentLivemode !== input.livemode) throw new OfferPublishError('WRONG_MODE', 'Use a deployment whose restricted Stripe key matches the mode being configured.');
    let price;
    try { price = await deps.stripe.prices.retrieve(input.priceId, { stripeAccount: input.stripeAccount }); }
    catch (error) { throw new OfferPublishError('STRIPE_UNAVAILABLE', `Stripe could not retrieve the candidate Price in the requested account: ${error instanceof Error ? error.message : String(error)}`); }
    if (price.id !== input.priceId || price.livemode !== input.livemode) throw new OfferPublishError('WRONG_MODE', 'The scoped Stripe response did not match the requested Price and mode.');
    const responseAccount = (price as unknown as { account?: string | { id?: string } }).account;
    const responseAccountId = typeof responseAccount === 'string' ? responseAccount : responseAccount?.id;
    if (responseAccountId && responseAccountId !== input.stripeAccount) throw new OfferPublishError('INVALID_CANDIDATE', 'Stripe returned a Price owned by a different account.');
    const problems = priceProblems(price, { interval: 'month', livemode: input.livemode, requireActive: true });
    if (problems.length) throw new OfferPublishError('INVALID_CANDIDATE', `Price ${input.priceId} cannot back this offer: ${problems.join('; ')}.`, problems);
    const id = { stripe_account: input.stripeAccount, livemode: input.livemode, offer_key: CO_MANAGED_SEAT_OFFER_KEY, billing_interval: 'month' };
    const knownProducts: Array<{ product_id: string }> = await db('stripe_offer_versions').where(id).distinct('product_id');
    if (knownProducts.length > 1 || (knownProducts[0] && knownProducts[0].product_id !== priceProductId(price))) {
      throw new OfferPublishError('INVALID_CANDIDATE', 'The candidate product does not match the offer’s existing account-scoped price history.');
    }
    if (!input.confirmSwitch) throw new OfferPublishError('INVALID_CANDIDATE', 'Review the account and price, then retry with explicit switch confirmation.');

    const result = await db.transaction(async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`stripe-billing-catalog:${input.livemode ? 'live' : 'test'}`]);
      const current = await trx('stripe_offer_catalog_settings').where({ livemode: input.livemode }).forUpdate().first();
      const effective = await effectiveAccountSetting(input.livemode, trx);
      const previousAccount = effective.stripeAccount;
      const previousPriceId = effective.priceId;
      if (previousAccount !== input.expectedAccount || previousPriceId !== input.expectedPriceId) {
        throw new OfferPublishError('STALE_EXPECTED_VERSION', 'The account setting changed since it was reviewed. Inspect it again.');
      }
      if (previousAccount !== input.stripeAccount || previousPriceId !== input.priceId) {
        const oldAccounts = new Set(effective.historicalAccounts);
        if (previousAccount) oldAccounts.add(previousAccount);
        if (await trx.schema.hasTable('co_managed_portal_purchases')) {
          const unresolvedPortal = await trx('co_managed_portal_purchases').where({ state: 'pending' })
            .andWhere((q) => q.where({ livemode: input.livemode }).whereIn('stripe_account', [...oldAccounts]).orWhereNull('stripe_account')).first('purchase_id');
          if (unresolvedPortal) throw new OfferPublishError('INVALID_CANDIDATE', 'A pending portal checkout is tied to the prior or unresolved catalog. Resolve it before switching.');
        }
        if (await trx.schema.hasTable('co_managed_purchase_operations')) {
          const hostedPending = await trx('co_managed_purchase_operations').whereIn('state', ['preparing', 'checkout', 'payment_failed'])
            .andWhere((q) => q.where({ livemode: input.livemode }).whereIn('stripe_account', [...oldAccounts]).orWhereNull('stripe_account'))
            .first('operation_id');
          if (hostedPending) throw new OfferPublishError('INVALID_CANDIDATE', 'A pending hosted checkout is pinned to the previous or an unresolved account. Resolve it before switching.');
        }
        if (await trx.schema.hasTable('stripe_subscriptions')) {
          const active = trx('stripe_subscriptions').whereNotIn('status', ['canceled', 'incomplete_expired']);
          if (await active.clone().where((q) => q.whereRaw("metadata->>'subscription_kind' = 'co_managed'").orWhereRaw("metadata->>'portal_purchase_id' IS NOT NULL"))
            .where((q) => q.where({ livemode: input.livemode }).whereIn('stripe_account', [...oldAccounts]).orWhereNull('stripe_account')).first('stripe_subscription_id')) {
            throw new OfferPublishError('INVALID_CANDIDATE', 'An active co-managed subscription remains on the prior or unresolved catalog; preserve its merchant identity before switching.');
          }
          const historicalPrices = oldAccounts.size
            ? await trx('stripe_offer_versions').where({ livemode: input.livemode, offer_key: CO_MANAGED_SEAT_OFFER_KEY, billing_interval: 'month' }).whereIn('stripe_account', [...oldAccounts]).distinct('price_id').pluck('price_id')
            : [];
          if (historicalPrices.length) {
            const byHistoricalPrice = await trx('stripe_subscriptions as s').join('stripe_prices as p', 's.stripe_price_id', 'p.stripe_price_id')
              .whereNotIn('s.status', ['canceled', 'incomplete_expired']).whereIn('p.stripe_price_external_id', historicalPrices)
              .first('s.stripe_subscription_id');
            if (byHistoricalPrice) throw new OfferPublishError('INVALID_CANDIDATE', 'An active subscription uses a historical co-managed Price; preserve its merchant identity before switching.');
          }
        }
        if (deps.subscriptions) {
          if (oldAccounts.size > 1 && !previousAccount) throw new OfferPublishError('INVALID_CANDIDATE', 'Historical catalog references span multiple accounts; reconcile the prior account before switching.');
          for (const oldAccount of oldAccounts) {
            const recognized = new Set(await trx('stripe_offer_versions').where({ stripe_account: oldAccount, livemode: input.livemode,
              offer_key: CO_MANAGED_SEAT_OFFER_KEY, billing_interval: 'month' }).pluck('price_id'));
            for await (const subscription of deps.subscriptions.list({ status: 'all', limit: 100 }, { stripeAccount: oldAccount })) {
              const historical = subscription.items.data.some((item) => recognized.has(item.price.id));
              const coManaged = subscription.metadata?.subscription_kind === 'co_managed' || Boolean(subscription.metadata?.portal_purchase_id) || historical;
              if (coManaged && !['canceled', 'incomplete_expired'].includes(subscription.status)) {
                if (subscription.items.data.some((item) => !recognized.has(item.price.id))) throw new OfferPublishError('INVALID_CANDIDATE', 'An active subscription on the previous account has an unresolved historical price.');
                throw new OfferPublishError('INVALID_CANDIDATE', 'The previous account still has an active co-managed subscription; preserve its merchant identity before switching.');
              }
            }
          }
        }
      }
      const bound = await trx('stripe_offer_versions').where({ stripe_account: input.stripeAccount, livemode: input.livemode, price_id: input.priceId }).first();
      if (bound && (bound.offer_key !== CO_MANAGED_SEAT_OFFER_KEY || bound.billing_interval !== 'month')) throw new OfferPublishError('BOUND_TO_OTHER_OFFER', 'The Price is already bound to a different offer.');
      const previous = await trx('stripe_offer_versions').where({ ...id, is_current: true }).forUpdate().first();
      if (previous && previous.price_id !== input.priceId) await trx('stripe_offer_versions').where({ version_id: previous.version_id }).update({ is_current: false, retired_at: trx.fn.now() });
      let version = bound;
      if (!bound) {
        const number = Number((await trx('stripe_offer_versions').where(id).max('version_number as n').first())?.n ?? 0) + 1;
        [version] = await trx('stripe_offer_versions').insert({ ...id, version_number: number, price_id: input.priceId, product_id: priceProductId(price),
          is_current: true, published_by: actor.userId }).returning('*');
      } else if (!bound.is_current) {
        [version] = await trx('stripe_offer_versions').where({ version_id: bound.version_id }).update({ is_current: true, retired_at: null }).returning('*');
      }
      if (previous?.version_id !== version?.version_id) await trx('stripe_offer_publications').insert({ ...id,
        action: bound ? 'restore' : 'publish', from_version_id: previous?.version_id ?? null, to_version_id: version?.version_id ?? null, actor: actor.userId });
      await trx('stripe_offer_catalog_settings').insert({ livemode: input.livemode, stripe_account: input.stripeAccount,
        price_id: input.priceId, updated_by: actor.userId, updated_at: trx.fn.now() }).onConflict('livemode').merge();
      await trx('stripe_offer_catalog_setting_audit').insert({ livemode: input.livemode, operator: actor.userId,
        previous_account: previousAccount, previous_price_id: previousPriceId,
        new_account: input.stripeAccount, new_price_id: input.priceId });
      return { changed: previousAccount !== input.stripeAccount || previousPriceId !== input.priceId,
        previousAccount, previousPriceId };
    });
    return { ...result, livemode: input.livemode, stripeAccount: input.stripeAccount, priceId: input.priceId };
  }

  /** Validate a candidate against Stripe in this scope; returns what the operator reviews. */
  async function reviewCandidate(db: Knex, scope: CatalogScope, offerKey: string, interval: BillingInterval, priceId: string, opts: { productId?: string; requireActive: boolean }) {
    let price;
    try { price = await deps.stripe.prices.retrieve(priceId, { stripeAccount: scope.stripeAccount }); } catch (error) {
      throw new OfferPublishError('STRIPE_UNAVAILABLE', `Stripe could not retrieve ${priceId} in this account and mode: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (price.livemode !== scope.livemode) throw new OfferPublishError('WRONG_MODE', `Price ${priceId} is ${price.livemode ? 'live' : 'test'} mode; this catalog scope is ${scope.livemode ? 'live' : 'test'} mode.`);
    const known: Array<{ product_id: string }> = await db(VERSIONS).where(identity(scope, offerKey, interval)).distinct('product_id');
    const expectedProduct = known[0]?.product_id ?? opts.productId;
    if (known.length > 1) throw new OfferPublishError('INVALID_CANDIDATE', 'The offer already spans several products; resolve this with the catalog owner.');
    if (!expectedProduct) throw new OfferPublishError('INVALID_CANDIDATE', 'This is the first price for the offer: name the Stripe product it belongs to (--product).');
    if (opts.productId && known[0] && opts.productId !== known[0].product_id) throw new OfferPublishError('INVALID_CANDIDATE', `The offer is sold under product ${known[0].product_id}, not ${opts.productId}.`);
    const problems = priceProblems(price, { interval, livemode: scope.livemode, productId: expectedProduct, requireActive: opts.requireActive });
    if (problems.length) throw new OfferPublishError('INVALID_CANDIDATE', `Price ${priceId} cannot back this offer: ${problems.join('; ')}.`, problems);
    return { price, productId: priceProductId(price), terms: termsOf(price) };
  }

  /**
   * Publish (or restore, which is the same thing) a Price as the current version of an offer.
   * Operator-only. Optimistic: `expectedCurrentVersionId` must be the current version the operator
   * reviewed (null when none), so competing operators cannot silently supersede each other.
   * Republishing the binding that is already current is a harmless no-op.
   */
  async function publishBinding(input: {
    actor: CatalogOperator | null | undefined; offerKey: string; interval: BillingInterval; priceId: string;
    expectedCurrentVersionId: string | null; productId?: string; mode?: 'operator' | 'seed' | 'historical';
  }): Promise<PublishResult> {
    const actor = assertCatalogOperator(input.actor, env);
    const db = await connect();
    const scope = await deps.scope(db);
    const mode = input.mode ?? 'operator';
    const { productId, terms } = await reviewCandidate(db, scope, input.offerKey, input.interval, input.priceId,
      { productId: input.productId, requireActive: mode !== 'historical' });
    const id = identity(scope, input.offerKey, input.interval);
    const historical = mode === 'historical';

    const attempt = () => db.transaction(async (trx): Promise<PublishResult> => {
      const bound: OfferVersionRow | undefined = await trx(VERSIONS)
        .where({ stripe_account: scope.stripeAccount, livemode: scope.livemode, price_id: input.priceId }).forUpdate().first();
      if (bound && (bound.offer_key !== input.offerKey || bound.billing_interval !== input.interval)) {
        throw new OfferPublishError('BOUND_TO_OTHER_OFFER', `Price ${input.priceId} is already bound to ${bound.offer_key}/${bound.billing_interval}; a price may back only one offer.`);
      }
      const current: OfferVersionRow | undefined = await trx(VERSIONS).where({ ...id, is_current: true }).forUpdate().first();
      if (bound?.is_current && !historical) return { changed: false, action: 'unchanged', version: bound, previousVersionId: bound.version_id, terms };
      if (historical) {
        if (bound) return { changed: false, action: 'unchanged', version: bound, previousVersionId: current?.version_id ?? null, terms };
        const number = Number((await trx(VERSIONS).where(id).max('version_number as n').first())?.n ?? 0) + 1;
        const [inserted] = await trx(VERSIONS).insert({ ...id, version_number: number, price_id: input.priceId, product_id: productId,
          is_current: false, published_by: actor.userId, retired_at: trx.fn.now() }).returning('*');
        await trx(PUBLICATIONS).insert({ ...id, action: 'seed', from_version_id: current?.version_id ?? null, to_version_id: inserted.version_id, actor: actor.userId });
        return { changed: true, action: 'seed', version: inserted, previousVersionId: current?.version_id ?? null, terms };
      }
      if ((current?.version_id ?? null) !== input.expectedCurrentVersionId) {
        throw new OfferPublishError('STALE_EXPECTED_VERSION', 'The current version changed since you reviewed it. Inspect the offer again before publishing.');
      }
      if (current) await trx(VERSIONS).where({ version_id: current.version_id }).update({ is_current: false, retired_at: trx.fn.now() });
      let version: OfferVersionRow;
      let action: PublishAction;
      if (bound) {
        [version] = await trx(VERSIONS).where({ version_id: bound.version_id }).update({ is_current: true, retired_at: null }).returning('*');
        action = 'restore';
      } else {
        const number = Number((await trx(VERSIONS).where(id).max('version_number as n').first())?.n ?? 0) + 1;
        [version] = await trx(VERSIONS).insert({ ...id, version_number: number, price_id: input.priceId, product_id: productId,
          is_current: true, published_by: actor.userId }).returning('*');
        action = mode === 'seed' ? 'seed' : 'publish';
      }
      await trx(PUBLICATIONS).insert({ ...id, action, from_version_id: current?.version_id ?? null, to_version_id: version.version_id, actor: actor.userId });
      // Publishing another offer must not mutate the shared co-managed purchase setting.
      if (input.offerKey === CO_MANAGED_SEAT_OFFER_KEY && input.interval === 'month') {
        await syncConfiguredPrice(trx, scope, actor.userId, version.price_id);
      }
      return { changed: true, action, version, previousVersionId: current?.version_id ?? null, terms };
    });

    try { return await attempt(); } catch (error) {
      if (dbCode(error) !== PG_UNIQUE_VIOLATION) throw error;
      // A concurrent writer won a unique index. Re-run once: an identical republish becomes the
      // idempotent no-op, a conflicting one fails the expected-version check.
      try { return await attempt(); } catch (retry) {
        if (dbCode(retry) === PG_UNIQUE_VIOLATION) throw new OfferPublishError('STALE_EXPECTED_VERSION', 'A competing publication won. Inspect the offer again before publishing.');
        throw retry;
      }
    }
  }

  /**
   * Pause NEW sales of an offer: retire its current version without promoting another (rollout
   * step 4). The offer stays managed, so resolution fails closed (`no_current_version`) and the
   * legacy env binding is NOT revived; recognition is untouched, so renewals, reconciliation and
   * paid licence delivery continue. Resume with `restore`. Same expected-version protection as
   * publication; pausing an already-paused offer is a harmless no-op.
   */
  async function pauseSales(input: { actor: CatalogOperator | null | undefined; offerKey: string; interval: BillingInterval; expectedCurrentVersionId: string | null }):
    Promise<{ changed: boolean; previousVersionId: string | null }> {
    const actor = assertCatalogOperator(input.actor, env);
    const db = await connect();
    const scope = await deps.scope(db);
    const id = identity(scope, input.offerKey, input.interval);
    return db.transaction(async (trx) => {
      const current: OfferVersionRow | undefined = await trx(VERSIONS).where({ ...id, is_current: true }).forUpdate().first();
      if (!current) {
        if (!(await trx(VERSIONS).where(id).first('version_id'))) {
          throw new OfferPublishError('INVALID_CANDIDATE', 'This offer is not managed by the catalog yet; seed it before pausing (an unmanaged offer is served by its legacy binding).');
        }
        return { changed: false, previousVersionId: null };
      }
      if (current.version_id !== input.expectedCurrentVersionId) {
        throw new OfferPublishError('STALE_EXPECTED_VERSION', 'The current version changed since you reviewed it. Inspect the offer again before pausing.');
      }
      await trx(VERSIONS).where({ version_id: current.version_id }).update({ is_current: false, retired_at: trx.fn.now() });
      await trx(PUBLICATIONS).insert({ ...id, action: 'pause', from_version_id: current.version_id, to_version_id: null, actor: actor.userId });
      return { changed: true, previousVersionId: current.version_id };
    });
  }

  /** Operator dry run: validate a candidate against Stripe and return its terms; writes nothing. */
  async function reviewCandidateTerms(offerKey: string, interval: BillingInterval, priceId: string, productId?: string) {
    const db = await connect();
    return reviewCandidate(db, await deps.scope(db), offerKey, interval, priceId, { productId, requireActive: true });
  }

  /**
   * NEW-SALE selection is read once per request: inside a billing catalog request scope (every server action,
   * the co-managed root render) the first resolution's Stripe price read is shared by the gate's context load
   * and by every display, preview and purchase path in that request. No scope (a Temporal activity, a
   * script) resolves per call, as before. Nothing outlives the request.
   */
  const resolveCurrentOfferOncePerRequest = (offerKey: string, interval: BillingInterval): Promise<ResolvedOffer> =>
    memoiseInBillingCatalogRequest(`offer-catalog:current-offer:${offerKey}:${interval}`, () => resolveCurrentOffer(offerKey, interval));
  /** A write makes the request's memoised reads stale; later reads in the same request see the new state. */
  const thenForget = <A extends unknown[], R>(write: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    try { return await write(...args); } finally { forgetBillingCatalogRequest(); }
  };

  return { resolveCurrentOffer: resolveCurrentOfferOncePerRequest, classifyPrice, reviewCandidateTerms, recognizedPriceIds, isOfferSellable, getVersion, inspect,
    requireSellableOffer, inspectAccountSetting, deploymentLivemode, effectiveAccountSetting, historicalAccounts, historicalScopeForPrice,
    setAccountSetting: thenForget(setAccountSetting), publishBinding: thenForget(publishBinding), pauseSales: thenForget(pauseSales), scope: deps.scope };
}

export type OfferCatalog = ReturnType<typeof createOfferCatalog>;
