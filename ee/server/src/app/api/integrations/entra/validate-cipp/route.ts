import axios from 'axios';
import { badRequest, dynamic, ok, runtime } from '../_responses';
import { requireEntraUiFlagEnabled } from '../_guards';
import { getEntraCippCredentials } from '@/lib/integrations/entra/providers/cipp/cippSecretStore';

export { dynamic, runtime };

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

export async function POST(): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled();
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const credentials = await getEntraCippCredentials(flagGate.tenantId);
  if (!credentials) {
    return badRequest('CIPP credentials are not configured.');
  }

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
        return ok({
          valid: true,
          checkedAt: new Date().toISOString(),
          tenantCountSample: tenantCount,
          endpoint: url,
        });
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
          return badRequest('CIPP credentials were rejected by the remote API.');
        }

        lastError = error.message;
        continue;
      }

      lastError = error instanceof Error ? error.message : 'Unknown CIPP validation error.';
    }
  }

  return badRequest(lastError || 'Unable to validate CIPP tenant list access.');
}
