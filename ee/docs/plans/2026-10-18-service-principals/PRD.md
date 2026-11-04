# PRD — Service Principals (API and MCP identities that don't take a seat)

- Slug: `service-principals`
- Date: `2026-10-18`
- Status: Draft — open questions resolved 2026-10-18

## Summary

Alga PSA is licensed per internal seat. The seat count is the number of active users with `user_type = 'internal'`. Integrations and AI agents need an identity of their own that is not a person. That identity must not consume a seat, and it must not become a way to get unlicensed people working in the product.

This plan adds **service principals**: non-interactive identities backed by a new `user_type = 'service'`.

- They hold MSP roles and API keys, and MCP agents are one kind of them.
- They cannot sign in to any UI, cannot be given a password, and are not counted as seats.
- They can create and change records as themselves, such as an RMM integration opening alert tickets.
- They can never *be* the person doing the work. A service principal is never a ticket assignee, schedule resource, time-entry owner or approver.
- Any human-work write must name a licensed internal user to act as. The record then stores both the human actor and the principal it came through.
- **Enterprise Edition only, Pro only.**
  - The feature lives under `ee/`, and every database change is an `ee/server/migrations` migration.
  - Community Edition (CE) ships only edition-neutral hardening and the stubs at the edition boundary. The CE schema cannot even hold a service user (see *Edition placement*).
  - Within EE, both kinds (API and MCP agent) need Pro: `TIER_FEATURES.SERVICE_PRINCIPALS`, minimum tier `pro`.
- Pro tenants get a number of service principals and a per-principal rate limit. Usage shows on the license page.

ConnectWise API members and Autotask API-only users are the industry precedent. Both are free and non-interactive, and neither can own billable work.

## Problem

Today the only non-human identity is the EE MCP agent (`ee/server/src/lib/mcp/agents.ts`), and it is a regular seat:

1. **Agents take seats without a seat check.**
   - `createAgent` inserts a backing user with `user_type: 'internal'` (`agents.ts:103-110`).
   - Every seat counter counts active internal users: `getLicenseUsage`, `checkInternalUserLicenseLimit`, the Stripe quantity and the appliance seat guard.
   - But `createAgent` never calls `checkInternalUserLicenseLimit`, so agents can push a tenant past its licensed count. They also inflate the Stripe seat quantity.
2. **Deactivating an agent does not free its seat or cut access.**
   - `setAgentActive` (`agents.ts:142-147`) flips only `agents.active`. The backing user stays active, still counts as a seat, and can still own API keys that authenticate.
   - API-key validation never looks at `agents.active`, so session keys that were already minted stay valid for up to 300 seconds.
3. **Agent users can be turned into people.**
   - Agent backing users show up in Settings → Users, because the MSP tab filters on `user_type === 'internal'`.
   - From there an admin can use "Set password" (`adminChangeUserPassword`, `userActions.ts:1843`), which has no target-type check. That replaces the locked password with a usable one, and credentials login then succeeds.
   - Only the locked password stops an agent user from signing in. The auth layer itself does not.
4. **Agents can be assigned human work.**
   - Nothing stops an agent's backing user from becoming a ticket assignee, a schedule resource or a time-entry owner.
   - `resolveScheduleAssignees` (`packages/clients/src/actions/interactionCreateHelper.ts:257-264`) defaults the schedule assignee to the caller, so an agent that creates an interaction books itself.
   - `TimeEntryService` always writes `user_id: context.userId`, so an agent that logs time becomes the time owner.
5. **Attribution erases the agent.**
   - Every domain row records the backing user's id. Only `mcp_agent_audit` knows which agent acted.
   - `deleteAgent` hard-deletes that audit trail and the user row. That orphans `tickets.entered_by` and similar ids, and the delete fails on any FK reference, such as from comments or time entries.
6. **Plain REST integrations have no non-human identity at all.** An MSP that wires up an RMM or a Zapier flow must issue a key owned by a real, licensed person, so the integration's actions look like that person's.
7. **Per-agent rate limiting doesn't work.** The rate-limit bucket is keyed on `apiKeyId`, and MCP mints a fresh key for every request, so each agent request gets a fresh bucket.

## Goals

1. A first-class, free, non-interactive service-principal identity (`user_type = 'service'`) for REST API integrations and MCP agents. It is an Enterprise Edition, Pro-tier feature implemented under `ee/`.
2. Service principals never count toward seats. Their exclusion comes from the existing `user_type = 'internal'` filters, not from new special cases.
3. No interactive session can ever be created for a service principal. This is enforced in the auth layer on every login and recovery path, not by an unusable password.
4. A service principal can never hold human work. Human-work writes need an explicit act-as licensed internal user, and those records store both the actor and the via-principal.
5. Pro gets a service-principal count limit and a per-principal rate limit.
6. Admins can see service-principal usage next to seat usage.
7. Existing MCP agent backing users are migrated to `service`. Three gaps in today's agent lifecycle are closed:
   - creating an agent is not limit-checked
   - deactivating an agent doesn't cut its access
   - agents appear in user management, with a password action

## Non-goals

- Service principals in Community Edition.
- Restricting *which* humans a principal may act as, such as allow-lists of users or teams. v1 is a single per-principal on/off switch, and act-as is further limited by RBAC intersection (see R5). Allow-lists are an open question.
- Alga acting as an OAuth authorization server, client-credentials issuance or DCR. MCP agents keep delegating to the tenant IdP as they do today.
- A public REST API for managing service principals. Management is through the admin UI and EE server actions. The existing `/api/v1/mcp/agents` routes remain for the MCP kind.
- Agent-specific ABAC bundles (MCP Phase 3).
- Billing a separate SKU for service principals. The entitlement is a plan limit, not a product.
- Changing which data scope a service principal sees. It holds MSP roles, and RBAC governs it exactly as it governs an internal user's roles.
- Rewriting historical attribution. Rows that already reference an agent's backing user stay as they are (see Migration).

## Concepts

