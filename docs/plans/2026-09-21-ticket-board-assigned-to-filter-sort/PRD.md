# PRD — Ticket board assignee filtering and sorting reliability

- Ticket: `alga-2026-0002524`
- Slug: `ticket-board-assigned-to-filter-sort`
- Date: `2026-09-21`
- Status: Ready for implementation

## Summary

Make ticket-board assignee filtering and sorting reliable. Sorting by the visible **Assigned To** column must be accepted by the server and must use the same order for the list and adjacent-ticket navigation. Other ticket-list sort keys already represented by list data (`assigned_team_name` and `updated_at`) must be accepted consistently as well. When the server returns a user-safe ticket-list validation message, the UI must display that message instead of replacing it with the generic “Failed to fetch tickets” fallback. Invalid assignee identifiers persisted in an older saved view must be discarded before they reach the UUID-only list schema.

The defect is a contract mismatch, not a failure in the assignee SQL predicate. `DataTable` emits the column `dataIndex` as the sort key, so clicking **Assigned To** emits `assigned_to_name`. The ticket-list Zod schema and SQL sort maps do not currently accept that key. The server correctly returns a localized, user-safe validation error, but the error helper gives its generic fallback precedence and hides the useful reply.

## Problem

Ticket-list sorting has several independently maintained allow-lists:

- `packages/tickets/src/lib/ticket-columns.tsx` exposes `assigned_to_name` as a sortable column.
- `packages/ui/src/components/DataTable.tsx` emits that identifier unchanged.
- `packages/tickets/src/components/TicketingDashboardContainer.tsx` sends it as `sortBy`.
- `packages/tickets/src/schemas/ticket.schema.ts` rejects it because the enum ends at the older set of sort keys.
- `packages/tickets/src/actions/optimizedTicketActions.ts` has two corresponding SQL-order implementations, neither of which maps `assigned_to_name`, `assigned_team_name`, or `updated_at`.
- Client-side URL parsing and server-side initial-page parsing each maintain another older sort-key whitelist.

The Zod rejection is converted to the user-safe action error “Ticket list filters are no longer valid. Refresh the page and try again.” The container extracts that reply and passes it to `handleError`, but `packages/ui/src/lib/errorHandling.ts` always chooses the supplied fallback first, so the user sees only “Failed to fetch tickets.”

There is a second route to the same validation failure. Saved board/tenant views accept arbitrary strings in `assignedToIds`. On the first server render, the set of known users is not loaded, so `validateCapturedFilters` preserves those strings and the ticket-list UUID schema rejects the request. URL-based assignee input is already normalized and the SQL predicate for valid `assignedToIds` is correct.

## Goals

- Clicking the ticket board’s **Assigned To** header sorts the list without producing a fetch error.
- Accept and execute the supported list sort keys `assigned_to_name`, `assigned_team_name`, and `updated_at` in ascending and descending order.
- Keep list order and previous/next ticket navigation order identical for every supported sort key.
- Preserve supported sort keys across URL serialization, browser history, reload, and server-rendered first load.
- Display a returned user-safe action message even when the caller supplies a generic fallback; continue using the fallback for unexpected thrown errors.
- Prevent malformed stored `assignedToIds` values from reaching the UUID-only ticket-list schema, including during SSR when the known-user universe is unavailable.
- Reject new saved-view writes containing malformed assignee identifiers.

## Non-goals

- Redesigning the ticket-board filter or column UI.
- Adding separate **Assigned Team** or **Updated At** columns to the current board.
- Changing assignee-filter SQL semantics, team filtering, unassigned filtering, or additional-agent behavior.
- Changing the names or format of existing ticket-list validation messages.
- Broadly exposing raw thrown server errors in toasts.
- Migrating or rewriting existing saved-view JSONB documents in the database; invalid values are tolerated and removed on read.
- Refactoring every ticket filter and sort type in the application.
- Updating `server/src/lib/schemas/ticket.schema.ts`, which has no runtime imports for the list path; the authoritative schema used by ticket actions is `packages/tickets/src/schemas/ticket.schema.ts`.

