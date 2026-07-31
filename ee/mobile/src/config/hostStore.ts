import { normalizeBaseUrl } from "./appConfig";
import { secureStorage } from "../storage/secureStorage";

const CUSTOM_HOST_KEY = "alga.mobile.customHost";

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

// Bare hostnames get https:// prefixed; anything other than https is rejected.
// Dev builds additionally accept explicit http:// hosts so a device can point
// at a local server over the LAN (iOS ATS still restricts http to local
// addresses via NSAllowsLocalNetworking). Release builds stay https-only.
export function normalizeHostInput(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const withScheme = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;
  const normalized = normalizeBaseUrl(withScheme);
  if (!normalized) return undefined;
  if (normalized.startsWith("https://")) return normalized;
  if (__DEV__ && normalized.startsWith("http://")) return normalized;
  return undefined;
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
