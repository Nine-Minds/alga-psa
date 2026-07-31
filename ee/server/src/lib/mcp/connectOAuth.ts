/**
 * "Connect with Microsoft / Google" for MCP agent provisioning (hosted easy path).
 *
 * On Nine Minds–hosted Alga the shared Microsoft/Google OAuth apps (the same
 * ones behind SSO) are already pre-trusted for agent token validation
 * (`idpBuiltins.ts`). This module runs an interactive auth-code consent through
 * those shared apps and returns the resolved `{issuer, subject, label}` so the
 * admin never hand-enters a directory identity.
 *
 * It is deliberately minimal and INERT: it exchanges the code for an id_token,
 * reads `iss`/`sub`, and DISCARDS every token. No agent is created here — that
 * stays behind the admin-authed `POST /api/v1/mcp/agents`, which derives the
 * tenant from the session (the cross-tenant safety boundary).
 *
 * Why `sub`: an interactive (human-delegated) id_token carries no `azp`, so the
 * Microsoft built-in (subjectClaim 'azp') falls back to `payload.sub` in
 * `idpToken.ts`; Google's built-in already uses `sub`. Capturing `sub` therefore
 * matches the built-in validation for both providers with no schema change.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { decodeJwt } from 'jose';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import {
  generateMicrosoftAuthUrl,
  generateGoogleAuthUrl,
  generateNonce,
  encodeState,
  decodeState,
  validateState,
  type OAuthState,
} from '@alga-psa/integrations/utils/email/oauthHelpers';
import { hostedMicrosoftEnabled, hostedGoogleEnabled } from './idpBuiltins';

export type ConnectProvider = 'microsoft' | 'google';

export interface PlatformProvider {
  provider: ConnectProvider;
  label: string;
  /** Fixed issuer for Google; null for Microsoft (concrete tenant issuer only known post-connect). */
  issuer: string | null;
  available: boolean;
}

export interface ConnectIdentity {
  provider: ConnectProvider;
  issuer: string;
  /** id_token `sub` — stored as the agent's idp_subject. */
  subject: string;
  /** email / preferred_username / name — used to default the agent name. */
  label: string;
}

export interface ConnectStart {
  authUrl: string;
  stateCookie: { name: string; value: string; maxAgeSeconds: number };
}

/** Path-scoped, httpOnly cookie that binds the OAuth `state` to this browser. */
export const CONNECT_STATE_COOKIE = 'mcp_connect_state';
const STATE_TTL_MS = 10 * 60 * 1000;
const CONNECT_SCOPES = ['openid', 'profile', 'email'];

interface ConnectState extends OAuthState {
  provider: ConnectProvider;
  purpose: 'mcp-connect';
}

const PROVIDERS: Record<
  ConnectProvider,
  {
    label: string;
    clientIdKey: string;
    clientSecretKey: string;
    tokenEndpoint: string;
    enabled: () => Promise<boolean>;
    buildAuthUrl: (clientId: string, redirectUri: string, state: ConnectState) => string;
  }
> = {
  microsoft: {
    label: 'Microsoft',
    clientIdKey: 'MICROSOFT_OAUTH_CLIENT_ID',
    clientSecretKey: 'MICROSOFT_OAUTH_CLIENT_SECRET',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    enabled: hostedMicrosoftEnabled,
    buildAuthUrl: (clientId, redirectUri, state) =>
      generateMicrosoftAuthUrl(clientId, redirectUri, state, CONNECT_SCOPES, 'common'),
  },
  google: {
    label: 'Google',
    clientIdKey: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretKey: 'GOOGLE_OAUTH_CLIENT_SECRET',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    enabled: hostedGoogleEnabled,
    buildAuthUrl: (clientId, redirectUri, state) =>
      generateGoogleAuthUrl(clientId, redirectUri, state, CONNECT_SCOPES),
  },
};

/** App-level secret with env fallback (mirrors idpBuiltins.appSecret). */
async function appSecret(name: string): Promise<string> {
  try {
    const sp = await getSecretProviderInstance();
    return (await sp.getAppSecret(name)) || process.env[name] || '';
  } catch {
    return process.env[name] || '';
  }
}

function connectSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not configured.');
  return secret;
}

