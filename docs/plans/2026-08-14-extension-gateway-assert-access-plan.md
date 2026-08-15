# Extension gateway fail-closed access plan

**Date:** 2026-08-14

**Workflow card:** `1491d80b-8fa7-4313-a134-f68e5b9dba79`

**Scope:** `/api/ext/[extensionId]/...` and `/api/ext-proxy/[extensionId]/...` authorization before an install's config, provider grants, or `secretEnvelope` can be sent to the extension runner

## Problem and security invariant

`server/src/lib/extensions/gateway/auth.ts:133-136` exports an `assertAccess()` that always returns. The direct extension gateway calls it at `server/src/app/api/ext/[extensionId]/[[...path]]/route.ts:252`, then loads the tenant install at line 263 and can add `secret_envelope` to the runner payload at line 345. A second active path, `server/src/app/api/ext-proxy/[extensionId]/[[...path]]/route.ts`, delegates to `packages/product-ext-proxy/ee/handler.ts`; that handler calls a second no-op in `packages/product-ext-proxy/ee/gateway/auth.ts:188-191`, then loads a five-second cached install config and puts `secretEnvelope` into its execute payload at `packages/product-ext-proxy/ee/handler.ts:301`.

The required invariant is:

> No secret-bearing install context may be loaded from a cache or forwarded to a runner unless the same request has an authenticated tenant principal, an active install owned by that tenant, an allowed endpoint on the installed version, the appropriate existing extension permission or client-portal opt-in, an available rate-limit decision, and a durable execution audit record.

Every absent, malformed, stale, or unavailable policy input denies the request. `OPTIONS` may remain unauthenticated because it never resolves an install or executes an extension.

## Code-grounded conventions to preserve

- **Tenant ownership:** use `tenantDb(knex, tenantId)` for `tenant_extension_install`, whose tenant column is registered in `packages/db/src/lib/tenantTableMetadata.ts`. Do not perform an unscoped install lookup from a caller-controlled ID. The only existing unscoped install lookup is the install-ID-only internal convention in `ee/server/src/lib/extensions/installConfig.ts:127-153` and `ee/server/src/lib/extensions/storage/v2/factory.ts:28-42`; it first discovers the tenant and then reconstructs a tenant-scoped facade.
- **Extension identifier forms:** preserve `ee/server/src/lib/extensions/installConfig.ts:96-124`: a UUID may identify the install or registry record, while a non-UUID resolves the lower-cased `publisher.name` slug. Return the canonical `install.id`, `registry.id`, and `version.id` in the authorization result so aliases cannot create separate policy or rate-limit identities.
- **Active install semantics:** require both `tenant_extension_install.is_enabled = true` and `tenant_extension_install.status = 'enabled'`. This matches the existing storage guard in `ee/server/src/lib/extensions/storage/v2/factory.ts:40-41`; checking only `is_enabled`, as `server/src/lib/extensions/gateway/registry.ts` does, is insufficient.
- **MSP RBAC:** reuse `getCurrentUser()` and `hasPermission(user, 'extension', action, knex)`. Existing permissions are `extension:read` and `extension:write`, created by `server/migrations/20250301120000_add_extension_permissions.cjs`; there is no deployed `extension:execute` permission. Map `GET` to `read` and `POST`/`PUT`/`PATCH`/`DELETE` to `write`, matching the existing extension storage API convention.
- **Client portal opt-in:** a non-empty installed-version `ui.hooks.clientPortalMenu.label` is the existing explicit client-facing declaration. `ee/server/src/lib/actions/clientPortalExtActions.ts:20-33` already uses it when discovering enabled client-portal extensions. Client users do not receive the MSP-only `extension` permissions, so this manifest hook plus a valid tenant/client association is their gateway admission rule; declared endpoint matching still applies.
- **Endpoint allowlist:** use `matchEndpoint()` from `packages/product-ext-proxy/shared/gateway-utils.ts`, which implements exact method matching and exact segment count with `:param` segments. The installed `extension_version.api_endpoints` is the authority. Empty, malformed, or nonmatching endpoint data denies; do not retain the documentation's current "advisory" behavior.
- **Rate limiting:** reuse `TokenBucketRateLimiter` from `@alga-psa/core/rateLimit`, with namespace `extension-gateway`, tenant = canonical tenant ID, and subject = canonical registry ID. Follow the SCIM security pattern in `ee/server/src/lib/scim/handler.ts`: `allowed: false` is 429, and `remaining < 0` means Redis did not enforce the budget and must become 503 rather than fail open. The existing default bucket is 60 tokens with a one-token-per-second refill; make those the initial documented values instead of adding a settings table in this change.
- **Execution audit:** use the existing tenant-scoped `extension_execution_log` table created by `ee/server/migrations/20250810140000_align_registry_v2_schema.cjs`. Store method, path, principal kind, and HTTP/runner status in `metrics`; never store request/response bodies, headers, config, providers, or secrets. This table already has request, tenant, registry, version, start/finish, status, metrics, and error fields, so no schema migration is needed.
- **Runner dispatch:** retain the direct `/v1/execute` mapping in `server/src/app/api/ext/.../route.ts` and the `RunnerBackend.execute()` convention in `packages/product-ext-proxy/ee/handler.ts`. The authorized canonical install and version IDs must agree with the later install config before either dispatch occurs.

