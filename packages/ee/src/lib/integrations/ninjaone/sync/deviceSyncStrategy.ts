/**
 * Community Edition stub. The NinjaOne device sync is Enterprise-only;
 * without it the rmm-device-sync job skips NinjaOne integrations (which
 * cannot be configured in CE anyway).
 *
 * Intentionally untyped, matching the sibling alert-fetcher stub: importing
 * the strategy type from @alga-psa/jobs would create an ee-stubs -> jobs
 * project cycle.
 */

export const ninjaOneDeviceSyncStrategy = undefined;
