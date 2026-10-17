# PRD — Mobile 2.0: Projects, Assets with site audit, Home, Search (offline outbox as stretch)

- Slug: `mobile-2-0-projects-assets-home-search`
- Date: `2026-10-14`
- Status: Draft
- App: `ee/mobile` (Expo SDK 54, React Native 0.81), currently 1.6.4 build 38
- Depends on: `feature/asset_assignments_bundles_merge` (worktree `alga-psa-mc14`, mission-control card 28d11dc6) landing on main first. See "Rollout / Migration".

## Summary

Mobile 1.6 made the phone app a full ticketing, CRM and time-tracking client. 2.0 makes projects and assets first-class instead of reachable only through side doors, adds a Home screen so the app opens on the technician's day rather than a ticket list, adds global search, and (if time allows) lets field techs keep working through poor signal with an offline outbox for the three writes that matter most onsite.

The customer pull is ECTS (ticket alga-2026-0002627): "create/edit anything I can read in the mobile app" and, logged on 2026-10-01, a site asset audit: walk a location, scan, get a present-versus-missing list in minutes.

## Problem

- **Projects are a side door.** A project task detail screen exists (comments, checklist, status, timer, time logging) but is reachable only from Activities, push notifications and deep links. There is no project list, no phase or task browsing, no task creation, and the task's assignee, due date and priority cannot be changed on the phone.
- **Assets are a side door.** Asset detail (history, maintenance, software, notes, tickets, create-ticket-from-asset) is reachable only by scanning a code on the Inventory tab or from a ticket. A tech cannot answer "what is at this site?" without scanning every device.
- **No site audit.** Scanning resolves one asset at a time. ECTS does audits in their current tool and said it is a reason they keep it.
- **The app opens on the ticket list.** A tech starting their day has to visit Schedule, Activities, Tickets and the timer separately.
- **No search.** Finding a client, contact, asset or project means opening the right tab and scrolling or filtering.
- **Poor-signal sites lose work.** The app detects offline and caches reads, but a comment, time entry or interaction note written without signal fails and is lost unless the tech retypes it.

## Goals

- Projects tab: browse active projects, open a project, see phases and tasks with progress, create a task, change a task's assignee, due date and priority. Gated by the existing `projects` capability.
- Assets tab: browse assets by client, location and status, with search, and open the existing asset detail. Gated by a new `assets` capability (asset:read, PSA product only, like projects).
- Site audit: pick a client and location, see the expected assets, scan (or tap) to mark each present, finish with a present/missing summary that is recorded on the server and visible in each asset's history on the web.
- Home screen as the first drawer entry: running timer, today's schedule, my open tickets, activities due today or overdue, quick actions.
- Global search across tickets, clients, contacts, assets, projects and project tasks, routing into the matching mobile screen.
- Stretch: an outbox so ticket comments, time entries and interaction notes written offline are sent when the connection returns, without duplicates.
- Ship as 2.0.0 build 39 with release notes.

## Non-goals

- Editing asset groups, assignments, statuses or procurement fields on mobile. The asset plan (2026-10-09) keeps mobile read-only for that data; this plan does not change that.
- Creating or editing projects or phases on mobile. Projects are set up on the web.
- Moving tasks between phases, reordering, Gantt or Kanban views, task dependencies.
- A web UI for audits beyond the asset-history entries this plan writes. A web Audits tab is a later plan.
- Changing an asset's status automatically when an audit marks it missing (open question Q2; default is no).
- Quotes and invoices on mobile, knowledge base, timesheet submission, AI follow-up drafting. Separate releases.
- Offline for anything other than the three write types named under the stretch goal; no offline ticket creation, no offline asset audit (audit scans need the lookup endpoint).
- A native rebuild for new permissions. Nothing here adds a native module; camera is already used by scanning.
- Translating new strings beyond `en` (the app ships `en` only today).

## Users and Primary Flows

