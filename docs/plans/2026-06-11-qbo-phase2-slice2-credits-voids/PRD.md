# PRD: QBO Closed-Loop Sync — Slice 2: Credits & Voids

- **Status:** Draft
- **Owner:** Robert Isaacs
- **Created:** 2026-06-11
- **Design:** `../2026-06-11-qbo-phase2-closed-loop/design.md`
- **Depends on:** Slice 1 (sync engine, ops queue, exceptions framework, `computeBalanceDue` helper)

## 1. Problem statement & user value

MSPs issue credits constantly — SLA penalties, billing disputes, true-downs —
and QBO rejects negative-total invoices, so today credits are the records most
likely to force manual double-entry. Worse, Alga's credit application mutates
the posted invoice's `total_amount` (`creditActions.ts:910`), a semantic no
accounting system can sync against. Separately, Alga can only hard-delete
invoices; once documents live in QBO, deletion without a void leaves the books
disagreeing and destroys the cross-system audit trail.

This slice fixes the credit semantics while the credit system is barely used,
then ships credit memo export with application linkage and real void support —
the remaining document flows a bookkeeper expects from an accounting
integration.

## 2. Goals

- Posted invoice totals are immutable; credit application moves the derived
  balance due. Historical data backfilled losslessly.
- Credit notes are first-class: explicit `invoice_type`, their own `CM-`
  number sequence, exported to QBO as `CreditMemo`s through the existing
  pipeline.
- Applying credit to an exported invoice reconciles in QBO (zero-dollar
  `Payment` linking CreditMemo → Invoice), so both systems agree on balances.
- A `voidInvoice` action voids (not deletes) finalized invoices and credit
  notes, propagating the void to QBO; hard delete is blocked for exported
  documents.

## 3. Non-goals

- Importing QBO-originated CreditMemos (exceptions only, per design).
- Prepayment export of any kind (prepayments are excluded from CreditMemo
  export with a validation message; mapping them to QBO unapplied payments is
  future work, not scheduled in any slice).
- Un-applying credit / application reversal sync (Alga-side unapply, if used,
  surfaces as an exception rather than auto-reconciling in QBO).
- Refund receipts / cash refunds.
- Changes to the credit pool ledger internals (`credit_tracking` FIFO,
  expirations, reconciliation job).

## 4. Personas & primary flows

- **MSP billing admin:** issues a credit note (negative invoice) for a service
  dispute; on finalize it appears in QBO as a CreditMemo within a cycle.
  Applies it to an open invoice in Alga; the QBO invoice balance drops to
  match. Voids a mis-issued invoice with a reason; QBO shows it voided.
- **MSP bookkeeper (in QBO):** sees credits and voids arrive as proper
  documents — CreditMemos and voided invoices — not mystery edits.
- **Client (portal):** sees balance due (after credits), and pays exactly
  that via the Stripe link.

## 5. Functional scope

### 5.1 Credit reshape (lands first, own PR)

- `applyCreditToInvoice` stops decrementing `invoices.total_amount`; it only
  increments `credit_applied` (and the existing transaction/allocation/pool
  writes are unchanged).
- `computeBalanceDue` (introduced in slice 1) becomes the real derivation:
  `total_amount − credit_applied − payments`. All amount-due read sites switch
  to it. Known sites to audit (enumerate findings in SCRATCHPAD as the audit
  runs): MSP invoice list/detail, client portal invoice list/detail/pay page,
  Stripe payment-link amount (`getOrCreateInvoicePaymentLinkUrl`), overdue
  detection, invoice PDF/email templates that render an amount due, accounting
  export selectors that reason about settledness.
- Backfill migration: `total_amount += credit_applied` where
  `credit_applied > 0` (down migration reverses). Lossless because the
  historical mutation preserved both operands.
- `invoice_type` column: `standard | credit_note | prepayment`; backfilled
  from `is_prepayment` and negative totals; `is_prepayment` retained but
  derived. Finalizing a negative-total invoice sets `credit_note`.
- Credit notes draw document numbers from their own sequence with a `CM-`
  prefix, configurable alongside the existing invoice numbering settings.

### 5.2 CreditMemo export

- Finalizing a credit note (auto-sync on) enqueues `export_credit_memo`;
  manual batches may include credit notes through the same selector (the
  preview already carries a `credit_memo` flag).
- Adapter transform sign-flips lines into a QBO `CreditMemo`, reusing
  item/tax mappings and the tax-delegation behavior; mapping ledger rows use
  `external_entity_type: 'CreditMemo'` with sync-token + total snapshot
  (drift baseline).
- Prepayment invoices are excluded from export with a clear validation
  message.
- Slice 1's drift detection extends to CreditMemos (CDC already polls them).

### 5.3 Credit application linkage

- `applyCreditToInvoice` enqueues `apply_credit` keyed to the
  `credit_allocations` row when the tenant has a connected realm.
- The cycle processes `apply_credit` only when both the credit note and the
  target invoice are mapped; otherwise the op stays pending with a reason
  (it drains naturally once exports complete).
- Execution creates a zero-dollar QBO `Payment` whose lines link the
  CreditMemo and Invoice with the applied amount; a mapping row keyed to the
  allocation provides idempotency and echo suppression.

### 5.4 Voids

- `voidInvoice` action (EE-independent core billing change; reason required;
  `billing_settings`-equivalent invoice permission): status → `cancelled`,
  writes an `invoice_cancelled` transaction, auto-reverses credit
  applications (pool/balance restoration + reversal transactions). Blocked
  while payments exist. Applies to invoices and unapplied credit notes;
  applied credit notes must be unwound first.
- Invoice detail UI: Void action with confirmation dialog + reason field.
- `hardDeleteInvoice` blocked when an external mapping exists; the error
  directs to void.
- Outbound `void_invoice` op calls QBO's void operation; mapping status →
  `voided`; badge (slice 1) renders it.

## 6. Data model & API notes

- Migrations: `invoices.invoice_type` (+ backfill), `total_amount` backfill,
  credit-note number sequence settings.
- New ops on `accounting_sync_operations`: `export_credit_memo`,
  `apply_credit`, `void_invoice` (enum values exist from slice 1's table).
- QBO API surface added to the adapter/client: CreditMemo create/update,
  zero-dollar Payment create, Invoice/CreditMemo void operation.

## 7. Risks & open questions

- The read-site audit is the riskiest step; an unmigrated site shows inflated
  amounts after backfill. Mitigation: the audit feature requires the
  enumerated-site list in SCRATCHPAD before the backfill merges, and the
  backfill + derivation ship in the same release.
- Stripe payment links start charging balance due — a behavior fix, but call
  it out in release notes.
- Tax handling on CreditMemos mirrors invoices (internal vs delegated); the
  sign-flip must keep tax lines consistent — covered by transform tests.

## 8. Acceptance criteria / definition of done

- All features in `features.json` implemented; automated tests green;
  slice-1 suites and existing credit/Stripe suites unaffected.
- Live sandbox smoke: credit note → CreditMemo in QBO → apply in Alga → QBO
  invoice balance drops to match → both systems agree on customer balance;
  void an exported invoice → QBO shows voided; portal payment link charges
  balance due after a partial credit.
