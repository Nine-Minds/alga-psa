'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { routes } from '@alga-psa/integrations/entra/routes/entry';
import type {
  EntraClientAccessDiagnosticsInput,
  EntraClientDiagnosticsContinuation,
  EntraDiagnosticsReport,
} from '@alga-psa/types';

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

type RouteHandler = (request: Request) => Promise<Response>;

type EntraDiagnosticsResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

type EntraRoutePayload<T> = {
  success?: boolean;
  data?: T;
  error?: string;
};

function isClientPortalUser(user: unknown): boolean {
  const candidate = user as { user_type?: string; userType?: string } | undefined;
  return candidate?.user_type === 'client' || candidate?.userType === 'client';
}

function eeUnavailableResult<T>(): EntraDiagnosticsResult<T> {
  return {
    success: false,
    error: 'Microsoft Entra integration is only available in Enterprise Edition.',
  };
}

function entraRouteStatusError(status: number): string {
  if (status === 401 || status === 403) {
    return 'Permission denied: Cannot view Microsoft Entra diagnostics.';
  }
  if (status === 404) {
    return 'Microsoft Entra diagnostics are not available.';
  }
  return 'Microsoft Entra diagnostics failed.';
}

async function callEeRoute<T>(params: {
  importFn: any;
  method: 'GET' | 'POST';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}): Promise<EntraDiagnosticsResult<T>> {
  if (!isEnterpriseEdition) {
    return eeUnavailableResult<T>();
  }

  try {
    const eeRouteModule =
      typeof params.importFn === 'function' ? await params.importFn() : params.importFn;

    if (!eeRouteModule) {
      return eeUnavailableResult<T>();
    }

    const routeHandler = eeRouteModule[params.method] as RouteHandler | undefined;
    if (!routeHandler) {
      return eeUnavailableResult<T>();
    }

    const url = new URL('https://localhost/internal/entra/ee-route');
    if (params.query) {
      for (const [key, value] of Object.entries(params.query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }

    const request = new Request(url.toString(), {
      method: params.method,
      headers: { 'content-type': 'application/json' },
      body: params.body === undefined ? undefined : JSON.stringify(params.body),
    });

    const response = await routeHandler(request);
    const payload = (await response.json().catch(() => null)) as EntraRoutePayload<T> | null;

    if (payload?.success === true) {
      return { success: true, data: (payload.data ?? null) as T };
    }

    return {
      success: false,
      error: payload?.error || entraRouteStatusError(response.status),
    };
  } catch {
    return { success: false, error: 'Microsoft Entra diagnostics failed. Please try again.' };
  }
}

export const runEntraConnectionDiagnostics = withAuth(async (user) => {
  if (isClientPortalUser(user)) {
    return { success: false, error: 'Forbidden' } as const;
  }
  const canRead = await hasPermission(user as any, 'system_settings', 'read');
  if (!canRead) {
    return {
      success: false,
      error: 'Forbidden: insufficient permissions to view Entra diagnostics',
    } as const;
  }
  return callEeRoute<EntraDiagnosticsReport>({
    importFn: routes.diagnosticsRoute,
    method: 'GET',
    query: { includeIdentifiers: true },
  });
});

export const runEntraClientAccessDiagnostics = withAuth(
  async (
    user,
    { tenant },
    input: EntraClientAccessDiagnosticsInput & { continuation?: string } = {}
  ) => {
    void tenant;
    if (isClientPortalUser(user)) {
      return { success: false, error: 'Forbidden' } as const;
    }
    const canRead = await hasPermission(user as any, 'system_settings', 'read');
    if (!canRead) {
      return {
        success: false,
        error: 'Forbidden: insufficient permissions to view Entra diagnostics',
      } as const;
    }

    const clientIds = Array.isArray(input.clientIds) ? input.clientIds : undefined;
    const body = {
      clientIds,
      includeUserYield: input.includeUserYield === true,
      continuation: input.continuation,
    };

    return callEeRoute<EntraClientDiagnosticsContinuation>({
      importFn: routes.clientDiagnosticsRoute,
      method: 'POST',
      body,
    });
  }
);

export type { EntraDiagnosticsResult };
