import axios from 'axios';

/**
 * The Direct (GDAP) reachability probe, with no side effects of any kind: it
 * takes the access token to test as an argument rather than reading the secret
 * store, and it records nothing. Callers decide what to persist.
 *
 * This is the direct-path twin of probeCippCredentials, and it exists for the
 * same reason: the OAuth callback has to answer "does this token actually work"
 * *before* it writes tokens to the secret store or a `connected` row to
 * entra_partner_connections. A token exchange that succeeds only proves the
 * user signed in — not that the consented permissions let us read the managed
 * tenant list the whole integration is built on. Persisting first and
 * validating afterwards is what produced a row claiming `connected` on a
 * connection that could never sync.
 */

// LEVERAGE: pattern entra-connection-probe — second provider to hand-roll
// "pure probe + caller persists the verdict" (see cippProbe). A third provider
// wants a shared probe result type and a connect-then-record helper on the
// provider adapter, not a third copy of this file.

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

export type EntraDirectProbeResult =
  | {
      valid: true;
      checkedAt: string;
      managedTenantSampleCount: number;
      endpoint: string;
    }
  | {
      valid: false;
      checkedAt: string;
      error: string;
      code: 'auth_rejected' | 'consent_missing' | 'validation_failed';
      status?: number;
    };

/**
 * The endpoint whose readability defines a working Direct connection. Mirrors
 * directProviderAdapter.listManagedTenants, including its self-tenant smoke
 * mode — probing an endpoint the adapter will never call would validate the
 * wrong thing, and would fail every smoke tenant at connect time.
 */
export function entraDirectProbeEndpoint(): string {
  const isSelfTenantSmoke =
    (process.env.ENTRA_DIRECT_SMOKE_SELF_TENANT_MODE || '').toLowerCase() === 'true';

  return isSelfTenantSmoke
    ? `${GRAPH_BASE_URL}/organization?$top=1`
    : `${GRAPH_BASE_URL}/tenantRelationships/managedTenants/tenants?$top=1`;
}

export async function probeEntraDirectAccess(
  accessToken: string
): Promise<EntraDirectProbeResult> {
  const endpoint = entraDirectProbeEndpoint();

  try {
    const response = await axios.get(endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
    });

    const value = response.data?.value;

    return {
      valid: true,
      checkedAt: new Date().toISOString(),
      managedTenantSampleCount: Array.isArray(value) ? value.length : 0,
      endpoint,
    };
  } catch (error: unknown) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;

    if (status === 401) {
      return {
        valid: false,
        checkedAt: new Date().toISOString(),
        error: 'Microsoft rejected the access token for this connection.',
        code: 'auth_rejected',
        status,
      };
    }

    if (status === 403) {
      return {
        valid: false,
        checkedAt: new Date().toISOString(),
        error:
          'Microsoft accepted the sign-in but refused the managed tenant list. ' +
          'A Global Administrator must grant admin consent for the requested permissions.',
        code: 'consent_missing',
        status,
      };
    }

    return {
      valid: false,
      checkedAt: new Date().toISOString(),
      error: 'Unable to read the Microsoft Entra managed tenant list with this connection.',
      code: 'validation_failed',
      status,
    };
  }
}

/**
 * Narrowing helpers. ee/server compiles with `strict: false`, where a union
 * discriminated by a boolean literal does not narrow on `if (!probe.valid)`;
 * a user-defined type guard narrows in both modes without changing the result
 * shape that routes and tests mirror.
 */
export function isFailedEntraDirectProbe(
  probe: EntraDirectProbeResult
): probe is Extract<EntraDirectProbeResult, { valid: false }> {
  return probe.valid === false;
}

export function isSuccessfulEntraDirectProbe(
  probe: EntraDirectProbeResult
): probe is Extract<EntraDirectProbeResult, { valid: true }> {
  return probe.valid === true;
}
