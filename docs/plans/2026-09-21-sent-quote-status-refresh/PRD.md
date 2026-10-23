# PRD — Immediate Quote List Refresh After Detail Actions

- Slug: `2026-09-21-sent-quote-status-refresh`
- Date: `2026-09-21`
- Status: Draft
- Ticket: `alga-2026-0002522`

## Summary

Keep the quote list's client-side collection synchronized when a workflow action succeeds inside the quote detail form. After a user sends a quote from the detail view and returns to the list, the quote must already be absent from Active and present under Sent without requiring a browser refresh. The same parent refresh contract will cover successful resend and approval actions so list-backed status labels and counts do not retain stale data.

## Problem

`QuotesTab` owns the `quotes` collection that drives status filtering and tab counts. It loads that collection on mount and refreshes it after list-row actions, but opening and closing a quote detail view only changes search parameters within the same mounted component.

`QuoteForm` performs detail-view workflow actions independently. A successful `sendQuote` updates the persisted quote to `sent` and replaces `QuoteForm`'s local `quote`, but it does not tell `QuotesTab` to refresh its collection. Returning from detail view therefore reveals the old list snapshot: the newly sent quote remains under Active until the page is refreshed.

The persistence path is already correct. This is a client state synchronization defect between a child detail form and its parent list.

## Goals

- Refresh the parent quote collection after successful send, resend, and approve actions initiated from `QuoteForm`.
- Ensure a newly sent quote moves from Active to Sent, with both tab counts updated, before the user returns to the list.
- Notify the parent only after the server action succeeds; failed or permission-denied actions must leave the parent collection unchanged.
- Preserve the current detail view while the parent refresh runs instead of replacing it with the initial full-panel loading state.
- Reuse the existing `QuotesTab.loadData` fetch and normalization path rather than duplicating list-fetch logic.

## Non-goals

- Changing quote status transition rules, database writes, transactions, email delivery, or quote activities.
- Adding `revalidatePath`, a global quote store, polling, or cache invalidation infrastructure.
- Redesigning the quote list, quote detail form, tabs, notices, or action dialogs.
- Changing list-row send/resend behavior, which already calls `loadData` after success.
- Expanding this card to every other detail workflow action, such as submit for approval, request changes, cancel, revise, convert, or reminder.
- Adding new translations, API endpoints, migrations, permissions, telemetry, or feature flags.

## Users and Primary Flows

The affected user is an MSP staff member managing quotes in Billing.

Primary flow:

1. Open an active draft or approved quote from Billing > Quotes.
2. Send the quote successfully from the detail form.
3. Return to the quote list without refreshing the browser.
4. Observe that the quote is no longer in Active, is present in Sent, and the tab counts reflect the transition.

Related flows:

- Resending a sent quote refreshes the parent snapshot while the quote remains under Sent.
- Approving a pending quote refreshes the parent snapshot so its returned status is current even though both pending and approved quotes remain under Active.
- If send, resend, or approve fails, the existing error remains visible and no parent refresh callback runs.

## UX / UI Notes

No new controls or copy are required. Existing success notices, errors, status badges, tabs, and navigation remain unchanged.

The first load of `QuotesTab` should continue to use its full loading state. A refresh requested by an already-mounted `QuoteForm` should run in the background so it does not temporarily unmount and remount the form, clear local notice state, or flash the list-level loading card.

Workflow buttons should remain disabled until both the mutation and the requested parent refresh have settled. A list-refresh failure should follow the existing `loadData` error behavior and must not reinterpret a successful status mutation as a failed send, resend, or approval.

## Requirements

### Functional Requirements

1. `QuoteFormProps` exposes an optional callback for successful quote-status workflow updates. The callback supports synchronous or asynchronous parent work.
2. `QuotesTab` passes a callback that invokes its existing `loadData` path in background-refresh mode.
3. `QuoteForm` awaits the callback after successful send, resend, and approve actions and before releasing the workflow busy state.
4. `QuoteForm` does not invoke the callback when an action returns an action/permission error or throws.
5. A background refresh replaces `QuotesTab`'s `quotes` collection with the latest `listQuotes` result, allowing existing filters and count derivation to recompute naturally.
6. Initial load behavior and existing list-row action refreshes remain unchanged.

### Non-functional Requirements

- Keep the change local to the quote detail/list component boundary.
- Avoid a second source of truth for quote-to-subtab mapping.
- Maintain TypeScript typing for the callback and its asynchronous return value.
- Add focused regression coverage for callback timing, failure behavior, and parent refresh wiring.

## Data / API / Integrations

No data model, API contract, server action, transaction, or integration changes are needed.

The existing actions remain authoritative:

- `sendQuote` persists `status: 'sent'` before returning the updated quote.
- `resendQuote` returns the current sent quote after the resend attempt.
- `approveQuote` persists `status: 'approved'` and returns the updated quote.
- `listQuotes` supplies the refreshed parent collection.

## Security / Permissions

No permission behavior changes. Existing action authorization and returned permission errors remain the gate. The parent refresh callback runs only after a non-error action result.

## Observability

No new logging or metrics are in scope. Existing action errors and `QuotesTab.loadData` errors remain the diagnostic signals.

## Rollout / Migration

No migration or flag is required. This is a client-side synchronization fix. Deploy with the ordinary application release after focused component tests and a manual detail-view smoke test pass.

## Open Questions

None blocking. Extending the callback to other status-changing detail actions is intentionally deferred so this fix remains aligned with the confirmed send/resend/approve scope.

## Acceptance Criteria (Definition of Done)

- Sending a quote successfully from `QuoteForm` refreshes the parent quote collection.
- Returning to the list after send shows the quote under Sent and not under Active without a page refresh.
- Active and Sent counts reflect the refreshed statuses.
- Successful resend and approval actions also refresh the parent quote collection.
- Failed send, resend, and approval actions do not invoke the parent refresh callback.
- The detail form stays mounted during the background collection refresh; there is no list-level loading flash caused by the callback.
- Existing list-row actions and initial loading behavior continue to work.
- Focused automated tests and the manual primary-flow smoke test pass.
