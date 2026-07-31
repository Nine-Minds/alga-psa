# Design: RMM alert handling and ticket lifecycle sync

- **Status:** Approved
- **Created:** 2026-06-12
- **Branch:** `feature/rmm-alerts-sync`

## Problem

RMM alert ingestion is scaffolded but broken and disconnected:

- The NinjaOne webhook (`ee/server/src/app/api/webhooks/ninjaone/route.ts`)
  inserts `activity_type` and `source_data` into `rmm_alerts`
  (`webhookHandler.ts:671-674`). Neither column exists. The only migration that
  creates these tables is
  `server/migrations/20251124000001_create_rmm_integration_tables.cjs`, so the
  basic alert insert fails at runtime.
- The rules engine
  (`ee/server/src/lib/integrations/ninjaone/alerts/alertProcessor.ts`) reads
  JSONB `conditions` / `actions` columns from `rmm_alert_rules`. The migration
  created flat `text[]` filter columns instead. The processor is also never
  called from the webhook path; only tests import it.
- The ticket creator
  (`ee/server/src/lib/integrations/ninjaone/alerts/ticketCreator.ts`) works but
  is reachable only from the manual button in `AssetAlertsSection.tsx`.
- Nothing closes a ticket when an alert resets, nothing resets a NinjaOne alert
  when a ticket closes, repeat alerts have no dedup, and there is no UI or CRUD
  for alert rules.

The `rmm_alerts` / `rmm_alert_rules` tables are deployed but hold no data worth
preserving, so corrective schema work can be additive without backfill.

## Decisions

| Question | Decision |
| --- | --- |
| Scope | Full pipeline + lifecycle sync + rules CRUD/UI + workflow v2 events + notifications |
| Dedup | One open ticket per (device, condition). Repeats append a comment and bump a counter |
| Auto-close on alert reset | Always comment; close the ticket only if no human has touched it |
| Outbound reset on ticket close | Per-rule flag `resetAlertOnTicketClose`, default true |
| Provider scope | Provider-generic pipeline; NinjaOne and TacticalRMM both wired |
| Processing model | Synchronous in the webhook request (local DB work only) |
| Migration strategy | One additive corrective migration; never rewrite the deployed one |
| Maintenance windows | Suppress before rule matching; alert stored as `suppressed`; the poller processes still-active alerts after the window ends |
| Alert polling | Per-integration Temporal schedule (default on, every 15 min) reconciles missed triggers and missed resets through the same pipeline; Huntress incident polling migrated to the same model |

## Architecture

New shared module `shared/rmm/alerts/`, following the
`shared/rmm/sharedAssetIngestionService.ts` precedent so both `ee/server`
(NinjaOne) and `server` (TacticalRMM) can import it:

- `contracts.ts` defines `NormalizedRmmAlertEvent`:
  `{ tenantId, integrationId, provider, kind: 'triggered' | 'reset' |
  'acknowledged', externalAlertId, externalDeviceId, activityType, alertClass,
  sourceType, severity, message, deviceName, externalOrganizationId,
  occurredAt, raw }` — and `RmmAlertOutboundAdapter` with `resetAlert(externalAlertId)`,
  optional per provider.
- `processRmmAlertEvent.ts` is the single pipeline entry point.
- `alertRuleEvaluator.ts`, `alertTicketCreator.ts`, `alertLifecycle.ts` hold the
  logic moved out of `ee/server/src/lib/integrations/ninjaone/alerts/` and made
  provider-agnostic.

Webhook routes keep their existing auth, tenant resolution, and tier gating.
Each route maps its payload to a `NormalizedRmmAlertEvent` (a thin
`mapNinjaOneWebhookToAlertEvent()` in ee; a Tactical equivalent in
`server/src/app/api/webhooks/tacticalrmm/route.ts`, replacing its direct
`rmm_alerts` writes) and calls the pipeline.

**Triggered:** upsert `rmm_alerts` on `(tenant, integration_id,
external_alert_id)` → compute `dedup_key` (device + condition identity; for
NinjaOne, `statusCode` falling back to `activityType`) → maintenance-window
check (a match stores the alert as `suppressed` and stops) → evaluate rules
(first match by `priority_order`; a rule with no conditions is a catch-all) →
dedup check → create a ticket or append an occurrence comment to the existing
open ticket → publish events. The matched rule's ID is stored on the alert row
so later lifecycle steps do not re-evaluate rules.

**Reset:** mark the alert resolved. If a ticket is linked and the matched rule
has `autoResolveTicket`: always add a comment; close the ticket only if it is
untouched. Publish `RMM_ALERT_RESOLVED`.

**Outbound (ticket close → RMM):** an event-bus subscriber on ticket-closed
events looks up unresolved `rmm_alerts` by `ticket_id`, checks the matched
rule's `resetAlertOnTicketClose`, and calls the provider's outbound adapter
(`NinjaOneClient.resetAlert()` at
`ee/server/src/lib/integrations/ninjaone/ninjaOneClient.ts`; Tactical's
resolve-alert API if supported, otherwise the step is skipped). This is the
only external call in the design and it already runs async on the bus.

