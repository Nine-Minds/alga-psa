# Shared accounting sync and Xero two-way reconciliation — implementation plan

Card: Complete shared accounting sync and Xero two-way reconciliation
Worktree branch: `feature/complete-shared-accounting-sync-and-xero-two-way` (stacked on `feature/co-managed-it`)
Date: 2026-09-13

## Planning note (missing committed design plan)

The Design Session step recorded its plan as a durable card fact and a review
packet, not as a file on this branch, and this branch has no committed
`docs/plans/` entry of its own. This document is therefore written from the
work order plus the recorded design-session fact:

> provider-neutral inbound/operation contracts, Xero fetchChanges polling with
> cursor-after-apply, adapter/organisation selection fixes (drop hardcoded
> quickbooks_online), Xero payment/credit/void gating, behavioral+DB
> validation. Stacked on feature/co-managed-it. Excludes catalog price sync and
> mapping dropdowns.

`docs/plans/2026-07-14-xero-inbound-sync-plan.md` is historical input only.

## Non-goals

- Catalog price synchronization and recurring-contract repricing.
- Searchable mapping dropdowns (own card).
- Implementing Xero outbound payment/credit/void writes. The approved shape is
  explicit capability gating, not a new Xero write surface.

## Architecture

### 1. Provider-neutral inbound contract

`AccountingExternalChange` gains an optional `normalized` field carrying a
provider-neutral payload:

- `NormalizedExternalPaymentPayload` — `reference`, `txnDate`, `currency`,
  `totalCents`, `unappliedCents`, `allocations[]` of
  `{ externalInvoiceId, amountCents }`, `isCreditApplication`, and an opaque
  `providerMetadata` bag.
- `NormalizedExternalDocumentPayload` — `totalAmount`, `docNumber`,
  `isVoided`, and `providerMetadata`.

Each adapter translates its own payload into `normalized` at the adapter
boundary. The raw `payload` is retained so historical mapping metadata and the
existing QBO simulator keep working. Shared appliers prefer `normalized` and
fall back to the legacy QBO shape only when `normalized` is absent (historical
compatibility). This makes shared logic provider-neutral without a flag-day
migration for stored QBO data.

`providerMetadata` carries provider-specific fields that are useful for
diagnostics (e.g. `qbo_payment_kind`, `qbo_txn_date`, Xero status) without the
shared applier branching on provider field names.

### 2. Provider operations + capability gates

The adapter interface gains:

- Capability flags `supportsOutboundPayment`, `supportsOutboundCredit`,
  `supportsOutboundVoid`.
- `providerOperations?(tenantId, targetRealm): Promise<AccountingProviderOperations>`
  with `readDocument`, `getCreditRemainingCents`, `recordPayment`,
  `applyCredit`, and `voidDocument`.

QBO implements all of them by wrapping `QboClientService` inside the adapter
(the adapter is already the sanctioned billing→integrations bridge). Xero
declares every outbound flag `false`; the shared appliers gate on the flag and
mark the operation terminally failed with an observable
`accounting_sync_operation_unsupported` exception. No shared path constructs a
`QboClientService` for a Xero connection once the appliers dispatch through the
adapter.

The legacy QBO-specific safety logic (auto-apply-credits conflict, unapplied
payment detection, mapping tombstone/realm guards) is preserved. Only the
remote call boundary moves behind the provider-operation interface.

### 3. Xero inbound polling

`XeroClientService` gains paginated read helpers:

- `listChangedInvoices(modifiedAfter, page)`
- `listChangedPayments(modifiedAfter, page)`
- `listChangedCreditNotes(modifiedAfter, page)`

