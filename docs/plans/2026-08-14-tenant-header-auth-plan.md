# Authenticated tenant-header resolution for extension gateways

**Date:** 2026-08-14
**Card:** `acd7e949-bc3b-46a8-817c-fae52916f8f1`
**Status:** implementation design
**Scope:** extension gateway tenant resolution only; no implementation is included in this commit

## Problem and security objective

`server/src/lib/extensions/gateway/auth.ts` currently treats a non-empty
`x-alga-tenant` or legacy `x-tenant-id` header as sufficient tenant authority whenever
`getSession()` returns no tenant. `DEV_TENANT_ID` is a final implicit authority source.
The comment calling this an internal-caller path is not enforced by code.

The currently exposed server routes happen to add session/user checks around this
helper, but the helper's contract is unsafe: a new caller, or a guard-order change,
could resolve an attacker-selected tenant and then load that tenant's extension install
configuration, secret envelope, and provider configuration.

The implementation must make these invariants local to the authentication helper:

1. A browser/session flow derives its tenant only from a complete authenticated
   session. Tenant headers may be checked for consistency during compatibility, but
   never select the tenant.
2. A service flow derives its tenant from a header only after authenticating an
   explicit service credential with a constant-time comparison.
3. Session and service modes are separate APIs. A caller must choose one; there is no
   generic helper that silently falls from a partial session into service headers.
4. Conflicting identity evidence fails closed. No source wins by precedence.
5. `DEV_TENANT_ID` is not an authentication mechanism and is removed from this path in
   every environment.

## Repository findings and caller audit

The following is grounded in the repository as inspected on this branch.

| Code path | Current behavior | Required disposition |
| --- | --- | --- |
| `server/src/lib/extensions/gateway/auth.ts` | `getTenantFromAuth()` prefers a session tenant, then accepts either tenant header without service authentication, then accepts `DEV_TENANT_ID`. | Replace the ambiguous API with explicitly named session and service resolvers. Remove the development fallback. |
| `server/src/lib/extensions/gateway/auth.test.ts` | Covers session success/mismatch and positively asserts that a session-less header is accepted. | Replace the unsafe assertion with a complete fail-closed matrix. |
| `server/src/app/api/ext/[extensionId]/[[...path]]/route.ts` | `assertSessionProductAccess()` runs before `getTenantFromAuth()`. The route then loads install config and may forward secrets to the runner. CORS advertises `x-alga-tenant`. | Keep it session-only, call the session resolver, retain guard-before-resolution ordering, and stop advertising tenant selection in browser CORS. |
| `server/src/app/ext-ui/[extensionId]/[contentHash]/[...path]/route.ts` | In legacy `EXT_UI_HOST_MODE=nextjs`, calls the helper and converts auth/lookup failures to 404; default Rust mode returns/redirects before tenant resolution. | Use the session resolver. Forged headers, `DEV_TENANT_ID`, and partial sessions must remain indistinguishable 404s and must not reach install/cache lookups. |
| `server/src/app/api/ext-debug/stream/route.ts` | `getCurrentUser()` gates access, then `getTenantFromAuth()` is used as a fallback before `currentUser.tenant`; `tenantId` query selection is intentionally allowed for authorized MSP debugging. | Remove tenant-header resolution from this route. Select the normalized query tenant when supplied, otherwise `currentUser.tenant`, after the existing user/RBAC gate. Ignore tenant headers as authority. |
| `server/src/app/api/ext-proxy/[extensionId]/[[...path]]/route.ts` | Every verb calls `assertSessionProductAccess()` before the EE package handler. | Keep the public delegator session-only and verify behaviorally that denial occurs before the package handler. |
| `packages/product-ext-proxy/ee/gateway/auth.ts` | Contains a second, drifting copy of unsafe `getTenantFromAuth()` and `DEV_TENANT_ID`. `getUserInfoFromAuth()` also treats the mere presence of `x-alga-tenant` as proof of an internal caller and drops user context. | Delete the copied tenant resolver and import the central session resolver in the handler. Make user-info lookup session-driven, not header-driven. |
| `packages/product-ext-proxy/ee/handler.ts` | Calls the package-local resolver directly, but its exposed server route is currently session-gated. CORS advertises `x-alga-tenant`. | Import the central session resolver, preserve the outer session gate, and remove the tenant header from allowed browser CORS headers. |
| `ee/server/src/lib/extensions/runnerAuth.ts` | Centralizes constant-time `x-runner-auth` verification for `/api/internal/ext-*`, rejects absent configuration, and rejects known development defaults in production. | Move the environment-neutral implementation to shared server code and keep an EE re-export so existing internal routes retain one implementation and stable imports. |