The org-mapping flag `rmm_organization_mappings.auto_create_tickets` is
deprecated. Rules, with their organization filter, are the single source of
truth for what creates tickets.

Idempotency: NinjaOne retries on 5xx. The external-ID upsert plus the dedup
check make a replayed webhook a no-op, so at-least-once delivery is safe.

## Schema changes

One additive migration.

`rmm_alerts` — add:

- `activity_type` varchar(100), `acknowledged_at` timestamptz,
  `acknowledged_by` uuid (columns the code already writes)
- `dedup_key` varchar(255), with an index on
  `(tenant, integration_id, dedup_key)`
- `occurrence_count` int default 1, `last_occurrence_at` timestamptz
- `matched_rule_id` uuid null
- `auto_ticket_created` boolean default false
- `suppressed_by_window_id` uuid null (alert `status` gains a `suppressed`
  value)

New table `rmm_maintenance_windows`: `tenant`, `window_id`, optional scoping
columns `integration_id`, `client_id`, `asset_id` (null = applies to all of
that dimension), `name`, `is_active`, `starts_at`/`ends_at` for one-off
windows, and a `recurrence` jsonb
(`{ type: 'weekly', days, startTime, endTime, timezone }`) for recurring ones.

The raw payload standardizes on the existing `metadata` jsonb column. Code that
writes `source_data` changes to `metadata`.

`rmm_alert_rules` — add `conditions` jsonb and `actions` jsonb; drop the eleven
flat columns (`severity_filter`, `source_type_filter`, `alert_class_filter`,
`organization_filter`, `message_pattern`, `create_ticket`,
`ticket_channel_id`, `ticket_priority`, `assigned_user_id`, `ticket_template`,
`auto_resolve_ticket`). `name`, `description`, `is_active`, and
`priority_order` stay as real columns.

### `conditions` shape

All fields optional; every present field must match; an empty object matches
every alert.

```ts
{
  severities?: string[],
  activityTypes?: string[],
  alertClasses?: string[],
  sourceTypes?: string[],
  organizationIds?: string[],   // external org IDs
  messagePattern?: string,      // regex, validated at save time
  keywords?: string[]           // substring match on message
}
```

### `actions` shape

```ts
{
  createTicket: boolean,
  boardId?: string,
  priorityOverride?: string,
  assignToUserId?: string,
  ticketTemplate?: { titleTemplate?: string, descriptionTemplate?: string },
  autoResolveTicket: boolean,
  autoResolveStatusId?: string,      // fallback: tenant's first is_closed status
  resetAlertOnTicketClose: boolean,  // default true
  notifyUserIds?: string[]
}
```

Ticket templates support `{{device}}`, `{{message}}`, `{{severity}}`, and
`{{organization}}` placeholders. Zod schemas validate both shapes at the
server-action boundary.

## Lifecycle semantics

**Dedup.** On a triggered event whose matched rule creates tickets, look for an
alert row with the same `dedup_key` whose linked ticket is still open. If
found: point the new alert row at that ticket, increment `occurrence_count`,
and add an internal comment ("Alert re-triggered — Nth occurrence"). If not:
create a ticket. Dedup is always on; it is not per-rule configurable.

**Untouched.** A ticket is untouched when it has no human-authored comments, no
time entries, and no manual status change since creation. Rule-driven
auto-assignment does not count as touched.

## Maintenance windows

The pipeline checks windows before rule matching. An alert is suppressed when
an active window matches all of its non-null scopes (integration, client,
asset) at the alert's `occurredAt` — one-off windows by `starts_at`/`ends_at`,
weekly recurring windows by day and time range in the window's timezone.

A suppressed alert is stored with `status = 'suppressed'` and
`suppressed_by_window_id`. It creates no ticket, sends no notifications, and
publishes no workflow events. A reset arriving for a suppressed alert resolves
it quietly. When a window ends, the reconciliation poller processes
still-active suppressed alerts through the normal rules path, so a condition
that fired during maintenance and is still firing afterward becomes a ticket.

Windows have their own CRUD server actions (admin-gated, Zod-validated) and a
"Maintenance Windows" subsection beside Alert Rules in RMM settings: a list
plus an editor with client/asset scope pickers and a one-off or weekly
recurring schedule.

## Alert polling (reconciliation)

Polling rides Alga's job-runner abstraction (`IJobRunner`,
`JobRunnerFactory`): the same handlers
(`server/src/lib/jobs/handlers/rmmAlertPollingHandlers.ts`, registered in the
central `JobHandlerRegistry` for the server and in
`initializeJobHandlersForWorker` for the temporal worker) run on whichever
backend the edition selects — **Temporal Schedules in EE, pg-boss cron in
CE** — so TacticalRMM keeps polling in community deployments. Each
integration gets one recurring job keyed by singletonKey
`<job>:<tenant>:<integration>`: `rmm-alert-reconciliation` (interval from
`settings.alertPolling`, 5–60 min, default 15, on by default) and
`huntress-incident-poll` (from `pollIntervalMinutes`, default 5), which
replaced Huntress's pg-boss dispatcher.

