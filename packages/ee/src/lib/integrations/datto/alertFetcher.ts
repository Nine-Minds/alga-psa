/**
 * Community Edition stub. The Datto RMM alert fetcher is Enterprise-only;
 * without it the rmm-alert-reconciliation job handler skips Datto
 * integrations (which cannot be configured in CE anyway).
 *
 * Intentionally untyped (the EE export is an RmmActiveAlertFetcher):
 * importing the type from @alga-psa/shared would create an
 * ee-stubs -> shared project cycle.
 */

export const dattoRmmAlertFetcher = undefined;