Additional header producers were audited and do not call these tenant resolvers:

- `packages/jobs/src/lib/handlers/extensionScheduledInvocationHandler.ts` sends
  `x-alga-tenant` to the runner execution API, not to a server tenant resolver.
- `packages/product-ext-proxy/shared/gateway-utils.ts` and
  `ee/server/src/lib/extensions/lib/gateway-utils.ts` construct runner-bound headers
  after tenant resolution.
- `ee/runner/src/engine/host_api.rs` sends `x-alga-tenant` from an already constructed
  execution context. Its `UI_PROXY_AUTH_KEY`/`x-runner-auth` behavior is a separate
  outbound-proxy concern; no current `getTenantFromServiceAuth` route consumes it.
- General API-key paths using `x-tenant-id` in API controllers/middleware have their
  own API-key-to-tenant validation contracts and are not users of this extension
  helper.

There is therefore no current production caller that needs session-less resolution
through this helper. Service support should be safe and explicit for a future internal
route, without weakening any current browser route to make the new helper appear used.

## Target design

### 1. Separate session and service contracts

In `server/src/lib/extensions/gateway/auth.ts`, remove `getTenantFromAuth` and export
two intentionally narrow functions:

```ts
getTenantFromSessionAuth(req: NextRequest): Promise<string>
getTenantFromServiceAuth(req: NextRequest): Promise<string>
```

Do not retain a backward-compatible alias. Renaming makes all current and future
callers make an authentication-mode decision and makes missed call sites fail at
compile time.

`getTenantFromSessionAuth` algorithm:

1. Call `getSession()`.
2. If no session exists, throw a typed tenant-auth error with code
   `unauthenticated`.
3. If a session exists but `session.user.tenant` is absent, blank, or not a string,
   throw `invalid_session`. This check occurs before considering any header.
4. Normalize `x-alga-tenant` and `x-tenant-id`. If either non-empty header differs
   from the session tenant, or if the two supplied headers differ from each other,
   throw `tenant_mismatch`.
5. Return the session tenant. Matching headers are tolerated only as transitional
   compatibility; they are not authority.

`getTenantFromServiceAuth` algorithm:

1. Call `getSession()`. If any session object is present, reject with `mixed_auth`;
   a partial session must not be reinterpreted as a service caller.
2. Authenticate `req.headers.get('x-runner-auth')` against
   `process.env.RUNNER_SERVICE_TOKEN` through the shared constant-time runner-auth
   verifier. Do not accept `RUNNER_STORAGE_API_TOKEN` here: a storage-scoped token
   must not silently become generic tenant-selection authority.
3. Normalize `x-alga-tenant` and `x-tenant-id`. Require at least one. When both are
   present, require exact agreement; otherwise throw `tenant_mismatch` rather than
   assigning precedence.
4. Return the authenticated header tenant. Keep `x-tenant-id` only as a documented
   legacy compatibility input under service authentication; new callers send
   `x-alga-tenant`.

Neither function reads `DEV_TENANT_ID`. Local calls use a real seeded session or set a
non-default `RUNNER_SERVICE_TOKEN` and matching `x-runner-auth` header. This is simpler
and safer than a `NODE_ENV !== 'production'` gate, which still makes environment
classification an identity source.

### 2. Typed, non-leaking failures

Add a small `TenantAuthError` in `server/src/lib/extensions/gateway/auth.ts` (or a
sibling `errors.ts` if it improves readability) with stable internal codes:

- `unauthenticated`
- `invalid_session`
- `invalid_service_auth`
- `missing_tenant`
- `mixed_auth`
- `tenant_mismatch`

Route boundaries return generic 401 for missing/invalid authentication and 403 for a
tenant mismatch. Legacy UI assets continue returning 404 for every auth/lookup
failure. Logs may include the error code but must not include the runner token, cookie,
or tenant headers. Service-token misconfiguration must fail as 401, not fall through
to another tenant source.