/** HMAC over the immutable state fields — the cookie carries this signature. */
function signState(s: ConnectState): string {
  const canonical = [s.nonce, s.tenant, s.userId ?? '', s.timestamp, s.provider].join('|');
  return createHmac('sha256', connectSecret()).update(canonical).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function redirectUriFor(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/v1/mcp/connect/callback`;
}

/**
 * Build the provider authorize URL for an interactive connect, plus the signed
 * state cookie the callback will require. Refuses if the shared app is absent.
 */
export async function buildConnectAuthUrl(params: {
  provider: ConnectProvider;
  tenant: string;
  userId: string;
  baseUrl: string;
}): Promise<ConnectStart> {
  const cfg = PROVIDERS[params.provider];
  if (!cfg) throw new Error(`Unsupported provider: ${params.provider}`);
  if (!(await cfg.enabled())) {
    throw new Error(`The shared ${cfg.label} app is not configured on this instance.`);
  }
  const clientId = await appSecret(cfg.clientIdKey);
  if (!clientId) throw new Error(`Missing ${cfg.clientIdKey}.`);

  const redirectUri = redirectUriFor(params.baseUrl);
  const state: ConnectState = {
    tenant: params.tenant,
    userId: params.userId,
    redirectUri,
    timestamp: Date.now(),
    nonce: generateNonce(),
    provider: params.provider,
    purpose: 'mcp-connect',
    hosted: true,
  };

  return {
    authUrl: cfg.buildAuthUrl(clientId, redirectUri, state),
    stateCookie: { name: CONNECT_STATE_COOKIE, value: signState(state), maxAgeSeconds: STATE_TTL_MS / 1000 },
  };
}

/**
 * Validate the callback (state expiry + cookie-HMAC binding + session tenant),
 * exchange the code for an id_token, and return the discovered identity.
 * Tokens are never persisted or returned.
 */
export async function completeConnectCallback(params: {
  code: string;
  state: string;
  cookieState: string | undefined;
  baseUrl: string;
  sessionTenant: string;
}): Promise<ConnectIdentity> {
  const decoded = decodeState(params.state) as ConnectState | null;
  if (!decoded || decoded.purpose !== 'mcp-connect') throw new Error('Invalid OAuth state.');
  const provider = decoded.provider;
  if (provider !== 'microsoft' && provider !== 'google') throw new Error('Invalid OAuth provider in state.');
  if (!validateState(decoded, STATE_TTL_MS)) throw new Error('OAuth state expired — start over.');
  if (!params.cookieState) throw new Error('Missing OAuth state cookie.');
  if (!timingSafeEqualHex(signState(decoded), params.cookieState)) {
    throw new Error('OAuth state/cookie mismatch.');
  }
  if (decoded.tenant !== params.sessionTenant) throw new Error('Session/tenant mismatch.');

  const cfg = PROVIDERS[provider];
  const clientId = await appSecret(cfg.clientIdKey);
  const clientSecret = await appSecret(cfg.clientSecretKey);
  if (!clientId || !clientSecret) throw new Error(`The shared ${cfg.label} app is not fully configured.`);

  // redirect_uri must byte-match the authorize request — reuse the value from state.
  const redirectUri = decoded.redirectUri || redirectUriFor(params.baseUrl);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await fetch(cfg.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`${cfg.label} token exchange failed (HTTP ${resp.status}): ${text.slice(0, 300)}`);
  }
  const data = (await resp.json().catch(() => ({}))) as { id_token?: string };
  if (!data.id_token) throw new Error('Token response did not include an id_token (request the openid scope).');

  const claims = decodeJwt(data.id_token);
  const issuer = String(claims.iss ?? '');
  const subject = String(claims.sub ?? '');
  if (!issuer || !subject) throw new Error('id_token is missing iss/sub.');
  const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
  if (aud && String(aud) !== clientId) throw new Error('id_token audience is not the shared app.');

  const claimsRec = claims as Record<string, unknown>;
  const label = String(claimsRec.email ?? claimsRec.preferred_username ?? claimsRec.name ?? subject);
  return { provider, issuer, subject, label };
}

/** Which shared platform apps are available on this instance (drives the UI). */
export async function listPlatformProviders(_tenant: string): Promise<PlatformProvider[]> {
  const out: PlatformProvider[] = [];
  if (await hostedMicrosoftEnabled()) {
    out.push({ provider: 'microsoft', label: 'Microsoft', issuer: null, available: true });
  }
  if (await hostedGoogleEnabled()) {
    out.push({ provider: 'google', label: 'Google', issuer: 'https://accounts.google.com', available: true });
  }
  return out;
}
