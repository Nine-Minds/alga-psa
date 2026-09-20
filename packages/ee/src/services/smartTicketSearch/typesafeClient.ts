/**
 * CE stub. The real resolver lives in
 * ee/server/src/services/smartTicketSearch/typesafeClient.ts (edition-swapped
 * via the `@ee` alias). Community edition never has a TypeSafe client, so the
 * feature reports itself unconfigured and stays hidden.
 */

export const TYPESAFE_API_KEY_SECRET = 'TYPESAFE_API_KEY';
export const SMART_SEARCH_AI_FEATURE = 'smart-ticket-search';

export async function resolveTypeSafeClient(): Promise<null> {
  return null;
}

export async function isSmartTicketSearchConfigured(): Promise<boolean> {
  return false;
}

export function resetTypeSafeClientCache(): void {}
