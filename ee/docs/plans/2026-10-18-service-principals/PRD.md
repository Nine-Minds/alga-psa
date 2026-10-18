# PRD — Service Principals (API and MCP identities that don't take a seat)

- Slug: `service-principals`
- Date: `2026-10-18`
- Status: Draft

## Summary

Alga PSA is licensed per internal seat. The seat count is the number of active users with `user_type = 'internal'`. Integrations and AI agents need an identity of their own that is not a person. That identity must not consume a seat, and it must not become a way to get unlicensed people working in the product.

This plan adds **service principals**: non-interactive identities backed by a new `user_type = 'service'`.

- They hold MSP roles and API keys, and EE MCP agents are one kind of them.
- They cannot sign in to any UI, cannot be given a password, and are not counted as seats.
- They can create and change records as themselves, such as an RMM integration opening alert tickets.
- They can never *be* the person doing the work. A service principal is never a ticket assignee, schedule resource, time-entry owner or approver.
- Any human-work write must name a licensed internal user to act as. The record then stores both the human actor and the principal it came through.
- Each plan gets a number of service principals and a per-principal rate limit. Usage shows on the license page.

ConnectWise API members and Autotask API-only users are the industry precedent. Both are free and non-interactive, and neither can own billable work.

## Problem

Today the only non-human identity is the EE MCP agent (`ee/server/src/lib/mcp/agents.ts`), and it is a regular seat:

1. **Agents take seats without a seat check.** `createAgent` inserts a backing user with `user_type: 'internal'` (`agents.ts:103-110`). Every seat counter counts active internal users: `getLicenseUsage`, `checkInternalUserLicenseLimit`, the Stripe quantity and the appliance seat guard. But `createAgent` never calls `checkInternalUserLicenseLimit`, so agents can push a tenant past its licensed count. They also inflate the Stripe seat quantity.
2. **Deactivating an agent does not free its seat or cut access.**
   - `setAgentActive` (`agents.ts:142-147`) flips only `agents.active`. The backing user stays active, still counts as a seat, and can still own API keys that authenticate.
   - API-key validation never looks at `agents.active`. Session keys that were already minted stay valid for up to 300 seconds.
3. **Agent users can be turned into people.**
   - Agent backing users show up in Settings → Users, because the MSP tab filters on `user_type === 'internal'`.
   - From there an admin can use "Set password" (`adminChangeUserPassword`, `userActions.ts:1843`), which has no target-type check. That replaces the locked password with a usable one, and credentials login then succeeds.
   - Only the locked password stops an agent user from signing in. The auth layer itself does not.
4. **Agents can be assigned human work.**
   - Nothing stops an agent's backing user from becoming a ticket assignee, a schedule resource or a time-entry owner.
   - `resolveScheduleAssignees` defaults the schedule assignee to the caller (`packages/clients/src/actions/interactionCreateHelper.ts:257-264`), so an agent that creates an interaction books itself.
   - `TimeEntryService` always writes `user_id: context.userId`, so an agent that logs time becomes the time owner.
5. **Attribution erases the agent.** Every domain row records the backing user's id. Only `mcp_agent_audit` knows which agent acted. `deleteAgent` then hard-deletes that audit trail and the user row. That orphans `tickets.entered_by` and similar ids, and fails on any FK reference such as comments or time entries.
6. **Plain REST integrations have no non-human identity at all.** An MSP that wires up an RMM or a Zapier flow must issue a key owned by a real, licensed person. The integration's actions then look like that person's actions.
7. **Per-agent rate limiting doesn't work.** The rate-limit bucket is keyed on `apiKeyId`, and MCP mints a fresh key for every request. Each agent request therefore gets a fresh bucket.

## Goals

1. A first-class, free, non-interactive service-principal identity (`user_type = 'service'`) for REST API integrations (CE and EE) and MCP agents (EE).
2. Service principals never count toward seats. Their exclusion comes from the existing `user_type = 'internal'` filters, not from new special cases.
3. No interactive session can ever be created for a service principal. This is enforced in the auth layer on every login and recovery path, not by an unusable password.
4. A service principal can never hold human work. Human-work writes need an explicit act-as licensed internal user, and those records store both the actor and the via-principal.
5. Each plan gets a service-principal entitlement (a count limit) and a per-principal rate limit.
6. Admins can see service-principal usage next to seat usage.
7. Existing MCP agent backing users are migrated to `service`. The three lifecycle gaps are closed: no limit check on create, deactivate that doesn't cut access, and agents visible in user management with a password action.

