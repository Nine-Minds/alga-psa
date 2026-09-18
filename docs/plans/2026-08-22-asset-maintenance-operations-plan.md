# Asset-driven maintenance operations — implementation plan

Approved in the design session on 2026-08-22. The full product plan (PRD, feature checklist, test checklist, scratchpad) lives at `ee/docs/plans/2026-08-22-asset-maintenance-operations/` — that folder is the scope authority; this document is the staged technical plan the card requires.

## 1. UX wireflow (decided: "Option C2" — Command Center + calendar toggle)

Route `/msp/assets/maintenance` (replacing the FeaturePlaceholder) renders:

- **KPI band**: Overdue, Due today, Upcoming 7d, Open maintenance tickets, Compliance 90d — from a single aggregates action. Tiles click-filter the work queue.
- **Tabs**: Work queue (default) | Plans | History.
- **Work queue**: master-detail split.
  - Left pane (~44%): search + multi-select filter chips (status, client, type, assignee; due-date range), then a **List | Calendar** toggle.
    - List: occurrences grouped by client (collapsible headers, worst-status dot), severity-edged rows, overdue-first sort, due date + "Nd overdue" subtext, assignee initials, ticket chip.
    - Calendar: month grid with colored occurrence chips (red overdue / amber today / blue upcoming / green completed), month navigation, today outline. Filters apply to both views.
  - Right pane: occurrence detail — status pill, asset/client deep links, meta grid (type, cadence, next due, last done, inline assignee reassignment), lightweight execution checklist (stored in `maintenance_data`), ticket section (idempotent create-or-open), occurrence timeline, sticky **Complete / Skip / Pause** action bar. Selection from either left view lands here.
- **Completion drawer** (right slide-in, also reachable from the asset detail Maintenance tab): performed date (default today), notes, checklist state, live "next due advances to <date>" preview anchored on the performed date.
- **Plans tab**: all schedules with active toggles (pause/reactivate), edit via existing dialog, archive.
- **History tab**: completions and skips, performer names resolved, linked ticket, deep links.
- Coordinator path: KPI → filtered queue → create/open ticket → assign. Technician path: asset tab or ticket → occurrence → Complete. Manager path: KPI band + History/compliance.

Reference prototypes (not committed): `/tmp/maintenance-option-{a,b,c,c2}.html`; c2 is the chosen design.

## 2. State model

New table **`asset_maintenance_occurrences`** (tenant-distributed like siblings, RLS, PK `(tenant, occurrence_id)`):

| column | notes |
|---|---|
| occurrence_id uuid | gen_random_uuid |
| schedule_id, asset_id | FKs to schedule/asset within tenant |
| due_date timestamptz | synced from schedule.next_maintenance while open |
| status | `open \| completed \| skipped \| cancelled` |
| ticket_id uuid null | the single ticket for this occurrence |
| history_id uuid null | set on completion |
| skip_reason text null | set on skip |
| closed_at, closed_by | audit |
| created_at, updated_at | |

- **Invariant**: partial unique index on `(tenant, schedule_id) WHERE status = 'open'` — at most one open occurrence per schedule. This is what makes ticket idempotency and double-completion prevention auditable; a schedule row alone cannot provide it (decided per card).
- Lifecycle: schedule active ⇒ exactly one open occurrence. Complete → close as `completed` + write history + advance `next_maintenance` from the actual completion date (documented rule, shown in UI) + open next occurrence — one transaction. Skip → close as `skipped` with reason, advance, open next (no history completion record). Pause → cancel open occurrence; reactivate → recreate. Schedule `next_maintenance` edits update the open occurrence's `due_date`.
- Ticket linkage: `occurrence.ticket_id` plus an `asset_associations` row (existing pattern) so current asset↔ticket UI keeps working. Ticket closure does **not** auto-complete maintenance in v1; ticket state is displayed on the occurrence.
- Plan deletion becomes archival (`is_active=false` + new `archived_at`) whenever history exists; hard delete only when no history.
- Notification delivery: `asset_maintenance_notifications` rows continue to be written; the delivery job is phase 2 (recipient rules, notice windows, dedupe, retry/audit to be specced there). v1 ships in-app due/overdue signals computed live from occurrences and makes no email/Teams claims.

