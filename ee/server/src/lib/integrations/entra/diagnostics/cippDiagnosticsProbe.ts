import axios from 'axios';

export interface CippDiagnosticsTenant {
  entraTenantId: string;
  displayName: string | null;
}

export interface CippProbeDetail {
  reachable: boolean;
  authRejected: boolean;
  endpoint: string | null;
  attempted: string[];
  status?: number;
  networkCode?: string;
  error?: string;
  tenantCount: number;
  tenants: CippDiagnosticsTenant[];
}

/**
 * Read-only CIPP probe with preserved HTTP/network detail. Mirrors the
 * production probe's candidate order and fallback (404 → next, 401/403 stop)
 * while keeping the discriminating evidence the diagnostics report needs.
 */
export async function probeCippWithDetail(credentials: {
  baseUrl: string;
  apiToken: string;
}): Promise<CippProbeDetail> {
  const base = credentials.baseUrl.replace(/\/+$/, '');
  const candidates = ['/api/listtenants', '/api/tenant/list', '/api/tenants'];
  const attempted: string[] = [];

  let lastError: unknown = null;
  let sawHttpResponse = false;

  for (const candidate of candidates) {
    const url = `${base}${candidate}`;
    attempted.push(url);
    try {
      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${credentials.apiToken}`,
          'X-API-KEY': credentials.apiToken,
        },
        timeout: 15000,
      });
      sawHttpResponse = true;
      const tenants = normalizeTenants(res.data);
      return {
        reachable: true,
        authRejected: false,
        endpoint: url,
        attempted,
        status: res.status,
        tenantCount: tenants.length,
        tenants,
      };
    } catch (error: unknown) {
      if (!axios.isAxiosError(error)) {
        lastError = error;
        continue;
      }
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        return {
          reachable: true,
          authRejected: true,
          endpoint: url,
          attempted,
          status,
          tenantCount: 0,
          tenants: [],
        };
      }
      if (status === 404) {
        sawHttpResponse = true;
        lastError = error;
        continue;
      }
      if (status) {
        sawHttpResponse = true;
      }
      lastError = error;
      // Keep trying candidates for reachable HTTP and transport errors alike.
    }
  }

  const axiosError = axios.isAxiosError(lastError) ? lastError : null;
  return {
    reachable: sawHttpResponse,
    authRejected: false,
    endpoint: null,
    attempted,
    status: axiosError?.response?.status,
    networkCode: axiosError?.code,
    error: axiosError ? axiosError.message : (lastError as Error)?.message,
    tenantCount: 0,
    tenants: [],
  };
}

function normalizeTenants(payload: unknown): CippDiagnosticsTenant[] {
  const body: any = payload;
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.tenants)
        ? body.tenants
        : Array.isArray(body?.value)
          ? body.value
          : [];

  const seen = new Set<string>();
  const tenants: CippDiagnosticsTenant[] = [];
  for (const raw of rows) {
    const id = String(
      raw?.customerId ?? raw?.tenantId ?? raw?.id ?? raw?.customerTenantId ?? ''
    ).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const displayName =
      raw?.displayName ?? raw?.name ?? raw?.tenantName ?? raw?.defaultDomainName ?? null;
    tenants.push({ entraTenantId: id, displayName: displayName ? String(displayName) : null });
  }
  return tenants;
}
