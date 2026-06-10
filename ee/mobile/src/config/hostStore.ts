import { normalizeBaseUrl } from "./appConfig";
import { secureStorage } from "../storage/secureStorage";

const CUSTOM_HOST_KEY = "alga.mobile.customHost";

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

// Bare hostnames get https:// prefixed; explicit http:// is accepted.
// TODO(harden): require https for user-entered hosts before GA — http is
// temporarily allowed for appliance bring-up against bare-IP hosts.
export function normalizeHostInput(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const withScheme = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;
  return normalizeBaseUrl(withScheme);
}

export async function loadStoredHost(): Promise<string | null> {
  const value = await secureStorage.getItem(CUSTOM_HOST_KEY);
  if (!value) return null;
  return normalizeHostInput(value) ?? null;
}

export async function saveStoredHost(url: string): Promise<string> {
  const normalized = normalizeHostInput(url);
  if (!normalized) throw new Error("Host must be a valid https:// URL");
  await secureStorage.setItem(CUSTOM_HOST_KEY, normalized);
  return normalized;
}

export async function clearStoredHost(): Promise<void> {
  await secureStorage.deleteItem(CUSTOM_HOST_KEY);
}
