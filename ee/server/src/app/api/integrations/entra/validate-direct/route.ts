import axios from 'axios';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { badRequest, dynamic, ok, runtime } from '../_responses';
import { requireEntraUiFlagEnabled } from '../_guards';
import { resolveMicrosoftCredentialsForTenant } from '@/lib/integrations/entra/auth/microsoftCredentialResolver';
import { refreshEntraDirectToken } from '@/lib/integrations/entra/auth/refreshDirectToken';
import { ENTRA_DIRECT_SECRET_KEYS } from '@/lib/integrations/entra/secrets';
import { updateEntraConnectionValidation } from '@/lib/integrations/entra/connectionRepository';

export { dynamic, runtime };

async function listManagedTenants(accessToken: string): Promise<number> {
  const response = await axios.get(
    'https://graph.microsoft.com/v1.0/tenantRelationships/managedTenants/tenants?$top=1',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
    }
  );

  const value = response.data?.value;
  return Array.isArray(value) ? value.length : 0;
}

export async function POST(): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled('update');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const { tenantId } = flagGate;
  const credentials = await resolveMicrosoftCredentialsForTenant(tenantId);
  if (!credentials) {
    await updateEntraConnectionValidation({
      tenant: tenantId,
      connectionType: 'direct',
      status: 'validation_failed',
      snapshot: {
        message: 'Microsoft OAuth credentials are not configured for direct Entra connection.',
        code: 'missing_credentials',
        checkedAt: new Date().toISOString(),
      },
    });
    return badRequest('Microsoft OAuth credentials are not configured for direct Entra connection.');
  }

  const secretProvider = await getSecretProviderInstance();
  let accessToken = await secretProvider.getTenantSecret(
    tenantId,
    ENTRA_DIRECT_SECRET_KEYS.accessToken
  );
  const tokenExpiresAtRaw = await secretProvider.getTenantSecret(
    tenantId,
    ENTRA_DIRECT_SECRET_KEYS.tokenExpiresAt
  );

  const tokenExpiresAt = tokenExpiresAtRaw ? Date.parse(tokenExpiresAtRaw) : NaN;
  const isExpired = Number.isFinite(tokenExpiresAt) && tokenExpiresAt <= Date.now() + 30_000;

  if (!accessToken || isExpired) {
    try {
      const refreshed = await refreshEntraDirectToken(tenantId);
      accessToken = refreshed.accessToken;
    } catch {
      await updateEntraConnectionValidation({
        tenant: tenantId,
        connectionType: 'direct',
        status: 'validation_failed',
        snapshot: {
          message: 'Direct Entra token is not configured or refresh failed.',
          code: 'refresh_failed',
          checkedAt: new Date().toISOString(),
        },
      });
      return badRequest('Direct Entra token is not configured or refresh failed.');
    }
  }

  if (!accessToken) {
    await updateEntraConnectionValidation({
      tenant: tenantId,
      connectionType: 'direct',
      status: 'validation_failed',
      snapshot: {
        message: 'Direct Entra token is not configured.',
        code: 'missing_access_token',
        checkedAt: new Date().toISOString(),
      },
    });
    return badRequest('Direct Entra token is not configured.');
  }

  try {
    const managedTenantSampleCount = await listManagedTenants(accessToken);
    await updateEntraConnectionValidation({
      tenant: tenantId,
      connectionType: 'direct',
      status: 'connected',
      snapshot: null,
    });
    return ok({
      valid: true,
      checkedAt: new Date().toISOString(),
      managedTenantSampleCount,
    });
  } catch (error: unknown) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;

    if (status === 401) {
      try {
        const refreshed = await refreshEntraDirectToken(tenantId);
        const managedTenantSampleCount = await listManagedTenants(refreshed.accessToken);
        await updateEntraConnectionValidation({
          tenant: tenantId,
          connectionType: 'direct',
          status: 'connected',
          snapshot: null,
        });
        return ok({
          valid: true,
          checkedAt: new Date().toISOString(),
          managedTenantSampleCount,
        });
      } catch {
        await updateEntraConnectionValidation({
          tenant: tenantId,
          connectionType: 'direct',
          status: 'validation_failed',
          snapshot: {
            message: 'Direct Entra validation failed after token refresh.',
            code: 'post_refresh_validation_failed',
            checkedAt: new Date().toISOString(),
          },
        });
        return badRequest('Direct Entra validation failed after token refresh.');
      }
    }

    const message = error instanceof Error ? error.message : 'Direct Entra validation failed.';
    await updateEntraConnectionValidation({
      tenant: tenantId,
      connectionType: 'direct',
      status: 'validation_failed',
      snapshot: {
        message,
        code: 'upstream_error',
        checkedAt: new Date().toISOString(),
      },
    });
    return new Response(
      JSON.stringify({
        success: false,
        error: message,
      }),
      {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }
    );
  }
}