| Term | Meaning |
|---|---|
| **Service principal** | A `users` row with `user_type = 'service'`, plus a `service_principals` row holding its metadata. It is the subject for RBAC and the owner of its API keys. |
| **Kind** | `api` (REST integration) or `mcp_agent` (which also has an `agents` row holding its IdP binding). Both are EE only. |
| **Interactive user type** | `internal` or `client`. Only these can hold a UI or mobile session. |
| **MSP principal type** | `internal` or `service`. Both can call the MSP REST API with MSP roles. |
| **Licensed user type** | `internal`. Only this counts as a seat, and only this can hold human work. |
| **Human work** | Any of these roles on a record: ticket assignee or additional resource; schedule-entry assignee; time-entry or time-sheet owner; time-entry or time-sheet approver; project-task assignee or resource; interaction owner. |
| **Principal-attributable write** | Any other write: creating or updating tickets, comments, documents, statuses and so on. A service principal may make these as itself. Its user id goes in `entered_by`, `updated_by`, `closed_by`, `created_by` and the comment author. |
| **Act-as** | A request header (`X-Alga-Act-As: <user_id>`) or MCP call argument that names an active internal user. For that request the human is the effective user and the service principal is the *via-principal*. |
| **Via-principal** | The service principal a human-attributed write came through. It is stored on the record (`*_via_principal_id`) and in the activity or audit log. |

## Edition placement (CE / EE)

Licensing requires the feature to live in the `ee/` tree. The dividing line is simple:

- **EE (`ee/`).** Everything that creates, updates, authenticates, authorizes, limits, rate-limits, attributes, displays or manages a service principal.
- **CE (`server/`, `packages/`, `shared/`).** Only two kinds of code, and neither is service-principal functionality:
  1. edition-neutral hardening that allow-lists the user types each path accepts
  2. stubs at the edition boundary, which EE fills in

On a CE build there is no way to create, authenticate or see a service principal. The CE `users_user_type_check` still allows only `internal` and `client`, so the CE schema cannot even hold one.

The boundary uses the two mechanisms the repo already has:

- **`@product/service-principals/entry`**: a new `packages/product-service-principals` with `oss/entry.ts` and `ee/entry.ts`, aliased in `server/next.config.mjs` and `server/tsconfig.json` the same way as `@product/mcp/entry`. The CE stub rejects and returns nothing. The EE entry re-exports from `ee/server/src/lib/service-principals`.
- **`@enterprise/components/...`**, with CE stubs in `packages/ee/src/components/...` that render `null`. This is the pattern credentials uses (`packages/ee/src/components/credentials/CredentialsScreen.tsx`).

| Piece | Lives in | Notes |
|---|---|---|
| All schema changes: the CHECK widening to `service`, `service_principals`, `agents.service_user_id`, via-principal columns, `tenants.service_principal_limit`, `mcp_agent_audit.act_as_user_id`, the permission seed, and the agent data migration | `ee/server/migrations` | Per `docs/AI_coding_standards.md`, EE-specific DB changes go in the EE overlay. Adding columns to base tables from an EE migration has precedent: `api_keys.agent_id`. |
| Service-principal service: create, update, set active, archive or delete, keys, list | `ee/server/src/lib/service-principals/` | |
| Entitlement constant, limit resolution, `checkServicePrincipalLimit`, usage, tier gate | `ee/server/src/lib/service-principals/` | Only the `TIER_FEATURES.SERVICE_PRINCIPALS` key is in `packages/types`, as with `CREDENTIALS`. |
| Act-as resolution and validation, key gate for service owners, rate-limit subject and config | `ee/server/src/lib/service-principals/`, exposed through `@product/service-principals/entry` | |
| MCP agents rebuilt on the service | `ee/server/src/lib/mcp/agents.ts` | Already EE. |
| Server actions | `ee/server/src/lib/actions/service-principal-actions.ts` | |
| UI: Service principals tab and dialogs, usage row, via label, service-author badge | `ee/server/src/components/service-principals/`, mounted via `@enterprise/components/...`, with CE stubs | The settings tab is registered only when `isEnterprise`. |
| User-type predicates and widened type unions | `packages/types` (CE) | These are names only. In CE nothing creates a `service` value and the CE schema rejects one. |
| `user_type` audit conversions (R2) | CE sites, in place | Behavior is unchanged for `internal` and `client`. |
| Interactive-login hardening (R3) | CE auth | An allow-list of `internal` and `client`, stated without mentioning service principals. |
| API middleware boundary (R4) | CE middleware calls the boundary entry | Owners other than `internal` go to `resolveServicePrincipalApiContext`. The CE stub returns null, which rejects them as today. |
| Generic request-context fields (`principal`, `effectiveUserId`, `viaPrincipalUserId`, rate-limit subject and config override) and the kernel's ability to authorize two subjects together | CE | They default to the plain user, and only EE ever sets them. |
| Human-work guard (assignees and owners must be active internal users) | CE shared write cores | Correct for CE on its own terms. It also closes CE's own gap of accepting any user id. |
| Via-principal stamping helper `withViaPrincipal(ctx, row)` | CE | It adds columns only when `ctx.viaPrincipalUserId` is set. Only the EE boundary sets it, and the columns exist only in the EE schema. |
| User-management exclusion, `user_type` immutability, REST `UserService.create` seat check | CE | Seat-integrity fixes, needed regardless of edition. |

A static guard test (F096) enforces the line. It fails if any file outside `ee/`, `packages/product-service-principals/` or `packages/ee/` references the `service_principals` table, `X-Alga-Act-As`, the `service` key purpose or the service-principal entitlement.

## Users and Primary Flows

Personas: MSP admin (sets up integrations); integration developer (writes against the REST API); AI agent operator (MCP); Nine Minds platform admin (sets tenant overrides).

1. **Create an API service principal.** The admin opens Settings → Security → Service principals (EE only) and clicks "New service principal".
   - They enter a name and description, assign MSP roles, and optionally turn on "Allow act-as".
   - On a tenant below Pro, the tab shows the standard upgrade notice (`TierGate` / `FeatureUpgradeNotice`) instead of the list, and the server refuses creation.
   - On Pro, the service-principal limit is checked first. If the tenant is at its limit, the dialog shows the limit and blocks creation.
   - On save the admin issues an API key owned by the principal. The key is shown once, using the existing key-reveal UI pattern.
