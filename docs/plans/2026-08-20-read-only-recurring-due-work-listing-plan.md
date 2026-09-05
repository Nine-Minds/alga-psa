# Read-only recurring due-work listing + attribution write boundary

**Date:** 2026-08-20
**Branch:** `feature/make-recurring-due-work-listing-read-only-and-fi`
**Status:** proposed

## Problem

Opening **Billing → Invoicing → Generate** returns HTTP 500 with "Failed to load
billing periods". The server error is PostgreSQL `42703: column "updated_at" of
relation "usage_tracking" does not exist`.

Call chain:

```
AutomaticInvoices.loadPeriods
  -> getAvailableRecurringDueWork                          (billing:read)
    -> fetchUnresolvedNonContractDueWorkRows
      -> BillingEngine.calculateUnresolvedNonContractChargesForExecutionWindow
        -> BillingEngine.calculateUnresolvedNonContractCharges   <-- writes here
```

There are two defects, one behind the other.

### 1. Architectural: a read path performs hidden writes

`calculateUnresolvedNonContractCharges` interleaves *deciding* which contract
line covers a record with *persisting* that decision. For every unresolved
`time_entries` / `usage_tracking` row in the window it issues an `UPDATE`:

- unique eligible line → `contract_line_id`, `contract_line_source =
  'reconciled_at_generation'`, `contract_line_unresolved_reason = NULL`
- otherwise → `contract_line_source = 'unresolved'`,
  `contract_line_unresolved_reason = <ambiguous|no_match>`

Because the same method backs both the *listing* and *generation*, merely
opening or refreshing the Generate screen mutates billing source records. Every
refresh rewrites the same unresolved rows, and any failure in that write blocks
the list from loading at all — which is exactly what happened. The same
exposure exists on two further read-only paths that call `calculateBilling`:
invoice **preview** (`previewInvoice`) and **PO overage** checks
(`getPurchaseOrderOverageForSelectionInput`).

### 2. Schema: the usage write shape was copied from the time-entry path

`usage_tracking` has no `updated_at` column (nor `created_at`) — verified in
both the migration history and a migrated database. The usage branch was
written by copying the `time_entries` branch, `updated_at` included. Existing
unit coverage (`billingEngine.unresolvedReconciliation.test.ts`) asserts the
`update()` payload against a **mocked** knex builder, so it asserts the bug
rather than catching it.

Removing `updated_at` alone would silence the 500 and leave the read path
writing. Both defects are in scope.

### 3. Latent: reconciled work slips a cycle

Today's write ordering is accidental. Inside `calculateBilling`, contract-line
charges are computed *before* the non-contract section, so a record that
reconciliation assigns to a contract line is assigned **after** the queries that
would have billed it. It is billed by nobody in that run and only picked up on
the next cycle. Whichever screen happened to trigger the write first determined
when the work got billed. This plan fixes that too: reconciliation runs before
calculation, so covered work bills in the run that discovers it.

## Design

Split **decide** from **persist**, then order generation as
**reconcile → calculate → persist** inside one transaction.

```
                 ┌───────────────────────────────────────────┐
  pure           │ resolveDeterministicContractLineSelection  │  (exists)
                 │ + buildContractLineAttributionDecision     │  (new, pure)
                 └───────────────────┬───────────────────────┘
                                     │ decision (in memory)
             ┌───────────────────────┴───────────────────────┐
             ▼                                               ▼
  ┌─────────────────────────┐              ┌──────────────────────────────────┐
  │ calculateUnresolvedNon- │              │ reconcileWindowAttribution(trx)  │
  │ ContractCharges         │              │  = resolve + apply, idempotent   │
  │  NO WRITES              │              └──────────────┬───────────────────┘
  └───────────┬─────────────┘                             │
              │ listing (read-only, no reconcile)         │ generation: commit
              ▼                                           │ preview / PO: roll back
   Generate screen lists periods                          ▼
                                            calculate → persist invoice
```

### Layer 1 — the decision (pure)

`resolveDeterministicContractLineSelection` already exists in
`packages/billing/src/lib/contractLineDisambiguation.shared.ts` and is pure. Add
alongside it:

```ts
export type ContractLineAttributionDecision =
  | { kind: RecordKind; recordId: string; action: 'assign';
      contractLineId: string; source: ContractLineSource }
  | { kind: RecordKind; recordId: string; action: 'mark_unresolved';
      reason: ContractLineSelectionReason };

