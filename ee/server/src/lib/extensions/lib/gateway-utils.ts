/**
 * Gateway utilities for endpoint matching, header policy, and timeouts.
 * See docs: ee/docs/extension-system/api-routing-guide.md
 */

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiEndpointDef {
  method: Method;
  path: string; // e.g., /agreements/:id
  handler: string; // e.g., dist/handlers/http/sync
}

export interface ManifestV2 {
  api: {
    endpoints: ApiEndpointDef[];
  };
}

/**
 * Normalize and build pathname from path parts
 */
export function pathnameFromParts(parts: string[]): string {
  return '/' + parts.filter(Boolean).join('/');
}

/**
 * Simple path matcher supporting :param segments.
 * - Exact segment count
 * - Literal match or :param capture
 * - No wildcard/glob support
 */
export function matchEndpoint(
  endpoints: ApiEndpointDef[] | undefined,
  method: Method,
  pathname: string
): { handler: string } | null {
  if (!endpoints || endpoints.length === 0) return null;

  const reqSegs = trimAndSplit(pathname);
  for (const ep of endpoints) {
    if (ep.method !== method) continue;
    const patSegs = trimAndSplit(ep.path);
    if (patSegs.length !== reqSegs.length) continue;

    let matched = true;
    for (let i = 0; i < patSegs.length; i++) {
      const pat = patSegs[i];
      const req = reqSegs[i];
      if (pat.startsWith(':')) {
        // param segment; accept anything (non-empty)
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
      return { handler: ep.handler };
    }
  }
  return null;
}

function trimAndSplit(p: string): string[] {
  if (!p) return [];
  const t = p.trim();
  if (t === '' || t === '/') return [];
  return t.replace(/^\/+|\/+$/g, '').split('/');
}

// Allowlist for request headers forwarded to runner
const REQUEST_HEADER_ALLOWLIST = new Set([
  'accept',
  'content-type',
  'accept-encoding',
  'user-agent',
  // injected by gateway:
  'x-request-id',
  'x-alga-tenant',
  'x-alga-extension',
  'x-idempotency-key',
]);

// Allowlist for response headers returned to client
const RESPONSE_HEADER_ALLOWLIST = new Set([
  'content-type',
  'cache-control',
  // custom extension headers
  'x-ext-request-id',
  'x-ext-warning',
]);

export function filterRequestHeaders(
  reqHeaders: Headers,
  tenantId: string,
  extensionId: string,
  requestId: string,
  method: Method
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of reqHeaders.entries()) {
    const key = k.toLowerCase();
    if (key === 'authorization') continue; // strip end-user auth
    if (REQUEST_HEADER_ALLOWLIST.has(key)) {
      out[key] = v;
    }
  }
  // Gateway-injected headers
  out['x-request-id'] = requestId;
  out['x-alga-tenant'] = tenantId;
  out['x-alga-extension'] = extensionId;

  // Idempotency for non-GET
  if (method !== 'GET') {
    out['x-idempotency-key'] = out['x-idempotency-key'] || crypto.randomUUID();
  }

  return out;
}

export function filterResponseHeaders(
  headers: Record<string, string | string[] | undefined> | undefined
): Record<string, string> {
  const res: Record<string, string> = {};
  if (!headers) return res;
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (!RESPONSE_HEADER_ALLOWLIST.has(key)) continue;
    if (Array.isArray(v)) {
      res[key] = v.join(', ');
    } else if (typeof v === 'string') {
      res[key] = v;
    }
  }
  return res;
}

/**
 * Timeout parsing with sensible default
 */
export function getTimeoutMs(): number {
  const raw = process.env.EXT_GATEWAY_TIMEOUT_MS;
  const n = raw ? Number(raw) : 5000;
  return Number.isFinite(n) && n > 0 ? n : 5000;
}