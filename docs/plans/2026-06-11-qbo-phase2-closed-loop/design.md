# QBO Phase 2: Closed-Loop Accounting Sync — Design

## Context

Phase 1 (branch `release/qbo-online-integration`, commit `01ff24f662`) re-enabled the
QuickBooks Online integration: tenant-owned OAuth with app fallback, EE gating, live
item/tax/term mappings, and operator-driven invoice export batches through
`QuickBooksOnlineAdapter` (`packages/billing/src/adapters/accounting/quickBooksOnlineAdapter.ts`).

What ships today is a one-way invoice push. Nothing reads payment state back from QBO,
credits cannot be exported (QBO rejects negative-total invoices), sync only happens when
an operator creates a batch, and invoice screens give no indication of sync state. This
phase closes the loop: payments flow back, credits and voids flow out, sync runs on a
schedule, and every invoice can answer "am I in QuickBooks, and do we agree?"

## Goals

- Payments recorded in QBO appear in Alga automatically (status, AR, portal all truthful).
- Credit notes export as QBO CreditMemos, including their application to invoices.
- Sync runs unattended on a schedule; manual batches remain as a manual trigger.
- Per-invoice sync status visible on invoice screens, with drift detection.
- Customer linking is explicit (mapping UI + first-connect reconciliation) so connecting
  to an established QBO file never duplicates customers or invoices.
- Connection health (token expiry, auth failure) alerts billing admins before exports fail.
- Alga-originated payments (client portal / Stripe) and voids propagate to QBO.

## Non-goals (this phase)

- Importing QBO-originated documents into Alga (invoices, credit memos, refund receipts
  created in QBO surface as exceptions or stats, never auto-import).
- Expense/bill/PO sync, QBO Automated Sales Tax reconciliation.
- Intuit inbound webhooks (latency optimization for hosted; polling covers all deployments).
- Changes to the credit pool ledger (`credit_tracking` FIFO pools, expirations) beyond the
  semantics fixes below.

## Decisions

**QBO is authoritative for payment state; Alga pushes both ways.** Payments recorded in
QBO flow into Alga as real AR records; payments originating in Alga (Stripe portal flow)
are pushed to QBO as `Payment` objects. Conflicts resolve in QBO's favor.

**Transport is change polling, scheduled through the job abstraction.** QBO's Change Data
Capture API returns all changed entities since a timestamp in one call. A per-tenant
recurring job registered via `IJobRunner` (`packages/jobs/src/lib/jobs/interfaces/IJobRunner.ts`)
polls it — Temporal where available, pg-boss otherwise. One code path serves hosted and
on-prem appliances (which cannot receive Intuit webhooks).

**Credit semantics are reshaped before credit sync is built.** Today
`applyCreditToInvoice` decrements `invoices.total_amount`
(`packages/billing/src/actions/creditActions.ts:910`). Posted documents must be immutable:
application moves the derived balance due, not the total. The credit system is young
enough that fixing this now is cheap; syncing on top of mutable totals would bake the
defect into every connected tenant's books.

**Real void semantics are introduced.** Alga currently only hard-deletes invoices.
A `voidInvoice` action uses the existing-but-unused `cancelled` status and
`invoice_cancelled` transaction type, retains the document, and voids the linked QBO
invoice. Hard delete is blocked for exported invoices.

**Architecture: one central sync engine over the existing rails** (adapter registry,
`tenant_external_entity_mappings`, export batches) rather than per-feature jobs or a
return to the event-bus push model retired in October 2025. Operator batches become a
manual trigger of the same pipeline the scheduler drives.

## Sync engine

The engine is adapter-agnostic so Xero can adopt it later. Two new adapter capabilities
extend `AccountingExportAdapterCapabilities`:

- `supportsChangePolling` — adapter implements `fetchChanges(since)`; QBO backs it with CDC.
- `supportsPaymentRecording` — adapter can create payments in the external system.

### Scheduling