export function buildContractLineAttributionDecision(input: {
  kind: 'time_entry' | 'usage_record';
  recordId: string;
  selection: ReturnType<typeof resolveDeterministicContractLineSelection>;
}): ContractLineAttributionDecision;
```

The unique/ambiguous/no-match classification is unchanged — it stays in the one
shared resolver, so determinism is preserved by construction.

### Layer 2 — calculation becomes side-effect free

`BillingEngine.calculateUnresolvedNonContractCharges` writes nothing. It builds
each decision in memory and uses it exactly as it uses the write today:

- `assign` → the record is skipped (it belongs to a contract line), same as the
  current `continue`
- `mark_unresolved` → the reason is carried onto the charge via
  `unresolved_reason`, and drives the existing `requireCatalogPricingDecision`
  refusal (`UnresolvedCatalogPricingError`) unchanged

The `billing_engine.reconcile.unresolved` log line moves to decision time and
reports `persisted: false`; the writer emits its own line when a decision is
applied. Every `calculateBilling` caller — listing, preview, PO overage,
generation — is now free of writes.

### Layer 3 — one schema-aware writer

New module `packages/billing/src/lib/billing/contractLineAttributionWriter.ts`:

```ts
const ATTRIBUTION_TABLES = {
  time_entry:    { table: 'time_entries',   idColumn: 'entry_id', hasUpdatedAt: true  },
  usage_record:  { table: 'usage_tracking', idColumn: 'usage_id', hasUpdatedAt: false },
} as const;

export async function applyContractLineAttributionDecisions(
  trx: Knex.Transaction, tenant: string,
  decisions: ContractLineAttributionDecision[],
): Promise<{ assigned: number; markedUnresolved: number }>;

