# Scratchpad — Teams Meeting Link on Appointment Approval

## Key file paths

**Scheduling (CE-safe)**
- Approval action: `packages/scheduling/src/actions/appointmentRequestManagementActions.ts` (`approveAppointmentRequest` ~L386-824; email dispatch ~L703-814; schedule-entry creation ~L470-639)
- Approval schema: `packages/scheduling/src/schemas/appointmentRequestSchemas.ts` (`approveAppointmentRequestSchema` ~L34-41)
- Approval panel UI: `packages/scheduling/src/components/schedule/AppointmentRequestsPanel.tsx`
- Entry popup UI: `packages/scheduling/src/components/schedule/EntryPopup.tsx`
- Availability Settings UI: `packages/scheduling/src/components/schedule/AvailabilitySettings.tsx` (tabs at L778-784, total ~1371 lines)
- Availability Settings action: `packages/scheduling/src/actions/availabilitySettingsActions.ts`
- ICS generator: `packages/scheduling/src/utils/icsGenerator.ts` (interface `ICSEventData` L6-18; already supports `url` L101-102 and `location` L97-99)
- CE shim: `packages/scheduling/src/lib/teamsMeetingService.ts`

**Client portal**
- Detail page: `packages/client-portal/src/components/appointments/AppointmentRequestDetailsPage.tsx`
- Cancel action: `packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts`

**EE — Microsoft Teams**
- Profile + secret resolver: `ee/packages/microsoft-teams/src/lib/auth/teamsMicrosoftProviderResolution.ts` (`resolveTeamsMicrosoftProviderConfigImpl` L30-79)
- Shared Graph auth utility: `ee/packages/microsoft-teams/src/lib/graphAuth.ts`
- Integration state: `ee/packages/microsoft-teams/src/lib/actions/integrations/teamsActions.ts` (`getTeamsIntegrationStatusImpl`, `getTeamsIntegrationExecutionStateImpl`)
- Meeting helpers: `ee/packages/microsoft-teams/src/lib/meetings/createTeamsMeeting.ts`, `ee/packages/microsoft-teams/src/lib/meetings/meetingConfig.ts`
- New actions target dir: `ee/packages/microsoft-teams/src/lib/actions/meetings/`
- Capability action: `ee/packages/microsoft-teams/src/lib/actions/meetings/meetingCapabilityActions.ts`

**Migrations**
- Appointment requests: `server/migrations/20251110223310_create_appointment_requests.cjs` (base), `server/migrations/20260416210000_add_requester_timezone_to_appointment_requests.cjs`
- Added meeting columns migration: `server/migrations/20260423130000_add_online_meeting_columns_to_appointment_requests.cjs`
- Teams integrations: `ee/server/migrations/20260307153000_create_teams_integrations.cjs`
- Added organizer migration: `ee/server/migrations/20260423131000_add_default_meeting_organizer_to_teams_integrations.cjs`
- Email templates: `server/migrations/20251111123313_add_appointment_request_email_templates.cjs` + `server/migrations/20251209175019_update_appointment_email_templates_modern_styling.cjs` (both seed `system_email_templates`)

**Email**
- Service: `@alga-psa/email` package — `SystemEmailService.sendAppointmentRequestApproved(data, options)` and `.sendAppointmentAssignedNotification`
- Current approved template fields: `serviceName, appointmentDate, appointmentTime, duration, technicianName, technicianEmail, technicianPhone, minimumNoticeHours, contactEmail, contactPhone, calendarLink`
- Template language: Handlebars via `replaceVariables()`
- Will add: `onlineMeetingUrl` (and probably `onlineMeetingProvider` for future-proofing)

**i18n**
- Schedule namespace: `server/public/locales/<lang>/msp/schedule.json` (human locales: en, de, es, fr, it, nl, pl, pt; pseudo: xx, yy)
- Pseudo generator: `scripts/generate-pseudo-locales.cjs`
- Validator: `scripts/validate-translations.cjs`