### 3. One runner-auth implementation

Create `server/src/lib/extensions/runnerAuth.ts` by moving the pure Node token
verification from `ee/server/src/lib/extensions/runnerAuth.ts`. Preserve:

- constant-time comparison for equal-length values;
- failure on missing configured secrets;
- production rejection of `local-runner-key`, `changeme`, `change-me`, and `secret`;
- `assertRunnerAuth` and `isValidRunnerToken` behavior used by existing internal
  extension APIs.

Change `ee/server/src/lib/extensions/runnerAuth.ts` to a compatibility re-export from
the shared module. This avoids a broad import churn while ensuring internal EE routes
and the new service resolver execute exactly the same security logic. Add shared unit
coverage before converting the EE file to the re-export.

### 4. Keep browser routes browser-authenticated

Update these call sites to `getTenantFromSessionAuth`:

- `server/src/app/api/ext/[extensionId]/[[...path]]/route.ts`
- `server/src/app/ext-ui/[extensionId]/[contentHash]/[...path]/route.ts`
- `packages/product-ext-proxy/ee/handler.ts`

For the package handler, import the central resolver directly and remove the duplicate
function from `packages/product-ext-proxy/ee/gateway/auth.ts`. Also remove its
header-presence shortcut in `getUserInfoFromAuth`: a matching tenant header on a
session request must not suppress the authenticated user passed to the runner.

Do not make `/api/ext` or `/api/ext-proxy` accept service auth as an alternative to
`assertSessionProductAccess`. A future internal service endpoint must call
`getTenantFromServiceAuth` explicitly and perform any install/capability authorization
appropriate to that endpoint.

Remove `x-alga-tenant` from `ALLOWED_HEADERS` in the browser-facing `/api/ext` and EE
proxy CORS responses. Same-origin compatibility remains, and matching tenant headers
remain tolerated by the session resolver temporarily, but cross-origin browser code is
no longer encouraged to send a tenant selector. Do not add `x-runner-auth` to any
browser CORS allow-list.

### 5. Align public API metadata

Update `server/src/lib/api/openapi/routes/extensionGateway.ts` so the public extension
gateway is documented as session-authenticated and tenant-scoped by the session. Remove
`x-alga-tenant`, `x-tenant-id`, and `DEV_TENANT_ID` as advertised tenant-selection
mechanisms, and document 401/403 outcomes.

Regenerate, rather than hand-edit, the derived OpenAPI and registry artifacts with the
repository generators (`sdk/scripts/generate-openapi.ts` for CE and EE, followed by
`ee/scripts/generate-chat-registry.mjs`). Review the generated diff specifically for
the extension gateway entries under:

- `sdk/docs/openapi/alga-openapi.{ce,ee}.{json,yaml}` and compatibility copies emitted
  by the generator;
- `server/src/lib/mcp/registry.generated.ts`;
- `ee/server/src/chat/registry/apiRegistry.generated.ts`.

## Ordered implementation sequence

1. Move runner-token verification into `server/src/lib/extensions/runnerAuth.ts`, add
   focused tests, and make the EE module a re-export. Run existing internal extension
   API auth tests to prove no behavior change.
2. Replace the generic resolver in `server/src/lib/extensions/gateway/auth.ts` with
   the typed session/service APIs and remove `DEV_TENANT_ID` resolution.
3. Rewrite `server/src/lib/extensions/gateway/auth.test.ts` around the full behavior
   matrix below before migrating callers.
4. Migrate `/api/ext` and legacy `/ext-ui` to the session resolver; remove tenant CORS
   advertisement and add route-boundary tests that prove downstream work is not
   reached on auth failure.
5. Consolidate the EE product proxy on the central session resolver, remove its
   duplicate resolver/fallback, fix header-based user suppression, and add delegator
   and package-handler regression tests.
6. Remove tenant-header interpretation from `ext-debug/stream`; preserve its explicit
   query-tenant behavior behind current-user and RBAC checks.
7. Update the canonical OpenAPI route metadata, regenerate derived files, and confirm
   no generated description still advertises `DEV_TENANT_ID` or unauthenticated tenant
   headers for the extension gateway.
8. Run targeted tests, both server and EE typechecks, and a repository-wide caller
   audit for the removed symbol before requesting review.