## Non-goals

- Restricting *which* humans a principal may act as, such as allow-lists of users or teams. v1 is a single per-principal on/off switch, and act-as is further limited by RBAC intersection (see R5). Allow-lists are an open question.
- Alga acting as an OAuth authorization server, client-credentials issuance or DCR. MCP agents keep delegating to the tenant IdP as they do today.
- A public REST API for managing service principals. Management is through the admin UI and server actions. The existing `/api/v1/mcp/agents` routes remain for the MCP kind.
- Agent-specific ABAC bundles (MCP Phase 3).
- Billing a separate SKU for service principals. The entitlement is a plan limit, not a product.
- Changing which data scope a service principal sees. It holds MSP roles, and RBAC governs it exactly as it governs an internal user's roles.
- Rewriting historical attribution. Rows that already reference an agent's backing user stay as they are (see Migration).

## Concepts

| Term | Meaning |
|---|---|
| **Service principal** | A `users` row with `user_type = 'service'`, plus a `service_principals` row holding its metadata. It is the subject for RBAC and the owner of its API keys. |
| **Kind** | `api` (REST integration, CE and EE) or `mcp_agent` (EE; also has an `agents` row with the IdP binding). |
| **Interactive user type** | `internal` or `client`. Only these can hold a UI or mobile session. |
| **MSP principal type** | `internal` or `service`. Both can call the MSP REST API with MSP roles. |
| **Licensed user type** | `internal`. Only this counts as a seat, and only this can hold human work. |
| **Human work** | Ticket assignee, additional ticket resource, schedule-entry assignee, time-entry owner, time-sheet owner, time-entry or time-sheet approver, project-task assignee or resource, and interaction owner. |
| **Principal-attributable write** | Any other write: creating or updating tickets, comments, documents, statuses and so on. A service principal may make these as itself. Its user id goes in `entered_by`, `updated_by`, `closed_by`, `created_by` and the comment author. |
| **Act-as** | A request header (`X-Alga-Act-As: <user_id>`) or MCP call argument that names an active internal user. For that request the human is the effective user and the service principal is the *via-principal*. |
| **Via-principal** | The service principal a human-attributed write came through. It is stored on the record (`*_via_principal_id`) and in the activity or audit log. |

## Users and Primary Flows

Personas: MSP admin (sets up integrations); integration developer (writes against the REST API); AI agent operator (EE MCP); Nine Minds platform admin (sets tenant overrides).

1. **Create an API service principal.** The admin opens Settings → Security → Service principals and clicks "New service principal".
   - They enter a name and description, assign MSP roles, and optionally turn on "Allow act-as".
   - The service-principal limit is checked first. If the tenant is at its limit, the dialog shows the limit and blocks creation.
   - On save the admin issues an API key owned by the principal. The key is shown once, using the existing key-reveal UI pattern.
2. **Create an MCP agent (EE).** This works as it does today in Settings → MCP server, but the agent is now a service principal of kind `mcp_agent`.
   - It is limit-checked against the service-principal entitlement instead of seats.
   - It appears in the Service principals list too, with a kind badge. It is managed in one place, with no duplicate state.
3. **Integration acts as itself.**
   - An RMM creates a ticket with `POST /api/v1/tickets` using the principal's key. `entered_by` is the principal.
   - It may set `assigned_to` to a human tech. Assigning work to a human is fine; the principal is not the assignee.
   - It posts a comment, and the comment author shows as the principal's name with a "Service" badge.
4. **Integration logs human work via act-as.**
   - A dispatch tool calls `POST /api/v1/time-entries` with `X-Alga-Act-As: <tech user_id>`.
   - Access requires both the principal's RBAC and the tech's RBAC to allow the action, act-as must be enabled on the principal, and the tech must be an active internal user.
   - The entry is owned by the tech, with `created_by` set to the tech and `created_via_principal_id` set to the principal.
   - Without the header the call fails with `422 ACT_AS_REQUIRED`.
5. **Agent via MCP acts as a human.** The MCP `call` meta-tool accepts an optional `act_as_user_id`, which is forwarded as the act-as header on the loopback dispatch. `mcp_agent_audit` records `act_as_user_id`.
6. **Deactivate.** The admin deactivates a principal of either kind.
   - Its user is marked inactive, its outstanding keys are deactivated, MCP session keys stop working at once, and its count frees up.
   - Reactivation is limit-checked again.