## Decisions

- **Organizer model: option (a)** — one designated tenant-level UPN stored on `teams_integrations`. All meetings created as that user. Requires Azure admin to set up an Application Access Policy granting `OnlineMeetings.ReadWrite.All` for this specific user.
- **Admin UI home: Availability Settings → Teams Meetings tab** (not a dedicated integrations page). Rationale: tab only appears after Teams is active; it's tightly coupled to the appointment-approval flow, which lives in Scheduling. Avoids standing up a new integrations-hub surface.
- **Toggle default: ON** when capability is available. Approver can uncheck per-appointment (e.g., on-site visits).
- **Reschedule: PATCH** via Graph. Only times updated; subject left alone.
- **Cancel/delete: DELETE** via Graph + confirmation dialog warning the user the Teams meeting will go away.
- **Client portal: show Join button.** Clients don't need SSO to join — anonymous join still works.
- **Failure UX: warning toast.** Action return shape gains `teamsMeetingWarning?: string`.
- **Out of scope MVP:** retries, orphaned-meeting janitor, per-user delegated OAuth, per-service auto-toggle, recording settings.

## Azure setup (for admin runbook)

Tenant admin must do once in Azure:
1. Grant the Microsoft profile's app registration the **application permission** `OnlineMeetings.ReadWrite.All` (admin consent required).
2. Create an **Application Access Policy** and assign the designated organizer user to it:
   ```
   New-CsApplicationAccessPolicy -Identity Alga-Meetings -AppIds "<clientId>" -Description "Alga PSA appointment meetings"
   Grant-CsApplicationAccessPolicy -PolicyName Alga-Meetings -Identity "scheduling@acme.com"
   ```
3. Wait ~5-10 min for policy propagation.
4. Enter the organizer UPN in Availability Settings → Teams Meetings tab and click Verify.

## Open questions / verification needed before implementation

- Verify CE shim pattern already used elsewhere in the codebase for EE features — look at how calendar or activity notifications are consumed from CE-safe packages today. Mirror that pattern.
- Decide whether `APPOINTMENT_ONLINE_MEETING_ATTACHED` is worth a new event type or if `SCHEDULE_ENTRY_UPDATED` is sufficient.

## Commands

```bash
# CE build
npm run build

# EE build
npm run build:ee

# Run migrations
npm run migrate

# Regenerate pseudo-locales after adding new English keys
node scripts/generate-pseudo-locales.cjs

# Validate translations
node scripts/validate-translations.cjs

# Test Graph call manually (after setting up Azure policy)
curl -X POST "https://graph.microsoft.com/v1.0/users/scheduling@acme.com/onlineMeetings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Test","startDateTime":"2026-04-24T10:00:00Z","endDateTime":"2026-04-24T10:30:00Z"}'
```

## Gotchas

- **`/me/onlineMeetings` vs `/users/{upn}/onlineMeetings`** — `/me` requires a delegated user token; we use app-only auth so we must use `/users/{upn}`. Mistakenly using `/me` is a common Graph pitfall for server-side integrations.
- **`OnlineMeetings.ReadWrite.All` is application permission, not delegated.** Delegated has a subtly different name.
- **Timezone conversion:** `requested_date` + `requested_time` on appointment_requests is the requester's local wall-clock. Graph requires ISO 8601 UTC. Must convert using `fromZonedTime(local, requester_timezone)` before POST.
- **Citus distribution:** `appointment_requests` is distributed by `tenant`; all three new columns are non-key data columns, so migration is fine.
- **Email template storage:** templates are DB rows in `system_email_templates`, not files. Adding the Handlebars `{{#if onlineMeetingUrl}}` block requires a new migration that does an UPDATE, not a code change. Use the pattern from `20251209175019_update_appointment_email_templates_modern_styling.cjs`.
- **Client portal `appointmentRequestActions.ts`** is where unauthenticated-to-authenticated appointment handling lives; public-API created appointments still come through `/server/src/app/api/public/appointment-request/route.ts` and must not regress.
- **`/updateAppointmentRequestDateTime` already exists for pending requests**; for approved requests the analogous update happens through a different path (schedule-entry edit). Need to check both entry points emit the PATCH.