## Behavioral test plan

These tests must execute functions/routes with controlled session and downstream
spies. Source-string assertions alone do not prove the security boundary.

### Resolver tests (`server/src/lib/extensions/gateway/auth.test.ts`)

| Case | Expected behavior |
| --- | --- |
| Complete session, no tenant headers | Session tenant is returned. |
| Complete session, matching canonical and/or legacy header | Session tenant is returned; the header is not treated as authority. |
| Complete session, either header differs | `tenant_mismatch`; no fallback. |
| Complete session, canonical and legacy headers disagree | `tenant_mismatch`, even if one matches the session. |
| No session, forged tenant header, no token | Session resolver rejects `unauthenticated`. |
| No session, forged tenant header plus valid service token | Session resolver still rejects; auth modes cannot be smuggled into browser callers. |
| Session object/user exists but tenant is missing or blank, with any headers/token | `invalid_session`; it never falls into service mode. |
| No session, service resolver, missing/incorrect token | `invalid_service_auth`; no tenant is returned. |
| No session, service resolver, valid token plus canonical header | Header tenant is returned. |
| No session, service resolver, valid token plus legacy header | Header tenant is returned for compatibility. |
| No session, service resolver, valid token but no tenant header | `missing_tenant`. |
| No session, service resolver, valid token and conflicting tenant headers | `tenant_mismatch`. |
| Any session plus otherwise valid service credentials | `mixed_auth`. |
| Production with a known default service token | Rejected by runner-auth validation. |
| Development/test with only `DEV_TENANT_ID` set | Both resolvers reject; the variable has no effect. |

Ensure every test restores `NODE_ENV`, `RUNNER_SERVICE_TOKEN`, and `DEV_TENANT_ID` to
avoid order-dependent security results.

### Route and package tests

- Add a direct `/api/ext` route test: no session plus forged `x-alga-tenant` returns
  401 from `assertSessionProductAccess`; spies for tenant resolution, install lookup,
  and runner fetch remain untouched. A partial session also stops before install
  lookup. Preserve a valid-session happy path and the 403 mismatch response.
- Add a direct `/api/ext-proxy` delegator test for every exported verb through a
  representative table: a denied session response is returned and the EE handler is
  not invoked. One allowed case proves delegation still occurs.
- Extend `ee/server/src/__tests__/integration/extensionProxyFlow.test.ts` (or split a
  focused unit test) to mock the central resolver actually imported by the package.
  Prove a session request with a matching tenant header still carries user info to the
  runner, while a mismatched header stops before `loadInstallConfigCached` and
  `backend.execute`.
- Add legacy `/ext-ui` tests: no session, partial session, forged headers, and
  `DEV_TENANT_ID` all return the existing 404 and do not call `getTenantInstall`,
  `resolveVersion`, `ensureUiCached`, or `serveFrom`. A complete-session/hash-match
  case remains successful.
- Add `ext-debug/stream` tests showing that forged tenant headers cannot change the
  stream key; absent query selection uses `currentUser.tenant`, explicit query
  selection remains available only after `getCurrentUser` and `hasPermission` pass,
  and denial does not open Redis.
- Keep shared runner-auth tests for correct token, incorrect token, unequal-length
  token, missing configuration, and production default rejection; retain existing EE
  internal API tests as compatibility coverage through the re-export.

Suggested targeted validation commands during implementation:

```bash
cd server && npx vitest run src/lib/extensions/gateway/auth.test.ts <new-route-test-files>
cd ee/server && npx vitest run src/__tests__/integration/extensionProxyFlow.test.ts <new-focused-tests>
cd server && npm run typecheck
cd ee/server && npm run typecheck
rg -n "getTenantFromAuth|DEV_TENANT_ID" server/src packages/product-ext-proxy/ee
rg -n "x-alga-tenant.*tenant resolution|DEV_TENANT_ID" server/src/lib/api/openapi sdk/docs/openapi server/src/lib/mcp ee/server/src/chat/registry
```

The final `rg` audit should find no removed generic resolver and no extension-gateway
documentation claiming `DEV_TENANT_ID` or a bare tenant header authenticates a caller.

## Migration and compatibility considerations