7. **Delete.**
   - A principal that is referenced anywhere, including audit rows, is **archived**. It is deactivated, its keys are deleted, its IdP binding is released, and it is hidden from lists.
   - It is never hard-deleted while referenced, and its audit trail is kept.
   - A principal that was never used is hard-deleted.
8. **See usage.** The license and account page shows "Service principals: 3 of 10 (don't use seats)" next to seat usage, with a link to the Service principals settings.

## UX / UI Notes

Use standard components throughout: `DataTable`, `Dialog`, `Button`, `Badge`, the existing key-reveal and copy pattern from `AdminApiKeysSetup`, the role multi-select used for agents in `McpServerSettings`, and `Switch`. Never show raw ids in tables; show the principal name.

- **Settings → Security → Service principals** (new tab next to API keys).
  - A DataTable with columns: Name, Kind badge (API, MCP agent), Roles, Act-as (Yes/No), Status, Keys, Last used, and Created by (as a display name).
  - Row actions: Edit, Manage keys, Deactivate/Activate, Delete or Archive.
  - The header shows "3 of 10 service principals" and a short note that service principals don't use seats.
- **Create/Edit dialog** fields: Name, Description, Roles (MSP roles only), Allow act-as switch with helper text, and Rate limit override (optional, capped at the plan ceiling).
- **Manage keys** lists the principal's keys and lets the admin issue a new key (shown once), revoke one, or rotate one (the old key gets a grace period through `expireApiKeyAfter`).
- **MCP server settings (EE).** The agent list and create flow stay. Behind them is the service-principal backend, and the create flow shows the shared limit.
- **Settings → Users.** Service users never appear in either tab, and the user detail page refuses to load a service user. No password, reset or invite action can target one.
- **API keys admin list.** Keys owned by a principal show the principal name with a "Service" badge, not a username. Ephemeral `mcp_agent` session keys stay out of this list, as today.
- **Attribution display.**
  - Ticket activity, time-entry details and comment headers render "Jane Tech via Datto RMM" when a via-principal is set.
  - A comment authored by a principal renders the principal's name with a "Service" badge and a service avatar, not a contact avatar.
- **License and account page.** Add a service-principal usage row in the EE `AccountManagement` page (`/msp/account`) and the appliance `LicenseManagementPage`.
- **User pickers.** No visual change. Service users are excluded by the engine (see R2.4).

## Requirements

### Functional Requirements

#### R1 — Identity model

- **R1.1** Add `'service'` to `users.user_type` by replacing the `users_user_type_check` CHECK constraint, which was created by the knex `enu` in `20241116000000_add_user_type_to_users.cjs`. `password_reset_tokens.user_type` stays as `internal`/`client`.
- **R1.2** Widen the TypeScript and Zod user-type unions (`IUser`, `shared/interfaces`, `AuthorizationSubject.userType`, `UserSession`, `findUserByEmail*AndType` params, event-bus schema) to include `'service'` where a service user can legitimately appear. Login, SSO and portal types stay `internal | client`.
- **R1.3** Add a `service_principals` table with one row per service user: `tenant`, `user_id` (the principal id), `kind` (`api` | `mcp_agent`), `name`, `description`, `allow_act_as` (bool, default false), `created_by`, `archived_at`, `created_at` and `updated_at`.
  - `users.is_inactive` is the single source of truth for whether a principal is active.
  - `name` is mirrored into `users.first_name` so existing user joins render a readable name.
- **R1.4** Add `agents.service_user_id` (uuid) and make it the binding to the backing service user, replacing `metadata.backing_user_id`. Every reader of `backing_user_id` switches to the column.
- **R1.5** Add a single service-principal service in a CE package (`packages/auth` or a new `packages/service-principals`) with these functions: `createServicePrincipal`, `updateServicePrincipal`, `setServicePrincipalActive`, `archiveOrDeleteServicePrincipal`, `issueServicePrincipalKey` and `listServicePrincipals`.
  - EE `createAgent`, `setAgentActive` and `deleteAgent` are rewritten on top of it.
  - No other code path may insert or update a `users` row with `user_type = 'service'`.
- **R1.6** A service user is created with no usable password. The auth layer is what blocks login (R3). The locked sentinel is kept only because `hashed_password` is NOT NULL.

