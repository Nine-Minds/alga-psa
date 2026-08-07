# Automatic invoice due-work reload skeleton plan

## Goal

Give Billing > Invoicing > Generate immediate, accessible feedback whenever the recurring due-work query reloads. While the server response is pending, no candidate rows, approval rows, or materialization-gap data from the previous query may be presented as current.

## Existing behavior

`AutomaticInvoices.tsx` already owns the right request state:

- `isPeriodsLoading` is set before `getAvailableRecurringDueWork` and cleared after the active request settles.
- The request is retriggered by the applied date range, ready-page number, page size, and parent `refreshTrigger`.
- `initialLoadDone` intentionally limits `BillingTableSkeleton` to the first request.
- Existing candidates and materialization gaps remain in state during later requests, so stale rows and the stale repair panel remain visible for a slow response.
- The existing request cleanup ignores results from superseded effects; keep that race protection.
- The existing `loadError` alert is the canonical settled error UI.

## Design decision

Treat `isPeriodsLoading` as the authoritative visibility boundary for all data returned by `getAvailableRecurringDueWork`, not only the initial request.

At the beginning of each active request:

1. clear `loadError`;
2. mark the due-work region loading;
3. clear `periods`, `materializationGaps`, and `totalPeriods`.

Clearing the fetched model makes every server-derived presentation safe by construction, including Needs Approval, quick-view counts, the materialization-gap repair panel, grouped candidate rows, and pagination totals. It also avoids moving the current toolbar or duplicating the many rendering branches.

Render `BillingTableSkeleton` whenever `isPeriodsLoading` is true. Wrap the due-work results area with `aria-busy={isPeriodsLoading}`; while loading, add a visually hidden, polite `role="status"` message such as "Loading invoice candidates." Keep the decorative skeleton `aria-hidden`.

When the request succeeds, replace the cleared model with the new response and end the busy state. When it returns an action error or throws, end the busy state and show the existing destructive `loadError` alert; do not add a competing error surface. Superseded requests must continue to be ignored by the effect cleanup.

## Implementation tasks

### 1. Make every due-work request an explicit stale-data boundary

File: `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`

- In the recurring due-work effect, clear candidates, gaps, and totals at request start alongside `setLoadError(null)` and `setIsPeriodsLoading(true)`.
- Retain the current `isMounted` cleanup and success/error handling.
- Replace the initial-only ready-table loading predicate with the live `isPeriodsLoading` state for the fetched results.
- Leave the independent invoice-history loading path and `invoicedInitialLoadDone` unchanged.
- Do not change local-only quick filters or client search into server reloads.

### 2. Make the loading state accessible

File: `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`

- Put `aria-busy` on a stable due-work results container.
- Add a `role="status"`, `aria-live="polite"` loading announcement with screen-reader-only copy while the due-work request is pending.
- Continue using `BillingTableSkeleton` as decorative visual feedback on initial load and all later reloads.
- Keep filter controls available so users can supersede a slow request; the existing effect cleanup will prevent an older response from winning.

### 3. Add behavioral coverage for deferred reloads

File: `packages/billing/tests/automaticInvoices.groupedParentRows.test.tsx`

- Expose the existing `getAvailableRecurringDueWork` mock so individual calls can return deferred promises.
- Render an initial successful candidate and materialization gap, then start a deferred reload.
- For each server trigger seam - Apply date range, ready-page change, page-size change, and parent `refreshTrigger` rerender - assert immediately that:
  - the loading status and skeleton are present;
  - the due-work container reports busy;
  - the prior candidate row and prior materialization-gap panel are absent.
- Resolve the deferred response and assert the busy/skeleton state disappears and only the replacement response is shown.
- Add a settled-error case proving the skeleton disappears and the existing load-error alert is preserved.
- Keep assertions behavioral and DOM-visible; do not assert source strings or implementation-text details.

## Verification

Run the focused billing component test file in the wired worktree, followed by the package-level billing test command if the focused run passes. Also verify TypeScript/lint for the touched package using the repository's existing scripts.

Manual smoke check on the wired stack:

1. Open Billing > Invoicing > Generate.
2. Apply a date-range filter while throttling or delaying the request.
3. Confirm old candidate rows and repair-gap content disappear immediately, a skeleton appears, and the region reports busy.
4. Repeat with page, page-size, and an external refresh.
5. Confirm success replaces the skeleton with current data and failure restores the existing error alert.

## Scope guard

Do not optimize `getAvailableRecurringDueWork`, redesign filters, alter invoice-history loading, or change billing semantics. The unrelated Wire Up change in `package-lock.json` must remain uncommitted and untouched.
