import {
  normalizePortalDomainSurface,
  type PortalDomainSurface,
} from '@alga-psa/shared/core/portalDomainSurface';

/**
 * Edge-safe lookup of which surface a request host serves.
 *
 * The Edge middleware cannot query the database, so it asks the Node runtime
 * (`/api/portal-domain/surface`) and caches the answer per isolate for a short
 * time. Result semantics:
 *   - a PortalDomainSurface: the host is an ACTIVE custom portal domain
 *   - null: not a known/active custom domain, or the lookup failed
 * Callers must treat null exactly like the legacy behaviour (a `client_portal`
 * vanity host), so a failed lookup can never grant MSP access in place.
 */

export const HOST_SURFACE_LOOKUP_PATH = '/api/portal-domain/surface';
/**
 * Header the middleware attaches so the route can tell its own lookups (whose `host`
 * is the real incoming request Host) from arbitrary callers (whose `?host=` is
 * attacker-chosen). The value is a purpose-bound HMAC derived from the auth secret
 * (HMAC-SHA256(secret, TOKEN_PURPOSE), hex) - never the secret itself, so a
 * misconfigured PORTAL_DOMAIN_LOOKUP_ORIGIN cannot leak the session-signing key.
 */
export const INTERNAL_LOOKUP_HEADER = 'x-portal-domain-lookup-token';
const TOKEN_PURPOSE = 'portal-domain-surface-lookup:v1';

const tokenCache = new Map<string, string>();

/** Web Crypto only, so it runs in the Edge middleware and in Node alike. */
export async function getInternalLookupToken(
  env: Record<string, string | undefined> = process.env
): Promise<string | null> {
  const secret = env.AUTH_SECRET || env.NEXTAUTH_SECRET;
  if (!secret) {
    return null;
  }
  const cached = tokenCache.get(secret);
  if (cached) {
    return cached;
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(TOKEN_PURPOSE)));
  const token = Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
  tokenCache.clear();
  tokenCache.set(secret, token);
  return token;
}

const POSITIVE_TTL_MS = 30_000;
const NEGATIVE_TTL_MS = 10_000;
const MAX_CACHE_ENTRIES = 500;

interface CacheEntry {
  surface: PortalDomainSurface | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearHostSurfaceCache(): void {
  cache.clear();
}

export function getHostSurfaceLookupOrigin(env: Record<string, string | undefined> = process.env): string {
  return env.PORTAL_DOMAIN_LOOKUP_ORIGIN || `http://127.0.0.1:${env.PORT || '3000'}`;
}

export interface ResolveHostSurfaceOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  lookupOrigin?: string;
}

export async function resolveHostSurface(
  hostname: string,
  options: ResolveHostSurfaceOptions = {}
): Promise<PortalDomainSurface | null> {
  const host = hostname.trim().toLowerCase();
  if (!host) {
    return null;
  }

  const now = (options.now ?? Date.now)();
  const hit = cache.get(host);
  if (hit && hit.expiresAt > now) {
    return hit.surface;
  }

  let surface: PortalDomainSurface | null = null;
  let ttl = NEGATIVE_TTL_MS;
  try {
    const url = new URL(HOST_SURFACE_LOOKUP_PATH, options.lookupOrigin ?? getHostSurfaceLookupOrigin());
    url.searchParams.set('host', host);
    const token = await getInternalLookupToken();
    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: {
        accept: 'application/json',
        ...(token ? { [INTERNAL_LOOKUP_HEADER]: token } : {}),
      },
      cache: 'no-store',
    });
    if (response.ok) {
      const body = (await response.json()) as { surface?: unknown } | null;
      if (body && typeof body.surface === 'string') {
        surface = normalizePortalDomainSurface(body.surface);
        ttl = POSITIVE_TTL_MS;
      }
    }
  } catch {
    surface = null;
  }

  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.clear();
  }
  cache.set(host, { surface, expiresAt: now + ttl });
  return surface;
}
