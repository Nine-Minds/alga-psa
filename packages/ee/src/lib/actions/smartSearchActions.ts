/**
 * CE stub for the smart search availability probe. The real action is
 * ee/server/src/lib/actions/smartSearchActions.ts (edition-swapped via the
 * `@enterprise` alias). CE always reports unavailable so no list page shows
 * the Smart search affordance.
 */

export interface SmartSearchAvailability {
  available: boolean;
}

export async function getSmartSearchAvailability(..._args: unknown[]): Promise<SmartSearchAvailability> {
  return { available: false };
}
