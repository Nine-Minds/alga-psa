# PRD — Ticket bundles: adding an open ticket to a closed master

- Slug: `2026-09-18-ticket-bundle-closed-master-add-child`
- Date: 2026-09-18
- Status: Draft — planned from the commissioning brief for alga-2026-0002507; open questions below need a captain decision before implementation
- Ticket: alga-2026-0002507
- Owning areas: `packages/tickets` (bundle actions, ticket list/detail), `server/src/lib/api` (ticket bundle REST), integration tests

## Summary

When a ticket is linked as a child of a bundle whose master is already closed, the product currently does nothing about the resulting state: the master stays closed, the child stays open, and nobody can tell from either ticket that the bundle is inconsistent. This plan adds an explicit, user-chosen consequence at link time (keep the master closed, apply the master's resolution to the child, or reopen the master), surfaces the closed-master-with-open-children state on the ticket list and ticket detail, respects the board's `require_no_open_children` close rule, and gives the public API the same three choices.

## Problem

`addChildrenToBundleAction` and `bundleTicketsAction` (`packages/tickets/src/actions/ticketBundleActions.ts`) and their REST twins in `server/src/lib/api/services/TicketService.ts` only check bundle-shape invariants (no nesting, not already bundled). None of them looks at the master's status. The typical trigger is the "missed one": an outage is resolved, its tickets are bundled and the master closed, then a late customer ticket for the same outage arrives and a dispatcher links it. Today the link succeeds silently and the late ticket sits open under a closed parent.

The two obvious fixes are both wrong:

- **Blocking the add** would prevent the legitimate "missed one" workflow.
- **Auto-reopening the master** would turn an organizational act into a workflow act. Reopen-on-child-reply is deliberately opt-in, and in `sync_updates` mode `updateTicketWithCache` propagates a master status change to every child (`optimizedTicketActions.ts` ~L3076), so an automatic reopen would silently reopen every already-closed sibling.

The board close rule `require_no_open_children` catches this state at close time, but nothing catches or displays it from the add side.

## Principle

Linking is an organizational act, not a workflow act. Adding a child never changes the master's status, never fires close/reopen notifications, and never touches SLA on its own. Any consequence beyond the link is an explicit user choice made at add time, and its side effects are exactly those of the equivalent manual action.

## Goals

- Never block linking a ticket to a closed master purely because the master is closed.
- Make the consequence of linking to a closed master an explicit choice with a safe default.
- Give the child's requester the actual resolution when the user chooses to apply it.
- Allow a deliberate reopen of the master that does **not** cascade to existing children, even in `sync_updates` mode.
- Keep SLA per ticket: the child keeps its own clock in every choice; the master's SLA is untouched unless the user chose to reopen it.
- Make "closed master with open children" visible on the ticket list and ticket detail.
- Respect `require_no_open_children`: when the master's board has it on, do not offer the state the rule forbids.
- Full REST parity, including a 409 that names the available choices when the caller did not pick one.
- One implementation of the closed-master policy shared by the server actions and the REST service so the two surfaces cannot drift.

## Non-goals

- Child-resolved → parent notification roll-up (tracked separately on alga-2026-0002357).
- The "SLA pause did not hold on bundled tickets after a client reply" report (untriaged, no ticket).
- Changing `reopen_on_child_reply` behaviour or `sync_updates` propagation for ordinary master updates.
- New bundle settings, feature flags, or per-tenant defaults for the choice.
- Client-portal surfaces (bundling is an MSP-side action).

## Users and primary flows

Internal MSP users with `ticket:update`.

1. **Ticket detail → Bundle panel → Add.** The dispatcher types/selects a ticket and clicks Add. If the master is closed, a dialog presents the available choices (see UX). Confirming performs the link plus the chosen consequence. The existing multi-client confirmation still runs first when applicable.
2. **Ticket list → select tickets → Bundle.** The bulk dialog lets the user pick a master (or locks to an existing master). If the chosen master is closed, the same choice control appears inside the dialog before confirming. This path calls `bundleTicketsAction`, which also serves the "existing master" case, so the closed-master policy applies to bundle creation as well as add-children.
3. **REST.** `POST /api/v1/tickets/{id}/bundle/children` and `POST /api/v1/tickets/{id}/bundle` accept the choice. Omitting it while the master is closed returns 409 naming the choices that are allowed for that master.
4. **Reading the state.** A closed master with open children shows a badge in the ticket list row and in the ticket detail bundle panel/banner.

## The three choices

| Choice | Master | Child | Side effects |
| --- | --- | --- | --- |
| `keep_closed` (default) | unchanged | unchanged (stays open, keeps its own SLA clock) | Link only. Timeline entry on child and master recording that the child was added while the master was closed. No workflow/notification events beyond the existing `TICKET_MERGED`. |
| `apply_resolution` | unchanged | Closed with the master's current (closing) status; `is_closed`, `closed_at`, `closed_by` set as a normal human close. If the master has a public resolution comment, it is mirrored onto the child as a public, system-generated, immutable comment with `is_resolution = true` and recorded in `ticket_bundle_mirrors`. | Child's board close rules are enforced as for a human close (see Open Questions). Child `TICKET_CLOSED` is published after commit so the child's requester notification and the child's own SLA resolution recording happen through the normal subscribers. |
| `reopen_master` | Reopened via the **master-only** update (status → open status, `is_closed=false`, `closed_at/closed_by=null`). Existing children are **not** touched even in `sync_updates`. | unchanged (stays open) | Because a human chose this, the normal manual-reopen consequences apply to the master: `TICKET_REOPENED` activity (actor USER, `reopen_trigger: add_child`), `TICKET_UPDATED` with the status change (drives SLA pause/resume and notifications) and the `TICKET_REOPENED` workflow transition event, all published after commit. |

When the master is **open**, no choice is required or accepted (a supplied choice is ignored with a validation error in the API — see Open Questions).

When the master's board has `require_no_open_children` enabled, `keep_closed` is not an allowed choice; only `apply_resolution` and `reopen_master` are offered. The server enforces this regardless of the client.

## UX / UI notes

**Ticket detail bundle panel** (`TicketDetails.tsx`, `#ticket-bundle-master-panel`):

- On Add, after the existing multi-client check, the client asks the server for the master's closed-context (`isClosed`, `allowedChoices`, `hasResolutionComment`, `masterStatusName`). If not closed → add as today.
- If closed → a dialog titled along the lines of "This bundle's master is closed" with a radio group of the allowed choices, default `keep_closed` when allowed, otherwise no default (user must choose):
  - "Add and keep master closed" — helper: the child stays open with its own SLA; the bundle will show as inconsistent until the child is resolved.
  - "Add and apply master's resolution to this child" — helper when a resolution comment exists: closes the child with status *{masterStatusName}* and posts the master's resolution to the child as a public comment. When no resolution comment exists the helper says the child will be closed with status *{masterStatusName}* and no resolution comment will be posted.
  - "Add and reopen master" — helper: reopens only the master; already-closed children in this bundle stay closed; reopen notifications and SLA apply to the master.
  - When `keep_closed` is gated out, a short line explains that the board's close rules do not allow open children under a closed master.
  - Buttons: Cancel / Add.
- The master banner (`#ticket-bundle-master-banner`) and the bundle panel show an amber badge "N open children" when the master is closed and `openChildrenCount > 0`. Child rows in the panel show their closed/open state so the user can see which ones.

**Ticket list bulk bundle dialog** (`TicketingDashboard.tsx`):

- After the master is selected/locked, fetch the same closed-context. If closed, render the same radio group inside the dialog beneath the sync-updates checkbox, with the same gating. The Bundle/Proceed button is disabled until a choice is selected when no default is allowed.
- The choice control is one shared component used by both surfaces.

**Ticket list rows** (`ticket-columns.tsx`): when a row is a bundle master, `is_closed` is true and `bundle_open_child_count > 0`, render an amber badge "N open" next to the existing "Bundle · N" badge (exact copy to be written per `alga-tech-doc-writing` conventions). Visible in both bundled and individual views.

All new strings go through `features/tickets` locale files (`en` plus the sibling locale files as per existing conventions for new keys).

## Requirements

### Functional

- FR1. `addChildrenToBundleAction`, `bundleTicketsAction`, `TicketService.addBundleChildren`, and `TicketService.bundleTickets` evaluate the master's closed state inside the same transaction as the link, via one shared policy module.
- FR2. When the master is closed and no choice was supplied, the operation fails without writing anything, and the error names the allowed choices.
- FR3. When the master is closed and a disallowed choice is supplied (`keep_closed` under `require_no_open_children`), the operation fails without writing anything.
- FR4. `keep_closed`: link + timeline entries only.
- FR5. `apply_resolution`: link + close each added child with the master's `status_id`, set `is_closed/closed_at/closed_by`, write a `TICKET_CLOSED` activity on the child, mirror the master's resolution comment (if any) via the same mirror mechanism as `sync_updates`, publish child `TICKET_CLOSED` after commit.
- FR6. `reopen_master`: link + master-only reopen through the shared helper extracted from `maybeReopenBundleMasterFromChildReply`; children rows are not updated; master activity/events as for a manual reopen.
- FR7. Master's resolution comment = the most recent non-internal comment on the master with `is_resolution = true` or `metadata->>'closes_ticket' = 'true'`. Internal-only resolution comments are not mirrored and count as "no resolution comment".
- FR8. The allowed choices depend on the master's board `board_close_rules.require_no_open_children`.
- FR9. A read action returns the closed-context for a master so the UI can decide whether to show the dialog and which choices to offer.
- FR10. Ticket list query exposes `bundle_open_child_count` for masters; consolidated ticket data exposes `openChildrenCount` on `bundle` and `is_closed` on each bundle child.
- FR11. "Open child" means `closed_at IS NULL`, the same predicate the close rule uses, implemented once and reused by both.
- FR12. REST schemas accept `on_closed_master` on add-children and create-bundle; OpenAPI route descriptions document it; the 409 body names the allowed choices.
- FR13. Every choice publishes the existing `TICKET_MERGED` per child as today.

### Non-functional

- All writes for a single add (link + consequence) are one transaction; events are published after commit via `registerAfterCommit`.
- Tenant isolation via `tenantDb`/`tenantScopedTable` throughout; no cross-tenant reads.
- No schema migration is required (uses existing columns/tables).

## Data / API / integrations

- Tables touched: `tickets` (children `master_ticket_id`; child close fields; master reopen fields), `comments` + `comment_threads` + `ticket_bundle_mirrors` (mirrored resolution), `ticket_activity` (timeline), `board_close_rules` (read).
- New activity event type `TICKET_BUNDLE_CHILD_ADDED` (in `shared/lib/ticketActivity/types.ts`) with `details: { master_was_closed, closed_master_choice, child_ticket_id | master_ticket_id }`; add the timeline locale label.
- REST: `addBundleChildrenSchema` / `createBundleSchema` gain `on_closed_master: 'keep_closed' | 'apply_resolution' | 'reopen_master'` (optional). 409 via `ConflictError` when required and absent; 400 `ValidationError` when supplied but not allowed. Update `workManagementV1.ts` descriptions; regenerate the MCP registry if it is derived from the OpenAPI routes.
- Events: `TICKET_CLOSED` (child, apply_resolution), `TICKET_UPDATED` + `TICKET_REOPENED` (master, reopen_master), `TICKET_MERGED` (all).

## Security / permissions

Unchanged: `ticket:update` on the actor for every path. Closing a child via `apply_resolution` goes through `enforceTicketCloseRules` on the child's board as a human close (override honoured via the usual `close_override` permission if the caller requests it — not exposed in the first UI iteration).

## Rollout / migration

No migration, no flag. Existing bundles with a closed master and open children start showing the badge immediately.

## Open questions (captain decision needed)

1. **Create-bundle path.** The list dialog calls `bundleTicketsAction` even for an existing master, so the closed-master policy is planned for creation too (UI + `POST /bundle`). Confirm this extension of the brief's "add-children" wording.
2. **API field name.** The brief says `onClosedMaster`; the bundle API is snake_case (`child_ticket_ids`, `reopen_on_child_reply`). Plan uses `on_closed_master` for consistency. Confirm.
3. **Child close rules under `apply_resolution`.** Planned: enforce the child's board close rules as a human close and fail the whole add if they fail (user then picks another choice). Alternative: bypass with audit as an automation path. Confirm enforce.
4. **Reopen target status.** Planned: same tenant-default open status the child-reply reopen uses. Alternative: the master's board default status. Confirm.
5. **Notifications for the applied resolution.** Planned: publish the child's `TICKET_CLOSED` only (its email carries the resolution); do not additionally publish a comment-added event for the mirrored comment. Confirm.
6. **Choice supplied for an open master.** Planned: reject with a validation error (400) in the API and ignore in the UI (the UI never sends it). Alternative: silently ignore in both. Confirm reject.

## Acceptance criteria (definition of done)

- Adding an open ticket to a closed master via ticket detail, the list dialog, or the API without a choice never silently succeeds: UI shows the choice dialog; API returns 409 naming the allowed choices.
- `keep_closed` leaves master and child statuses unchanged and writes timeline entries on both.
- `apply_resolution` closes the child with the master's status, records `closed_at/closed_by`, mirrors the public resolution comment (when present) as a public immutable comment with a `ticket_bundle_mirrors` row, and does not modify the master.
- `reopen_master` on a `sync_updates` bundle reopens only the master; previously closed children remain closed; the newly added child stays open.
- With `require_no_open_children` on for the master's board, `keep_closed` is neither offered nor accepted; the other two work.
- Ticket list and ticket detail show the open-children badge for a closed master and hide it otherwise.
- Integration tests in `server/src/test/integration/ticketBundling.integration.test.ts` cover all of the above plus the API 409, and pass.
- The four attach code paths (two actions, two service methods) consume one shared closed-master policy so there is no duplicate rule logic.
