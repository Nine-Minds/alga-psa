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

/**
 * A discovery document is self-asserted: whatever host answers gets to name the
 * `issuer` it wants, and that string becomes the trusted-issuer binding an agent
 * token is later verified against. OpenID Connect Discovery 1.0 section 4.3
 * therefore requires the returned `issuer` to equal the one the discovery URL was
 * derived from, and this is where that check belongs — before the value is
 * cached, stored, or used to admit a token.
 *
 * Without it, anything that could ever influence the discovery URL would be able
 * to name its own issuer. Nothing can today (`discoveryBaseUrl` is a test seam
 * that no route surfaces, pinned by mcpIdpDiscoveryNotRequestSelected.contract),
 * but "no request-selected issuer" should hold because the value is validated,
 * not merely because no caller currently passes one.
 */
function assertDiscoveryUrl(discoveryUrl: string): URL {
  let url: URL;
  try {
    url = new URL(discoveryUrl);
  } catch {
    throw new Error(`OIDC discovery URL is not a valid absolute URL: ${discoveryUrl}`);
  }
  // Discovery carries the signing-key location for tokens that grant access, so
  // it may not travel in cleartext. Loopback is allowed so a local emulator does
  // not need a certificate; it cannot be reached from off-host.
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`OIDC discovery refuses ${url.protocol}//${url.host}: discovery must use https (loopback http excepted).`);
  }
  return url;
}

/** Section 4.3: the issuer the document asserts must be the one we asked. */
function expectedIssuerFor(url: URL): string {
  const path = url.pathname.replace(/\/\.well-known\/openid-configuration\/?$/, '');
  return `${url.origin}${path}`.replace(/\/$/, '');
}

/**
 * Whether an advertised issuer is the one this discovery URL is entitled to name.
 *
 * Usually that is string equality. The exception is real and had to be measured
 * rather than assumed: Microsoft's multi-tenant authorities answer with a
 * TEMPLATED issuer. `https://login.microsoftonline.com/common/v2.0/.well-known/
 * openid-configuration` advertises
 * `https://login.microsoftonline.com/{tenantid}/v2.0` verbatim, placeholder
 * included, because the concrete tenant is only known once a token is issued.
 *
 * So `{tenantid}` is allowed to stand for exactly one path segment, and every
 * other character still has to match the URL we asked. That keeps the property
 * worth having — a host cannot name an issuer on a different origin or path than
 * the one it was reached at — while accepting the one legitimate provider in
 * this repo's presets that does not answer with a literal issuer.
 */
function issuerMatchesDiscoveryUrl(advertised: string, expected: string): boolean {
  const normalize = (value: string) => value.replace(/\/$/, '');
  const advertisedIssuer = normalize(advertised);
  const expectedIssuer = normalize(expected);
  if (advertisedIssuer === expectedIssuer) return true;
  if (!/\{tenantid\}/i.test(advertisedIssuer)) return false;
  const pattern = advertisedIssuer
    .split(/\{tenantid\}/i)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
  return new RegExp(`^${pattern}$`).test(expectedIssuer);
}

export async function discoverOidc(discoveryUrl: string): Promise<OidcConfig> {
  const cached = cache.get(discoveryUrl);
  if (cached) return cached;

  const url = assertDiscoveryUrl(discoveryUrl);

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
  const expectedIssuer = expectedIssuerFor(url);
  if (!issuerMatchesDiscoveryUrl(doc.issuer, expectedIssuer)) {
    throw new Error(
      `OIDC discovery issuer mismatch: ${discoveryUrl} advertises issuer "${doc.issuer}", expected "${expectedIssuer}".`
    );
  }
  // The JWKS carries the keys every agent token is verified against, so it must
  // not travel in cleartext either.
  //
  // Deliberately NOT required to share the issuer's origin: real providers do
  // not. Google advertises issuer `https://accounts.google.com` with keys at
  // `https://www.googleapis.com/oauth2/v3/certs`, so an origin-match rule would
  // reject the built-in Google preset outright. Transport is the invariant that
  // actually holds across providers.
  let jwks: URL;
  try {
    jwks = new URL(doc.jwks_uri);
  } catch {
    throw new Error(`OIDC discovery doc at ${discoveryUrl} has an invalid jwks_uri: ${doc.jwks_uri}`);
  }
  const jwksLoopback = jwks.hostname === '127.0.0.1' || jwks.hostname === 'localhost' || jwks.hostname === '[::1]';
  if (jwks.protocol !== 'https:' && !(jwks.protocol === 'http:' && jwksLoopback)) {
    throw new Error(`OIDC discovery refuses jwks_uri ${doc.jwks_uri}: keys must be fetched over https (loopback http excepted).`);
  }
  const cfg: OidcConfig = { issuer: doc.issuer, jwksUri: doc.jwks_uri };
  cache.set(discoveryUrl, cfg);
  return cfg;
}

/** Test/seam hook: clear the discovery cache. */
export function _clearOidcCache(): void {
  cache.clear();
}
