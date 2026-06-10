# Ticket Close Rules — Design

- **Status:** Approved design
- **Created:** 2026-06-10
- **Branch:** `feature/ticket-close-rules`

## 1. Problem statement

Today nothing governs how a ticket gets closed. Any status update that lands on
a status with `is_closed = true` closes the ticket — no required resolution,
no time-entry check, no completion checklist — and abandoned tickets sit in
"Waiting for Customer" forever unless a human remembers them. The only
closure-adjacent checks in the codebase are idempotency guards in the workflow
`tickets.close` action (`shared/workflow/runtime/actions/businessOperations/tickets.ts`)
and a config constraint that a closed status cannot be a board default
(`packages/reference-data/src/actions/status-actions/statusActions.ts`).

This feature adds three capabilities, all configured per board:

1. **Pre-close validation gates** — conditions a ticket must satisfy before a
   human can move it to a closed status, with a permissioned override.
2. **Ticket checklists** — first-class checklist items on tickets (ad-hoc,
   template-applied, rule-applied, or workflow-applied), where checking an item
   permanently records and displays who checked it and when. Required-item
   completion is one of the close gates.
3. **Auto-close rules** — tickets sitting in a configured status with no
   activity for N days close automatically, with an optional warning
   notification beforehand.

## 2. Decisions (with rationale)

| Decision | Choice |
|---|---|
| Rule scope | Per board, matching how statuses, SLAs, and email settings are board-scoped |
| Gate behavior | Hard block with a permissioned override (`ticket.close_override`); overrides audit-logged with the failure list |
| Gate types (v1) | Resolution comment, ≥1 time entry, required checklist items complete, no open bundled children, admin-chosen required fields |
| Enforcement coverage | All human paths: MSP UI single + bulk, REST API. Exempt: workflow `tickets.close`, CSV import, auto-close engine, **and the client portal** (customers cannot satisfy internal-hygiene gates like time entry; blocking them dead-ends the conversation). Exempt closures are audit-logged as bypasses |
| Checklist accountability | `completed_by` + `completed_at` stored permanently and displayed inline (name + timestamp); check/uncheck written to the ticket audit log. No confirmation friction at click time |
| Checklist sources | Ad-hoc per ticket, reusable admin templates, auto-apply matchers (board/category/subcategory/priority), and a workflow action |
| Auto-close model | Status + inactivity timer per board, optional warning M days before close |
| Auto-close engine | Single recurring scan job (15 min) via the `IJobRunner` abstraction (`server/src/lib/jobs/JobRunnerFactory.ts`) — Temporal on EE/appliance/on-prem, pg-boss otherwise. A per-ticket Temporal workflow was considered and rejected: CE would still need the scan (two implementations), inactivity resets would require signal plumbing across every comment/reply path (the SLA Temporal workflow already needed a self-healing poll for exactly this drift), and config changes would invalidate in-flight timers. Day-granularity timers gain nothing from event-driven precision. `ticket_auto_close_state` is engine-agnostic, so the engine can be swapped later without a data-model change |

## 3. Data model

All tables tenant-scoped with composite `(tenant, id)` primary keys per the
Citus conventions (`server/migrations/20250804000001_fix_primary_keys_for_citus.cjs`).

**`board_close_rules`** — one row per board: `require_resolution_comment`,
`require_time_entry`, `require_checklist_complete`,
`require_no_open_children` (booleans), `required_fields` (jsonb array from an
allowed set: category, subcategory, priority, assignee, …), `is_enabled`.
A fixed v1 gate set means toggles, not a generic rule-row model.

**`ticket_checklist_items`** — live checklist on a ticket: `item_name`,
`description`, `order_number`, `assigned_to`, `is_required` (default true; only
required items gate closure), `completed`, `completed_by`, `completed_at`,
provenance (`source`: `manual` | `template` | `workflow`; nullable
`template_id`). Modeled after `task_checklist_items`
(`server/migrations/20241009225600_create_task_checklist_items.cjs`) plus the
accountability and provenance fields that table lacks.

**`checklist_templates`** / **`checklist_template_items`** — admin-defined
templates; items carry name/description/order/`is_required`. Items are
**copied** onto tickets, never referenced, so later template edits do not
mutate history.

**`checklist_template_apply_rules`** — `template_id` + nullable `board_id` /
`category_id` / `subcategory_id` / `priority_id` (null = match any). Evaluated
on ticket creation and on board/category change; application is additive and
idempotent — a template never applies twice to the same ticket.

**`board_auto_close_rules`** — multiple rows per board: `trigger_status_id`,
`inactivity_days`, nullable `warning_days_before`, `close_to_status_id` (must
be an `is_closed` status), `is_enabled`.

**`ticket_auto_close_state`** — engine scratchpad per ticket: matched
`rule_id`, `scheduled_close_at`, `warning_sent_at`. Recomputed/cleared whenever
activity resets the timer; prevents duplicate warnings and drives the
"will auto-close on …" banner.

**Permission:** `ticket.close_override` added to the RBAC seeds, granted to
Admin by default.

