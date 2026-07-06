# Scratchpad — Teams Production Readiness

Rolling notes from the 2026-07-03 codebase deep-dive (four parallel exploration passes: architecture, bot, meetings, product/ops). Keep appending as implementation proceeds.

## Where everything lives

- **All real logic:** `ee/packages/microsoft-teams/src/` (`@alga-psa/ee-microsoft-teams`). `server/src/app/api/teams/*` are CE stubs (`_ceStub.ts` 501s) + `_eeDelegator.ts` dynamic import. `ee/server/src/lib/teams/*` are one-line re-export shims.
- **Settings UI (CE-safe facade):** `packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.tsx`; actions delegate to EE via dynamic `import('@alga-psa/ee-microsoft-teams/actions')` (`packages/integrations/src/actions/integrations/teamsActions.ts:507,521,535`).
- **Scheduling entry points:** `packages/scheduling/src/actions/appointmentRequestManagementActions.ts` (approve `:505`, meeting create call `:630`, decline `:1199`, reschedule `~:1440`); `packages/scheduling/src/actions/onlineMeetingSchedulingActions.ts:86` (direct scheduling, passes attendees + compensating delete `:270-277`); CE no-op service `packages/scheduling/src/lib/teamsMeetingService.ts:83-132`.
- **Client portal:** `packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts` (cancel `:1235`, post-commit Graph delete `:1454`); cancel dialogs in `AppointmentsPage.tsx` / `AppointmentRequestDetailsPage.tsx` ignore the computed `teamsMeetingWarning`.
- **Artifacts:** subscriptions `ee/.../lib/meetings/artifactSubscriptions.ts` (60h TTL, renewal every 30min); webhook `server/src/app/api/teams/webhooks/recordings/route.ts` (timing-safe clientState); job handler `packages/jobs/src/lib/handlers/teamsMeetingArtifactWebhookHandler.ts`; persistence `packages/clients/src/lib/onlineMeetingArtifactCapture.ts:207`.
- **No SDKs:** Graph + Bot Framework are hand-rolled `fetch`; deps only `@microsoft/teams-js`, `jose`.

## DB tables

- `teams_integrations` (1 row/tenant; install_status, capabilities/categories/allowed_actions JSONB, app_id/bot_id/package_metadata, default_meeting_organizer_upn/_object_id, download_recordings, expose_recordings_in_portal, subscription ids/expiries, meeting_artifact_webhook_secret).
- `teams_notification_deliveries` (unique (tenant, idempotency_key), 90d cleanup), `teams_audit_events` (365d), `teams_conversation_references` (PK tenant+microsoft_user_id+conversation_id).
- Shared CE infra: `microsoft_profiles` (client_id/tenant_id/client_secret_ref — secret-provider reference, not the secret), `microsoft_profile_consumer_bindings` (consumer teams→profile), `online_meetings` + `online_meeting_artifacts`.
- Citus: always tenant in WHERE/JOIN/PK.

## Auth model (two separate systems — the ops footgun)

- **Bot Framework:** GLOBAL env `TEAMS_BOT_APP_ID/_TENANT_ID/_PASSWORD` (`teamsBotConnector.ts:30-67`), token scope `api.botframework.com/.default`.
- **Graph:** PER-TENANT `microsoft_profiles` + `getTenantSecret`; app-only token `graphAuth.ts:5` (NOT cached — possible perf follow-up).
- Generated manifest botId = tenant profile client_id, but runtime bot auth uses the platform env app ⇒ a Bot Framework channel registration matching the manifest botId must exist or the bot silently never replies. F006 diagnostics check + runbook address this.

## Key defects driving the plan (verified file:line)

