'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { generateMicrosoftAuthUrl, generateNonce } from '../../utils/email/oauthHelpers';

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

type RouteHandler = (request: Request) => Promise<Response>;

type EntraActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

type EntraRoutePayload<T> = {
  success?: boolean;
  data?: T;
  error?: string;
};

async function isEntraUiEnabledForTenant(params: {
  tenantId: string;
  userId?: string;
}): Promise<boolean> {
  const { featureFlags } = await import('server/src/lib/feature-flags/featureFlags');
  return featureFlags.isEnabled('entra-integration-ui', {
    tenantId: params.tenantId,
    userId: params.userId,
  });
}

function eeUnavailableResult<T>(): EntraActionResult<T> {
  return {
    success: false,
    error: 'Microsoft Entra integration is only available in Enterprise Edition.',
  };
}

function flagDisabledResult<T>(): EntraActionResult<T> {
  return {
    success: false,
    error: 'Microsoft Entra integration is disabled for this tenant.',
  };
}

async function callEeRoute<T>(params: {
  importPath: string;
  method: 'GET' | 'POST';
  body?: unknown;
}): Promise<EntraActionResult<T>> {
  if (!isEnterpriseEdition) {
    return eeUnavailableResult<T>();
  }

  try {
    const eeRouteModule = await import(params.importPath);
    const routeHandler = eeRouteModule[params.method] as RouteHandler | undefined;

    if (!routeHandler) {
      return eeUnavailableResult<T>();
    }

    const request = new Request(`https://localhost/internal/entra${params.importPath}`, {
      method: params.method,
      headers: { 'content-type': 'application/json' },
      body: params.body === undefined ? undefined : JSON.stringify(params.body),
    });

    const response = await routeHandler(request);
    const payload = (await response.json().catch(() => null)) as EntraRoutePayload<T> | null;

    if (payload?.success === true) {
      return {
        success: true,
        data: (payload.data ?? null) as T,
      };
    }

    const fallbackError =
      payload?.error || `Entra route failed with status ${response.status}`;

    return {
      success: false,
      error: fallbackError,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to call Entra route',
    };
  }
}

export type EntraConnectionType = 'direct' | 'cipp';
export type EntraSyncScope = 'initial' | 'all-tenants' | 'single-client';
export type EntraDirectConnectState = {
  tenant: string;
  userId: string;
  nonce: string;
  timestamp: number;
  redirectUri: string;
  provider: 'microsoft';
  integration: 'entra';
  connectionType: 'direct';
};

export type EntraStatusResponse = {
  status: 'connected' | 'not_connected';
  connectionType: EntraConnectionType | null;
  lastDiscoveryAt: string | null;
  mappedTenantCount: number;
  availableConnectionTypes: EntraConnectionType[];
};

export type EntraMappingPreviewResponse = {
  autoMatched: unknown[];
  fuzzyCandidates: unknown[];
  unmatched: unknown[];
};

export const initiateEntraDirectOAuth = withAuth(async (user, { tenant }) => {
  const canUpdate = await hasPermission(user as any, 'system_settings', 'update');
  if (!canUpdate) {
    return { success: false, error: 'Forbidden: insufficient permissions to configure Entra integration' } as const;
  }

  const enabled = await isEntraUiEnabledForTenant({
    tenantId: tenant,
    userId: (user as { user_id?: string } | undefined)?.user_id,
  });
  if (!enabled) {
    return flagDisabledResult<{ authUrl: string; state: string }>();
  }

  const resolverModule = await import('@enterprise/lib/integrations/entra/auth/microsoftCredentialResolver');
  const credentials = await resolverModule.resolveMicrosoftCredentialsForTenant(tenant);
  if (!credentials) {
    return { success: false, error: 'Microsoft OAuth credentials are not configured for Entra direct connection' } as const;
  }

  const secretProvider = await getSecretProviderInstance();
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) ||
    process.env.NEXTAUTH_URL ||
    (await secretProvider.getAppSecret('NEXTAUTH_URL')) ||
    'http://localhost:3000';

  const redirectUri = `${baseUrl.replace(/\/+$/, '')}/api/auth/microsoft/entra/callback`;
  const statePayload: EntraDirectConnectState = {
    tenant,
    userId: String((user as { user_id?: string } | undefined)?.user_id || ''),
    nonce: generateNonce(),
    timestamp: Date.now(),
    redirectUri,
    provider: 'microsoft',
    integration: 'entra',
    connectionType: 'direct',
  };

  const authUrl = generateMicrosoftAuthUrl(
    credentials.clientId,
    redirectUri,
    statePayload as any,
    ['https://graph.microsoft.com/User.Read', 'offline_access'],
    'common'
  );

  return {
    success: true,
    data: {
      authUrl,
      state: Buffer.from(JSON.stringify(statePayload)).toString('base64'),
    },
  } as const;
});

