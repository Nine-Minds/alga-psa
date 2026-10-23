# Scratchpad — Immediate Quote List Refresh After Detail Actions

- Plan slug: `2026-09-21-sent-quote-status-refresh`
- Created: `2026-09-21`
- Ticket: `alga-2026-0002522`

## Decisions

- (2026-09-21) Treat this as a parent/child client-state synchronization defect. The server mutation is already correct and does not need revalidation or persistence changes.
- (2026-09-21) Use an optional, awaitable callback from `QuoteForm` to `QuotesTab`; keep `QuotesTab` as the owner of the list collection and reuse `loadData` as the refresh path.
- (2026-09-21) Notify the parent only for the confirmed send, resend, and approve scope. Other workflow actions are deferred rather than silently broadening the card.
- (2026-09-21) Add a background mode to `loadData`. Calling today's implementation from detail view sets `isLoading` and would replace the entire tab with a loading card, unmounting `QuoteForm` and its transient notice state.
- (2026-09-21) Await the parent callback within the successful workflow helper path so action buttons remain disabled until the parent list snapshot is current.

## Discoveries / Constraints

- (2026-09-21) `packages/billing/src/components/billing-dashboard/quotes/QuotesTab.tsx` loads data once from an empty-dependency `useEffect`. Search-parameter navigation between list and detail does not remount the component.
- (2026-09-21) `SUBTAB_STATUSES` and the `subtabCounts` memo both derive from the parent `quotes` array. Updating `QuoteForm`'s local quote cannot affect list membership or counts.
- (2026-09-21) `QuotesTab` already refreshes after successful list-row send and resend actions. The missing path is the embedded `QuoteForm` workflow.
- (2026-09-21) `QuoteForm.runWorkflowAction` sets its local quote from the successful action result but has no parent notification. It is the narrow shared success boundary for send, resend, and approve.
- (2026-09-21) `sendQuote` updates the quote to `sent` inside a transaction and returns the fresh quote. No `revalidatePath` is needed for the client-owned list snapshot.
- (2026-09-21) Existing focused test homes are `packages/billing/tests/quote/QuoteForm.test.tsx` and `packages/billing/src/components/billing-dashboard/quotes/QuotesTab.test.tsx`.
- (2026-09-21) There are no schema or database behavior changes, so this plan does not require a new DB-backed integration test.
- (2026-09-21) The worktree began with an unrelated modified `package-lock.json`; it must remain out of this card's commits.

## Commands / Runbooks

- Focused component tests: `npm --workspace @alga-psa/billing test -- QuoteForm.test.tsx QuotesTab.test.tsx`
- Type check: `npm --workspace @alga-psa/billing run typecheck`
- Review planned diff: `git diff -- docs/plans/2026-09-21-sent-quote-status-refresh`

## Links / References

- `packages/billing/src/components/billing-dashboard/quotes/QuoteForm.tsx`
- `packages/billing/src/components/billing-dashboard/quotes/QuotesTab.tsx`
- `packages/billing/src/actions/quoteActions.ts`
- `packages/billing/tests/quote/QuoteForm.test.tsx`
- `packages/billing/src/components/billing-dashboard/quotes/QuotesTab.test.tsx`

## Open Questions

- None blocking for implementation.
