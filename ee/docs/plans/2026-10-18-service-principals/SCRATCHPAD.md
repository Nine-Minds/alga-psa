# Scratchpad — Service Principals

- Plan slug: `service-principals`
- Created: `2026-10-18`

## Decisions

- **(2026-10-18) Use a new `user_type = 'service'`, not a flag on internal users.** The seat counters, the seat guard, the Stripe quantity, SCIM, and the internal-only pickers and recipient lists all filter on `user_type = 'internal'`. A new type drops out of all of them with no new special cases. A flag would need every one of those sites to learn about it.
- **(2026-10-18) The `users` row is the principal, and `service_principals` holds its metadata.** RBAC (`user_roles`) and key ownership (`api_keys.user_id`) already key on `user_id`, so the principal must be a user row. Kind, description, act-as and archive state live in `service_principals`. `agents` keeps only the MCP-specific IdP binding, plus `service_user_id`.
- **(2026-10-18) `users.is_inactive` is the single active flag.**
  - `getKeyGateReason` already rejects keys owned by inactive users. So deactivating the user ends every key at once, including the 300-second MCP session keys, without teaching the gate about `agent_id`.
  - `agents.active` is kept in lock-step by the service, because `resolveAgentByIdp` filters on it.
- **(2026-10-18) Act-as means the human is the effective user, and RBAC is the intersection of both.** With act-as, `context.userId` becomes the human, so every existing writer that uses `context.userId` (`TimeEntryService`, `TimeSheetService` approve, `entered_by` and so on) records the human with no per-service change. The via column is stamped from `ServiceContext.viaPrincipalUserId`. The intersection stops either side being used to escalate.
- **(2026-10-18) The human-work guard lives in the shared write cores, not in each endpoint.** That way UI, REST, workflow and MCP all get it: `ticketResourceCore`, `teamAssignmentCore`, `ScheduleEntry.updateAssignees`, the time entry, time sheet, project task and interaction writers.
- **(2026-10-18) Service principals keep MSP data scope.** About 15 `!== 'client'` sites grant unscoped MSP visibility to anything that isn't a client. For service users that is the intended behaviour, because they hold MSP roles and RBAC governs them. We make it explicit with `isMspPrincipalUserType` rather than leaving it to chance.
- **(2026-10-18) Comments keep `author_type = 'user'`.** `comments.author_type` is a native enum `comment_author_type` (`user`, `contact`, `unknown`). A service author is a `user` row, and display resolves the kind from `users.user_type`. No enum migration is needed.
- **(2026-10-18) Delete becomes archive when the principal is referenced.** Today `deleteAgent` deletes `mcp_agent_audit` (which defeats attribution) and hard-deletes the `users` row (FKs from comments, time_entries and others make it fail, and `tickets.*_by` is left dangling).
- **(2026-10-18, Robert) Service principals are Pro-only, for both kinds.**
  - The gate is `TIER_FEATURES.SERVICE_PRINCIPALS` with minimum tier `pro`. It covers API principals and MCP agents.
  - Solo is defunct, so it gets no entitlement entry. It ranks below Pro, so it is gated out automatically.
  - Below Pro, existing principals are grandfathered: they keep working, but nothing new can be created, reactivated or keyed. This also covers essentials appliances that already have MCP agents. MCP had no tier gate before.
  - CE does not have the feature at all (see the edition-placement decision below), so the CE no-op in `assertTenantTierAccess` is irrelevant here.
  - The UI uses `TierGate` (`server/src/components/tier-gating/TierGate.tsx`), `FeatureUpgradeNotice` (`packages/ui/src/components/tier-gating/`) and `useTierFeature` (`server/src/context/TierContext.tsx:185`).
