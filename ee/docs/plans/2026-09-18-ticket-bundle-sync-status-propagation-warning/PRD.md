# PRD — Ticket bundles: warn before sync-mode master status change closes/reopens children

- Slug: `ticket-bundle-sync-status-propagation-warning`
- Date: `2026-09-18`
- Status: Draft
- Ticket: alga-2026-0002508 (related: alga-2026-0002507, alga-2026-0002509)

## Summary

When a ticket bundle is in `sync_updates` mode, changing the master's status is silently copied to every child. Closing the master closes all children; reopening the master reopens all children — including children that were closed on their own and should stay closed. No surface (detail page, resolve flow, bulk status, mobile, REST API) warns the operator or lets them change only the master. The bundle dialog copy actively says the opposite ("children keep their current status").

This plan adds a single server-side propagation contract — preview, confirm, or master-only — that every surface consumes, records which children a master close actually touched so a later reopen only reverses those, and corrects the copy.

## Problem

Observed in `packages/tickets/src/actions/optimizedTicketActions.ts` (`updateTicketInTransaction`, ~L3076–3131):

1. On a `sync_updates` master, `status_id`, `assigned_to`, `priority_id`, `closed_by`, `closed_at` are written to *all* children by `master_ticket_id` in one UPDATE. No open/closed filter, no per-child check.
2. The denormalized `tickets.is_closed` column is **not** in the propagated field list, so children end up with a closed `status_id` and a stale `is_closed = false` (or vice versa).
3. Reopening the master reopens every child, including those that were closed before bundling or were added to the bundle already closed (alga-2026-0002507's shape).
4. No UI warns. `TicketDetails.tsx` pre-checks only board close rules (`checkTicketClosure`) at four sites (`handleSelectChange` ~L1764, resolution-comment close ~L2065, `handleBatchSaveChanges` ~L2661, `handleResolveAndClose` ~L2752). `BulkChangeStatusDialog` / `bulkUpdateTicketStatus` has no bundle awareness. Mobile `StatusPickerModal` only asks "Close this ticket?".
5. The REST path (`TicketService.update`, used by `PUT /api/v1/tickets/{id}` and `PUT /api/v1/tickets/{id}/status`, which mobile uses) has **no** bundle propagation at all — behaviour diverges between server actions and the API.
6. Copy at `bulk.bundle.syncUpdatesHelp` and `details.bundle.childrenDescription` says children keep their status. True at bundle time only (`bundleTicketsAction` never touches child status), misleading about what follows.

Bundle creation and add-children do not change child status on `main`. The report of children closing at bundle time has no repro in this tree; it is tracked as an open question, not a requirement.

## Goals

- An operator is never surprised by a master status change closing or reopening children: any change that crosses the open/closed boundary on a `sync_updates` master requires an explicit choice, with the affected children listed.
- The operator can change the master's status **without** propagating (master-only).
- A master reopen only reopens children that the master's close actually closed. Children closed independently stay closed.
- The REST API exposes the same contract (`propagateToChildren`), refusing with 409 + affected children when the caller has not chosen.
- One propagation engine serves server actions and the REST service so the two paths cannot diverge again.
- Bundle-dialog and master-panel copy state the real behaviour.

## Non-goals

- Enforcing board close rules on each child when a master close propagates (children today are closed without rule validation; unchanged — see Open Questions).
- Changing propagation of non-boundary status changes (open→open, closed→closed), `assigned_to`, or `priority_id`. Those continue to sync silently.
- Changing `link_only` mode or the child workflow-field lock.
- Comment mirroring / "Unknown User" (alga-2026-0002509) — scheduled together, separate change.
- Adding an open ticket to a closed master (alga-2026-0002507) — separate change; this plan makes sure such a child is treated correctly on reopen.
- Restoring a child's *previous* status on reopen. Reopened children take the master's new status, as today.

## Users and Primary Flows

Persona: MSP technician / dispatcher working a bundle of related tickets (e.g. an outage with one master and N per-client children).

1. **Detail page close.** Technician picks a closed status on the master (dropdown, resolve-and-close, resolution comment, batch save). A confirmation lists the N open children that will be closed with two actions: *Close master and N children* / *Close master only*. Cancel keeps the current status.
2. **Detail page reopen.** Technician picks an open status on a closed master. Confirmation lists only the children this master's close had closed (M ≤ N). Independently closed children are named as staying closed. Actions: *Reopen master and M children* / *Reopen master only*.
3. **Bulk status.** Technician selects tickets on the list, opens Change Status, picks a closed/open status. If any selected ticket is a sync-mode master whose change crosses the boundary, the dialog shows a per-master affected-children summary and a single choice applied to all: propagate or master-only.
4. **Mobile.** Technician picks a status in `StatusPickerModal`. The app sends the update without the flag; on 409 it shows the affected children and offers propagate / master-only / cancel, then resends with the flag.
5. **API integrator.** `PUT /api/v1/tickets/{id}` with a boundary-crossing status on a sync-mode master and no `propagateToChildren` → 409 with the affected children. With `true` / `false` → proceeds accordingly.
6. **Bundling.** Technician bundles tickets with sync on; the help text says closing/reopening the master will close/reopen children.

## UX / UI Notes

- Reuse `ConfirmationDialog` (`@alga-psa/ui/components/ConfirmationDialog`); it supports a third button. Title: "Close N child tickets too?" / "Reopen M child tickets too?". Body lists children by ticket number + title (scroll after ~8). For reopen, a second muted list: "Stay closed (closed independently): …".
- Buttons: primary = propagate, secondary = master only, cancel. Confirmation must not appear when the change would affect zero children (e.g. all children already closed) — the write proceeds as a plain status change (with `propagateToChildren` implicitly moot).
- The existing close-rules blocked dialog runs first; the propagation confirmation runs after close rules pass (or after an override is entered). Order: close rules → propagation confirm → write.
- Bulk dialog: below the status picker, an alert-styled section "N selected tickets are bundle masters in sync mode; this change will close/reopen X child tickets" with an expandable per-master list and a radio: *Apply to children* (default) / *Masters only*. Non-master selected tickets are unaffected by the radio.
- Mobile: native `Alert` with three actions, mirroring the web wording; the existing "Close this ticket?" alert is folded into the same flow (ask once, not twice).
- Copy (all six locales `en, de, es, fr, it, nl` under `server/public/locales/*/features/tickets.json`):
  - `bulk.bundle.syncUpdatesHelp` / `bulk.bundleSyncUpdatesHelp`: "Children keep their current status when bundled. Afterwards, closing or reopening the master closes or reopens all children, and status, assignee and priority changes on the master apply to children. Workflow fields are locked on children. Internal notes stay on the master."
  - `details.bundle.childrenDescription`: same message for the master panel.
- Follow `docs/AI_coding_standards.md` for dialog ids, `data-automation-id` naming and i18n keys.

## Requirements

### Functional Requirements

**FR1 — Propagation preview (engine).**
`previewBundleStatusPropagation(trx, tenant, masterTicketId, newStatusId)` in `packages/tickets/src/actions/ticketBundleUtils.ts` returns
`{ mode, crossesBoundary: 'close' | 'reopen' | null, affectedChildren: [{ ticket_id, ticket_number, title, is_closed }], unaffectedChildren: [...same shape, reason: 'already_closed' | 'independently_closed' | 'already_open'] }`.
- Returns `crossesBoundary: null` when the ticket is not a sync-mode master or the status change does not cross the open/closed boundary (based on `statuses.is_closed` of current vs new status).
- `close`: affected = children currently open. Unaffected = children already closed.
- `reopen`: affected = children currently closed **with an active propagation record** from this master. Unaffected = closed children without one (independently closed) and open children.

**FR2 — Propagation choice on the write path.**
`updateTicketInTransaction` (and the `updateTicketWithCache` / `updateTicket` options) accepts `propagateToChildren?: boolean`.
- If the preview says `crossesBoundary !== null` and `affectedChildren.length > 0` and the option is `undefined` → throw `BundlePropagationConfirmationRequiredError` carrying the preview. Nothing is written.
- `true` → master write + child propagation limited to `affectedChildren` (not all children).
- `false` → master write only; no child rows touched, no live events for children.
- When `crossesBoundary === null` or no affected children, the option is ignored and existing sync behaviour applies (non-boundary field sync continues).

**FR3 — Child write is complete.** The propagated child UPDATE includes `is_closed` alongside `status_id`, `closed_at`, `closed_by` (and `assigned_to`, `priority_id` when present on the master update), so children's denormalized column stays consistent.

**FR4 — Propagation record.** New table `ticket_bundle_status_propagations` (tenant-scoped; registered in `server/migrations/utils/tenantDb.cjs`):
`tenant, propagation_id (uuid pk), master_ticket_id, child_ticket_id, action ('close'), child_previous_status_id, propagated_by, propagated_at, reverted_at (nullable), reverted_by (nullable)`; unique on `(tenant, child_ticket_id) WHERE reverted_at IS NULL`; FK to `tickets` ON DELETE CASCADE for both ticket columns.
- On a propagated master close, one row per affected child.
- On a propagated master reopen, the affected children's active rows get `reverted_at/reverted_by` set.
- Removing a child from the bundle or unbundling reverts (marks) the child's active row so a later master reopen cannot touch a ticket that is no longer a child. (Cascade covers deletion.)
- Master-only writes create/revert no rows.

**FR5 — Shared engine for REST.** `TicketService.update` and `updateStatus` call the same propagation engine (extract `propagateBundleMasterStatus(trx, ctx, masterId, updateData, { propagateToChildren })` from `updateTicketInTransaction` so both paths use it). The REST path gains sync-mode propagation as a consequence — this is the intended parity, and is called out in the API changelog.

**FR6 — API contract.** `updateTicketSchema` and `updateTicketStatusSchema` accept `propagateToChildren: boolean` (optional). `BundlePropagationConfirmationRequiredError` maps to HTTP 409, `code: 'CONFLICT'`, `details: { reason: 'bundle_propagation_confirmation_required', crossesBoundary, affectedChildren, unaffectedChildren }`. OpenAPI (`workManagementV1.ts`) documents the field and the 409; generated registries regenerated.

**FR7 — Preview server action.** `previewBundleStatusPropagationAction(masterTicketId, newStatusId)` (withAuth, ticket:read) exposing FR1 for web UIs. A bulk variant `previewBulkBundleStatusPropagationAction(ticketIds, newStatusId)` returns a map keyed by master id.

**FR8 — Detail page.** All four status-change sites in `TicketDetails.tsx` go through one `confirmStatusChange(newStatusId)` helper that runs close rules, then propagation preview, then shows the confirmation dialog and resolves to `{ proceed: boolean, propagateToChildren?: boolean }`. The resulting flag is passed to `updateTicketWithCache`. Cancel leaves the select on the current value.

**FR9 — Bulk status.** `bulkUpdateTicketStatus(ticketIds, statusId, options)` accepts `propagateToChildren`. `BulkChangeStatusDialog` calls the bulk preview when the chosen status is selected and shows the FR summary + radio; on confirm passes the flag. Masters with no affected children need no choice. Failed per-ticket results still surface as today.

**FR10 — Mobile.** `updateTicketStatus` in `ee/mobile/src/api/tickets.ts` passes `propagateToChildren` when supplied; `StatusPickerModal` handles the 409 by presenting the children and re-submitting with the chosen flag. Falls back gracefully (plain error) on servers that don't return the structured details.

**FR11 — Copy.** Locale strings updated per UX notes in all six locales; both bundle-dialog keys and the master-panel key.

**FR12 — Activity.** Propagated close/reopen writes a bundle activity row on the master (`BUNDLE_STATUS_PROPAGATED`, details: action, child ids) alongside the existing per-child live updates; master-only writes record `propagated: false`. (Reuses the activity mechanism already used by `BUNDLE_REOPENED`.)

### Non-functional Requirements

- Preview and write run inside the same transaction on the write path (no TOCTOU between preview and UPDATE; the write re-derives affected children under the trx rather than trusting the client's list).
- Child selection stays a single query (join `statuses` for `is_closed`, left join active propagation rows). Bundles of a few hundred children must not degrade the master update noticeably.
- Tenant isolation: every new query uses `tenantScopedTable` / `tenantJoin`; the new table is in the Citus distribution list.

## Data / API / Integrations

- Migration `server/migrations/<YYYYMMDDHHMMSS>_create_ticket_bundle_status_propagations.cjs` (+ `tenantDb.cjs` registration). Down drops the table.
- No backfill: existing bundles have no records, so the first master reopen after deploy reopens no children via propagation (safe direction — nothing is reopened unexpectedly). Note this in the changelog.
- Server actions: `previewBundleStatusPropagationAction`, `previewBulkBundleStatusPropagationAction` (new); `updateTicketWithCache`, `updateTicket`, `bulkUpdateTicketStatus` (new option).
- REST: `PUT /api/v1/tickets/{id}`, `PUT /api/v1/tickets/{id}/status` — new optional body field, new 409.
- Error type: `BundlePropagationConfirmationRequiredError` in `packages/tickets` (like `TicketCloseValidationError`), mapped in `apiMiddleware.handleApiError` to `ConflictError`.

## Security / Permissions

- Preview action requires `ticket:read` on the master; the children listed are already visible to anyone who can see the master's bundle panel.
- Write path permission unchanged (`ticket:update` on the master). Propagation to children continues to run under the master's permission check as today.

## Observability

- None beyond the activity rows (FR12) and existing live-update events.

## Rollout / Migration

- Ships behind no flag. Behaviour change for API callers: sync-mode masters now propagate via REST and may return 409 — documented in the API changelog.
- Order of work: migration + engine (FR1–FR5) → API (FR6) → detail page (FR7, FR8) → bulk (FR9) → mobile (FR10) → copy (FR11).

## Open Questions

1. **Children closed at bundle time** — the ticket reports this but `main` doesn't do it (`bundleTicketsAction` explicitly leaves child status alone) and no PR #3363 / co-managed propagation exists in this tree. Needs a repro with the branch named before it becomes a requirement.
2. **Close rules on children** — when a propagated close closes children, should each child's board close rules be enforced (and the whole write blocked if any child fails)? Today they are bypassed. Proposed: out of scope; call out in the confirmation ("board close rules are not checked on children").
3. **Non-boundary sync in master-only mode** — if the operator picks *master only* and the same update also changes `priority_id`, should priority still sync? Proposed: `propagateToChildren: false` suppresses the whole child write for that update, which is the simplest mental model.
4. **Bulk with mixed masters** — one radio applied to all masters vs per-master choice. Proposed: one radio (per-master lists shown for information).
5. **Reopen status for children** — master's new status (today's behaviour, proposed) vs restore `child_previous_status_id` (the column is recorded either way, so this can change later).

## Acceptance Criteria (Definition of Done)

- [ ] Closing a sync-mode master from the detail page (dropdown, resolve-and-close, resolution comment, batch save) shows the confirmation listing affected open children; *master only* leaves every child untouched; *propagate* closes only those children and records a propagation row per child.
- [ ] Reopening that master lists only the children its close closed; a child that was closed before bundling (or added closed) stays closed and is named as such.
- [ ] Bulk status change with ≥1 sync-mode master crossing the boundary shows the summary and honours the radio; non-masters are unaffected.
- [ ] `PUT /api/v1/tickets/{id}` (and `/status`) on such a master without `propagateToChildren` returns 409 with the affected children and writes nothing; `true` / `false` behave as web.
- [ ] Mobile status picker handles the 409 with a three-way alert and completes the change.
- [ ] Children written by propagation have consistent `status_id` / `is_closed` / `closed_at` / `closed_by`.
- [ ] Bundle dialog and master-panel copy state the propagation behaviour in all six locales.
- [ ] `ticketBundling.integration.test.ts` covers: confirmation-required error, master-only write, propagate-limited-to-affected, independently closed child stays closed on reopen, API 409 and both flag values.
- [ ] Migration applies and rolls back cleanly; table registered for tenant distribution.
