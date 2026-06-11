# PRD: QBO Closed-Loop Sync — Slice 1

- **Status:** Draft
- **Owner:** Robert Isaacs
- **Created:** 2026-06-11
- **Design:** `./design.md` (architecture authority; this PRD details slice 1)
- **Branch:** feature branches off `release/qbo-online-integration`

## 1. Problem statement & user value

Phase 1 shipped a one-way, operator-driven invoice push to QuickBooks Online.
The moment a client pays an invoice in QBO, Alga is wrong: AR status, the
client portal, and collections all show unpaid until someone reconciles by
hand. There is also no automation (an operator must remember to create export
batches), no per-invoice answer to "is this in QuickBooks?", and a dead
connection is discovered only when an export fails.

Slice 1 closes the loop for the highest-value flows: a scheduled sync engine
pulls QBO payments into Alga as real AR records, pushes newly finalized
invoices out automatically, detects drift on exported invoices, surfaces sync
state on every invoice, and warns billing admins before the connection breaks.

## 2. Goals (slice 1)

- A per-tenant×realm sync cycle runs every ~15 minutes unattended, on Temporal
  or pg-boss via the `IJobRunner` abstraction, identically on hosted and appliance.
- Payments recorded in QBO (including edits and deletions) are applied to Alga
  invoices within one cycle: `invoice_payments` row, `payment` transaction,
  status flip to `paid`/`partially_applied`.
- Finalizing an invoice auto-enqueues its export; the cycle delivers it through
  the existing batch pipeline (auto-batches, `origin: 'scheduled'`).
- Exported invoices changed or voided in QBO are flagged as drift with
  re-export / accept resolutions.
- Every invoice shows a sync badge (`Not synced | Queued | Synced | Drift |
  Error | Voided`) with a deep link into QBO; the QBO settings page shows
  cycle health and pending work.
- Refresh-token expiry and auth failures notify billing admins (14/7/2-day
  countdown; immediate on failure).
- Sync exceptions land in the existing workflow-task inbox, deduplicated to
  one open task per entity+type.

## 3. Non-goals (slice 1)

- Credit memo export, credit reshape, voids (slice 2 — outlined in §9).
- Customer mapping UI, reconciliation wizard, go-live cutoff (slice 3).
- Outward Stripe-payment push, class/department tracking, multi-realm UX,
  Intuit webhooks (slice 4).
- Importing QBO-originated documents; `RefundReceipt` handling (surface only).
- Monitoring/metrics beyond the cycle stats already in the design.

## 4. Personas & primary flows

- **MSP billing admin:** connects QBO (phase 1), leaves auto-sync on; finalized
  invoices appear in QBO within a cycle; when clients pay, Alga flips to paid
  by itself. Checks the settings health panel when something looks off; works
  sync exceptions from the task inbox.
- **MSP bookkeeper (in QBO):** records, edits, or deletes payments in QBO as
  the book of record; Alga follows without being told.
- **Operator (existing flow):** can still create manual export batches; they
  ride the same pipeline and satisfy any queued auto-export ops.

## 5. Functional scope (slice 1 detail)

### 5.1 Sync engine

Per `design.md` §Sync engine: `accounting_sync_cycles` (cursor + run history),
`accounting_sync_operations` (outbound queue), new adapter capabilities
`supportsChangePolling`/`fetchChanges(since)` (QBO: CDC) and
`supportsPaymentRecording` (declared now, used in slice 4). Cycle order: token
health → inbound (customers, payments, invoice drift) → outbound drain →
cursor advance (inbound success only; outbound failures retry with capped
backoff, then become exceptions). 5-minute cursor overlap; all appliers
idempotent against the mapping ledger. Scheduling registered on connect /
deregistered on disconnect / re-registered at startup; singleton-keyed per
tenant×realm. "Sync now" triggers an immediate cycle.

### 5.2 Inbound payments

Per-allocation application from `Payment.Line[].LinkedTxn` via a shared
`recordExternalPayment` service refactored out of
`PaymentService.recordPaymentFromWebhook` (Stripe behavior unchanged).
Idempotency/echo-suppression via payment mapping rows
(`alga_entity_type: 'invoice_payment'`). Payment edits reverse-and-reapply;
deletions write `payment_reversal` and recompute status. Unmapped invoice,
currency mismatch → exceptions. Unapplied amounts → cycle stats only.
Status flip uses a `computeBalanceDue` helper that matches current behavior
(slice 2 swaps its internals for the credit reshape).

