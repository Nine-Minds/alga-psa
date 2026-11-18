import { registerRouteLocaleResolver } from '@alga-psa/ui/lib/i18n/serverOnly';
import { PUBLIC_QUOTE_PAGE_PATTERN } from './publicQuotePaths';

/**
 * Lets the root layout's `<html lang>` follow the recipient on /quote/<token>.
 * Idempotent. The resolver module is loaded lazily so the root layout (in every
 * route's graph) does not pull the billing services into every route; the
 * module is a singleton, so its per-request cache() is the one the page uses.
 */
export function registerPublicQuoteRouteLocale(): void {
  registerRouteLocaleResolver(PUBLIC_QUOTE_PAGE_PATTERN, async (match) => {
    const { resolvePublicQuoteRequest } = await import('./publicQuoteRequest');
    const { reader } = await resolvePublicQuoteRequest(match[1]);
    return reader?.locale ?? null;
  });
}
