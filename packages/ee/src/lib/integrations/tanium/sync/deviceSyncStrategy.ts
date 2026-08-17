/**
 * Community Edition stub. The Tanium device sync is Enterprise-only; without it
 * the rmm-device-sync job skips Tanium integrations (which cannot be configured
 * in CE anyway, and whose ADVANCED_ASSETS tier gate CE does not grant).
 *
 * Intentionally untyped, matching the sibling NinjaOne and Level.io stubs:
 * importing the strategy type from @alga-psa/jobs would create an
 * ee-stubs -> jobs project cycle.
 */

export const taniumDeviceSyncStrategy = undefined;