A small control loop, `reconcileRmmPollingSchedules()`, converges the
recurring jobs onto `rmm_integrations` state — creating jobs for new
connections, recreating them when intervals change, cancelling them on
disconnect or polling-disable. It runs every 5 minutes from `initializeApp`,
once at server boot, and immediately from the NinjaOne connect/disconnect
flows, so settings changes take effect without operator intervention.
Handlers also re-check integration eligibility per run, making any schedule
that briefly outlives its integration a harmless no-op.
`TemporalJobRunner.scheduleRecurringJob` was upgraded to update an existing
schedule's spec instead of silently keeping the old one. Each cycle works
through the same normalized pipeline:

1. Fetch active alerts from the RMM (`NinjaOneClient.getAlerts()`; Tactical's
   alerts API) and upsert any the webhooks missed as `triggered` events, so
   rules, dedup, and tickets apply identically.
2. Synthesize `reset` events for local active alerts no longer active in the
   RMM, catching missed reset webhooks (the main source of stale tickets).
3. Process expired-window suppressed alerts that are still active.

Webhooks remain the primary low-latency path; polling is the backstop. Ingest
idempotency makes the overlap harmless.

One id-space caveat: NinjaOne webhooks carry activity ids while its alerts API
returns condition uids, so stale-alert detection only trusts poller-ingested
ids (marked in alert metadata) and never closes a webhook-created alert on the
poller's say-so. Per-device+condition dedup absorbs cross-source duplicates.
NinjaOne and TacticalRMM ship fetchers (Tactical's reuses the alerts endpoint
its manual backfill verified); Level has no list-alerts surface and stays
webhook-only.

## Rules CRUD and UI

Server actions in `packages/integrations` (alongside `tacticalRmmActions.ts`):
list, create, update, delete, reorder. Admin-gated, Zod-validated.

UI: an "Alert Rules" section inside the RMM integration settings, rendered
per-integration next to the existing org-mapping manager, shared by NinjaOne
and Tactical. A priority-ordered rules list with active toggles and reorder
controls. The rule editor dialog mirrors the two JSONB shapes: a Match group
(severity multi-select, activity types, alert classes, org picker fed from
`rmm_organization_mappings`, keywords, regex with save-time validation) and an
Actions group (create-ticket toggle, board picker, priority override, assignee,
title/description templates with placeholder hints, auto-resolve toggle,
reset-on-close toggle, notify-users picker).

The per-asset `AssetAlertsSection` remains the alert-viewing surface. Tickets
remain the primary work queue.

## Workflow v2 events and notifications

Register `RMM_ALERT_TRIGGERED` and `RMM_ALERT_RESOLVED` as native workflow v2
catalog events with a provider-generic payload (alert ID, external IDs,
severity, asset/client IDs, ticket ID if any). The pipeline publishes them,
replacing today's orphaned legacy-bus publishes. Add one generic workflow
action, `rmm.alerts.create_ticket`, which invokes the shared ticket creator by
alert ID.

Notifications ride the existing notification infrastructure: a new `rmm-alert`
category honoring per-user preferences (in-app + email), fired when a matched
rule has `notifyUserIds`.

## Error handling

- A rule that fails to evaluate (for example, a bad regex) is logged and
  skipped. It never aborts the pipeline.
- Webhook responses are unchanged: 200 for unmapped orgs, 200 on success, 500
  on unexpected errors so the RMM retries. Ingest is idempotent, so retries are
  safe.
- Outbound reset failures log, stamp the alert's `metadata`, and never block
  the ticket close.
- Two hardening items in adjacent code: implement the CSRF validation TODO in
  the NinjaOne OAuth callback (the state payload already carries `csrf` and
  `timestamp`), and remove the superseded `resetInNinjaOne` TODO in
  `alertProcessor.ts`'s `resolveAlert()`.

## Testing

80/20 split. An automated core targets the logic where permutations hide bugs
and regressions are expensive: the rule-evaluation matrix, dedup, the
untouched-ticket check, window matching (timezones, midnight-crossing
recurrence, scope combinations), idempotency (webhook replay, webhook+poller
overlap), lifecycle in both directions, tenant isolation and admin gating on
CRUD, and one end-to-end webhook→ticket integration test per direction. The
existing `alertProcessor` tests move to the new shared module.

Everything UI-, infra-, or delivery-shaped is a manual smoke pass instead:
settings screens, live NinjaOne/Tactical round-trips, Temporal schedule
lifecycle on connect/disconnect, email delivery, and migrations against a real
stack. The risk-driven checklist lives at
`docs/plans/2026-06-12-rmm-alert-handling/SMOKE_TESTS.md`.
