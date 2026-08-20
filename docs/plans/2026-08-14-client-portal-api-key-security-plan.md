# Client-portal API-key security implementation plan

**Workflow card:** `92234f94-8aec-4437-a6fa-812eb11db3ce`

**Date:** 2026-08-14

**Status:** Design complete; no product, migration, or test code implemented

## Outcome

Client-portal identities must not be able to create or operate tenant API keys, and an already-issued client-owned key must not authenticate to any user-key API surface. The authorization kernel must independently enforce same-client record scope for client subjects, and ticket reads must additionally honor the contact's portal visibility-group board scope and client-visible content rules.

The implementation is deliberately layered. No single UI route, RBAC permission, API controller, or row filter is treated as the sole security boundary:

1. API-key management actions reject client users.
2. The key service refuses to issue keys to client users and invalidates existing client-owned keys.
3. Both API-key validation implementations reject client-owned keys before recording use.
4. API context builders reject a client user even if a validator is accidentally bypassed or mocked permissively.
5. API user identity includes the authoritative client derived from the user's contact.
6. The CE and EE authorization kernels apply a fail-closed `same_client` rule to client subjects while leaving internal subjects unchanged.
7. Ticket API queries enforce contact/client and visibility-group board scope before counting or pagination, and client-visible comment/document rules at the content boundary.

Client portal access remains session-based through the existing client-portal actions. Internal user API keys, internal mobile-session keys, temporary AI keys backed by internal users, and explicitly configured system-key paths remain supported.

## Confirmed current behavior

The repository matches the exploit chain described by the card:

- `server/src/lib/actions/apiKeyActions.ts` wraps `createApiKey`, `listApiKeys`, and `deactivateApiKey` in bare `withAuth`. Those functions verify session presence and, for deactivation, key ownership, but do not check `user_type`. The two admin variants only check for a role named `admin`.
- `server/src/components/settings/profile/ApiKeysSetup.tsx` and `server/src/components/settings/security/AdminApiKeysSetup.tsx` place the API-key controls in internal settings, but that placement is not a server authorization boundary.
- `packages/auth/src/services/apiKeyService.ts` will create a key for any supplied user ID. Its validation gate checks inactive/missing owners and suspended tenants, but not owner type.
- `server/src/lib/services/apiKeyServiceForApi.ts` duplicates key validation for tenant-known and tenant-unknown REST requests and has the same missing owner-type check.
- `server/src/middleware.ts` checks only for the presence of `x-api-key` on protected `/api/*` routes. This is intentionally an edge preflight; authoritative validation occurs in the Node route/controller.
- `server/src/lib/api/controllers/ApiBaseController.ts` validates the key and loads the user, but accepts both `internal` and `client` users.
- `server/src/lib/api/middleware/apiAuthMiddleware.ts` and the legacy wrappers in `server/src/lib/api/middleware/apiMiddleware.ts` build authenticated contexts through `findUserByIdForApi` without an internal-user assertion.
- Several controllers copy key validation and user loading instead of exclusively using `ApiBaseController.authenticate`: `ApiContactController.ts`, `ApiProjectController.ts`, `ApiQuickBooksController.ts`, `ApiTeamController.ts`, `ApiTicketController.ts`, `ApiTimeEntryController.ts`, `ApiTimeSheetController.ts`, `ApiUserController.ts`, and `ApiWebhookController.ts`. `server/src/app/api/v1/mobile/auth/apple/link/route.ts` also validates a key directly.
- `packages/users/src/actions/user-actions/findUserByIdForApi.ts` selects `API_USER_CONTEXT_COLUMNS`. `packages/users/src/services/userResponseSanitizer.ts` declares `SafeApiUser.clientId`, but the loader never resolves it from `users.contact_id -> contacts.client_id`.
- `server/src/lib/authorization/kernel/index.ts` creates the CE kernel with an empty `BuiltinAuthorizationKernelProvider`. `ee/server/src/lib/authorization/kernel.ts` does the same before adding enterprise bundle narrowing. For a record, an empty relationship-rule array allows all; without a record, the provider returns `builtin_no_record_scope` and an allow-all scope.
- The `same_client` relationship template already exists in `packages/authorization/src/kernel/relationshipTemplates.ts` and fails to match when either the subject or record has no client ID. Its SQL compiler also emits `1 = 0` when the subject has no client ID.
- Configured built-in relationship rules are an OR-group. Therefore `same_client` and `selected_boards` must not simply be placed in one array: that would allow a ticket from the same client on a hidden board, or a different client's ticket on a visible board.
- `server/src/lib/api/controllers/ApiTicketController.ts` already supplies per-record ticket context and has SQL-aware pagination, but `resolveTicketReadAuthorizationApplier` hard-codes `builtinRules: []`.
- `server/src/lib/api/services/TicketService.ts` applies tenant scope and optional authorization predicates, but does not resolve a client contact's visibility context. `list`, `getById`, `search`, `getTicketComments`, and `getTicketDocuments` can consequently return data broader than the client portal.
- The correct portal policy already exists in `packages/tickets/src/lib/clientPortalVisibility.server.ts` and `packages/tickets/src/lib/clientPortalVisibility.ts`. `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts` restricts tickets to `contacts.client_id`, applies `visibleBoardIds`, hides internal comments/threads, and returns only client-visible documents.

