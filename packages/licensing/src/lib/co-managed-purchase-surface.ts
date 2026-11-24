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
 * `runWithBillingCatalogRequest` opens the same kind of scope without a context: it is lazy, so the first
 * gate check inside it loads through the registered loader and the rest of the scope reuses the result.
 * `withAuth` (every server action), the co-managed root access resolver and EE's `withBillingCatalogContext`
 * open it. A server render is covered as a whole by the render slot the server registers
 * (`registerBillingCatalogRenderScope`): the root layout's capability bootstrap, nested layouts, the page and
 * its metadata share one load. The scope also memoises the request's other catalog reads
 * (`memoiseInBillingCatalogRequest`); a catalog write in the request drops them (`forgetBillingCatalogRequest`).
 *
 * With no active scope there is no request to memoise into, so the registered loader runs on every check.
 * This module deliberately does NOT lazily `enterWith` a slot to memoise for unwrapped callers: a slot
 * entered from inside a request attaches to whichever async resource is current, and that can be a
 * long-lived shared one (a connection pool or socket created lazily by the first request, a keep-alive
 * HTTP connection). A later, unrelated request then inherits the stale context. Correctness beats the
 * extra load; callers that check the gate repeatedly should wrap in `withBillingCatalogContext`.
 */
export type BillingCatalogContextLoader = () => Promise<BillingCatalogContext>;

/**
 * What an explicit scope holds: a context pinned by the caller, or (for a request scope) the pending load
 * that the first gate check in the scope starts and every later one shares; and the request's other
 * catalog reads (`memoiseInBillingCatalogRequest`). The holder is created by `run` and dies with it; it is
 * never attached to a long-lived async resource.
 */
interface BillingCatalogScope {
  context?: BillingCatalogContext | Promise<BillingCatalogContext>;
  /** True when the caller supplied the context (`runWithBillingCatalogContext`): a catalog write keeps it. */
  pinned?: boolean;
  memo?: Map<string, Promise<unknown>>;
}

const billingCatalogContextKey = Symbol.for('@alga-psa/licensing/billing-catalog-context');
const billingCatalogLoaderKey = Symbol.for('@alga-psa/licensing/billing-catalog-context-loader');
const billingCatalogRenderScopeKey = Symbol.for('@alga-psa/licensing/billing-catalog-render-scope');
const sharedGlobal = globalThis as typeof globalThis & {
  [billingCatalogContextKey]?: AsyncLocalStorage<BillingCatalogScope>;
  [billingCatalogLoaderKey]?: { loader?: BillingCatalogContextLoader };
  [billingCatalogRenderScopeKey]?: { slot?: () => object };
};
// Node can include licensing in more than one server bundle. A global symbol keeps each bundle's
// ALS accessor and loader registration shared while preserving request isolation under concurrency.
const billingCatalogContext = sharedGlobal[billingCatalogContextKey] ??= new AsyncLocalStorage<BillingCatalogScope>();
const loaderRegistry = sharedGlobal[billingCatalogLoaderKey] ??= {};
const renderScopeRegistry = sharedGlobal[billingCatalogRenderScopeKey] ??= {};

/**
 * A server render is one request too, but it is not one async call that a wrapper can enclose: the root
 * layout, nested layouts, the page and its metadata run as separate branches. The server registers a
 * per-render slot for it: a function that returns the same object for every call within one render and a
 * fresh one per request (React's `cache(() => ({}))`, which Next resets for every request). Outside a
 * render that function returns a new object per call, which is detected below and treated as no scope, so
 * a registered slot can never turn into a process-wide cache. Pass `undefined` to unregister (tests).
 */
export function registerBillingCatalogRenderScope(slot: (() => object) | undefined): void {
  renderScopeRegistry.slot = slot;
}

function renderScope(): BillingCatalogScope | undefined {
  const slot = renderScopeRegistry.slot;
  if (!slot) return undefined;
  try {
    const holder = slot();
    return holder === slot() ? holder as BillingCatalogScope : undefined;
  } catch {
    return undefined;
  }
}

/** The request scope in force: an explicit `run` scope, else the current server render's slot. */
function activeScope(): BillingCatalogScope | undefined {
  return billingCatalogContext.getStore() ?? renderScope();
}

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
  return billingCatalogContext.run({ context, pinned: true }, work);
}

/**
 * Open the request scope at an entry point (server action wrapper, page data function). Nothing is loaded
 * here: the first gate check inside `work` runs the registered loader and the scope shares that one result
 * with every later check, so an entry point that never reaches the gate costs no catalog call. Joins a
 * scope that is already open (an outer wrapper owns the request), so nesting never loads twice.
 */
export function runWithBillingCatalogRequest<T>(work: () => T): T {
  if (billingCatalogContext.getStore()) return work();
  // Inside a server render, the scope is the render's own slot, so a resolver that opens one (the co-managed
  // root) shares its load with the root layout's capability bootstrap instead of loading again.
  return billingCatalogContext.run(renderScope() ?? {}, work);
}

/**
 * Share one catalog read across the current request. Inside an explicit scope the first call for `key`
 * runs `work` and every later call in the scope (concurrent ones included) gets the same promise, settled
 * or rejected alike, so one request sees one answer; with no scope `work` simply runs. This is how the
 * request's other reads of the same catalog fact (EE: the offer catalog's current-offer resolution, which
 * re-reads the price from Stripe) cost one call per request, the context load included. Keys name the
 * fact, not the reader, so any catalog instance in the process shares them.
 */
export function memoiseInBillingCatalogRequest<T>(key: string, work: () => Promise<T>): Promise<T> {
  const scope = activeScope();
  if (!scope) return work();
  const memo = scope.memo ??= new Map();
  let pending = memo.get(key) as Promise<T> | undefined;
  if (!pending) memo.set(key, pending = work());
  return pending;
}

/**
 * A catalog write happened in this request: later reads in it must see the new state. Drops the memoised
 * reads and a lazily loaded context; a context the caller pinned stays, since pinning is the caller's choice.
 */
export function forgetBillingCatalogRequest(): void {
  const scope = activeScope();
  if (!scope) return;
  scope.memo?.clear();
  if (!scope.pinned) scope.context = undefined;
}

/** Is a request scope open (an explicit one, or the current server render's)? */
export function hasBillingCatalogScope(): boolean {
  return activeScope() !== undefined;
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
  const scope = activeScope();
  if (scope?.context) return scope.context;
  const loader = loaderRegistry.loader;
  if (!loader) return undefined;
  const load = async (): Promise<BillingCatalogContext> => {
    try {
      return await loader();
    } catch {
      return UNSELLABLE;
    }
  };
  if (!scope) return load();
  // Concurrent checks in one scope share the pending promise, so they cannot each start a load.
  return scope.context = load();
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
