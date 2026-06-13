/**
 * Community Edition stub. The NinjaOne outbound alert adapter is only
 * available in the Enterprise Edition; without it the ticket-close subscriber
 * skips the outbound reset.
 *
 * Intentionally untyped (the EE export is an RmmAlertOutboundAdapter):
 * importing the type from @alga-psa/shared would create an
 * ee-stubs -> shared project cycle.
 */

export const ninjaOneAlertOutboundAdapter = undefined;
