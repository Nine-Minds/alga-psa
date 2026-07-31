import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { badRequest, dynamic, ok, runtime } from '../_responses';
import { requireEntraAccess } from '../_guards';
import { resolveMicrosoftCredentialsForTenant } from '@ee/lib/integrations/entra/auth/microsoftCredentialResolver';
import { refreshEntraDirectToken } from '@ee/lib/integrations/entra/auth/refreshDirectToken';
import { ENTRA_DIRECT_SECRET_KEYS } from '@ee/lib/integrations/entra/secrets';
import { updateEntraConnectionValidation } from '@ee/lib/integrations/entra/connectionRepository';
import {
  isFailedEntraDirectProbe,
  probeEntraDirectAccess,
} from '@ee/lib/integrations/entra/providers/direct/directProbe';

export { dynamic, runtime };

export async function POST(): Promise<Response> {
  const accessGate = await requireEntraAccess('update');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const { tenantId } = accessGate;
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

  // Unlike the connect path, this route is the explicit "Validate" action: the
  // probe stays side-effect free and the route owns persisting its verdict onto
  // the active connection.
  let probe = await probeEntraDirectAccess(accessToken);

  if (isFailedEntraDirectProbe(probe) && probe.code === 'auth_rejected') {
    try {
      const refreshed = await refreshEntraDirectToken(tenantId);
      probe = await probeEntraDirectAccess(refreshed.accessToken);
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

    if (isFailedEntraDirectProbe(probe)) {
      await updateEntraConnectionValidation({
        tenant: tenantId,
        connectionType: 'direct',
        status: 'validation_failed',
        snapshot: {
          message: 'Direct Entra validation failed after token refresh.',
          code: 'post_refresh_validation_failed',
          checkedAt: probe.checkedAt,
        },
      });
      return badRequest('Direct Entra validation failed after token refresh.');
    }
  }

  if (isFailedEntraDirectProbe(probe)) {
    await updateEntraConnectionValidation({
      tenant: tenantId,
      connectionType: 'direct',
      status: 'validation_failed',
      snapshot: {
        message: probe.error,
        code: 'upstream_error',
        checkedAt: probe.checkedAt,
      },
    });
    return new Response(
      JSON.stringify({
        success: false,
        error: probe.error,
      }),
      {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }
    );
  }

  await updateEntraConnectionValidation({
    tenant: tenantId,
    connectionType: 'direct',
    status: 'connected',
    snapshot: null,
  });

  return ok({
    valid: true,
    checkedAt: probe.checkedAt,
    managedTenantSampleCount: probe.managedTenantSampleCount,
  });
}
