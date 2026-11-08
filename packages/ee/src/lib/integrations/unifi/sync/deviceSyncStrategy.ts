/**
 * Community Edition stub. The UniFi device sync is Enterprise-only;
 * without it the rmm-device-sync job skips UniFi integrations (which
 * cannot be configured in CE anyway).
 *
 * Intentionally untyped, matching the sibling NinjaOne stub: importing the
 * strategy type from @alga-psa/jobs would create an ee-stubs -> jobs project
 * cycle.
 */

export const uniFiDeviceSyncStrategy = undefined;
