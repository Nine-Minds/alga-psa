# Invoice charge linkage and billable-time safety plan

## Problem

Recurring invoice generation currently treats every non-fixed charge as an independent claim on its recurring service-period row. When several hourly charges share one `servicePeriodRecordId`, the first claim succeeds and the second updates zero rows, causing `assertRecurringPeriodLinked` to abort the transaction. The invoice is deleted and the UI receives only a generic recurring-billing failure.

The production investigation also found a time entry whose `billable_duration` is zero while its elapsed start/end duration is 265 minutes. The billing loaders admit that row and the calculator uses elapsed time, so a deliberately non-billable entry can become a rounded invoice charge.

## Goals

- Persist every intended hourly charge, charge detail, and time-entry mapping when several charges share one recurring period.
- Claim each recurring service-period row exactly once per invoice, preserving the exact-one-row assertion on the first claim.
- Apply the same safe shared-period behavior to all non-fixed recurring charge families handled by the generic persistence path.
- Treat positive `billable_duration` as the authoritative time quantity and exclude zero-billable entries.
- Preserve the underlying exception in server-side diagnostics while retaining the current safe generic user-facing failure.
- Cover the money and linkage behavior with runtime tests, including database-backed coverage; do not add source-string tests.

## Non-goals

- No schema or migration change.
- No change to fixed-charge linkage, invoice transaction boundaries, retry/idempotency keys, billing cadence selection, or UI copy.
- No repair of production data and no automatic invoicing of the affected customer.
- No broad billing-engine refactor beyond the two confirmed safety defects.

## Design decisions

### 1. Deduplicate claims in the non-fixed persistence path

In `packages/billing/src/services/invoiceService.ts`, add an invoice-scoped set for recurring service-period IDs used by `persistInvoiceCharges`. For a non-fixed charge that requires recurring linkage:

1. Always insert the invoice charge and recurring detail.
2. Always run `linkAndMarkSourceBillingRecord`, so every time entry or usage source record receives its own invoice mapping.
3. If the non-null `servicePeriodRecordId` has not been claimed, call `linkRecurringServicePeriodToInvoiceDetail`, require `updatedCount === 1`, and add the ID to the set only after the assertion passes.
4. If the ID is already in the set, skip only the period claim. Do not skip the charge, detail, source mapping, subtotal, or tax work.
5. Missing period IDs must still flow to the existing assertion and fail; deduplication must not conceal malformed recurring charges.

This is preferred over weakening the assertion or making the database update silently idempotent. The first claim remains a strong integrity check, while duplicate charges from the same obligation become valid invoice detail rows. The same generic mechanism covers hourly, usage, product, and license charges without family-specific branches. The fixed path keeps its existing dedupe set because a persisted period has one charge family and cannot legitimately cross fixed/non-fixed paths.

### 2. Make `billable_duration` authoritative

In both time-entry loaders in `packages/billing/src/lib/billing/billingEngine.ts`, require `time_entries.billable_duration > 0`. This applies even to explicitly selected entries: a zero-billable entry must never be invoiced.

Add `billable_duration` to `TimeEntryComputeRow` in `computeTimeBasedCharges.ts`. Use that positive minute value as `rawDurationMinutes`, then apply the existing contract minimum and round-up rules. Retain start/end timestamps for billing-window eligibility and work-date resolution, not charge quantity. Apply the same billable-minute source to the unresolved/non-contract calculation path, which currently computes elapsed minutes inline.

This choice makes edits to billable time meaningful and prevents non-billable elapsed time from leaking into invoices. Existing minimum-time and rounding configuration still operates after the billable quantity is chosen.

### 3. Preserve actionable server diagnostics

In `packages/billing/src/actions/recurringBillingRunActions.ts`, log the caught invoice-generation exception before appending the generic failure result. Emit a stable structured event name and include safe identifiers already present in the run (`runId`, tenant, billing-cycle ID, execution identity/window kind) plus normalized error name/message/stack. Keep the existing generic `Failed to generate invoice for this billing cycle.` result for the UI and workflow payload.