2. **Create an MCP agent.** This works as it does today in Settings → MCP server, but the agent is now a service principal of kind `mcp_agent`.
   - It requires Pro, like API principals, and is checked against the service-principal limit instead of seats.
   - It also appears in the Service principals list, with a kind badge, so there is one place to manage it and no duplicate state.
3. **Integration acts as itself.**
   - An RMM creates a ticket with `POST /api/v1/tickets` using the principal's key, and `entered_by` is the principal.
   - It may set `assigned_to` to a human tech. Assigning work to a human is fine, because the principal is not the assignee.
   - It posts a comment, and the comment author shows as the principal's name with a "Service" badge. A principal's own comments are always internal. A customer-visible reply needs act-as, so it comes from a licensed human ("Jane Tech via Datto RMM").
4. **Integration logs human work via act-as.** A dispatch tool calls `POST /api/v1/time-entries` with `X-Alga-Act-As: <tech user_id>`.
   - The call succeeds only if all of these hold:
     - the principal's RBAC allows the action
     - the tech's RBAC allows the action
     - act-as is enabled on the principal
     - the tech is an active internal user
   - The entry is owned by the tech, with `created_by` set to the tech and `created_via_principal_id` set to the principal.
   - Without the header the call fails with `422 ACT_AS_REQUIRED`.
5. **Agent via MCP acts as a human.** The MCP `call` meta-tool accepts an optional `act_as_user_id`, which is forwarded as the act-as header on the loopback dispatch. `mcp_agent_audit` records `act_as_user_id`.
6. **Deactivate.** The admin deactivates a principal of either kind.
   - Its user is marked inactive and its outstanding keys are deactivated. MCP session keys stop working at once, and its slot against the limit frees up.
   - Reactivation is checked against the tier and the limit again.
7. **Delete.**
   - A principal that is referenced anywhere, including audit rows, is **archived**: it is deactivated, its keys are deleted, its IdP binding is released, and it is hidden from lists.
   - A referenced principal is never hard-deleted, and its audit trail is kept.
   - A principal that was never used is hard-deleted.
8. **See usage.** The license and account page shows "Service principals: 3 of 10 (don't use seats)" next to seat usage, with a link to the Service principals settings.

## UX / UI Notes

Use standard components throughout:
- `DataTable`, `Dialog`, `Button`, `Badge` and `Switch`
- the existing key-reveal and copy pattern from `AdminApiKeysSetup`
- the role multi-select used for agents in `McpServerSettings`

Never show raw ids in tables; show the principal name. All of the components below live in `ee/server/src/components/service-principals/`, with CE stubs.

- **Settings → Security → Service principals.** A new tab next to API keys, registered only on EE.
  - A DataTable with columns: Name, Kind badge (API, MCP agent), Roles, Act-as (Yes/No), Status, Keys, Last used, and Created by (as a display name).
  - Row actions: Edit, Manage keys, Deactivate/Activate, Delete or Archive.
  - The header shows "3 of 10 service principals" and a short note that service principals don't use seats.
- **Create/Edit dialog.** Fields:
  - Name
  - Description
  - Roles (MSP roles only)
  - Allow act-as switch, with helper text
  - Rate-limit override (optional, capped at the Pro ceiling)
- **Manage keys.** Lists the principal's keys. The admin can:
  - issue a new key (shown once)
  - revoke a key
  - rotate a key, where the old key gets a grace period through `expireApiKeyAfter`
- **MCP server settings.** The agent list and create flow stay. Behind them is the service-principal backend, and the create flow shows the shared limit.
- **Settings → Users** (CE).
  - Users with non-interactive types never appear in either tab.
  - The user detail page refuses to load one.
  - No password, reset or invite action can target one.
- **API keys admin list.**
  - On EE, keys owned by a principal show the principal name with a "Service" badge, not a username. The name comes from an `@enterprise` cell component.
  - Ephemeral `mcp_agent` session keys stay out of this list, as today.
- **Attribution display.** CE components render the EE `ViaPrincipalLabel` slot, whose CE stub renders nothing.
  - Ticket activity, time-entry details and comment headers render "Jane Tech via Datto RMM" when a via-principal is set.
  - A comment authored by a principal renders the principal's name with a "Service" badge and a service avatar, not a contact avatar.
- **License and account page.** An EE `ServicePrincipalUsageRow` component goes in the EE `AccountManagement` page (`/msp/account`) and the appliance `LicenseManagementPage`, through an `@enterprise` slot.
- **User pickers.** No visual change. The engine already leaves non-interactive users out (see R2.4).

## Requirements

### Functional Requirements

#### R1 — Identity model (EE)

- **R1.1** An EE migration replaces the `users_user_type_check` CHECK constraint so that `service` is allowed. That constraint was created by the knex `enu` in `20241116000000_add_user_type_to_users.cjs`. On CE the constraint is unchanged (`internal | client`). `password_reset_tokens.user_type` stays as `internal | client` in both editions.
- **R1.2** Widen the TypeScript and Zod user-type unions to include `'service'` where a service user can legitimately appear: `IUser`, `shared/interfaces`, `AuthorizationSubject.userType`, `UserSession`, the `findUserByEmail*AndType` params and the event-bus schema. These are shared types in `packages/types`. In CE they are only names: no CE code produces the value, and the CE schema rejects it. Login, SSO and portal types stay `internal | client`.
- **R1.3** An EE migration adds a `service_principals` table, with one row per service user. Columns:
  - `tenant`
  - `user_id` (the principal id)
  - `kind` (`api` | `mcp_agent`)
  - `name`, `description`
  - `allow_act_as` (bool, default false)
  - `rate_limit_max_tokens`, `rate_limit_refill_per_min` (both nullable; per-principal override)
  - `created_by`, `archived_at`, `created_at`, `updated_at`

  `users.is_inactive` is the single source of truth for whether a principal is active. `name` is mirrored into `users.first_name`, so existing user joins render a readable name.