- **(2026-10-18, Robert) Licensing requires the feature to live in `ee/`.** This replaces the first draft, which put the service and the migrations in CE.
  - **EE owns all of it:** every schema change (`ee/server/migrations`, including the `users_user_type_check` widening, so the CE schema can't hold a `service` user), the service, entitlements, act-as, key issuance, rate-limit config, server actions and UI.
  - **CE keeps only two things:**
    - edition-neutral hardening, written as allow-lists of `internal` and `client`: login (R3), the human-work guard, user-management exclusion, `user_type` immutability, and the REST create seat check
    - generic hooks that default to the plain user: `ApiContext` principal fields, `withViaPrincipal`, the kernel's ability to authorize two subjects together, and the rate-limit config override
  - **Two boundary mechanisms, both already in the repo:**
    - `@product/service-principals/entry`: a new `packages/product-service-principals` with `oss/` and `ee/` entries, modelled on `packages/product-mcp`. Its aliases go in `server/next.config.mjs` (around line 428) and `server/tsconfig.json` (around line 406).
    - `@enterprise/components/...`, with null-rendering stubs in `packages/ee/src/components/`, modelled on credentials (`packages/ee/src/components/credentials/CredentialsScreen.tsx`).
  - **Precedent for EE migrations that add columns to base tables:** `api_keys.agent_id` (`20260607120000_create_mcp_agents.cjs`). Credentials is a counter-example: its tables went into `server/migrations` despite the coding standard. We follow the standard, `docs/AI_coding_standards.md` §"ee folder".
  - **`createApiKey` stays internal-only.** EE issues `service` keys directly, as `mintAgentSessionKey` does. So the CE key-creation path never learns about service owners, and mobile and `mcp_user` keys can't open up.
  - **Error codes are split.** CE throws a generic `HumanWorkOwnerRequiredError(field)`, and the EE boundary maps it to `ACT_AS_REQUIRED`, because act-as is an EE concept.
  - **The per-principal rate-limit override lives on `service_principals`** (EE), not as a new column on CE `api_rate_limit_settings`.
  - **`ticket_audit_logs.actor_type`** is a plain `string(32)` with no CHECK, so `service_principal` needs no constraint change.
  - **Boundary enforcement:** a static guard test (F096 / T038) plus a CE build check.
- **(2026-10-18, Robert) Open questions resolved. All choices were the recommended options.**
  - **Pro principal limit:** a flat 10 that does not scale with seats. The cap is the guard against "one bot per unlicensed person".
  - **Default per-principal rate limit:** 120 burst / 60 per minute, the same as today's per-key default.
  - **Appliance limit:** taken only from the signed `service_principals` claim; the tenants override is ignored on appliances.
    - Why: the appliance owner controls their own database.
    - If the claim is missing or the token is invalid, the limit is the Pro default. It never fails open to unlimited, unlike `userSeatGuard`, which fails open so it never blocks user creation.
    - Detection: an appliance is a host with a `license_state` row, read on the admin connection.
    - The claim is issued by the separate alga-license service (`ee/server/src/lib/applianceConsole/algaLicenseAdminClient.ts`). That makes it a cross-service dependency, but this plan ships safely before the issuer change.
  - **Act-as scope:** an on/off switch per principal plus RBAC intersection; no team allow-lists.
  - **A principal's own comments:** forced internal.
    - A customer-visible comment needs act-as.
    - An explicit public request without act-as is rejected (ACT_AS_REQUIRED) rather than silently coerced, so the integration learns its intent wasn't honored.
    - Enforced in the CE comment write core as a generic rule: a non-interactive author means internal only.
  - **Interaction owner:** human work.
  - **Archived principals:** don't count toward the limit.
- **Follow-up to check during implementation:** are there other customer-facing outbound paths a principal could use, such as REST email-send endpoints or portal-visible document shares? If so, the R5.9 rule may need to apply there too. So far only ticket comments are known to reach customers.
- **(2026-10-18) No feature flag.** The change only tightens behaviour, and it fixes counts that are wrong today.

## Discoveries / Constraints

### Current agent implementation (`ee/server/src/lib/mcp/agents.ts`)

- `createAgent` (:83-139):
  - inserts `users` with `user_type: 'internal'`, `username: mcp-agent-<slug>`, `email: mcp-agent-<id>@agents.alga.local`, and `lockedPassword()`
  - grants `user_roles` and `agent_roles`
  - stores `metadata.backing_user_id`
  - **never calls `checkInternalUserLicenseLimit`**
- `setAgentActive` (:142-147) only updates `agents.active`.
- `deleteAgent` (:155-173) deletes agent_roles, **mcp_agent_audit**, api_keys, user_roles, **users** and agents in one transaction.
- `mintAgentSessionKey` (:318-351) inserts directly into `api_keys`, so it skips `createApiKey`'s owner check. It uses a 300-second TTL, purpose `mcp_agent`, and a new key per request.
- `ee/server/src/lib/mcp/jsonRpcServer.ts:227-268` `resolveAuth` handles three cases:
  1. OAuth user token → `mintUserSessionKey`, purpose `mcp_user`, the human's own id
  2. IdP agent JWT → `mintAgentSessionKey`
  3. raw API key

  In each case tool calls loop back to `/api/v1` through `selfFetch` with `x-api-key`.

### Seats

All of these count `{user_type:'internal', is_inactive:false}`, so all of them exclude `service` automatically:
- `packages/licensing/src/lib/get-license-usage.ts:29`
- `server/src/lib/license/get-license-usage.ts:33`
- `ee/server/src/lib/license/get-license-usage.ts:34`
- `packages/users/src/lib/internalUserLicenseGuard.ts:49`
- the inline copy in `userActions.ts:565-567`
- `packages/licensing/src/actions/license-actions.ts:69`
- `ee/server/src/lib/actions/license-actions.ts:1026`
- `server/src/app/api/billing/licence-count/route.ts:190`
- `ee/temporal-workflows/src/activities/license-management-activities.ts:109`
- `ee/server/src/lib/stripe/StripeService.ts:883,2209`

Other seat facts:
- The appliance guard (`ee/server/src/lib/license/userSeatGuard.ts:16`) is handed the internal count.
- **Gap:** REST `UserService.create` (`packages/users/src/services/UserService.ts:228+`) has no seat check. Fixed by F086.
- **Gap:** `UserService.update` accepts `data.user_type` (:346). Fixed by F085.

### Things that block `service` today and must change in the same release as the migration

- `server/src/lib/api/middleware/apiMiddleware.ts:271-278` `assertInternalApiUser` throws unless the user is `internal`. That breaks every REST call, MCP dispatch included. Callers:
  - `buildAuthenticatedApiContext` (:280)
  - `ApiBaseController.ts:92`
  - `ApiTicketController.ts:463+`
  - `ApiTimeSheetController` (:127, 201, 284, 367, 450, 533, 614)
  - `ApiContactController.ts:136`
  - the documents routes
- `packages/auth/src/services/apiKeyService.ts:127` `createApiKey` requires an `internal` owner.
- `server/migrations/20241116000000_add_user_type_to_users.cjs:7` creates a knex `enu`. That is a text column plus the CHECK `users_user_type_check`. Only the EE migration widens it; CE keeps `internal | client`.
- Role assignment `policyActions.ts:453/457` and `roleActions.ts:106/110` handle only internal→msp and client→client.

### Login map (where `service` is blocked, and how)

- **The real gate today** is the per-request session check, whose allow-list is internal|client:
  - `checkTrackedSession` (`nextAuthOptions.ts:167`)
  - `requireLiveSession` (`getSession.ts:39`)
  - `sessionAuthMiddleware` (`authMiddleware.ts:443`)

  All three go through `UserSession.isRevokedOrIdentityMismatch`, which compares the stored `users.user_type` with the token claim.
- **That gate fires too late.** The jwt callback creates the `sessions` row (:2157) before `checkTrackedSession` rejects it (:2206), so `recordLoginSuccess`, `enforceMaxSessions` and `updateLastLogin` have already run. That is why R3.2 puts the check in the `signIn` callback.
- `authenticateUser` (`auth.tsx:157-168`) falls back to an untyped `User.findUserByEmail` when no `userType` is posted. A direct POST to the credentials callback can omit it.
- SSO (CE `ceOAuthProfileMapper.ts:47`, EE `ssoProviders.ts:155-202`) looks up by type hint internal|client, so service is already never matched. The `signIn` check is defence in depth.
- Mobile:
  - The handoff route (`auth/mobile/handoff/route.ts:63`) blocks only `client`.
  - The Apple linked-identity branch (`api/v1/mobile/auth/apple/route.ts:79-82`) has no type or active check.
  - IAP restore/provision binds to the *oldest internal user*. Today that can be an agent user.
  - OTT exchange and refresh are protected only by `createApiKey`'s internal check, so widening `createApiKey` naively would open mobile. Hence the F041 matrix.
- `adminChangeUserPassword` (`userActions.ts:1843-1900`) and the `UserService` password change have no target-type check. Today an admin can give an agent user a working password.
- `nextAuthOptions.ts:2387-3180` contains a second `export const options` with its own `authorize` and callbacks, plus `validateUser` (:3182). It looks unused; confirm before deleting (F044).
- There is no impersonation or "login as" feature, and no magic links.

### Attribution columns (for the human-work guard and the via columns)

- `tickets`: `entered_by`, `updated_by`, `assigned_to`, `closed_by`. **No FK.** See `initial_schema.cjs:244-283`. TicketService create (:1739-1740) does not validate `assigned_to`.
- `ticket_resources`: `assigned_to` and `additional_user_id` (FKs), plus a check that they differ. Written by `shared/services/tickets/ticketResourceCore.ts:121`, which promotes to primary when the ticket has no assignee (:140-147). Team assignment is in `teamAssignmentCore.ts:45`.
- `schedule_entry_assignees.user_id`: FK, ON DELETE CASCADE. Written by `shared/models/scheduleEntry.ts:175-211,500-540`, which checks only that the user exists.
- `resolveScheduleAssignees` (`packages/clients/src/actions/interactionCreateHelper.ts:257-264`) **defaults to the caller**.
- `time_entries.user_id`: NOT NULL, FK. `created_by`/`updated_by` were added in `20260131120000`. `TimeEntryService.ts:338` always uses `context.userId`.
- `time_sheets.user_id` and `approved_by` (FKs). `TimeSheetService.ts:257` (owner), `:452` (approve). `:458-466` writes `approved_at`/`approved_by` to time_entries, but no migration adds those columns. **Possible latent defect; verify.**
- `project_tasks.assigned_to` (FK) and `task_resources`. `ProjectService.ts:725-738` spreads `...data`.
- `interactions.user_id` (FK). `InteractionService.ts:201,226`.
- `ticket_audit_logs` (`20260525231145`) already has `actor_type`, `actor_user_id` and `source`. Constants are in `shared/lib/ticketActivity/types.ts:80-103`.
- `audit_logs` has `user_id` and `details` jsonb.
- `mcp_agent_audit` (`20260607130000`) has no user and no act-as column.
- `deleteUser` (`userActions.ts:705-950`) is the reference for cleaning up references. Its dependency list is `packages/core/src/config/deletion/index.ts:407-433`. It does not touch `tickets.entered_by`.

### Rate limiting

- `server/src/lib/api/rateLimit/enforce.ts:70`: the subject is `rateLimitSubjectId ?? apiKeyId`, and config lookup is by `api_key_id` (a uuid).
- The defaults are 120 tokens and 60/min (`apiRateLimitSettingsModel.ts:25-28`).
- It throttles only when `RATE_LIMIT_ENFORCE=true`.
- MCP mints a new key per request, so today's per-key buckets do nothing for agents.

### UI surfaces

- Seat banner: `server/src/components/settings/general/UserManagement.tsx:1041-1062`.
- User list filter: `:377-383`, `internal || !user_type`. Service users drop out automatically, but make it explicit.
- Admin "Set password": `UserDetails.tsx:367-391,676-700`.
- EE account page: `ee/server/src/components/settings/account/AccountManagement.tsx:194-217,840,1382-1390`.
- Appliance license page: `server/src/components/licenses/LicenseManagementPage.tsx`. It shows no seat x-of-y today.
- MCP agents admin: `server/src/components/settings/mcp/McpServerSettings.tsx`, which calls `/api/v1/mcp/agents` (`server/src/app/api/v1/mcp/agents/route.ts`) through `@product/mcp/entry`. Auth is `ee/server/src/lib/mcp/adminAuth.ts`.
- API keys admin: `AdminApiKeysSetup.tsx`, via `listAllApiKeys` (a tenantJoin on users).

### Tiers

- `TENANT_TIERS = ['essentials','solo','pro']` (`packages/types/src/constants/tenantTiers.ts`). A null plan resolves to `pro`.
- There is no per-plan limits table yet. `TIER_FEATURES` is in `packages/types/src/constants/tierFeatures.ts`.

## Audit inventory — `user_type !== 'client'` (66 non-test sites)

Each site's target predicate is given in brackets. Mark a site done when converted.

**Already "require client, otherwise deny"** → `!isClientUserType` → deny. Behaviour is unchanged.
- `packages/client-portal/src/actions/client-portal-actions/`:
  - `appointmentRequestActions.ts`: 330, 807, 1080, 1196, 1284, 1551, 1647, 1691, 1787
  - `client-assets.ts:83`
  - `client-documents.ts`: 61, 173, 243
  - `client-kb.ts`: 49, 166, 260, 308, 355
  - `client-project-billing.ts:70`
  - `client-project-details.ts`: 55, 507, 612
  - `client-tickets.ts:140`
  - `clientUserActions.ts`: 235, 291
  - `dashboard.ts`: 183, 299
- `packages/client-portal/src/lib/clientAuth.ts:54`
- `clientDocumentAccess.ts`: 89, 97
- `server/src/app/client-portal/request-services/`:
  - `actions.ts`: 19, 41
  - `[definitionId]/actions.ts`: 84, 110
  - `my-requests/actions.ts`: 18, 34
- `server/src/app/api/client-portal/documents/[documentId]/`:
  - `export/route.ts:14`
  - `file/route.ts:31`
- `server/src/app/api/ext/[extensionId]/[[...path]]/route.ts:268`
- `packages/product-ext-proxy/ee/handler.ts:243`
- `shared/lib/ticketCommentAttachments.ts:122`
- `packages/clients/src/actions/contactAvatarActions.ts:22`
- `packages/auth/src/actions/policyActions.ts:158`
- `server/src/middleware/express/authMiddleware.ts:464`

**"Not a client, so MSP scope"** → `isMspPrincipalUserType`. Each of these is a deliberate decision.
- `packages/clients/src/lib/listSearchSql.ts:90`
- `packages/projects/src/actions/projectActions.ts:660`
- `packages/tickets/src/actions/optimizedTicketActions.ts`: 250, 1612
- `packages/tickets/src/actions/ticketActions.ts:290`
- `packages/tickets/src/lib/ticketRecordAuthorization.ts:121`
- `packages/tickets/src/actions/comment-actions/commentActions.ts:75`
- `server/src/lib/api/services/TicketService.ts:396` (**the REST path service principals hit**)
- `shared/lib/documentAuthorization.ts:114`
- `packages/billing/src/actions/invoiceQueries.ts:65`
- `packages/billing/src/actions/quoteActions.ts:1424`
- `packages/auth/src/actions/policyActions.ts:146`
- `packages/users/src/actions/user-actions/userActions.ts:406`

**Session and UI** → `isInteractiveUserType`.
- `packages/auth/src/lib/getSession.ts:39`
- `packages/auth/src/lib/nextAuthOptions.ts`: 167, 513
- `server/src/middleware/express/authMiddleware.ts:443`
- `server/src/middleware.ts:598`
- `server/src/app/auth/signin/page.tsx:41`
- `server/src/components/layout/Header.tsx`: 456, 457

**Seat** → `isLicensedUserType`.
- `packages/users/src/actions/user-actions/userActions.ts:557`

### Mappings that turn `service` into internal or client (need an explicit branch)

Ternaries that make internal the else-branch:
- `server/src/lib/api/controllers/authorizationKernel.ts:78`
- `ee/server/src/lib/credentials/credentialAuthorization.ts:130`
- `shared/workflow/runtime/actions/businessOperations/crm.ts:969`
- `projects.ts:1078`
- `userRecipients.ts:149`
- `packages/auth/src/lib/nextAuthOptions.ts`: 710, 3189
- `packages/tickets/src/actions/optimizedTicketActions.ts:3450`
- `packages/tickets/src/lib/latestActivityActor.ts:75`
- `packages/auth/src/actions/auth-actions/passwordResetActions.ts:48`
- `ee/server/src/lib/actions/ssoActions.ts:134`
- `OrgChart.tsx:134`
- `internalNotificationSubscriber.ts:1831`
- `Header.tsx:460-636`

Reverse pattern, where internal is the if-branch and everything else becomes client:
- `packages/tickets/src/models/comment.ts`: 99, 235
- `commentActions.ts:536`
- `commentAuthorResolution.ts:61`

`|| 'internal'` / `?? 'internal'` defaults:
- `ee/server/src/lib/platformNotifications/actions.ts:27`
- `packages/auth/src/actions/session-actions/sessionActions.ts:143`
- `packages/product-ext-proxy/ee/gateway/auth.ts:134`
- `server/src/lib/extensions/gateway/auth.ts:111`
- `ProjectTaskCommentService.ts:31`
- `TicketDetails.tsx:1290`
- `UserService.ts`: 235, 278, 346
- `userActions.ts`: 546, 622
- the email locale resolvers

Synthetic `user_type: 'internal'` objects:
- `packages/auth/src/lib/apiAuth.ts:65`
- `server/src/lib/auth/apiAuth.ts:49`
- `TicketService.ts:1978`

### `=== 'internal'` requirements reachable over REST (classify during F020)

- **Should accept MSP principals:**
  - `TicketService.ts:2785`
  - `taskCommentService.ts:83,172`
  - `ApiTimeSheetController` and `ApiTicketController` local auth blocks
  - documents routes (`documents/[documentId]/content`, `download`, `view/[fileId]`)
- **Should stay human-only:**
  - `packages/reporting/src/lib/reports/actions/executeReport.ts:33`
  - `getDeferredRevenueReport.ts:46`
  - tenancy branding, locale, logo and theme actions

  These are server actions anyway, so only a session can reach them.
- **Server-action-only checks** (ticketActions, commentActions, list-views, email logs and so on) can stay `internal`, because a service user never has a session.

### Unfiltered `getAllUsers` callers

These pass no `userType`. F018's default exclusion covers them:
- `ticketFormActions.ts:31`
- `useRecurringReferenceData.ts:58`
- `BulkAssignTicketsRouteContent.tsx:10`
- `TicketImportRouteContent.tsx:14`
- `projectActions.ts`: 2005, 2226
- `ProjectDetailsEdit.tsx:99`
- `ProjectQuickAdd.tsx:99`
- `Projects.tsx:512`
- `TechnicianDispatchDashboard.tsx:787`
- `WorkItemDetailsDrawer.tsx:61`
- `WorkItemDrawer.tsx:211`
- `WorkItemPicker.tsx:161`
- `DocumentsPage.tsx:177`
- `ClientDetails.tsx:753`
- `ClientQuickView.tsx:202`
- `QuickAddClient.tsx:205`
- `ActivityDetailViewerDrawer.tsx`: 240, 335, 685
- `TeamDetails.tsx:144`
- `TeamList.tsx:71`
- `UserRoleAssignment.tsx:57`
- `PolicyManagement.tsx:312`
- `CredentialRestrictDialog.tsx:68`
- both `useUsers.ts` hooks

These pickers use `userTypeFilter={null}`:
- `PolicyManagement.tsx`: 1643, 1798
- `AdminSessionManagement.tsx:288`

## Delivery slices (stacked cards)

Robert decided on 2026-10-18 to deliver this plan as four stacked XO cards, in dependency order A → B → C → D. Each card is stacked on the previous one.

- Each card implements only its own slice.
- Each card flips `implemented` only for its own feature and test ids, which keeps merge conflicts in the plan files to a minimum.
- Change scope only in this plan, never in a card-local document.

- **A. CE hardening and user_type audit**
  - Features (42): F001, F008, F009, F010, F011, F012, F013, F014, F015, F016, F017, F018, F019, F020, F021, F022, F035, F036, F037, F038, F039, F040, F041, F042, F043, F044, F045, F052, F053, F054, F055, F056, F057, F058, F059, F060, F061, F082, F083, F085, F086, F101
  - Tests (13): T007, T008, T009, T010, T011, T013, T021, T022, T026, T028, T029, T042, T043
- **B. Edition boundary and generic hooks**
  - Features (10): F005, F046, F047, F048, F049, F051, F092, F096, F097, F098
  - Tests (3): T037, T038, T041
- **C. EE core: schema, service, entitlements, act-as, attribution**
  - Features (39): F002, F003, F004, F006, F007, F023, F024, F025, F026, F027, F028, F029, F030, F031, F032, F033, F034, F050, F062, F063, F064, F065, F066, F067, F068, F070, F071, F072, F073, F074, F075, F087, F088, F089, F090, F093, F094, F099, F100
  - Tests (21): T001, T002, T003, T004, T005, T006, T012, T014, T015, T016, T017, T018, T019, T020, T023, T024, T025, T027, T035, T039, T040
- **D. EE UI and usage visibility**
  - Features (10): F069, F076, F077, F078, F079, F080, F081, F084, F091, F095
  - Tests (6): T030, T031, T032, T033, T034, T036

Notes on the split:

- **F001, the EE migration that widens the CHECK constraint, ships in card A.**
  - A's tests need a user with a non-interactive type, and the CE schema forbids one.
  - Widening the constraint is harmless by itself: nothing creates service users until card C.
- **Card A's human-work code uses `context.userId`, which already means the effective user.**
  - Card B adds the explicit `effectiveUserId` field, and A's code works unchanged with it.
  - Card C's boundary maps `HumanWorkOwnerRequiredError` to `ACT_AS_REQUIRED` (F099).
- **Card C holds both halves of the release-ordering pair**: the agent-user migration (R9.2) and the EE boundary that makes the API accept service users (R4.6). Neither can merge without the other.
- **T040 and T016 are the end-to-end act-as versions of T042 and T041.** That is why they live in card C.

## Commands / Runbooks

Pre-flight before the R9.2 migration: count human work currently pinned to agent backing users.

```sql
WITH agent_users AS (
  SELECT tenant, (metadata->>'backing_user_id')::uuid AS user_id FROM agents
)
SELECT 'tickets.assigned_to' AS ref, count(*) FROM tickets t JOIN agent_users a USING (tenant) WHERE t.assigned_to = a.user_id
UNION ALL SELECT 'ticket_resources', count(*) FROM ticket_resources r JOIN agent_users a USING (tenant) WHERE a.user_id IN (r.assigned_to, r.additional_user_id)
UNION ALL SELECT 'schedule_entry_assignees', count(*) FROM schedule_entry_assignees s JOIN agent_users a USING (tenant) WHERE s.user_id = a.user_id
UNION ALL SELECT 'time_entries', count(*) FROM time_entries e JOIN agent_users a USING (tenant) WHERE e.user_id = a.user_id
UNION ALL SELECT 'interactions', count(*) FROM interactions i JOIN agent_users a USING (tenant) WHERE i.user_id = a.user_id;
```

To test the CHECK replacement on Citus, use the `alga-regression-citus` container (see memory `project_citus_now_in_case`).

To recount the audit inventory once the work is done (it should return only the predicates file):

```bash
git grep -nE "user_?[tT]ype\s*!==?\s*'client'" -- ':!**/*.test.*' ':!**/__tests__/**'
```

## Links / References

- MCP server design, §10 (agent identity): `docs/plans/2026-06-06-alga-mcp-server/design.md`
- Agent schema: `ee/server/migrations/20260607120000_create_mcp_agents.cjs`; audit: `ee/server/migrations/20260607130000_create_mcp_agent_audit.cjs`
- Industry precedent: ConnectWise Manage "API Members" (free, no login, cannot be resources) and Autotask "API User (system)" security level (free, API-only).

## Open Questions

None remain. All were resolved on 2026-10-18; the table at the end of the PRD lists every decision.

## Test coverage notes

- Six features have no dedicated test because typecheck and build already cover them:
  - F008, type widening
  - F009, schema enum correction
  - F043, typed SSO-preferences lookup
  - F044, dead-code removal
  - F089, OpenAPI docs and registry regen
  - F091, i18n strings
- T029 is a deliberate static guard against new raw `!== 'client'` checks. It complements the behavioural tests and does not replace them.

## Card A/4 implementation notes (CE hardening + user_type audit)

- Inventory sites converted; final raw-check grep found 72 sites vs 66 inventoried (extras converted too). Guarded by `server/src/test/unit/userTypeRawChecks.static.test.ts` (T029).
- PRD R5.7 corrected: `comment_author_type` is `internal|client|unknown`; service authors store `internal`. Display uses `authorKind: service`.
- T026 option name is `includeNonInteractive` (test text says `includeServicePrincipals`).
- `=== 'internal'` classification: human-only / server-action-only sites kept; MSP-scope sites use `isMspPrincipalUserType` (MSP-positive, unknown denied). Round 2: `shared/lib/tickets/responseState.ts` author resolution converted (MSP principal -> `internal`, client -> `client`, else `unknown`, no contact). `commentActions.ts` ~338 `isInternalUser` is `isMspPrincipalUserType(...)` and KEPT: service authors are stored as `internal` (enum has no `service`), so the MSP-principal predicate is the correct one. Remaining raw `user_type !== 'internal'` checks in that file (~187, 532, 778, 802) are human-only allow-lists (service user denied), kept.
- Human-work guard coverage (round 2). GUARDED (`assertHumanWorkAssignee` / `assertHumanWorkOwner`):
  - Workflow `scheduling.ts`: `assign_user` (guard before role check), `create_entry` (guard before insert; already rejected earlier with NOT_FOUND by the internal-only `ensureTechnicianEligibility`, so the guard is defense-in-depth); `ScheduleEntry.update` with `assigned_user_ids` goes through the already-guarded `updateAssignees`.
  - Workflow `timeDomain.ts`: `createWorkflowTimeEntry` (entry owner, which also covers downstream ticket/task resource writes), time-sheet find-or-create insert, `approveWorkflowTimeSheet` (`assertHumanWorkOwner(..., 'approved_by')`).
  - Workflow `tickets.ts`: `reconcileWorkflowTicketAdditionalUsers` (primary + additional users); ticket create/update primary assignee already flows through guarded `createTicketWithSideEffects` / `TicketModel.updateTicket`.
  - Workflow `projects.ts`: `create_task` (assignee), duplicate task (copied assignee and copied `task_resources`).
  - Direct `time_sheets` inserts: `scheduling/inboundActions.ts` find-or-create, `TimeEntryService.getOrCreateTimeSheetForWorkDate`.
  - Appointment requests: client-portal create/update (`preferred_assigned_user_id`), scheduling approval paths (`assigned_user_id`, two sites).
  - Bundle propagation: `ticketBundleUtils.ts` guards `updateData.assigned_to` before both propagation branches (master update was already guarded upstream).
  - UNGUARDED, justified: `timeDomain.ts` ~427 `{...input, user_id: actorUserId}` default is a read/find scope, not a write. Time-entry update/delete use the existing entry's legacy `user_id` (not new assignment). `projects.assign_task` already filters `user_type = 'internal'` and `is_inactive = false` in `resolveActiveTaskAssignmentUsers` (existing allow-list).
  - `rethrowAsStandardError` (workflow `shared.ts`) now maps `HUMAN_WORK_ASSIGNEE_INVALID` / `HUMAN_WORK_OWNER_REQUIRED` to a `ValidationError` carrying the same code (details `{userIds}` / `{field}`); before, they collapsed to `INTERNAL_ERROR`. `scheduling.ts` throws raw errors from the tx callback, so its error keeps its own class and code.
  - Tests: T043 cases in `businessOperations.scheduling.db.test.ts` and `businessOperations.time.db.test.ts` (shared, real DB).
- `TimeSheetService.approveTimeSheet` (F056) WAS a real defect, now fixed. Verified against the real schema (T043b integration test asserts it): `time_entries` has NO `approved_at`/`approved_by`; `time_sheets` has them but NO `approval_notes` or `updated_at`. The update now writes `time_sheets.approval_status/approved_at/approved_by`, puts approver notes in `time_sheet_comments` (real columns: comment_id, time_sheet_id, user_id, comment, is_approver, created_at, tenant), and updates `time_entries` with only `approval_status`/`updated_at`. REST `canApproveTimeSheets` is a stub that always returns false, so the path was unreachable in production. `addComment` and `requestChanges` in the same service also write non-existent columns; out of scope, NOT fixed.
- `createInteractionRecord` treats owner==caller as defaulted. Duplicating a project task with a legacy service resource now fails.
- `packages/product-ext-proxy` imports `@alga-psa/types` without declaring it: fixed, dependency added to its package.json. `packages/client-portal` now also declares `@alga-psa/shared` (appointment-request guard import).
- `clientUserActions.ts` has if-client / else-if-internal chains (service falls through; reviewed, no default branch hit).
- F044 removed duplicate `options`/`validateUser` block in `nextAuthOptions.ts` (only consumer: two tests in `sessionExpiry.test.ts`, removed).
- F043 applied to EE `ssoPreferences.ts` (file named in brief did not exist).
- No REST seat check on client->internal change in `UserService.update` (pre-existing gap).
- Test environment fact: shared workflow `*.db.test.ts` files reject `DB_NAME_SERVER=server` as a production DB (that is what `.env.localtest` sets). They pass with a unique name, one file per name (parallel files sharing one name race on DB create). Run from `shared/`: `set -a; . ../.env.localtest; set +a; export DB_HOST=127.0.0.1; DB_NAME_SERVER=<unique> ../node_modules/.bin/vitest run <file>`. Server integration tests use `TEST_DB_NAME=<unique>` from `server/`. The `app_user` connection cannot ALTER tables, so `createServiceUser` in `_dbTestUtils.ts` applies the F001 migration through an admin connection.
- Pre-existing, reproduced on `dc6e579eb3` in a temporary worktree: `businessOperations.clients.db.test.ts` T004/T005/T011/T012 time out at 5s (Redis ECONNREFUSED in this environment); identical 4 failures on base and on the branch.
- T009 strengthened: `T008.T009.T013.nonInteractiveLogin.integration.test.ts` now calls the real `signIn` callback (credentials, azure-ad, google) for a real `service` row created through the F001-widened constraint; asserts `false`, no `UserSession.create`, no `User.updateLastLogin`, no `sessions` row, and null `last_login_at/method`. (EE SSO link table not checked; not present in CE schema.)
- Round-2 full `server` unit run (`src/test/unit`, SKIP_DB_TESTS=1) found 8 files that PASSED on `dc6e579eb3` and FAILED on the branch (round-1 regressions that the targeted runs missed). Fixed, test/fixture side only:
  - `interactionService.test.ts`, mock the human-work guard module (the unit test hands a fake `{trx:true}`).
  - `appleSignInRoute.test.ts` + `authGlobalMock.contract.test.ts`: global `@alga-psa/auth` mock in `src/test/setup.ts` lacked `assertActiveInternalUser` (apple route now imports it).
  - `ticketDocuments.service.test.ts`, `ticketService.avatarUrls.test.ts`, `invoiceQueries.recurringDetailRead/purchaseOrderSummary.test.ts`: fixtures had no `user_type`; the MSP-positive predicate (unknown denied, by design) now correctly treats a typeless user as client-scope. Fixtures now carry `user_type: 'internal'`.
  - `translationKeyResolution` + billing i18n validators: `orgChart.roles.service` added to all 10 locales (`msp/settings.json`; xx/yy pseudo-locale forms hand-written).
- Remaining server unit failures (8 files, ~43 tests: xeroAdapter, qboOAuthRoutes, calendarActions.sync, EmailWebhookMaintenanceService, importActions, teamsNotificationDelivery.wrapper, featureFlags.cache, ticketCommentInlineImageEmail) fail with the same file set on `dc6e579eb3` (temporary worktree run, since removed). qboOAuthRoutes failing test names vary run to run (flaky).
- `ee/server` `ssoActions.test.ts` fails identically on base (`Cannot find package '@/lib/analytics/posthog'`, alias not resolved in ee vitest). Other 3 covering ee files pass.
- Typecheck after round 2: tsc exit 0 for shared, server, ee/server and every touched `packages/*` that has a tsconfig (product-ext-proxy has none).

## CI-repair round (PR #3807, run 39346137804 at c989cfa0e5)
- No Design Session plan exists under `docs/plans/`; the plan of record is this directory (`ee/docs/plans/2026-10-18-service-principals/`). `git log main..HEAD` entries under `docs/plans/` are main-branch merges.
- Predicate-inversion lesson: the "MSP-positive, unknown denied" rule from round 1/2 is wrong at CLIENT-PATH GATES whose pre-PR check was `user_type !== 'client'`. Callers there may carry a missing/undefined `user_type` (API `ServiceContext.user`, `InvoiceQueryUser`, `user?: any`), and the old behavior kept them on the MSP path. Correct form: `!isClientUserType(user_type)` returns early / takes the MSP path; the client path is taken only when `isClientUserType` is true. `service` users stay on the MSP path. Fixed at `TicketService.resolveClientTicketVisibility`, `invoiceQueries.assertClientPortalInvoiceAccess`, `clients/lib/listSearchSql.ts` (`user_type?: string`), `commentActions.assertClientCanCreateComment` (`user?: any`). Left as `isMspPrincipalUserType`: sites whose user is typed `IUserWithRoles` / comes from `withAuth` (user_type always present), and sites whose pre-PR check was `=== 'internal'`.
- T315 (`ticketExternalLinks`) root cause = the same inversion. The test calls `TicketService.list` with a context user that has no `user_type`; the PR's `isMspPrincipalUserType(undefined) === false` sent it down the client path -> `ForbiddenError: client scope is unavailable`. The retry then failed with "That external record is already linked" (leftover row from the first attempt). Reproduced locally by restoring HEAD's TicketService (fails identically), passes with the fix. Not on main, not flaky.
- Guard-ordering rule: the human-work guard runs AFTER existence/tenant validation of the ids, so a missing/foreign-tenant user keeps its not-found error and only a real-but-non-internal user raises the guard error. `ScheduleEntry.updateAssignees` was the only site that guarded first (it validated existence after delete); it now validates existence, then guards, then replaces assignments. Other guard call sites (TimeEntryService, TicketService, ProjectService, TimeSheetService, ticketModel, projectTask, timeEntryWriteCore, interactionCreateHelper, inbound/appointment actions) have no later existence check, so no change.
- `UserService.update` on a service id now throws the file-local `NotFoundError` (statusCode 404, code NOT_FOUND, same class `delete`/`changePassword` use) instead of a bare `Error` (500). Covered by T026.T013 integration test.
- mobileAuth test: removed pre-`spyOn` `mockClear` on the module's `vi.fn()` (not a function after `restoreAllMocks`); the call-history reset now runs on the spy returned by `vi.spyOn` (without it, history leaks across shuffled tests: 4 failures).
- microsoftSimulator test: the file mocks `@alga-psa/db`, so `assertInteractiveUser` is stubbed via `vi.mock` of the source module (same convention as `nextAuthOptions.authFailureRedirect/rememberedEmail` tests). `assertInteractiveUser` itself is untouched. `@alga-psa/auth` does not export that module as a subpath, so the mock uses the relative source path.
- Local-run note: `invoiceEmailPaymentLinks.journey` reads secrets through its own `getSecret` (`/run/secrets/...`), so locally export `DB_PASSWORD_ADMIN=$(cat ../secrets/postgres_password) DB_PASSWORD_SERVER=$(cat ../secrets/db_password_server)` as literal values.

## Card B (edition boundary + generic hooks) — F005 F046 F047 F048 F049 F051 F092 F096 F097 F098, T037 T038 T041
- No card-local Design Session plan exists for this card; the PRD is the spec. Branch was brought onto its parent by merging `origin/main` (card A already merged there; local `main` is stale).
- Boundary package: `packages/product-service-principals` (`oss/entry.ts`, `ee/entry.ts`, `entry.ts` types shim, shared `types.ts`). Contract: `resolveServicePrincipalApiContext(keyRecord, owner, req) -> ctx | null`, `servicePrincipalKeyGate(owner) -> Promise<boolean>` (true = approved; CE stub always false), `mapServicePrincipalError(e) -> e`. No `tsconfig.json` in the package (product-mcp has none either); package is not yet in `package-lock.json` workspaces (lockfile churn deliberately not committed; `npm install` will add it).
- Alias sites for `@product/service-principals/entry`: `tsconfig.base.json`, `server/tsconfig.json` (entry, ee/entry, ee/*), `ee/server/tsconfig.json`, `services/workflow-worker/tsconfig.json`, `server/next.config.mjs` (diagnostics list, turbopack resolveAlias, webpack alias, EE `entry.ts` alias, CE and EE `NormalModuleReplacementPlugin` forces), `server/vitest.config.ts` and `packages/auth/vitest.config.ts` (vitest resolves the **oss** entry). Other vitest configs do not alias it; add there if a suite imports apiKeyService/apiMiddleware.
- EE side: `ee/server/src/lib/service-principals/index.ts` is an inert placeholder (null / false / pass-through). Card C replaces it. `ee/entry.ts` imports it via `@ee/lib/service-principals`.
- `assertApiPrincipal(subject)` takes either a loaded API user (copied-auth controllers; unchanged semantics: must be internal) or a built context. Only contexts that `buildAuthenticatedApiContext` obtained from the boundary (tracked in a module-private WeakSet) are admitted as non-internal; a self-declared `principal.kind === 'service'` on a context is ignored. The controllers' copied-auth sites still load a user and require internal; card C must route service-owned keys through `buildAuthenticatedApiContext` (or `ApiBaseController.authenticate`) rather than those copies.
- `buildAuthenticatedApiContext(keyRecord, req?)`: new optional `req` param (passed to the boundary; a placeholder Request is used when absent). Internal path result gains `principal`, `actAsUserId: null`, `effectiveUserId` (= `userId`). `context.userId` still means the effective user.
- Rate limit: `TokenBucketRateLimiter.tryConsume` got an optional 5th arg `configOverride` (the limiter called the namespace config getter with the bucket subject, which cannot express a per-context override). `apiRateLimitConfigGetter(tenant, keyId, override?)` returns a valid override. `enforce.ts` only passes the extra args when `context.rateLimitConfig` is valid; otherwise the calls are identical to before (asserted in enforce.test.ts).
- Key gate: allow-list rejects with a new reason `owner_type_rejected`. The existing suspension-gate test fixture needed `user_type: 'internal'` on the user row (a typeless row is no longer admitted; real rows always have the column).
- Second `ServiceContext` (`server/src/lib/types/api.ts`): has no importers anywhere (dead). Left unchanged; `viaPrincipalUserId` is only on the `@alga-psa/db` one that `BaseService` uses (R4.4 names that file only).
- `withViaPrincipal(ctx, row, columns = 'via_principal_id')` in `packages/db/src/services/BaseService.ts`; returns the same object when no via principal. Not called from any write path (card C).
- Kernel: `AuthorizationEvaluationInput.jointSubject` + `AuthorizationReason.subjectUserId`. Joint calls run the whole single-subject path per subject (RBAC, record rules, narrowing, redactions, mutation guards), AND the verdicts, intersect scopes, union redactions, and tag every reason with the subject. No `jointSubject` -> the original code path, untouched. `ee/server/src/lib/authorization/kernel.ts` untouched.
- F098: five null stubs in `packages/ee/src/components/service-principals/` plus an `index.ts`. No EE counterparts added: nothing imports them yet, so the EE build does not need them; card D adds the real `ee/server/src/components/service-principals/*` together with the first importer. The settings tab is NOT registered (nothing to register until card D; an always-null tab would show up empty), so in CE it cannot appear.
- F096 guard: `scripts/guard-service-principals-boundary.mjs` (CLI + exported `findViolations`/`collectRepoFiles`) and test `server/src/test/unit/editionBoundary/servicePrincipalsBoundary.guard.test.ts`. Scans git-tracked+untracked source/json/sql/yaml/sh files (not `.md`) outside the three allowed trees. Reading of ambiguity: the PRD says only the `TIER_FEATURES.SERVICE_PRINCIPALS` key lives in `packages/types`, so the tier key is NOT "the entitlement". "The entitlement" = `SERVICE_PRINCIPAL_ENTITLEMENT` (R6.1) plus its limit surface (`SERVICE_PRINCIPAL_LIMIT*`, `service_principal_limit`). The `'service'` purpose pattern is "word purpose and a quoted 'service' on the same line", so the `service` user type is not flagged. Multi-line purpose tuples would slip through; revisit if card C adds a purpose union.
- Verification facts: `timeSheetServiceScheduleEntryCalendar.test.ts` ("publishes SCHEDULE_ENTRY_UPDATED...") fails identically on `origin/main` (card A's `.select` on a mocked tenantDb); not from this card. Typecheck of `server` needs `NODE_OPTIONS=--max-old-space-size=14000`.

### Card B review follow-ups — notes for card C

- **Copied-auth controllers stay internal-only.** `ApiContactController`, `ApiProjectController`, `ApiQuickBooksController`, `ApiTeamController`, `ApiTicketController`, `ApiTimeEntryController`, `ApiTimeSheetController`, `ApiUserController`, `ApiWebhookController`, `ApiBaseController.authenticate` and the three document routes load the user themselves and call `assertApiPrincipal(user)` with the loaded user (not a context). Without a boundary-produced context that means `user_type === 'internal'` is required, so a service principal cannot reach them. Only `buildAuthenticatedApiContext` calls `resolveServicePrincipalApiContext`. Card C must route these through the shared builder (or the WeakSet-tracked context) before service keys can use those endpoints.
- **Settings tab is not registered.** `ServicePrincipalsSettingsTab` exists only as a null stub in `packages/ee/src/components/service-principals/`; no settings tab list references it. Registration belongs with the real UI.
- **EE component counterparts are deferred.** No `ee/server/src/components/service-principals/*` counterparts were added because nothing imports the stubs yet (`guard:ee-import-counterparts` only checks imported `@enterprise/*` paths). Add them together with the first importer.
- **Guard `'service'` purpose check** is windowed: a quoted `'service'` literal with the word "purpose" within 3 lines (either direction) is flagged; `user_type: 'service'` / `userType === 'service'` values are excluded. A literal more than 3 lines from "purpose" is NOT detected (covered by a test documenting the limit). Script: `npm run guard:service-principals-boundary`.
- **Alias sites added in the review pass:** `ee/temporal-workflows/tsconfig.json` maps `@product/service-principals/entry` to the **ee** entry (that runtime is EE-only, and `packages/auth` is reachable from its build); `@product/service-principals/types` is mapped in tsconfig.base, server, ee/server and temporal-workflows, and exported as `./types` from the package. `ee/server/src/lib/service-principals/index.ts` imports types through that specifier.
- **Lockfile:** `package-lock.json` has the `node_modules/@product/service-principals` link and `packages/product-service-principals` entries only (mirroring `@product/mcp`).

### Card C (EE core) — 2026-10-31 notes

- **Migrations:** `ee/server/migrations/20261018100000_create_service_principals_schema.cjs`, `...100100_add_service_principal_permissions.cjs`, `...100200_migrate_agent_users_to_service.cjs` (R9.2 data migration; ships with the R4.6 `agents.ts` rebuild). Test DBs need the merged EE dir: `buildMergedEeMigrationsDir()` in `server/test-utils/eeMigrations.ts`.
- **Tests live under `ee/server/src/__tests__/`** (unit + integration), not `server/src/test`: the F096 guard forbids service-principal literals outside `ee/`. `ee/server/vitest.config.ts` gained an `@/lib/mcp/*` alias for the MCP act-as test.
- **New tenants (resolved):** existing tenants get `service_principal` from migration `20261018100100`; new tenants get it from the shared permission catalog. `server/migrations/utils/permissions/catalog.cjs` now loads edition *contributions* (`*.cjs` arrays of catalog entries) from `ee/server/permission-catalog/` (source checkout) or `./contributions` (packaged Temporal image; `ee/temporal-workflows/Dockerfile` copies the dir in both stages, asserted by `permission-catalog-packaging.test.ts`). A tree without that dir loads the catalog unchanged (CE layout: 245 psa perms vs 249 with the contribution). Covered by `servicePrincipalPermissionProvisioning.integration.test.ts` (runs the real onboarding seeds 01-03). Note for review: the monorepo always contains `ee/`, so a CE build from this repo also seeds the (inert) resource unless its image omits `ee/server/permission-catalog`; `catalogVersion` changes accordingly.
- **F089 (done):** generic `RouteDecorator` extension point on `ApiOpenApiRegistry` (`server/src/lib/api/openapi/registry.ts`); `sdk/scripts/generate-openapi.ts` loads `decorateOpenApiRoute` from `packages/product-service-principals/{oss,ee}/openapi.ts` by edition (oss = identity). The EE decorator adds the optional `X-Alga-Act-As` header to every `/api/v1/*` ApiKeyAuth route (755/755 in the EE doc) plus ACT_AS_NOT_SUPPORTED (400), ACT_AS_NOT_ALLOWED (403), ACT_AS_REQUIRED / ACT_AS_INVALID_TARGET / HUMAN_WORK_ASSIGNEE_INVALID (422) descriptions. Regenerated: `sdk/docs/openapi/alga-openapi.ee.{json,yaml}` and `ee/server/src/chat/registry/apiRegistry.generated.ts` (`node ee/scripts/generate-chat-registry.mjs`, reproduced byte-identical). **Scope decision:** the F096 guard exempts exactly the two generated `alga-openapi.ee.*` files (they describe the EE header by design). The CE docs and CE MCP registry (`server/src/lib/mcp/registry.generated.ts`) were left at HEAD: they carry no act-as content and their regeneration diff was only unrelated main drift. The EE docs include that same main drift, since the generator emits the whole document. Generator: `cd sdk && npm run openapi:generate -- --edition ee`; it imports workspace `dist/` builds, so stale `shared/dist` / `packages/billing/dist` make it fail with ERR_MODULE_NOT_FOUND / missing-export errors (rebuild those first).
- **T014, T017–T020, T023, T040 (done):** DB integration tests in `ee/server/src/__tests__/integration/` on a shared harness (`helpers/spHarness.ts`: one disposable CE+EE-migrated DB per file, real EE service/keys, contexts built through the real middleware→EE boundary). Defects they exposed, fixed: (1) `TimeEntryService.create` never stamped `created_via_principal_id` (the shared write core bypasses BaseService) → stamped in the write transaction; (2) `writeTicketActivity` kept actor_type `api` under act-as → the human is `user`; (3) `InteractionService.create` never stamped `interactions.created_via_principal_id` / the linked `schedule_entries` row (shared helper bypasses BaseService) → stamped in the transaction. T020 reading: `time_entries` has no `approved_by`/`approved_via_principal_id`, so time-entry approve asserts `approval_status` + `updated_via_principal_id`; the time-sheet half asserts `approved_by` + `approved_via_principal_id` as written. `ee/server/vitest.integration.config.ts` resolves `@product/service-principals/entry` to the EE entry and aliases only those `@/lib/<name>` entries that exist solely under `server/src/lib` (never shadows an EE-owned name). `ee/server/vitest.config.ts` also maps `@product/service-principals/{entry,types}` (EE) so `npm run test:unit` resolves `apiKeyService`.
- **Run commands:** integration: `cd ee/server && set -a; . ../../.env.localtest; set +a; DB_HOST=127.0.0.1 ../../node_modules/.bin/vitest run --config vitest.integration.config.ts <files>` (~90 s boot per file; avoid running alongside tsc). `permission-catalog-packaging.test.ts` false-fails if a stray `/tmp/server/migrations/utils/permissions` exists (its resolver walks up from `os.tmpdir()`); run with a nested `TMPDIR`.
- **`service_principals` tenant-table registration is lazy** (`ee/server/src/lib/service-principals/tables.ts`, `servicePrincipalDb`). It used to run at `service.ts` import time, which (a) broke every test with a partial `@alga-psa/db` mock that transitively imports the EE entry (e.g. `getLinkedSsoProvidersAction.test.ts`) and (b) made `boundary.ts` depend on `service.ts` having been imported first.
- **EE unit suite (`cd ee/server && npx vitest run src/__tests__/unit`):** 299 files, 9 failing files: `ssoActions`, `extensionInstallApiTier`, `huduAssetSyncActions.db`, `huduAssetMappingActions.db`, `huduSettingsPageCategory`, `credentialAuditScreen.component`, `credentialsScreen.component`, `temporalJobRunner.scheduleRecurringJob`, `temporalJobRunner.createJobRecord`. All 9 also fail on the card-B parent `1a790a6721` (module-resolution gaps, the DB-backed hudu tests need DB env, and component assertions), so they are not from this card. `getLinkedSsoProvidersAction` failed on the parent and passes now.
- **Pre-existing, not this card:** `ee/server` tsc (`strict: false`) reports 6 errors in `server/src/lib/api/services/TicketService.ts` (external links / bundle result narrowing, from origin/main commits d295b9ef8c, fccdbb37aa, 1059a5712c); `server` tsc (strictNullChecks) is clean.
- **T027** is satisfied by card A's `T026.T013.serviceUserManagement.integration.test.ts` (F085 immutability, F086 create/seat limit).
- **MCP:** tool calls accept `act_as_user_id`; `agents.ts` creates service users + `service_principals` rows (`kind='mcp_agent'`), `agents.active` kept in lockstep with `users.is_inactive`.
- **Controllers:** the codemod'd controllers needed `apiAuthContext` threaded into `assertManualProductAccess` (time entry/sheet) and `resolveScheduleAccess`. `apiAuthInventory.contract.test.ts` now accepts `buildAuthenticatedApiContext(` as the guard (base controller delegates to it).
- **`is_internal` comment default** removal and the claim-only appliance limit: see service/entitlements; appliance reads only the verified signed claim `service_principals` (fallback 10), never `tenants.service_principal_limit`.

### Production-build import-cycle repair — 2026-11-03

- **Cause:** `@alga-psa/auth` exports `ApiKeyService`; its top-level `@product/service-principals/entry` import selected the EE entry, which re-exported the whole `@ee/lib/service-principals` index. That eagerly evaluated the EE boundary/service/entitlement modules (including auth-dependent users actions) while the auth barrel was still initializing, producing `withAuth is not a function` during `/api/clients` page-data collection.
- **Repair:** `ApiKeyService` now imports the entry inside the non-internal key-gate operation. The EE entry has async call-time wrappers for context resolution and key gating, dynamically importing only `boundary.ts`; its synchronous error mapper comes from a side-effect-free `errors.ts` module. Error mapping and boundary rejection behavior are unchanged. Added `servicePrincipalEntry.lazy.test.ts`, which verifies the boundary module factory remains uninitialized until a hook is called.
- **Verification:**
  - EE unit: `cd ee/server && ../../node_modules/.bin/vitest run --config vitest.config.ts src/__tests__/unit/servicePrincipal*.test.ts` — exit 0, 5 files / 31 tests.
  - Auth API-key unit: `cd packages/auth && ../../node_modules/.bin/vitest run --config vitest.config.ts src/services/apiKey*.test.ts` — exit 0, 6 files / 28 tests.
  - CE boundary unit: `cd server && ../node_modules/.bin/vitest run --config vitest.config.ts src/test/unit/api/servicePrincipalBoundary.ce.middleware.test.ts src/test/unit/api/servicePrincipalBoundary.ce.keyGate.test.ts` — exit 0, 2 files / 20 tests.
  - EE integration: `cd ee/server && set -a && . ../../.env.localtest && set +a && DB_HOST=127.0.0.1 ../../node_modules/.bin/vitest run --config vitest.integration.config.ts src/__tests__/integration/T0*.test.ts src/__tests__/integration/servicePrincipal*.test.ts` — exit 0, 11 files / 48 tests.
  - Auth typecheck: `npm run typecheck --workspace @alga-psa/auth` — exit 0.
  - EE typecheck: `cd ee/server && NODE_OPTIONS=--max-old-space-size=14000 ../../node_modules/.bin/tsc --noEmit -p tsconfig.json` — exit 2 with six existing `server/src/lib/api/services/TicketService.ts` errors. The same six baseline errors were independently verified against the card-B parent (`1a790a6721`) and are unrelated to this repair; no changed file was reported.
  - `~/.alga-xo/scripts/review-app.sh` has no build-only mode and ends by `exec`ing `next start`. To honor the stopped-server constraint, ran its exact build phases without that final server command: `NEXT_DIST_DIR=.next-review PORT=23835 npx nx build-deps server` — exit 0; then from `server/`, `NEXT_DIST_DIR=.next-review PORT=23835 NODE_OPTIONS=--max-old-space-size=12288 NODE_ENV=production npx next build --webpack` — exit 0. The enterprise production build collected page data, generated 74 static pages, and emitted `/api/clients`; the reported `(0, m.withAuth) is not a function` failure did not recur.
- **Remaining uncertainty:** none specific to the repaired import cycle was observed. The full EE typecheck remains red only for the six documented baseline `TicketService.ts` errors. The production build emitted unrelated existing webpack warnings; it completed successfully.

### Card C mitigation — 2026-11-03

- **Archived MCP agents:** `listAgents` previously returned every `agents` row, including a backing principal with `archived_at`. It now joins the registered EE `service_principals` table using tenant equality and casts the two relationship IDs to text because the existing columns have different PostgreSQL types. Only archived principals are excluded; inactive non-archived agents remain listable. R8.3 archival, key revocation, IdP cleanup and audit retention are unchanged.
- **Time-entry attribution:** the shared `persistTimeEntry` core now calls an edition hook inside its transaction after successful writes. EE sets current update attribution (or clears it for a direct human update); on create it sets both provenance columns. Updates leave creation attribution untouched. The EE hook returns the authoritative stamped columns from `UPDATE ... RETURNING`, and the shared core merges them into `persisted.entry`, so callers receive the same attribution as the database. The CE hook returns an empty object without querying EE-only columns, preserving CE schema compatibility. The REST wrapper passes its boundary attribution through this shared hook.
- **Plan review:** T006 and T017 descriptions now include archived-agent list behavior and the delegated → human → different-principal transition. Existing card C `implemented` flags were already true and remain true; no card D IDs changed. Reviewed against PRD R8.3, R5.5 and the act-as attribution requirements.
- **Database fixture correction and impact:** T003 uses disposable `sp_c4_service_test`; T017 uses disposable `sp_t017_time_entry`. The earlier erroneous runs named `server_card_sp_c4`, but `.env.localtest` routed them to the isolated local PostgreSQL instance on port 5472, where `createTestDbConnection` recreated only that test database. Read-only checks showed no known review fixtures there. The board review database with the same name is on port 5474; its review tenant, QA user, archived agent, time entry, tickets, and principal rows were intact. No tests were rerun against either `server_card_sp_c4` database.
- **Behavioral checks:** T003 passed 8/8 using `sp_c4_service_test`; T017 passed 3/3 using `sp_t017_time_entry`, including returned and persisted attribution and edited values across delegated creation, direct-human shared-writer update, and a later update by another principal. The CE OSS-hook test in `servicePrincipalBoundary.ce.middleware.test.ts` passed 13/13. Scheduling typecheck passed. Server typecheck explicitly exited 0 with no diagnostics. EE server typecheck exited 2 with six known baseline errors in `server/src/lib/api/services/TicketService.ts`; no changed file was reported.
- **Production review of code commit `3ae2730cfd36d90eb17e5da829a317d183720c77`:** the board-managed `review-app:6` ran `PORT=23835 bash ~/.alga-xo/scripts/review-app.sh` from `server/`. The production build completed at 16:22:56Z after page-data collection and generation of all 74 static pages; `BUILD_ID=build-1793722452147` and `.next-review/.alga-review-revision=3ae2730cfd36d90eb17e5da829a317d183720c77+da39a3ee5e6b` matched the clean pushed tree. Build/start log: `/home/robert/.alga-dev/card-services/card-service_408b0ddd-de45-4ef6-bf35-b88251c8515c_review-app_6/service.log`. Board health and local `/api/health` both returned HTTP 200. A QA Auth.js session then requested `/api/clients` and got HTTP 200 `application/json`, an array of 5,088 client rows with `client_id`/`client_name` fields. This evidence applies only to `3ae2730cfd36d90eb17e5da829a317d183720c77`; the later `a4bb0a820c218a5786c677a18cd3ee4664bc573d` rebuild remained queued and has no production verification evidence yet.

### Card C mitigation revalidation — 2026-11-03

- **Inspection:** branch and PR head were both `a4bb0a820c218a5786c677a18cd3ee4664bc573d`; PR 4067 targets `main` at `382a1c2c27d3ac14ae1147f250b043c008b8e385`. Existing untracked `.next-review/` and `tools/smoke-sim/` artifacts were preserved. The latest review-app stamp still names `3ae2730cfd36d90eb17e5da829a317d183720c77`, so it is stale for the PR head. The board project reported its final-revision review-app restart queued for memory; service-list requests timed out, including one transient JetStream state-unavailable response. Host memory later showed 37 GiB available, but no board admission/start confirmation was available. No duplicate build or direct server restart was started.
- **Fresh behavior checks:** on local PostgreSQL `127.0.0.1:5472`, `sp_c4_service_test` T003 passed 8/8 and `sp_t017_time_entry` T017 passed 3/3; both integration runs isolated the integration config's generic workspace bootstrap as `sp_c4_workspace_setup`. T006 now calls the existing `/api/v1/mcp/audit` route after archive, checks unauthenticated requests get 401, then checks the authorized-admin route response contains the retained audit row via the real `exportAgentAudit` implementation. EE service-principal unit files passed 31/31; CE boundary middleware/key-gate tests passed 20/20; F096 guard test passed 15/15; `npm run guard:service-principals-boundary` passed.
- **Guard build-output handling:** the F096 collector had treated unignored files under the preserved `.next-review/` build as CE source and falsely reported EE markers. The collector now excludes generated Next build directories (`.next` and `.next-*`), with a test asserting they are not enumerated. This preserves the boundary check for tracked and untracked source while allowing required production artifacts to remain in the worktree.
- **Typechecks:** `NODE_OPTIONS=--max-old-space-size=14000 npm run typecheck --workspace server` passed; `npm run typecheck --workspace @alga-psa/scheduling` passed. EE `tsc --noEmit -p tsconfig.json` still exits 2 with six existing errors in unchanged `server/src/lib/api/services/TicketService.ts` sections (external-link input narrowing and bundle result narrowing); `git blame origin/main` traces those sections to pre-existing 2026-06/09/18 commits. No changed attribution, agent, guard, or test file is reported.
- **Production evidence limitation:** current local review service is healthy on port 23835, but its stamp and process serve `3ae2730cfd36d90eb17e5da829a317d183720c77`. An unauthenticated `/api/clients` returns 401 as expected, which does not meet the authenticated-response criterion. Build/start and authenticated `/api/clients` evidence for `a4bb0a820c218a5786c677a18cd3ee4664bc573d` remains pending with the board-managed service queue and must not be inferred from the older build.
- **Draft review:** the independent draft-review verifier found no blocker in the final card C additions. It confirmed the archive/list semantics, attribution hook and CE stub, route-level audit assertion, F096 collector behavior, and the existing paired R9.2 migration/R4.6 API boundary.

### Card C mitigation verification — 2026-11-03

- Reconfirmed branch and PR #4067 at `673e22c42e272262f92b84ac611998ca615f6e5b` before this follow-up. The archived-agent filter, EE time-entry attribution hook, CE no-op and deferred EE imports were already present; T003 covers retained authorized audit export and inactive-agent list visibility, and T017 covers persisted attribution across delegated creation, direct-human update and a different principal's later update. No service behavior or implemented flags needed changing.
- Fresh DB checks on local PostgreSQL `127.0.0.1:5472`: T003 passed 8/8 using `sp_c4_service_test`; T017 passed 3/3 using `sp_t017_time_entry`. Port 5474 and the review fixture database were not used.
- Fresh focused checks: EE service-principal units 31/31; CE boundary and key-gate units 20/20; F096 edition-isolation guard test 15/15; standalone `npm run guard:service-principals-boundary` passed; API-key service units 28/28. Server and scheduling typechecks passed. EE typecheck reports only the six pre-existing `TicketService.ts` errors after adding its missing EE `@product/mcp/entry` path. That mapping matches the integration runner's EE entry alias and makes the route-level audit test's actual import type-resolvable.
- The `review-app:6` board service currently lists as live and healthy, but the existing build stamp must be checked against the final pushed revision. Final production build/start and authenticated `/api/clients` evidence remain pending until after publication; preserve any board-owned queued restart and do not infer a pass from health alone.
- Re-review this diff against `PRD.md` R8.3 and R5.5 attribution semantics before closing Card C. No `features.json` or `tests.json` implementation flags changed in this follow-up.

### Card C mitigation recheck — 2026-11-03

- **Starting revision and scope:** PR #4067 targets `main`; branch and PR head were `d5f31be3899244928f7147ff0422cc72a1599897`. The archived-agent filter and shared time-entry attribution mechanism were already correct. No implementation changes or `features.json` / `tests.json` flag changes were needed. Existing unrelated untracked `.next-review/` and `tools/smoke-sim/` artifacts were preserved.
- **Archive/list and audit:** `listAgents` filters only principals with a non-null `archived_at`; it does not filter `agents.active` or remove rows with no matching legacy principal. T006 behavioral coverage in `T003.servicePrincipalsService.integration.test.ts` passed 8/8 on the disposable `sp_c4_service_test` database. It verifies an inactive non-archived agent remains listed, the archived agent disappears, an unauthenticated audit export returns 401, and an authorized admin receives the retained audit row through the real export route.
- **Attribution and CE boundary:** T017 passed 3/3 on disposable `sp_t017_time_entry`, including delegated create, direct-human update clearing `updated_via_principal_id` while preserving `created_via_principal_id`, and a later delegated update replacing the update principal, with returned and persisted values checked. CE OSS boundary suites passed 35/35; the attribution stub test supplies a connection whose table access throws, proving CE does not query EE-only columns. EE service-principal unit tests passed 31/31. `npm run guard:service-principals-boundary` passed.
- **Typechecks:** scheduling and server typechecks exited 0. EE server typecheck exited 2 with the same six known `server/src/lib/api/services/TicketService.ts` errors (lines 1786, 2701, 3555, 3601, 3715, 3716); no changed file was reported.
- **Draft review:** verification run `aa58b308-59dd-4cf1-8797-2406cddb5b50` passed for `d5f31be3899244928f7147ff0422cc72a1599897` against this directory's `PRD.md`. It found no Card C blocker and cited the archived list/audit behavior, attribution transitions, CE no-op, and deferred EE imports.
- **Production review:** preserve board restart operation `24cf4ed4-7efc-4875-aecf-a90c3ce36e16`; its running script captured requested code revision `d5f31be3899244928f7147ff0422cc72a1599897+da39a3ee5e6b`. Evidence is in `/home/robert/.alga-dev/card-services/card-service_408b0ddd-de45-4ef6-bf35-b88251c8515c_review-app_6/service.log` and `server/.next-review/`. The service entered `phase=building`, but at recheck its `next build` process remained active without a revision stamp or HTTP listener (`/api/health` HTTP 000). No duplicate restart or competing build was started. Production acceptance for the final published revision remains pending; recheck the existing board operation and authenticate `/api/clients` only after the final revision is served.

### Card C fresh UI verification attempt — 2026-11-03

- **Starting revision and plan:** branch `feature/service-principals-c-4-ee-core-schema-service-en` was clean apart from pre-existing untracked `.next-review/` and `tools/smoke-sim/` artifacts, and HEAD/origin were `a29e82f8c9633e6956b746a58ea76f9cd35accb9`. The plan source revision `8762fbffe58951cc74ba2ed1227487935da95735` is an ancestor of HEAD. No implementation flags or other cards' flags were changed.
- **Application prerequisite:** did not start or restart either application. Port 3835 had no listener. The already-running review app on port 23835 reports `.next-review/.alga-review-revision = a29e82f8c9633e6956b746a58ea76f9cd35accb9+da39a3ee5e6b`; `/api/health` returned HTTP 200 at 2026-11-03T19:22:17Z.
- **Viewer route diagnosis:** applied the `algadev` skill. `list-browsers`, `browser-get-url`, and `browser-get-dom` succeeded through both `/tmp/ghostty-pane-ide/agent-cli.sock` and `/tmp/ghostty-pane-ide/cli.sock`, but inventory contained only pane `55385c5a-c4ab-4a6f-b287-0cec34235b03`, owned by another card. `space-new-tab --type=browser --projectId=408b0ddd-de45-4ef6-bf35-b88251c8515c` returned `Unsupported method: cli.request` through both sockets. Source inspection found the live Alga Dev agent dispatcher lacks a `cli.request` method case; a viewer-command relay helper exists in a separate dirty Alga Dev checkout, but is not active in the live dispatch path. Fixing this requires an Alga Dev runtime change/reload. I did not modify that separate checkout or restart its shared host process, since that could disturb unrelated work. No target-card browser action or application UI interaction was possible.
- **Unperformed UI assertions:** archived agent `5823a340` list absence, inactive agent `03889177` visibility, archived-agent authorized audit history, and the direct QA timesheet UI edit/reopen were not rechecked. The earlier `saveTimeEntry` HTTP action is lower fidelity and is not counted as fresh UI evidence. No card fixture API or database checks were run in lieu of the missing UI route. Exact diagnostic record: `ee/docs/plans/2026-10-18-service-principals/evidence/a29e82f8c9633e6956b746a58ea76f9cd35accb9-ui-routing-blocked/`.
- **Evidence artifacts:** no screenshots or `smoke-walkthrough.webm/.vtt/.json` were created because there was no browser for this card and no authenticated UI action to record. The revision-labelled directory contains the timestamped route diagnosis and clearly records these omissions; it does not rename or reuse the prior `/tmp/alga-smoke-evidence/service-principals-c4-20261103-1915` files.
- **Diff review:** documentation-only change compared against this plan's PRD, including R8.3's archive/deactivate/key deletion/IdP release/list hiding/audit retention rules and R5.5's via-principal attribution requirements. No product defect was newly evidenced, and no product code, migration, feature/test flags, or other card implementation flags changed. T003/T017 and typechecks were not rerun because product code was unchanged; their prior behavioral results remain historical evidence only.
- **Disposition:** fresh UI verification remains blocked specifically at Alga Dev's missing `cli.request` viewer dispatch. The routing defect is diagnosed but not repaired in the live shared runtime; all product UI assertions and requested recordings remain unperformed.

### Card C routing repair and fresh UI verification — 2026-11-03 follow-up

- **Supersedes the blocked disposition above.** The card worktree remained at published product revision `a29e82f8c9633e6956b746a58ea76f9cd35accb9`; plan origin `8762fbffe58951cc74ba2ed1227487935da95735` is an ancestor. Review app port 23835 served stamp `a29e82f8c9633e6956b746a58ea76f9cd35accb9+da39a3ee5e6b`. Port 3835 was not started. No product implementation or feature/test flags changed.
- **Routing failure and repair:** the previous live host release `692866e297` rejected `cli.request` before the browser viewer. The isolated Alga Dev checkout `fix/cli-capable-viewer-routing` at `f1627486d2440b5b82734a29c0782482630e17eb` integrates dispatch through the existing project-aware `routeViewerCommand` / `requestHubCommand` relay, preserving project/host ownership and deadline. Its behavioral coverage passed 22/22 across five routing files; `npm run agent:build && npm run build` passed. After activation, a project-scoped `space-new-tab` succeeded and `get-layout`, browser inventory, navigation, page text/DOM inspection, reload, a harmless cell click, and screenshots succeeded. The shared CLI service later loaded release `f1627486d2` under its supervisor; the original authenticated pane then disconnected. No Alga PSA app server was restarted. The active shared Alga Dev source checkout was not edited; its unrelated dirty files were preserved.
- **Fresh MCP UI and data:** in the authenticated QA browser at the verified revision, a post-reload DOM assertion found archived `5823a340-1626-4519-97ed-1f43946eabff` absent and inactive, non-archived `03889177-f70a-4050-ae02-b23ebdbb0a68` visible. The authorized same-origin audit flow returned HTTP 200 with both retained historical rows while the archived agent was absent. Read-only SQL on `127.0.0.1:5474/server_card_sp_c4` corroborated `archived_at` state, inactive status, and audit row count. A direct API-key request to `/api/v1/mcp/agents` returned 401 because the route requires a user session; this is recorded as an API limitation, not a passing API assertion.
- **Fresh QA timesheet UI:** a new entry was created through the real act-as REST path. Both via fields initially identified principal `4c725ada-2d39-4c46-b7b5-8ebad758b845`. QA user `bb3d9c78-6da3-4d77-859e-d014d9709f1e` edited notes in the timesheet dialog and saved; the UI success toast was recorded. The reopen action was clicked, but the authenticated pane disconnected before its loaded notes field could be asserted. Post-save read-only SQL confirms the edited notes, preserved `created_via_principal_id`, `updated_via_principal_id = NULL`, and `updated_by` equal to QA. The later scoped local viewer had no QA session, so no credential was guessed or injected.
- **Evidence:** `evidence/a29e82f8c9633e6956b746a58ea76f9cd35accb9-ui-verified-20261103-1929/` contains fresh MCP screenshots, QA timesheet screenshots, `smoke-walkthrough.webm/.vtt/.json`, sanitized pre-edit create response and post-save SQL, API result, and README. The recorder owner disconnected before normal finalization; the playable WebM was stream-copy remuxed. Exact browser mark times and approximate early frame-boundary chapters are distinguished in the JSON. The final recording screen shows the saved toast; the reopen click is in the recorded action sequence, while the persisted values are proven by SQL rather than a settled reopened-form screenshot.
- **Review scope:** no implementation changes were made. Existing T003/T017 behavior and attribution repairs remain covered by prior disposable-database runs; the fresh database reads were read-only and no destructive test setup ran against `server_card_sp_c4` or shared `server`. The draft review must continue to compare the final diff with the PRD, including R8.3 list/audit retention and the R5 via-principal attribution requirements. No other card implementation flags changed.
- **Remaining limitation:** the reopened UI field itself was not visually confirmed after viewer ownership changed. To finish that exact assertion, an authorized QA session must be reattached to a stable project-scoped browser viewer (or the QA user must provide usable sign-in credentials for the newly scoped local viewer). Do not restart the shared Alga Dev host or app server to recover it.
- **Activation caveat:** the isolated checkout's `npm run dev` ran its build hooks; afterward the shared host supervisor's child reported release `202611031936-gf1627486d2` (matching isolated commit `f1627486d2`). The authenticated pane disappeared during that handover. No explicit supervisor restart command was issued and no Alga PSA app restart occurred, but this was not fully isolated from the shared Alga Dev release watcher; whether other Alga Dev sessions were affected is unknown. Do not repeat that activation path. A later reopened-value capture requires installing the tested dispatcher through an activation path that does not replace the supervisor's shared release while other viewers are connected, then attaching a QA-authenticated pane to the card project.

### Card C viewer routing observation — 2026-11-03 19:57 UTC (historical)

- At this time, inventory and navigation returned success for pane `be074bd7-84b1-4da7-a4bb-f32e23ef33df` and a harmless probe pane. This was time-bound evidence; it did not guarantee that the same pane ID would remain current or routable.
- The review app on port 23835 reports served build stamp `a29e82f8c9633e6956b746a58ea76f9cd35accb9+da39a3ee5e6b`; port 3835 has no listener. Neither app was started or restarted.
- At capture time, target pane `be074bd7-84b1-4da7-a4bb-f32e23ef33df` displayed MSP sign-in with no authenticated QA session. Shell environment exposed no QA credential variable. A read-only connection attempt to `server_card_sp_c4` on port 5474 could not authenticate because no DB credential was available in that session.
- This recheck did not run MCP Settings or timesheet assertions and did not create the requested smoke-walkthrough triplet. The screenshot is only a routing/unauthenticated-state record, not product acceptance evidence. Prior authenticated evidence remains historical.
- Product code, migrations, feature/test flags, and card D scope are unchanged. No new product defect was demonstrated. Review this documentation-only record against PRD R8.3 and the existing attribution semantics before accepting the verification status.

### Card C mitigation disposition — 2026-11-03 22:50 UTC

- **Revision and scope:** branch and PR #4067 were both `5fb6d1ebd88fbb072e5cafb18ff2cb28e219b4ce` at inspection. The only existing untracked paths (`server/.next-review/` and `tools/smoke-sim/`, including its local key) were preserved. The requested `git log main..HEAD --name-only -- docs/plans/` was run; its history is mostly unrelated `docs/plans/` entries, while this plan's authoritative source is `ee/docs/plans/2026-10-18-service-principals/`. Card C ownership and T003/T017 descriptions were read. No product, migration, principal-state, fixture, card D, or plan flags changed.
- **Viewer routing (superseded):** at `5fb6d1ebd88fbb072e5cafb18ff2cb28e219b4ce`, project-scoped `space-new-tab` succeeded and commands then returned success for pane `f9b1c96a-95c0-46ea-b8af-e0deaa1b6039`. A later reproduction showed `space-new-tab` proves tab creation only; pane `f9b1c96a` was absent from current project inventory and returned inconsistent unsupported-method, different-host, and not-found responses. Use the current inventory's pane ID. See `evidence/605341a1b06c379b4144e27dbb260beb77fef417-routing-diagnosis/`.
- **App and fixture boundary:** board service state reports `dev-server` suspended and `review-app` concluded/suspended; ports 3835 and 23835 refused connections. The card app was not started or restarted. The review database is a distinct service on port 5474; no review-fixture SQL was run because no authorized credential for that database was available in this session. The separate `.env.localtest` credentials were used only by the two disposable integration suites below.
- **Behavioral suites:** T003 passed 8/8 in `T003.servicePrincipalsService.integration.test.ts`; T017 passed 3/3 in `T017.timeEntryActAs.integration.test.ts`. Both used the documented local test environment and disposable integration databases. Neither targeted `server_card_sp_c4` or shared `server`. These prove the archive/list/audit and persisted attribution behaviors in the test harness, not the requested live QA UI flow.
- **UI evidence status:** fresh authenticated MCP Settings reload/audit screenshots and the direct QA timesheet edit/reopen assertion were not possible with the app stopped and the card QA pane signed out/on another host. This round created no feature screenshots and no `smoke-walkthrough.webm/.vtt/.json`. Do not treat `evidence/a29e82f8c9633e6956b746a58ea76f9cd35accb9-ui-verified-20261103-1929/` as evidence from this recheck: those artifacts are historical, pinned to product revision `a29e82f8c9633e6956b746a58ea76f9cd35accb9`, and already record that the reopened form value was not visually asserted.
- **Review and production provenance:** the latest completed independent draft-review verification remains run `aa58b308-59dd-4cf1-8797-2406cddb5b50` against product revision `d5f31be3899244928f7147ff0422cc72a1599897`, not this documentation revision. A new board verifier run `4e787c96-7f94-4b97-a948-2da8c3f0140c` was accepted for this diff but remained running without a packet or verdict; it was cancelled at 22:56:41 UTC and recorded `inconclusive` (`Verification cancelled before it produced a verdict`). No new PRD verifier pass is claimed. Preserve production acceptance as historical evidence at exact revision `a29e82f8c9633e6956b746a58ea76f9cd35accb9`, not as a build of a later revision.
- **Reviewer first actions:** inspect this disposition and the prior evidence README, then arrange a board-managed running card app, attach an authorized QA session to a project-owned browser, and provide read-only review-database access before attempting the required fresh Settings and UI timesheet walkthrough. Keep the app-server startup prohibition in force until that infrastructure is supplied through the authorized card workflow.

### Viewer routing correction and blocked UI handoff — 2026-11-03 23:10 UTC

- **Reconciled endpoint/host:** `ALGA_CLI_SOCKET=/tmp/ghostty-pane-ide/agent-cli.sock` selects the local agent CLI responder; `ALGA_PROJECT_ID=408b0ddd-de45-4ef6-bf35-b88251c8515c` scopes project inventory but does not retarget or revive an individual pane. Current inventory returned pane `363aee64-8363-4f73-a507-21e87b473299` on host `ts:robert-Desktop-AMD-Ryzen-AI-Max-300-Series`; `browser-get-url`, `list-pane-tabs`, and navigation to `https://example.com` all succeeded for it. Pane `f9b1c96a-95c0-46ea-b8af-e0deaa1b6039` was absent from current inventory. An earlier explicit request to that ID returned `Unsupported method: cli.request`; later same-turn calls returned different-host/not-found. Therefore the earlier “routing works” claim was overbroad and time/pane-specific, not reproducible for `f9b1c96a`.
- **Supported implementation path:** the isolated Alga Dev checkout `fix/cli-capable-viewer-routing` at exact revision `f1627486d2440b5b82734a29c0782482630e17eb` routes `executeViewerCommand` through `routeViewerCommand`, selecting a `cli.request` capable viewer and otherwise relaying through `requestHubCommand` on NATS subject `wf.cli.hub`. The focused behavioral suites passed 12/12 in that checkout. No source change or shared-supervisor restart was made. Reproducible command output is in `evidence/605341a1b06c379b4144e27dbb260beb77fef417-routing-diagnosis/`.
- **PRD draft review:** an independent reviewer completed against revision `605341a1b06c379b4144e27dbb260beb77fef417`. It found the documentation consistent with R8.3 archive/list/audit retention and R5.5 attribution after correcting the routing claim, with no product behavior blocker. Board run `4e787c96-7f94-4b97-a948-2da8c3f0140c` remains cancelled/inconclusive; it is not called a pass. The review result is recorded at `evidence/605341a1b06c379b4144e27dbb260beb77fef417-routing-diagnosis/draft-review.md`.
- **Workflow handoff:** `workflow-set-attention` recorded `kind=blocked`, `captainRequirement=access`, project revision 176 at `2026-11-03T23:07:53Z`. The card's live service inventory contains only `idp-sim` and `review-guide`. Ports 3835 and 23835 are closed. The app was not started. Fresh authenticated MCP Settings/audit checks, review DB SQL, and the QA timesheet edit/reopen with screenshots and walkthrough triplet remain pending until the authorized running app, QA browser session, and read-only database access are available.
- **Fact corrections:** stale routing facts `a91c4461`, `7cca3992`, `2947b2c3`, and `2ee1034a` were retired. New active facts `bc286fe9`, `54ce82ed`, and `59dfeff8` record the current-inventory route, access blocker, and independent review result.

### Card C mitigation recheck — 2026-11-04 00:17 UTC

- **Baseline:** local HEAD, origin branch and PR #4067 head all matched `1fd88d93ddbea250621ed182567041a783b6b8ae`; PR #4067 is OPEN against `main`. Only the four previously identified untracked build/smoke-sim paths were present, and they were preserved. `git log main..HEAD --name-only -- docs/plans/` showed extensive unrelated `docs/plans/` history; the authoritative service-principals plan is the separately tracked `ee/docs/plans/2026-10-18-service-principals/`, introduced at `8762fbffe58951cc74ba2ed1227487935da95735`. The card C slice remains its 39 features and 21 tests; no implementation flags or product files changed.
- **Fresh viewer routing:** with `ALGA_PROJECT_ID=408b0ddd-de45-4ef6-bf35-b88251c8515c` and `ALGA_CLI_SOCKET=/tmp/ghostty-pane-ide/agent-cli.sock`, `ping` succeeded and fresh `list-browsers` returned an empty inventory. `list-spaces`, `list-terminals`, and another browser inventory request returned `Unsupported method: cli.request`. Thus no current project-owned pane is available for URL inspection, tab listing, or a harmless browser operation; historical pane `363aee64-8363-4f73-a507-21e87b473299` was not reused without current ownership. This matches the previously inspected isolated dispatcher fix at `f1627486d2440b5b82734a29c0782482630e17eb` (`routeViewerCommand` / `requestHubCommand`), but does not establish current pane routing. No shared Alga Dev source, supervisor, or runtime was changed.
- **App and access boundary:** read-only HTTP probes to localhost ports 3835 and 23835 both failed to connect. The project-owned browser inventory is empty and no QA-authenticated browser is available. Review PostgreSQL port 5474 accepts connections, but no authorized read-only credential was available; no connection or SQL was attempted against `server_card_sp_c4` or shared `server`. No app server was started, restarted, healed, or ensured. Accordingly no fresh MCP Settings/list reload, admin audit query, act-as REST creation, direct timesheet UI edit/reopen, review DB assertions, screenshot or walkthrough triplet was produced.
- **Fresh behavioral suites:** after confirming `.env.localtest` points to local disposable test PostgreSQL port 5472 (not review port 5474), T003 passed 8/8 against `sp_c4_service_test`; T017 passed 3/3 against `sp_t017_time_entry`. They ran sequentially with the EE integration config and global setup/teardown. These are current behavioral results, not live QA UI evidence. No source changed, so no typecheck or build was run.
- **Review:** board verifier attempt `5a80ff87-20bf-4c41-92f9-596eda17f661` remained running without output and was cancelled at 00:20:12 UTC; its recorded verdict is `inconclusive`, not a pass. A separate independent read-only diff review passed against `ee/docs/plans/2026-10-18-service-principals/PRD.md`: R8.3 archive/list/audit and R5.5 attribution claims match the PRD and existing mitigation evidence, live UI is not claimed, and all 39 card C feature flags plus 21 test flags remain implemented.

### Card C rollback, attribution and audit repairs — 2026-11-04

- Data rollback restores `metadata.backing_user_id` from `agents.service_user_id` before the schema removes that column. The new disposable-DB round trip creates agents through `createAgent`, checks empty and populated metadata, retries down, and verifies the restored internal users after schema rollback.
- `withViaPrincipal` now lives in a dependency-free DB module, re-exported through `BaseService`. Time-entry attribution, ticket activity and generic audit details use the same helper as the other writers. The EE time-entry adapter supplies null defaults so direct human edits still clear update attribution without adding EE columns to CE writes.
- The archive reference list supports JSON paths as well as columns. Generic audit actors and `details.via_principal_user_id` now retain the principal; database tests verify retained audit rows, revoked keys, freed usage and isolation from references in another tenant.
- Validation: 44 integration tests across nine files, 31 EE unit tests, 38 CE boundary/helper tests, and the DB package TypeScript check passed. Tier/grandfathering and edition-selection code did not change. These are automated results; the live UI smoke walkthrough remains a separate check.

### Card C main merge — 2026-11-05

- Started from `8a40a50f3dda6fc5b69f8e57123600f0588c1708` with no tracked changes. Preserved all five untracked artifact paths. Fetched and merged `origin/main` at `ffde5f4c6e0b8793dd86056ba5c687fe67285ce2`; no rebase or history rewrite.
- Resolved 18 conflicted files. A = generated output, B = current main architecture plus card C semantics, C = main for unrelated structure. No runtime behavior was deferred for lack of a product decision.

| File | Policy | Resolution |
| --- | --- | --- |
| `ee/server/src/chat/registry/apiRegistry.generated.ts` | A | Took main, then ran the registry generator against the retained EE spec; output matches main. |
| `sdk/docs/openapi/alga-openapi.ee.json` | A | Retained main. OpenAPI generation fails loading shared billing paymentPreferences; source-mode attempt fails loading billing named exports. |
| `sdk/docs/openapi/alga-openapi.ee.yaml` | A | Same fallback as the EE JSON spec; no manual generated edits. |
| `ee/server/src/lib/mcp/jsonRpcServer.ts` | B | Kept main argument redaction and retained actAsUserId in the same audit call. |
| `packages/db/src/services/BaseService.ts` | B | Kept main operational write admission and retained the dependency-free via helper import/re-export. |
| `packages/scheduling/src/lib/timeEntryWriteCore.ts` | B | Kept main billing allocation extraction. Retained the edition attribution hook before reconciliation, including clearing update attribution on direct human edits. |
| `server/src/lib/api/controllers/ApiTicketController.ts` | B | Kept main mutation authorization and record-context structure. Asset RBAC checks use principal/human permission intersection. |
| `server/src/lib/api/controllers/assetReadGuard.ts` | B | Kept main throw-based core and response wrapper; RBAC uses principal/human intersection. |
| `server/src/lib/api/middleware/apiMiddleware.ts` | B | Kept main interactive-user guard and retained edition error mapping, delegation-header rejection and principal-aware permission checks. |
| `server/src/lib/api/schemas/ticket.ts` | B | Kept collaboration_audience. is_internal remains optional without a schema default so the service can distinguish omission from an explicit public request. |
| `server/src/lib/api/services/ClientService.ts` | B | Kept main checklist/template deactivation imports alongside principal-aware RBAC. |
| `server/src/lib/api/services/MobileCapabilitiesService.ts` | B | Kept all main asset capability fields and applied principal/human RBAC intersection to those permissions. |
| `server/src/lib/api/services/ProjectService.ts` | B | Kept inventory staging release and after-commit hooks alongside task via stamping. |
| `server/src/lib/api/services/TicketService.ts` | B | Kept main shared upload core and audience handling. Passed via attribution into the upload core; bare principals default comments to internal and cannot publish publicly without act-as. |
| `server/src/lib/api/services/TimeEntryService.ts` | B | Kept main time-source delegation alongside principal-aware RBAC and attribution. |
| `server/src/lib/api/services/TimeSheetService.ts` | B | Kept main time-source delegation alongside principal-aware RBAC, human-work guards and approval/schedule attribution. |
| `shared/lib/ticketActivity/writeTicketActivity.ts` | B | Kept main validated foreign-actor snapshot/reference structure; derive service/human actor kind from that actor and stamp via attribution. |
| `packages/assets/src/lib/assetReadAuthorization.ts` | C | Took main re-export to the authorization package. Its shared AuthorizationSubject already supports service users, so the copied implementation is obsolete. |

- The upload extraction required forwarding `viaPrincipalUserId` through `documents/attachDocument.ts` and `documents/entityAdapters.ts` to ticket activity. The adapter also uses the existing permission-intersection helper. Regression tests exercise delegated upload audit rows, new asset capabilities, MCP redaction plus act-as, comment-schema omission versus explicit visibility, and foreign/local activity attribution.
- Typecheck exposed two additional semantic overlaps in auto-merged files: `ApiTimeEntryController.ts` timer cancellation and `ApiTimeSheetController.ts` per-sheet reads still called the old user lookup, assertion and product-access helper signature. Both now use `buildAuthenticatedApiContext`, carry via attribution, and check the permission intersection while retaining main's route structure. Their focused route suites pass 22/22.
- OpenAPI fallback: `cd sdk && npm run openapi:generate -- --edition ee` fails with `ERR_MODULE_NOT_FOUND` for `@alga-psa/shared/dist/billingClients/paymentPreferences`. A source-resolution attempt using server tsconfig fails on the billing `DEFAULT_RATE_CONFLICT_MESSAGE` named export. The EE JSON and YAML files therefore stay exactly at main. Act-as decorators remain in source, but their generated header/error documentation is deferred until the workspace generator dependencies/loaders work. `node ee/scripts/generate-chat-registry.mjs` succeeds; both registries match main.
- Refreshed local dependencies with `npm ci --ignore-scripts --no-audit --no-fund` to match main's Zod 4 lockfile; no manifest or lockfile changes. Focused unit checks pass: server 101, EE boundary/MCP 15, ticket activity 4, DB services 13, scheduling 2 (135 total). No browser, integration, full-suite or production build was run. Server typecheck passed (`NODE_OPTIONS=--max-old-space-size=14336 npm run typecheck`, exit 0).
- Local command logs and the final first-parent diff stat are under `/tmp/sp-c4-merge-report-20261105/`. Broad merge whitespace warnings come from main; the card delta passes `git diff --cached --check origin/main`.
