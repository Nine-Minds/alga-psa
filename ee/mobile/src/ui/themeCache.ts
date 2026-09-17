/**
 * Device cache for the tenant theme block, so a warm launch paints the tenant's
 * pair instead of a frame of Alga purple. Keyed by server and tenant: a shared
 * device that signs into a second tenant must never inherit the first one's
 * colours.
 */

import { getSecureJson, secureStorage, setSecureJson } from "../storage/secureStorage";
import { logger } from "../logging/logger";
import { parseMobileTheme, type MobileTheme } from "./themeTokens";

const THEME_CACHE_PREFIX = "alga.mobile.theme.tokens";

type CachedThemeEntry = {
  baseUrl: string;
  tenantId: string;
  theme: MobileTheme;
};

/** expo-secure-store only accepts [A-Za-z0-9._-] in a key. */
function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function themeCacheKey(baseUrl: string | null | undefined, tenantId: string | null | undefined): string | null {
  if (!baseUrl || !tenantId) return null;
  return `${THEME_CACHE_PREFIX}.${sanitize(baseUrl)}.${sanitize(tenantId)}`;
}

export async function readCachedTheme(
  baseUrl: string | null | undefined,
  tenantId: string | null | undefined,
): Promise<MobileTheme | null> {
  const key = themeCacheKey(baseUrl, tenantId);
  if (!key) return null;
  try {
    const entry = await getSecureJson<CachedThemeEntry>(key);
    // Sanitising can in theory fold two hosts onto one key; the stored identity
    // is the real check.
    if (!entry || entry.baseUrl !== baseUrl || entry.tenantId !== tenantId) return null;
    return parseMobileTheme(entry.theme);
  } catch (error) {
    logger.warn("theme.cache_read_failed", { error });
    return null;
  }
}

export async function writeCachedTheme(
  baseUrl: string | null | undefined,
  tenantId: string | null | undefined,
  theme: MobileTheme,
): Promise<void> {
  const key = themeCacheKey(baseUrl, tenantId);
  if (!key || !baseUrl || !tenantId) return;
  try {
    await setSecureJson<CachedThemeEntry>(key, { baseUrl, tenantId, theme });
  } catch (error) {
    logger.warn("theme.cache_write_failed", { error });
  }
}

export async function clearCachedTheme(
  baseUrl: string | null | undefined,
  tenantId: string | null | undefined,
): Promise<void> {
  const key = themeCacheKey(baseUrl, tenantId);
  if (!key) return;
  try {
    await secureStorage.deleteItem(key);
  } catch (error) {
    logger.warn("theme.cache_clear_failed", { error });
  }
}
