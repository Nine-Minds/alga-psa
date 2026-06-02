# SCRATCHPAD — Teams Online Meetings → Interactions

Working memory for this plan. Append decisions, discoveries, gotchas, and commands.

## Source of truth
- Long-form design: `.ai/teams-meetings-interactions-consolidated-plan.md` (incorporates two external
  review rounds).
- This plan folder lives in `ee/docs/plans/` (per project convention) even though some artifacts are
  core — most of the meaningful logic (capture, subscriptions, Graph) is EE.

## Key decisions (with rationale)
- **Calendar-backed creation** (`POST /users/{upn}/events`, `isOnlineMeeting:true`) instead of standalone
  `POST /onlineMeetings`. Reason: Graph recordings/transcripts APIs only work reliably for
  calendar-backed meetings. Cost: new `Calendars.ReadWrite` app permission + onlineMeeting-id resolution
  from joinUrl + invite-behavior decision.
- **Provider-agnostic** "Online Meeting" interaction type (icon `video`), NOT "Teams Meeting" — the
  `online_meetings.provider` column allows future zoom/google_meet.
- **One table, two creation paths.** Appointment approval and MSP-initiated both write `online_meetings`
  + an interaction; differ only by `appointment_request_id` vs `schedule_entry_id`. No backfill.
- **Storage:** transcript → durable internal **document**; recording → internal **proxy/download**
  (Graph content URLs are auth-protected, not clickable), with opt-in blob download. Artifacts are a
  **collection** → `online_meeting_artifacts` child table (NOT singular columns).
- **Single service-account organizer** in v1; per-user organizer + co-organizer roles deferred.
- **Retrieval:** manual "Refresh recordings" (Phase 1) ships first; change-notification subscriptions
  (Phase 2) follow (encrypted resource data + protected/metered API approval).

## Must-fix items confirmed by review (do not regress) → mapped features
1. Scope `Calendars.ReadWrite` to the organizer mailbox via **Exchange** Application Access Policy / RBAC
   (Teams policy does NOT scope calendar). → F051, F052, T075.
2. Update/delete use `provider_event_id` for new rows; legacy `online_meeting_id` handling preserved. →
   F027, T038, T039.
3. Invite behavior locked: appointment approval = no external attendees; MSP-initiated = attendees
   allowed. → F018, T025, T026.
4. No "co-organizer" claim unless a real Graph meeting-options step is added (deferred). → F018 (attendee
   only), §9 deferred.
5. All Graph create/update/delete OUTSIDE DB transactions, with create→DB-fail compensation. → F028,
   F029, T040, T041.

## Discoveries about existing code (verified)
- `approveAppointmentRequest` wraps work in `withTransaction`; existing `if (createdMeeting)` block
  ~`appointmentRequestManagementActions.ts:790-793`; writes `online_meeting_*` columns.
- Reschedule `updateAppointmentRequestDateTime` calls `updateTeamsMeeting` **inside** `withTransaction`
  (~:1321) — MUST move out (F028). Cancel/delete paths (`scheduleActions.ts:732`,
  client-portal `appointmentRequestActions.ts:1337`) already call Graph outside the tx.
- Facade `CreateTeamsMeetingResult` returns only `{joinWebUrl, meetingId}` (`teamsMeetingService.ts`),
  EE same (`createTeamsMeeting.ts:107`). Must add organizer UPN + AAD id + eventId (F020).
- `InteractionModel.addInteraction/getById` open their own `createTenantKnex` connection
  (`interactions.ts:225`), so the action's `withTransaction` does NOT cover the model insert today —
  latent bug fixed by F012. Defaulting/resolution/events/revalidate live in the ACTION
  (`interactionActions.ts:~86-150`) — must be replicated in the shared helper (F013).
- `uploadDocument` is `withAuth` + `FormData` (`documentActions.ts:2642`) — unusable from a job; need an
  internal helper (F038). Internal users inherit folder `is_client_visible` (`documentActions.ts:2764`)
  — set false explicitly.