## Proposed access contract

Add `server/src/lib/extensions/gateway/access.ts` as the single policy implementation. Keep `assertAccess` exported from `server/src/lib/extensions/gateway/auth.ts` for compatibility, and re-export/import that same implementation from `packages/product-ext-proxy/ee/gateway/auth.ts` instead of maintaining a second policy copy.

The contract should be object-based and return the values proved by the decision:

```ts
type AssertExtensionAccessInput = {
  tenantId: string;
  extensionId: string;
  method: string;
  path: string;
};

type AuthorizedExtensionAccess = {
  tenantId: string;
  installId: string;
  registryId: string;
  versionId: string;
  endpoint: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; handler: string };
  principal: { kind: 'msp'; userId: string } | { kind: 'client'; userId: string; clientId: string };
};

assertAccess(input): Promise<AuthorizedExtensionAccess>;
```

Export a typed `ExtensionGatewayAccessError` carrying a stable code, HTTP status, and optional retry delay. Both handlers must map only this type to controlled responses and treat every unexpected error as a generic 503 `access_policy_unavailable`; policy/database details must not be returned to callers.

Recommended stable outcomes:

| Condition | Status/code | Notes |
| --- | --- | --- |
| No current session user | `401 unauthenticated` | Header-only tenant resolution and `DEV_TENANT_ID` never authorize execution. |
| Session tenant differs from requested tenant | `403 tenant_mismatch` | Preserve the existing result. |
| No active tenant-owned install | `404 extension_not_available` | Covers absent, disabled, pending, corrupt, or unresolved version records without distinguishing them. |
| MSP user lacks mapped extension permission | `403 forbidden` | `GET -> read`; mutations -> `write`. |
| Client user lacks a tenant client association or the installed version lacks `clientPortalMenu` | `403 forbidden` | Do not reveal whether an extension opted in. |
| Method/path is not declared by the installed version | `404 endpoint_not_found` | Enforced for MSP and client sessions. |
| Bucket exhausted | `429 rate_limited` | Include integer `Retry-After`. |
| Redis/policy/audit dependency unavailable | `503 access_policy_unavailable` | No install config read and no runner call. |

## Ordered implementation changes

### 1. Build the canonical, read-only access resolver

In new `server/src/lib/extensions/gateway/access.ts`:

1. Validate and normalize method/path using the method set and path behavior already used by the shared gateway utilities. Reject unsupported methods and malformed endpoint rows.
2. Call `getCurrentUser()`. Require `user_id`, `tenant`, and `user_type`; require the user's tenant to equal `tenantId`. Do not accept `x-alga-tenant`, `x-tenant-id`, `DEV_TENANT_ID`, forwarded `x-user-*` headers, or an install secret as a principal.
3. With `getAdminConnection()` and `tenantDb(knex, tenantId)`, query `tenant_extension_install` joined to global `extension_registry` and `extension_version`. Apply the existing UUID/slug resolution rules, plus `install.is_enabled = true` and `install.status = 'enabled'`. Select only IDs, endpoint JSON, and UI-hook JSON; do not join `tenant_extension_install_secrets`.
4. Parse `api_endpoints` defensively and call the shared `matchEndpoint()` with the effective method/path. Return 404 if parsing fails or no endpoint matches.
5. For an MSP user, call `hasPermission()` on the same connection with `extension/read` or `extension/write`.
6. For a client user, require a non-empty `ui.hooks.clientPortalMenu.label`, resolve the user's tenant-scoped contact to a non-empty `client_id` using the same `users.contact_id -> contacts.contact_name_id` relationship already used by the proxy user-context code, and return that client ID in the authorized principal. This prevents a client-facing extension from receiving a client user with no usable client boundary.
7. Consume the `extension-gateway` bucket using the canonical registry ID. Treat the limiter's `remaining < 0` sentinel as unavailable/503.
8. Return the canonical install/version/registry/endpoint/principal context. Never return secrets or configuration from this layer.

In `server/src/lib/extensions/gateway/auth.ts`, replace the no-op with a re-export of the canonical function and error/result types. In `packages/product-ext-proxy/ee/gateway/auth.ts`, delete its no-op and import/re-export the same canonical function. Tenant/user-info helpers can remain separate in this change; only the authorization decision must have one source of truth.

### 2. Make install hydration independently honor active state

Update `ee/server/src/lib/extensions/installConfig.ts`:

- Add `install.is_enabled` and `install.status` to `InstallRow` and both scoped row selections.
- Make `loadInstallRow()` require `is_enabled = true` and `status = 'enabled'` before `hydrateInstallConfig()` can read `tenant_extension_install_secrets`.
- In `loadInstallRowById()`, the unscoped probe may discover only `tenant_id`; the subsequent tenant-scoped query must enforce active state before hydration.
- Mirror any public type change needed by `packages/ee/src/lib/extensions/installConfig.ts`, keeping the CE implementation null/fail-closed.

This is defense in depth for internal/scheduled consumers as well as the gateway. It also closes the current EE behavior where `resolveInstallContext()` prefers `getInstallConfig()` even though that function does not filter disabled installs.

### 3. Bind authorization to the exact hydrated install

Update both dispatch handlers:

- `server/src/app/api/ext/[extensionId]/[[...path]]/route.ts`
- `packages/product-ext-proxy/ee/handler.ts`

Required order after non-executing CORS preflight:

1. Existing product/session gate and tenant resolution.
2. Compute the effective method/path. For `ext-proxy`, retain `resolveMethodAndBody()` before authorization so `__method=DELETE` requires `extension:write` and matches a declared `DELETE` endpoint.
3. `const access = await assertAccess(...)`.
4. Resolve user context. If `access.principal.kind === 'client'`, require the emitted user to be a client and force/verify the authorized `clientId`; do not continue with missing or mismatched client context.
5. Create the execution audit row (step 4 below).
6. Hydrate the install config. Compare `installId` and `versionId` to `access`; a mismatch means install state changed between checks, finishes the audit row as `policy_denied`, and returns 503/404 without retrying against the stale decision.
7. Only now construct and send the runner request containing config/providers/`secretEnvelope`.

For `packages/product-ext-proxy/ee/handler.ts`, do not trust a hit from `loadInstallConfigCached()` merely because the access query passed. Either bypass the cache for this security-sensitive hydration or accept the cached value only when its install/version IDs equal `access` and the new active-state resolver has just confirmed that pair. The former is preferred: secrets should not remain executable during the five-second cache window after disable/update.

Use canonical `access.registryId`/`installId`/`versionId` in runner context and headers, while preserving the requested extension identifier only as request metadata if needed. This prevents a slug/install-ID alias from changing runner ownership.