## 4. Enforcement flow

A single shared function in `packages/tickets`:

```ts
validateTicketClosure(trx, tenant, ticketId, user, options)
  → { allowed, failures: [{ rule, message, meta }], overridden? }
```

It loads the board's `board_close_rules` row and evaluates each enabled gate
inside the caller's transaction. Gate checks are cheap queries: resolution
comment → a comment tagged as resolution exists; time entry → any
`time_entries` row for the ticket; checklist → no incomplete `is_required`
items; open children → no open tickets bundled under this master; required
fields → null checks on the ticket row.

**Call sites** are the four places that already detect the open→closed status
flip:

- `updateTicket` — `packages/tickets/src/actions/ticketActions.ts`
- `updateTicketInTransaction` — `packages/tickets/src/actions/optimizedTicketActions.ts`
  (covers board view, bulk actions, move-to-board, TicketDetails)
- `TicketService.update` — `server/src/lib/api/services/TicketService.ts` (REST v1, mobile)
- client portal `updateTicketStatus` —
  `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`
  (exempt from gates, but instrumented for the closure-recording fix below)

On failure the chokepoint throws a typed `TicketCloseValidationError` carrying
the failures array — rendered as a blocked-close dialog in the UI and a 422
with structured details from the API. Bulk close validates per ticket and
reports per-ticket results instead of failing the batch.

**Override:** a request with `overrideCloseRules: true` is honored only when
the server confirms `ticket.close_override`; the override and its failure list
are written to `ticket_audit_logs` as `TICKET_CLOSE_RULES_OVERRIDDEN`.

**Exemptions** (workflow `tickets.close`, CSV import, auto-close engine,
client portal) pass a system bypass flag and are audit-logged as bypassed.

**Portal closure-recording fix (in scope):** the portal status-update path
currently neither sets `is_closed` / `closed_at` / `closed_by` nor publishes
`TICKET_CLOSED`. As part of wiring the chokepoint through it, it gains the same
closure side effects as every other path.

## 5. Auto-close engine

One recurring job, `auto-close-tickets`, every 15 minutes, registered through
`IJobRunner.scheduleRecurringJob`. Each run, per tenant:

1. **Match.** Find open tickets whose current status has an enabled
   `board_auto_close_rules` row. Compute `last_activity_at` (latest of
   comments, status changes, customer replies) and
   `scheduled_close_at = last_activity_at + inactivity_days`. Upsert
   `ticket_auto_close_state`; newer activity recomputes the row, resetting the
   timer and cancelling any pending warning/close.
2. **Warn.** Where `warning_days_before` is set and
   `now ≥ scheduled_close_at − warning`, send the new
   `ticket-auto-close-warning` notification template to the ticket contact
   (respecting tenant notification settings) and stamp `warning_sent_at`.
3. **Close.** Where `now ≥ scheduled_close_at`, close via
   `updateTicketInTransaction` with a system actor, the bypass flag, and an
   automatic comment ("Closed automatically after N days of inactivity").
   Riding the normal path means `TICKET_CLOSED`, closure emails, SLA resolution
   recording, surveys, webhooks, and search reindexing all fire exactly as a
   manual close would.

The close step re-validates inactivity inside the closing transaction, so
activity racing the scan cannot cause a wrongful close, and re-runs are
idempotent. The job is per-tenant, per-ticket try/catch — one bad ticket never
stalls the sweep.

## 6. UI surfaces

- **Board settings → Close Rules:** gate toggles, required-fields
  multi-select, and the board's auto-close rules list (trigger status,
  inactivity days, warning lead time, target closed status).
- **Settings → Checklist Templates:** template CRUD, drag-ordered items with
  per-item `is_required`, and each template's auto-apply matchers.
- **Ticket details — Checklist section:** checkboxes, inline add, "Apply
  template" picker. A checked item permanently shows the checker's avatar/name
  and timestamp inline. A progress chip ("3 of 5 required done") sits near the
  status control. Unchecking is allowed but clears who/when and writes an
  audit entry recording the uncheck and the prior signoff.
- **Blocked-close dialog:** lists each unmet condition with a quick action
  (jump to checklist, add time, …). Holders of `ticket.close_override` get
  "Close anyway" with an optional reason.
- **Auto-close banner:** "Will close automatically on <date> unless there's
  new activity", driven by `ticket_auto_close_state`.

## 7. Workflow integration

- New workflow action: apply a checklist template to a ticket.
- The existing `tickets.close` action keeps its bypass but logs it.

## 8. Testing

- **Unit:** each gate in `validateTicketClosure` (pass/fail/override paths).
- **Integration** (repo integration-test patterns): blocked/allowed/override
  closes across all four entry paths; accountability field writes on
  check/uncheck; template auto-apply on create and on board/category change;
  scan match/warn/close behavior with synthetic timestamps; portal
  closure-recording fix publishes `TICKET_CLOSED`.
- **Playwright:** blocked-close dialog flow; checklist who/when display;
  board settings and template settings CRUD.