- **R1.4** Add `agents.service_user_id` (uuid) and make it the binding to the backing service user, replacing `metadata.backing_user_id`. Every reader of `backing_user_id` switches to the column.
- **R1.5** Add a single service-principal service in `ee/server/src/lib/service-principals/` with these functions: `createServicePrincipal`, `updateServicePrincipal`, `setServicePrincipalActive`, `archiveOrDeleteServicePrincipal`, `issueServicePrincipalKey` and `listServicePrincipals`.
  - `createAgent`, `setAgentActive` and `deleteAgent` are rewritten on top of it.
  - No other code path may insert or update a `users` row with `user_type = 'service'`.
- **R1.6** A service user is created with no usable password. The auth layer is what blocks login (R3). The locked sentinel is kept only because `hashed_password` is NOT NULL.

#### R2 — `user_type` audit and helpers (CE, edition-neutral)

- **R2.1** Add named predicates in `packages/types`:
  - `isClientUserType(t)`
  - `isMspPrincipalUserType(t)` (internal | service)
  - `isInteractiveUserType(t)` (internal | client)
  - `isLicensedUserType(t)` (internal)
  - `INTERACTIVE_USER_TYPES`
- **R2.2** Convert all 66 non-test `user_type !== 'client'` checks (inventory in `SCRATCHPAD.md`) to the predicate that states their intent:
  - **Portal "require client" guards** (about 45) become `!isClientUserType` → deny. Behavior is unchanged.
  - **"Non-client means MSP data scope" sites** become `isMspPrincipalUserType`. This covers the list-search predicates, ticket and record visibility, document rules, `invoiceQueries`, `TicketService.ts:396` and `policyActions.ts:146`. On EE a service principal keeps MSP scope, by design. On CE behavior is unchanged.
  - **Session and UI sites** become `isInteractiveUserType`: `getSession`, `checkTrackedSession`, `authMiddleware`, `msp/layout`, `signin/page` and `Header`.
  - **`addUser` seat check** (`userActions.ts:557`) becomes `isLicensedUserType`.
- **R2.3** Give an explicit branch for any user type that is neither `internal` nor `client` to every ternary or default that today maps "anything not client" to `internal`, or "anything not internal" to `client`:
  - authorization-subject normalizers: `authorizationKernel.ts:78`, `credentialAuthorization.ts:130`, workflow `crm.ts:969` and `projects.ts:1078`
  - comment author resolution: `comment.ts:99,235`, `commentActions.ts:536`, `commentAuthorResolution.ts:61` and `optimizedTicketActions.ts:3450`
  - `latestActivityActor.ts:75`
  - the mention-recipient kind
  - the `|| 'internal'` defaults in `UserService` and `userActions`
- **R2.4** `User.getAll`, `getAllUsers`, `getAllUsersBasic` and the `UserService` list and search return only interactive user types unless the caller passes `includeNonInteractive: true`.
  - This covers the roughly 30 callers that pass no `userType`.
  - The `userTypeFilter={null}` pickers (`PolicyManagement`, `AdminSessionManagement`) follow the same default.
- **R2.5** Classify the `=== 'internal'` *requirements* that a service principal can reach over REST:
  - Where the check means "MSP-side caller", accept MSP principal types: `TicketService.ts:2785`, `taskCommentService.ts:83,172`, `ApiTimeSheetController`, `ApiTicketController` and the documents routes.
  - Where it means "a human", keep `internal`: reports that run on behalf of a person, tenant branding and theme settings, and so on.
  - Server-action-only checks can stay `internal`, because a service user can never hold the session they need.

  The SCRATCHPAD records the classification for each site.
- **R2.6** Role assignment (`policyActions.ts:453/457`, `roleActions.ts:106/110`) lets an MSP principal type hold MSP roles (`role.msp = true`) and never client roles.
- **R2.7** RBAC (`rbac.ts`, where `isClientPortal = user_type === 'client'`) resolves MSP roles for MSP principal types. Make this explicit with `isMspPrincipalUserType` in all three rbac copies, plus `search/acl.ts`, `tags/permissions.ts`, `user-composition/permissions.ts` and the kernel's `builtinProvider.ts`.

#### R3 — No interactive login for non-interactive types (CE, edition-neutral)

These checks are enforced in the auth layer, independent of the password. They are written as allow-lists of `INTERACTIVE_USER_TYPES` and never name service principals.

- **R3.1** `authenticateUser` (`packages/auth/src/actions/auth.tsx`) rejects any user whose type is not interactive. It also requires an explicit `userType` and removes the untyped `User.findUserByEmail` fallback (`auth.tsx:167`).
- **R3.2** The NextAuth `signIn` callback (`nextAuthOptions.ts:1875`) calls a provider-agnostic `assertInteractiveUser(userId, tenant)`.
  - It re-reads `users.user_type` and `is_inactive`.
  - It returns false *before* any side effect: before `recordLoginSuccess`, `enforceMaxSessions`, `updateLastLogin` and session-row creation.
  - This covers credentials, Google, Azure AD, Keycloak/OIDC and any future provider.
- **R3.3** `checkTrackedSession`, `requireLiveSession` and `sessionAuthMiddleware` replace their three hand-written type lists with the shared `INTERACTIVE_USER_TYPES` constant.
- **R3.4** Mobile: all of these require an active internal user:
  - the handoff route (`auth/mobile/handoff/route.ts`)
  - `issueMobileOtt`, `exchangeOttForSession` and `refreshMobileSession`
  - Apple sign-in, including the already-linked-identity branch, which today has no type or active check
  - IAP restore and provision
- **R3.5** `ApiKeyService.createApiKey` stays internal-owner-only, so `mobile_session` and `mcp_user` keys can only ever belong to internal users. Service-principal keys are never issued through it; EE `issueServicePrincipalKey` writes them directly, the same way `mintAgentSessionKey` does today.
- **R3.6** Password and recovery writes refuse non-interactive targets:
  - `adminChangeUserPassword`
  - the `UserService` password change
  - `PasswordResetService.createResetToken`
  - `completePasswordReset`
  - `setNewPassword`, which also loses its untyped `findUserByEmail` fallback

  The internal invite flow never matches an existing non-interactive user.
