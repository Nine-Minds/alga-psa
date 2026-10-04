# Scratchpad — Ticket board assignee filtering and sorting reliability

Ticket: `alga-2026-0002524`

## Code-path findings

- `packages/tickets/src/lib/ticket-columns.tsx:494-500` builds the visible **Assigned To** column with `dataIndex: 'assigned_to_name'`; no `sortable: false` override is present.
- `packages/ui/src/components/DataTable.tsx:442-458` makes such columns sortable by default and uses `dataIndex` as the TanStack column ID.
- `packages/ui/src/components/DataTable.tsx:562-568` passes that ID unchanged to `onSortChange` in manual-sort mode.
- `packages/tickets/src/components/TicketingDashboard.tsx:502-507` forwards the column ID unchanged.
- `packages/tickets/src/components/TicketingDashboardContainer.tsx:424-467` sends it as `filters.sortBy`; returned action errors are reduced to a string and passed together with the generic fetch fallback.
- `packages/tickets/src/schemas/ticket.schema.ts:166-178` does not accept `assigned_to_name`, `assigned_team_name`, or `updated_at`.
- `packages/tickets/src/actions/optimizedTicketActions.ts:2014-2022` validates before building the query. A Zod issue is mapped at lines 119-125 to the user-safe/localized “Ticket list filters are no longer valid…” action error.
- `packages/ui/src/lib/errorHandling.ts:323-355` gives `fallbackMessage` precedence for every non-permission error, so the returned message is hidden.
- `packages/tickets/src/actions/optimizedTicketActions.ts:1157-1169` already joins `users as au` and `teams as tm`.
- `packages/tickets/src/actions/optimizedTicketActions.ts:1891-1927` already projects `t.updated_at`, an assigned-user display name, and `tm.team_name as assigned_team_name`.
- The assignee filter predicate at `packages/tickets/src/actions/optimizedTicketActions.ts:1322-1347` is sound for validated values; it ORs user/team/unassigned selections as intended.
- SQL sorting is duplicated at `applyTicketListSort` (lines 1757-1788) and `getTicketListSortOrderByClause` (lines 1794-1821). The latter drives window functions in `getAdjacentTicketIds`, so both must remain identical.
- Sort-key URL allow-lists are also duplicated in `packages/tickets/src/components/TicketingDashboardContainer.tsx:54-65` and `server/src/app/msp/tickets/page.tsx:194-210`.
- URL assignee tokens already pass through `normalizeAssignedToIds` in `packages/tickets/src/lib/ticketFilterUtils.ts:44-67`, which drops malformed values, deduplicates UUIDs, and translates `unassigned` into `includeUnassigned`.
- Saved views are more permissive: `boardViewSettingsSchema.ts:57` accepts arbitrary strings, while `validateCapturedFilters` at `ticketViewSettings.ts:300-314` preserves an unvalidated list when its known universe is absent.
- The SSR remembered-board path calls `validateCapturedFilters(resolvedView.filters, {})` at `server/src/app/msp/tickets/page.tsx:284-289`, then forwards `assignedToIds` into the UUID schema. This is the concrete stale-document failure path.
- `server/src/lib/schemas/ticket.schema.ts` contains a similar list schema but repository search found no consumers of its `ticketListFiltersSchema`; ticket actions import the package schema directly.

## Design decisions

- Keep the fallback useful for unknown exceptions. Prefer returned text only when the original value still has the explicit `actionError` shape; therefore the ticket container must stop converting the payload to a string before calling `handleError`.
- Introduce one client-safe sort-key contract and one exhaustive server-side sort map. This is small enough to remove the actual drift without widening into a general ticket-filter refactor.
- Reuse the existing assignee UUID normalization rule for URL and saved-view inputs. Shape validation happens even when the set of currently available users is unknown; membership validation remains conditional on the known set.
- Tighten future writes and tolerate old data on reads. No JSONB migration is necessary.
- Keep `t.ticket_id DESC` as the existing deterministic secondary order.

## Expected implementation touch points

- New client-safe sort contract under `packages/tickets/src/lib/`, exported through `packages/tickets/src/lib/index.ts`.
- `packages/tickets/src/schemas/ticket.schema.ts`.
- `packages/tickets/src/actions/optimizedTicketActions.ts`.
- `packages/tickets/src/components/TicketingDashboardContainer.tsx`.
- `server/src/app/msp/tickets/page.tsx`.
- `packages/ui/src/lib/errorHandling.ts` and its tests.
- `packages/tickets/src/lib/ticketFilterUtils.ts` and tests.
- `packages/tickets/src/lib/ticketViewSettings.ts` and tests.
- `packages/tickets/src/actions/board-actions/boardViewSettingsSchema.ts` and a focused test.
- A DB-backed ticket-list sort integration test under `server/src/test/integration/` using the repository integration bootstrap.

## Verification commands for implementation

Use the repository’s targeted package/test commands after choosing exact test filenames. At minimum:

```bash
npx vitest run packages/ui/src/lib/errorHandling.validation.test.ts
npx vitest run packages/tickets/src/lib/ticketFilterUtils.test.ts packages/tickets/src/lib/ticketViewSettings.test.ts
npx vitest run packages/tickets/src/components/TicketingDashboardContainer.urlSync.contract.test.tsx
npm run typecheck --workspace=@alga-psa/tickets
```

Run the new DB-backed integration test through the `integration-testing` workflow rather than treating source-string assertions as proof of SQL behavior.

## Workspace note

`package-lock.json` was already modified by the wired development environment before this design assignment. The plan commit must stage only this plan directory and leave that unrelated change untouched.