- `system_interaction_types` modification trigger was REMOVED by
  `server/migrations/20250613000000_remove_system_interaction_types_trigger.cjs` — no workaround needed.
- `Meeting` (icon users) already seeded by `20241223015715_create_system_interaction_types.cjs`; we add a
  separate `Online Meeting` (icon video).
- `ScheduleEntry.create` stores `work_item_id` for non-`ad_hoc` (`scheduleEntry.ts:407`) → set to
  interaction id (F033).
- Calendar mapping uses `entry.notes` as description in BOTH `server/src/utils/calendar/eventMapping.ts:82`
  and `packages/integrations/src/utils/calendar/eventMapping.ts:80` (F036).
- EE calendar sync (`ee/packages/calendar/`) auto-pushes schedule_entries to the user's connected
  calendar via `calendarSyncSubscriber` — partially compensates for the service-account-organizer model
  (meeting still shows on the creating user's own calendar). Possible Phase-2 reuse:
  `CalendarWebhookProcessor.ts` for the encrypted subscription machinery.
- `scheduleRecurringJob` exists (`server/src/lib/jobs/jobScheduler.ts` + `index.ts`); there is already a
  `MicrosoftWebhookRenewalJobData` recurring job to mirror for Phase 2 (F055).
- `microsoft_profiles` are tenant-level service accounts; `users` has no AAD columns → no per-user
  organizer today.

## Open questions
- Exact `hasPermission` resource/action for `scheduleTeamsMeeting` (verify repo catalog) — F031.
- Should MSP-initiated default to adding the contact as an attendee, or leave optional in the UI?

## Phasing for the implementation loop
- Phase A (data + model): F001–F013.
- Phase B (creation, both paths): F016–F036.
- Phase C (capture Phase 1 + UI): F037–F052.
- Phase D (gating): F053.
- Phase E (Phase 2 subscriptions): F054–F057.
Recommend the /loop pick the lowest-id `implemented:false` feature whose deps are met, implement + test,
flip `implemented:true`, repeat.

## Commands / runbooks
- Validate plan JSON: `python3 ~/.claude/skills/software-planner/scripts/validate_plan.py <folder>` (if present).
- Tests: `npm run test:unit` (unit), `npm run test:integration`.
- Migrations: `npm run migrate`.

## 2026-06-01 — F034-F036 / T049-T051
- Implemented QuickAddInteraction Online Meeting scheduling without adding a clients -> scheduling package
  dependency: added optional Teams callbacks to `ClientCrossFeatureContext`, supplied them in
  `MspClientCrossFeatureProvider`, and had QuickAdd call `scheduleTeamsMeeting` only when the Online
  Meeting type is selected and `getTeamsMeetingCapability` reports available. Rationale: keeps clients
  package reusable while MSP composition owns cross-feature wiring.
- Implemented direct schedule-entry Teams generation by having `EntryPopup` add a
  `generate_teams_meeting` save payload for new entries and `ScheduleCalendar` route that payload to
  `scheduleTeamsMeeting({ createScheduleEntry: true })`. Constraint: the backend requires client/contact
  context, so the UI requires a selected client-backed work item and shows a translated validation
  message otherwise.
- Tightened `scheduleTeamsMeeting` notes behavior: stored interaction/schedule notes now append
  `Join Teams Meeting: <url>` even when caller-supplied notes exist.
- Updated both calendar mappers (`server/src/utils/calendar/eventMapping.ts` and
  `packages/integrations/src/utils/calendar/eventMapping.ts`) to append the join URL from
  `online_meetings` by `schedule_entry_id` as a fallback/field mapping for external calendar pushes.
- Added source-contract tests for QuickAdd Teams wiring, EntryPopup/ScheduleCalendar routing, and both
  eventMapping copies.
- Verification:
  - `npm -w @alga-psa/clients run typecheck`
  - `npm -w @alga-psa/scheduling run typecheck`
  - `npm -w @alga-psa/integrations run typecheck`
  - `npx vitest run ../packages/clients/src/components/interactions/QuickAddInteraction.quick-add-contact.contract.test.ts ../packages/scheduling/src/components/schedule/EntryPopup.teams-meeting.contract.test.ts src/test/unit/calendar/eventMapping.onlineMeetingDescription.contract.test.ts src/test/integration/appointmentRequests.integration.test.ts -t "Schedule Teams Meeting|quick add|EntryPopup offers|online meeting calendar"` from `server/`
  - `packages/msp-composition` has no package typecheck script or tsconfig; composition compile coverage
    is indirect through package consumers.

## 2026-06-01 — F015, F037-F041 / T052-T062
- Implemented Phase-1 artifact capture in `packages/clients/src/lib/onlineMeetingArtifactCapture.ts`.
  Package-boundary decision: put the handler next to `OnlineMeetingModel` and dynamically load the EE
  Teams module instead of importing scheduling from clients, because scheduling already depends on
  clients and a static clients -> scheduling import would create a cycle.
- `fetchAndPersistMeetingArtifacts` is session-agnostic and takes explicit `tenantId`, `meetingId`, and
  optional `actorUserId`. It resolves the meeting, skips cancelled rows, calls EE
  `fetchMeetingArtifacts`, upserts recording/transcript artifacts idempotently, updates bounded fetch
  status (`recording_ready`, `recording_pending`, `no_recording`, `failed`), and revalidates interaction
  + linked client/contact paths.
- Transcript storage uses an internal document helper, not `uploadDocument`: inserts `documents`,
  `document_block_content`, and `document_associations` directly inside a transaction with explicit
  tenant/user metadata. Client/contact associations are resolved from the linked interaction because
  `online_meetings` intentionally stores `interaction_id`, not duplicate client/contact columns.
- Recording capture stores `content_url` by default. When `download_recordings` is enabled, it resolves
  the EE Teams Graph config, fetches an app token, downloads the Graph content URL server-side, stores
  the blob with `StorageService.uploadFile`, and sets `file_id`.
- `refreshMeetingRecordings(meetingId)` was added to `packages/clients/src/actions/onlineMeetingActions.ts`
  under `withAuth`, passing the authenticated user id to the shared handler.
- Exported `meetings/meetingConfig` from `@alga-psa/ee-microsoft-teams/lib` so the recording download
  helper can reuse the existing Graph config resolver.
- Verification:
  - `npm -w @alga-psa/clients run typecheck`
  - `npm -w @alga-psa/scheduling run typecheck`
  - `npm -w @alga-psa/ee-microsoft-teams run typecheck`
  - `npx vitest run ../packages/clients/src/lib/onlineMeetingArtifactCapture.test.ts` from `server/`

## 2026-06-01 — F042 / T063-T065
- Added internal recording proxy route:
  `server/src/app/api/online-meetings/recordings/[artifactId]/route.ts`.
- Security shape: requires `getCurrentUser`, uses the authenticated user's tenant to create the DB
  context, looks up `online_meeting_artifacts` joined to `online_meetings` by `(tenant, meeting_id)`,
  and returns 404 for cross-tenant artifact ids because the query is tenant-scoped.
- Proxy behavior: fetches the raw Graph `content_url` server-side with the EE Teams Graph config +
  app token, forwards `Range` when present, streams `graphResponse.body` with content headers, and never
  redirects or serializes the raw Graph URL to the caller.
- Portal guard: `?portal=true` is denied unless `teams_integrations.expose_recordings_in_portal` is true;
  missing column/table defaults to false until F048 lands.
- Verification:
  - `npx vitest run src/test/unit/onlineMeetingRecordingProxy.contract.test.ts` from `server/`
  - `npm -w @alga-psa/ee-microsoft-teams run typecheck`

## 2026-06-01 implementation notes
- Implemented F012/F013:
  - `InteractionModel.addInteraction` and `getById` now accept an optional `Knex`/transaction and use it for both the insert and follow-up read; the default path still uses `createTenantKnex(tenantId)`.
  - Added `packages/clients/src/actions/interactionCreateHelper.ts` as the shared interaction creation path. It centralizes user/client/contact validation, default interaction status resolution, contact -> client resolution, `INTERACTION_LOGGED`, `INTERACTION_CREATED`, and cache revalidation.
  - `addInteraction` now uses the helper inside its transaction but defers the helper-provided side effects until after `withTransaction` returns, preserving post-commit event/revalidate behavior.
  - `getInteractionById` now passes its active transaction into `InteractionModel.getById`.
- Implemented T017-T022 with focused unit tests:
  - `packages/clients/src/models/interactions.transaction.test.ts` covers trx-backed insertion and no-trx back-compat.
  - `packages/clients/src/actions/interactionCreateHelper.test.ts` covers default status, contact-client resolution/failure, event publishing, and revalidation.
- Verification:
  - `npx vitest run ../packages/clients/src/models/interactions.transaction.test.ts ../packages/clients/src/actions/interactionCreateHelper.test.ts` from `server/` passed 6 tests.
  - `npm -w @alga-psa/clients run typecheck` passed.
- Implemented F014:
  - Added `packages/clients/src/actions/onlineMeetingActions.ts` with `getOnlineMeetingForInteraction` under `withAuth`, delegating to `OnlineMeetingModel.getByInteractionId(interactionId, tenant)`.
  - Exported the action from `packages/clients/src/actions/index.ts`.
  - Corrected T037's description: it was assigned to F014 but described cancelled refresh/list-pending behavior already covered by T014; it now describes the F014 action contract.
  - Added `packages/clients/src/actions/onlineMeetingActions.test.ts` covering tenant-scoped lookup, absent rows, and missing id validation.
- Implemented F016-F022:
  - `createTeamsMeeting` now creates calendar-backed Graph events through `POST /users/{organizerUpn}/events` with `isOnlineMeeting: true` and `onlineMeetingProvider: teamsForBusiness`.
  - It resolves the `onlineMeeting.id` from the event join URL via a URL-encoded `JoinWebUrl` filter, then returns `joinWebUrl`, `meetingId`, `organizerUpn`, `organizerUserId`, and `eventId`.
  - `organizerUserId` is read from `teams_integrations.default_meeting_organizer_object_id` when present; until F048 migration/UI lands, the config falls back to organizer UPN to preserve existing tenants/tests.
  - Appointment approval keeps the default no-attendee payload; MSP-created meetings can pass attendees explicitly.
  - `updateTeamsMeeting`/`deleteTeamsMeeting` now call `/events/{eventId}` (falling back to `meetingId` only for temporary compatibility until F027 legacy branching is implemented).
  - Added EE `fetchMeetingArtifacts` and facade `fetchMeetingArtifacts` no-op off enterprise. The EE implementation fetches recordings/transcripts collections, downloads transcript content with `Accept: text/vtt`, and URL-encodes organizer/meeting/artifact path segments.
  - T028's online_meetings persistence portion will become concrete in F023/F032 when creation paths write the returned facade fields into `online_meetings`; current coverage verifies the facade returns the fields required for persistence.
- Verification:
  - `npx vitest run src/test/unit/teamsMeetingHelpers.test.ts` from `server/` passed 23 tests.
  - `npm -w @alga-psa/scheduling run typecheck` passed.
  - `npm -w @alga-psa/ee-microsoft-teams run typecheck` passed.

## 2026-06-01 implementation notes
- Completed F001-F006 in `server/migrations/20260601120000_create_online_meetings.cjs`: added CE/core
  `online_meetings` and `online_meeting_artifacts` with tenant-first PKs, PRD status/artifact type
  checks, provider-meeting uniqueness, tenant-leading lookup indexes, Citus `transaction:false`
  distribution on `tenant`, and artifact colocation with `online_meetings`. Chose no SQL FKs in these
  tables to match the PRD's Citus/application-level integrity constraint.
- Completed F007 in `server/migrations/20260601120100_add_online_meeting_interaction_type.cjs`: added an
  idempotent insert-only `Online Meeting` system interaction type with `video` icon, following the
  existing `add_general_interaction_type` guard style.
- Completed T001-T007/T009-T010 in
  `server/src/test/unit/migrations/onlineMeetingsMigration.test.ts`: tests execute the migration against
  mocked Knex raw calls for plain Postgres and Citus paths, assert tenant-first keys, enum checks,
  uniqueness/index contracts, child-table colocation, rollback order, and idempotent interaction-type
  insertion. T008 intentionally remains open because it covers the later `OnlineMeetingModel.upsertArtifact`
  helper, not just the unique constraint.
- Verification: `npx vitest run src/test/unit/migrations/onlineMeetingsMigration.test.ts` from `server/`
  passed (8 tests). An earlier `npm -w server run test:unit -- ...` accidentally ran the entire unit suite
  due to the package script prepending `src/test/unit`; it was terminated after unrelated existing failures
  and should not be treated as signal for this batch.
- Completed F008-F009/T011 in `packages/types/src/interfaces/online-meeting.interfaces.ts` and
  `packages/types/src/interfaces/interaction.interfaces.ts`: added `IOnlineMeetingArtifact`,
  `IOnlineMeeting`, status/artifact/provider type aliases, `artifacts[]`, and optional
  `IInteraction.online_meeting`. Exported via `packages/types/src/interfaces/index.ts` and added
  `@alga-psa/types` smoke imports to `packages/types/src/exports.typecheck.test.ts`.
- Verification: `npm -w @alga-psa/types test -- src/exports.typecheck.test.ts src/interfaces/barrel.test.ts`
  passed (2 tests).
- Completed F010-F011/T008/T012-T016 in `packages/clients/src/models/onlineMeeting.ts`: added
  session-agnostic `OnlineMeetingModel` using `createTenantKnex`, tenant guard, create/get/update/provider
  and interaction/appointment lookups with artifacts, pending-recording listing for ended eligible statuses,
  idempotent artifact upsert on `(tenant, meeting_id, artifact_type, provider_artifact_id)`, and newest-first
  artifact listing. Exported from `packages/clients/src/models/index.ts`.
- Verification: `npx vitest run ../packages/clients/src/models/onlineMeeting.test.ts` from `server/`
  passed (6 tests); `npm -w @alga-psa/clients run typecheck` passed.
- Completed F023-F024 in `packages/scheduling/src/actions/appointmentRequestManagementActions.ts`:
  approval now uses the shared interaction helper to create an `Online Meeting` interaction and inserts a
  linked `online_meetings` row when Teams creation succeeds. The row stores the Graph calendar event id,
  organizer UPN/object id, join URL, schedule entry id, appointment request id, interaction id, and
  scheduled status. The legacy `appointment_requests.online_meeting_*` columns remain populated for
  existing email/portal consumers.
- Package wiring: `@alga-psa/scheduling` now depends on `@alga-psa/clients`, and
  `@alga-psa/clients` exposes the narrow `./actions/interactionCreateHelper` subpath used by scheduling.
  `@alga-psa/licensing` exports were pointed at `src` to make Vite resolve the workspace package in the
  appointment integration test environment.
- Completed T032-T034 in `server/src/test/integration/appointmentRequests.integration.test.ts`: the Teams
  approval test now asserts the interaction and `online_meetings` row, the capability-unavailable path
  asserts no row is written, and the legacy appointment request columns remain asserted. The fixture now
  tolerates current schemas where `service_types.billing_method` has been removed and seeds the staff user
  needed by the new interaction FK.
- Verification:
  - `npx vitest run src/test/integration/appointmentRequests.integration.test.ts -t "creates and stores a Teams meeting|capability is unavailable|creation fails"` from `server/` passed (3 tests, 38 skipped).
  - `npm -w @alga-psa/scheduling run typecheck` passed.
  - A full `npx vitest run src/test/integration/appointmentRequests.integration.test.ts` run was attempted
    before the fixture compatibility fix and failed on the pre-existing `service_types.billing_method`
    fixture/schema mismatch across many unrelated tests; targeted coverage now passes.
- Completed F025-F027:
  - `updateAppointmentRequestDateTime` now syncs linked `online_meetings` start/end fields and the
    generated interaction's date/start/end/duration, then calls `updateTeamsMeeting` after the DB
    transaction with `provider_event_id` for modern rows. Legacy appointment-only meetings pass
    `eventId: null` and keep the standalone-compatible fallback path.
  - Decline, MSP schedule deletion, and client-portal cancellation now mark linked `online_meetings`
    rows as `cancelled`, which keeps them out of later capture/polling flows.
  - Delete paths prefer `online_meetings.provider_meeting_id` + `provider_event_id`; legacy rows without
    `provider_event_id` still pass the appointment request's existing `online_meeting_id`.
  - F028/F029 intentionally remain open: reschedule update is now outside the transaction, but approval
    Graph create/DB compensation has not been reworked yet.
- Completed T035-T036/T038-T039 in `server/src/test/integration/appointmentRequests.integration.test.ts`:
  reschedule asserts event-id updates plus local meeting/interaction time sync, legacy reschedule asserts
  `eventId: null`, and decline/cancel/delete tests assert `online_meetings.status='cancelled'`.
- Verification:
  - `npm -w @alga-psa/scheduling run typecheck` passed.
  - `npm -w @alga-psa/client-portal run typecheck` passed.
  - `npx vitest run src/test/integration/appointmentRequests.integration.test.ts -t "should update status correctly when declined|reschedules the linked Teams meeting|reschedules a legacy Teams meeting|deletes the linked Teams meeting"` from `server/` passed (5 tests, 37 skipped).
  - The focused integration run still logs pre-existing non-fatal warnings in decline event publishing
    (`requestedDate` Date vs string) and client cancellation notifications (`contact_id` binding).
- Completed F028-F029:
  - Appointment approval now performs a read/validation preflight, calls `createTeamsMeeting` outside
    the write transaction, then consumes the prepared Graph result inside the DB transaction.
  - If the post-create DB transaction fails, the action calls `deleteTeamsMeeting` with the created
    `meetingId` and `eventId`, leaving the appointment pending and without local meeting rows/links.
  - Existing update/delete paths are now covered by source-level transaction-discipline guards:
    reschedule updates happen after the DB transaction returns, and schedule deletion calls Teams after
    the appointment cleanup transaction returns.
- Completed T040-T041:
  - Added `server/src/test/unit/scheduling/appointmentRequestTeamsTransaction.test.ts` to guard that
    create/update/delete Graph calls are outside transaction bodies.
  - Added an approval integration test that hides the `Online Meeting` interaction type after Graph
    create, forcing the DB transaction to fail and asserting the orphan Teams event is deleted.
  - Moved the requester-timezone conversion fixture from `2026-04-25` to `2026-08-25`; the old date is
    now in the past relative to the 2026-06-02 runtime clock and fails request creation before approval.
- Verification:
  - `npm -w @alga-psa/scheduling run typecheck` passed.
  - `npx vitest run src/test/unit/scheduling/appointmentRequestTeamsTransaction.test.ts` from `server/`
    passed (3 tests).
  - `npx vitest run src/test/integration/appointmentRequests.integration.test.ts -t "creates and stores a Teams meeting|deletes the orphaned Teams event|capability is unavailable|creation fails|converts requester-local approval times"` from `server/` passed (5 tests, 38 skipped).
  - Gotcha: do not run two server Vitest commands with coverage in parallel; one parallel attempt hit a
    `coverage/.tmp/coverage-0.json` race even though the targeted assertions had passed.
- Completed F030/T042:
  - Confirmed the rollout remains no-backfill: a legacy approved appointment with existing
    `appointment_requests.online_meeting_*` values keeps those links, but no `online_meetings` row and no
    `Online Meeting` timeline interaction are created just because the new schema exists.
  - Added the coverage to `server/src/test/integration/appointmentRequests.integration.test.ts`.
- Verification:
  - `npx vitest run src/test/integration/appointmentRequests.integration.test.ts -t "does not backfill legacy approved Teams appointment links"` from `server/` passed (1 test, 43 skipped).
- Completed F031-F033:
  - Added `packages/scheduling/src/actions/onlineMeetingSchedulingActions.ts` and exported
    `scheduleTeamsMeeting` from `@alga-psa/scheduling/actions`.
  - The action is `withAuth` and explicitly requires `user_schedule:update` (confirmed as the local
    schedule-create/update permission already used by schedule actions).
  - Teams Graph create happens before the DB write transaction; if the local transaction fails, the
    created calendar-backed Teams event is deleted via the facade using both `meetingId` and `eventId`.
  - The DB transaction creates the shared `Online Meeting` interaction, inserts the `online_meetings`
    row with organizer UPN/object id and event id, and optionally creates a `schedule_entries` row with
    `work_item_type='interaction'` and `work_item_id=<interaction_id>`, linked from
    `online_meetings.schedule_entry_id`.
  - MSP-created meetings pass through provided attendees to the facade; appointment approval remains
    separate and still sends no attendees.
- Completed T043-T048 in `server/src/test/integration/appointmentRequests.integration.test.ts`:
  - Happy path asserts Graph facade input, attendee pass-through, default organizer persistence from the
    facade result, interaction creation, and `online_meetings` persistence.
  - Permission-denied and capability-unavailable paths assert no Graph create and no local interaction.
  - Schedule-entry option asserts `work_item_type='interaction'`, `work_item_id` equals the created
    interaction id, assignee row creation, and `online_meetings.schedule_entry_id` linkage.
  - Test cleanup now tracks standalone online meeting and interaction ids because these rows are not
    appointment-request-linked.
- Verification:
  - `npm -w @alga-psa/scheduling run typecheck` passed.
  - `npx vitest run src/test/integration/appointmentRequests.integration.test.ts -t "Schedule Teams Meeting"` from
    `server/` passed twice (4 tests, 44 skipped). The second run includes a package-level
    `@alga-psa/event-bus/publishers` mock so the new action tests do not touch Redis.

## 2026-06-01 - F043-F045 / T066-T068
- Implemented interaction read enrichment: `InteractionModel.getById` and `getForEntity` attach `online_meeting` by calling `OnlineMeetingModel.getByInteractionId`, which returns artifacts newest-first via the model helper. Kept the implementation scoped to interaction reads instead of duplicating artifact aggregation SQL.
- Added the MSP `InteractionDetails` online meeting section with Join, status, Refresh recordings, transcript document links, and recording proxy links. Artifact links use internal routes only: `/api/documents/{documentId}/download` for transcripts and `/api/online-meetings/recordings/{artifactId}` for recordings.
- Fixed `InteractionIcon` fallback so `online meeting` maps to the `video` icon before the generic meeting/users fallback.
- Added source contract tests for model enrichment and UI wiring: `packages/clients/src/models/interactions.onlineMeeting.contract.test.ts` and `packages/clients/src/components/interactions/InteractionDetails.onlineMeeting.contract.test.ts`.
- Verification: `npx vitest run ../packages/clients/src/models/interactions.onlineMeeting.contract.test.ts ../packages/clients/src/components/interactions/InteractionDetails.onlineMeeting.contract.test.ts` from `server/`; `npm -w @alga-psa/clients run typecheck`; `npm -w @alga-psa/ui run typecheck`.
