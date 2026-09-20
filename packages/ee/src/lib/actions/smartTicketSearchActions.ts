/**
 * CE stub for the smart ticket search availability probe. The real action is
 * ee/server/src/lib/actions/smartTicketSearchActions.ts (edition-swapped via
 * the `@enterprise` alias). CE always reports unavailable so the Tickets page
 * never shows the Smart search affordance.
 */

export interface SmartTicketSearchAvailability {
  available: boolean;
}

export async function getSmartTicketSearchAvailability(..._args: unknown[]): Promise<SmartTicketSearchAvailability> {
  return { available: false };
}