#### R2 — `user_type` audit and helpers

- **R2.1** Add named predicates in `packages/types`:
  - `isClientUserType(t)`
  - `isMspPrincipalUserType(t)` (internal | service)
  - `isInteractiveUserType(t)` (internal | client)
  - `isLicensedUserType(t)` (internal)
  - `INTERACTIVE_USER_TYPES`
- **R2.2** Convert all 66 non-test `user_type !== 'client'` checks (the inventory is in `SCRATCHPAD.md`) to the predicate that states the intent:
  - **Portal "require client" guards** (about 45) become `!isClientUserType` → deny. Behavior is unchanged, and service is denied.
  - **"Non-client means MSP data scope" sites** become `isMspPrincipalUserType`. These are the list-search predicates, ticket and record visibility, document rules, `invoiceQueries`, `TicketService.ts:396` and `policyActions.ts:146`. Service keeps MSP scope. This is a deliberate decision, not an accident.
  - **Session and UI sites** become `isInteractiveUserType`. These are `getSession`, `checkTrackedSession`, `authMiddleware`, `msp/layout`, `signin/page` and `Header`.
  - **`addUser` seat check** (`userActions.ts:557`) becomes `isLicensedUserType`.
- **R2.3** Give every ternary or default that maps "anything not client" to `internal`, or "anything not internal" to `client`, an explicit `service` branch:
  - authorization-subject normalizers: `authorizationKernel.ts:78`, `credentialAuthorization.ts:130`, workflow `crm.ts:969`, `projects.ts:1078`
  - comment author resolution: `comment.ts:99,235`, `commentActions.ts:536`, `commentAuthorResolution.ts:61`, `optimizedTicketActions.ts:3450`
  - `latestActivityActor.ts:75`
  - the mention-recipient kind
  - the `|| 'internal'` defaults in `UserService` and `userActions`
- **R2.4** Change `User.getAll`, `getAllUsers` and `getAllUsersBasic` to exclude `service` unless the caller passes `includeServicePrincipals: true`. Do the same for `UserService` list and search. This covers the roughly 30 callers that pass no `userType`. The `userTypeFilter={null}` pickers (`PolicyManagement`, `AdminSessionManagement`) exclude service users unless they opt in.
- **R2.5** Classify the `=== 'internal'` *requirements* that a service principal can reach over REST:
  - Where the check means "MSP-side caller", accept MSP principal types: `assertInternalApiUser`, `TicketService.ts:2785`, `taskCommentService.ts:83,172`, `ApiTimeSheetController`, `ApiTicketController` and the documents routes.
  - Where it means "human", keep `internal`: reports that run on behalf of a person, tenant branding and theme settings, and so on.
  - Server-action-only checks can stay `internal`, because a service user can never hold the session they need. The SCRATCHPAD records the classification per site.
- **R2.6** Role assignment (`policyActions.ts:453/457`, `roleActions.ts:106/110`) lets a service user hold MSP roles (`role.msp = true`) and never client roles.
- **R2.7** RBAC (`rbac.ts` `isClientPortal = user_type === 'client'`): service users resolve MSP roles. Make this explicit with `isMspPrincipalUserType` in all three rbac copies, plus `search/acl.ts`, `tags/permissions.ts`, `user-composition/permissions.ts` and kernel `builtinProvider.ts`.

#### R3 — No interactive login for `service`

These are enforced in the auth layer, independent of the password.

- **R3.1** `authenticateUser` (`packages/auth/src/actions/auth.tsx`) rejects any user whose type is not interactive. It also requires an explicit `userType` and removes the untyped `User.findUserByEmail` fallback (`auth.tsx:167`).
- **R3.2** The NextAuth `signIn` callback (`nextAuthOptions.ts:1875`) calls a provider-agnostic `assertInteractiveUser(userId, tenant)`. It re-reads `users.user_type` and `is_inactive` and returns false *before* any side effect: before `recordLoginSuccess`, `enforceMaxSessions`, `updateLastLogin` and session-row creation. This covers credentials, Google, Azure AD, Keycloak/OIDC and any future provider.
- **R3.3** `checkTrackedSession`, `requireLiveSession` and `sessionAuthMiddleware` use the shared `INTERACTIVE_USER_TYPES` constant instead of three hand-written lists. They keep rejecting a token whose stored user type is not interactive.
- **R3.4** Mobile: the handoff route (`auth/mobile/handoff/route.ts`), `issueMobileOtt`, `exchangeOttForSession`, `refreshMobileSession`, Apple sign-in (including the already-linked-identity branch, which today has no type or active check) and IAP restore/provision all require an active internal user.
- **R3.5** `ApiKeyService.createApiKey` takes the owner type and purpose into account:
  - `internal` may hold any purpose.
  - `service` may hold only the `service` purpose.
  - `mobile_session` and `mcp_user` stay internal-only, so widening key ownership does not open the mobile path.
