# Scratchpad — RMM Alert Handling

- Plan slug: `2026-06-12-rmm-alert-handling`
- Created: 2026-06-12

## What This Is

Working memory for the RMM alert handling effort. Approved design lives at
`docs/plans/2026-06-12-rmm-alert-handling-design.md` (commit `c717a4fd50`).

## Decisions

- (2026-06-11) Dedup is one open ticket per (device, condition). Repeats append a comment and bump `occurrence_count`. Always on, not per-rule configurable.
- (2026-06-11) Auto-close on alert reset: always comment; close only if no human touched the ticket (no human comments, no time entries, no manual status change). Rule-driven auto-assignment does not count as touched.
- (2026-06-11) Outbound reset on ticket close is a per-rule `actions.resetAlertOnTicketClose` flag, default true.
- (2026-06-11) Pipeline is provider-generic in `shared/rmm/alerts/`; NinjaOne and TacticalRMM both wired this branch.
- (2026-06-11) Processing runs synchronously in the webhook request (Approach A). All ingest work is local DB; the only external call (outbound reset) happens on the ticket-close bus subscriber.
- (2026-06-11) Schema direction: rules use JSONB `conditions`/`actions` (the alertProcessor model wins). One additive corrective migration; the deployed `20251124000001` migration is never rewritten. Deployed data is negligible — no backfill.
- (2026-06-11) Raw alert payload standardizes on the existing `metadata` jsonb column; code that wrote `source_data` changes to `metadata`.
- (2026-06-11) `rmm_organization_mappings.auto_create_tickets` is deprecated; rules with `organizationIds` conditions are the single source of truth.
- (2026-06-12) Maintenance windows and alert polling added to scope (originally non-goals) for competitor parity. Windows suppress before rule matching; suppressed alerts are stored but produce no ticket/notification/workflow event. The reconciliation poller owns window-end processing of still-active suppressed alerts.
- (2026-06-12) Polling is a per-integration Temporal schedule (Entra per-tenant pattern): default on, 15-minute default interval, 5–60 configurable, created on connect / removed on disconnect. Cycles upsert missed triggers and synthesize resets for stale active alerts, all through the same pipeline.
- (2026-06-12) Merged origin/main (443 commits) before implementing — the snapshot was stale: main added Huntress + Level.io providers, redesigned the RMM settings page to master-detail, and fixed Tactical/Level alert writers to be (mostly) schema-compliant. Local `.env.localtest` (wirein to the alga-psa-local-test stack, port 5472) preserved through the merge.
- (2026-06-12) There are now FOUR rmm_alerts writers: NinjaOne (still writes nonexistent source_data), Tactical (still writes source_data), Level.io (compliant), Huntress (compliant but raw severity/status values). Huntress has a complete incident→ticket path (incidentPlan/incidentProcessor/ticketCreator, pg-boss polling) configured via rmm_integrations.settings — leave it intact this branch; the shared pipeline wires NinjaOne + Tactical (+ Level.io if cheap). Folding Huntress in is a follow-up.
- (2026-06-12) Ticket facts from main: tickets.source exists; source_reference does NOT — store in attributes JSONB (Huntress convention). Ticket creator should take the caller's trx (Huntress ticketCreator pattern, not NinjaOne's self-managed one). Internal notes: comment_threads + comments with is_internal/is_system_generated (helper addTicketInternalNote). Closed statuses: statuses where item_type='ticket' and is_closed=true. TICKET_CLOSED is published via publishWorkflowEvent at packages/tickets/src/actions/ticketActions.ts:1062 (also optimizedTicketActions.ts:2508).
- (2026-06-12) RMM_ALERT_TRIGGERED/RESOLVED Zod schemas already exist (packages/event-schemas/src/schemas/eventBusSchema.ts:966-981) but are not in system_event_catalog (needs a registration migration, pattern: 20250130201000_register_email_system_events.cjs) and not published anywhere via publishWorkflowEvent.
- (2026-06-12) Shared import alias: @alga-psa/shared/* → shared/* (server + ee/server tsconfigs). Settings UI: providerSettingsComponents map in packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx; per-provider detail panes are where Alert Rules / Maintenance Windows sections plug in.
- (2026-06-12) Testing strategy is 80/20: tests.json holds a 32-test automated core (logic permutations, idempotency, lifecycle, tenant isolation, one E2E per direction); UI, live RMM round-trips, Temporal schedule lifecycle, email, and migrations are manual flows in SMOKE_TESTS.md, each tied to a named business risk. The old 114-test list was consolidated, not expanded — table-driven tests absorb the per-permutation entries.

- (2026-06-12, Robert's call) Reversed the pg-boss deviation: both RMM alert reconciliation AND Huntress incident polling now run as per-integration Temporal schedules (Entra pattern). Key enabler discovered during investigation: ee/temporal-workflows imports the full ee/server tree via its `@ee`/`@/` tsconfig aliases (the ninjaone-token-refresh activity precedent), so the activities are thin wrappers over the existing poll logic — no duplication. setupSchedules.ts reconciles schedules at worker boot; activities re-check is_active/polling-enabled per run so stale schedules no-op; NinjaOne connect/disconnect ensure/remove dynamically (ee/server/src/lib/integrations/rmm/alertPollingSchedule.ts). Caveats: interval changes saved via updateRmmAlertPollingSettings apply at next worker boot (the action lives in packages/ and can't reach the Temporal client); Tactical/Huntress schedule creation after a fresh connect also waits for worker boot (manual "poll now"/backfill covers the gap). CE deployments without Temporal workers get no polling — webhooks remain primary.

- (2026-06-12, Robert's catch) Final polling architecture: the per-integration polls ride the **IJobRunner abstraction** (packages/jobs interfaces; PgBossJobRunner CE / TemporalJobRunner EE, selected by JOB_RUNNER_TYPE else isEnterprise) — which I'd initially missed because the older IJobScheduler (pg-boss-only) looked like "the" scheduler abstraction. Same handler code both editions (server/src/lib/jobs/handlers/rmmAlertPollingHandlers.ts, registered in registerAllHandlers + initializeJobHandlersForWorker); cron intervals; reconcileRmmPollingSchedules() control loop (5-min tick on the legacy scheduler in initializeApp + boot pass + NinjaOne connect/disconnect hooks) converges jobs onto rmm_integrations state, so interval/toggle changes apply within minutes hands-off. TemporalJobRunner.scheduleRecurringJob fixed to update existing schedule specs. The bespoke temporal workflows/setupSchedules blocks and the ee alertPollingSchedule helper from the interim iteration are deleted; CE stubs added for the ninjaone fetcher + huntress poller dynamic @enterprise imports. CE Tactical polling restored.

## Discoveries / Constraints

- (2026-06-11) Alert ingestion is broken on main today: `webhookHandler.ts:671-674` inserts `activity_type` and `source_data` into `rmm_alerts`, but the only migration creating that table (`server/migrations/20251124000001_create_rmm_integration_tables.cjs`) has neither column.
- (2026-06-11) `alertProcessor.ts` reads JSONB `conditions`/`actions` from `rmm_alert_rules`; the migration created flat `text[]`/scalar columns instead. The processor is imported only by tests — never called from the webhook path.
- (2026-06-11) `ticketCreator.ts` works (manual button in `AssetAlertsSection.tsx` uses it) and is the basis for the shared creator.
- (2026-06-11) TacticalRMM's webhook (`server/src/app/api/webhooks/tacticalrmm/route.ts`) writes `rmm_alerts` directly, including the nonexistent columns — same schema bug.
- (2026-06-11) NinjaOne condition identity for dedup: `statusCode`, falling back to `activityType`. NinjaOne sends a fresh CONDITION TRIGGERED per firing, so a flapping check fires many times a day.
- (2026-06-11) NinjaOne webhook returns 200 for unmapped orgs (suppresses retries), 500 for unexpected errors (NinjaOne retries). Keep this; idempotent ingest makes at-least-once safe.
- (2026-06-11) `NinjaOneClient.resetAlert()` exists (`POST /api/v2/alert/{uid}/reset`); the only caller today is the `ninjaone.alerts.reset` workflow action.
- (2026-06-11) Known TODOs in adjacent code: CSRF validation in the NinjaOne OAuth callback; `resetInNinjaOne` in `alertProcessor.resolveAlert()` (superseded by the outbound adapter).
- (2026-06-11) Precedent for shared provider-agnostic RMM code: `shared/rmm/contracts.ts` + `shared/rmm/sharedAssetIngestionService.ts` (used by Tanium and Tactical device sync). The alert pipeline mirrors this layout.
- (2026-06-11) Legacy-bus events `RMM_ALERT_TRIGGERED`/`RMM_ALERT_RESOLVED` are published today but have no subscribers and are not in the workflow v2 catalog. Workflow v2 currently only sees `INTEGRATION_WEBHOOK_RECEIVED`.

## Implementation status (2026-06-12, mid-flight)

Done and committed: corrective migration (20260612090000) + event-catalog (…0100) and notification (…0200) migrations; shared pipeline in shared/rmm/alerts (contracts, evaluator, windowMatcher, dedup, ticketCreator, untouched, processRmmAlertEvent, reconciliation, createTicketForAlertId, outboundRegistry); NinjaOne/Tactical/Level webhooks normalized into it; TICKET_CLOSED outbound-reset subscriber + NinjaOne adapter (CE stub in packages/ee); rmmAlertNotificationSubscriber (in-app + email); rules+windows CRUD actions (packages/integrations/src/actions/integrations/rmmAlertRuleActions.ts); rmm.alerts.create_ticket workflow action; pg-boss reconciliation dispatcher (EE init, NinjaOne fetcher) — **deviation: pg-boss instead of design-doc Temporal** (Huntress precedent, CE compatibility; F083 connect/disconnect becomes "dispatcher polls only active integrations"); OAuth CSRF fix (ninjaone_oauth_state tenant secret, one-time use); legacy ee ninjaone alertProcessor/ticketCreator deleted, manual button + workflow action use shared createTicketForAlertId.

Update (2026-06-12, later): FR-7 UI shipped (RmmAlertAutomationSettings in packages/integrations, rendered in Tactical/NinjaOne/Level panes; asset-scope picker for windows deferred — F076 false). Tactical reconciliation fetcher shipped (reuses the backfill-verified alerts endpoint; backfill now runs a reconciliation cycle). Test status: unit suites (rule matrix, window matcher, dedup, schemas) + adapted tactical webhook/backfill tests green (70/71 in tactical+rmmalerts — the 1 failure, tacticalDeviceSync.fullSync, is pre-existing on merged main, unrelated); DB-backed integration suite (rmmAlertPipeline, 10/10) proves the migration + pipeline spine. tests.json: 27/32 automated (subscriber, reconciliation, untouched branches, normalizer, events, severity fallback all landed); the remaining 5 (T026/T027 CRUD action tests, T029 workflow action, T030 OAuth CSRF route, T031 notification subscriber) need bespoke harnesses and are the only un-automated items; the pre-existing tacticalDeviceSync.fullSync unit failure was inherited from main (fails without this branch's changes). Integration tests need env: DB_HOST=localhost DB_PORT=5472 DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=$(cat secrets/postgres_password).

Previously remaining: FR-7 settings UI (Alert Rules + Maintenance Windows + polling settings section in provider panes — providerSettingsComponents map in packages/integrations RmmIntegrationsSetup.tsx); test core T001–T032 (old tactical webhook unit tests will need adapting to the pipeline; old ee alertProcessor tests reference deleted module — replace with shared-module tests); flip features.json/tests.json implemented flags; update design doc for the pg-boss deviation + id-space caveat.

Verification caveats for smoke testing: NinjaOne webhook external ids are activity ids while the alerts API returns uids — reconciliation only trusts poller-ingested ids for staleness (RECONCILIATION_INGEST_MARKER in metadata) and dedup absorbs cross-source duplicates; verify uid/id behavior against a live sandbox. Tactical/Level reconciliation fetchers intentionally deferred until their list-alerts API shapes are verified live (F082 open).

## Commands / Runbooks

- Run server migrations: from `server/`, `npx knex migrate:latest` (see existing env scripts; use the worktree's compose stack via the alga-env-manager skill).
- Webhook entry for local testing: `POST /api/webhooks/ninjaone?tenant=<tenantId>` with `X-Alga-Webhook-Secret` header (secret in `rmm_integrations.settings.webhookSecret`).

## Links / References

- Design doc: `docs/plans/2026-06-12-rmm-alert-handling-design.md`
- Migration with current (broken) schema: `server/migrations/20251124000001_create_rmm_integration_tables.cjs`
- NinjaOne webhook: `ee/server/src/app/api/webhooks/ninjaone/route.ts`, handler `ee/server/src/lib/integrations/ninjaone/webhooks/webhookHandler.ts`
- Rules engine to move: `ee/server/src/lib/integrations/ninjaone/alerts/alertProcessor.ts`
- Ticket creator to move: `ee/server/src/lib/integrations/ninjaone/alerts/ticketCreator.ts`
- Tactical webhook: `server/src/app/api/webhooks/tacticalrmm/route.ts`
- Shared device-ingest precedent: `shared/rmm/sharedAssetIngestionService.ts`
- Provider registry (capability flags): `packages/integrations/src/lib/rmm/providerRegistry.ts`
- Asset alert UI: `ee/server/src/components/assets/AssetAlertsSection.tsx`
- NinjaOne client (resetAlert): `ee/server/src/lib/integrations/ninjaone/ninjaOneClient.ts`

## Open Questions

- Does TacticalRMM's API expose alert resolution for the outbound adapter? If not, ship the adapter for NinjaOne only and mark the capability off for Tactical (pipeline skips it cleanly).
- Exact event-bus event name for ticket closure (TICKET_UPDATED with closed status vs. a dedicated TICKET_CLOSED) — confirm against `server/src/lib/eventBus/` when wiring the subscriber.
- Confirm Tactical's alerts API supports listing active alerts for reconciliation (NinjaOne's `getAlerts()` already exists in the client).
- FR-11 scheduler choice: the design says Temporal (Entra pattern), but Huntress's incident poller uses pg-boss (server-side, CE-compatible — Tactical is a CE provider and CE deployments may not run Temporal workers). Decide at FR-11; pg-boss looks like the better precedent. Flag the deviation to Robert either way.
- Huntress provider registry flags are stale (deviceSync/events false despite reality) — out of scope here, but worth a drive-by fix or follow-up.
- Reconciliation poller and `resolveAlert` semantics: a poller-synthesized reset should be distinguishable in the ticket comment ("alert no longer active in RMM" vs. "alert reset received").

## Smoke run (2026-06-12) — all 8 runbook flows PASS after fixes

Executed /tmp/rmm-alert-smoke-tests.md end-to-end (algadev, local-test stack,
EE + JOB_RUNNER_TYPE=pgboss). Bugs found and fixed on this branch:

- **statuses.item_type drift (4 call sites)**: main's board-scoped statuses
  migration left `item_type` NULL; live data uses `status_type` + `board_id`.
  Fixed ticketCreator (now delegates to `TicketModel.getDefaultStatusId`),
  `resolveCloseStatusId`, `untouched.ts`, the rule-form `closedStatuses`
  query, and the Huntress ticket creator. Symptoms: webhook 500 on first
  trigger; auto-close never closed; untouched check ignored status moves.
- **Dedup primary selection**: sibling lookup ordered `created_at desc`,
  bumping the newest absorbed row instead of the ticket-owning primary.
  Now `asc`; occurrence counts and "occurrence N" comments track the primary.
- **Severity→priority**: exact-name match missed "P1 - Critical"-style
  names; added substring fallback pass.
- **Polling settings first save was a no-op**: `jsonb_set` can't create the
  `alertPolling` parent key; now merges `jsonb_build_object` into the parent.
- **Reconciler tick never recurred**: legacy `IJobScheduler.scheduleRecurringJob`
  is a one-shot delayed send (cron coerced to '24 hours', singletonHours 24,
  no re-fire). The tick is now a process-local 5-min `setInterval` in
  initializeApp (+ boot pass); reconcile is idempotent so multi-replica
  ticks are safe.
- **PgBossJobRunner recurring-record lifecycle**: every cron fire flipped the
  schedule's jobs row to `completed` (runs share `jobServiceId`), so the
  reconciler saw "no job" → recreated rows while enabled and leaked the
  pgboss schedule on disable. Fires now carry `jobRecurring: true` and the
  worker returns recurring rows to `queued`; `cancelJob` exempts recurring
  records from the completed/failed guard, unschedules, and nulls
  `external_id` (the live-schedule pointer the reconciler now also filters
  on). Ineligible-branch cancels via newest record of any status.
- **Rule dialog stale patternError**: dialog component stays mounted; a
  cancelled invalid-regex edit blocked the next Add rule. Reset on `isOpen`.
- **Button ids**: 14 missing required `id` props in RmmAlertAutomationSettings.
- **Integration test seed**: statuses now board-scoped; 20/20 green again.

Environment notes for future smoke runs: `DB_NAME_SERVER` is required by
`migrate:ee` (else knex hits the default `postgres` DB — an accidental full
migration run was left there; safe to drop that DB's public schema);
Tactical row needs `NEXT_PUBLIC_FORCE_FEATURE_FLAGS=tactical-rmm-integration:true`;
EE without Temporal needs `JOB_RUNNER_TYPE=pgboss`; seed tenant had no
closed ticket status (marked "Enchanted Closure" is_closed=true); Test
Connection (GET /api/beta/v1/client/) is what activates the integration.
Tactical backfill button label is "Sync Alerts".

Validation: rmmalerts unit 40/40; tactical unit 36/37 (1 pre-existing main
failure); rmmAlertPipeline integration 20/20; tsc clean on touched packages.
Flow 6 observed live: interval change converged ~3 min, disable unscheduled,
pre-fix leaked schedule self-healed on first tick.

## Deferred: "run workflow" as an alert-rule action (2026-06-12)

Considered and deliberately held off. Coverage today: workflows can already
trigger on RMM_ALERT_TRIGGERED/RESOLVED (system event catalog) and on ticket
creation, and can call rmm.alerts.create_ticket; the rule action would mainly
add rule-level filtering as the trigger plus rule context in the payload.

If revisited, the design direction we converged on: run-workflow as an
independent action toggle (composes with create-ticket; "replace" = create
ticket off + workflow on), launched fire-and-forget via
launchPublishedWorkflowRun after the processing transaction commits. Two
gaps must be closed for replace mode to be safe: (1) storm protection
without a ticket — dedup should treat an active same-dedup-key alert as an
occurrence even before any ticket exists, else flap storms launch one
workflow per firing during the async gap; (2) lifecycle hooks — workflow-
created tickets keep auto-resolve/reset-on-close only when created through
rmm.alerts.create_ticket (which maintains rmm_alerts.ticket_id). The
transactional-vs-eventual ticket guarantee is the documented trade-off.
