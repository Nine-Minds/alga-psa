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