### 4. Record every forwarded execution durably

Add `server/src/lib/extensions/gateway/executionAudit.ts` with small functions used by both handlers:

- `startExtensionExecution(access, requestId, method, path)` inserts an `extension_execution_log` row with a generated UUID, canonical tenant/registry/version IDs, request ID, `started_at`, status `started`, and redacted `metrics` containing method, normalized path, matched endpoint template, principal kind, and user ID. A failed insert returns/throws `access_policy_unavailable`; no secrets are hydrated/forwarded without the start record.
- `finishExtensionExecution(logId, outcome)` updates `finished_at`, a terminal status (`ok`, `error`, `timeout`, or `policy_denied` where applicable), runner/HTTP status, and duration. Update failures are logged loudly but cannot undo a completed external execution.
- Never include request/response bodies, query values, cookies, authorization headers, install config, providers, or secret material. Avoid logging full error responses from the runner.

Wrap every terminal path after the start record, including empty/invalid runner responses, runner exceptions, aborts, and success, so audit rows do not remain `started` during ordinary failures. Keep the existing structured console fields (`requestId`, tenant, extension, method, path), but make the database row the durable audit source.

### 5. Normalize route error handling and remove the dead local wrapper

- In `packages/product-ext-proxy/ee/handler.ts`, remove the local `AccessError` and `wrapAssertAccess()`; they currently cannot classify errors thrown by another module.
- Add one mapper for `ExtensionGatewayAccessError` in each route (or a small shared response mapper if it does not pull Next.js types into the policy module).
- Preserve CORS wrapping on controlled errors.
- Return `Retry-After` on 429 and generic bodies on 500/503. Do not expose RBAC, database, endpoint handler, cache, or secret-envelope details.
- Leave `OPTIONS` as a 204 with no install/config lookup and no runner dispatch.

### 6. Align the client-portal discovery predicate

Update `ee/server/src/lib/actions/clientPortalExtActions.ts` to require `ti.status = 'enabled'` in addition to `ti.is_enabled = true`. This keeps menu discovery and the gateway's active-state definition consistent; a pending install should not be discoverable but unexecutable.

No new client permission migration is proposed. The manifest's `clientPortalMenu` hook is the current product opt-in and the existing extension RBAC rows are deliberately MSP-only (`client: false`). Per-extension client roles would be a separate authorization product design.

## Focused behavioral tests

### Canonical access unit tests

Extend `server/src/lib/extensions/gateway/auth.test.ts` or add `server/src/lib/extensions/gateway/access.test.ts` with mocked DB/RBAC/limiter dependencies:

1. MSP `GET` on an active tenant-owned install and declared literal endpoint requires `extension:read` and returns canonical IDs.
2. MSP `POST`/`DELETE` requires `extension:write`; a read-only user is denied before install config or runner access.
3. No session user is denied even when `x-alga-tenant`, legacy tenant header, or `DEV_TENANT_ID` resolves a tenant.
4. Cross-tenant session/header mismatch is denied.
5. Missing, disabled, or `pending` install is denied; test both registry ID and install ID/slug resolution without allowing another tenant's install.
6. Declared `:param` endpoint matches, while wrong method, extra segment, empty/malformed endpoint JSON, and undeclared path return `endpoint_not_found`.
7. Client user succeeds only with the installed version's non-empty `clientPortalMenu` hook and a resolvable tenant client ID; missing hook, missing client association, and MSP-only version are denied.
8. Exhausted limiter returns 429; unavailable/fail-open sentinel returns 503.
9. DB, RBAC, and endpoint-parse dependency failures never resolve access.

### DB-backed install-policy integration tests

Add `server/src/test/integration/extensionGatewayAccess.integration.test.ts` using migrated EE tables and real tenant-scoped queries:

1. Seed two tenants, one registry/version with endpoints/UI metadata, and installs; prove tenant A cannot resolve tenant B's install or secret-bearing config by install ID, registry ID, or slug.
2. Prove an enabled/status-enabled install resolves, then setting either `is_enabled = false` or `status = 'pending'/'disabled'` makes both `assertAccess()` and `getInstallConfig()` fail.
3. Prove the installed version controls endpoint access: switching the install to a version without the endpoint makes the old path fail and prevents stale version/secret use.

