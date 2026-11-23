import { capabilityFeatureFlag, forcedValue } from '@alga-psa/core/capability';
import { isFeatureFlagEnabled } from '@alga-psa/core/features';
import { AsyncLocalStorage } from 'node:async_hooks';

export type CoManagedPurchaseBlockedReason =
  | 'customer_unverified'
  | 'no_current_pro'
  | 'offer_paused'
  | 'offer_changed'
  | 'misconfigured'
  | 'temporarily_unavailable';

/**
 * Is anything configured to SELL co-managed seats? Platform (EE) code registers a context loader backed by
 * the shared Stripe offer catalog. This is NEW-SALE eligibility, not recognition: a managed offer
 * with no sellable current version reports false (fail closed). Without a loader (CE) only the legacy environment binding can open the surface.
 */
export interface BillingCatalogContext {
  mode: 'test' | 'live';
  stripeAccount: string | null;
  priceId: string | null;
  source: 'database' | 'environment' | 'unconfigured';
  sellable: boolean;
}

/**
 * Request-scoped catalog resolution.
 *
 * What "a request" is here: the work inside one explicit `AsyncLocalStorage.run` scope, which is what
 * `runWithBillingCatalogContext` (and EE's `withBillingCatalogContext`, which loads once and enters it)
 * establish for a page render, server action or API handler. Everything that scope awaits sees the same
 * context and the loader runs once; the scope ends with the work, so two concurrent requests never share
 * one and the next request loads again. Nothing is kept in module state, so an operator's `set-account`
 * is visible to the next request without a restart (PR 4452's no-process-cache property).
 *
 * With no active scope there is no request to memoise into, so the registered loader runs on every check.
 * This module deliberately does NOT lazily `enterWith` a slot to memoise for unwrapped callers: a slot
 * entered from inside a request attaches to whichever async resource is current, and that can be a
 * long-lived shared one (a connection pool or socket created lazily by the first request, a keep-alive
 * HTTP connection). A later, unrelated request then inherits the stale context. Correctness beats the
 * extra load; callers that check the gate repeatedly should wrap in `withBillingCatalogContext`.
 */
export type BillingCatalogContextLoader = () => Promise<BillingCatalogContext>;

const billingCatalogContextKey = Symbol.for('@alga-psa/licensing/billing-catalog-context');
const billingCatalogLoaderKey = Symbol.for('@alga-psa/licensing/billing-catalog-context-loader');
const sharedGlobal = globalThis as typeof globalThis & {
  [billingCatalogContextKey]?: AsyncLocalStorage<BillingCatalogContext>;
  [billingCatalogLoaderKey]?: { loader?: BillingCatalogContextLoader };
};
// Node can include licensing in more than one server bundle. A global symbol keeps each bundle's
// ALS accessor and loader registration shared while preserving request isolation under concurrency.
const billingCatalogContext = sharedGlobal[billingCatalogContextKey] ??= new AsyncLocalStorage<BillingCatalogContext>();
const loaderRegistry = sharedGlobal[billingCatalogLoaderKey] ??= {};

/**
 * Register the process-wide loader that produces the catalog context (EE registers it from its
 * `surfaceProbe` module). Registering also switches off the legacy env fallback: with a loader, an
 * unconfigured catalog or a failing load means closed. Pass `undefined` to unregister (tests).
 */
export function registerBillingCatalogContextLoader(loader: BillingCatalogContextLoader | undefined): void {
  loaderRegistry.loader = loader;
}

/** Establish catalog identity for one independent request entry point. */
export function runWithBillingCatalogContext<T>(context: BillingCatalogContext, work: () => T): T {
  return billingCatalogContext.run(context, work);
}

/** The one pure decision used by every surface and purchase path. */
export function resolveCoManagedPurchaseAvailability(context: BillingCatalogContext): boolean {
  return context.sellable && Boolean(context.priceId && context.stripeAccount);
}

const UNSELLABLE: BillingCatalogContext = { mode: 'test', stripeAccount: null, priceId: null, source: 'unconfigured', sellable: false };

/**
 * The catalog context for the current request: the active scope's context, else a fresh load through
 * the registered loader, else undefined (no loader: only the legacy env binding applies). A loader
 * that throws resolves to an unsellable context rather than rejecting.
 */
export async function currentBillingCatalogContext(): Promise<BillingCatalogContext | undefined> {
  const scoped = billingCatalogContext.getStore();
  if (scoped) return scoped;
  const loader = loaderRegistry.loader;
  if (!loader) return undefined;
  try {
    return await loader();
  } catch {
    return UNSELLABLE;
  }
}

async function offerConfigured(): Promise<boolean> {
  const context = await currentBillingCatalogContext();
  if (context) return resolveCoManagedPurchaseAvailability(context);
  // No loader registered (CE, or a process without the EE catalog): the legacy bootstrap binding.
  return Boolean(process.env.STRIPE_CO_MANAGED_USER_PRICE_ID);
}

/** Release and kill-switch gate shared by purchase actions; it does not classify offer availability. */
export async function isCoManagedPurchaseFeatureEnabled(tenantId: string): Promise<boolean> {
  const forced = forcedValue(process.env.FORCE_CAPABILITIES, 'co-managed');
  if (forced === 'off' || forced === 'malformed') return false;
  if (forced === 'on') return true;
  try {
    return await isFeatureFlagEnabled(capabilityFeatureFlag('co-managed'), { tenantId });
  } catch {
    return false;
  }
}

/**
 * Is the co-managed *purchase* surface open for this tenant?
 *
 * The capability's `admits` cannot answer this: eligibility there is an entitlement row, and a
 * purchase is how the first row comes to exist. The surface is therefore the kill switch, the
 * release flag, and a configured price. Absent configuration, a closed flag, or
 * `FORCE_CAPABILITIES=co-managed:off` leave it inert and nothing is read or written. It grants
 * nothing: capacity is only ever raised by verified reconciliation.
 */
export async function isCoManagedPurchaseSurfaceOpen(tenantId: string): Promise<boolean> {
  if (!await offerConfigured()) return false;
  return isCoManagedPurchaseFeatureEnabled(tenantId);
}
