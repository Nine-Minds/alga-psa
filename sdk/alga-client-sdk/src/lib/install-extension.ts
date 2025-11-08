export interface InstallExtensionOptions {
  registryId: string;
  version: string;
  apiKey: string;
  tenantId: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface InstallExtensionResult {
  success: boolean;
  status: number;
  installId?: string | null;
  message?: string;
  raw?: unknown;
}

const DEFAULT_BASE_URL = process.env.ALGA_API_BASE_URL || 'http://localhost:3000';

function resolveBaseUrl(baseUrl?: string): string {
  const value = baseUrl ?? DEFAULT_BASE_URL;
  if (!value) {
    throw new Error('Base URL is required. Provide `baseUrl` or set ALGA_API_BASE_URL.');
  }
  return value.replace(/\/?$/, '');
}

export async function installExtension(options: InstallExtensionOptions): Promise<InstallExtensionResult> {
  const {
    registryId,
    version,
    apiKey,
    tenantId,
    baseUrl,
    timeoutMs,
    fetchImpl,
  } = options;

  if (!registryId) throw new Error('registryId is required');
  if (!version) throw new Error('version is required');
  if (!apiKey) throw new Error('apiKey is required');
  if (!tenantId) throw new Error('tenantId is required');

  const fetcher = fetchImpl ?? globalThis.fetch;
  if (!fetcher) {
    throw new Error('Global fetch is not available. Provide a custom `fetchImpl`.');
  }

  const endpoint = `${resolveBaseUrl(baseUrl)}/api/v1/extensions/install`;
  const controller = typeof timeoutMs === 'number' ? new AbortController() : undefined;
  const timer = controller && timeoutMs && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'x-tenant-id': tenantId,
      },
      body: JSON.stringify({ registryId, version }),
      signal: controller?.signal,
    });

    const status = response.status;
    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message = payload?.error?.message || payload?.error || response.statusText;
      return {
        success: false,
        status,
        message,
        raw: payload,
      };
    }

    const data = payload?.data ?? payload;
    return {
      success: true,
      status,
      installId: data?.installId ?? data?.install_id ?? null,
      message: data?.message ?? 'Extension installation enqueued',
      raw: payload,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
