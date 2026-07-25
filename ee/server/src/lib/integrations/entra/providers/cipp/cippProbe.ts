import axios from 'axios';

/**
 * The CIPP reachability probe, with no side effects of any kind: it takes the
 * credentials to test as an argument rather than reading the secret store, and
 * it records nothing. Callers decide what to persist.
 *
 * This is what lets connectEntraCipp validate a candidate credential *before*
 * touching the secret store or the connection row: the probe cannot stage a
 * credential or mark an existing connection validation_failed on the way past.
 */

export type CippProbeCredentials = {
  baseUrl: string;
  apiToken: string;
};

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
      code: 'auth_rejected' | 'validation_failed';
    };

function buildCandidateUrls(baseUrl: string): string[] {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return [
    `${normalizedBase}/api/listtenants`,
    `${normalizedBase}/api/tenant/list`,
    `${normalizedBase}/api/tenants`,
  ];
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

  for (const url of candidateUrls) {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${credentials.apiToken}`,
          'X-API-KEY': credentials.apiToken,
        },
      });

      const tenantCount = extractTenantCount(response.data);
      if (tenantCount !== null) {
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
        if (status === 404) {
          lastError = `CIPP endpoint not found at ${url}`;
          continue;
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