## Security invariants and acceptance criteria

The implementation is complete only when all of these are observable behaviors:

1. A client session invoking `createApiKey`, `listApiKeys`, or `deactivateApiKey` directly receives a permission error and no key-service operation occurs. The same internal-user boundary applies to admin API-key and API-rate-limit settings actions.
2. `ApiKeyService.createApiKey` refuses a client owner even when called outside the server action. Internal mobile and temporary-key callers continue to work.
3. An active, unexpired client-owned key is treated as invalid by both key validators, with or without `x-tenant-id`, before `last_used_at` or usage state is changed.
4. `ApiBaseController`, enhanced API middleware, legacy API middleware, copied controller authentication, `/api/auth/validate-api-key`, document/mobile API-key fallbacks, and the direct Apple-link route cannot establish a user API context for a client-owned key.
5. Rejection uses the existing invalid-key `401` response at API surfaces so it does not disclose that a key is real or identify its owner type. Session server actions use the normal `permissionError`/`403` contract.
6. `findUserByIdForApi` derives `clientId` only from the tenant-scoped contact relation. A missing, deleted, cross-tenant, or client-less contact never produces a client ID.
7. For record-aware kernel decisions, internal subjects retain current RBAC/bundle behavior; a client subject can pass the built-in layer only when `record.clientId === subject.clientId`. A client subject without a resolvable client ID fails closed.
8. CE and EE use the same subject-aware built-in client rule. Enterprise bundle narrowing intersects with it and cannot widen it.
9. The ticket list's data query and count query both apply same-client and visibility-board restrictions before pagination. Per-row fallback decisions have identical results.
10. A client ticket context cannot read a different client's ticket, a hidden-board ticket, internal comments or internal threads, or non-client-visible documents. An empty visibility group returns no tickets; no assigned visibility group preserves the existing portal behavior of all boards for that client.
11. Existing session-based client-portal ticket list/detail/create/comment flows continue to work with their current client and board constraints. The remediation does not make the public REST API a supported client-portal surface.
12. Existing client-owned keys are made permanently inactive; internal-owned keys and system keys are not changed.

## Authorization-boundary map

