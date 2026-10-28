/**
 * Community Edition stub. The Datto RMM device sync is Enterprise-only;
 * without it the rmm-device-sync job skips Datto integrations (which cannot
 * be configured in CE anyway).
 *
 * Intentionally untyped, matching the sibling stubs: importing the strategy
 * type from @alga-psa/jobs would create an ee-stubs -> jobs project cycle.
 */

export const dattoRmmDeviceSyncStrategy = undefined;
