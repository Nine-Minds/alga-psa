# Extension API Routing Guide (Gateway → Runner)

This guide specifies the v2-only extension API gateway pattern used to route tenant requests to out-of-process extension handlers executed by the Runner service.

Key points:
- Route pattern: `/api/ext/[extensionId]/[[...path]]`
- Resolve tenant install → `{version_id, content_hash, config, provider grants, sealed secret envelope}` (manifest endpoint matching is advisory today)
- Proxy to Runner `POST /v1/execute` with strict header and size/time policies
- Reference gateway scaffold: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)

## Route Structure

Next.js app route:

```
server/src/app/api/ext/[extensionId]/[[...path]]/route.ts
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

3) Resolve endpoint from manifest (advisory)
- Load manifest for the resolved version (cacheable)
- Match `{method, pathname}` to a manifest endpoint (`api.endpoints`). Today this is used for docs/UX; hard enforcement is tracked in [Plan A4](../plans/2025-11-12-extension-system-alignment-plan.md#workstream-a-%E2%80%94-gateway--registry).

4) Build Runner Execute request
- Normalize HTTP input (method, path, query, allowed headers, body_b64)
- Add context `{request_id, tenant_id, extension_id, version_id, content_hash}` (install_id propagation pending A1)
- Attach install metadata `{config, providers, secret_envelope}` and set limits `{timeout_ms}` from `EXT_GATEWAY_TIMEOUT_MS`

5) Call Runner `/v1/execute`
- `POST ${RUNNER_BASE_URL}/v1/execute`
- Authenticate with a short‑lived service token

6) Map Runner response → NextResponse
- Apply header allowlist; enforce size/time limits
- Return `{status, headers, body}` from Runner

## Example (abridged)

```ts
import { NextRequest, NextResponse } from 'next/server';
import { loadInstallConfigCached } from '@ee/lib/extensions/lib/install-config-cache';

export async function handle(
  req: NextRequest,
  { params }: { params: { extensionId: string; path: string[] } },
) {
  const method = req.method.toUpperCase();
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  const pathname = '/' + (params.path || []).join('/');
  const url = new URL(req.url);

  const tenantId = await getTenantFromAuth(req);
  await assertAccess(tenantId, method);

  const install = await loadInstallConfigCached(tenantId, params.extensionId);
  if (!install?.contentHash) return NextResponse.json({ error: 'extension_not_installed' }, { status: 404 });

  const bodyBuf = method === 'GET' ? undefined : Buffer.from(await req.arrayBuffer());
  const execReq = {
    context: {
      request_id: requestId,
      tenant_id: tenantId,
      extension_id: params.extensionId,
      version_id: install.versionId,
      content_hash: install.contentHash,
      // install_id TODO(A1)
      config: install.config,
    },
    http: {
      method,
      path: pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: filterRequestHeaders(req.headers, tenantId, params.extensionId, requestId, method),
      body_b64: bodyBuf ? bodyBuf.toString('base64') : undefined,
    },
    limits: { timeout_ms: Number(process.env.EXT_GATEWAY_TIMEOUT_MS ?? '5000') },
    providers: install.providers,
    ...(install.secretEnvelope ? { secret_envelope: install.secretEnvelope } : {}),
  };

  const runnerResp = await fetch(`${process.env.RUNNER_BASE_URL}/v1/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
      'x-alga-tenant': tenantId,
      'x-alga-extension': params.extensionId,
      ...(install.configVersion ? { 'x-ext-config-version': install.configVersion } : {}),
      ...(install.secretsVersion ? { 'x-ext-secrets-version': install.secretsVersion } : {}),
    },
    body: JSON.stringify(execReq),
    signal: AbortSignal.timeout(Number(process.env.EXT_GATEWAY_TIMEOUT_MS ?? '5000')),
  });

  const payload = await runnerResp.json();
  return new NextResponse(payload.body_b64 ? Buffer.from(payload.body_b64, 'base64') : undefined, {
    status: payload.status ?? runnerResp.status,
    headers: filterResponseHeaders(runnerResp.headers),
  });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
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

- Gateway route scaffold: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)
- Install config helpers: [@ee/lib/extensions/installConfig](../../server/src/lib/extensions/installConfig.ts)
- Runner execution API: `POST /v1/execute` (see Runner responsibilities in [runner.md](runner.md))
- Registry v2 integration for resolution: [ExtensionRegistryServiceV2](../../server/src/lib/extensions/registry-v2.ts:48)
