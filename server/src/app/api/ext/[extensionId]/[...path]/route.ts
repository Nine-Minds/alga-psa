import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getTenantFromAuth, assertAccess } from 'server/src/lib/extensions/gateway/auth';
import { getTenantInstall, resolveVersion } from 'server/src/lib/extensions/gateway/registry';
import { filterRequestHeaders, filterResponseHeaders } from 'server/src/lib/extensions/gateway/headers';

async function handle(req: NextRequest, ctx: { params: Promise<{ extensionId: string; path?: string[] }> }) {
  const resolvedParams = await ctx.params;
  const { extensionId } = resolvedParams;
  const method = req.method.toUpperCase();
  const path = '/' + (resolvedParams.path || []).join('/');

  try {
    const tenantId = await getTenantFromAuth(req);
    await assertAccess(tenantId, extensionId, method, path);

    const install = await getTenantInstall(tenantId, extensionId);
    if (!install) return NextResponse.json({ error: 'not_installed' }, { status: 404 });
    const { content_hash, version_id } = await resolveVersion(install);

    const headers = filterRequestHeaders(req.headers);
    headers['x-alga-tenant'] = tenantId;
    headers['x-alga-extension'] = extensionId;
    const maxBody = 10 * 1024 * 1024; // 10MB cap
    let bodyB64: string | undefined;
    if (req.method !== 'GET') {
      const buf = Buffer.from(await req.arrayBuffer());
      if (buf.length > maxBody) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
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
      return new NextResponse(body, { status: payload.status || resp.status, headers: respHeaders });
    } catch (err) {
      clearTimeout(timeout);
      return NextResponse.json({ error: 'bad_gateway', detail: String(err) }, { status: 502 });
    }
  } catch (err) {
    return NextResponse.json({ error: 'internal_error', detail: String(err) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;