- **R3.6** Password and recovery writes refuse service targets: `adminChangeUserPassword`, the `UserService` password change, `PasswordResetService.createResetToken`, `completePasswordReset` and `setNewPassword`. `setNewPassword` also loses its untyped `findUserByEmail` fallback. The internal invite flow never matches or creates a service user.
- **R3.7** Remove the stale `ssoPreferences.ts:159` untyped lookup.
- **R3.8** Delete the unused duplicate `export const options` / `validateUser` block in `nextAuthOptions.ts:2387-3180`, so there is one auth config to keep correct. Confirm it has no importers first.
- **R3.9** The Next middleware (`server/src/middleware.ts`) and `msp/layout.tsx` redirect any session whose type is not interactive to sign-in, not to the client portal.

#### R4 — API authentication and request context

- **R4.1** `assertInternalApiUser` becomes `assertMspApiPrincipal` and accepts `internal` or `service`. This applies to every caller: `buildAuthenticatedApiContext`, `ApiBaseController.authenticate`, `ApiTicketController`, `ApiTimeSheetController`, `ApiContactController` and the documents routes.
- **R4.2** Both `getKeyGateReason` copies (`packages/auth/.../apiKeyService.ts`, `server/src/lib/services/apiKeyServiceForApi.ts`) switch from a block-list to an allow-list. They accept active `internal` or `service` owners, keep rejecting `client`, and reject any other type.
- **R4.3** `ApiContext` gains a `principal` field (`{ userId, userType, kind: 'user' | 'service' }`), `actAsUserId`, and `effectiveUserId`. `effectiveUserId` is the act-as user when one is present, otherwise the principal. Existing `userId` keeps meaning "effective user", so services that write `context.userId` record the human automatically under act-as. The `ApiKey` type gains `agent_id`.
- **R4.4** `ServiceContext` (`packages/db/src/services/BaseService.ts`) carries `viaPrincipalUserId` so model writers can stamp `*_via_principal_id`.
- **R4.5** The MCP `jsonRpcServer` loopback forwards `act_as_user_id` as `X-Alga-Act-As` and records it in `mcp_agent_audit.act_as_user_id`.

#### R5 — Attribution and act-as

- **R5.1** Act-as header. `X-Alga-Act-As: <user_id>` is honored only when all of these hold; any failure is rejected:
  - the authenticated principal is a `service` user with `allow_act_as = true` (else `403 ACT_AS_NOT_ALLOWED`)
  - the target is an active internal user in the same tenant (else `422 ACT_AS_INVALID_TARGET`)
  - the header is not sent on a human-owned key (else `400 ACT_AS_NOT_SUPPORTED`)
- **R5.2** RBAC under act-as is the **intersection** of both: an action is allowed only if the principal's roles allow it *and* the act-as user's roles allow it. A principal cannot use a more privileged human to escalate, and a human cannot be used for work they couldn't do themselves. The kernel evaluates both subjects, so record-level rules apply with the human as the subject too.
- **R5.3** Add one human-work guard, `assertHumanWorkAssignee(trx, tenant, userIds)`, that requires active `internal` users. Call it from the shared write cores, not per endpoint, so UI, REST, workflow and MCP all get it:
  - `addTicketResourceCore`, `assignTeamToTicketCore` and ticket create/update `assigned_to` (`TicketService`, ticket actions)
  - `ScheduleEntry.create` / `updateAssignees`
  - time-entry create/update (owner)
  - time-sheet create (owner) and approve (`approved_by`)
  - time-entry approval
  - project task `assigned_to` and `task_resources`
  - interaction create (owner)

  The guard only checks fields that the write sets or changes. Existing references are not re-validated on unrelated edits.
