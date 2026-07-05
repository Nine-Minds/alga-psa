import { TtlCache } from "./ttlCache";
import type { Activity } from "../api/activities";

const LIST_TTL_MS = 60_000;

export type UserActivitiesCacheValue = {
  items: Activity[];
  page: number;
  hasNext: boolean;
  lastRefreshedAtIso: string | null;
};

const userActivitiesListCache = new TtlCache<UserActivitiesCacheValue>({ defaultTtlMs: LIST_TTL_MS });

export function getCachedUserActivities(key: string): UserActivitiesCacheValue | null {
  return userActivitiesListCache.get(key);
}

export function setCachedUserActivities(key: string, value: UserActivitiesCacheValue): void {
  userActivitiesListCache.set(key, value);
}

export function clearUserActivitiesCache(): void {
  userActivitiesListCache.clear();
}
