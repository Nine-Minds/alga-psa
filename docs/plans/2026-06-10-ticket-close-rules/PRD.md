# PRD: Ticket Close Rules

- **Status:** Draft (scope approved via design review)
- **Owner:** Robert Isaacs
- **Created:** 2026-06-10
- **Design doc:** `docs/plans/2026-06-10-ticket-close-rules-design.md`
- **Branch:** `feature/ticket-close-rules`

## 1. Problem statement & user value

Nothing governs how a ticket gets closed today. Any status update landing on a
status with `is_closed = true` closes the ticket — no required resolution, no
time-entry check, no completion checklist — and tickets abandoned in "Waiting
for Customer" sit open forever unless a human remembers them. MSPs lose billing
(closed tickets with no time logged), lose accountability (no record of who
verified completion steps), and carry stale open-ticket noise.

This feature gives boards three new capabilities:

1. **Pre-close validation gates** — per-board conditions a ticket must satisfy
   before a human can close it, hard-blocked with a permissioned override.
2. **Ticket checklists** — first-class checklist items on tickets (ad-hoc,
   template, auto-applied, or workflow-applied) where checking an item
   permanently records and conspicuously displays who checked it and when.
   Required-item completion is one of the close gates.
3. **Auto-close rules** — tickets sitting in a configured status with no
   activity for N days close automatically, with an optional advance warning
   to the customer.

## 2. Goals

- Per-board close gates: resolution comment, ≥1 time entry, required checklist
  items complete, no open bundled children, admin-chosen required fields.
- Hard block with structured failure reporting in UI (dialog) and API (422);
  override via new `ticket:close_override` permission, audit-logged.
- Checklists with permanent `completed_by`/`completed_at` accountability,
  template management UI, auto-apply matchers, and a workflow action.
- Auto-close via a single recurring scan job on the existing `IJobRunner`
  abstraction (Temporal on EE/appliance/on-prem, pg-boss otherwise).
- Auto-close rides the normal close path so emails, SLA recording, surveys,
  webhooks, and search reindexing fire exactly as for a manual close.
- Fix the client portal closure-recording gap (`is_closed`/`closed_at`/
  `closed_by` + `TICKET_CLOSED` publication) as part of wiring.

## 3. Non-goals

- No reopen rules (who may reopen, reopen windows) — future work.
- No per-rule block-vs-warn configuration; all enabled gates hard-block.
- No attestation ceremony (typed initials/notes) on checklist check-off.
- No generic transition-policy engine; gates are ticket-closure-specific.
- No per-ticket Temporal workflow engine for auto-close (see design §2 for the
  rejection rationale); the scan is the single engine for all editions.
- No REST API endpoints for checklist CRUD in v1 (UI uses server actions);
  the API surface is limited to close-validation behavior on existing
  ticket update endpoints.
- No backfill of accountability fields onto project task checklists.
- Client portal users are **exempt** from close gates (they cannot satisfy
  internal-hygiene conditions); portal closures are audit-logged as such.

## 4. Users & primary flows

- **Technician:** sees a checklist on the ticket with a progress chip near the
  status control; checks items (name + timestamp recorded inline); attempts to
  close; if gates fail, a dialog lists each unmet condition with a quick
  action (jump to checklist, add time).
- **Dispatcher/Manager (with `ticket:close_override`):** same dialog plus
  "Close anyway" with optional reason; override and failure list land in the
  ticket audit log.
- **Admin:** configures gates and auto-close rules per board in board
  settings; manages checklist templates and their auto-apply matchers in a
  new Ticketing settings tab.
- **Customer (portal):** can still close/resolve their own tickets unimpeded;
  receives an optional warning email before auto-close; replying resets the
  inactivity timer and cancels the pending close.
- **Automation:** workflows can apply a checklist template to a ticket;
  workflow `tickets.close`, CSV import, and the auto-close engine bypass
  gates with the bypass audit-logged.

## 5. Functional requirements

### 5.1 Close validation gates

- One `board_close_rules` row per board: `require_resolution_comment`,
  `require_time_entry`, `require_checklist_complete`,
  `require_no_open_children`, `required_fields` (jsonb array from the allowed
  set: category, subcategory, priority, assignee), `is_enabled`.
- Shared chokepoint `validateTicketClosure(trx, tenant, ticketId, user, opts)`
  in `packages/tickets`, evaluated inside the caller's transaction at the
  exact open→closed flip detection points in: `updateTicket`
  (`ticketActions.ts`), `updateTicketInTransaction`
  (`optimizedTicketActions.ts`), `TicketService.update` (REST v1).
- Gate queries: resolution comment → `comments.is_resolution = true` or
  `metadata->>'closes_ticket' = 'true'`; time entry → any `time_entries` row
  with `work_item_id = ticket_id AND work_item_type = 'ticket'`; checklist →
  no incomplete `is_required` items in `ticket_checklist_items`; children →
  no `tickets` rows with `master_ticket_id = ticket_id AND closed_at IS NULL`;
  required fields → null checks on the ticket row.
- Failure → typed `TicketCloseValidationError` with
  `failures: [{ rule, message, meta }]`; UI renders the blocked-close dialog,
  API returns 422 with structured details via the existing `ValidationError`
  pattern.
- `overrideCloseRules: true` honored only when the server confirms
  `ticket:close_override`; writes `TICKET_CLOSE_RULES_OVERRIDDEN` (with the
  failure list and optional reason) to `ticket_audit_logs`.
- Bulk close validates per ticket and reports per-ticket results.
- Bypass flag for workflow `tickets.close`, CSV import, auto-close engine,
  and client portal; bypassed closures audit-logged.

### 5.2 Ticket checklists