- **R5.4** Writes that default ownership to the caller must not default to a service principal. `resolveScheduleAssignees`, `TimeEntryService` `user_id: context.userId`, `TimeSheetService` `approved_by: context.userId` and the interaction owner all use `effectiveUserId`. When the effective user is a service principal, they fail with `422 ACT_AS_REQUIRED` and a message naming the field.
- **R5.5** Add via-principal columns, nullable uuid and app-enforced like other relations:
  - `time_entries.created_via_principal_id`, `time_entries.updated_via_principal_id`
  - `time_sheets.approved_via_principal_id`
  - `schedule_entries.created_via_principal_id`
  - `interactions.created_via_principal_id`
  - `comments.created_via_principal_id`
  - `tickets.entered_via_principal_id`
  - `project_tasks.created_via_principal_id`
  - `ticket_audit_logs.via_principal_user_id`
  - `mcp_agent_audit.act_as_user_id`

  The writers stamp these from `ServiceContext.viaPrincipalUserId`.
- **R5.6** `ticket_audit_logs` gets `actor_type = 'service_principal'`, with `actor_user_id` set to the service user, when a principal acts as itself. Under act-as, the row uses `actor_type = 'user'`, `actor_user_id` set to the human and `via_principal_user_id` set to the principal. The generic `auditLog()` records `via_principal_user_id` in `details`.
- **R5.7** Comments authored by a service principal keep `author_type = 'user'` (no enum change), and display resolution uses the user type to render the principal's name, a "Service" badge and a service avatar. A service-authored comment is never treated as a client or contact comment.
- **R5.8** Attribution display: ticket activity feed, time-entry detail and comment header render "<human> via <principal name>" when the via column is set.

#### R6 — Entitlements

- **R6.1** Add a `SERVICE_PRINCIPAL_ENTITLEMENTS: Record<TenantTier, { maxPrincipals: number | null; rateLimit: { maxTokens; refillPerMin } }>` constant beside `TIER_FEATURES` in `packages/types`. Proposed defaults are an open question:
  - essentials: 1 principal
  - solo: 2
  - pro: 10
  - rate limit for all tiers: 120 tokens burst, 60/min
- **R6.2** The limit resolves in this order:
  1. `tenants.service_principal_limit`, a nullable platform-admin override in the same style as `licensed_user_count`
  2. the EE appliance license claim `service_principals`, when present in the signed claims
  3. the tier default

  CE builds with no licensing resolve to unlimited, matching how the CE seat guard is a no-op.
- **R6.3** `checkServicePrincipalLimit(trx, tenant)` counts active service users. It is called by `createServicePrincipal` and by reactivation, in the same transaction as the write, following `checkInternalUserLicenseLimit`'s pattern. Over limit, it returns `SERVICE_PRINCIPAL_LIMIT_REACHED` with a readable message.
- **R6.4** Per-principal rate limits:
  - Every request authenticated as a service principal uses the token bucket subject `sp:<principal user_id>`, whatever key it used. That includes MCP's per-request minted keys, so agent limiting finally works.
  - Config is resolved in order: per-key row, then per-principal row (new `api_rate_limit_settings.principal_user_id`), then the tier default from R6.1.
  - A per-principal override can't exceed the tier ceiling unless the tenant has a platform override.
  - Throttling still follows `RATE_LIMIT_ENFORCE`.
- **R6.5** Seat checks stay separate. Creating a service principal never calls `checkInternalUserLicenseLimit`, and creating an internal user never counts service principals.

#### R7 — Usage visibility

- **R7.1** `getServicePrincipalUsage(tenant)` returns `{ limit, used, remaining }`.
- **R7.2** The EE account page (`AccountManagement.tsx`) and the appliance `LicenseManagementPage` show a service-principal usage row beside seats, with the note "Service principals don't use seats" and a link to the settings tab.
- **R7.3** The header of the Service principals settings tab shows the same usage and disables "New" at the limit.

#### R8 — Lifecycle and the gaps that exist today

- **R8.1** `createAgent` creates a service principal of kind `mcp_agent` through R1.5. It is checked against the service-principal limit, not seats.
- **R8.2** `setServicePrincipalActive(false)`, and therefore `setAgentActive(false)`:
  - sets `users.is_inactive = true` and `agents.active = false` (for `mcp_agent`) in one transaction
  - deactivates every active key the principal owns, including outstanding `mcp_agent` session keys, so access ends immediately

  Reactivation reverses the flags and is limit-checked. It does not revive keys; the admin issues new ones.
