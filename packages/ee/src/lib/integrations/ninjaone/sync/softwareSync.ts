/**
 * Community Edition stub. The NinjaOne software inventory sync is Enterprise-only;
 * the rmm-inventory-sync job records a failed run if it is ever reached in CE
 * (NinjaOne cannot be configured in CE anyway).
 *
 * Intentionally untyped, matching the sibling device-sync stub: importing the
 * real signature from @alga-psa/jobs would create an ee-stubs -> jobs project cycle.
 */

export const syncSoftwareInventory = undefined;
