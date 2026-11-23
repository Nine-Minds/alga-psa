import logger from '@alga-psa/core/logger';
import { registerBillingCatalogContextLoader, runWithBillingCatalogContext, type BillingCatalogContext } from '@alga-psa/licensing';
import { getStripeService } from '../StripeService';
import { CO_MANAGED_SEAT_OFFER_KEY } from './types';

// Bounded by the number of distinct error codes. Only the fact that a code was logged is kept, never
// the account, price or any result: the catalog context itself has no process cache.
const loggedFailureCodes = new Set<string>();

/** A stable, tenant-free label for a failure: its error code when it has a safe one, else its class. */
function failureCode(error: unknown): string {
  const candidate = (error as { code?: unknown } | null)?.code;
  const raw = typeof candidate === 'string' && candidate ? candidate : (error as Error | null)?.name;
  return typeof raw === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(raw) ? raw : 'UNKNOWN';
}

function logContextLoadFailure(error: unknown): void {
  const code = failureCode(error);
  if (loggedFailureCodes.has(code)) return;
  loggedFailureCodes.add(code);
  // Message carries no tenant data and no error text (which can embed ids); the code locates the cause.
  logger.error(`[offerCatalog] Billing catalog context load failed (code ${code}); co-managed purchase and trial surfaces are closed. Logged once per process per code.`);
}

/** Test seam: forget which failure codes were already logged. */
export function resetLoggedContextLoadFailures(): void {
  loggedFailureCodes.clear();
}

/** Load request-current platform catalog settings; no process cache. Registered below as the licensing loader. */
export async function loadBillingCatalogContext(): Promise<BillingCatalogContext> {
  let livemode = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY_PLATFORM ?? '');
  let context: BillingCatalogContext = { mode: livemode ? 'live' : 'test', stripeAccount: null,
    priceId: null, source: 'unconfigured', sellable: false };
  try {
    const catalog = await getStripeService().getOfferCatalog();
    livemode = await catalog.deploymentLivemode();
    const effective = await catalog.effectiveAccountSetting(livemode);
    context = {
      mode: livemode ? 'live' : 'test',
      stripeAccount: effective.stripeAccount,
      priceId: effective.priceId,
      source: effective.priceSource === 'database setting' || effective.priceSource === 'database catalog'
        ? 'database' : effective.priceSource === 'environment bootstrap' ? 'environment' : 'unconfigured',
      sellable: false,
    };
    if (!context.stripeAccount || !context.priceId) return context;
    const offer = await catalog.resolveCurrentOffer(CO_MANAGED_SEAT_OFFER_KEY, 'month');
    return { ...context, sellable: offer.scope.stripeAccount === context.stripeAccount &&
      offer.scope.livemode === livemode && offer.priceId === context.priceId };
  } catch (error) {
    logContextLoadFailure(error);
    return context;
  }
}

/**
 * Optional since the gate resolves the context itself. Kept as an explicit request entry point: it loads
 * the context once and pins it for everything `work` awaits, however many gate checks that makes.
 */
export async function withBillingCatalogContext<T>(work: () => T | Promise<T>): Promise<T> {
  const context = await loadBillingCatalogContext();
  return runWithBillingCatalogContext(context, work);
}

/**
 * Import side effect: the gate in @alga-psa/licensing resolves the catalog context through this loader
 * whether or not the caller wrapped in `withBillingCatalogContext`. Every EE entry that can reach the
 * gate imports this module (see capabilityEntryPoints.contract.test.ts). The CE alias of this file registers nothing.
 */
registerBillingCatalogContextLoader(loadBillingCatalogContext);