- **R8.3** `archiveOrDeleteServicePrincipal`:
  - If the principal is referenced anywhere (any attribution column, via column, audit row, `mcp_agent_audit`, ticket activity), it is archived: deactivated, keys deleted, `archived_at` set, IdP binding (`idp_issuer`/`idp_subject`) cleared so the subject can be rebound, and hidden from lists.
  - Otherwise it is hard-deleted along with its roles and keys.
  - `mcp_agent_audit` is never deleted.

  This replaces today's `deleteAgent`, which deletes the audit trail and fails on FK references.
- **R8.4** User management never shows a service user:
  - Settings → Users filters explicitly with `isLicensedUserType` for the MSP tab.
  - The user detail loader rejects service ids.
  - `adminChangeUserPassword`, `deleteUser`, invite and reactivate server actions refuse service targets with "Manage service principals in Settings → Security".
- **R8.5** `user_type` is immutable outside the service-principal service. REST `UserService.update` (`UserService.ts:346`) and the user actions reject any change to or from `service`. This stops an internal user from being turned into a service user to dodge a seat, and stops a service user from being turned into a person without a seat check.
- **R8.6** REST `UserService.create` (`UserService.ts:228+`) rejects `user_type = 'service'` and calls `checkInternalUserLicenseLimit` for `internal`. Today it has no seat check at all, a gap found during grounding.

#### R9 — Migration

- **R9.1** CE migration (`server/migrations`): replace the `users_user_type_check` constraint to allow `service`; create `service_principals`; add the via-principal columns; add `api_rate_limit_settings.principal_user_id`; add `tenants.service_principal_limit`; add the `service_principal` permission resource; and seed it to the Admin role.
- **R9.2** EE migration (`ee/server/migrations`, ordered after R9.1). For every `agents` row:
  - set the backing user to `user_type = 'service'`
  - set `is_inactive = NOT agents.active`, which fixes existing drift
  - set `first_name` to the agent name
  - backfill `agents.service_user_id` from `metadata.backing_user_id`
  - insert a `service_principals` row with kind `mcp_agent`

  It is idempotent. It skips any backing user that is no longer `internal` or is missing, and logs it.
- **R9.3** The migration never deactivates or deletes anything to fit the new service-principal limit. Tenants already over the limit keep their principals, and only new creation is blocked.
- **R9.4** Historical rows that point at a former agent user as assignee, schedule resource or time owner are left alone. A pre-flight count query lives in the SCRATCHPAD runbook. The R5.3 guard applies only when such a field is next changed.

### Non-functional Requirements

- **Citus.** `users` and the attribution tables are distributed.
  - The CHECK replacement must work on a distributed table. Use `ALTER TABLE … DROP CONSTRAINT` / `ADD CONSTRAINT … NOT VALID` then `VALIDATE`, and verify on `alga-regression-citus`.
  - New columns must not use `now()` in `CASE`/`COALESCE` (see the 2026-10-13 outage).
- **Tenant isolation.** Every new query goes through `tenantDb`.
- **Fail closed.** The act-as, type and limit checks throw on lookup errors and never allow.

## Data / API / Integrations

- **New table** `service_principals(tenant, user_id, kind, name, description, allow_act_as, created_by, archived_at, created_at, updated_at)`. PK `(tenant, user_id)`; index on `(tenant, kind)`.
- **New columns:**
  - `agents.service_user_id`
  - `api_rate_limit_settings.principal_user_id` (unique `(tenant, principal_user_id)`)
  - `tenants.service_principal_limit`
  - the via-principal columns in R5.5
- **API key purpose:** `service` (new).
- **Headers:** `X-Alga-Act-As` (request). Rate-limit response headers are unchanged.
- **Error codes:**
  - `ACT_AS_REQUIRED` (422)
  - `ACT_AS_NOT_ALLOWED` (403)
  - `ACT_AS_INVALID_TARGET` (422)
  - `ACT_AS_NOT_SUPPORTED` (400)
  - `HUMAN_WORK_ASSIGNEE_INVALID` (422; a non-internal id in an assignee or owner field)
  - `SERVICE_PRINCIPAL_LIMIT_REACHED` (409)
