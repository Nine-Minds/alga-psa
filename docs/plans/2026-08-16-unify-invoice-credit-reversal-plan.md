# Unified invoice credit reversal implementation plan

## Goal

Make invoice credit reversal one transactional ledger operation shared by void, unfinalize, and hard-delete. A draft invoice carries no applied credit; re-finalization may apply credit again under the then-current draw-down policy.

## Current behavior and constraints

- `packages/billing/src/actions/voidInvoiceActions.ts` owns `reverseCreditApplicationsForInvoice`. It reads every `credit_application` transaction for the invoice, restores the `metadata.applied_credits` amounts to `credit_tracking`, writes `credit_adjustment` audit transactions, and zeros `invoices.credit_applied`.
- `unfinalizeInvoice` in `packages/billing/src/actions/invoiceModification.ts` currently performs no ordinary credit reversal.
- `hardDeleteInvoice` uses `credit_tracking_usage`, which has no writers, only handles the first application transaction, and then deletes that transaction. This can permanently lose customer credit.
- The branch inherits the invoice-row-then-credit-rows lock order from the parent branch. Preserve it everywhere: lock the invoice first, then deterministically lock the affected `credit_tracking` rows before reading or changing balances.
- Existing allocation rows are append-only evidence. Do not infer the active amount from their gross historical sum.
- Reversal must be repeat-safe. Unfinalize can be followed by re-finalize and another unfinalize, so the primitive must not restore an already-reversed historical application a second time.

## Design

### 1. Turn reversal into the canonical primitive

Move the reusable primitive to a neutral billing module if importing it from `voidInvoiceActions.ts` would create a server-action cycle; otherwise retain the export with a clear dependency direction. Give it a lifecycle-neutral contract such as:

```ts
reverseCreditApplicationsForInvoice(trx, tenant, invoiceId, actorUserId, reason)
```

The caller must already be inside a transaction and must have locked the invoice row. The primitive:

1. Reads all `credit_application` transactions for the invoice, not only the first.
2. Excludes applications already reversed by finding completed `credit_adjustment` transactions whose metadata identifies `reversal_of` that application transaction. This is the idempotency boundary needed for repeated unfinalize/re-finalize cycles.
3. Validates and flattens each active application's `metadata.applied_credits`; fail the transaction on malformed or missing provenance rather than silently losing credit.
4. Locks the referenced `credit_tracking` rows in stable `credit_id` order with `FOR UPDATE`, then restores each amount.
5. Writes one auditable reversal record per application (or another deterministic shape that retains `reversal_of`, reason, actor, and restored credit ids/amounts).
6. Sets `invoices.credit_applied` to zero before returning a structured result with restored totals/application ids.

Do not delete historical `credit_application`, `credit_adjustment`, or `credit_allocations` rows in this primitive. They are ledger evidence; active-versus-reversed state is determined by the explicit reversal link.

### 2. Make all three lifecycle actions use it

- **Void:** lock the invoice row at the start of the transaction, re-run the relevant guards against that locked truth, and call the primitive for a standard invoice before marking it cancelled. Keep the separate issued-credit-note clawback behavior, including its consumed-credit guard.
- **Unfinalize:** inside its existing transaction, select the invoice with `FOR UPDATE`, call the primitive before clearing `finalized_at`/setting draft, and retain the existing project-deposit rollback. A subsequent finalization starts from `credit_applied = 0` and may create a new application under current policy.
- **Hard delete:** lock the invoice first, call the primitive before deleting dependent records, and remove the entire `credit_tracking_usage` restore/delete block. Continue deleting invoice-owned transaction rows later as part of hard deletion, but only after restoration has completed. Preserve existing payment reversal, negative-invoice issued-credit protection, recurring-period guards, and resource-release behavior.

### 3. Preserve transaction and lock semantics

- Every caller performs invoice `FOR UPDATE` before any credit-row lock.
- The primitive locks all credit rows in a deterministic order to avoid application-vs-reversal and multi-credit deadlocks.
- All restoration, audit writes, invoice credit reset, and lifecycle mutation commit or roll back together.
- Concurrent apply must either finish before reversal reads active applications or wait until the lifecycle transaction completes; no interleaving may leave `credit_applied`, `remaining_amount`, and ledger history disagreeing.

## Behavioral tests

Add database-backed tests using committed setup rows and one client per test, following `creditDrawdownConcurrentApply.test.ts` rather than source-string assertions.

1. **Unfinalize reverses:** apply multiple credits/transactions, unfinalize, and assert draft status, `credit_applied = 0`, exact restoration of every `credit_tracking.remaining_amount`, and linked reversal audit rows.
2. **Re-finalize cycle is repeat-safe:** apply, unfinalize, re-finalize/apply again, unfinalize again; assert the first application is not restored twice and balances never exceed their original amounts.
3. **Hard delete restores all applications:** use more than one application transaction and more than one underlying credit, delete, and assert exact credit restoration plus invoice removal without relying on `credit_tracking_usage`.
4. **Void regression:** preserve the existing correct outcome for multiple applications and verify a second invocation cannot duplicate restoration.
5. **Concurrent apply versus each reversal path:** hold a committed application/reversal at the lock boundary and prove serialization with authoritative post-commit balances. Assert invoice-first then credit-row locking and no deadlock.
6. **Atomic failure:** inject a malformed/missing application provenance or failed credit update and prove the invoice lifecycle state and all balances remain unchanged.
7. Retain tests for consumed credit-note guards, project-deposit rollback, exported-invoice restrictions, payments, and recurring-service-period hard-delete guards.

## Deliberately out of scope

- No new UI or feature flag surface.
- No redesign of credit application ordering/eligibility policy.
- No backfill of the dead `credit_tracking_usage` table; remove its reversal dependency instead.
- No deletion or compaction of historical allocation/application ledger rows outside the existing hard-delete transaction cleanup.

## Implementation order

1. Add repeat-safe canonical primitive and focused unit/database coverage.
2. Convert void while preserving credit-note behavior.
3. Convert unfinalize and add re-finalize-cycle coverage.
4. Convert hard-delete and delete the dead usage-table path.
5. Run the focused billing action suites, concurrency suite serially, billing/server typechecks, then a live smoke covering apply → unfinalize → re-finalize and apply → hard-delete with database balance inspection.

## Review risks

- The existing primitive currently re-reads every historical application; simply calling it from unfinalize would over-credit on a second lifecycle cycle. The explicit `reversal_of` idempotency filter is mandatory.
- Hard-delete later removes transaction history; reversal must finish before that cleanup, and tests must prove restoration does not depend on rows already deleted.
- Lock acquisition hidden in helper calls can reintroduce credit-first ordering. Review every call site and test real overlap, not only isolated final values.
