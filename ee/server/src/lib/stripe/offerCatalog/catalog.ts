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
import {
  LEGACY_ENV_BINDINGS, OfferPublishError, OfferUnavailableError,
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
const identity = (scope: CatalogScope, offerKey: string, interval: BillingInterval) =>
  ({ stripe_account: scope.stripeAccount, livemode: scope.livemode, offer_key: offerKey, billing_interval: interval });

/** Legacy binding for a key: only offers the catalog does not manage yet. */
export function legacyEnvPriceId(offerKey: string, interval: BillingInterval, env: EnvLike = process.env): string | undefined {
  const binding = LEGACY_ENV_BINDINGS[offerKey];
  return binding && binding.interval === interval ? env[binding.env] || undefined : undefined;
}

export function createOfferCatalog(deps: CatalogDeps) {
  const env = deps.env ?? process.env;

  /** Run a catalog query. A catalog that has not been migrated yet manages nothing. */
  async function guarded<T>(work: () => Promise<T>, whenMissingTable: T): Promise<T> {
    try { return await work(); } catch (error) {
      if (dbCode(error) === PG_UNDEFINED_TABLE) return whenMissingTable;
      throw new OfferUnavailableError('catalog_unavailable', 'The offer catalog is unavailable.', error);
    }
  }

  /** Is `offerKey` governed by the catalog (has any version in this scope)? */
  async function isManaged(scope: CatalogScope, offerKey: string, interval: BillingInterval): Promise<boolean> {
    return guarded(async () => Boolean(await deps.db(VERSIONS).where(identity(scope, offerKey, interval)).first('version_id')), false);
  }

  async function currentVersion(scope: CatalogScope, offerKey: string, interval: BillingInterval, db: Knex = deps.db): Promise<OfferVersionRow | undefined> {
    return db(VERSIONS).where({ ...identity(scope, offerKey, interval), is_current: true }).first();
  }

  async function scopeOrNull(): Promise<CatalogScope | null> {
    try { return await deps.scope(); } catch { return null; }
  }

  /**
   * NEW-SALE selection. Account and mode come from trusted configuration. Returns the offer,
   * version, Price ID and terms re-read from Stripe. Once the key is managed, a missing current
   * version, an invalid mapping or an outage throws; it never falls back to the env var.
   */
  async function resolveCurrentOffer(offerKey: string, interval: BillingInterval): Promise<ResolvedOffer> {
    const scope = await scopeOrNull();
    if (!scope) {
      // Without a scope we cannot tell whether this key is managed. Only a key that no scope manages
      // (and an unmigrated catalog) may use the legacy binding; otherwise fail closed.
      const managedAnywhere = await guarded(async () => Boolean(await deps.db(VERSIONS).where({ offer_key: offerKey, billing_interval: interval }).first('version_id')), false);
      const legacy = legacyEnvPriceId(offerKey, interval, env);
      if (managedAnywhere || !legacy) throw new OfferUnavailableError('scope_unavailable', 'The Stripe account and mode for the offer catalog could not be determined.');
      return legacyOffer(offerKey, interval, legacy, null);
    }
    if (!(await isManaged(scope, offerKey, interval))) {
      const legacy = legacyEnvPriceId(offerKey, interval, env);
      if (!legacy) throw new OfferUnavailableError('not_configured', 'This offer has no price configured.');
      return legacyOffer(offerKey, interval, legacy, scope);
    }
    const version = await guarded(() => currentVersion(scope, offerKey, interval), undefined);
    if (!version) throw new OfferUnavailableError('no_current_version', 'New purchases of this offer are paused: no current price is published.');
    let price;
    try { price = await deps.stripe.prices.retrieve(version.price_id); } catch (error) {
      throw new OfferUnavailableError('stripe_unavailable', 'The current price could not be validated with Stripe.', error);
    }
    const problems = price.id === version.price_id ? priceProblems(price, { interval, livemode: scope.livemode, productId: version.product_id, requireActive: true }) : ['Stripe returned a different price'];
    if (problems.length) throw new OfferUnavailableError('invalid_mapping', `The current price for this offer is not sellable: ${problems.join('; ')}.`);
    return { source: 'catalog', offerKey, interval, versionId: version.version_id, versionNumber: version.version_number,
      priceId: version.price_id, productId: version.product_id, terms: termsOf(price), scope };
  }

  async function legacyOffer(offerKey: string, interval: BillingInterval, priceId: string, scope: CatalogScope | null): Promise<ResolvedOffer> {
    let price;
    try { price = await deps.stripe.prices.retrieve(priceId); } catch (error) {
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
    const row = await guarded(async () => deps.db(VERSIONS)
      .where({ stripe_account: scope.stripeAccount, livemode: scope.livemode, price_id: priceId }).first(), undefined);
    if (row) return { source: 'catalog', offerKey: row.offer_key, interval: row.billing_interval, versionId: row.version_id, current: row.is_current };
    for (const [offerKey, binding] of Object.entries(LEGACY_ENV_BINDINGS)) {
      if (env[binding.env] === priceId && !(await isManaged(scope, offerKey, binding.interval))) {
        return { source: 'legacy_env', offerKey, interval: binding.interval, versionId: null, current: true };
      }
    }
    return null;
  }

  /** Every Price ID that is, or ever was, bound to the offer in this scope. */
  async function recognizedPriceIds(offerKey: string, interval: BillingInterval): Promise<Set<string>> {
    const scope = await scopeOrNull();
    if (!scope) {
      // Scope unknown: only a key no scope manages may be recognised through the legacy binding.
      const managedAnywhere = await guarded(async () => Boolean(await deps.db(VERSIONS).where({ offer_key: offerKey, billing_interval: interval }).first('version_id')), false);
      const legacy = legacyEnvPriceId(offerKey, interval, env);
      if (managedAnywhere) throw new OfferUnavailableError('scope_unavailable', 'The Stripe account and mode for the offer catalog could not be determined.');
      return new Set(legacy ? [legacy] : []); // nothing managed, nothing configured: inert
    }
    const rows = await guarded(() => deps.db(VERSIONS).where(identity(scope, offerKey, interval)).select('price_id') as Promise<Array<{ price_id: string }>>, []);
    const ids = new Set(rows.map((row) => row.price_id));
    if (!rows.length) {
      const legacy = legacyEnvPriceId(offerKey, interval, env);
      if (legacy) ids.add(legacy);
    }
    return ids;
  }

  /** Is anything configured to sell this offer? DB-only, so cheap enough for UI gating. */
  async function isOfferSellable(offerKey: string, interval: BillingInterval): Promise<boolean> {
    const scope = await scopeOrNull();
    if (!scope) return false;
    if (!(await isManaged(scope, offerKey, interval))) return Boolean(legacyEnvPriceId(offerKey, interval, env));
    try { return Boolean(await currentVersion(scope, offerKey, interval)); } catch { return false; }
  }

  async function getVersion(versionId: string): Promise<OfferVersionRow | undefined> {
    return deps.db(VERSIONS).where({ version_id: versionId }).first();
  }

  /** Operator review: the current binding plus history, with the current price re-read from Stripe. */
  async function inspect(offerKey: string, interval: BillingInterval) {
    const scope = await deps.scope();
    const versions: OfferVersionRow[] = await deps.db(VERSIONS).where(identity(scope, offerKey, interval)).orderBy('version_number', 'desc');
    return { scope, versions, current: versions.find((version) => version.is_current) ?? null, legacyEnvPriceId: legacyEnvPriceId(offerKey, interval, env) ?? null };
  }

  /** Validate a candidate against Stripe in this scope; returns what the operator reviews. */
  async function reviewCandidate(scope: CatalogScope, offerKey: string, interval: BillingInterval, priceId: string, opts: { productId?: string; requireActive: boolean }) {
    let price;
    try { price = await deps.stripe.prices.retrieve(priceId); } catch (error) {
      throw new OfferPublishError('STRIPE_UNAVAILABLE', `Stripe could not retrieve ${priceId} in this account and mode: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (price.livemode !== scope.livemode) throw new OfferPublishError('WRONG_MODE', `Price ${priceId} is ${price.livemode ? 'live' : 'test'} mode; this catalog scope is ${scope.livemode ? 'live' : 'test'} mode.`);
    const known: Array<{ product_id: string }> = await deps.db(VERSIONS).where(identity(scope, offerKey, interval)).distinct('product_id');
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
    const scope = await deps.scope();
    const mode = input.mode ?? 'operator';
    const { productId, terms } = await reviewCandidate(scope, input.offerKey, input.interval, input.priceId,
      { productId: input.productId, requireActive: mode !== 'historical' });
    const id = identity(scope, input.offerKey, input.interval);
    const historical = mode === 'historical';

    const attempt = () => deps.db.transaction(async (trx): Promise<PublishResult> => {
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
    const scope = await deps.scope();
    const id = identity(scope, input.offerKey, input.interval);
    return deps.db.transaction(async (trx) => {
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
    return reviewCandidate(await deps.scope(), offerKey, interval, priceId, { productId, requireActive: true });
  }

  return { resolveCurrentOffer, classifyPrice, reviewCandidateTerms, recognizedPriceIds, isOfferSellable, getVersion, inspect, publishBinding, pauseSales, scope: deps.scope };
}

export type OfferCatalog = ReturnType<typeof createOfferCatalog>;