`accounting-sync-cycle` runs per tenant×realm every 15 minutes (singleton-keyed so cycles
never overlap), registered through `IJobRunner` on connect, deregistered on disconnect,
re-registered for connected tenants at startup (`server/src/lib/jobs/initializeScheduledJobs.ts`
pattern). A *Sync now* button in settings and on invoice detail triggers an immediate run.

### Data model

- `accounting_sync_cycles` — run history and cursor:
  `cycle_id, tenant, adapter_type, target_realm, status, started_at, finished_at,
  cursor_before, cursor_after, stats jsonb, error`. The next cycle polls from the last
  successful `cursor_after` minus a 5-minute overlap window.
- `accounting_sync_operations` — outbound work queue:
  `op_id, tenant, adapter_type, target_realm, operation, alga_entity_type, alga_entity_id,
  status (pending|in_progress|done|failed|skipped), attempts, last_error, payload jsonb,
  created_at, processed_at`. Operations: `export_invoice`, `export_credit_memo`,
  `apply_credit`, `record_payment`, `void_invoice`. Producers insert; only the cycle drains.
- `tenant_external_entity_mappings` remains the single ledger of what is linked and
  whether it agrees, extended to map payments (QBO `Payment` id ↔ `invoice_payments` row).
  Mapping a payment doubles as inbound idempotency and echo suppression.

### Cycle algorithm (per tenant×realm)

1. **Token health.** Refresh token expiring within 14 days → notify billing admins.
   Hard auth failure → mark the connection expired, notify, abort without advancing the cursor.
2. **Inbound.** One `fetchChanges` call for `Customer, Payment, Invoice, CreditMemo`;
   apply in that order (customers → payments → document drift).
3. **Outbound.** Drain pending operations in dependency order. Invoice exports are grouped
   into an auto-created batch (`origin: 'scheduled'`) that runs the existing
   validate→transform→deliver pipeline, so scheduled and manual exports share one code
   path, error surface, and audit trail. Manual batch creation marks matching queue ops done.
4. Advance the cursor only after inbound application succeeds. Outbound failures retry
   with capped backoff, then become exceptions; they never block the cursor.

## Inbound semantics

### Payments

A QBO `Payment` carries per-invoice allocations in `Line[].LinkedTxn`; application is per
allocation, not per payment total.

- Linked QBO invoices resolve through the mapping ledger. Unmapped → exception, never a guess.
- Application goes through `recordExternalPayment`, refactored out of the Stripe webhook's
  `recordPaymentFromWebhook` (`ee/server/src/lib/payments/PaymentService.ts:598`) so all
  providers land payments identically: insert `invoice_payments` (method `quickbooks`,
  reference = QBO payment number), re-sum, set `paid` / `partially_applied` against the
  derived balance due, write a `payment` transaction with `{qbo_payment_id, realm}` metadata.
- **Edits and deletes are first-class**: a changed payment (sync token moved) is reversed
  and reapplied from its current allocations; a deleted payment writes `payment_reversal`
  transactions and recomputes status. Bookkeepers fix mistakes; the sync must follow.
- Unapplied/overpayment portions stay in QBO as customer credit (cycle stats only).
  Currency mismatch → exception. `RefundReceipt`s are surfaced, not applied.

### Drift detection

Deliver already stores the QBO sync token in mapping metadata; it additionally snapshots
the exported total. Inbound document changes compare against the snapshot:

- **Material drift** — total changed, document voided/deleted in QBO, or doc number
  changed → mapping `sync_status: 'drift'` plus an exception carrying both versions.
  Resolutions: *Re-export from Alga* (sparse-update QBO back to Alga's truth) or *Accept*
  (refresh the snapshot; Alga documents are immutable, so acceptance acknowledges rather
  than imports).
- Balance movement alone is not drift — payments and credit applications move balances.
- Documents with no mapping (created directly in QBO) are ignored by design, counted in stats.

### Customers

Renames refresh the mapping's cached display name (linkage is by id). A mapped customer
deleted/merged/inactive in QBO → exception deep-linking to the customer mapping tab.
Alga clients are never auto-created from QBO customers.

## Outbound semantics

### Auto-export on finalize

`finalizeInvoice` (`packages/billing/src/actions/invoiceModification.ts`) enqueues
`export_invoice` when the tenant has a connected realm and auto-sync enabled (per-tenant
setting; defaults on once slice 1 is validated). Validation failures (missing mappings)
become inbox exceptions rather than silent batch errors.

### Credit reshape

- `applyCreditToInvoice` stops decrementing `total_amount`. Balance due becomes derived:
  `total_amount − credit_applied − payments`, computed by a shared `computeBalanceDue`
  helper. Read-site audit covers invoice list/detail, client portal, overdue detection,
  and the Stripe payment-link amount (must charge balance due).
- Backfill: the historical mutation is recoverable —
  `total_amount += credit_applied` restores original totals in one migration.
- Credit notes get explicit identity: `invoice_type` (`standard | credit_note | prepayment`)
  subsuming `is_prepayment` and negative-total detection, plus a `CM-` number sequence.

### Credit memo export

Finalizing a credit note enqueues `export_credit_memo`: lines sign-flip into a QBO
`CreditMemo` using the same item/tax mappings, tracked in the mapping ledger. Prepayment
invoices are excluded with a clear validation message (they are unearned revenue, not
revenue reversal — a later phase can map them to QBO unapplied payments). When Alga
applies credit to an invoice, `apply_credit` pushes QBO's canonical linkage — a
zero-dollar `Payment` linking CreditMemo to Invoice — keyed to the `credit_allocations`
row for idempotency.

### Voids

New `voidInvoice` action (reason required): status → `cancelled`, write an
`invoice_cancelled` transaction, auto-reverse applied credits back into their pools.
Void is blocked while payments exist — unwind the payment first. `hardDeleteInvoice`
is blocked for any exported invoice. Outbound, `void_invoice` calls QBO's void operation;
the mapping becomes `voided`. A QBO-side void arrives as drift.

### Alga-originated payments

The Stripe webhook success path additionally enqueues `record_payment` when QBO is
connected. The cycle creates a QBO `Payment` against the mapped customer and invoice
(reference = Stripe id), deposited to a tenant-configured account (default *Undeposited
Funds*; a new `getQboAccounts` action mirroring `getXeroAccounts` feeds the picker).
Echo suppression is structural: the payment's mapping row is written at push time, so the
next CDC poll sees it already mapped.

### Class/Department tracking

Per-line `ClassRef` rides item-mapping metadata JSON (the `enableJsonEditor` pattern the
Xero modules use for `accountCode`/`tracking`), with optional tenant-level default class
and department in QBO settings. Header-level `DepartmentRef` comes from the tenant default.

## UI surfaces

- **Per-invoice sync badge** (pattern: `packages/billing/src/components/invoices/InvoiceTaxSourceBadge.tsx`)
  on invoice list and detail, read from the mapping ledger plus the ops queue:
  `Not synced | Queued | Synced | Drift | Error | Voided`. Synced tooltip shows the QBO
  doc number, last-synced time, and an environment-aware deep link into QBO. Detail view
  adds *Sync now* and *View in QuickBooks*.
- **Settings health panel** in `QboIntegrationSettings`: last cycle result, next run,
  pending-ops/exception/drift counts (deep-linked to the inbox), refresh-token expiry
  countdown, *Sync Now*, and the new tenant controls (auto-sync toggle, deposit account,
  default class/department).
- **Customer mapping tab** (fourth live-mapping tab): Alga clients ↔ QBO customers via a
  new `getQboCustomers` action. Per row: link existing, create in QBO now, or leave for
  first-export auto-provision. Exact display-name matches bulk-acceptable; fuzzy matches
  stay human-confirmed.
- **First-connect reconciliation wizard** (re-runnable from settings):
  1. Customers — exact matches pre-linked, near-matches reviewed.
  2. Historical invoices — optional matching by doc number + amount, writing mappings
     *without exporting* so history never duplicates; ambiguous candidates go to a review
     list, never guessed.
  3. Go-live cutoff — "auto-sync invoices finalized after [date]" (default today), the
     fence that keeps a connect from exporting a year of already-booked invoices.
- **Multi-realm**: with more than one connected realm, the connection card becomes a list
  with *make default*, and the batch dialog/wizard gain a realm picker. Single-realm
  tenants see none of it. Cycles, cursors, and badges are per-realm from the start.

## Exceptions and notifications

Exceptions are workflow tasks in the existing inbox
(`WorkflowTaskModel.createTask`, `shared/workflow/persistence/workflowTaskModel.ts:119`).
New system task definitions — folding in the never-wired `qbo_mapping_error` type:
`accounting_sync_drift`, `accounting_sync_unmapped_payment`, `accounting_sync_export_error`,
`accounting_sync_customer_unlinked`, `accounting_connection_expired` — each with context
data and resolution actions. **One open task per entity+type**: cycles update the existing
task instead of filing duplicates every 15 minutes.

Notifications go to users with `billing_settings` update permission via the internal
notification + email primitives
(`packages/notifications/src/actions/internal-notification-actions/internalNotificationActions.ts`):
connection expired/auth failure immediately, token expiry at 14/7/2 days, and a per-cycle
summary only when new exceptions appeared.

## Testing

Automated coverage targets the ~80% that is cheap to pin down; the rest is validated live
against the Intuit sandbox.

- **Unit**: cycle orchestration with a mocked adapter (cursor advance/overlap, op
  ordering, retry caps, echo suppression); payment applier matrix (apply, partial,
  multi-invoice, edit, delete, unmapped, currency mismatch); drift comparator; credit
  reshape invariants (application never mutates `total_amount`; balance-due derivation;
  backfill round-trip); void rules (blocked with payments, credit unwind); CreditMemo
  sign-flip transform.
- **Integration**: one DB-backed full-cycle test (seeded tenant, mocked QBO client) on the
  `server/src/test/integration/accounting/xeroLiveExport.integration.test.ts` harness pattern.
- **UI contract**: badge states, health panel, wizard step gating, customer mapping tab.
- **Live smoke checklist**: connect → wizard against a pre-seeded QBO sandbox file →
  finalize/auto-export → pay in QBO → status flips → edit then delete the payment →
  credit note → apply → void → portal Stripe payment appears in QBO → token-expiry alert.

## Ship sequence

Four independently shippable slices, all behind the existing EE gate. Auto-sync defaults
off until slice 1 is validated live, then on.

1. **Closed loop** — sync engine, CDC payment pull, per-invoice badge, health panel,
   token alerting. Introduces `computeBalanceDue` matching current behavior so payments
   do not wait on the credit reshape.
2. **Credits & voids** — credit reshape + backfill, credit-note identity, CreditMemo
   export, `apply_credit` linkage, `voidInvoice` + propagation.
3. **Onboarding** — customer mapping tab, reconciliation wizard, go-live cutoff.
4. **Polish** — Stripe payments pushed to QBO, class/department tracking, multi-realm UX;
   Intuit webhooks for hosted latency as a stretch.

## Risks

- The credit reshape's read-site audit is the riskiest mechanical step — any display or
  charge amount still treating `total_amount` as "amount due" after the backfill will be
  wrong in the opposite direction. The audit list and the backfill ship in the same slice
  with the derivation helper.
- `JobScheduler.scheduleRecurringJob` currently coerces intervals to 24 hours
  (`server/src/lib/jobs/jobScheduler.ts:184`); the 15-minute cadence must go through the
  `IJobRunner` abstraction's shorter-interval path (the 30-minute Gmail watch renewal is
  the precedent) or fix the coercion.
- CDC cursor correctness under QBO clock skew is handled by the overlap window plus
  idempotent appliers; the overlap makes duplicate delivery routine, so appliers must be
  no-ops on already-mapped, unchanged entities by construction.
- Xero adoption of the engine is deliberately deferred but constrains naming and schema
  (`adapter_type` columns everywhere, no `qbo_` prefixes in shared tables).
