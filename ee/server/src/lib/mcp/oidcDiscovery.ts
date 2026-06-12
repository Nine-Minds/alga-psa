/**
 * Minimal OIDC discovery (F002): fetch a `.well-known/openid-configuration`
 * document and extract issuer + jwks_uri. Used by the agent-IdP presets so an
 * admin never has to hand-enter a JWKS URI. Cached per discovery URL.
 */

export interface OidcConfig {
  issuer: string;
  jwksUri: string;
}

const cache = new Map<string, OidcConfig>();

export async function discoverOidc(discoveryUrl: string): Promise<OidcConfig> {
  const cached = cache.get(discoveryUrl);
  if (cached) return cached;

  let res: Response;
  try {
    res = await fetch(discoveryUrl, { headers: { accept: 'application/json' } });
  } catch (e) {
    throw new Error(`OIDC discovery could not reach ${discoveryUrl}: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (HTTP ${res.status}) for ${discoveryUrl}`);
  }
  const doc = (await res.json().catch(() => ({}))) as { issuer?: string; jwks_uri?: string };
  if (!doc.issuer || !doc.jwks_uri) {
    throw new Error(`OIDC discovery doc at ${discoveryUrl} is missing issuer/jwks_uri.`);
  }
  const cfg: OidcConfig = { issuer: doc.issuer, jwksUri: doc.jwks_uri };
  cache.set(discoveryUrl, cfg);
  return cfg;
}

/** Test/seam hook: clear the discovery cache. */
export function _clearOidcCache(): void {
  cache.clear();
}
