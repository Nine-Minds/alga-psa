/**
 * Shared gateway utilities for the extension proxy.
 */

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiEndpointDef {
  method: Method;
  path: string;
  handler: string;
}

export interface ManifestV2 {
  api: {
    endpoints: ApiEndpointDef[];
  };
}

export function pathnameFromParts(parts: string[]): string {
  return '/' + parts.filter(Boolean).join('/');
}

function trimAndSplit(path: string): string[] {
  if (!path) return [];
  const trimmed = path.trim();
  if (trimmed === '' || trimmed === '/') return [];
  return trimmed.replace(/^\/+|\/+$/g, '').split('/');
}

export function matchEndpoint(
  endpoints: ApiEndpointDef[] | undefined,
  method: Method,
  pathname: string,
): { handler: string } | null {
  if (!endpoints || endpoints.length === 0) return null;

  const reqSegs = trimAndSplit(pathname);
  for (const endpoint of endpoints) {
    if (endpoint.method !== method) continue;
    const patSegs = trimAndSplit(endpoint.path);
    if (patSegs.length !== reqSegs.length) continue;

    let matched = true;
    for (let i = 0; i < patSegs.length; i += 1) {
      const pat = patSegs[i];
      const req = reqSegs[i];
      if (pat.startsWith(':')) {
        if (!req.length) {
          matched = false;
          break;
        }
      } else if (pat !== req) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { handler: endpoint.handler };
    }
  }
  return null;
}

const REQUEST_HEADER_ALLOWLIST = new Set([
  'accept',
  'content-type',
  'accept-encoding',
  'user-agent',
  'x-request-id',
  'x-alga-tenant',
  'x-alga-extension',
  'x-idempotency-key',
]);

const RESPONSE_HEADER_ALLOWLIST = new Set([
  'content-type',
  'cache-control',
  'x-ext-request-id',
  'x-ext-warning',
]);

export function filterRequestHeaders(
  reqHeaders: Headers,
  tenantId: string,
  extensionId: string,
  requestId: string,
  method: Method,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of reqHeaders.entries()) {
    const lower = key.toLowerCase();
    if (lower === 'authorization') continue;
    if (REQUEST_HEADER_ALLOWLIST.has(lower)) {
      out[lower] = value;
    }
  }

  out['x-request-id'] = requestId;
  out['x-alga-tenant'] = tenantId;
  out['x-alga-extension'] = extensionId;

  if (method !== 'GET') {
    out['x-idempotency-key'] = out['x-idempotency-key'] ?? crypto.randomUUID();
  }

  return out;
}

export function filterResponseHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (!RESPONSE_HEADER_ALLOWLIST.has(lower)) continue;
    if (Array.isArray(value)) {
      result[lower] = value.join(', ');
    } else if (typeof value === 'string') {
      result[lower] = value;
    }
  }
  return result;
}

export function getTimeoutMs(): number {
  const raw = process.env.EXT_GATEWAY_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : 5000;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
}
