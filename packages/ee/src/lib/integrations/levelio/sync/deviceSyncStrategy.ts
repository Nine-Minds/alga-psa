/**
 * Community Edition stub. The Level.io device sync is Enterprise-only;
 * without it the rmm-device-sync job skips Level.io integrations (which
 * cannot be configured in CE anyway).
 *
 * Intentionally untyped, matching the sibling NinjaOne stub: importing the
 * strategy type from @alga-psa/jobs would create an ee-stubs -> jobs project
 * cycle.
 */

export const levelIoDeviceSyncStrategy = undefined;
