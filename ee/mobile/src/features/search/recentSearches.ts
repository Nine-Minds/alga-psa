import { getSecureJson, setSecureJson } from "../../storage/secureStorage";
import { logger } from "../../logging/logger";

const RECENT_LIMIT = 8;

/** expo-secure-store only accepts [A-Za-z0-9._-] in a key, and a baseUrl has neither. */
function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** Keyed by server and user, so a host or account switch starts fresh. */
export function recentSearchesKey(baseUrl: string, userId: string): string {
  return `alga.mobile.search.recent.${sanitize(baseUrl)}.${sanitize(userId)}`;
}

export async function readRecentSearches(key: string): Promise<string[]> {
  try {
    const saved = await getSecureJson<string[]>(key);
    if (!Array.isArray(saved)) return [];
    return saved.filter((entry): entry is string => typeof entry === "string");
  } catch (error) {
    logger.warn("search.recent_read_failed", { error });
    return [];
  }
}

export function nextRecentSearches(current: string[], query: string): string[] {
  return [query, ...current.filter((entry) => entry !== query)].slice(0, RECENT_LIMIT);
}

export async function writeRecentSearches(key: string, value: string[]): Promise<void> {
  try {
    await setSecureJson(key, value);
  } catch (error) {
    logger.warn("search.recent_write_failed", { error });
  }
}

/**
 * Sign-out and host switch drop the history with the rest of the account state.
 * Never throws: the host switch that calls it must go through either way.
 */
export async function clearRecentSearches(
  baseUrl: string | null,
  userId: string | null | undefined,
): Promise<void> {
  if (!baseUrl || !userId) return;
  await writeRecentSearches(recentSearchesKey(baseUrl, userId), []);
}
