# PRD — RMM Alert Handling

- Slug: `2026-06-12-rmm-alert-handling`
- Date: 2026-06-12
- Status: Approved
- Branch: `feature/rmm-alerts-sync`
- Design doc: `docs/plans/2026-06-12-rmm-alert-handling-design.md`

## Summary

Turn RMM alerts into tickets automatically. A provider-generic pipeline in
`shared/rmm/alerts/` ingests normalized alert events from the NinjaOne and
TacticalRMM webhooks, evaluates tenant-defined rules, creates or updates
tickets with dedup, and keeps alert and ticket lifecycles in sync in both
directions. Tenants manage rules from the RMM integration settings UI.

## Problem

Alert ingestion is scaffolded but broken on main: the webhook writes columns
that don't exist in `rmm_alerts`, the rules engine expects a JSONB schema the
migration never created, and nothing connects alerts to tickets except a manual
button. There is no dedup, no auto-close, no outbound reset, and no rules UI.
Competing PSAs (ConnectWise, Autotask, Halo) treat all of this as table stakes.

## Goals

- Webhook-delivered alerts create tickets automatically per tenant-defined rules.
- Repeat firings of the same condition on the same device land on the existing
  open ticket instead of creating ticket storms.
- Alert resets close untouched tickets and annotate touched ones.
- Closing an alert-linked ticket resets the alert in the RMM (per-rule opt-out).
- Rules are manageable from the integration settings UI by admins.
- Alert events are first-class workflow v2 triggers; matched rules can notify users.
- Maintenance windows suppress alert ticketing for a client, asset, or
  integration during planned work, without losing the alerts.
- Scheduled polling reconciles missed webhooks: missed triggers become tickets,
  missed resets close stale tickets, and post-window still-active alerts get
  processed.
- One pipeline serves NinjaOne and TacticalRMM; a third provider only needs a
  normalizer and an optional outbound adapter.

## Non-goals

- RMM device-count billing integration, scheduled device sync, or org auto-matching.
- Per-rule dedup configuration (dedup behavior is fixed).
- Migrating NinjaOne device sync onto `sharedAssetIngestionService` (separate effort).

## Users and Primary Flows

- **MSP admin** configures alert rules per RMM integration: match conditions,
  ticket routing, lifecycle flags, notifications.
- **Dispatcher/tech** works alert tickets like any other ticket: sees occurrence
  comments on flapping conditions, sees resolution comments when alerts reset,
  and closing a ticket clears the alert in the RMM.
- **Automation builder** uses `RMM_ALERT_TRIGGERED`/`RMM_ALERT_RESOLVED`
  workflow triggers and the `rmm.alerts.create_ticket` action for custom flows.

## UX / UI Notes

- New "Alert Rules" section in RMM integration settings (next to the org-mapping
  manager), rendered for NinjaOne and TacticalRMM.
- Priority-ordered rules list: active toggle, reorder controls, edit/delete.
- Rule editor dialog with a Match group (severities, activity types, alert
  classes, source types, organization picker fed from
  `rmm_organization_mappings`, keywords, message regex) and an Actions group
  (create-ticket toggle, board picker, priority override, assignee,
  title/description templates with placeholder hints, auto-resolve toggle,
  reset-on-close toggle, notify-users picker).
- Save-time validation errors (e.g., bad regex) shown inline in the dialog.
- "Maintenance Windows" subsection beside Alert Rules: a list plus an editor
  with client/asset scope pickers and a one-off or weekly recurring schedule
  (with timezone).
- Alert polling enable/disable and interval (5–60 minutes) in integration
  settings.
- Existing per-asset `AssetAlertsSection` remains the alert-viewing surface.

## Requirements

### Functional Requirements

#### FR-1 Schema

