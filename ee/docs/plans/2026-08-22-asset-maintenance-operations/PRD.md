# PRD — Asset-driven maintenance operations

Status: approved (design session 2026-08-22; UI direction = "Option C2" Command Center + calendar toggle)
Branch: `feature/build-asset-driven-maintenance-operations`

## Problem statement

Alga PSA stores per-asset maintenance schedules (recurrence, next/last dates, history, notification rows) and shows schedule CRUD on the asset detail Maintenance tab, but there is no operational workflow: `/msp/assets/maintenance` is a placeholder, no cross-asset due/overdue queue exists, desktop cannot complete maintenance, "compliance" is a history-count proxy, and notification rows are written but never delivered. The data is metadata, not operations.

## User value

- **Service coordinator** sees all due/overdue maintenance across clients, prioritizes it, and turns each item into exactly one accountable ticket.
- **Technician** sees what is due from a ticket or asset, performs it, records the outcome (desktop or mobile), and the next due date advances by a documented rule.
- **Service manager** sees overdue risk, upcoming workload, and a defensible compliance rate.

## Goals

1. Replace the `/msp/assets/maintenance` placeholder with a production global Maintenance workspace (due/overdue default view, upcoming, plans, history) with tenant-safe filters and deep links.
2. Introduce an auditable **occurrence** model so ticket idempotency, completion, and skip/cancel have a durable record.
3. Ticket-backed execution: create-or-open exactly one open ticket per occurrence via existing `QuickAddTicket`/`asset_associations` patterns.
4. Desktop completion (from workspace and asset detail) that is atomic, double-completion-safe, and advances next due from the actual completion date; mobile stays compatible.
5. Plan lifecycle: pause/reactivate, archival delete (preserve history), explicit skip with reason.
6. Honest aggregates: due now, overdue, upcoming, and compliance defined as on-time completions ÷ occurrences due in period (no history ⇒ not compliant).

## Non-goals

- Field-service dispatch/route optimization; work-order/billing/contract engines; auto-ticket generation by default; predictive maintenance; portal write actions; replacing asset service-history concepts.

## Personas & primary flows

1. Coordinator: workspace → filter due/overdue → Create ticket (or open existing) → assign.
2. Technician: ticket or asset → see due occurrence → Complete with notes (+ optional checklist data) → next due advances.
3. Manager: workspace KPIs + history; compliance and workload by client/type.

## UX/UI

Direction (chosen from interactive mockup review): **Command Center backbone with a calendar view toggle** ("Option C2").
- KPI band (overdue / due today / upcoming 7d / open maintenance tickets / compliance) above a Work queue | Plans | History tab row.
- Work queue = master-detail split. Left pane has a **List | Calendar** toggle: List = worklist grouped by client, severity-edged rows, overdue-first sort; Calendar = month grid with colored occurrence chips and month navigation. Search and status/client/type/assignee filters sit above the toggle and apply to both views.
- Selecting an occurrence from either view renders the same right-hand detail pane: status, asset/client links, meta grid with inline assignee reassignment, lightweight execution checklist, ticket section, occurrence timeline, and a sticky Complete / Skip / Pause action bar. Completion runs in a right drawer with a live next-due preview.
- KPI tiles click-filter the list view.
(Earlier alternatives considered: A "Operations Queue" tabbed DataTable, B "Schedule Board" calendar-first — merged into the above.)

Whichever is chosen, shared elements: SummaryTile KPI strip, toolbar filters (status, client, type, assignee, date range, search) in the existing DropdownMenu-checkbox idiom, right drawer for completion, `withDataAutomationId` on all interactive elements, i18n via `msp/assets` namespace, deep links to asset (`/msp/assets/[id]`) and ticket drawer.

Asset detail Maintenance tab gains: Complete action per schedule, ticket chip, resolved performer names in history, pause toggle.

## Data model

New table `asset_maintenance_occurrences` (tenant-distributed, RLS, composite PK (tenant, occurrence_id)):
- occurrence_id, schedule_id, asset_id, due_date, status enum: `open | completed | skipped | cancelled`, ticket_id nullable, completed_history_id nullable, skip_reason nullable, created_at/updated_at, closed_at, closed_by.
- Invariant: **at most one `open` occurrence per schedule** (partial unique index on (tenant, schedule_id) where status='open'); ticket linkage lives on the occurrence (plus `asset_associations` row for the asset↔ticket join used by existing UI).
- Backfill migration: create one open occurrence per active schedule from its `next_maintenance`. Schedule mutation keeps its open occurrence's due_date in sync.
- Completion writes history row + closes occurrence + advances schedule.next_maintenance + opens the next occurrence, in one transaction.
- Plan delete becomes archive (`is_active=false` + `archived_at` column) when history exists; hard delete allowed only when no history.

## API / integration

- Extend `packages/assets` actions: `listMaintenanceOccurrences` (tenant-wide, filterable, paginated), `createOccurrenceTicket` (idempotent create-or-return), `completeOccurrence`, `skipOccurrence`, `setSchedulePaused`, aggregates action for KPIs. All `withAuth` + asset-level authorization + tenant scoping.
- Preserve existing REST endpoints; route mobile `record` path through the same occurrence-aware completion so double-completion is rejected everywhere.
- Ticket creation via `AssetCrossFeatureContext` (`renderQuickAddTicket` prefilled with client/asset + maintenance context in description; occurrence tagged via attributes) — no direct tickets dependency from @alga-psa/assets.
- Notifications v1: in-app due/overdue signals computed live from occurrences (badge counts in workspace). The `asset_maintenance_notifications` delivery job is **out of MVP**; rows keep being written, and the design documents recipient/window/dedupe rules for the follow-up phase.

## Authorization matrix

| Action | Permission |
|---|---|
| View workspace/occurrences/history | asset:read (per-asset authorized context) |
| Create/edit/pause plan, complete, skip | asset:update |
| Archive/delete plan | asset:delete |
| Create/open occurrence ticket | asset:update + ticket:create/read |
| Client Portal | read-only maintenance history/upcoming summary — **deferred, out of MVP** |

Cross-tenant/cross-asset schedule use rejected server-side in every mutation.

## Open decisions (resolve at design review)

- Ticket closure does **not** auto-complete maintenance in v1; only explicit Complete does (ticket state shown on the occurrence). Confirm.
- `custom` frequency: keep excluded from authoring UI; fix silent fall-through to daily by rejecting it in completion until designed.
- Checklist: v1 stores free-form `maintenance_data` from a lightweight checklist UI; template references deferred.

## Risks & rollout

- Citus/tenant isolation: new table follows existing distributed-table + RLS + composite-PK patterns; CHECK/backfill migrations use NOT VALID + VALIDATE.
- Backfill correctness on tenants with stale `next_maintenance`: backfill trusts stored dates; overdue is simply due_date < now.
- Mobile compatibility: keep `record` endpoint contract, adding occurrence semantics beneath it.
- Phases: **P1** occurrence model + workspace + ticket + completion (MVP). **P2** notification delivery job + configuration. **P3** portal read + expanded reporting.

## Acceptance criteria (MVP)

Per card: workspace lists all tenant-scoped due/overdue with filters and deep links; create-or-open exactly one open ticket per occurrence (repeat clicks never duplicate); desktop + mobile completion writes one history record, keeps ticket linkage, advances next due per documented rule; paused plans neither actionable nor generating work; unauthorized/cross-tenant mutations fail safely; aggregates agree with occurrences and never call "no history" compliant; the route is production UI; automated tests cover recurrence, authorization, idempotency, completion atomicity, duplicate prevention; smoke evidence covers queue → ticket → complete → updated history/next-due.