- **OpenAPI:**
  - Document the act-as header and the error codes on the affected routes.
  - Correct the stale `userTypeSchema` (`server/src/lib/api/schemas/userSchemas.ts:40`, which lists `admin` and `contractor` that the DB never allowed) to `internal | client | service`. `create` and `update` accept only `internal | client`.
  - Regenerate `server/src/lib/mcp/registry.generated.ts` and `ee/server/src/chat/registry/apiRegistry.generated.ts`.
- **MCP:** the `call` meta-tool gets an optional `act_as_user_id` argument.

## Security / Permissions

- New RBAC resource `service_principal` with `read`, `create`, `update` and `delete`, seeded to Admin.
  - Turning on `allow_act_as` needs `service_principal:update`.
  - The EE MCP agent admin routes check `service_principal:*` in addition to the existing Admin requirement.
- A service principal can't manage service principals or API keys of other principals, even if it holds Admin. Those server actions need an interactive session, and the REST surface doesn't expose them.
- Accepted residual risk: unlicensed people could run work *through* a principal as the principal, such as creating tickets or comments as the bot. They cannot own work, log time, be scheduled or approve. This is the same boundary ConnectWise and Autotask draw.

## Observability

Nothing new beyond the attribution and audit columns above. Existing rate-limit metrics gain the `sp:<id>` subject automatically.

## Rollout / Migration

- Ship R9.1 and R9.2 together with R3 and R4. The agent users become `service` in the same release that teaches the API layer to accept `service`, so MCP dispatch never breaks.
- **Seat and billing effect.** Tenants with MCP agents see their seat count drop by their agent count. On hosted Stripe tenants the next quantity sync lowers the billed seat quantity to match. That is correct, but it is a billing change, so give support and finance advance notice.
- No feature flag. The change makes behavior stricter (login, assignment) and corrects counts. The new UI ships with it.
- **Breaking change for integrations.** REST callers that log time or approve sheets with a key owned by a service principal will start getting `ACT_AS_REQUIRED`. None exist before this release, because service principals don't exist yet. MCP agents that used to log time as themselves will now need `act_as_user_id`. Document it in the MCP tool description.

## Open Questions

1. **Entitlement numbers.** Are essentials 1, solo 2 and pro 10 right, or should the limit scale with seats (for example `max(5, seats)`)? Should the rate-limit ceiling differ by tier?
2. **Appliance license claim.** Should `service_principals` be a signed claim now, or should appliances use the tier default until the license service issues it?
3. **Act-as allow-lists.** Is the per-principal switch plus RBAC intersection enough for v1, or do MSPs need "may act as these users or teams only"?
4. **Comments.** Should a service-principal comment on a ticket be allowed to be customer-visible (`is_internal = false`) by default, or forced internal unless act-as is used?
5. **Interactions.** Is the interaction owner human work? This plan treats it as human work. Telephony and call-logging integrations would then need act-as.
6. **Archived principals.** Should they still count toward the limit? This plan says no, because they are inactive.

## Acceptance Criteria (Definition of Done)

1. `users.user_type` accepts `service`. MCP agents and API principals are created as `service` users with `service_principals` rows, and existing agent users are migrated.
2. Seat usage, the seat guard, Stripe quantity and the appliance seat guard exclude service users without any new special case. Creating or reactivating a principal checks the service-principal limit instead.
3. A service user cannot get a session through credentials, any SSO provider, mobile (handoff, OTT, refresh, Apple, IAP), the vanity-domain exchange, password reset or invite. An admin cannot set its password. Each of these is covered by a test that does not depend on the locked password.
4. A service principal can call `/api/v1` with its key, under its MSP roles, and is rate-limited per principal across MCP's rotating keys.
5. A service principal can never be stored as a ticket assignee or resource, schedule assignee, time-entry or time-sheet owner, approver, project-task assignee or interaction owner, through any of UI, REST, workflow or MCP. Writes that would default to it fail with `ACT_AS_REQUIRED`.
6. With act-as enabled and a valid target, human-work writes record the human as actor and the principal in the via column and activity log, and RBAC is the intersection of both.
7. Deactivating a principal immediately stops all its keys, including MCP session keys, and frees its count. Deleting a used principal archives it and keeps the audit trail.
8. Settings → Users never lists a service user, and no password, reset, invite or delete action can target one. `user_type` cannot be changed to or from `service` outside the principal service.
9. The license and account page and the Service principals tab show `used of limit`.
10. All 66 `!== 'client'` sites and the REST-reachable `=== 'internal'` requirements are converted to named predicates. The SCRATCHPAD inventory is marked complete.
