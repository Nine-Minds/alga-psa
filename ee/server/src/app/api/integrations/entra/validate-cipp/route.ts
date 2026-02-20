import axios from 'axios';
import { badRequest, dynamic, ok, runtime } from '../_responses';
import { requireEntraUiFlagEnabled } from '../_guards';
import { getEntraCippCredentials } from '@/lib/integrations/entra/providers/cipp/cippSecretStore';
import { updateEntraConnectionValidation } from '@/lib/integrations/entra/connectionRepository';

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
    await updateEntraConnectionValidation({
      tenant: flagGate.tenantId,
      connectionType: 'cipp',
      status: 'validation_failed',
      snapshot: {
        message: 'CIPP credentials are not configured.',
        code: 'missing_credentials',
        checkedAt: new Date().toISOString(),
      },
    });
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
        await updateEntraConnectionValidation({
          tenant: flagGate.tenantId,
          connectionType: 'cipp',
          status: 'connected',
          snapshot: null,
        });
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
          await updateEntraConnectionValidation({
            tenant: flagGate.tenantId,
            connectionType: 'cipp',
            status: 'validation_failed',
            snapshot: {
              message: 'CIPP credentials were rejected by the remote API.',
              code: 'auth_rejected',
              checkedAt: new Date().toISOString(),
            },
          });
          return badRequest('CIPP credentials were rejected by the remote API.');
        }

        lastError = error.message;
        continue;
      }

      lastError = error instanceof Error ? error.message : 'Unknown CIPP validation error.';
    }
  }

  await updateEntraConnectionValidation({
    tenant: flagGate.tenantId,
    connectionType: 'cipp',
    status: 'validation_failed',
    snapshot: {
      message: lastError || 'Unable to validate CIPP tenant list access.',
      code: 'validation_failed',
      checkedAt: new Date().toISOString(),
    },
  });
  return badRequest(lastError || 'Unable to validate CIPP tenant list access.');
}