Each requests 100 records per page (Xero's page size) and reports whether the
page was full. `XeroAdapter.fetchChanges` loops pages until a short page,
normalizes records, and returns one `AccountingChangeSet`.

Normalization:

- Invoice → `Invoice` change with `NormalizedExternalDocumentPayload`
  (`Total`, `InvoiceNumber`, `VOIDED`/`DELETED` → `isVoided`/`deleted`).
- Payment → `Payment` change with `NormalizedExternalPaymentPayload`; the
  invoice link becomes one allocation. `Status: DELETED` → `deleted`.
- CreditNote → `CreditMemo` document change, plus one synthesized
  `Payment` credit-application change per `Allocations[]` entry, keyed by
  `creditnote:<CreditNoteID>:<InvoiceID>`. The payment applier applies these
  through the same idempotent ledger path as QBO credit applications.

Cursor strategy: `fetchedAt` is the poll's completion instant, only persisted
after a successful apply. Overlapping polls are absorbed by the 5-minute
cursor overlap plus idempotent appliers (mapping `sync_token` equality). If the
change set is `truncated`, the cycle keeps the pre-poll cursor instead of
advancing, so a pathologically large page cannot skip changes.

Provider limitation (documented): Xero `ModifiedAfter` is a UTC `UpdatedDateUTC`
filter; API-side page caps mean the adapter must fully paginate before the
cursor may advance, which it does. Allocation removal on a credit note is
reconciled best-effort by re-deriving the current allocation set for each
changed credit note; a credit note that stops appearing in the change feed is
not reversed until its next change event.

### 4. Routing

- `resolveConnectedAccountingIntegration` stays the single resolver.
- `accountingSyncActions` drops the module-level
  `SYNC_ADAPTER_TYPE = 'quickbooks_online'`; Sync Now, queueing, drift
  resolution, sync status and health resolve the connected adapter +
  organisation/connection.
- `runAccountingSyncCycle` runs outbound drains even when the adapter does not
  support change polling, so an export-only adapter is never stranded.
- The scheduled handler continues to enumerate QBO realms / the Xero
  connection via the resolver.

## Validation

- Behavioral unit tests for normalized inbound payloads, provider-neutral
  dispatch, Xero normalization/pagination/cursor, and capability gating.
- Cycle-service tests for outbound-only adapters and truncated-cursor
  preservation.
- Existing QBO tests (cycle service, appliers, QBO simulator scenarios) remain
  green as the regression guard.

DB-backed happy/guard paths are exercised by the existing
`*.db.test.ts` suites and the QBO simulator; a Xero DB-backed reconciliation
test is added where the harness allows, otherwise the limitation is recorded.

## Follow-up hardening (review round 1)

- Fixed `XeroAdapter.findRemovedCreditAllocations`: the JSON extraction is a
  bound raw predicate (`(metadata->>'xero_credit_note_id') = ANY(?)`), asserted
  against the real database including organisation isolation.
- Xero `deliver` now persists the same delivery snapshot QBO does
  (`exported_total`, `doc_number`, `sync_token`); the drift detector explicitly
  adopts the first observed document as the baseline for legacy mappings
  instead of silently ignoring later changes.
- Cursor recovery: adapters capture a conservative pre-poll watermark, expose
  `changeSet.nextCursor` on truncation, and the cycle resumes from it. The
  cycle repository falls back to the most recent `cursor_before` when no cycle
  has succeeded, so a failed first poll does not skip its window.
- Xero dates are parsed from `/Date(ms+offset)/`; credit allocations use
  AllocationID identity (or explicit per-invoice aggregation) so duplicate
  allocations survive replay and removal.
- Xero auth failures (expired refresh, 401, missing connection) are classified
  as reconnect-required and abort the cycle with a connection exception and no
  cursor advance; polling request errors are normalized.
- Organisation selection: `resolveConnectedAccountingIntegration` accepts a
  preferred target and honours the settings-selected realm; the scheduled
  handler fans out to every connected Xero organisation; invoice status and
  health counts are organisation-scoped and tombstones excluded.
- UI: `InvoiceSyncStatus` carries provider identity; the badge/preview gate
  QuickBooks links and copy on the provider; the health panel is
  provider-labelled and never loads QBO catalogs for a Xero connection.
- Producers route through the connected provider with an echo guard for any
  accounting-originated payment; non-QBO adapters can no longer fall back to a
  QBO client.
- Validation adds `server/src/test/integration/accounting/xeroInboundReconciliation.integration.test.ts`
  (real export → poll → apply, AR rows, balances, cursor, real allocation
  query) and QBO provider-operation regressions against the simulator.