- **R3.7** Remove the stale untyped lookup at `ssoPreferences.ts:159`.
- **R3.8** Delete the unused duplicate `export const options` / `validateUser` block in `nextAuthOptions.ts:2387-3180`, so there is one auth config to keep correct. Confirm it has no importers first.
- **R3.9** The Next middleware (`server/src/middleware.ts`) and `msp/layout.tsx` redirect any session with a non-interactive type to sign-in, not to the client portal.

#### R4 — API authentication and request context

- **R4.1** (CE)
  - `buildAuthenticatedApiContext` keeps today's internal path unchanged.
  - For an owner that is neither `internal` nor `client`, it calls `resolveServicePrincipalApiContext(keyRecord, user, req)` from `@product/service-principals/entry`.
    - The CE stub returns `null`, so the key is rejected as today.
    - The EE implementation (R4.6) returns a full context.
  - `assertInternalApiUser` becomes `assertApiPrincipal(context)`. It accepts an internal user, or a context whose `principal.kind === 'service'` was produced by the boundary entry. It is applied at every current caller: `ApiBaseController.authenticate`, `ApiTicketController`, `ApiTimeSheetController`, `ApiContactController` and the documents routes.
- **R4.2** (CE) Both `getKeyGateReason` copies (`packages/auth/.../apiKeyService.ts` and `server/src/lib/services/apiKeyServiceForApi.ts`) switch from a block-list to an allow-list:
  - active `internal` owners pass
  - `client` is rejected
  - any other type passes only if the boundary entry's `servicePrincipalKeyGate` approves it; the CE stub rejects
- **R4.3** (CE) `ApiContext` gains these generic fields. They default to the plain key owner, and only the EE boundary sets anything else:
  - `principal` (`{ userId, userType, kind: 'user' | 'service' }`)
  - `actAsUserId`
  - `effectiveUserId`
  - `rateLimitConfig` (an optional override)

  `context.userId` keeps meaning "effective user", so any service that writes `context.userId` records the human automatically under act-as. The `ApiKey` type gains `agent_id`.
- **R4.4** (CE) `ServiceContext` (`packages/db/src/services/BaseService.ts`) carries `viaPrincipalUserId`. The single helper `withViaPrincipal(ctx, row)` adds the via column only when that is set.
- **R4.5** (EE) The MCP `jsonRpcServer` loopback forwards `act_as_user_id` as `X-Alga-Act-As` and records it in `mcp_agent_audit.act_as_user_id`.
- **R4.6** (EE) `resolveServicePrincipalApiContext`:
  - confirms the owner is an active, non-archived service principal
  - applies R5.1 act-as validation
  - sets `principal`, `actAsUserId`, `effectiveUserId` and `viaPrincipalUserId`
  - sets `rateLimitSubjectId = sp:<user_id>` and `rateLimitConfig` (R6.4)

#### R5 — Attribution and act-as

- **R5.1** (EE) `X-Alga-Act-As: <user_id>` is honored only when all of these hold. Any failure rejects the request:
  - the authenticated principal is a service principal with `allow_act_as = true` (else `403 ACT_AS_NOT_ALLOWED`)
  - the target is an active internal user in the same tenant (else `422 ACT_AS_INVALID_TARGET`)
  - the key is not human-owned. The header on a human-owned key is rejected in CE middleware with `400 ACT_AS_NOT_SUPPORTED`, which is a generic "unknown delegation header" rejection.
- **R5.2** RBAC under act-as is the **intersection** of both subjects: an action is allowed only if the principal's roles allow it *and* the act-as user's roles allow it. A principal cannot borrow a more privileged human to escalate, and a human cannot be used for work they couldn't do themselves.
  - The CE kernel gains a generic ability to authorize two subjects together, which only EE invokes.
  - Record-level rules apply with the human as the subject too.
- **R5.3** (CE) A single human-work guard, `assertHumanWorkAssignee(trx, tenant, userIds)`, requires active `internal` users. Calling it from the shared write cores, not per endpoint, means UI, REST, workflow and MCP all get it. Call sites:
  - `addTicketResourceCore`, `assignTeamToTicketCore`, and ticket create/update `assigned_to` (`TicketService` and the ticket actions)
  - `ScheduleEntry.create` / `updateAssignees`
  - time-entry create/update (owner)
  - time-sheet create (owner) and approve (`approved_by`)
  - time-entry approval
  - project task `assigned_to` and `task_resources`
  - interaction create (owner)

  The guard only checks fields that the write sets or changes, so unrelated edits don't re-validate existing references. It is correct in CE on its own terms, because today any user id is accepted in these fields.
- **R5.4** Writes that default ownership to the caller must not default to anyone other than a licensed user. These all use `effectiveUserId`:
  - `resolveScheduleAssignees`
  - `TimeEntryService`'s `user_id: context.userId`
  - `TimeSheetService`'s `approved_by: context.userId`
  - the interaction owner

  If the effective user is not internal, the CE guard throws `HumanWorkOwnerRequiredError(field)`. The EE boundary maps that error to `422 ACT_AS_REQUIRED` with act-as guidance, because only EE knows that act-as exists.
- **R5.5** (EE migration) Add nullable uuid via-principal columns. Like other relations here, they are enforced in the app, not by DB constraints:
  - `time_entries.created_via_principal_id` and `time_entries.updated_via_principal_id`
  - `time_sheets.approved_via_principal_id`
  - `schedule_entries.created_via_principal_id`
  - `interactions.created_via_principal_id`
  - `comments.created_via_principal_id`
  - `tickets.entered_via_principal_id`
  - `project_tasks.created_via_principal_id`
  - `ticket_audit_logs.via_principal_user_id`
  - `mcp_agent_audit.act_as_user_id`

  The writers stamp these through `withViaPrincipal`.
- **R5.6** Ticket activity log:
  - When a principal acts as itself, `ticket_audit_logs` gets `actor_type = 'service_principal'` with `actor_user_id` set to the service user. `actor_type` is a plain string column, so no constraint change is needed.
  - Under act-as, the row has `actor_type = 'user'`, `actor_user_id` set to the human and `via_principal_user_id` set to the principal.
  - The generic `auditLog()` records `via_principal_user_id` in `details`.