| Boundary | Current code | Required change | Required proof |
| --- | --- | --- | --- |
| Settings UI | `ApiKeysSetup.tsx`, `AdminApiKeysSetup.tsx` | No security reliance and no required UI change | Direct action invocation is denied for a client despite UI placement |
| Self-service actions | `server/src/lib/actions/apiKeyActions.ts` | Internal-user guard before parse, list, ownership lookup, or mutation | Client denied; internal create/list/deactivate unchanged |
| Admin key actions | `server/src/lib/actions/apiKeyActions.ts` | Internal-user guard before role-name admin check | Client with an admin-like role is still denied |
| Rate-limit settings actions | `server/src/lib/actions/apiKeyRateLimitActions.ts` | Internal-user guard before admin/key lookup | Client cannot inspect or mutate API-key configuration |
| Low-level issuance | `packages/auth/src/services/apiKeyService.ts` | Verify active owner is `internal` before insert | Direct service call cannot mint for a client |
| Existing key state | New server migration | Deactivate all keys whose tenant/user owner is a client | Client keys inactive; internal keys untouched; migration idempotent |
| Edge preflight | `server/src/middleware.ts` | Keep presence-only behavior; document that it is not authority | Missing key rejected at edge; a present client key is rejected in Node |
| Tenant-aware validation | `ApiKeyServiceForApi.validateApiKeyForTenant` | Owner-type gate before use accounting | Client key returns null, records no use, and may be deactivated |
| Tenant-discovery validation | `ApiKeyServiceForApi.validateApiKeyAnyTenant` | Same owner-type gate after resolving key tenant | Same behavior without `x-tenant-id` |
| Legacy validation | `ApiKeyService.validateApiKey` | Same owner-type gate | `/api/auth/validate-api-key` and legacy wrappers reject client keys |
| Base controller context | `ApiBaseController.authenticate` | Explicit internal-user assertion after user load | Permissively mocked validator still cannot admit a client user |
| Shared middleware context | `buildAuthenticatedApiContext`, `authenticateApiKeyRequest`, both `withApiKeyAuth` variants and legacy `withAuth` | Put the explicit assertion in the shared context builder | Wrapper-based routes reject before handlers run |
| Copied controller auth | Nine controller files listed above | Continue to rely on gated validators and call the same user assertion after loading; opportunistically replace copies with the shared helper where behavior is identical | Inventory/contract test prevents an unguarded copied path |
| Direct key routes | Apple link and `/api/auth/validate-api-key` | Rely on gated validators; do not create a context from a client key | Both return the invalid-key response |
| API identity | `findUserByIdForApi.ts`, `userResponseSanitizer.ts` | Resolve authoritative `clientId` from the tenant-scoped contact | Same tenant resolves; missing/cross-tenant association does not |
| RBAC | `hasPermission` and client-flagged permissions | Keep existing portal permissions; do not use `ticket:read` as API audience authorization | Portal still works; API rejects before RBAC for client keys |
| CE/EE kernel | CE and EE kernel factories plus built-in provider | Subject-aware default `same_client` rule for clients only | Same/different/missing-client decision matrix |
| Ticket list SQL | `resolveTicketReadAuthorizationApplier`, `TicketService.list` | Same-client rule plus separate ANDed board filter on data/count | Correct rows, totals, and pages |
| Ticket detail/subresources | `assertTicketReadAllowed`, `TicketService.getById` and child reads | Resolve ticket under client/board scope before child access; filter client-visible content | Hidden/cross-client ticket and content cannot be enumerated |
| Other tenant-wide REST resources | All routes using the shared validators/context builders | Global client-key rejection is the boundary; do not assume every service has row scope | Representative controllers from each auth stack reject the same key |
| System and platform keys | NM Store system branch and EE platform/admin auth | Preserve explicit non-user authentication mechanisms | System context still works; no client user is laundered into it |

## Ordered implementation

### 1. Close API-key issuance and settings actions

Files:

- `server/src/lib/actions/apiKeyActions.ts`
- `server/src/lib/actions/apiKeyRateLimitActions.ts`
- `packages/auth/src/services/apiKeyService.ts`