1. **Unverified surfaces:** only bot messages calls `verifyTeamsBotRequest` (`teamsBotHandler.ts:1173`); quick-actions (`teamsQuickActionHandler.ts:795`) and message-extension (`teamsMessageExtensionHandler.ts:1363`) trust body-supplied `from.aadObjectId`/`channelData.tenant.id`. JWT verifier returns `unconfigured` and the handler proceeds when env unset (`teamsBotJwtVerifier.ts:73-80`).
2. **No attendees on approval meetings:** `appointmentRequestManagementActions.ts:630-636` omits `attendees`; contrast `scheduleTeamsMeeting` which passes them. Nobody real gets a calendar invite; meeting exists only on the shared organizer's calendar.
3. **Lifecycle holes:** decline marks DB cancelled only (`:1277-1284`, no Graph DELETE); client cancel deletes after commit fire-and-forget (`appointmentRequestActions.ts:1454`); reschedule PATCHes times only (`updateTeamsMeeting.ts:53-62`).
4. **Silent failure convention:** all meeting CRUD returns `null`/`false` + `logger.warn` (`createTeamsMeeting.ts:93-194`); approver gets a link-less approval with no signal. File is `// @ts-nocheck`.
5. **Artifact fragility:** `OnlineMeetingModel.listPendingRecordings` has zero non-test callers (fallback never built); renewal never scheduled on pg-boss EE (`server/src/lib/jobs/index.ts:494-508` returns null); `recording_fetch_attempts` cap 3 → premature `no_recording`; encrypted resource data unconditionally throws (`artifactSubscriptions.ts:295`) — fine, subs created unencrypted.
6. **Bot cliffs:** dead-end sign-in card (`teamsBotHandler.ts:1022-1039`); silent no-reply when `!isBotConnectorConfigured()` (`:1216`); strict regexes (`:185-266`); help tells users to paste raw ids (`:280-306`); manifest command list (`teamsPackageActions.ts:221-227`) omits my approvals/approval commands.
7. **Delivery duplication:** wired impl = `packages/notifications/src/realtime/teamsNotificationDelivery.ts` (no recording); richer EE impl w/ `writeTeamsDeliveryRow` (`ee/.../teamsNotificationDelivery.ts:355`) used only by tests/diagnostics ⇒ prod writes no delivery rows; diagnostics recent_delivery_health reads an empty table in prod.
8. **Add-on gate copy-pasted** ~6× (e.g. `meetingConfig.ts:35-44`, EE `teamsNotificationDelivery.ts:299-307`).
9. **Workflow actions latent:** `teams.notify_user`/`send_dm`/`post_to_channel` registered (`registerTeamsWorkflowActions.ts`) but no subscriber invokes them — reusable for F044 bot-DM delivery.

## What already works (don't rebuild)

- Action registry (`teamsActionRegistry.ts`, 2141 lines): 10 actions, layered availability (install → surface capability → allowed_actions → RBAC), idempotency dedup, audit recording. NL layer (E5) and inline card actions (F041) should sit ON this.
- Diagnostics engine: 10 checks + test-message ladder writing typed skipped rows (`teamsDiagnosticsActions.ts:454`, `:311`).
- Entitlement: `ADD_ONS.TEAMS` enforced at ~10 sites; Stripe env `STRIPE_TEAMS_ADDON_PRICE_ID`; paywall shell exists in settings; `ADD_ON_ONLY_FEATURES` prevents tier-unlock.
- Read APIs `listTeamsDeliveries`/`listTeamsAuditEvents` (cursor pagination, permission-gated) — just need UI (F060/F061).
- Handler unit coverage is good (~23 cases); the untested areas are exactly JWT/connector/msgext/quick-action routes (E1 tests fill this).

## Decisions

- **Keep app-only Graph + shared organizer; add attendees** rather than per-technician delegated OAuth (deferred — recorded in PRD non-goals/open questions). Attendees close the "no invite" gap with minimal auth surface change.
- **Jobs via IJobRunner only** (repo policy: Temporal EE, pg-boss CE fallback; never pg-boss directly).
- **Consolidate delivery into the EE impl** and make `packages/notifications` a dynamic delegator (same CE-safe pattern as `teamsMeetingService`).
- **E1 ships first and alone-able** — security fix must not wait for the product work.
- NL layer assumes AI Assistant add-on gating — OPEN QUESTION for product.
- Manifest hard-codes: `TEAMS_MANIFEST_VERSION='1.24'`, `TEAMS_PACKAGE_VERSION='1.0.1'` (`teamsPackageActions.ts:132-133`) — bump package version when manifest command list changes (F042).

## Env vars

`TEAMS_BOT_APP_ID`, `TEAMS_BOT_APP_TENANT_ID`, `TEAMS_BOT_APP_PASSWORD`; webhook base `TEAMS_RECORDINGS_WEBHOOK_URL`/`TEAMS_WEBHOOK_BASE_URL` (fallbacks `PUBLIC_WEBHOOK_BASE_URL`, `NEXT_PUBLIC_BASE_URL`, `NEXTAUTH_URL`; HTTPS enforced `artifactSubscriptions.ts:90-113`); `EDITION`/`NEXT_PUBLIC_EDITION` (string-compared in two places — UI vs server mismatch possible).

## Gotchas for implementers

- JSONB columns come back parsed — no `JSON.parse`.
- i18n: client-portal cancel-dialog warning (F020) needs `t()` keys in portal locales.
- UI reflection: kebab-case `id` on every new interactive element (wizard, viewers, retry buttons).
- Citus: new conversation-context table needs tenant in PK; UPDATEs should select-then-update with params.
- CE build must stay green: any new EE import from shared packages goes through dynamic import + edition guard (see ce-ee-stub-fixer skill if e2e breaks).
- `getTeamsRuntimeAvailability` returns `addon_required` — reuse for paywall states rather than new checks.