## Users and primary flows

### Sort the ticket board by assignee

1. An MSP user opens the ticket board.
2. The user selects one or more assignees and/or clicks the **Assigned To** column header.
3. The list request validates successfully.
4. Results are ordered by the primary assignee display name in the requested direction, with ticket ID as the existing deterministic tie-breaker.
5. The selected sort survives URL updates and a page reload.
6. Opening a ticket and using previous/next follows the same ordering as the list.

### Recover from a stale saved view

1. A board or tenant default view contains one or more non-UUID `assignedToIds` tokens from an older or hand-written document.
2. The view is sanitized before the ticket-list action is called, even on the initial server render where user options are not yet available.
3. Valid UUIDs remain; malformed values are dropped. If no valid values remain, the filter is omitted.
4. The board loads instead of failing validation.

### Understand an expected server rejection

1. A list action returns an `actionError` or `permissionError` payload with user-safe/localized text.
2. The UI displays that returned text.
3. If an unexpected exception is thrown instead, the operation-specific fallback remains the user-facing toast and technical detail remains in the console log.

## UX / UI notes

No new controls or layout changes are required. The existing sortable-header affordance remains the interaction. The observable changes are successful ordering and more informative error text.

Unassigned tickets should retain predictable database ordering. Use a SQL expression for `assigned_to_name` based on the already joined `au` user alias, and preserve the existing final `t.ticket_id DESC` tie-breaker. `assigned_team_name` maps to the existing `tm.team_name` join and `updated_at` maps to `t.updated_at`.

## Requirements

### Functional requirements

#### R1 — One supported sort-key contract

Define a client-safe ticket-list sort-key constant/type (for example, in `packages/tickets/src/lib/ticketListSort.ts`) containing the existing keys plus:

- `assigned_to_name`
- `assigned_team_name`
- `updated_at`

Use it in the authoritative ticket-list Zod enum, client URL parser, and server page parser instead of maintaining divergent literals. Export only client-safe constants/helpers through `packages/tickets/src/lib/index.ts`.

#### R2 — Complete SQL mapping

In `packages/tickets/src/actions/optimizedTicketActions.ts`, define one typed sort specification map shared by:

- `applyTicketListSort`, used by the paginated list; and
- `getTicketListSortOrderByClause`, used by adjacent-ticket window functions.

The new mappings are:

- `assigned_to_name` → an expression using `au.first_name` and `au.last_name` from the existing assigned-user join;
- `assigned_team_name` → `tm.team_name`;
- `updated_at` → `t.updated_at`.

Retain `t.ticket_id DESC` as the deterministic secondary order. The map must be exhaustive against the sort-key type so adding a future key fails type-checking until SQL support is supplied.

#### R3 — Returned action messages outrank fallbacks

Preserve error shape at the ticket container boundary: pass a returned action-error payload to `handleError` instead of reducing it to a plain string first.

Update `handleError` so:

- permission payloads retain their existing custom presentation;
- user-safe `actionError` payloads display their own message, even when a fallback is supplied; and
- ordinary thrown errors or unknown values continue to use the supplied fallback.

Do not globally prefer arbitrary `Error.message` over a fallback; that could expose internal exception text across unrelated callers.

#### R4 — Saved assignee IDs are safe at every boundary

- Reuse a UUID predicate/normalizer from `packages/tickets/src/lib/ticketFilterUtils.ts` rather than introducing a second UUID interpretation.
- On read, ensure `assignedToIds` is UUID-filtered before membership validation. This guarantee must hold when `known.userIds` is undefined, which is the initial SSR path in `server/src/app/msp/tickets/page.tsx`.
- Preserve valid IDs and deduplicate them. If all values are invalid, omit `assignedToIds`.
- Keep the existing `unassigned` URL sentinel translation into `includeUnassigned`; never forward the sentinel as an assignee ID.
- In `packages/tickets/src/actions/board-actions/boardViewSettingsSchema.ts`, change the write schema for `assignedToIds` to UUID strings so new invalid documents are rejected.