These are real-query tests because tenant ownership and active-state predicates are the core security behavior; source-string contract tests are not sufficient.

### Handler/runner boundary tests

Repair and extend `ee/server/src/__tests__/integration/extensionProxyFlow.test.ts`. It currently mocks `server/src/lib/extensions/gateway/auth` while `packages/product-ext-proxy/ee/handler.ts` imports its own no-op, so its authorization setup does not exercise the real seam.

For both `packages/product-ext-proxy/ee/handler.ts` and `server/src/app/api/ext/[extensionId]/[[...path]]/route.ts`:

1. Authorized request creates an audit start row, loads the exact active install, then calls the runner with matching canonical install/version IDs and the secret envelope.
2. Unauthenticated, RBAC-denied, client-not-opted-in, inactive-install, undeclared-endpoint, rate-limited, and audit-insert-failure cases never call install hydration/cache or runner `fetch`/`execute`.
3. A cached install whose install/version differs from the authorization result is rejected and its secret is never forwarded.
4. Method override is authorized as the effective method (`POST + __method=DELETE` requires write and a declared DELETE endpoint), and transport-only `__method` remains stripped.
5. Successful, runner-error, timeout, empty-body, and invalid-runner-response cases finish the audit row with the expected terminal status and no secret/config values in metrics.
6. Client success forwards the exact authorized `client_id`; missing client context denies before install hydration.

Retain the existing endpoint matcher unit coverage in `ee/server/src/lib/extensions/__tests__/gateway/gateway-utils.test.ts` and add cases there only if normalization behavior changes.

## Acceptance criteria

- Both extension HTTP execution paths use one non-stub `assertAccess` implementation.
- A request cannot cause an install config/cache read or runner call unless it has a current session principal and passes tenant ownership, active install, endpoint, RBAC/client opt-in, client association (when applicable), rate-limit, and audit-start checks.
- Disabled/pending installs cannot be hydrated through `getInstallConfig()` and cannot execute during the proxy cache TTL.
- Unknown endpoints are fail-closed against the installed version's manifest.
- MSP method-to-permission mapping uses the deployed `extension:read`/`extension:write` permissions; client access requires explicit installed-version portal opt-in.
- Header-only and development tenant fallbacks do not authorize execution.
- Every forwarded call has a redacted `extension_execution_log` record correlated by request ID, with terminal outcome updated when observable.
- Focused unit, DB-backed tenant-isolation, and handler boundary tests pass, along with the existing extension proxy and product-access suites.

## Migration, rollout, and compatibility

- **No schema or RBAC data migration:** all required columns, `extension:read`/`write`, endpoint/UI metadata, and `extension_execution_log` already exist.
- **Behavioral cutover is intentionally fail-closed:** installs whose current version has no valid `api_endpoints`, pending/disabled status, users without extension RBAC, and client extensions without `clientPortalMenu` will stop executing. Do not add a permissive fallback or long-lived feature flag around the security decision.
- **Pre-deploy compatibility query:** inventory enabled installs whose installed version has empty/malformed endpoint metadata, whose `status` is not `enabled`, or whose client-facing usage lacks `clientPortalMenu`. Fix manifests/install state before rollout; do not backfill guessed endpoints.
- **Cache compatibility:** bypassing the five-second secret-bearing cache adds one install/config query per execution. Correct disable/revoke behavior takes precedence; reintroduce caching only with active-state/version-aware invalidation and tests.
- **Rate limiter availability:** app initialization already wires the shared Redis limiter. This gateway explicitly treats the primitive's fail-open sentinel as 503, as SCIM does. Operators should expect gateway unavailability when Redis cannot enforce limits.
- **Audit availability:** an inability to create the pre-dispatch execution record returns 503. This is a deliberate availability/security tradeoff because unaudited secret forwarding violates the invariant.
- **Manifest enforcement:** parameterized routes continue to use the existing `:param` single-segment matcher; wildcards/globs are not introduced. Extensions relying on undeclared or catch-all routes must publish an explicit compatible version.
- **Client portal:** the existing menu hook becomes enforced at the API boundary. Client-facing extensions must also receive a valid `client_id`; an existing user with a broken contact/client association will be denied rather than receiving tenant secrets without a client boundary.