- `ticket_checklist_items`: name, description, order, assignee, `is_required`
  (default true), `completed`, `completed_by`, `completed_at`, provenance
  (`source`: manual | template | workflow; nullable `template_id`).
- Check sets `completed_by`/`completed_at` permanently displayed inline;
  uncheck clears them and writes an audit entry recording the prior signoff.
- Templates (`checklist_templates` + `checklist_template_items`) are copied
  onto tickets, never referenced; later template edits do not mutate history.
- Auto-apply matchers (`checklist_template_apply_rules`): nullable board /
  category / subcategory / priority (null = any), evaluated on ticket
  creation and on board/category change; additive and idempotent (a template
  never applies twice to one ticket).
- New workflow action `tickets.apply_checklist` registered in
  `registerTicketActions()` (`shared/workflow/runtime/actions/businessOperations/tickets.ts`).

### 5.3 Auto-close rules

- `board_auto_close_rules` (multiple per board): `trigger_status_id`,
  `inactivity_days`, nullable `warning_days_before`, `close_to_status_id`
  (must be `is_closed`), `is_enabled`.
- Recurring job `auto-close-tickets` every 15 minutes via
  `IJobRunner.scheduleRecurringJob`, registered in `registerAllHandlers.ts` /
  `initializeScheduledJobs.ts` following the `reconcile-bucket-usage` model.
- Per run: (1) match eligible tickets, compute `last_activity_at` (latest of
  comments, status changes, customer replies) and upsert
  `ticket_auto_close_state` (`rule_id`, `scheduled_close_at`,
  `warning_sent_at`) — newer activity recomputes and resets; (2) send
  `ticket-auto-close-warning` notification when inside the warning window,
  stamp `warning_sent_at`; (3) close due tickets via
  `updateTicketInTransaction` with system actor, bypass flag, and an
  automatic comment, re-validating inactivity inside the closing transaction.
- Per-tenant, per-ticket try/catch; idempotent re-runs.
- `closed_by` is null for auto-closed tickets; audit entry uses
  `actor_type: 'system'`, `source: 'system'`.

## 6. Data model

Six new tables (all tenant-scoped, composite `(tenant, id)` PKs per Citus
conventions, with RLS policies): `board_close_rules`,
`ticket_checklist_items`, `checklist_templates`, `checklist_template_items`,
`checklist_template_apply_rules`, `board_auto_close_rules`,
`ticket_auto_close_state`. Full column detail in design doc §3.

New permission row: resource `ticket`, action `close_override`, granted to
Admin by default. New notification subtype + system email template
`ticket-auto-close-warning`.

## 7. UI / UX notes

- **Board settings (`BoardsSettings.tsx` dialog):** "Close Rules" bordered
  section (following the inbound-reply-reopen section pattern) with gate
  toggles + required-fields multi-select; "Auto-Close Rules" list editor
  (trigger status, inactivity days, warning lead, target closed status).
- **Ticketing settings:** new `checklist-templates` sub-tab in
  `TicketingSettings.tsx` (`TICKETING_TAB_IDS`) hosting
  `ChecklistTemplatesSettings` — template CRUD, item ordering via the
  existing up/down button pattern, per-item `is_required`, apply-rule
  matchers editor.
- **Ticket details:** new `TicketChecklistSection.tsx` composed into
  `TicketDetails.tsx` like sibling sections; checked items show checker
  avatar/name + timestamp inline; progress chip ("3 of 5 required done")
  near the status control; blocked-close dialog with per-failure quick
  actions and permissioned "Close anyway".
- **Auto-close banner** on tickets with pending `ticket_auto_close_state`:
  "Will close automatically on <date> unless there's new activity."
- Checklist activity (check/uncheck, template applied, auto-close warning/
  close) renders in `TicketActivityTimeline.tsx`.

## 8. Security / permissions

- Gate override requires `ticket:close_override` (checked server-side via
  `hasPermission(user, 'ticket', 'close_override')`).
- Template management rides existing settings-admin permission; checking
  items requires ordinary ticket update permission.
- Portal exemption is server-enforced by path, not client-asserted.

## 9. Rollout / migration

- All new tables and the permission ship in standard knex migrations; no
  backfill required. Boards without a `board_close_rules` row (or with
  `is_enabled = false`) behave exactly as today.
- Auto-close affects only boards where an admin creates an enabled rule.

## 10. Open questions

- Required-fields allowed set: start with category, subcategory, priority,
  assignee — extend later if asked.
- Whether checklist REST endpoints are needed for the mobile app (deferred,
  see non-goals).

## 11. Acceptance criteria (definition of done)

- A board with all gates enabled blocks closure from MSP UI (single + bulk)
  and REST API when any gate fails, listing every unmet condition; closure
  succeeds once conditions are met.
- A user with `ticket:close_override` can close anyway; the override with
  failure list appears in the ticket audit log. A user without it cannot.
- Checking a checklist item records and displays who/when; unchecking clears
  it and leaves an audit trail. Required items gate closure; optional don't.
- Applying a template copies its items once (idempotent); auto-apply rules
  attach templates on creation and board/category change.
- A ticket in a rule's trigger status with no activity for `inactivity_days`
  is closed by the scan with a system comment, and all normal closure side
  effects fire (email, SLA resolution, surveys, webhooks). A customer reply
  before the deadline cancels the pending close; the warning email goes out
  once at the configured lead time.
- Portal status changes to a closed status set `is_closed`/`closed_at`/
  `closed_by` and publish `TICKET_CLOSED`, without gate enforcement.
- All features in `features.json` implemented; all tests in `tests.json`
  passing; the manual smoke pass in `SMOKE_TESTS.md` executed clean against
  the running app.
