import axios from 'axios';
import { getCippTokenService, isCippTokenError } from './cippTokenService';
import {
  cippApiClientRejectedMessage,
  cippHtmlResponseMessage,
  cippListTenantsForbiddenMessage,
  cippRoleBlockedMessage,
  cippUnreachableMessage,
  classifyCippTransportError,
  looksLikeHtml,
  type CippTransportCause,
} from './cippFailureMessages';

/**
 * The CIPP reachability probe, with no side effects of any kind: it takes the
 * credentials to test as an argument rather than reading the secret store, and
 * it records nothing. Callers decide what to persist.
 *
 * This is what lets connectEntraCipp validate a candidate credential *before*
 * touching the secret store or the connection row: the probe cannot stage a
 * credential or mark an existing connection validation_failed on the way past.
 */

export type CippProbeLegacyCredentials = {
  /** Optional: callers that predate API clients send only baseUrl + apiToken. */
  authType?: 'legacy_api_token';
  baseUrl: string;
  apiToken: string;
};

export type CippProbeApiClientCredentials = {
  authType: 'api_client';
  /** The CIPP-API host without the trailing /api; request paths add it. */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  directoryId: string;
};

export type CippProbeCredentials =
  | CippProbeLegacyCredentials
  | CippProbeApiClientCredentials;

export type CippProbeResult =
  | {
      valid: true;
      checkedAt: string;
      tenantCountSample: number;
      endpoint: string;
    }
  | {
      valid: false;
      checkedAt: string;
      error: string;
      code:
        | 'auth_rejected'
        | 'validation_failed'
        // API-client connections only:
        | 'token_mint_failed'
        | 'token_scope_rejected'
        | 'ip_blocked'
        | 'role_blocked'
        | 'html_response'
        // Any connection: no HTTP answer at all.
        | 'unreachable';
      /** Set with `unreachable`: what stopped the request. */
      cause?: CippTransportCause;
    };

function buildCandidateUrls(baseUrl: string): string[] {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return [
    `${normalizedBase}/api/listtenants`,
    `${normalizedBase}/api/tenant/list`,
    `${normalizedBase}/api/tenants`,
  ];
}

function extractTenantRows(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.tenants)) return obj.tenants;
  if (Array.isArray(obj.value)) return obj.value;
  return null;
}