/** Resolve every unresolved record in a window and apply the decisions. */
export async function reconcileWindowAttribution(params: {
  trx: Knex.Transaction; tenant: string; clientId: string;
  windowStart: ISO8601String; windowEnd: ISO8601String;
}): Promise<{ assigned: number; markedUnresolved: number }>;
```

Properties:

- **One place names each table's write shape.** The `updated_at` divergence is
  data in a descriptor, not a copy-paste between two 200-line branches — this is
  the layer whose absence produced the bug.
- **Idempotent.** Assignment keeps the existing `.whereNull('contract_line_id')`
  guard; `mark_unresolved` skips rows whose stored source/reason already match,
  so re-running is a no-op and re-entry after a failed generation is safe.
- **Transactional.** Takes a `Knex.Transaction`; it never opens its own.
- **Shares the resolver** with the engine, so listing and reconciliation can
  never disagree about which records are assignable.

### Reconcile before calculate

`BillingEngine` gains a transaction-pinning entry point (`initKnex` already
short-circuits when `this.knex` is set, so this is a constructor/static
overload, not a rewrite):

```ts
static forTransaction(trx: Knex.Transaction, tenant: string): BillingEngine;
```

One helper in `invoiceGeneration.ts` then serves all three window-billing
callers:

```ts
async function calculateBillingWithReconciledAttribution(params: {
  knex; tenant; selectorInputs; persistReconciliation: boolean;
}) {
  // withTransaction:
  //   1. reconcileWindowAttribution(trx, ...)
  //   2. calculateBillingForSelectionInputs({ billingEngine: BillingEngine.forTransaction(trx, tenant), ... })
  //   3. persistReconciliation ? commit : roll back via sentinel, returning the result
}
```

Because reconciliation commits (or rolls back) *before* the charge queries read
`contract_line_id`, work covered by exactly one contract line is billed on the
contract line **in this run**, at the negotiated rate, instead of slipping a
cycle. There is no double-billing risk: the unresolved query filters
`whereNull(contract_line_id)`, so an assigned record leaves the non-contract
path the moment it enters the contract path.

| Caller | Reconciles | Persists |
|---|---|---|
| `generateInvoiceForNormalizedSelectionInputs` (generation) | yes | yes — same transaction |
| `previewInvoice` | yes | no — rolled back |
| `getPurchaseOrderOverageForSelectionInput` | yes | no — rolled back |
| `getAvailableRecurringDueWork` (listing) | **no** | no |
| `calculateProjectBilling` / standalone project invoices | no change | — |

Preview and the PO check reconcile-then-roll-back so that what they show is
exactly what generation will produce; they remain observably read-only. The
listing does not reconcile at all: it never prices contract lines from source
records (hourly lines read "calculated at generation"), so an overlay would buy
it nothing, and staying strictly read-only is the point of this change.

`calculateProjectBilling` already skips contract-line resolution entirely under
`projectTarget`, so the project path is untouched.

### Additional write boundary: usage record create/edit

`createUsageRecord` / `updateUsageRecord` already resolve a default contract
line but never record `contract_line_source` / `contract_line_unresolved_reason`
— asymmetric with `timeEntryCrudActions.ts:501-518`, which does. Make them write
attribution through the shared decision. Records then arrive attributed and
rarely need window reconciliation at all.

## Behaviour change to call out

Covered-but-unattributed work now bills in the run that discovers it rather than
the next one. For the first generation after deploy, an invoice may include
work from earlier periods that had been silently deferred — correct, but worth
flagging in the PR description and to whoever runs the first billing cycle. No
work is billed twice, and nothing that was previously billed stops being billed.

## Deliberately not done

- **Adding `updated_at` to `usage_tracking`.** Nothing reads it; adding a column
  to a Citus-distributed table to satisfy one copy-pasted write is the wrong
  direction. The descriptor plus a schema-conformance test is the fix.
- **A reconciliation cron/background job.** Generation, preview, and record
  create/edit cover every path that matters, and the unresolved review queue
  (`unresolvedChargeActions`) already recomputes eligibility live and treats the
  persisted reason as possibly stale.
- **Spanning invoice persistence in the reconcile transaction.**
  `createInvoiceFromBillingResult` opens its own transactions internally;
  threading one through it is a large refactor of the most sensitive code in the
  product. Reconciliation is a fact about the record, not an artifact of the
  invoice, and it is idempotent — so committing it with the calculation and
  letting invoice persistence follow is safe, and a failed generation leaves
  correct, re-runnable state.
- **Parallelising the per-period engine calls** in
  `fetchUnresolvedNonContractDueWorkRows`. The "keep these calls serial" comment
  is updated (reconciliation is no longer the reason), but the engine still pins
  `this.knex` per instance, so parallelising needs a per-period engine — a
  separate performance change.
- **No migration.** No schema change is required.

## Tests

1. **Read-only listing (integration, real schema).** Attach a knex `query`
   listener; call `getAvailableRecurringDueWork` over a window containing
   unassigned time entries and usage records, including one usage record with a
   uniquely eligible contract line. Assert: no non-`SELECT` statement touches
   `time_entries` / `usage_tracking`, and a row-level snapshot of both tables is
   byte-identical before and after. Call it twice to cover refresh.
2. **Listing content unchanged.** The uniquely-assignable record is absent from
   the unresolved rows; ambiguous and no-match records are present with the
   correct `unresolved_reason`. Extends
   `server/src/test/unit/billing/nonContractDueWork.integration.test.ts`.
3. **Same-run billing (integration, real schema).** Generate over a window
   holding a uniquely-assignable usage record and time entry: the invoice
   contains them **on their contract line** at the contract rate, they are
   marked invoiced, `contract_line_source = 'reconciled_at_generation'`, and
   they appear exactly once across all charges. This is the production-schema
   check too — the usage write must succeed with no `updated_at` column present.
4. **Preview matches generation.** Preview the same window, then generate it;
   the charge sets match. Assert preview left `time_entries` / `usage_tracking`
   byte-identical (the reconcile transaction rolled back).
5. **Failed generation leaves re-runnable state.** Force an abort after
   reconciliation (e.g. `UnresolvedCatalogPricingError`): assignments are
   consistent, no invoice exists, and re-running generation succeeds and bills
   each record once.
6. **Writer idempotency (unit).** Applying the same decision set twice yields
   `{ assigned: 0, markedUnresolved: 0 }` on the second run.
7. **Schema conformance (integration).** For every entry in
   `ATTRIBUTION_TABLES`, assert `hasUpdatedAt` matches `information_schema
   .columns` on the migrated database. This is the guard that would have caught
   the original defect.
8. **Rewrite `billingEngine.unresolvedReconciliation.test.ts`** to assert the
   returned decisions rather than mocked `update()` payloads — the mock-shaped
   assertion is what let a non-existent column ship.
9. **PO overage read-only.** Statement-listener assertion on
   `getPurchaseOrderOverageForSelectionInput`.

## Verification

- Local stack on this worktree (`alga-psa-local-test`, port 3151) — the dev
  database matches production here: `usage_tracking` has no `updated_at`.
- Seed a client with an unassigned usage record (uniquely assignable), an
  ambiguous time entry, and a no-match entry. Load **Billing → Invoicing →
  Generate**: periods list with no 500, and both tables are unchanged after
  repeated refreshes. Preview the period, confirm the tables are still
  unchanged, then generate and confirm the assignable record billed on its
  contract line in that invoice.

## Work breakdown

1. Add `ContractLineAttributionDecision` + `buildContractLineAttributionDecision`
   to `contractLineDisambiguation.shared.ts`.
2. Add `contractLineAttributionWriter.ts`: table descriptor,
   `applyContractLineAttributionDecisions`, `reconcileWindowAttribution`.
3. Remove both `UPDATE` blocks from
   `calculateUnresolvedNonContractCharges`; build decisions in memory and adjust
   the log lines.
4. Add `BillingEngine.forTransaction(trx, tenant)`.
5. Add `calculateBillingWithReconciledAttribution` and route generation,
   preview, and the PO-overage check through it.
6. Write attribution source/reason in `createUsageRecord` / `updateUsageRecord`.
7. Update the stale "may reconcile as it reads" comments in
   `fetchUnresolvedNonContractDueWorkRows` and
   `calculateUnresolvedNonContractChargesForExecutionWindow`.
8. Tests 1-9 above.
