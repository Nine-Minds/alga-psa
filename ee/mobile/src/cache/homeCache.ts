import { TtlCache } from "./ttlCache";
import type { Activity } from "../api/activities";
import type { ScheduleEntry } from "../api/schedule";
import type { TicketListItem } from "../api/tickets";

const HOME_TTL_MS = 5 * 60_000;

export type HomeCacheValue = {
  schedule?: ScheduleEntry[];
  tickets?: { items: TicketListItem[]; total: number | null };
  activities?: Activity[];
};

const homeCache = new TtlCache<HomeCacheValue>({ defaultTtlMs: HOME_TTL_MS });

export function getCachedHome(key: string): HomeCacheValue | null {
  return homeCache.get(key);
}

/** Cards load independently, so each one merges into the day's entry. */
export function mergeCachedHome(key: string, value: HomeCacheValue): void {
  homeCache.set(key, { ...(homeCache.get(key) ?? {}), ...value });
}

export function clearHomeCache(): void {
  homeCache.clear();
}