/** A `tenantFilter` value for one managed tenant, as sync sends it. */
function firstTenantFilter(payload: unknown): string | null {
  for (const row of extractTenantRows(payload) ?? []) {
    if (!row || typeof row !== 'object') continue;
    const raw = row as Record<string, unknown>;
    for (const key of ['customerId', 'tenantId', 'id', 'customerTenantId', 'defaultDomainName']) {
      const value = raw[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Sync reads users with listusers, and a CIPP Custom Role can allow
 * listtenants while blocking it. Without this the test passes and the first
 * sync fails. Only a refusal is a verdict; any other failure (a tenant-side
 * error, a slow tenant) is left for sync to report.
 */
async function probeListUsers(
  baseUrl: string,
  payload: unknown,
  headers: Record<string, string>
): Promise<Extract<CippProbeResult, { valid: false }> | null> {
  const tenantFilter = firstTenantFilter(payload);
  if (!tenantFilter) return null;
  const url = `${baseUrl.replace(/\/+$/, '')}/api/listusers?tenantFilter=${encodeURIComponent(tenantFilter)}`;
  try {
    await axios.get(url, { timeout: 15000, headers });
    return null;
  } catch (error: unknown) {
    if (!axios.isAxiosError(error)) return null;
    const status = error.response?.status;
    if (status === 403) {
      return {
        valid: false,
        checkedAt: new Date().toISOString(),
        error: cippRoleBlockedMessage('listusers'),
        code: 'role_blocked',
      };
    }
    if (status === 401) {
      return {
        valid: false,
        checkedAt: new Date().toISOString(),
        error: cippApiClientRejectedMessage(),
        code: 'auth_rejected',
      };
    }
    return null;
  }
}

function extractTenantCount(payload: unknown): number | null {
  if (Array.isArray(payload)) {
    return payload.length;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.data)) {
    return obj.data.length;
  }
  if (Array.isArray(obj.tenants)) {
    return obj.tenants.length;
  }
  if (Array.isArray(obj.value)) {
    return obj.value.length;
  }

  return null;
}

export async function probeCippCredentials(
  credentials: CippProbeCredentials
): Promise<CippProbeResult> {
  const candidateUrls = buildCandidateUrls(credentials.baseUrl);
  let lastError: string | null = null;

  // Mint uncached: the probe has to prove the exchange works right now, not
  // that some earlier token is still warm. Legacy keeps its exact headers.
  let headers: Record<string, string>;
  const isApiClient = credentials.authType === 'api_client';
  if (credentials.authType === 'api_client') {
    try {
      const { token } = await getCippTokenService().mint(credentials);
      headers = { Authorization: `Bearer ${token}` };
    } catch (error: unknown) {
      if (isCippTokenError(error)) {
        return {
          valid: false,
          checkedAt: new Date().toISOString(),
          error: error.message,
          code: error.code === 'token-scope-rejected' ? 'token_scope_rejected' : 'token_mint_failed',
        };
      }
      throw error;
    }
  } else {
    headers = {
      Authorization: `Bearer ${credentials.apiToken}`,
      'X-API-KEY': credentials.apiToken,
    };
  }

  for (const url of candidateUrls) {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers,
      });

      if (isApiClient && looksLikeHtml(response.headers?.['content-type'], response.data)) {
        return {
          valid: false,
          checkedAt: new Date().toISOString(),
          error: cippHtmlResponseMessage(),
          code: 'html_response',
        };
      }

      const tenantCount = extractTenantCount(response.data);
      if (tenantCount !== null) {
        if (isApiClient) {
          const refused = await probeListUsers(credentials.baseUrl, response.data, headers);
          if (refused) return refused;
        }
        return {
          valid: true,
          checkedAt: new Date().toISOString(),
          tenantCountSample: tenantCount,
          endpoint: url,
        };
      }

      lastError = 'CIPP response did not include a recognizable tenant list payload.';
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (
          isApiClient
          && looksLikeHtml(error.response?.headers?.['content-type'], error.response?.data)
        ) {
          return {
            valid: false,
            checkedAt: new Date().toISOString(),
            error: cippHtmlResponseMessage(),
            code: 'html_response',
          };
        }

        if (!error.response) {
          // No HTTP answer: every candidate path is on the same host, so
          // trying the others only multiplies the wait. Say why it failed.
          const cause = classifyCippTransportError(error.code ?? (error.cause as { code?: string } | undefined)?.code);
          return {
            valid: false,
            checkedAt: new Date().toISOString(),
            error: cippUnreachableMessage(hostOf(url), cause),
            code: 'unreachable',
            cause,
          };
        }

        if (status === 404) {
          lastError = `CIPP endpoint not found at ${url}`;
          continue;
        }

        if (isApiClient && status === 403) {
          return {
            valid: false,
            checkedAt: new Date().toISOString(),
            error: cippListTenantsForbiddenMessage(),
            code: 'ip_blocked',
          };
        }

        if (isApiClient && status === 401) {
          return {
            valid: false,
            checkedAt: new Date().toISOString(),
            error: cippApiClientRejectedMessage(),
            code: 'auth_rejected',
          };
        }

        if (status === 401 || status === 403) {
          return {
            valid: false,
            checkedAt: new Date().toISOString(),
            error: 'CIPP credentials were rejected by the remote API.',
            code: 'auth_rejected',
          };
        }

        lastError = 'CIPP validation request failed.';
        continue;
      }

      lastError = 'CIPP validation request failed.';
    }
  }

  return {
    valid: false,
    checkedAt: new Date().toISOString(),
    error: lastError || 'Unable to validate CIPP tenant list access.',
    code: 'validation_failed',
  };
}

/**
 * Narrowing helpers.
 *
 * ee/server compiles with `strict: false`, and without strictNullChecks a union
 * discriminated by a boolean literal does not narrow on `if (!probe.valid)` —
 * every field of the failure arm reads as a type error. A user-defined type
 * guard narrows in both modes, and keeps the result shape (which tests and
 * route payloads mirror) unchanged.
 */
export function isFailedCippProbe(
  probe: CippProbeResult
): probe is Extract<CippProbeResult, { valid: false }> {
  return probe.valid === false;
}

export function isSuccessfulCippProbe(
  probe: CippProbeResult
): probe is Extract<CippProbeResult, { valid: true }> {
  return probe.valid === true;
}