export const getEntraIntegrationStatus = withAuth(async (user, { tenant }) => {
  const enabled = await isEntraUiEnabledForTenant({
    tenantId: tenant,
    userId: (user as { user_id?: string } | undefined)?.user_id,
  });

  if (!enabled) {
    return flagDisabledResult<EntraStatusResponse>();
  }

  return callEeRoute<EntraStatusResponse>({
    importPath: '@enterprise/app/api/integrations/entra/route',
    method: 'GET',
  });
});

export const connectEntraIntegration = withAuth(async (
  user,
  { tenant },
  input: { connectionType: EntraConnectionType }
) => {
  const enabled = await isEntraUiEnabledForTenant({
    tenantId: tenant,
    userId: (user as { user_id?: string } | undefined)?.user_id,
  });
  if (!enabled) {
    return flagDisabledResult<{ status: string; connectionType: EntraConnectionType }>();
  }

  return callEeRoute<{ status: string; connectionType: EntraConnectionType }>({
    importPath: '@enterprise/app/api/integrations/entra/connect/route',
    method: 'POST',
    body: input,
  });
});

export const disconnectEntraIntegration = withAuth(async (user, { tenant }) => {
  const enabled = await isEntraUiEnabledForTenant({
    tenantId: tenant,
    userId: (user as { user_id?: string } | undefined)?.user_id,
  });
  if (!enabled) {
    return flagDisabledResult<{ status: string }>();
  }

  return callEeRoute<{ status: string }>({
    importPath: '@enterprise/app/api/integrations/entra/disconnect/route',
    method: 'POST',
  });
});

export const discoverEntraManagedTenants = withAuth(async (user, { tenant }) => {
  const enabled = await isEntraUiEnabledForTenant({
    tenantId: tenant,
    userId: (user as { user_id?: string } | undefined)?.user_id,
  });
  if (!enabled) {
    return flagDisabledResult<{ discoveredTenantCount: number; discoveredTenants: unknown[] }>();
  }

  return callEeRoute<{ discoveredTenantCount: number; discoveredTenants: unknown[] }>({
    importPath: '@enterprise/app/api/integrations/entra/discovery/route',
    method: 'POST',
  });
});

export const getEntraMappingPreview = withAuth(async (user, { tenant }) => {
  const enabled = await isEntraUiEnabledForTenant({
    tenantId: tenant,
    userId: (user as { user_id?: string } | undefined)?.user_id,
  });
  if (!enabled) {
    return flagDisabledResult<EntraMappingPreviewResponse>();
  }

  return callEeRoute<EntraMappingPreviewResponse>({
    importPath: '@enterprise/app/api/integrations/entra/mappings/preview/route',
    method: 'GET',
  });
});

export const confirmEntraMappings = withAuth(async (
  user,
  { tenant },
  input: { mappings: Array<Record<string, unknown>> }
) => {
  const enabled = await isEntraUiEnabledForTenant({
    tenantId: tenant,
    userId: (user as { user_id?: string } | undefined)?.user_id,
  });
  if (!enabled) {
    return flagDisabledResult<{ confirmedMappings: number }>();
  }

  return callEeRoute<{ confirmedMappings: number }>({
    importPath: '@enterprise/app/api/integrations/entra/mappings/confirm/route',
    method: 'POST',
    body: input,
  });
});

export const startEntraSync = withAuth(async (
  user,
  { tenant },
  input: { scope: EntraSyncScope; clientId?: string }
) => {
  const enabled = await isEntraUiEnabledForTenant({
    tenantId: tenant,
    userId: (user as { user_id?: string } | undefined)?.user_id,
  });
  if (!enabled) {
    return flagDisabledResult<{ accepted: boolean; scope: EntraSyncScope; runId: string | null }>();
  }

  return callEeRoute<{ accepted: boolean; scope: EntraSyncScope; runId: string | null }>({
    importPath: '@enterprise/app/api/integrations/entra/sync/route',
    method: 'POST',
    body: input,
  });
});