- **R5.7** Comments authored by a service principal are stored with `author_type = 'internal'` (the real `comment_author_type` enum is `internal|client|unknown`, not `user|contact|unknown`), so the enum doesn't change. CE display resolution treats a user of a non-interactive type as a named non-human author, never as a client or contact. The EE `ServiceAuthorBadge` slot adds the "Service" badge and avatar.
- **R5.8** Attribution display: the ticket activity feed, the time-entry detail and the comment header render the EE `ViaPrincipalLabel` slot, "<human> via <principal name>", when the via column is set.
- **R5.9 Customer-visible comments are human work.** Talking to the customer is core help-desk work, so only a licensed human (or the client themselves) may author a customer-visible comment.
  - **The rule (CE, in the ticket-comment write core).** A comment whose author is not an interactive user type must be internal (`is_internal = true`). It applies to every caller: UI, REST, workflow and MCP.
  - **When the caller doesn't specify visibility.** A non-interactive author's comment defaults to internal. It is never silently made public.
  - **When the caller explicitly asks for public.** An explicit `is_internal = false` from a non-interactive author throws `HumanWorkOwnerRequiredError('is_internal')`, and the EE boundary maps that to `422 ACT_AS_REQUIRED`. We don't silently flip the comment to internal, so the integration finds out its intent wasn't honored.
  - **Under act-as.** The author is the human, so a public comment is allowed and is stamped with `created_via_principal_id`.
  - Client-portal and inbound-email comments are unaffected, because their authors are interactive (`client`) or contacts.

#### R6 — Entitlements (EE)

- **R6.0 Pro-only gate.**
  - Add `TIER_FEATURES.SERVICE_PRINCIPALS` in `packages/types` with `FEATURE_MINIMUM_TIER = 'pro'`. Use the namespace-member pattern that `CREDENTIALS` uses, so existing exhaustive label maps keep compiling.
  - The gate covers both kinds. It is enforced with `assertTenantTierAccess` at these points:
    - `createServicePrincipal` (and so `createAgent`)
    - reactivation
    - `issueServicePrincipalKey` (issue and rotate)
    - turning on `allow_act_as`
  - Below Pro, these return the existing `TIER_ACCESS_DENIED` (403).
  - Solo is defunct and needs no special handling: it ranks below Pro and is gated out like `essentials`.
- **R6.0a Existing principals below Pro are grandfathered.**
  - A non-Pro tenant keeps its existing principals working: their keys authenticate and their MCP tokens resolve.
  - It cannot create principals, reactivate them or issue keys until it is on Pro.
  - The same applies when a Pro tenant drops below Pro. Nothing is deactivated or deleted; only new work is blocked.
- **R6.1** `SERVICE_PRINCIPAL_ENTITLEMENT` (Pro) in `ee/server/src/lib/service-principals/entitlements.ts` holds:
  - `maxPrincipals: 10`, a flat number that does not scale with seats
  - the default per-principal rate limit and ceiling: `maxTokens: 120`, `refillPerMin: 60`, which matches today's per-key API default, so an integration moving off a human's key sees no change

  The cap is the main guard against "one bot per unlicensed person", since a principal can still act as itself.
- **R6.2** Where the limit comes from depends on the deployment:
  - **Hosted (no `license_state` row).** Use `tenants.service_principal_limit` if set. It is a nullable override that only a Nine Minds platform admin can change, in the style of `licensed_user_count`. Otherwise use the Pro default.
  - **Appliance (`license_state` row present).**
    - **Trust only the signed license.** Use the `service_principals` claim from the verified license token (`verifyLicense`, as `userSeatGuard.ts` does for `seats`). `tenants.service_principal_limit` is **ignored**, because the appliance owner controls that database and could raise their own limit.
    - **When there is no claim to use.** If the claim is missing, or the token can't be read or verified, use the Pro default. This means "the default", never "unlimited". The seat guard is deliberately the opposite: it fails open so it never blocks a user from being created.
    - **The appliance tier still has to be Pro.** It is resolved by `resolveSelfHostTier`, as today.
  - The claim is read in EE (`ee/server/src/lib/service-principals/entitlements.ts`) from the verified claims object. Nothing about it is added to the shared `packages/licensing` claim types, to keep the edition boundary intact.
- **R6.3** `checkServicePrincipalLimit(trx, tenant)` counts active service users. Archived principals are inactive, so they don't count. Deleting a principal always frees its slot.
  - It runs in `createServicePrincipal` and on reactivation, after the R6.0 tier check and in the same transaction as the write. This follows the pattern of `checkInternalUserLicenseLimit`.
  - At the limit it returns `SERVICE_PRINCIPAL_LIMIT_REACHED` with a readable message.
- **R6.4** Per-principal rate limits:
  - The EE boundary sets the token bucket subject to `sp:<principal user_id>`, whatever key was used. That includes MCP's per-request minted keys, which finally makes agent rate limiting work.
  - It also sets `rateLimitConfig` from the principal's own override, falling back to the Pro default. A per-key row in `api_rate_limit_settings` still wins.
  - CE `enforce.ts` gains generic support for a context-supplied config override.
  - An override can't exceed the Pro ceiling. On hosted tenants, only a Nine Minds platform override can raise the ceiling. On appliances, the ceiling is the Pro default.
  - Throttling still follows `RATE_LIMIT_ENFORCE`.
- **R6.5** Seat checks stay separate. Creating a service principal never calls `checkInternalUserLicenseLimit`, and creating an internal user never counts service principals.

#### R7 — Usage visibility (EE)

- **R7.1** `getServicePrincipalUsage(tenant)` returns `{ limit, used, remaining }`.
- **R7.2** The EE `ServicePrincipalUsageRow` sits beside seats on the account page (`AccountManagement.tsx`) and on the appliance `LicenseManagementPage`.
  - It reads "Service principals don't use seats" and links to the settings tab.
  - Below Pro it reads "Available on Pro", plus the count of any grandfathered principals.