## Risks and mitigations

- **Two handlers drift again.** Mitigation: one canonical access module, shared typed error/result, parity tests for both dispatchers, and deletion of the package-local wrapper/stub.
- **Time-of-check/time-of-use during disable or upgrade.** Mitigation: active-state filtering in install hydration, canonical install/version comparison immediately before audit/dispatch, and no acceptance of a stale cache hit.
- **Alias bypass of rate limits or ownership.** Mitigation: resolve raw install/registry/slug identifiers once and use canonical registry/install/version IDs for rate limiting, audit, and runner context.
- **Client extension exposes tenant-wide data.** Mitigation: explicit version hook, declared endpoint, required client association, and exact client ID propagation. Entity-level data authorization inside extension host capabilities remains mandatory and is not replaced by this gateway check.
- **Endpoint metadata drift breaks an installed extension.** Mitigation: pre-deploy inventory and focused version-switch tests; no permissive fallback because that would recreate the reported policy hole.
- **Audit or Redis outage blocks extension execution.** This is expected fail-closed behavior. Emit structured operational errors/metrics that exclude secret material so the dependency failure can be diagnosed.
- **Install-config active filtering affects schedulers/internal host APIs.** This is desired for disabled installs, but integration suites for schedules and internal install-config consumers must run to detect code that incorrectly depended on disabled installs remaining hydratable.

## Explicitly out of scope

1. **Session-less execution enablement, mTLS, or a new service credential.** This change rejects every session-less `assertAccess` call. Existing internal runner APIs use constant-time `x-runner-auth` validation in `ee/server/src/lib/extensions/runnerAuth.ts`, but the extension runner currently reads `UI_PROXY_AUTH_KEY` without attaching it in `ee/runner/src/engine/host_api.rs`, and the public gateway routes are session-product-gated first. Enabling a runner-to-gateway caller requires separate end-to-end credential wiring, tenant binding, product entitlement checks, deployment secret configuration/rotation, and replay/audience tests. It must not be smuggled into this fix by trusting headers.
2. **The separate `getTenantFromAuth` header-trust card.** Header-only resolution may remain for other consumers, but it cannot authorize extension execution after this change.
3. **New per-extension RBAC resources or client role migrations.** Continue using deployed `extension:read`/`write` and the existing client portal manifest opt-in.
4. **Per-tenant configurable rate-limit UI/storage, concurrency quotas, billing quotas, or runner resource-limit redesign.** Use the shared limiter's initial default and the runner's existing execution limits.
5. **Manifest wildcard/glob routing or a new endpoint language.** Preserve the current literal/`:param` matcher.
6. **General consolidation of duplicate tenant/user-info helpers, CORS policy, debug file logging, or extension UI asset authorization.** Touch those only where required to consume the canonical access result safely.
7. **Encrypting, rotating, or changing the secret-envelope format.** The task is to prevent unauthorized forwarding, not alter envelope cryptography.

## Implementation validation commands

The implementer should run the focused tests above plus the repository's existing extension suites, then typecheck the affected server/package targets. At minimum:

```bash
cd server
npx vitest run src/lib/extensions/gateway/auth.test.ts
npx vitest run src/test/integration/extensionGatewayAccess.integration.test.ts
npx vitest run ../ee/server/src/__tests__/integration/extensionProxyFlow.test.ts
npx vitest run src/test/unit/api/standaloneExtensionIntegrationProductAccess.contract.test.ts
npx tsc --noEmit
```

If the DB-backed suite uses the repository integration harness rather than the default Vitest project, use that harness's documented invocation while preserving the real-query tenant-isolation assertions.
