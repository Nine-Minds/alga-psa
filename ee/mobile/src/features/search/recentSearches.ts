import { getSecureJson, setSecureJson } from "../../storage/secureStorage";

const RECENT_LIMIT = 8;

/** Keyed by server and user, so a host or account switch starts fresh. */
export function recentSearchesKey(baseUrl: string, userId: string): string {
  return `alga.mobile.search.recent.${baseUrl}.${userId}`;
}

export async function readRecentSearches(key: string): Promise<string[]> {
  const saved = await getSecureJson<string[]>(key);
  if (!Array.isArray(saved)) return [];
  return saved.filter((entry): entry is string => typeof entry === "string");
}

export function nextRecentSearches(current: string[], query: string): string[] {
  return [query, ...current.filter((entry) => entry !== query)].slice(0, RECENT_LIMIT);
}

export async function writeRecentSearches(key: string, value: string[]): Promise<void> {
  await setSecureJson(key, value);
}

/** Sign-out and host switch drop the history with the rest of the account state. */
export async function clearRecentSearches(
  baseUrl: string | null,
  userId: string | null | undefined,
): Promise<void> {
  if (!baseUrl || !userId) return;
  await setSecureJson(recentSearchesKey(baseUrl, userId), []);
}