### Non-functional requirements

- No database migration or data rewrite.
- No change to tenant scoping or authorization.
- No additional ticket-list query or join; all required aliases already exist in `buildTicketListBaseQuery`.
- Sorting must stay deterministic and consistent between pagination and adjacent-ticket navigation.
- Client bundles must not import server-only SQL/action modules.

## Data / API / integrations

No data model or public API changes are required. `ITicketListFilters.sortBy` remains a string-compatible field, while runtime validation becomes complete for the keys the product emits.

The ticket-list query already joins:

- `users as au` on `t.assigned_to`;
- `teams as tm` on `t.assigned_team_id`.

The result projection already selects `assigned_to_name`, `assigned_team_name`, and `t.updated_at`, so the work only aligns validation and ordering with existing data.

## Security / permissions

Existing `ticket:read` authorization and tenant-scoped joins are unchanged. Returned `actionError` values are an explicit user-safe channel; arbitrary thrown exceptions are not. The fallback-precedence change must preserve that distinction.

## Observability

No new telemetry is required. Existing `console.error(error)` behavior in `handleError` remains. The visible server reply makes future validation failures diagnosable without exposing unexpected exception content.

## Rollout / migration

Ship as a backward-compatible code change. Existing malformed saved views self-heal at read time without a data migration. A later successful save writes only UUID-valid assignee IDs under the tightened schema.

## Implementation sequence

1. Add the shared ticket-list sort-key contract and use it in the package Zod schema plus client and SSR URL parsing.
2. Consolidate the two SQL sort maps and add the assignee/team/updated mappings.
3. Preserve returned action-error shape in `TicketingDashboardContainer` and make `handleError` prefer user-safe action messages over fallbacks only for that channel.
4. Reuse assignee UUID normalization in stored-view read validation and tighten the saved-view write schema.
5. Add focused unit/component tests and a DB-backed integration test for sort execution/order.

## Risks

- **Error-message exposure:** reversing fallback precedence for every error would reveal technical exception messages. Restrict precedence to explicit action-error payloads.
- **Sort drift:** the list and adjacent-ticket paths currently duplicate mapping logic. Updating only one would make next/previous navigation disagree with the table.
- **Reload drift:** updating only the action schema would make a clicked sort work until reload, when the client or SSR whitelist would reset it.
- **Null and blank names:** assigned users or teams can be absent. The chosen SQL expression needs an explicit, tested ordering for those rows while preserving the existing ticket-ID tie-breaker.
- **SSR saved views:** initial server rendering calls `validateCapturedFilters` without known user IDs. UUID shape validation cannot depend on that universe being present.
- **Legacy duplicate schema:** `server/src/lib/schemas/ticket.schema.ts` contains a similar enum but is not imported by the ticket-list runtime. Editing it without establishing ownership would perpetuate the duplication rather than fix it.

## Open questions

None blocking. The brief establishes the supported new sort keys, the user-safe error channel, and read-time handling for legacy saved values.

## Acceptance criteria (definition of done)

- Clicking **Assigned To** requests `sortBy=assigned_to_name` and returns a sorted ticket list without an error toast.
- `assigned_to_name`, `assigned_team_name`, and `updated_at` pass ticket-list validation in both directions and execute against PostgreSQL.
- Each supported sort key survives client URL parsing and server-rendered first load.
- Adjacent-ticket navigation produces the same order as the ticket list for the three new keys.
- Equal primary sort values remain deterministic through `t.ticket_id DESC`.
- A returned ticket-list `actionError` is displayed instead of “Failed to fetch tickets.”
- An unexpected thrown fetch error still displays “Failed to fetch tickets,” not raw technical text.
- Malformed stored `assignedToIds` do not break first render; valid UUIDs in the same saved list remain active.
- New saved-view writes reject non-UUID `assignedToIds`.
- Existing assignee, team, and unassigned filtering behavior continues to pass.
