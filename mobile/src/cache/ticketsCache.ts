import { TtlCache } from "./ttlCache";

const LIST_TTL_MS = 30_000;
const DETAIL_TTL_MS = 60_000;

const ticketsListCache = new TtlCache<unknown>({ defaultTtlMs: LIST_TTL_MS });
const ticketDetailCache = new TtlCache<unknown>({ defaultTtlMs: DETAIL_TTL_MS });

export function getCachedTicketsList(key: string): unknown | null {
  return ticketsListCache.get(key);
}

export function setCachedTicketsList(key: string, value: unknown): void {
  ticketsListCache.set(key, value);
}

export function getCachedTicketDetail(ticketId: string): unknown | null {
  return ticketDetailCache.get(ticketId);
}

export function setCachedTicketDetail(ticketId: string, value: unknown): void {
  ticketDetailCache.set(ticketId, value);
}

export function invalidateTicket(ticketId: string): void {
  ticketDetailCache.delete(ticketId);
  ticketsListCache.clear();
}

export function clearTicketsCache(): void {
  ticketsListCache.clear();
  ticketDetailCache.clear();
}