Add one small, consistently worded internal-user guard for server actions. Run it first in all five exports in `apiKeyActions.ts`, including `adminListApiKeys` and `adminDeactivateApiKey`; an admin role name must not override a client identity. Apply the same guard to all five exports in `apiKeyRateLimitActions.ts`, which are part of the same settings surface and currently rely on UI placement plus an admin role-name check.

The three acceptance-critical self-service actions must return `permissionError` without calling `ApiKeyService`, parsing an expiry, listing keys, or performing the ownership query. Internal users retain the existing return shapes and ownership/admin semantics.

In `ApiKeyService.createApiKey`, look up the owner through `tenantDb(knex, tenant).table('users')` and require a present, active, internal user before generating or inserting the key. This is a second issuance boundary for current callers in `server/src/lib/mobileAuth/mobileAuthService.ts`, `ee/server/src/services/temporaryApiKeyService.ts`, and any future caller. Keep purpose, metadata, usage-limit, expiry, and plaintext-once behavior unchanged. Do not special-case a client user by purpose: a client-owned `mobile_session`, `general`, or temporary key is equally invalid.

### 2. Reject client-owned keys in every validation stack

Files:

- `packages/auth/src/services/apiKeyService.ts`
- `server/src/lib/services/apiKeyServiceForApi.ts`
- `server/src/lib/api/middleware/apiMiddleware.ts`
- `server/src/lib/api/controllers/ApiBaseController.ts`
- The copied-auth controllers listed in the boundary table
- `server/src/app/api/v1/mobile/auth/apple/link/route.ts`

Extend both implementations of the existing owner/tenant gate so `user_type === 'client'` is a rejection reason alongside missing/inactive owner and suspended tenant. Fetch `is_inactive` and `user_type` together through the tenant-scoped user query. Perform the check before usage-limit consumption, `last_used_at`, rate limiting, product checks, permission checks, or handler execution. Return `null` from validators so all existing API handlers produce the same `401 Invalid API key` response as an unknown key.

On detecting a client-owned key, deactivate that exact key as a best-effort security cleanup before returning `null`. The migration in step 3 is the complete sweep; lazy deactivation covers a key created during rolling deployment or missed by historical data cleanup. A cleanup failure must still return `null` and must never turn rejection into an allow.

Add a shared `assertInternalApiUser` (or equivalently named) helper beside the authenticated API context builder. It accepts the already tenant-scoped `SafeApiUser` and throws `UnauthorizedError('Invalid API key')` unless `user_type === 'internal'`. Call it from `buildAuthenticatedApiContext` and directly in `ApiBaseController.authenticate` after `findUserByIdForApi`. This provides a user-context defense even when a validator is mocked, replaced, or regresses.

Every controller-local `findUserByIdForApi` block must call the same assertion before assigning `req.context`. Where a copied block can be replaced safely with `authenticateApiKeyRequest` or the base controller method without changing product gating, tenant context, rate-limit headers, or response envelopes, consolidate it. Otherwise make the one-line assertion explicit. The direct Apple-link route does not load a user today, so its boundary remains the newly gated `ApiKeyServiceForApi`; add a test that locks that dependency in.

Do not move full key validation into edge middleware. The edge runtime remains a cheap presence/CORS boundary, while the Node validators retain database, suspension, user-state, and tenant behavior.

### 3. Permanently deactivate existing client-owned keys

File:

- `server/migrations/20260814120000_deactivate_client_user_api_keys.cjs` (new; adjust the timestamp only if another migration takes it before implementation)

Add a one-way, idempotent data migration that updates active `api_keys` rows to `active = false` and refreshes `updated_at` when an `EXISTS` subquery finds a `users` row with the same `tenant` and `user_id` and `user_type = 'client'`. Both columns are necessary in the join; matching only `user_id` is not sufficient in a multi-tenant database.