### 5.3 Invoice drift detection

Deliver snapshots exported total alongside the existing sync token in mapping
metadata. Inbound invoice changes with a moved sync token compare totals /
void state / doc number; material drift sets `sync_status: 'drift'` and files
an exception with both versions and two actions: re-export (sparse update QBO
to Alga's truth) or accept (refresh snapshot). Balance-only movement is not
drift. Unmapped QBO invoices are counted, not imported.

### 5.4 Auto-export on finalize

`finalizeInvoice` enqueues `export_invoice` when a realm is connected and the
tenant's auto-sync setting is on (default off until slice 1 is validated live,
then on). The cycle groups pending ops into one scheduled batch through the
existing validate→transform→deliver pipeline; validation failures become
inbox exceptions. Manual batches mark matching ops done.

### 5.5 Exceptions & notifications

New system task definitions (folding in the unwired `qbo_mapping_error`):
`accounting_sync_drift`, `accounting_sync_unmapped_payment`,
`accounting_sync_export_error`, `accounting_connection_expired`. One open task
per entity+type; cycles update rather than duplicate. Notifications (internal +
email, to users with `billing_settings` update): connection expired/auth
failure immediately; token expiry at 14/7/2 days; per-cycle summary only when
new exceptions appeared.

### 5.6 UI

- **Invoice sync badge** (list + detail; `InvoiceTaxSourceBadge` pattern) fed
  by mapping ledger + ops queue; tooltip with QBO doc number, last-synced
  time, environment-aware deep link; detail actions *Sync now* / *View in
  QuickBooks*.
- **Settings health panel** in `QboIntegrationSettings`: last cycle result,
  next run, pending/exception/drift counts (deep-linked to inbox), token
  expiry countdown, *Sync Now*, auto-sync toggle.

## 6. Data model & API notes

- New tables `accounting_sync_cycles`, `accounting_sync_operations`
  (columns in `design.md`); Citus-distributed on `tenant` like the
  `accounting_export_*` tables.
- `tenant_external_entity_mappings` gains payment mappings (no schema change;
  new `alga_entity_type` value) and the exported-total metadata snapshot.
- `accounting_export_batches` gains an `origin` discriminator
  (`manual | scheduled`).
- Tenant settings: auto-sync flag (+ slice-4 placeholders deferred).
- QBO API surface: ChangeDataCapture endpoint added to `QboClientService`;
  no other new external calls in slice 1.

## 7. Risks & open questions

- `scheduleRecurringJob` coerces intervals to 24h — use the short-interval
  path or fix the coercion (see SCRATCHPAD gotchas).
- Payment reverse-and-reapply must be transactional per payment; partial
  application crashes mid-cycle must not double-apply (idempotency tests
  cover this).
- Refactoring `recordPaymentFromWebhook` touches the live Stripe path —
  regression risk is mitigated by keeping its tests green and behavior
  byte-identical.
- Open: exact deep-link URL format for QBO sandbox vs production (resolve
  during implementation; environment is already known per connection).

## 8. Acceptance criteria / definition of done

- All slice-1 features in `features.json` implemented; automated tests in
  `tests.json` (mode `automated`) green; existing Stripe payment and Xero
  suites unaffected.
- Live Intuit-sandbox smoke (mode `live-smoke` in `tests.json`) executed and
  passing: connect → finalize → auto-export within a cycle → pay in QBO →
  Alga flips paid → edit payment → amounts follow → delete payment → reversal
  → drift (edit invoice total in QBO) → exception with working re-export →
  token alert fires when expiry forced.
- Auto-sync default flipped on only after the smoke passes.

## 9. Later slices (outline only — re-plan each when it starts)

- **Slice 2 — Credits & voids:** credit reshape (immutable totals + backfill,
  `invoice_type`, CM- numbering, balance-due read-site audit incl. Stripe
  payment-link amount), CreditMemo export, `apply_credit` zero-dollar Payment
  linkage, `voidInvoice` action + QBO void propagation, delete-blocking.
- **Slice 3 — Onboarding:** customer mapping tab (`getQboCustomers`),
  first-connect reconciliation wizard (customers → historical invoice matching
  without export → go-live cutoff).
- **Slice 4 — Polish:** Stripe payments pushed to QBO (deposit account
  picker via `getQboAccounts`), class/department tracking via mapping
  metadata + tenant defaults, multi-realm UX, optional Intuit webhooks for
  hosted latency.
