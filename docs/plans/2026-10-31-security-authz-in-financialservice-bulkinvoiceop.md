# FinancialService.bulkInvoiceOperation — lifecycle authority, canonical engines

Card: `51a25fe9-625e-5916-a2c3-678d8ba02ec9` · PSA ticket `alga-2026-0003005`
Finding: **authz · high** — `server/src/lib/api/services/FinancialService.ts:1583-1644`
(`FinancialService.bulkInvoiceOperation`), reviewed on merge `dedce8256173` (PR #3985).

## What is wrong (confirmed on the branch)

`POST /api/v1/financial/bulk/invoices` reaches `ApiFinancialController.bulkInvoiceOperations`
(`server/src/lib/api/controllers/ApiFinancialController.ts:607-623`), which checks only the coarse
`update` resource permission and then hands the parsed body to
`FinancialService.bulkInvoiceOperation`. That method:

1. calls `validatePermissions('update', 'invoice', context)` (`FinancialService.ts:1587`) — **the only
   permission gate** — and then
2. writes lifecycle state with raw `UPDATE`s: `finalize` sets `status='sent', finalized_at=now`
   (`:1604-1612`), `cancel` sets `status='cancelled'` (`:1614-1621`).

So a principal holding `financial:update` + `invoice:update` but **denied `invoice:finalize`** can
finalize a draft or cancel a paid/exported invoice. The raw writes bypass every invariant the canonical
engines own: draft-only finalize, line-item presence, tax-source and export-readiness guards, hour-block
activation, prepayment/credit issuance, row locking, the audit row, post-commit events, credit claw-back
and hour-block release on void.

Two adjacent defects in the same switch, same root cause (the handler is a second, hand-rolled engine):

3. **`send` is advertised in the schema enum** (`financialSchemas.ts:785`) but has no branch — it falls
   into `default` and is reported per-invoice as `success:false, error:"Unsupported operation"`.
4. **`apply_credit` reports success without doing anything** (`:1623-1634`): it reads the invoice, does
   not write, and returns `{ applied_amount: creditAmount }` with `success:true`. A caller gets a 200 and
   a success count for an operation that never happened.

## Design

### One rule

`FinancialService.bulkInvoiceOperation` stops being an engine. It becomes a **dispatcher**: for each id it
calls the canonical service method that already owns the permission and the invariants, and records the
canonical outcome. No raw `UPDATE` of `invoices` remains in this method.

### Command table (module-level, exhaustive)

```
finalize    → InvoiceService.finalizeInvoice({ invoice_id }, context)      permission: invoice:finalize
send        → InvoiceService.sendInvoice({ invoice_id }, context)          permission: invoice:send
cancel      → new InvoiceService.voidInvoice(invoice_id, context)          permission: invoice:update
                                                                          + accounting_integrations:remote_mutate
                                                                            when an export integration is connected
apply_credit→ removed from bulkInvoiceOperationSchema; returns 400 with
              "use /api/v1/financial/invoices/:id/credit" (canonical
              InvoiceService.applyCredit, permission invoice:credit)
```

Deleting `apply_credit` from the enum is the honest fix: there is no canonical bulk-credit command, and
keeping a branch that lies about success is worse than removing it. Any client that used it was receiving
a no-op success already, so removal cannot break a working flow. `send` becomes real by delegating.

### New `InvoiceService.voidInvoice(invoiceId, context)`

The void engine currently lives only in the action layer (`packages/billing/src/actions/voidInvoiceActions.ts`,
which wraps `packages/billing/src/lib/invoiceVoidCore.ts:105 voidInvoiceLocally`). The API service needs the
same primitive without importing an action:

- lock the invoice row (`forUpdate`) inside `withTransaction`, re-read status;
- refuse non-voidable state with `ConflictError` (already finalized/paid/exported rules live in
  `invoiceVoidCore.isCreditNoteInvoice`, payment/credit-note guards and `voidHourBlocksForVoidedInvoice`);
- call `voidInvoiceLocally(trx, tenant, {...})` — hour blocks, credit claw-back, prepaid replenishment
  suppression stay exactly as the user-facing action has them;
- write the audit row and return the updated invoice.

This is deliberately a **thin service wrapper over the existing core**, not a second implementation: the
action layer and the accounting-sync applier keep working unchanged, and the API gains the same semantics.
Out of scope for this card: moving the remote-mutate enqueue out of `voidInvoiceActions` into the core.
The service method therefore enforces the remote-mutate permission itself (same denial message as the
action) so the bulk path cannot void around a connected integration's authority.

### Per-id semantics

- Each id is one independent command with its own permission check and its own transaction; one failure does
  not roll back the others (today's behaviour, kept).
- Canonical errors map to per-id failures: `NotFoundError` → "Invoice not found", `ConflictError` → its
  message ("Only draft invoices can be finalized", "This credit note has applied credit…").
- Keep `results[]` shape and the summary `BulkOperationResult`; add `outcome: 'finalized'|'sent'|'voided'`
  to each success entry so the caller can tell what actually happened.
- Keep the single summary audit row, but record the **canonical per-id outcomes** in it rather than only
  counts, and do not wrap the loop in one outer transaction (canonical engines own theirs).
- The dispatcher checks the per-operation permission **before** touching any id, so a denied principal gets
  one clear refusal instead of N failures.

### Controller

`ApiFinancialController.bulkInvoiceOperations` keeps the coarse `update` check (route-level hygiene) — the
authoritative per-command permission is the service's, consistent with the rest of `InvoiceService`.

## Order of work

1. `InvoiceService.voidInvoice` + its focused test file (guards: paid invoice, exported invoice, credit note
   with applied credit, hour-block refusal, remote-mutate denial).
2. Command table + dispatcher in `FinancialService.bulkInvoiceOperation`; delete the raw writes and the
   `apply_credit` branch; drop `apply_credit` from `bulkInvoiceOperationSchema`; wire `send`.
3. Regression test file `FinancialService.bulkInvoiceOperation.test.ts`:
   - `invoice:update` without `invoice:finalize` → refused, invoice stays `draft` (fails on main);
   - bulk finalize on a non-draft → per-id `ConflictError`, no state change;
   - bulk finalize happy path still runs the canonical engine (asserts `finalized_at`, audit row, and the
     canonical side effects, not just status);
   - bulk cancel of a paid/exported invoice → refused with the canonical reason;
   - `apply_credit` → 400 from schema parse; `send` → delegates and reports the canonical outcome.

## Deliberately not doing

- No new permission strings: reuse `invoice:finalize` / `invoice:send` / `invoice:update` +
  `accounting_integrations:remote_mutate`, exactly as the canonical paths define them.
- No change to the action layer or `invoiceVoidCore` internals in this card.
- No new bulk endpoint for credit; the single-invoice credit endpoint already has the authority model.

## Risks

- **Behaviour change for `send`**: it goes from "always fails" to real sends. Anything relying on the
  failure is broken by design; the regression test pins the new contract.
- **Behaviour change for `apply_credit`**: callers get a 400. Acceptable — it never applied credit.
- **Transaction shape**: dropping the outer transaction means a mid-loop crash leaves earlier ids committed.
  That is already the effective behaviour (each canonical engine commits its own work), and it is the only
  shape that preserves canonical invariants; the per-id `results[]` is the record.
- **Void from the API**: the first non-action caller of `voidInvoiceLocally`. The wrapper must load the
  invoice row and pass `lockedInvoice` exactly as `voidInvoiceActions` does, or the lock order changes and
  concurrent applies can interleave — the concurrency test for credit drawdown covers the pattern.