- **R7.3** On Pro, the header of the Service principals tab shows the same usage and disables "New" at the limit.
  - Below Pro, the tab and the MCP agent create flow render the standard `TierGate` / `FeatureUpgradeNotice`, driven by `useTierFeature(TIER_FEATURES.SERVICE_PRINCIPALS)`.
  - Grandfathered principals stay listed. They can be deactivated or deleted, but not created, reactivated or given new keys.

#### R8 — Lifecycle and the gaps that exist today

- **R8.1** (EE) `createAgent` creates a service principal of kind `mcp_agent` through R1.5. It requires Pro (R6.0) and is checked against the service-principal limit, not seats. MCP agents have no tier gate today, so this is a new restriction for non-Pro EE tenants.
- **R8.2** (EE) `setServicePrincipalActive(false)`, and so `setAgentActive(false)`, does both of these in one transaction:
  - sets `users.is_inactive = true` and, for `mcp_agent`, `agents.active = false`
  - deactivates every active key the principal owns, including outstanding `mcp_agent` session keys, so access ends immediately

  Reactivation reverses the flags and is limit-checked. It does not revive keys; the admin issues new ones.
- **R8.3** (EE) `archiveOrDeleteServicePrincipal`:
  - If the principal is referenced anywhere (any attribution column, via column, audit row, `mcp_agent_audit` or ticket activity), it is archived. It is deactivated, its keys are deleted, `archived_at` is set, its IdP binding (`idp_issuer` / `idp_subject`) is cleared so the subject can be bound again, and it is hidden from lists.
  - Otherwise it is hard-deleted along with its roles and keys.
  - `mcp_agent_audit` is never deleted.

  This replaces today's `deleteAgent`, which deletes the audit trail and fails on FK references.
- **R8.4** (CE) User management never shows a non-interactive user.
  - The Settings → Users MSP tab filters with `isLicensedUserType`.
  - The user detail loader rejects non-interactive ids.
  - `adminChangeUserPassword`, `deleteUser`, invite and reactivate refuse non-interactive targets.
- **R8.5** (CE) `user_type` is immutable through user management. REST `UserService.update` (`UserService.ts:346`) and the user actions reject any change to `user_type` other than between `internal` and `client`, where that is already allowed. A user can therefore never be turned into a service user to dodge a seat, nor a service user into a person without a seat check.
- **R8.6** (CE) REST `UserService.create` (`UserService.ts:228+`) accepts only `internal` and `client`, and calls `checkInternalUserLicenseLimit` for `internal`. Today it has no seat check at all; this gap was found while grounding the plan.

#### R9 — Migration (EE)

- **R9.1** EE migration (`ee/server/migrations`), schema:
  - replace `users_user_type_check` to allow `service`
  - create `service_principals`
  - add `agents.service_user_id`
  - add the via-principal columns
  - add `tenants.service_principal_limit`
  - add `mcp_agent_audit.act_as_user_id`
  - add the `service_principal` permission resource and seed it to the Admin role
- **R9.2** EE migration, data (ordered after R9.1). For every `agents` row:
  - set the backing user to `user_type = 'service'`
  - set `is_inactive = NOT agents.active`, which fixes existing drift
  - set `first_name` to the agent name
  - backfill `agents.service_user_id` from `metadata.backing_user_id`
  - insert a `service_principals` row with kind `mcp_agent`

  The migration is idempotent. It skips, and logs, any backing user that is missing or no longer `internal`.
- **R9.3** The migration never deactivates or deletes anything to fit the new tier gate or limit. Non-Pro tenants with agents, and Pro tenants over the limit, keep their principals working (R6.0a). Only new creation is blocked.
- **R9.4** Historical rows that point at a former agent user as an assignee, schedule resource or time owner are left alone. A pre-flight count query is in the SCRATCHPAD runbook. The R5.3 guard applies only when such a field is next changed.

### Non-functional Requirements

- **Edition boundary.** CE builds contain no service-principal functionality. The static guard (F096) and a CE build check enforce the boundary described in *Edition placement*.
- **Citus.** `users` and the attribution tables are distributed.
  - The CHECK replacement must work on a distributed table: use `ALTER TABLE … DROP CONSTRAINT`, then `ADD CONSTRAINT … NOT VALID`, then `VALIDATE`. Verify on `alga-regression-citus`.
  - New columns must not use `now()` inside `CASE` or `COALESCE` (see the 2026-10-13 outage).
- **Tenant isolation.** Every new query goes through `tenantDb`.
- **Fail closed.** The act-as, type, tier and limit checks throw on lookup errors and never allow.

## Data / API / Integrations

All schema changes are in `ee/server/migrations`.

- **New table** `service_principals(tenant, user_id, kind, name, description, allow_act_as, rate_limit_max_tokens, rate_limit_refill_per_min, created_by, archived_at, created_at, updated_at)`. Primary key `(tenant, user_id)`; index on `(tenant, kind)`.
- **New columns:**
  - `agents.service_user_id`
  - `tenants.service_principal_limit`
  - `mcp_agent_audit.act_as_user_id`
  - the via-principal columns in R5.5
- **API key purpose:** `service` (new). These keys are issued only by EE `issueServicePrincipalKey`.
- **Headers:** `X-Alga-Act-As` (request; EE). Rate-limit response headers are unchanged.
- **Error codes:**

  | Code | Status | Raised by |
  |---|---|---|
  | `ACT_AS_REQUIRED` | 422 | EE, from CE's `HumanWorkOwnerRequiredError` |
  | `ACT_AS_NOT_ALLOWED` | 403 | EE |
  | `ACT_AS_INVALID_TARGET` | 422 | EE |
  | `ACT_AS_NOT_SUPPORTED` | 400 | CE |
  | `HUMAN_WORK_ASSIGNEE_INVALID` | 422 | CE |
  | `SERVICE_PRINCIPAL_LIMIT_REACHED` | 409 | EE |
  | `TIER_ACCESS_DENIED` | 403 | existing |

