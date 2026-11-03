import { createHash } from 'node:crypto';

/**
 * Mints short-lived OAuth access tokens for a CIPP API client.
 *
 * CIPP no longer issues static API keys. An operator creates an API client
 * (CIPP > Integrations > CIPP-API) and we exchange its client id + secret for a
 * bearer token via the client-credentials grant against the tenant that hosts
 * the client. Tokens live about an hour, so a long sync has to re-mint on its
 * own: proactively (the expiry skew) and reactively (the adapter's 401 retry
 * calls `invalidate`).
 *
 * The cache is deliberately in-process and is NEVER written through the secret
 * provider. Secret writes fail in the production temporal worker today, which
 * is exactly what breaks NinjaOne token refresh; a minted token is cheap to
 * re-mint and must not depend on a store we can't write.
 *
 * This file is mirrored verbatim into packages/ee (the CE stub tree): it is
 * self-contained on purpose, and imports nothing from the Entra tree.
 */

export interface CippApiClientTokenCredentials {
  clientId: string;
  clientSecret: string;
  directoryId: string;
}

/**
 * Whether a credential (stored, or a candidate being probed) is an API client.
 * Lives here, not in the secret store, so code that only needs the question
 * does not take a runtime dependency on the secret-provider module.
 */
export function isCippApiClientCredentials<T extends { authType?: string }>(
  credentials: T
): credentials is Extract<T, { authType: 'api_client' }> {
  return credentials.authType === 'api_client';
}

export type CippTokenErrorCode = 'token-mint-failed' | 'token-scope-rejected';

/** What went wrong, finely enough for diagnostics to word the remedy. */
export type CippTokenFailureCategory =
  | 'invalid_secret'
  | 'unknown_client'
  | 'tenant_not_found'
  | 'scope_rejected'
  | 'consent_required'
  | 'network'
  | 'malformed_response'
  | 'other';

/**
 * Thrown when a token cannot be minted. The message is written for the
 * operator and is safe to show: it only ever carries an AADSTS code and fixed
 * text, never the client secret, a token, or Microsoft's free-text description.
 */
export class CippTokenError extends Error {
  public readonly code: CippTokenErrorCode;
  public readonly category: CippTokenFailureCategory;
  public readonly aadstsCode: string | null;

  constructor(
    code: CippTokenErrorCode,
    category: CippTokenFailureCategory,
    message: string,
    aadstsCode: string | null = null
  ) {
    super(message);
    this.name = 'CippTokenError';
    this.code = code;
    this.category = category;
    this.aadstsCode = aadstsCode;
  }
}

export function isCippTokenError(error: unknown): error is CippTokenError {
  return (
    error instanceof Error
    && (error as { name?: string }).name === 'CippTokenError'
    && typeof (error as { code?: unknown }).code === 'string'
  );
}

export type CippFetch = (
  input: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string }
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export interface CippTokenServiceOptions {
  fetch?: CippFetch;
  /** Epoch milliseconds. */
  now?: () => number;
  /** A token this close to expiry is treated as expired. */
  skewMs?: number;
  /** Defaults to MICROSOFT_LOGIN_BASE_URL (the emulator hook), else Microsoft's. */
  authorityBaseUrl?: string;
}

export const CIPP_TOKEN_EXPIRY_SKEW_MS = 60_000;
const DEFAULT_AUTHORITY = 'https://login.microsoftonline.com';
const FALLBACK_EXPIRES_IN_SECONDS = 300;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The cache key. It carries a hash of the client id and secret rather than the
 * secret, so the raw secret is never a map key (and never shows up in a heap
 * dump of keys), and rotating the secret changes the key — the old token is
 * unreachable by construction instead of by an invalidation someone must
 * remember to call.
 */
export function cippTokenCacheKey(
  tenant: string,
  credentials: CippApiClientTokenCredentials
): string {
  const fingerprint = sha256Hex(
    `${credentials.clientId}\u0000${sha256Hex(credentials.clientSecret)}`
  );
  return `${tenant}|${credentials.directoryId}|${fingerprint}`;
}

const AADSTS_PATTERN = /AADSTS(\d{3,})/i;

function describe(code: string | null, oauthError: string | null): string {
  return code ?? (oauthError ? `OAuth error ${oauthError}` : 'no error code');
}