- **Field technician (primary).** Opens the app to Home: sees the 9:00 site visit, two tickets awaiting their reply, a timer still running from yesterday. Taps the schedule entry to open its ticket. Later at the site, opens Assets, filters to the client and location, starts an audit, scans each device as they walk, taps "Mark present" for a device whose label is unreadable, finishes with 14 present and 2 missing, and the two missing show in the summary with a one-tap "Create ticket".
- **Project tech.** Opens Projects, picks the office move project, sees phase "Cabling" is 3 of 8 tasks done, opens a task, assigns it to themselves and sets a due date, logs time, adds a comment. Creates the follow-up task "Label patch panel" in the same phase.
- **Dispatcher on the go.** Searches "Flagg" from Home, gets the contact and their two open tickets, opens one, reassigns it.
- **Technician offline (stretch).** Writes a comment and a 45-minute time entry in a basement; both show a "Pending" badge; when signal returns they send and the badges clear. If the server rejects one (ticket closed meanwhile), it stays in the outbox with the error and a Retry/Discard choice.
- **AlgaDesk tenant.** Sees no Projects or Assets tab (capabilities are false off the PSA product), still gets Home and Search (search results limited to types the product has).

## UX / UI Notes

### Drawer order (all tabs reached from the hamburger menu)
Home, Tickets, Activities, Schedule, Projects (gated), Interactions, Time Entries, Clients, Contacts, Assets (gated), Inventory (gated), Opportunities (gated), Settings. Home is the initial route for a fresh install; the existing navigation-state persistence still restores the last screen on relaunch.

### Home (`HomeScreen`)
- Header: tenant name, search icon (opens Search), existing timer chip.
- Cards, top to bottom, each collapsing when empty: **Running timer** (ticket or task title, elapsed, Stop); **Today** (schedule entries for the device-local day, time range, title, tap opens the entry sheet the Schedule tab already uses); **My tickets** (open tickets assigned to me sorted by latest activity, 5 rows, count in the card header, "View all" opens the Tickets tab with the assignee filter preset to me); **Activities** (due today or overdue from the Activities aggregation, 5 rows, "View all"); **Quick actions** row: New ticket, Scan, Log interaction, Start timer (opens the existing service picker then runs with no work item, exactly as the header chip does today).
- Pull to refresh refreshes all cards; each card loads independently and shows its own error row with Retry so one failing endpoint does not blank the screen.
- Offline: cards render from the TTL cache with the existing "Offline, showing cached data" banner.

### Projects
- **Projects list** (`ProjectsScreen`, drawer tab): rows show project name, client, status badge, due date (end_date) and a thin progress bar (closed tasks / total, from the project stats endpoint or the detail payload). Search box filters by `project_name`. Filter sheet: status (planning, active, in_progress, on_hold, completed, cancelled; default excludes completed and cancelled), client, "Managed by me" (assigned_to = me). Paginated like Tickets.
- **Project detail** (`ProjectDetailScreen`, root stack): header with name, client (tap opens ClientDetail), status badge, dates, manager; description collapsed; phases as sections in WBS order, each with "n of m done" and its tasks (name, assignee avatar, due date, status badge, overdue in danger colour). Tap opens the existing ProjectTaskDetail. A "+" in each phase header opens Create task. Closed tasks collapse under "Show n completed" per phase. Pull to refresh.
- **Create task** (`CreateTaskModal`): name (required), description, assignee (existing AgentPickerModal), due date (DatePickerField), priority (existing priorities list), estimated hours. Status defaults to the phase's first status mapping. On success the task is appended to the phase and the modal closes.
- **Task detail additions**: a Details card with Assignee (tap → AgentPickerModal), Due date (tap → DatePickerField, clearable), Priority (tap → picker), Estimated hours (read-only), and an "Open project" row at the top that navigates to ProjectDetail. Edits save immediately with the existing optimistic pattern and roll back on error with a toast.