- **OpenAPI:**
  - Document the act-as header and the EE error codes on the affected routes, marked Enterprise.
  - Correct the stale `userTypeSchema` (`server/src/lib/api/schemas/userSchemas.ts:40`). It lists `admin` and `contractor`, which the DB never allowed. `create` and `update` accept only `internal | client`.
  - Regenerate `server/src/lib/mcp/registry.generated.ts` and `ee/server/src/chat/registry/apiRegistry.generated.ts`.
- **MCP:** the `call` meta-tool gets an optional `act_as_user_id` argument.

## Security / Permissions

- An EE migration seeds a new RBAC resource `service_principal` (`read`, `create`, `update`, `delete`) to Admin.
  - Turning on `allow_act_as` needs `service_principal:update`.
  - The MCP agent admin routes check `service_principal:*` in addition to the existing Admin requirement.
- A service principal can't manage service principals, or other principals' API keys, even if it holds Admin. Those server actions need an interactive session, and the REST surface doesn't expose them.
- **Accepted residual risk.** Unlicensed people could run work *through* a principal as the principal, for example creating tickets or comments as the bot. They still cannot own work, log time, be scheduled or approve. ConnectWise and Autotask draw the same boundary.

## Observability

Nothing new beyond the attribution and audit columns above. Existing rate-limit metrics pick up the `sp:<id>` subject automatically.

## Rollout / Migration

- Ship R9.1 and R9.2 together with R3 and R4. Agent users then become `service` in the same release that teaches the API layer (through the EE boundary) to accept them, so MCP dispatch never breaks.
- **Seat and billing effect.** Tenants with MCP agents see their seat count drop by their agent count. On hosted Stripe tenants, the next quantity sync lowers the billed seat quantity to match. That is correct, but it is a billing change, so tell support and finance in advance.
- No feature flag. The change only tightens behavior (login, assignment) and corrects counts, and the new UI ships with it.
- **CE.** The CE schema and behavior for `internal` and `client` users are unchanged, apart from the edition-neutral hardening (R2, R3, R5.3, R8.4–R8.6).
- **Tier change for MCP agents.** On EE tenants below Pro (essentials appliances), existing agents keep working but new ones need Pro. Hosted tenants with a null plan resolve to Pro and see no change. Put this in the release notes.
- **Cross-service dependency: alga-license.**
  - Appliance licenses need a new signed `service_principals` claim, issued next to `seats` by the alga-license service. The appliance console (`algaLicenseAdminClient.ts`) and the Stripe-backed appliance subscription flows pass it through.
  - Until a license carrying the claim is issued, Pro appliances get the Pro default of 10. This plan ships safely before the issuer change.
- **Breaking change for integrations.** REST callers that log time or approve sheets with a principal-owned key get `ACT_AS_REQUIRED`. No such callers exist yet, because service principals don't exist before this release. MCP agents that used to log time as themselves now need `act_as_user_id`, so document it in the MCP tool description.

## Open Questions

None remain. All were resolved by Robert on 2026-10-18:

| Question | Decision | Where |
|---|---|---|
| Edition and tier | EE only, implemented under `ee/`; Pro only, for both kinds | *Edition placement*, R6.0 |
| Principals on a tenant that is below Pro | Grandfathered: they keep working, but nothing new can be added | R6.0a |
| Pro principal limit | A flat 10; it does not scale with seats | R6.1 |
| Default per-principal rate limit | 120 burst / 60 per minute, the same as today's per-key default | R6.1 |
| Where an appliance's limit comes from | The signed `service_principals` claim only. The tenants override is ignored, and a missing claim means the Pro default. | R6.2 |
| Act-as scope | A per-principal on/off switch plus RBAC intersection; no allow-lists in v1 | R5.1, R5.2, Non-goals |
| A principal's own comments | Always internal. A customer-visible comment needs act-as. | R5.9 |
| Interaction owner | Human work, so it needs act-as | R5.3, R5.4 |
| Archived principals | Don't count toward the limit | R6.3 |

## Acceptance Criteria (Definition of Done)

1. **EE schema and migration.** On EE, `users.user_type` accepts `service`. MCP agents and API principals are created as `service` users with `service_principals` rows, and existing agent users are migrated.
2. **CE stays clean.** On CE the schema still rejects `service`, and the build contains no service-principal functionality. The static guard passes.
3. **Seats and limits.** Seat usage, the seat guard, the Stripe quantity and the appliance seat guard exclude service users without any new special case. Creating or reactivating a principal of either kind requires Pro, then checks the service-principal limit instead of seats. Existing principals below Pro keep working.
4. **No sessions.** A non-interactive user cannot get a session through any of:
   - credentials or any SSO provider
   - mobile: handoff, OTT, refresh, Apple or IAP
   - the vanity-domain exchange
   - password reset or invite

   An admin cannot set its password. Each path is covered by a test that does not rely on the locked password.
5. **API access.** A service principal can call `/api/v1` with its key, under its MSP roles, and is rate-limited per principal across MCP's rotating keys.
6. **No human work.** A service principal can never be stored as a ticket assignee or resource, schedule assignee, time-entry or time-sheet owner, approver, project-task assignee or interaction owner, whether through UI, REST, workflow or MCP. Writes that would default to it fail with `ACT_AS_REQUIRED`.
7. **Comments.** A principal's own ticket comments are always internal. Asking for a public one without act-as fails with `ACT_AS_REQUIRED`.
8. **Act-as attribution.** With act-as enabled and a valid target, human-work writes record the human as the actor and the principal in the via column and the activity log. RBAC is the intersection of both.
9. **Deactivate and delete.** Deactivating a principal immediately stops all its keys, including MCP session keys, and frees its slot. Deleting a used principal archives it and keeps the audit trail.
10. **User management.** Settings → Users never lists a non-interactive user, and no password, reset, invite or delete action can target one. `user_type` cannot be changed to or from `service` through user management.
11. **Usage display.** On Pro, the license and account page and the Service principals tab show `used of limit`. Below Pro, they show the standard upgrade notice.
12. **Audit complete.** All 66 `!== 'client'` sites and the REST-reachable `=== 'internal'` requirements are converted to named predicates, and the SCRATCHPAD inventory is marked complete.