## Related prior context

- Improvement 1 (requester info display) was shipped in the same working session in `AppointmentRequestsPanel.tsx` and `EntryPopup.tsx` — the patterns for conditional rendering on `appointmentRequestData` are now established there and should be reused for the Join button.
- Improvement 1 locale keys added under `requests.detail.labels.requester` and `entryPopup.appointmentRequest.requesterInfo.*` — new Teams keys follow the same neighborhood.

## Links / references

- Microsoft Graph docs: https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings
- Application Access Policy: https://learn.microsoft.com/en-us/graph/cloud-communication-online-meeting-application-access-policy
- Our Teams integration data model (this repo): `ee/server/migrations/20260307153000_create_teams_integrations.cjs`

## Progress log

- 2026-04-23: PRD, features.json, tests.json, SCRATCHPAD created in `ee/docs/plans/2026-04-23-teams-meeting-on-appointment-approval/`. No implementation yet.
- 2026-04-23: Completed `F001` by adding `server/migrations/20260423130000_add_online_meeting_columns_to_appointment_requests.cjs`. Used guarded `hasColumn` checks so the migration is idempotent and safe to re-run in local/dev environments.
- 2026-04-23: Completed `F002` by adding `ee/server/migrations/20260423131000_add_default_meeting_organizer_to_teams_integrations.cjs`. Kept it EE-local and nullable so tenant setup remains opt-in.
- 2026-04-23: Completed `F003` by adding `createTeamsMeeting()` plus shared meeting config and Graph auth helpers under `ee/packages/microsoft-teams/src/lib/meetings/`. The helper reads `teams_integrations.default_meeting_organizer_upn`, resolves the tenant Microsoft profile, POSTs to Graph, logs success/failure, and returns `null` on any soft failure.
- 2026-04-23: Completed `F004` by adding `updateTeamsMeeting()` in the same EE meetings module. It reuses the shared tenant readiness/config resolver, PATCHes Graph with the new ISO datetimes, returns `false` on soft failure, and emits structured update logs.
- 2026-04-23: Completed `F005` by adding `deleteTeamsMeeting()` in the EE meetings module. It issues a Graph DELETE against the organizer-scoped online meeting endpoint, logs failures without throwing, and returns `false` on any soft failure.
- 2026-04-23: Completed `F006` by adding `getTeamsMeetingCapability(tenantId)` under `ee/packages/microsoft-teams/src/lib/actions/meetings/`. Capability follows the PRD contract: `ee_disabled` outside EE, `not_configured` when Teams is inactive or missing a selected profile, `no_organizer` when the organizer UPN is blank, otherwise `available: true`.
- 2026-04-23: Completed `F007` by adding `packages/scheduling/src/lib/teamsMeetingService.ts`. The scheduling package now uses a local EE dynamic-import boundary that returns CE-safe no-op handlers when enterprise code is unavailable or fails to load.
- 2026-04-23: Completed `F008` by extending the scheduling approval schema with `generate_teams_meeting` defaulting to `false`. This keeps existing approval callers backward compatible while allowing the UI to opt in explicitly when capability is available.
- 2026-04-23: Completed `F009` by wiring `approveAppointmentRequest()` to the scheduling Teams meeting service. When `generate_teams_meeting` is true it now creates the meeting, persists `online_meeting_*` columns on success, and threads the join URL into the outgoing approval/assignment email payloads plus the ICS event URL.
- 2026-04-23: Completed `F010` by extending approval responses with `teamsMeetingWarning`. The action now distinguishes capability/setup issues from Graph create failures and still returns `success: true` when the appointment itself was approved.
- 2026-04-23: Completed `F011` by extending `updateAppointmentRequestDateTime()` to support approved requests, update linked schedule entries, publish `SCHEDULE_ENTRY_UPDATED` for approved reschedules, and PATCH an existing Teams meeting when `online_meeting_id` is present. PATCH failures now surface through `teamsMeetingWarning`.
- 2026-04-23: Completed `F012` by wiring Teams meeting deletion into both client-portal cancellation and MSP-side schedule-entry deletion. Both paths now clear `online_meeting_*` metadata from `appointment_requests`, sever the schedule-entry link, and attempt a best-effort Graph DELETE when the stored provider is `teams`.
- 2026-04-23: Completed `F013` by adding conditional Teams deletion warnings to the client-portal cancel confirmations and MSP delete dialogs. Approved appointments can now be cancelled from the client portal, and delete confirmations explicitly warn when the linked Teams meeting will also be removed.
- 2026-04-23: Completed `F014` by adding a scheduling-side `getTeamsMeetingCapability` action wrapper and wiring `AppointmentRequestsPanel` to it. The approval form now shows a default-on Teams toggle only when the current tenant is capable of generating meetings.
- 2026-04-23: Completed `F015` by mirroring the same capability-gated, default-on Teams toggle inside the pending-request approval branch of `EntryPopup`.
- 2026-04-23: Completed `F016` by adding a "Join Teams Meeting" CTA to the approved appointment banner in `EntryPopup` when `online_meeting_url` is present.
- 2026-04-23: Completed `F017` by exposing the stored Teams meeting URL and a "Join Teams Meeting" button in the `AppointmentRequestsPanel` detail view for approved requests.
- 2026-04-23: Completed `F018` by adding a primary "Join Teams Meeting" button to `packages/client-portal/src/components/appointments/AppointmentRequestDetailsPage.tsx` when `online_meeting_url` is populated.
- 2026-04-23: Completed `F019` by adding a conditional "Teams Meetings" tab to `AvailabilitySettings.tsx`. Visibility is driven by a new scheduling action that checks whether `teams_integrations` exists and whether the tenant's install status is `active`.
- 2026-04-23: Completed `F020` by replacing the Teams Meetings tab placeholder with a real organizer form in `AvailabilitySettings.tsx`: prerequisites banner, organizer UPN input, Save action, Verify button, and inline verification feedback.
- 2026-04-23: Completed `F021` by adding `setDefaultMeetingOrganizer` in `availabilitySettingsActions.ts`. The action is CE-safe, enforces `system_settings:update`, verifies that Teams is active for the tenant, and writes the trimmed organizer UPN (or `NULL` when cleared).
- 2026-04-23: Completed `F022` by adding `verifyMeetingOrganizer` in scheduling plus an EE Graph helper. Verification first resolves `/users/{upn}`, then performs a short create/delete round-trip so missing Application Access Policy cases come back as `reason: 'policy_missing'`.
- 2026-04-23: Completed `F024` by extending `@alga-psa/email` appointment payload types with `onlineMeetingUrl` and wiring the approved-email fallback template to render a Teams join action when the URL is present.
- 2026-04-23: Completed `F025` by changing approval-email ICS generation to emit `LOCATION: Microsoft Teams Meeting`, `URL: <join link>`, and a `Join Teams Meeting: ...` description line only when a Teams meeting was created.
- 2026-04-23: Completed `F023` by updating the source-of-truth appointment email templates plus a new re-upsert migration so both approved-client and assigned-technician emails render a conditional `Join Teams Meeting` block when `onlineMeetingUrl` is populated.
- 2026-04-23: Completed `F026` by adding the new Teams UI keys to English locale files, backfilling the same keys across shipped human locales to satisfy the translation validator, and regenerating pseudo-locales.
- 2026-04-23: Completed `F027` by authoring the Azure admin runbook at `docs/integrations/teams-meetings-setup.md`, adding a browser-served copy under `server/public/docs/...`, and repointing the Availability Settings banner link to that runbook.
- 2026-04-23: Completed `F028` by normalizing Teams meeting helper logs so create/update/delete success paths log structured INFO rows and non-response warning paths still include `status: null` alongside tenant, request, and operation context.
- 2026-04-23: Completed `T019` with `packages/scheduling/tests/appointmentRequestSchemas.test.ts`, covering `generate_teams_meeting` explicit true/false values plus omission defaulting to `false`.
- 2026-04-23: Completed `T046` by extending `server/src/test/unit/icsGenerator.test.ts` with an explicit Teams meeting case that asserts both `LOCATION: Microsoft Teams Meeting` and the join `URL:` line are emitted together.
- 2026-04-23: Completed `T047` by tightening the minimal ICS generator test so events without a meeting URL assert both `LOCATION` and `URL` are absent.
- 2026-04-23: Completed `T048` by re-running `node scripts/generate-pseudo-locales.cjs` and `node scripts/validate-translations.cjs`, ending with validator output `Errors: 0` and `Warnings: 0`.
- 2026-04-23: Completed `T049` with `packages/scheduling/tests/teamsMeetingsRunbook.contract.test.ts`, asserting the canonical runbook content exists and the Availability Settings banner opens the browser-served copy.
- 2026-04-23: Completed `T044` with `server/src/test/unit/appointmentEmailTemplates.test.ts`, rendering the approved-client Handlebars template directly and asserting the Teams join button appears only when `onlineMeetingUrl` is provided.
- 2026-04-23: Completed `T045` by extending the same template-render suite to the assigned-technician template and asserting the technician email includes the Teams join button when `onlineMeetingUrl` is present.
- 2026-04-23: Completed `T003-T016`, `T018`, and `T051` with `server/src/test/unit/teamsMeetingHelpers.test.ts`, covering Teams meeting create/update/delete helper behavior, capability resolution, the CE no-op shim, and tenant-scoped credential isolation.
- 2026-04-23: Completed `T043` with `packages/scheduling/tests/availabilitySettingsActions.permission.test.ts`, asserting `setDefaultMeetingOrganizer` rejects callers who lack the settings-update permission.
- 2026-04-23: Completed `T040-T042` with `server/src/test/unit/verifyMeetingOrganizer.test.ts`, covering successful organizer verification, missing-user handling, and Application Access Policy failures that map to `reason: 'policy_missing'`.
- 2026-04-23: Completed `T001-T002` with `server/src/test/unit/teamsMeetingMigrations.test.ts`, executing both migration `up()` functions against mocked `knex.schema` surfaces and asserting the new columns are added as nullable `text`.
- 2026-04-23: Completed `T017` by hardening CE build wiring and rerunning `npm run build:ce`. Root `build`/`build:ce` scripts now force `EDITION=community NEXT_PUBLIC_EDITION=community`, and `server/next.config.mjs` maps `@alga-psa/ee-microsoft-teams` to `./src/empty` for CE so the built manifest no longer points at `ee/packages/microsoft-teams`.
- 2026-04-24: Completed `T053` by rerunning `npm run build:ce` after the Teams meeting changes landed. The community build completed end-to-end, confirming the existing EE dynamic-import guard still keeps CE builds green.
- 2026-04-24: Completed `T020` with `server/src/test/integration/appointmentRequests.integration.test.ts`, adding approval-path integration coverage that asserts a Teams-enabled approval persists `online_meeting_provider/url/id` and passes `onlineMeetingUrl` into the approved-email payload.
- 2026-04-24: Completed `T021` in the same approval integration suite, asserting `generate_teams_meeting: false` leaves `online_meeting_*` columns `NULL` and never calls the Teams meeting service.
- 2026-04-24: Completed `T022` in the same suite, asserting approval still succeeds when Teams capability is unavailable, no Graph create runs, and `teamsMeetingWarning` explains the organizer/setup gap.
- 2026-04-24: Completed `T023` in the same suite, asserting a soft Graph create failure leaves the appointment approved, keeps meeting columns empty, and omits `onlineMeetingUrl` from the approval email payload.
- 2026-04-24: Completed `T052` in the same approval suite, asserting requester-local wall-clock times are converted to the correct UTC instants before `createTeamsMeeting()` is called.
- 2026-04-24: Completed `T024` in the same integration file, asserting approved reschedules call `updateTeamsMeeting()` with the expected new UTC start/end timestamps for the stored Teams meeting.
- 2026-04-24: Completed `T025` in the same reschedule integration slice, asserting a soft Graph PATCH failure still returns `success: true` and surfaces `teamsMeetingWarning` to the caller.
- 2026-04-24: Completed `T026` in the same reschedule integration slice, asserting approved requests without `online_meeting_id` reschedule normally without calling the Teams meeting service.
- 2026-04-24: Completed `T027` in the deletion lifecycle integration slice, asserting client-side cancellation of an approved appointment calls `deleteTeamsMeeting()` with the stored Teams meeting ID.
- 2026-04-24: Completed `T028` in the same deletion lifecycle slice, asserting MSP schedule-entry deletion also calls `deleteTeamsMeeting()` for approved appointments that carry Teams metadata.
- 2026-04-24: Completed `T029` by fixing `cancelAppointmentRequest()` to return `teamsMeetingWarning` when the best-effort Teams DELETE fails, then asserting the cancellation still succeeds and surfaces that warning.
- 2026-04-24: Completed `T030` with `server/src/test/unit/appointments/AppointmentRequestDetailsPage.teams.test.tsx`, asserting the client-portal cancel confirmation includes the Teams deletion warning when `online_meeting_url` is present.
- 2026-04-24: Completed `T031` in the same client-portal detail test file, asserting the cancel confirmation falls back to the normal message when there is no Teams meeting URL.
- 2026-04-24: Completed `T032` with `server/src/test/unit/appointments/AppointmentRequestsPanel.teams.test.tsx`, asserting the MSP appointment-requests approval form shows a checked Teams toggle when capability is available.
- 2026-04-24: Completed `T033` in the same appointment-requests panel test file, asserting the approval form hides the Teams toggle when capability reports unavailable.
- 2026-04-24: Completed `T034` with `server/src/test/unit/appointments/EntryPopup.teams.test.tsx`, asserting the pending appointment-request branch of `EntryPopup` shows the Teams toggle when capability is available.
- 2026-04-24: Completed `T035` in the same `EntryPopup` test file, asserting the approved appointment banner renders the Teams join action when `online_meeting_url` is present.
- 2026-04-24: Completed `T036` in the `AppointmentRequestsPanel` test file, asserting approved request details render the Teams join action when a meeting URL is stored.
- 2026-04-24: Completed `T037` in the client-portal detail page test file, asserting `AppointmentRequestDetailsPage` renders the `Join Teams Meeting` button when `online_meeting_url` is populated.
- 2026-04-24: Completed `T038` with `server/src/test/unit/appointments/AvailabilitySettings.teams.test.tsx`, asserting the `Teams Meetings` tab is rendered only when the tab-state action reports it visible.
- 2026-04-24: Completed `T039` in the same Availability Settings test file, asserting the organizer UPN input saves through `setDefaultMeetingOrganizer()` and persists the returned organizer value in the form.
- 2026-04-24: Completed `T050` in `server/src/test/unit/teamsMeetingHelpers.test.ts`, asserting a create/update/delete helper lifecycle emits three structured INFO logs with tenant, appointment request ID, operation, and status.

