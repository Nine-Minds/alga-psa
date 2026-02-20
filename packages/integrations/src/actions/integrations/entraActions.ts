'use server';

import { withAuth } from '@alga-psa/auth';

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

function eeUnavailableResult<T>(): EntraActionResult<T> {
  return {
    success: false,
    error: 'Microsoft Entra integration is only available in Enterprise Edition.',
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

export const getEntraIntegrationStatus = withAuth(async () => {
  return callEeRoute<EntraStatusResponse>({
    importPath: '@enterprise/app/api/integrations/entra/route',
    method: 'GET',
  });
});

export const connectEntraIntegration = withAuth(async (
  _user,
  _session,
  input: { connectionType: EntraConnectionType }
) => {
  return callEeRoute<{ status: string; connectionType: EntraConnectionType }>({
    importPath: '@enterprise/app/api/integrations/entra/connect/route',
    method: 'POST',
    body: input,
  });
});

export const disconnectEntraIntegration = withAuth(async () => {
  return callEeRoute<{ status: string }>({
    importPath: '@enterprise/app/api/integrations/entra/disconnect/route',
    method: 'POST',
  });
});

export const discoverEntraManagedTenants = withAuth(async () => {
  return callEeRoute<{ discoveredTenantCount: number; discoveredTenants: unknown[] }>({
    importPath: '@enterprise/app/api/integrations/entra/discovery/route',
    method: 'POST',
  });
});

export const getEntraMappingPreview = withAuth(async () => {
  return callEeRoute<EntraMappingPreviewResponse>({
    importPath: '@enterprise/app/api/integrations/entra/mappings/preview/route',
    method: 'GET',
  });
});

export const confirmEntraMappings = withAuth(async (
  _user,
  _session,
  input: { mappings: Array<Record<string, unknown>> }
) => {
  return callEeRoute<{ confirmedMappings: number }>({
    importPath: '@enterprise/app/api/integrations/entra/mappings/confirm/route',
    method: 'POST',
    body: input,
  });
});

export const startEntraSync = withAuth(async (
  _user,
  _session,
  input: { scope: EntraSyncScope; clientId?: string }
) => {
  return callEeRoute<{ accepted: boolean; scope: EntraSyncScope; runId: string | null }>({
    importPath: '@enterprise/app/api/integrations/entra/sync/route',
    method: 'POST',
    body: input,
  });
});
