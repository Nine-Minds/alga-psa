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