One additive migration. `rmm_alerts` gains `activity_type`, `acknowledged_at`,
`acknowledged_by`, `dedup_key` (indexed with tenant + integration), `occurrence_count`
(default 1), `last_occurrence_at`, `matched_rule_id`, `auto_ticket_created`,
and `suppressed_by_window_id` (status gains a `suppressed` value).
Raw payloads standardize on the existing `metadata` jsonb. `rmm_alert_rules`
gains `conditions` and `actions` jsonb and drops the eleven flat filter/action
columns. New `rmm_maintenance_windows` table (FR-10). The deployed
`20251124000001` migration is not rewritten; no backfill.

#### FR-2 Contracts and normalizers

`shared/rmm/alerts/contracts.ts` defines `NormalizedRmmAlertEvent`
(kind: triggered | reset | acknowledged) and the optional per-provider
`RmmAlertOutboundAdapter` (`resetAlert`). Shared Zod schemas define the rule
`conditions`/`actions` shapes (see design doc for exact fields). NinjaOne and
TacticalRMM webhook routes map their payloads to the contract; existing webhook
auth, tenant resolution, and tier gating are unchanged.

#### FR-3 Ingest pipeline

`processRmmAlertEvent()` runs synchronously in the webhook request. Triggered:
upsert `rmm_alerts` on `(tenant, integration_id, external_alert_id)`, compute
and store `dedup_key` (device + condition identity; NinjaOne: `statusCode`
falling back to `activityType`), evaluate active rules first-match by
`priority_order` (empty conditions = catch-all; a rule that fails to evaluate
is logged and skipped), store `matched_rule_id`, then act. Replayed webhooks
are no-ops (idempotent ingest).

#### FR-4 Ticketing and dedup

If the matched rule creates tickets: an alert whose `dedup_key` matches an
alert with a still-open linked ticket joins that ticket (link, increment
`occurrence_count`, internal "re-triggered — Nth occurrence" comment).
Otherwise create a ticket honoring `boardId`, `priorityOverride` (else
severity→priority mapping), `assignToUserId`, and the title/description
templates with `{{device}}`/`{{message}}`/`{{severity}}`/`{{organization}}`
placeholders. Created tickets get source + source_reference, an asset
association, an initial internal comment, and client resolution from the asset
or the org mapping.

#### FR-5 Lifecycle

Reset marks the alert resolved. With a linked ticket and `autoResolveTicket`:
always comment; close (via `autoResolveStatusId`, else the tenant's first
is_closed status) only if the ticket is untouched — no human comments, no time
entries, no manual status change; rule auto-assignment doesn't count.
Acknowledged events stamp `acknowledged_at`/status. A ticket-closed event-bus
subscriber resets still-active linked alerts in the RMM via the provider's
outbound adapter when the matched rule's `resetAlertOnTicketClose` is true
(default). Outbound failures log and stamp alert `metadata`; they never block
the close. Providers without an adapter are skipped.

#### FR-6 Rules CRUD

List/create/update/delete/reorder server actions in `packages/integrations`,
admin-gated, Zod-validated, regex validated at save time.

#### FR-7 Rules UI

The settings section and editor described in UX notes, shared across providers.

#### FR-8 Workflow v2 and notifications

`RMM_ALERT_TRIGGERED` and `RMM_ALERT_RESOLVED` registered in the workflow v2
catalog with provider-generic payloads and published by the pipeline (replacing
the orphaned legacy-bus publishes). New `rmm.alerts.create_ticket` workflow
action invokes the shared ticket creator by alert ID. New `rmm-alert`
notification category delivers in-app + email to a matched rule's
`notifyUserIds`, honoring per-user preferences.

#### FR-9 Hardening and cleanup

Implement CSRF validation in the NinjaOne OAuth callback. Move
`ninjaone/alerts/*` logic into the shared module and remove the superseded
`resetInNinjaOne` TODO. Deprecate `rmm_organization_mappings.auto_create_tickets`
(no read paths remain).

#### FR-10 Maintenance windows