Do not delete rows. Keeping inactive records preserves admin inventory and incident/audit context. The down migration must not reactivate keys because it cannot know which rows were active before the security migration. Document the down as intentionally irreversible/no-op.

### 4. Preserve client identity in API subjects

Files:

- `packages/users/src/actions/user-actions/findUserByIdForApi.ts`
- `packages/users/src/services/userResponseSanitizer.ts`
- `packages/types/src/interfaces/user.interfaces.ts` only if the existing optional `clientId` type needs to admit explicit `null`

After loading the safe user fields, resolve a client user's `contact_id` through a tenant-scoped `contacts` query and return its `client_id` as camel-case `clientId`. Do not add `client_id` to `API_USER_CONTEXT_COLUMNS`: it is not a `users` column. Do not accept `x-client-id`, a query parameter, role metadata, or an API-key metadata value as identity.

For internal users, omit or set `clientId` to null. For a client user with no contact, a missing contact, or a contact without a client, leave the client ID unresolved. That client will already be rejected at the API surface, and the kernel rule in step 5 will independently deny record access. Keep sensitive-field sanitization, roles, and avatar resolution unchanged.

### 5. Make built-in same-client scope real in CE and EE

Files:

- `packages/authorization/src/kernel/providers/builtinProvider.ts`
- `packages/authorization/src/kernel/contracts.ts` if a resolver type is added
- `packages/authorization/src/kernel/index.ts`
- `server/src/lib/authorization/kernel/index.ts`
- `ee/server/src/lib/authorization/kernel.ts`
- `server/src/lib/api/controllers/authorizationKernel.ts`
- `server/src/lib/api/controllers/ApiTicketController.ts`

Extend `BuiltinAuthorizationKernelProvider` with a subject-aware relationship-rule resolver while retaining the current static `relationshipRules` option for existing callers. The global default resolver returns `[{ template: 'same_client' }]` only for a client subject and `[]` for an internal subject. Keep the existing OR semantics within a resolved rule set; do not combine `selected_boards` with `same_client` in that OR-group.

When the client rule is active:

- A record with the same non-empty client ID is allowed through the built-in layer.
- A different-client record, a record without `clientId`, or a subject without `clientId` is denied with a deny-all scope.
- A scope-only evaluation without a record must never become an unconstrained client allow. Return a `client_id = subject.clientId` constraint when the client ID is known, and deny when it is missing. Internal no-record behavior may retain `builtin_no_record_scope`.

Use the same default built-in provider construction in `createBuiltinAuthorizationKernel` and `createEnterpriseAuthorizationKernel`. EE bundle rules continue to intersect with the built-in result. This is an edition-independent security invariant, not an enterprise feature.

Update `resolveTicketReadAuthorizationApplier` to obtain the same subject-aware default rules instead of hard-coding `builtinRules: []`. The existing `createTicketRelationshipSqlAdapter` maps `same_client` to `t.client_id`; its current fail-closed `1 = 0` behavior for a missing subject client ID must remain. The per-record path through `authorizeApiResourceRead` and the SQL path must use the same derived subject.

### 6. Apply portal ticket ABAC in `TicketService`

Files:

- `server/src/lib/api/services/TicketService.ts`
- `server/src/lib/api/controllers/ApiTicketController.ts`
- `packages/tickets/src/lib/clientPortalVisibility.server.ts` and `clientPortalVisibility.ts` only for shared helper reuse, not policy duplication

Add a private ticket-service visibility resolver that is a no-op for internal contexts. For a client context it must require `context.user.contact_id`, call `getClientContactVisibilityContext`, and verify the resolved `clientId` agrees with `context.user.clientId`. Any missing/malformed/mismatched relationship produces a deny-all query or a controlled forbidden/not-found result; it must not fall back to tenant-wide access.

Apply the resolved policy as follows:

- `list`: add `t.client_id = visibility.clientId` and `applyVisibilityBoardFilter` to both the data and count builders before limit/offset. This is ANDed with the controller-supplied kernel predicate, not merged into its OR-group.
- `getById`: add client and board predicates to the root ticket query. A hidden or other-client ticket should be indistinguishable from an absent ticket at the detail/subresource boundary.
- `search`: apply the same client and board predicates before selecting results. The controller's per-row kernel remains a second check.
- stats: derive API stats from the already scoped list path; do not call an unscoped aggregate for a client context.
- `getTicketDocuments` and document download lookup: for a client context require `documents.is_client_visible = true` after the ticket itself has passed client/board authorization.
- `getTicketComments`: for a client context require `comments.is_internal = false` and exclude comments whose joined `comment_threads.is_internal` is true, matching `client-tickets.ts`. Apply pagination after visibility filtering.

All ticket-scoped controller methods already call `assertTicketReadAllowed` before most child reads and writes; keep that requirement and add a contract test that every registered ticket subresource continues to do so. The API-wide internal-user gate remains the authority for mutations. Do not interpret the new read filters as approval for a client REST API: the full REST ticket DTO contains fields that have not been reviewed as a client-facing contract.

### 7. Add behavior-first regression coverage

Prefer runtime and DB-backed tests. Source-string tests may inventory duplicated auth paths, but they are not sufficient proof of authorization or query behavior.

#### API-key action and service tests

Add focused tests near `server/src/lib/actions/apiKeyActions.ts` and `apiKeyRateLimitActions.ts`:

- Client user, ordinary client role: create/list/deactivate all return `permissionError`; key service is never called.
- Client user with an admin-like role: admin list/deactivate and all rate-limit actions still return `permissionError`; role lookup and data mutation do not grant access.
- Internal user: valid create/list/self-deactivate behavior and admin behavior retain current result shapes.
- Invalid expiry still returns the existing validation message for an internal user, while a client is denied before input validation.

Extend `packages/auth/src/services/apiKeyServiceSuspensionGate.test.ts` (or split an issuance/validation test file) to cover direct client-owner creation rejection, client-key validation rejection, no `last_used_at` update on denial, internal-key success, missing/inactive owner, suspended tenant, usage limit, and internal mobile/temporary purposes.

#### Authentication-stack tests

Add unit/integration coverage around `apiMiddleware.ts`, `apiAuthMiddleware.ts`, and `ApiBaseController`:

- A validator mock returns a valid key record and `findUserByIdForApi` returns a client user: base controller and shared context builder still return `401` before permission or service execution.
- An internal user succeeds through `ApiBaseController`, `withApiKeyRouteAuth`/enhanced middleware, and legacy `withApiKeyAuth`/`withAuth`.
- A client-owned database key is rejected by both `validateApiKeyForTenant` and `validateApiKeyAnyTenant`; cover requests with and without `x-tenant-id`.
- Representative routes from all three shapes reject the same client key: inherited base controller (`GET /api/v1/tickets`), wrapper route (for example `GET /api/v1/assets`), and a copied-auth custom operation (for example ticket search or stats). Include `/api/auth/validate-api-key` and the mobile Apple-link route.
- The NM Store system-key branch still creates `kind: 'system'` context, and an ordinary user key cannot enter that branch.
- Internal mobile-session keys still authenticate; a client-owned key labelled `mobile_session` does not.

Maintain a small inventory test over the nine copied-auth controllers and direct routes so a new `findUserByIdForApi` context assignment cannot omit `assertInternalApiUser`. The behavioral validator/context tests remain the primary proof.

#### API identity and kernel tests

Replace or supplement `findUserByIdForApiTenantScoped.contract.test.ts` with DB-backed coverage:

- Client user/contact in the same tenant yields the contact's `client_id` as `clientId`.
- Internal user has no derived client scope.
- Missing contact, contact without client, and a same-ID contact in a different tenant do not yield a client ID.
- Sensitive user columns remain absent.

Extend the kernel suites under `server/src/test/unit/authorization/` and `packages/authorization/src`:

- CE and EE/default-provider matrices: internal subject is unchanged; client same-client record allowed; different-client, missing-record-client, and missing-subject-client cases denied.
- No-record client scope is constrained or denied, never allow-all.
- Enterprise bundle allow cannot widen a same-client denial.
- Per-record JavaScript and SQL compilation return identical IDs for internal, same-client, different-client, and missing-client scenarios.
- SQL with a client missing `clientId` contains a deny predicate and returns zero rows.

Update existing policy-matrix fixtures so client subjects that are expected to pass a record/scope decision carry an explicit `clientId`; do not weaken the new default merely to preserve an under-specified fixture.

#### Ticket ABAC and exploit-chain integration tests

Add a DB-backed ticket security suite using two clients, two boards, and a visibility group:

- Client A + visible board is returned by list/search/detail.
- Client A + hidden board is absent.
- Client B + otherwise visible board is absent.
- List `total`, page boundaries, and data agree after both client and board scope.
- No visibility group returns all Client A boards and no Client B tickets, matching current portal semantics.
- An assigned group with zero boards returns zero tickets.
- Missing or cross-client visibility-group state fails closed.
- Internal context returns the same tenant-scoped set as before.
- A visible ticket returns public comments and client-visible documents only; internal comments, internal threads, and non-client-visible documents are absent.
- Hidden/cross-client ticket subresource URLs do not reveal whether comments, documents, assets, materials, or time entries exist.

Add one end-to-end regression for the reported chain: create a client session fixture with client-flagged `ticket:read`, prove the server action cannot mint, insert an historical active key directly as a fixture, and prove it receives `401` from representative ticket, client, user, invoice, and mutation endpoints. Confirm the key did not gain a `last_used_at` update and becomes inactive. Then exercise the normal session-based portal ticket list/detail/comment flow to prove it still sees only the legitimate client/board/public-content set.

#### Migration tests

Run the migration against real test schema rows containing active/inactive internal and client-owned keys in two tenants. Assert only active client-owned rows are deactivated, tenant matching uses both keys, a second run makes no further change, and down does not reactivate anything.

## Verification commands

The implementer should use the repository's workspace scripts as resolved at implementation time. At minimum run:

1. Focused Vitest suites for API-key actions/services, both API middleware stacks, API user loading, authorization kernel/SQL parity, ticket service ABAC, and the migration.
2. The DB-backed server integration suite containing the exploit-chain regression.
3. Existing client-portal ticket visibility suites, including `packages/client-portal/src/actions/client-portal-actions/client-tickets.visibility.test.ts` and `packages/tickets/src/lib/clientPortalVisibility.test.ts`.
4. Existing API E2E ticket authentication/CRUD coverage with an internal key.
5. Typechecks for `packages/auth`, `packages/users`, `packages/authorization`, `packages/tickets`, and `server`.
6. CE and EE server builds, because both authorization-kernel factories change.

Smoke validation should prove two independent journeys:

- As a client-portal contact, normal session-based ticket list/detail/comment behavior remains scoped and usable, while a direct API-key action invocation is denied.
- With an historical client-owned key, `/api/v1/tickets` and another tenant-wide resource return the invalid-key response; with an internal-owned key, the same routes retain current permission-driven behavior.

## Migration, rollout, and compatibility