## 3. Schema migrations (Citus-safe)

1. Create `asset_maintenance_occurrences` following the existing distributed-table pattern (composite tenant PK, `create_distributed_table` on tenant where applicable, RLS tenant policy, indexes on `(tenant, due_date)`, `(tenant, status)`, `(tenant, schedule_id)`).
2. Partial unique open-per-schedule index.
3. `ALTER TABLE asset_maintenance_schedules ADD COLUMN archived_at timestamptz` (nullable — no rewrite).
4. Backfill: one `open` occurrence per active schedule from `next_maintenance` (idempotent, batched by tenant).
Constraint additions, if any, use the `NOT VALID` + `VALIDATE` pattern proven in `20260728100000_allow_corrective_maintenance_type.cjs`. Existing history and published REST contracts are preserved.

## 4. Ticket integration & idempotency

`createOccurrenceTicket(occurrence_id, overrides?)`:
- In a transaction: lock/reread the occurrence; if `status='open'` and `ticket_id` set and that ticket is not closed → return it ("open existing"). If the linked ticket is closed, or none linked → create a ticket (via existing ticket creation server logic reached through the cross-feature boundary) carrying client, asset link, plan/schedule + occurrence reference, due date, description/checklist context, configured assignee/queue, and a recognizable maintenance source attribute; write `asset_associations`; stamp `ticket_id`.
- Failure recovery: ticket created but stamping fails → transaction rolls back the association/stamp together; a retried call finds no `ticket_id` and may create again — so ticket creation itself happens after the occurrence row is locked, and the stamp commits in the same transaction as the association. Repeated clicks race-safely resolve to one ticket via the row lock.
- UI: `QuickAddTicket` rendered through `AssetCrossFeatureContext` (`packages/msp-composition/src/assets/MspAssetCrossFeatureProvider.tsx`) so `@alga-psa/assets` gains no tickets dependency; the workspace passes maintenance context props. No automatic ticket generation in v1.

## 5. Authorization matrix

| Capability | MSP permission | Notes |
|---|---|---|
| View workspace, occurrences, history, aggregates | `asset:read` | per-asset authorized context (`createAuthorizedAssetReadContextForUser`); tenant-scoped queries throughout |
| Create/edit/pause plan; complete; skip | `asset:update` | mutations verify schedule↔asset↔tenant consistency server-side |
| Archive/hard-delete plan | `asset:delete` | |
| Create/open occurrence ticket | `asset:update` + ticket create/read permissions | |
| Client Portal contacts | none in this release | portal read (history + upcoming summary) deferred to phase 3 behind its own access review; portal writes out of scope |

## 6. Phased release

- **Phase 1 (MVP, this card)**: occurrence model + backfill; workspace (C2 layout, both views); idempotent ticket flow; desktop completion (workspace + asset tab) and mobile/REST compatibility; plan lifecycle (pause/reactivate/archive, skip); honest aggregates incl. real compliance; i18n + automation ids.
- **Phase 2**: notification delivery job (scheduled processing of `asset_maintenance_notifications`, recipient/channel config, dedupe, retry, delivery evidence) + configurable automation policy.
- **Phase 3**: Client Portal read surfaces and expanded reporting (workload by client/site/type over time).

## 7. Test strategy

Checklist in `ee/docs/plans/2026-08-22-asset-maintenance-operations/tests.json` (T001–T017). Emphasis, per card:
- DB-backed integration: migration/backfill correctness, open-occurrence uniqueness, recurrence advancement (incl. late completion anchored on completion date, interval > 1, month-end cases, `custom` rejected instead of falling through to daily).
- Authorization: cross-tenant and cross-asset mutations fail safely; underprivileged users rejected.
- Idempotency: double `createOccurrenceTicket` returns one ticket; double completion rejected (also via the mobile/REST path).
- Atomicity: completion writes history + closes + advances + reopens in one transaction or not at all.
- Aggregates: fixture-verified counts; no-history plans are not compliant.
- UI smoke on the running stack with screenshot evidence: queue → ticket → complete → history/next-due, calendar view parity, pause behavior.