/** Turn Microsoft's token-endpoint failure into an operator-actionable error. */
export function classifyCippTokenFailure(input: {
  httpStatus: number | null;
  body: unknown;
}): CippTokenError {
  const body = (input.body && typeof input.body === 'object' ? input.body : {}) as Record<string, unknown>;
  const description = typeof body.error_description === 'string' ? body.error_description : '';
  const oauthError = typeof body.error === 'string' ? body.error : null;
  const codes = Array.isArray(body.error_codes) ? body.error_codes.map(String) : [];
  const fromDescription = description.match(AADSTS_PATTERN)?.[1];
  const numeric = fromDescription ?? codes[0] ?? null;
  const aadsts = numeric ? `AADSTS${numeric}` : null;

  switch (numeric) {
    case '7000215':
    case '7000222':
      return new CippTokenError(
        'token-mint-failed',
        'invalid_secret',
        `Microsoft rejected the client secret (${aadsts}). You may have pasted the secret ID instead of its Value, or the secret has expired. Create a new client secret in CIPP > Integrations > CIPP-API and paste its Value.`,
        aadsts
      );
    case '700016':
      return new CippTokenError(
        'token-mint-failed',
        'unknown_client',
        `Microsoft could not find this application in the directory (${aadsts}). Check the Application (client) ID and the Tenant (directory) ID.`,
        aadsts
      );
    case '90002':
    case '90023':
      return new CippTokenError(
        'token-mint-failed',
        'tenant_not_found',
        `Microsoft could not find the tenant (${aadsts}). Check the Tenant (directory) ID. A newly created tenant can take about 15 minutes to propagate.`,
        aadsts
      );
    case '500011':
    case '70011':
      return new CippTokenError(
        'token-scope-rejected',
        'scope_rejected',
        `Microsoft does not recognise the CIPP API scope for this client (${aadsts}). In CIPP > Integrations > CIPP-API, run Repair Identifier URI on this client, then try again.`,
        aadsts
      );
    case '65001':
    case '650051':
    case '650052':
    case '90094':
    case '90095':
      return new CippTokenError(
        'token-mint-failed',
        'consent_required',
        `Admin consent is needed for this CIPP API client (${aadsts}). A Global Administrator must grant admin consent to the client in the tenant that hosts it.`,
        aadsts
      );
    default:
      break;
  }

  if (oauthError === 'consent_required' || oauthError === 'interaction_required') {
    return new CippTokenError(
      'token-mint-failed',
      'consent_required',
      'Admin consent is needed for this CIPP API client. A Global Administrator must grant admin consent to the client in the tenant that hosts it.',
      aadsts
    );
  }

  return new CippTokenError(
    'token-mint-failed',
    'other',
    `Microsoft refused to issue a CIPP API token (${describe(aadsts, oauthError)}${input.httpStatus ? `, HTTP ${input.httpStatus}` : ''}). Check the client ID, client secret and tenant ID against CIPP > Integrations > CIPP-API.`,
    aadsts
  );
}

interface CacheEntry {
  token: string;
  expiresAt: number;
}

export class CippTokenService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly fetchImpl: CippFetch;
  private readonly now: () => number;
  private readonly skewMs: number;
  private readonly authorityOverride?: string;

  constructor(options: CippTokenServiceOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.skewMs = options.skewMs ?? CIPP_TOKEN_EXPIRY_SKEW_MS;
    this.authorityOverride = options.authorityBaseUrl;
  }

  /**
   * Mint a token with no caching. Used by the connect probe and diagnostics,
   * which must exercise the real exchange rather than a previous success.
   */
  public async mint(credentials: CippApiClientTokenCredentials): Promise<{ token: string; expiresAt: number }> {
    const authority = (
      this.authorityOverride
      ?? process.env.MICROSOFT_LOGIN_BASE_URL
      ?? DEFAULT_AUTHORITY
    ).replace(/\/+$/, '');
    const url = `${authority}/${encodeURIComponent(credentials.directoryId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      // The CIPP API client is its own resource: its identifier URI is
      // api://{clientId}. There is no separate Application ID field.
      scope: `api://${credentials.clientId}/.default`,
    }).toString();

    let response: Awaited<ReturnType<CippFetch>>;
    let text: string;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      text = await response.text();
    } catch {
      throw new CippTokenError(
        'token-mint-failed',
        'network',
        'Could not reach Microsoft sign-in to request a CIPP API token. Check outbound connectivity to login.microsoftonline.com; the sync will retry on its next run.'
      );
    }

    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      throw classifyCippTokenFailure({ httpStatus: response.status, body: parsed });
    }

    const payload = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
    const token = typeof payload.access_token === 'string' ? payload.access_token : '';
    if (!token) {
      throw new CippTokenError(
        'token-mint-failed',
        'malformed_response',
        'Microsoft answered the CIPP token request without an access token. Check the Tenant (directory) ID and try again.'
      );
    }

    const expiresIn = Number(payload.expires_in);
    const seconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : FALLBACK_EXPIRES_IN_SECONDS;
    return { token, expiresAt: this.now() + seconds * 1000 };
  }

  /**
   * A valid token for this credential: cached while it has more than the skew
   * left, otherwise minted. Concurrent callers for one key share one mint; a
   * failed mint is not cached, and every waiter sees the rejection.
   */
  public getToken(tenant: string, credentials: CippApiClientTokenCredentials): Promise<string> {
    const key = cippTokenCacheKey(tenant, credentials);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt - this.skewMs > this.now()) {
      return Promise.resolve(cached.token);
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      return pending;
    }

    const minting = this.mint(credentials)
      .then((minted) => {
        this.cache.set(key, minted);
        return minted.token;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, minting);
    return minting;
  }

  /**
   * Drop a cached token. Pass the token that was rejected so a late 401 from
   * an old request cannot evict the fresh token another caller just minted.
   */
  public invalidate(key: string, rejectedToken?: string): void {
    const cached = this.cache.get(key);
    if (!cached) return;
    if (rejectedToken !== undefined && cached.token !== rejectedToken) return;
    this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
  }
}

// LEVERAGE: pattern oauth-token-cache — in-process expiring token cache with
// single-flight mint; NinjaOne refresh does the same dance through the secret
// provider (which fails in the prod temporal worker). A shared layer would let
// both use this.
let defaultService: CippTokenService | null = null;

export function getCippTokenService(): CippTokenService {
  if (!defaultService) {
    defaultService = new CippTokenService();
  }
  return defaultService;
}

/** Test seam: swap or reset the process-wide service. */
export function setCippTokenServiceForTests(service: CippTokenService | null): void {
  defaultService = service;
}