## Working notes

- Migration pattern for `appointment_requests` follows the existing guarded `alterTable` style from `20260416210000_add_requester_timezone_to_appointment_requests.cjs`.
- `teams_integrations` migration does not need a Citus redistribution step for a nullable non-key column; guarded `alterTable` is sufficient.
- Extracted Graph app-token acquisition into `ee/packages/microsoft-teams/src/lib/graphAuth.ts` so meeting helpers and notification delivery share the same OAuth client-credentials flow.
- Added `resolveTeamsMeetingExecutionConfig()` as the central place for readiness checks needed by create/update/delete helpers: install status must be `active`, `selected_profile_id` must exist, organizer UPN must be set, and the Microsoft profile must resolve as `ready`.
- Scheduling-side EE boundary mirrors the calendar-actions pattern: memoized dynamic import of `@alga-psa/ee-microsoft-teams/lib`, fallback logging on load failure, and CE no-op implementations instead of hard EE imports.
- Client portal needed its own EE-safe Teams delete loader because it does not depend on the scheduling package. Implemented a local guarded dynamic import in `packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts`.
- `DeleteEntityDialog` now accepts an optional `confirmationMessage`, which keeps dependency-validation behavior intact while allowing schedule-entry delete flows to surface appointment-specific warnings like the Teams-meeting deletion notice.
- `verifyMeetingOrganizer` required a second meeting-config resolver path: `resolveTeamsMeetingGraphConfig()` handles tenants with an active Teams profile even before an organizer is saved, while `resolveTeamsMeetingExecutionConfig()` still enforces the organizer requirement for create/update/delete flows.
- Teams Meetings settings UI currently links admins to Microsoft’s Application Access Policy documentation directly; when the local runbook is added later (`F027`), update this banner link to the repo-authored setup guide.
- `SystemEmailService.sendAppointmentAssignedNotification()` already passes the full payload object through `replaceVariables()`, so `onlineMeetingUrl` only needed a type update there; the explicit fallback template change was only necessary for the approved-client email path.
- The previous ICS behavior always included a client-portal URL and tenant-name location. Teams-meeting acceptance criteria required narrowing that behavior so URL/location are only emitted for actual online meetings.
- Email template updates follow the repo’s source-of-truth pattern: modify `server/migrations/utils/templates/email/appointments/*.cjs` and add a migration that re-upserts existing DB rows, rather than editing seeded SQL or relying on future installs only.
- Translation validator enforces new keys across all shipped human locales (`de/es/fr/it/nl/pl/pt`) as well as pseudo locales. Adding English-only keys is not enough to make `node scripts/validate-translations.cjs` pass.
- Repo docs under `docs/` are not automatically browser-accessible from the MSP UI. For in-app documentation links, a static copy under `server/public/...` is needed unless a dedicated docs route already exists.
- Teams meeting helper logs already covered Graph response success/failure. The final observability cleanup was making the non-response warning paths structurally consistent by always including a `status` field as well.
- Approval flow nuance: when the approver keeps the originally requested time, `requested_date`/`requested_time` must be converted from the requester's local wall clock via `fromZonedTime(...)`; only explicit `final_date`/`final_time` values sent from the UI are already normalized to UTC strings.
- Integration harness nuance: initialize the Teams meeting mocks in `beforeEach`, not only `afterEach`, so isolated Vitest filters still see a configured `getTeamsMeetingCapability()` on the first matching test.
- Client-portal cancel nuance: Teams deletion is intentionally fail-soft, but the action still needs to propagate a warning string back to the UI when `deleteTeamsMeetingIfAvailable()` returns `false`; otherwise the failure is silent even though the appointment cancellation succeeded.
- CE regression check on 2026-04-24 passed on the normal `build:ce` path, so the existing `EDITION=community` forcing plus `@alga-psa/ee-microsoft-teams -> ./src/empty` aliasing remains sufficient to keep enterprise-only code out of the CE bundle.
- The server integration harness needed both `@alga-psa/db` and `@alga-psa/auth`-layer synchronization. Mocking only `server/src/lib/db` and `@alga-psa/users/actions` is insufficient now that these actions import package-level wrappers directly.
- Approval-path integration tests also need UUID-shaped staff fixture IDs because `appointment_requests.approved_by_user_id` is typed as `uuid`; old placeholder strings caused PostgreSQL `22P02` failures before Teams assertions ran.
- Runbook command used for validation so far: `node -c server/migrations/20260423130000_add_online_meeting_columns_to_appointment_requests.cjs`
- Additional validation command: `node -c ee/server/migrations/20260423131000_add_default_meeting_organizer_to_teams_integrations.cjs`
- Additional validation command: `npm -w ee/packages/microsoft-teams run typecheck`
- Additional validation command: `npm -w packages/scheduling run typecheck`
- Additional validation command: `node scripts/generate-pseudo-locales.cjs`
- Additional validation command: `node scripts/validate-translations.cjs`
- Additional validation command: `npx vitest --root packages/scheduling --config vitest.config.ts run tests/appointmentRequestSchemas.test.ts`
- Additional validation command: `npx vitest --root server --config vitest.config.ts run src/test/unit/icsGenerator.test.ts --coverage.enabled false`
- Additional validation command: `npx vitest --root packages/scheduling --config vitest.config.ts run tests/teamsMeetingsRunbook.contract.test.ts`
- Additional validation command: `npx vitest --root server --config vitest.config.ts run src/test/unit/appointmentEmailTemplates.test.ts --coverage.enabled false`
- Additional validation command: `npx vitest --root server --config vitest.config.ts run src/test/unit/teamsMeetingHelpers.test.ts --coverage.enabled false`
- Additional validation command: `npx vitest --root packages/scheduling --config vitest.config.ts run tests/availabilitySettingsActions.permission.test.ts`
- Additional validation command: `npx vitest --root server --config vitest.config.ts run src/test/unit/verifyMeetingOrganizer.test.ts --coverage.enabled false`
- Additional validation command: `npx vitest --root server --config vitest.config.ts run src/test/unit/teamsMeetingMigrations.test.ts --coverage.enabled false`
- Additional validation command: `npx vitest --root server --config vitest.config.ts run src/test/integration/appointmentRequests.integration.test.ts -t "creates and stores a Teams meeting when approval opts in|skips Teams meeting creation when the toggle is off|returns a warning and skips Graph create when Teams capability is unavailable|keeps approval successful when Teams meeting creation fails|converts requester-local approval times to UTC before creating the Teams meeting" --coverage.enabled false`
- Additional validation command: `npx vitest --root server --config vitest.config.ts run src/test/integration/appointmentRequests.integration.test.ts -t "reschedules the linked Teams meeting when an approved request has an online meeting|returns a warning when the Teams reschedule PATCH fails|does not call Teams when the approved request has no online meeting id" --coverage.enabled false`
- Additional validation command: `npx vitest --root server --config vitest.config.ts run src/test/integration/appointmentRequests.integration.test.ts -t "deletes the linked Teams meeting when a client cancels an approved appointment|deletes the linked Teams meeting when MSP staff deletes the schedule entry|surfaces a warning when Teams meeting deletion fails during cancellation" --coverage.enabled false`
- Additional validation command: `npx vitest --root server --config vitest.config.ts run src/test/unit/appointments/AppointmentRequestDetailsPage.teams.test.tsx --coverage.enabled false`
- Additional validation command: `npx vitest --root server --config vitest.config.ts run src/test/unit/appointments/AppointmentRequestsPanel.teams.test.tsx --coverage.enabled false`
- Additional validation command: `npx vitest --root server --config vitest.config.ts run src/test/unit/appointments/EntryPopup.teams.test.tsx --coverage.enabled false`
- Additional validation command: `npx vitest --root server --config vitest.config.ts run src/test/unit/appointments/AvailabilitySettings.teams.test.tsx --coverage.enabled false`
- Additional validation command: `rm -rf server/.next && npm run build:ce`
- Additional validation command: `rg -n "@alga-psa/ee-microsoft-teams|ee/packages/microsoft-teams" server/.next`
- Additional validation command: `npm run build:ce`
