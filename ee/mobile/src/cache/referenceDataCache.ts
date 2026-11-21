import { TtlCache } from "./ttlCache";

const TEN_MIN_MS = 10 * 60_000;

const ticketStatusesCache = new TtlCache<unknown>({ defaultTtlMs: TEN_MIN_MS });

export function getCachedTicketStatuses(key: string): unknown | null {
  return ticketStatusesCache.get(key);
}

export function setCachedTicketStatuses(key: string, value: unknown): void {
  ticketStatusesCache.set(key, value);
}

const ticketPrioritiesCache = new TtlCache<unknown>({ defaultTtlMs: TEN_MIN_MS });

export function getCachedTicketPriorities(key: string): unknown | null {
  return ticketPrioritiesCache.get(key);
}

export function setCachedTicketPriorities(key: string, value: unknown): void {
  ticketPrioritiesCache.set(key, value);
}

const ticketCategoriesCache = new TtlCache<unknown>({ defaultTtlMs: TEN_MIN_MS });

export function getCachedTicketCategories(key: string): unknown | null {
  return ticketCategoriesCache.get(key);
}

export function setCachedTicketCategories(key: string, value: unknown): void {
  ticketCategoriesCache.set(key, value);
}