New `rmm_maintenance_windows` table: optional `integration_id`/`client_id`/
`asset_id` scopes (null = all of that dimension), one-off `starts_at`/`ends_at`
or weekly `recurrence` jsonb (days, time range, timezone), `name`, `is_active`.
The pipeline checks windows before rule matching: an alert matching all
non-null scopes of an active window at its `occurredAt` is stored with
`status = 'suppressed'` and `suppressed_by_window_id` — no ticket, no
notifications, no workflow events. A reset for a suppressed alert resolves it
quietly. Window CRUD server actions are admin-gated and Zod-validated, with the
settings UI described in UX notes.

#### FR-11 Alert polling (reconciliation)

A per-integration Temporal scheduled workflow (Entra per-tenant schedule
pattern), default on for connected integrations, every 15 minutes (configurable
5–60), created on connect and removed on disconnect. Each cycle, through the
same pipeline: (1) upsert RMM-active alerts missing locally as `triggered`
events; (2) synthesize `reset` events for local active alerts no longer active
in the RMM; (3) process still-active suppressed alerts whose window ended
through the normal rules path. Webhooks stay primary; ingest idempotency makes
overlap harmless.

### Non-functional Requirements

- Webhook ingest path makes no external API calls; webhook latency stays
  bounded. RMM API calls happen only in the poller and the ticket-close
  subscriber, both off the request path.
- All queries tenant-scoped (CitusDB composite keys: `tenant` + entity id).
- Webhook response semantics preserved: 200 unmapped org, 200 success, 500
  unexpected error (RMM retries; ingest idempotency makes this safe).

## Data / API / Integrations

See FR-1 for schema and the design doc for exact JSONB shapes. External APIs:
`NinjaOneClient.resetAlert()` (exists); TacticalRMM alert resolution if its API
supports it (open question in SCRATCHPAD — adapter is optional by design).

## Security / Permissions

- Rule CRUD requires admin permission; all actions tenant-scoped.
- Webhook auth unchanged (HMAC signature / shared-secret header).
- OAuth callback CSRF validation (FR-9).

## Observability

Pipeline logs rule-evaluation skips and outbound reset failures. No new
metrics/monitoring infrastructure.

## Rollout / Migration

Single additive migration; deployed tables hold negligible data, so no
backfill. No feature flag: with zero rules configured, the pipeline stores
alerts without creating tickets, which matches today's effective behavior.

## Open Questions

Tracked in `SCRATCHPAD.md` (Tactical outbound capability; exact ticket-closed
event name).

## Acceptance Criteria (Definition of Done)

- A NinjaOne CONDITION TRIGGERED webhook for a mapped org creates an
  `rmm_alerts` row and, when a rule matches, a correctly-routed ticket.
- The same condition re-firing while that ticket is open adds an occurrence
  comment and creates no new ticket; after the ticket closes, a new firing
  creates a new ticket.
- CONDITION RESET resolves the alert, comments the ticket, and closes it only
  if untouched.
- Closing an alert-linked ticket resets the alert in NinjaOne unless the rule
  opted out.
- A TacticalRMM alert webhook flows through the same pipeline end to end.
- Admins manage rules entirely from the settings UI; invalid rules are rejected
  at save time.
- Alert workflows can trigger on `RMM_ALERT_TRIGGERED`/`RMM_ALERT_RESOLVED`
  and call `rmm.alerts.create_ticket`.
- Matched rules with `notifyUserIds` produce in-app and email notifications per
  user preference.
- An alert firing inside a matching maintenance window creates no ticket and no
  notifications; the same alert outside the window processes normally; a
  condition still firing after its window ends becomes a ticket via the poller.
- With webhooks disabled, a poll cycle turns RMM-active alerts into tickets per
  the rules and closes stale tickets whose alerts cleared in the RMM.
- All features in `features.json` implemented; the automated core in
  `tests.json` passes; the `SMOKE_TESTS.md` checklist has been executed against
  a live stack.
