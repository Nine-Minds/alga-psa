# Extension API Routing Guide (Gateway → Runner)

This guide specifies the v2-only extension API gateway pattern used to route tenant requests to out-of-process extension handlers executed by the Runner service.

Key points:
- Route pattern: `/api/ext/[extensionId]/[...path]`
- Resolve tenant install → version → content_hash → manifest endpoint mapping
- Proxy to Runner `POST /v1/execute` with strict header and size/time policies
- Reference gateway scaffold: [ee/server/src/app/api/ext/[extensionId]/[...path]/route.ts](ee/server/src/app/api/ext/%5BextensionId%5D/%5B...path%5D/route.ts)

## Route Structure

Next.js app route:

```
server/src/app/api/ext/[extensionId]/[...path]/route.ts
```

Supports methods: GET, POST, PUT, PATCH, DELETE.

The URL conveys:
- `extensionId`: the registry or install identifier for the extension
- `path`: the arbitrary path that should match an endpoint in the manifest

Example requests:
```
/api/ext/com.alga.softwareone/agreements
/api/ext/com.alga.softwareone/agreements/agr-001
/api/ext/com.alga.softwareone/agreements/sync?force=true
```

## Request Pipeline (per request)

1) Resolve tenant context
- Derive `tenant_id` from auth/session
- Verify RBAC: the user can access this extension/endpoint

2) Resolve install/version
- Look up the tenant’s install for `extensionId`
- Determine the active `version_id` and `content_hash`

3) Resolve endpoint from manifest
- Load manifest for the resolved version (cacheable)
- Match `{method, pathname}` to a manifest endpoint (`api.endpoints`)
- If not found, return 404

4) Build Runner Execute request
- Normalize HTTP input (method, path, query, allowed headers, body_b64)
- Add context `{request_id, tenant_id, extension_id, version_id, content_hash}`
- Set limits `{timeout_ms}` from `EXT_GATEWAY_TIMEOUT_MS`

5) Call Runner `/v1/execute`
- `POST ${RUNNER_BASE_URL}/v1/execute`
- Authenticate with a short‑lived service token

6) Map Runner response → NextResponse
- Apply header allowlist; enforce size/time limits
- Return `{status, headers, body}` from Runner

## Example (abridged)

```ts
import { NextRequest, NextResponse } from 'next/server';

export async function handler(req: NextRequest, ctx: { params: { extensionId: string; path: string[] } }) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const method = req.method;
  const { extensionId, path } = ctx.params;
  const pathname = '/' + (path || []).join('/');
  const url = new URL(req.url);

  const tenantId = await getTenantFromAuth(req);
  await assertAccess(tenantId, extensionId, method, pathname);

  const install = await getTenantInstall(tenantId, extensionId);
  if (!install) return NextResponse.json({ error: 'Not installed' }, { status: 404 });
  const { version_id, content_hash } = await resolveVersion(install);

  const endpoint = await resolveEndpoint(version_id, method, pathname);
  if (!endpoint) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const bodyBuf = method === 'GET' ? undefined : Buffer.from(await req.arrayBuffer());
  const execReq = {
    context: { request_id: requestId, tenant_id: tenantId, extension_id: extensionId, content_hash, version_id },
    http: {
      method,
      path: pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: filterRequestHeaders(req.headers),
      body_b64: bodyBuf ? bodyBuf.toString('base64') : undefined
    },
    limits: { timeout_ms: Number(process.env.EXT_GATEWAY_TIMEOUT_MS) || 5000 }
  };

  const runnerResp = await fetch(`${process.env.RUNNER_BASE_URL}/v1/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
      'authorization': await getRunnerServiceToken()
    },
    body: JSON.stringify(execReq),
    signal: AbortSignal.timeout(Number(process.env.EXT_GATEWAY_TIMEOUT_MS) || 5000)
  });

  if (!runnerResp.ok) {
    return NextResponse.json({ error: 'Runner error' }, { status: 502 });
  }
  const { status, headers, body_b64 } = await runnerResp.json();
  const resHeaders = filterResponseHeaders(headers);
  const body = body_b64 ? Buffer.from(body_b64, 'base64') : undefined;
  return new NextResponse(body, { status, headers: resHeaders });
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
```

## Header Policy

Forward (allowlist):
- `x-request-id`, `accept`, `content-type`, `accept-encoding`, `user-agent`
- `x-alga-tenant` (gateway‑generated), `x-alga-extension` (gateway‑generated)
- `x-idempotency-key` (gateway‑generated for non‑GET)

Strip:
- End‑user `authorization` header (gateway authenticates user and uses a service token to the Runner)

Response allowlist:
- `content-type`, `cache-control` (safe), custom `x-ext-*` headers
- Disallow `set-cookie` and hop‑by‑hop headers

## Limits and Timeouts

- Request/response body size caps (e.g., 5–10 MB)
- Default timeout: `EXT_GATEWAY_TIMEOUT_MS` (5s default), with safe per‑endpoint overrides
- Limited header propagation and standardized error mapping (e.g., 404/413/502/504)

## Testing

- Unit‑test manifest endpoint resolution and RBAC guards
- Integration‑test end‑to‑end proxy behavior and error mapping
- Inject fake Runner responses to validate header/body handling and timeouts

## Related References

- Gateway route scaffold: [ee/server/src/app/api/ext/[extensionId]/[...path]/route.ts](ee/server/src/app/api/ext/%5BextensionId%5D/%5B...path%5D/route.ts)
- Runner execution API: `POST /v1/execute` (see Runner responsibilities in [runner.md](runner.md))
- Registry v2 integration for resolution: [ExtensionRegistryServiceV2](ee/server/src/lib/extensions/registry-v2.ts:48)