### Assets
- **Assets list** (`AssetsScreen`, drawer tab): search box (asset tag, name, serial, via the list `search` param); rows show name, asset tag, type icon, client, location, status badge; filter sheet: client (EntityPickerModal), location (loads the client's locations, enabled after a client is picked), status (chips from `GET /api/v1/asset-statuses`, grouped by kind, default: every status whose kind is not `archived`), type. Header actions: Scan (jumps to the Inventory scan view) and Audit (starts the audit flow). Tap opens AssetDetail. Paginated.
- **Audit setup** (`AuditSetupScreen`): client picker, then location picker (required; "No location" is allowed and audits the client's assets with no location), status chips defaulting to deployable and pending kinds. Shows the expected count before Start.
- **Audit session** (`AuditSessionScreen`): top: progress "9 of 16 present", Scan button opening the camera (same scanner component as Inventory, lookup via `/api/v1/inventory/lookup`), a search field for manual marking. Two segments: **Remaining** (expected, not yet seen; each row has "Mark present") and **Present**. A scan that resolves to an asset in the expected list marks it present with haptic and a brief toast; a scan that resolves to an asset belonging to another client or location is listed under a third segment **Unexpected** with its real location; a scan that resolves to nothing offers the existing Register asset modal (registering adds it to Present). "Finish" asks for confirmation when assets remain unmarked.
- **Audit summary** (`AuditSummaryScreen`): counts, the missing list with per-row "Create ticket" (existing create-ticket-from-asset modal preselecting the asset) and the unexpected list. "Done" returns to Assets. The same screen opens from Assets ▸ "Recent audits" (last 10 for the tenant).
- **Asset detail**: a "Last audited" row (date, result, auditor) when the asset has one; audit entries appear in the existing History section because they are written to `asset_history`.

### Search (`SearchScreen`)
- Opened from the Home header icon and from a long-press on the drawer's search affordance. Single text field, auto-focused, 300 ms debounce, minimum 2 characters. Results grouped by type in this order: tickets, clients, contacts, assets, projects, project tasks; each group shows up to 5 with "More" fetching the next page for that type only. Rows use the search result's title and subtitle. Tap routes to the matching screen; result types the app cannot open are not requested. Recent searches (last 8, on device) show before typing. Empty state and offline state follow the existing patterns.

### Offline outbox (stretch)
- A persisted queue of pending writes with a small cloud-upload icon in the header while non-empty and a count. Pending comments render in the ticket's comment list with a "Pending" badge, pending time entries in the ticket's time section, pending interactions in the Interactions list. An Outbox screen (Settings ▸ Outbox, or tapping the icon) lists items with status (pending, sending, failed + error), Retry and Discard.
- Replay starts on reconnect and on app resume, in creation order, one at a time; a failure with a 4xx stops that item and continues with the next; a network failure stops the run.

## Requirements

### Functional Requirements

**Capabilities and gating**
- FR1. `GET /api/v1/mobile/me/capabilities` features gain `assets` (asset:read) and `assetAudit` (asset:read and asset:update). Both are false off the PSA product, like `projects`.
- FR2. The mobile capability parser accepts the new flags, defaulting to false on older servers; the drawer shows Projects when `projects` is true and Assets when `assets` is true; the Audit header action shows only when `assetAudit` is true.
- FR3. `productSurfaceRegistry` lists `/api/v1/asset-audits` in the PSA-only group alongside `/api/v1/assets`, and the route inventory contract test passes. `/api/v1/search` is confirmed reachable with `x-api-key` (it already serves the MCP tools) and listed if the contract test requires it.

**Projects (mobile only; no server change)**
- FR4. `src/api/projects.ts`: `listProjects` (page, limit, project_name, status, client_id, assigned_to, is_closed), `getProject` (with details: phases, assigned user, counts), `listProjectPhases`, `listProjectTasks` (per project), `createProjectTask` (POST `/projects/{id}/phases/{phaseId}/tasks`), `listPriorities` reuse. Types mirror the v1 schemas. Existing `updateProjectTask` and `listTaskStatusMappings` are reused.
- FR5. Projects list with search, filter sheet, pagination, pull to refresh, empty and error states, and the "Managed by me" toggle (assigned_to = current user id).
- FR6. Project detail groups tasks by phase in WBS order with per-phase done counts and the project progress bar; closed tasks collapse; tapping a task opens ProjectTaskDetail; tapping the client opens ClientDetail.
- FR7. Create task modal validates name, posts with the phase's default status mapping, and inserts the returned task into the phase without a full reload.
- FR8. Task detail: editable Assignee, Due date, Priority via `PUT /projects/tasks/{taskId}`; an "Open project" row; a project name subtitle in the header.
- FR9. Deep links: `alga://project/:projectId` opens ProjectDetail; hosted `/msp/projects/{id}` (without `taskId`) folds to it; push payloads carrying `projectId` route there.
- FR10. The `projects` i18n namespace holds every new string; no hard-coded text.

**Assets list (mobile; server unchanged except registry)**
- FR11. `src/api/assets.ts` gains `listAssets` (page, limit, search, client_id, location_id, status, asset_type) and `listAssetStatuses`; the client locations call reuses `listClientLocations` from the clients API.
- FR12. Assets list with search, filter sheet (client, location, status by kind, type), pagination, pull to refresh, empty and error states, Scan and Audit header actions.
- FR13. Rows show the status label from the status registry (not the raw slug) and the location name.
- FR14. Deep link `alga://asset/:assetId` opens AssetDetail; hosted `/msp/assets/{id}` folds to it.

**Site audit (server)**
- FR15. Migration creates `asset_audits` (tenant, audit_id, client_id, location_id nullable, status `in_progress|completed|cancelled`, started_by, started_at, completed_at, expected_count, present_count, missing_count, unexpected_count, notes) and `asset_audit_items` (tenant, audit_id, asset_id, result `present|missing|unexpected`, marked_at, marked_by, method `scan|manual|register`), both with tenant in the primary key and distributed by tenant, no RLS. `assets` gains `last_audited_at`, `last_audit_result`.
- FR16. `AssetAuditService` in `server/src/lib/api/services`: `start` (client_id, location_id, status slugs → snapshots the expected asset ids, returns the audit with the expected list), `markPresent` (audit_id, asset_id, method), `markUnexpected` (asset_id found outside scope), `unmark`, `complete` (fills missing from expected minus present, writes one `asset_history` row per item with change_type `audit` and `changes {audit_id, result, location_id}`, sets `assets.last_audited_at/last_audit_result`, returns the summary), `cancel`, `get`, `list` (tenant, newest first, optional client_id).
- FR17. REST: `POST /api/v1/asset-audits`, `GET /api/v1/asset-audits`, `GET /api/v1/asset-audits/{id}`, `POST /api/v1/asset-audits/{id}/items` (asset_id, result, method), `DELETE /api/v1/asset-audits/{id}/items/{assetId}`, `POST /api/v1/asset-audits/{id}/complete`, `POST /api/v1/asset-audits/{id}/cancel`. Permissions: asset:read to list/get, asset:update to start, mark, complete, cancel. Validation: audit must be `in_progress` for mutations; asset_id must belong to the tenant; marking the same asset twice is idempotent.
- FR18. OpenAPI entries for every audit route; the OpenAPI spec and MCP/chat registries are regenerated.

**Site audit (mobile)**
- FR19. `src/api/assetAudits.ts` wraps the seven routes.
- FR20. Audit setup screen with client, location and status-kind selection, expected count preview, Start.
- FR21. Audit session screen: Remaining / Present / Unexpected segments, Scan (camera, inventory lookup) and manual Mark present, haptic and toast on each mark, undo via the Present row's "Unmark", unknown code → Register asset modal → marked present with method `register`, Finish with confirmation when items remain.
- FR22. The session survives backgrounding and app restart: audit id and marks are server-side, and the screen reloads the audit on mount.
- FR23. Audit summary screen with counts, missing list (Create ticket per row using the existing modal), unexpected list, Done. Recent audits list on the Assets tab opens past summaries.
- FR24. Asset detail shows "Last audited" when present.

**Home**
- FR25. `HomeScreen` is the first drawer route with the five cards described above, each with its own loader, error row and Retry.
- FR26. "My tickets" queries `/api/v1/tickets` with `assigned_to` = current user, `is_open=true`, `sort=latest_activity_at`, `limit=5`, `fields=mobile_list`; the header count uses `pagination.total`.
- FR27. "Today" uses the schedule API for the device-local day and reuses the Schedule tab's entry sheet (ticket, task, interaction and ad-hoc entries all open as they do there).
- FR28. "Activities" uses the Activities API filtered to due today or overdue, excluding done.
- FR29. Quick actions navigate to CreateTicket, the Inventory scan view (hidden when `inventory` is false), the Log interaction entry, and the timer start flow.
- FR30. Cards read from the TTL cache when offline and refresh on resume via the existing `useAppResume`.

**Search**
- FR31. `src/api/search.ts` wraps `GET /api/v1/search` (query, types, limit, cursor) and maps result types to routes: ticket → TicketDetail, client → ClientDetail, contact → ContactDetail, asset → AssetDetail, project → ProjectDetail, project_task → ProjectTaskDetail.
- FR32. Search screen with debounce, minimum length, grouped results, per-group "More", recent searches on device (cleared on sign-out), empty, error and offline states.
- FR33. Requested types are limited to those the current capabilities can open (no asset results when `assets` is false, no project types when `projects` is false).

**Release**
- FR34. `app.json` version 2.0.0, iOS build 39, Android versionCode 39; release notes at `ee/docs/plans/2026-10-14-mobile-2-0/RELEASE_NOTES.md`.
- FR35. Every new string lives in the `projects`, `assets`, `home` and `search` namespaces (`assets.json` extended); the drawer gating test covers the two new tabs.

**Offline outbox (stretch; its own commit groups, ship only if green)**
- FR36. Server: `POST /api/v1/tickets/{id}/comments`, `POST /api/v1/time-entries` and `POST /api/v1/interactions` accept an `Idempotency-Key` header; a `api_idempotency_keys` table (tenant, user_id, key, route, response_status, response_body, created_at) returns the stored response for a repeated key within 24 hours instead of creating a second record.
- FR37. Mobile: `src/offline/outbox.ts` persists queued writes (type, payload, idempotency key, created_at, attempts, last_error) in app storage keyed by server and user; `enqueue` is used by the comment composer, the time entry form and the interaction form only when the request fails with a network error or the app is offline.
- FR38. Replay on reconnect and resume, in order; 4xx marks the item failed and continues; network failure stops the run; success removes the item and invalidates the affected cache.
- FR39. Pending items render inline with a "Pending" badge where they will appear once sent; an Outbox screen lists all items with Retry and Discard; a header icon shows the count.
- FR40. Signing out with a non-empty outbox warns and offers to discard.

### Non-functional Requirements

- No new native modules; an OTA-compatible JavaScript change plus one EAS build for the version bump.
- Lists stay responsive on 500+ assets per client by server pagination (limit 50) and FlatList virtualisation.
- Audit scans complete in under one second on a good connection; the lookup call is the only network hop per scan.
- Existing mobile suite (187 test files) keeps passing; new screens get the same vitest + react-native testing coverage as Tickets and Interactions.
- Server unit tests for the audit service and route; the OpenAPI, route-inventory, hardcoded-currency and registry contract tests pass.

## Data / API / Integrations

- **Asset branch dependency.** `feature/asset_assignments_bundles_merge` adds `asset_statuses` (slug, label, kind: deployable | pending | undeployable | archived; builtins active, in_stock, maintenance, inactive, retired), `asset_assignments`, `asset_groups`, procurement columns, `assets.billing_profile_id`, REST `/asset-statuses`, `/asset-groups`, `/assets/{id}/assignments`, and a read-only mobile AssetDetail update. This plan's status filter chips and the audit's default scope (deployable + pending kinds) depend on that registry. Build on top of that branch; do not re-add any of its columns.
- **Existing v1 surfaces reused unchanged:** `/projects` (list, filters: project_name, client_id, status, assigned_to, is_closed), `/projects/{id}` (phases, assigned_user, counts), `/projects/{id}/phases`, `/projects/{id}/tasks`, `/projects/{id}/phases/{phaseId}/tasks` POST, `/projects/tasks/{taskId}` GET/PUT, `/projects/{id}/task-status-mappings`, `/assets` (filters: search, client_id, location_id, status, asset_type), `/assets/{id}`, `/inventory/lookup`, `/search` (query, types, limit, cursor), `/tickets` (assigned_to, is_open, sort, fields), `/schedules`, `/activities`, `/clients/{id}/locations`, `/priorities`, `/users`.
- **New tables:** `asset_audits`, `asset_audit_items`, `api_idempotency_keys` (stretch). Migrations in `server/migrations/` using `require('./utils/tenantDb.cjs')`, tenant in PK, distributed by tenant, no RLS (see memory `reference_no_rls_new_tables`).
- **New REST:** `/api/v1/asset-audits` family (FR17). Register the route group in `productSurfaceRegistry` or the route-inventory contract test fails.
- **OpenAPI/MCP regen:** from `sdk/`: `npx tsx --tsconfig ../server/tsconfig.json scripts/generate-openapi.ts --edition ce` and `--edition ee`; then `npm run mcp:registry:generate` at the root; nm-store copy via the `alga-openapi-sync` skill when shipping.
- **Mobile storage:** recent searches and the outbox use the existing secure/app storage helpers keyed by `baseUrl + tenant + user`, cleared on sign-out and host switch (same discipline as the push-registration record).

## Security / Permissions

- Projects tab: `project:read` (existing capability). Task create and edit: the v1 routes already enforce `project_task:create/update`; the UI hides the "+" and makes fields read-only on 403.
- Assets tab: `asset:read`. Audit: `asset:update` for start, mark, complete, cancel; `asset:read` for list and get.
- Search runs under the user's own ACL on the server (`search_business_data`); no new exposure.
- Idempotency keys are scoped to tenant and user; a key from another user never replays a stored response.
- All new queries include `tenant` in WHERE and JOIN conditions (Citus).

## Observability

Not in scope beyond the existing mobile logger and server request logging.

## Rollout / Migration

1. Wait for `feature/asset_assignments_bundles_merge` to merge (or rebase this branch on it). The Assets tab and audit are unusable without the status registry.
2. Server first: audit migration + routes + registry + OpenAPI ship with the next hosted deploy; the appliance picks them up on its next image. Older servers: the app hides Audit (capability false) and the Assets tab still works against the pre-registry `status` slug by showing it raw.
3. Mobile: feature branch `mobile/2.0`, PR to main, TestFlight + Play internal build 39; smoke sign-in, push, Home cards, project create task, audit end to end on a device with camera, search routing. The user triggers builds; do not trigger EAS from the agent.
4. Reply on ticket alga-2026-0002627 when the audit ships.

## Open Questions

- Q1. **Ship order with the asset branch.** Recommended: branch 2.0 from main after mc14 merges. If mc14 slips, ship Projects, Home and Search as 2.0 and Assets + audit as 2.1.
- Q2. **Should completing an audit change missing assets' status** (for example to `inactive`)? Recommended: no automatic change; the summary offers Create ticket per missing asset. A "Mark missing as …" bulk action can follow once the web has an Audits view.
- Q3. **"Managed by me" vs "has my tasks."** The v1 project list filters by project manager only. Recommended: keep "Managed by me"; "my tasks" is the Activities tab. Adding a `has_my_tasks` filter is a small server change if wanted.
- Q4. **Home as the initial route.** Navigation persistence restores the last screen anyway, so Home is the first screen only on a fresh install or after sign-in. Recommended: also reset to Home on sign-in.
- Q5. **Offline outbox in 2.0 or 2.1.** It is isolated in its own commit groups; recommended to decide at code-complete of the core groups.
- Q6. **Unexpected assets during an audit:** record only (recommended) or offer "Move here" which would change `location_id`? Moving touches the asset plan's history rules; recommended record only.

## Acceptance Criteria (Definition of Done)

- Drawer shows Home first, Projects and Assets when the capabilities say so, and nothing new on AlgaDesk tenants.
- A tech can open a project, see phases with task counts, create a task, and change a task's assignee, due date and priority from the phone; changes are visible on the web immediately.
- A tech can list a client's assets by location and status, open any asset, and run an audit from setup to summary; after completion each asset shows an audit entry in its web history and "Last audited" on mobile; the missing list offers Create ticket.
- Home shows the running timer, today's schedule, my open tickets with count, due/overdue activities and quick actions, refreshes on pull and resume, and renders from cache offline.
- Search returns grouped results within one round-trip per group and routes each tap to the right screen.
- 2.0.0 build 39 on TestFlight and Play internal; mobile vitest, lint and typecheck green; server unit + contract tests green; OpenAPI and registries regenerated.
- Stretch: comments, time entries and interactions written offline arrive exactly once after reconnect; failed items can be retried or discarded.