- **Current browser traffic:** `/api/ext` and `/api/ext-proxy` already require a
  session through `assertSessionProductAccess`, so legitimate traffic continues to
  resolve the same tenant. Matching headers remain temporarily accepted but become
  redundant and are removed from CORS advertisement.
- **Legacy UI mode:** deployments using `EXT_UI_HOST_MODE=nextjs` must have a valid
  session cookie when serving assets. Header-only and `DEV_TENANT_ID` access will stop
  working and should be treated as an unsafe undocumented dependency, not preserved.
- **Service integrations:** no current resolver caller needs session-less operation.
  Before a future service route ships, provision a non-default `RUNNER_SERVICE_TOKEN`
  to the server and the same secret to its producer, send it as `x-runner-auth`, and
  use `x-alga-tenant`. Never expose that token to browser code or CORS.
- **Local development:** remove reliance on `DEV_TENANT_ID` for extension routes.
  Browser testing uses the seeded dev session. Service tests use an explicit test
  token. `scripts/dev-uninstall-extension.mjs` has a separate use of
  `DEV_TENANT_ID` and is unaffected.
- **Token scope:** only `RUNNER_SERVICE_TOKEN` authorizes generic service tenant
  selection. Existing storage/config tokens remain limited to their established
  internal endpoints.
- **Error compatibility:** unauthenticated service or partial-session failures become
  401 instead of accidental downstream 500s. The legacy asset route intentionally
  preserves 404 masking. Tenant mismatch remains 403 on JSON gateway routes.
- **Generated docs:** generated OpenAPI/registry changes may be large; regenerate from
  the canonical source and review only expected extension-gateway semantic changes.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Hidden header-only local or legacy consumer breaks. | Repository audit found none. Make the break explicit, document session/service setup, and do not preserve unsafe fallback behavior. |
| A future route imports the wrong resolver. | Remove the ambiguous symbol, expose separately named functions, keep service auth out of browser CORS, and add route tests that assert downstream calls never occur after denial. |
| Duplicate EE proxy logic drifts again. | Delete the package tenant resolver and import the shared implementation; align its existing integration test mock with the real import. |
| Partial session is treated as session-less. | Test `session !== null` separately from tenant presence and reject before checking service credentials or headers. |
| Conflicting canonical/legacy headers select by precedence. | Normalize both and require agreement in both auth modes. |
| Timing or default-secret weakness is reintroduced. | Reuse one constant-time runner-auth implementation and preserve production insecure-default rejection tests. |
| Security fix accidentally suppresses valid MSP debug selection. | Make the existing query parameter the only explicit selection mechanism in that RBAC-gated route and test it independently from headers. |
| Public docs continue teaching unsafe usage. | Update the canonical OpenAPI source, regenerate all editions/registries, and audit generated text. |

## Explicitly out of scope

- Implementing the existing no-op extension `assertAccess()` / per-extension RBAC;
  that is tracked separately and must not be bundled into this authentication fix.
- Changing API-key tenant selection in general v1 API controllers, MCP connector
  headers, mobile headers, webhook tenant resolution, or middleware tenant context.
- Redesigning runner execution authentication, secret envelopes, install lookup, or
  capability enforcement.
- Adding a new service-facing extension route merely to consume
  `getTenantFromServiceAuth`.
- Rotating or distributing production secrets as part of the code change; deployment
  owners must configure a future service producer and server before that path is used.
- Removing the legacy `x-tenant-id` header from unrelated APIs. Within this design it
  remains a service-authenticated compatibility alias only.
- Changing Rust runner `UI_PROXY_AUTH_KEY` behavior unless a concrete route adopting
  `getTenantFromServiceAuth` is added in a separately reviewed change.
- Database schema changes, migrations, UI changes, feature flags, or broad auth-system
  refactors.

## Definition of done

- No extension gateway resolver returns a tenant from an unauthenticated header or
  `DEV_TENANT_ID`.
- Partial sessions and mixed session/service credentials fail closed.
- Current browser routes use the session-only API; a service route can opt into the
  separately authenticated service API without caller-discipline assumptions.
- The product proxy no longer contains a duplicate resolver or treats header presence
  as internal-caller proof.
- All behavior tests above pass, downstream spies prove denials stop before tenant data
  or runner work, CE and EE typechecks pass, and generated public metadata describes
  the hardened contract.