- There is no schema change. The only migration is an irreversible data cleanup of unsupported client-owned credentials.
- Existing client-owned keys stop working immediately and are deactivated. This is an intentional security break; there is no supported client REST API contract to preserve. Do not silently convert them to tenant integration users or copy them to an internal owner.
- Existing internal keys retain their values, expiry, purpose, usage counts, and rate-limit settings. No broad key rotation is part of this change.
- Internal mobile access remains valid because mobile sign-in already selects internal users and mints `purpose: 'mobile_session'` keys. Add regression coverage rather than a purpose exemption.
- Temporary AI keys remain valid only when their backing owner is internal. If a test or hidden caller currently creates one for a client, treat that as another defect rather than weakening the owner-type invariant.
- Session-first document routes used by the client portal continue to authorize through the session path. Their API-key fallback becomes internal-only, as intended for mobile/API use.
- The global kernel change can expose under-specified client-subject tests or code paths that omitted `clientId`. That is desired fail-closed behavior. Fix legitimate portal callers by deriving identity from the contact; do not insert tenant-wide fallback scope.
- Board visibility and same-client scope must remain two intersecting predicates. Combining them into the current built-in OR array is a release-blocking security regression.
- Apply visibility filters before pagination and count. Filtering a page after fetching can leak totals and create short/empty pages that imply hidden rows.
- Return `401 Invalid API key` for API authentication failure and avoid owner-type detail in responses or logs. Server-action permission errors may remain explicit because the caller already has a session identity.
- During a rolling deployment, the create-time guard, validator gate, lazy deactivation, and data sweep overlap intentionally. Any version that has not yet picked up all layers still encounters another layer; after rollout, the migration and lazy cleanup prevent an old client key from becoming usable if its owner is later converted to internal.
- No feature flag is appropriate for a P1 authorization correction. CE and EE must ship the invariant together.

## Risks and mitigations

- **Incomplete API-auth inventory:** generated/custom controllers contain copied authentication blocks. Mitigate with low-level validator gates, shared context assertions, explicit inventory tests, and representative route tests for each authentication shape.
- **Accidental internal-user denial:** a global static `same_client` rule would deny internal records because internal subjects normally have no client ID. Use a subject-aware resolver and test internal behavior in both editions.
- **OR/AND policy error:** current built-in relationship rules are ORed. Keep global same-client scope separate from ticket board visibility, which must be ANDed in `TicketService`.
- **Identity spoofing:** do not read client scope from headers, request payloads, role names, or key metadata. Resolve it from the tenant-scoped user/contact relation and compare it again in the ticket service.
- **Hidden-content leak after row authorization:** same-client and board checks alone do not hide internal comments or private documents. Filter these in their service queries before pagination or serialization.
- **False confidence from source tests:** existing authorization contracts often inspect source strings. Add runtime and real-query tests for every high-blast-radius boundary.
- **Irreversible credential state:** the migration cannot safely restore prior active flags. This is acceptable because client-owned keys are unsupported and compromised by construction; keep rows rather than deleting them.
- **Portal regression:** do not change client RBAC grants or the portal action flow. Reuse its visibility resolver and keep no-group/all-boards semantics within the authenticated client only.
- **Overclaiming REST safety:** not every REST DTO has client-safe field redaction. Client-key rejection remains mandatory even after kernel and ticket scoping are added.

## Explicitly out of scope

- Designing or enabling a supported client-portal REST API or OAuth/client-credentials product.
- Splitting `ticket:read` into separate portal and public-API permission names. The API audience gate makes that unnecessary for this remediation.
- Retrofitting row-level client scope or client-safe response DTOs into every API service. Client identities are denied globally; ticket scope is added because it is the demonstrated high-risk path and a required independent backstop.
- Changing the session-based client portal's RBAC roles, UX, navigation, ticket creation, or comment workflow.
- Moving database validation into Next edge middleware.
- Changing NM Store, EE platform-admin, MCP admin, webhook-signature, or other non-user-key authentication schemes.
- Rotating or revoking internal-user API keys.
- Building historical access forensics, customer notification, incident response, or audit reporting.
- General authorization-kernel redesign beyond the subject-aware default relationship rule and its SQL parity.
- Deploying, pushing, opening a PR, publishing, merging, or changing workflow state as part of this design-only step.

## Worktree note

`package-lock.json` was already modified before this design session, during environment setup. It is unrelated and must not be included in the design commit or assumed to be part of the implementation.