Apply this to both grouped-target and single-target recurring-run catch paths so diagnostic quality does not depend on entry point. Duplicate-invoice errors remain excluded from failure logging because they are an expected idempotency outcome.

## Implementation steps

1. Add the non-fixed recurring-period claim set and first-claim-only linkage in `invoiceService.ts`.
2. Extend the persistence test harness to assert every charge/detail/source mapping while observing a single period claim.
3. Filter zero-billable rows in both billing-engine time-entry queries.
4. Thread `billable_duration` into `computeTimeBasedCharges` and replace elapsed-minute billing in both resolved and unresolved calculation paths.
5. Add structured underlying-error logging to both recurring billing run catch paths without changing returned user-facing errors.
6. Run the targeted billing suites, then the surrounding fixed/usage/product/license regression suites.

## Behavioral test plan

### Shared recurring-period persistence

Extend `server/src/test/unit/billing/invoiceService.fixedPersistence.test.ts` (or split a focused runtime test beside it) with two hourly charges that have distinct time-entry IDs but the same recurring period ID. Assert:

- two invoice charges and two invoice charge details are inserted;
- both time entries receive distinct invoice mappings and become invoiced;
- the recurring period is updated once and points to the first detail;
- subtotal includes both charges;
- a first-claim row-count mismatch still throws and rolls back through the caller.

Add table-driven runtime cases for duplicate usage, product, and license charges sharing their family-specific period ID. Each case must persist all charges/details while claiming the period once. Do not replace these with source-string assertions.

### Billable duration

Add database-backed coverage in the existing billing invoice/time-plan infrastructure suite:

- an approved entry with elapsed time but `billable_duration = 0` is absent from calculated and persisted charges and remains uninvoiced;
- a positive entry whose billable minutes differ from elapsed minutes is charged from billable minutes, then receives configured minimum/rounding;
- a recurring hourly invoice with at least two positive entries in one period succeeds end-to-end, persists both time mappings, and creates exactly one invoice-to-period link.

Add a focused pure-compute case only if it clarifies minimum/rounding arithmetic; it supplements rather than replaces the database-backed loader/persistence test.

### Diagnostics

Extend `server/src/test/unit/billing/recurringBillingRunActions.test.ts` to make invoice generation throw a distinctive error. Assert the action still returns the generic failure while the structured error log contains the underlying message and run/window identifiers. Verify duplicate-invoice errors remain treated as non-failures.

### Regression commands

- Targeted invoice persistence tests.
- Targeted recurring billing run action tests.
- The database-backed fixed-price/time-based billing suite.
- Existing fixed, usage, product, and license billing tests affected by `persistInvoiceCharges` and `computeTimeBasedCharges`.
- Typecheck/lint for the touched billing package and server tests.

## Acceptance criteria

- Multiple approved hourly entries sharing one recurring period generate an invoice successfully.
- Every intended charge, detail, and time-entry mapping persists.
- Exactly one recurring-period linkage is written for the shared period, and the first claim retains exact-row validation.
- Shared-period usage, product, and license charges exhibit the same safe behavior.
- Zero-billable entries produce no invoice charge; positive entries use `billable_duration`, not elapsed duration, before configured rounding.
- Unexpected recurring invoice failures retain the actionable underlying exception in server logs while users receive the current generic failure.
- Existing fixed, usage, product, and license billing suites remain green.

## Risks and review focus

- Do not add an ID to the dedupe set before a successful claim; doing so could hide a failed first update.
- Do not use an empty-string sentinel to suppress the missing-period assertion.
- Ensure dedupe skips only the recurring-period update, not source mapping or invoice detail persistence.
- Confirm billable-duration filtering exists in both assigned-contract and unresolved/project paths.
- Verify structured logging does not include invoice contents, customer data, or other sensitive payloads.
- Keep `package-lock.json` out of the plan commit; it is pre-existing Wire Up noise.

## Approval

Approved under the card's captain-granted `conn` delegation. The scope follows the verified production root cause and acceptance criteria, and the selected design preserves the existing integrity assertion and user-facing behavior while changing only the confirmed failure paths.
