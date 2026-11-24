import { cache } from 'react';
import { registerBillingCatalogRenderScope } from '@alga-psa/licensing/billing-catalog-scope';

/**
 * One billing catalog scope per server render. React's `cache` returns the same holder for every call within
 * one render request and a new one for the next request, so the root layout's capability bootstrap, the
 * co-managed layout, page and metadata all share one catalog context load (and one Stripe price read). It must
 * be registered from the server-component layer, where `cache` is request-scoped: imported by the root layout.
 */
registerBillingCatalogRenderScope(cache(() => ({})));
