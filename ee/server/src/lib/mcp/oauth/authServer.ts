import crypto from 'node:crypto';
import { getSession } from '@alga-psa/auth';
import {
  resolveClient,
  validateRedirectUri,
  ClientResolutionError,
  type OAuthClient,
} from './clients';
import {
  upsertGrant,
  issueAuthCode,
  consumeAuthCode,
  issueRefreshToken,
  rotateRefreshToken,
  hasActiveConsent,
  revokeByRefreshToken,
  OAuthGrantError,
} from './grants';
import {
  mintAccessToken,
  mcpResource,
  ACCESS_TOKEN_TTL_SECONDS,
  MCP_SCOPE,
} from './tokens';

/**
 * OAuth 2.1 Authorization Server orchestration for the remote MCP server.
 * AlgaPSA authenticates the user via its own session (no external IdP broker for
 * hosted users) and issues Alga-signed tokens representing that user. CIMD only,
 * PKCE/S256 required, refresh-token rotation, RFC 7009 revocation.
 */

const SIGNED_REQUEST_TTL_SECONDS = 600;

function signingSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is not configured.');
  return s;
}

// ---- AS metadata (RFC 8414) -------------------------------------------------

export function buildAuthServerMetadata(base: string): Record<string, unknown> {
  const b = base.replace(/\/$/, '');
  return {
    issuer: b,
    authorization_endpoint: `${b}/api/mcp/oauth/authorize`,
    token_endpoint: `${b}/api/mcp/oauth/token`,
    revocation_endpoint: `${b}/api/mcp/oauth/revoke`,
    jwks_uri: `${b}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [MCP_SCOPE],
    // CIMD: client_id is an https metadata-document URL; no DCR endpoint. Clients
    // (e.g. claude.ai) only choose the CIMD path when the AS advertises BOTH this
    // flag AND 'none' in token_endpoint_auth_methods_supported — without it they
    // fall back to DCR, find no registration_endpoint, and demand a manual id.
    client_id_metadata_document_supported: true,
    response_modes_supported: ['query'],
  };
}

// ---- Authorize request parsing + signing ------------------------------------

export interface AuthorizeParams {
  responseType: string;
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string | null;
  resource: string | null;
}

export function parseAuthorizeParams(sp: URLSearchParams): AuthorizeParams {
  return {
    responseType: sp.get('response_type') ?? '',
    clientId: sp.get('client_id') ?? '',
    redirectUri: sp.get('redirect_uri') ?? '',
    state: sp.get('state'),
    codeChallenge: sp.get('code_challenge') ?? '',
    codeChallengeMethod: sp.get('code_challenge_method') ?? '',
    scope: sp.get('scope'),
    resource: sp.get('resource'),
  };
}

export function signAuthRequest(p: AuthorizeParams): string {
  const payload = { ...p, exp: Math.floor(Date.now() / 1000) + SIGNED_REQUEST_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', signingSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyAuthRequest(blob: string): AuthorizeParams | null {
  const [body, sig] = blob.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', signingSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as AuthorizeParams;
  } catch {
    return null;
  }
}

function redirectWithError(redirectUri: string, error: string, state: string | null, desc?: string): string {
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  if (desc) u.searchParams.set('error_description', desc);
  if (state) u.searchParams.set('state', state);
  return u.toString();
}

function redirectWithCode(redirectUri: string, code: string, state: string | null): string {
  const u = new URL(redirectUri);
  u.searchParams.set('code', code);
  if (state) u.searchParams.set('state', state);
  return u.toString();
}

async function currentSessionUser(): Promise<{ userId: string; tenant: string } | null> {
  const session = await getSession();
  const u = session?.user as { id?: string; tenant?: string } | undefined;
  if (u?.id && u?.tenant) return { userId: u.id, tenant: u.tenant };
  return null;
}

// ---- Authorize (GET): decide login / consent / immediate redirect -----------

export type AuthorizePlan =
  | { kind: 'error'; status: number; message: string }
  | { kind: 'login'; location: string }
  | { kind: 'redirect'; location: string }
  | { kind: 'consent'; clientId: string; clientName: string | null; signedRequest: string; tenant: string };

export async function prepareAuthorize(base: string, url: URL): Promise<AuthorizePlan> {
  const p = parseAuthorizeParams(url.searchParams);

  if (!p.clientId) return { kind: 'error', status: 400, message: 'Missing client_id.' };

  let client: OAuthClient;
  try {
    client = await resolveClient(p.clientId);
  } catch (e) {
    const msg = e instanceof ClientResolutionError ? e.message : 'Unable to resolve client.';
    return { kind: 'error', status: 400, message: msg };
  }

  // redirect_uri must be present and registered before we can safely redirect errors.
  if (!p.redirectUri || !validateRedirectUri(client, p.redirectUri)) {
    return { kind: 'error', status: 400, message: 'Invalid or unregistered redirect_uri.' };
  }

  // From here, protocol errors can be returned to the client via redirect.
  if (p.responseType !== 'code') {
    return { kind: 'redirect', location: redirectWithError(p.redirectUri, 'unsupported_response_type', p.state) };
  }
  if (!p.codeChallenge || p.codeChallengeMethod !== 'S256') {
    return {
      kind: 'redirect',
      location: redirectWithError(p.redirectUri, 'invalid_request', p.state, 'PKCE S256 is required.'),
    };
  }
  // Resource indicator, if present, must be our MCP resource.
  if (p.resource && p.resource.replace(/\/$/, '') !== mcpResource(base)) {
    return {
      kind: 'redirect',
      location: redirectWithError(p.redirectUri, 'invalid_target', p.state, 'Unknown resource.'),
    };
  }

  const sessionUser = await currentSessionUser();
  if (!sessionUser) {
    const login = new URL(`${base.replace(/\/$/, '')}/auth/signin`);
    login.searchParams.set('callbackUrl', url.toString());
    return { kind: 'login', location: login.toString() };
  }

  // Already consented → issue a code immediately (no re-prompt).
  if (await hasActiveConsent(sessionUser.tenant, sessionUser.userId, client.clientId)) {
    const grantId = await upsertGrant({
      tenant: sessionUser.tenant,
      userId: sessionUser.userId,
      clientId: client.clientId,
      scope: p.scope ?? MCP_SCOPE,
      resource: mcpResource(base),
    });
    const code = await issueAuthCode({
      grantId,
      tenant: sessionUser.tenant,
      userId: sessionUser.userId,
      clientId: client.clientId,
      redirectUri: p.redirectUri,
      codeChallenge: p.codeChallenge,
      resource: mcpResource(base),
      scope: p.scope ?? MCP_SCOPE,
    });
    return { kind: 'redirect', location: redirectWithCode(p.redirectUri, code, p.state) };
  }

  return {
    kind: 'consent',
    clientId: client.clientId,
    clientName: client.clientName,
    signedRequest: signAuthRequest(p),
    tenant: sessionUser.tenant,
  };
}

// ---- Authorize (POST): apply the consent decision ---------------------------

export type AuthorizeDecision =
  | { kind: 'error'; status: number; message: string }
  | { kind: 'redirect'; location: string };

export async function completeAuthorize(
  base: string,
  signedRequest: string,
  approve: boolean,
): Promise<AuthorizeDecision> {
  const p = verifyAuthRequest(signedRequest);
  if (!p) return { kind: 'error', status: 400, message: 'Authorization request expired or invalid.' };

  let client: OAuthClient;
  try {
    client = await resolveClient(p.clientId);
  } catch {
    return { kind: 'error', status: 400, message: 'Unable to resolve client.' };
  }
  if (!validateRedirectUri(client, p.redirectUri)) {
    return { kind: 'error', status: 400, message: 'Invalid redirect_uri.' };
  }

  const sessionUser = await currentSessionUser();
  if (!sessionUser) return { kind: 'error', status: 401, message: 'Not authenticated.' };

  if (!approve) {
    return { kind: 'redirect', location: redirectWithError(p.redirectUri, 'access_denied', p.state) };
  }

  const grantId = await upsertGrant({
    tenant: sessionUser.tenant,
    userId: sessionUser.userId,
    clientId: client.clientId,
    scope: p.scope ?? MCP_SCOPE,
    resource: mcpResource(base),
  });
  const code = await issueAuthCode({
    grantId,
    tenant: sessionUser.tenant,
    userId: sessionUser.userId,
    clientId: client.clientId,
    redirectUri: p.redirectUri,
    codeChallenge: p.codeChallenge,
    resource: mcpResource(base),
    scope: p.scope ?? MCP_SCOPE,
  });
  return { kind: 'redirect', location: redirectWithCode(p.redirectUri, code, p.state) };
}

// ---- Token endpoint ---------------------------------------------------------

export interface TokenResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

export async function handleToken(base: string, form: URLSearchParams): Promise<TokenResult> {
  const grantType = form.get('grant_type');
  try {
    if (grantType === 'authorization_code') {
      const code = form.get('code') ?? '';
      const redirectUri = form.get('redirect_uri') ?? '';
      const clientId = form.get('client_id') ?? '';
      const codeVerifier = form.get('code_verifier') ?? '';
      if (!code || !redirectUri || !clientId || !codeVerifier) {
        return tokenError('invalid_request', 'Missing required parameters.');
      }
      const grant = await consumeAuthCode({ code, redirectUri, clientId, codeVerifier });
      return await issueTokens(base, grant);
    }
    if (grantType === 'refresh_token') {
      const refreshToken = form.get('refresh_token') ?? '';
      if (!refreshToken) return tokenError('invalid_request', 'Missing refresh_token.');
      const { grant, refreshToken: rotated } = await rotateRefreshToken(refreshToken);
      const access = await mintAccessToken({
        base,
        tenant: grant.tenant,
        userId: grant.userId,
        clientId: grant.clientId,
        grantId: grant.grantId,
        scope: grant.scope ?? MCP_SCOPE,
      });
      return tokenSuccess(access, rotated, grant.scope ?? MCP_SCOPE);
    }
    return tokenError('unsupported_grant_type', `Unsupported grant_type: ${grantType}`);
  } catch (e) {
    if (e instanceof OAuthGrantError) return tokenError(e.code, e.message);
    throw e;
  }
}

async function issueTokens(base: string, grant: {
  grantId: string; tenant: string; userId: string; clientId: string; scope: string | null;
}): Promise<TokenResult> {
  const access = await mintAccessToken({
    base,
    tenant: grant.tenant,
    userId: grant.userId,
    clientId: grant.clientId,
    grantId: grant.grantId,
    scope: grant.scope ?? MCP_SCOPE,
  });
  const refresh = await issueRefreshToken(grant.grantId, grant.tenant);
  return tokenSuccess(access, refresh, grant.scope ?? MCP_SCOPE);
}

function tokenSuccess(accessToken: string, refreshToken: string, scope: string): TokenResult {
  return {
    ok: true,
    status: 200,
    body: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope,
    },
  };
}

function tokenError(error: string, description: string): TokenResult {
  return { ok: false, status: 400, body: { error, error_description: description } };
}

// ---- Revocation (RFC 7009) --------------------------------------------------

export async function handleRevoke(form: URLSearchParams): Promise<void> {
  const token = form.get('token');
  if (token) await revokeByRefreshToken(token);
  // Always succeed (idempotent) per RFC 7009.
}
