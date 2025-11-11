import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';

import { getTenantFromAuth, assertAccess } from 'server/src/lib/extensions/gateway/auth';
import { getTenantInstall, resolveVersion } from 'server/src/lib/extensions/gateway/registry';
import { filterRequestHeaders, filterResponseHeaders } from 'server/src/lib/extensions/gateway/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'content-type,x-request-id,x-idempotency-key,x-alga-tenant';

function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function extraAllowedOrigins(): string[] {
  const raw = process.env.EXT_GATEWAY_ALLOWED_ORIGINS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function pickCorsOrigin(req: NextRequest): string | null {
  const originHeader = req.headers.get('origin');
  if (!originHeader) return null;
  const normalized = normalizeOrigin(originHeader);
  if (!normalized) return null;

  const allowlist = new Set([
    'https://algapsa.com',
    'https://www.algapsa.com',
    ...extraAllowedOrigins().map((entry) => normalizeOrigin(entry)).filter(Boolean),
  ]);
  if (allowlist.has(normalized)) {
    return originHeader;
  }
  if (normalized.endsWith('.apps.algapsa.com')) {
    return originHeader;
  }
  if (process.env.NODE_ENV !== 'production') {
    if (normalized === 'http://localhost:3000' || normalized === 'http://127.0.0.1:3000') {
      return originHeader;
    }
  }
  return null;
}

function applyCorsHeaders(response: NextResponse, origin: string | null): NextResponse {
  if (!origin) return response;
  response.headers.set('access-control-allow-origin', origin);
  response.headers.set('access-control-allow-credentials', 'true');
  const vary = response.headers.get('vary');
  response.headers.set('vary', vary ? `${vary}, Origin` : 'Origin');
  return response;
}

function corsPreflight(origin: string | null): NextResponse {
  const headers = new Headers();
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-credentials', 'true');
  }
  headers.set('access-control-allow-methods', ALLOWED_METHODS);
  headers.set('access-control-allow-headers', ALLOWED_HEADERS);
  headers.set('access-control-max-age', '180');
  headers.set('vary', 'Origin, Access-Control-Request-Headers');
  return new NextResponse(null, { status: 204, headers });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ extensionId: string; path?: string[] }> }) {
  const corsOrigin = pickCorsOrigin(req);
  if (req.method.toUpperCase() === 'OPTIONS') {
    return corsPreflight(corsOrigin);
  }

  const resolvedParams = await ctx.params;
  const { extensionId } = resolvedParams;
  const method = req.method.toUpperCase();
  const path = '/' + (resolvedParams.path || []).join('/');

  try {
    const tenantId = await getTenantFromAuth(req);
    await assertAccess(tenantId, extensionId, method, path);

    const install = await getTenantInstall(tenantId, extensionId);
    if (!install) {
      return applyCorsHeaders(NextResponse.json({ error: 'not_installed' }, { status: 404 }), corsOrigin);
    }
    const { content_hash, version_id } = await resolveVersion(install);

    const headers = filterRequestHeaders(req.headers);
    headers['x-alga-tenant'] = tenantId;
    headers['x-alga-extension'] = extensionId;
    const maxBody = 10 * 1024 * 1024; // 10MB cap
    let bodyB64: string | undefined;
    if (req.method !== 'GET') {
      const buf = Buffer.from(await req.arrayBuffer());
      if (buf.length > maxBody) {
        return applyCorsHeaders(
          NextResponse.json({ error: 'payload_too_large' }, { status: 413 }),
          corsOrigin
        );
      }
      bodyB64 = buf.toString('base64');
    }
    const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
    const idempotencyKey = req.method === 'GET' ? undefined : (req.headers.get('x-idempotency-key') || requestId);

    const runnerUrl = process.env.RUNNER_BASE_URL || 'http://localhost:8080';
    const timeoutMs = Number(process.env.EXT_GATEWAY_TIMEOUT_MS || '5000');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${runnerUrl}/v1/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': requestId,
          ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
        },
        body: JSON.stringify({
          context: { request_id: requestId, tenant_id: tenantId, extension_id: extensionId, content_hash, version_id },
          http: { method, path, query: Object.fromEntries(req.nextUrl.searchParams.entries()), headers, body_b64: bodyB64 },
          limits: { timeout_ms: timeoutMs },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const payload = await resp.json();
      const respHeaders = new Headers(filterResponseHeaders(resp.headers));
      const body = payload.body_b64 ? Buffer.from(payload.body_b64, 'base64') : undefined;
      return applyCorsHeaders(
        new NextResponse(body, { status: payload.status || resp.status, headers: respHeaders }),
        corsOrigin
      );
    } catch (err) {
      clearTimeout(timeout);
      return applyCorsHeaders(
        NextResponse.json({ error: 'bad_gateway', detail: String(err) }, { status: 502 }),
        corsOrigin
      );
    }
  } catch (err) {
    return applyCorsHeaders(
      NextResponse.json({ error: 'internal_error', detail: String(err) }, { status: 500 }),
      corsOrigin
    );
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
