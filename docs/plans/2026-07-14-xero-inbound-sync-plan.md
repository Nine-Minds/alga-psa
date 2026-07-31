# Xero Inbound Accounting Sync Plan

**Date:** 2026-07-14
**Ticket:** alga0002119
**Status:** Draft. This document does not authorize implementation on the Xero outbound-fix branch.

## Problem

AlgaPSA can deliver invoices to a connected Xero organisation, but it does not read accounting changes back from Xero. The Xero adapter does not advertise change polling or implement `fetchChanges`. The accounting sync driver and several downstream appliers still assume QuickBooks Online.

The first inbound milestone should reconcile payments, credit notes, and invoice changes from Xero without creating a second sync engine.

## Goals

- Poll the connected Xero organisation for changed invoices, payments, and credit notes.
- Feed normalized changes through the existing accounting sync cycle.
- Apply Xero payments and credits idempotently to the mapped AlgaPSA invoice.
- Detect material invoice drift without overwriting AlgaPSA invoice data automatically.
- Preserve adapter and provider identity in mappings, transactions, exceptions, and operator-facing status.
- Use the existing scheduled accounting sync job and the same operational controls as QuickBooks Online.

## Non-goals

- Xero webhooks in the first milestone.
- Importing contacts, catalog items, or arbitrary historical transactions.
- Bi-directional editing of invoice lines.
- Replacing the existing outbound batch flow.
- General accounting-platform UI redesign.

## Existing seams

- `packages/types/src/interfaces/accountingExportAdapter.interfaces.ts` already defines `supportsChangePolling` and `fetchChanges`.
- `packages/billing/src/services/accountingSync/accountingSyncCycleService.ts` owns the pull/apply cycle.
- `packages/billing/src/services/accountingSync/connectedAccountingIntegration.ts` already resolves either a QBO or Xero connection.
- `server/src/lib/jobs/handlers/accountingSyncCycleHandler.ts` provides the scheduled trigger.
- `packages/billing/src/actions/accountingSyncActions.ts` still sets `SYNC_ADAPTER_TYPE` to `quickbooks_online` and loads QBO credentials directly.
- `packages/billing/src/services/accountingSync/paymentApplier.ts` defaults the provider to `quickbooks` and writes `qbo_payment_kind` and `qbo_txn_date` metadata.

## Adapter contract

Add `supportsChangePolling: true` to `XeroAdapter.capabilities()` and implement:

```ts
fetchChanges(
  tenantId: string,
  since: string,
  targetRealm?: string | null
): Promise<AccountingChangeSet>
```

`targetRealm` is the Xero organisation tenant ID used by mappings. Resolve it to the stored Xero connection before calling the API.

The adapter should request changed records with Xero's `If-Modified-Since` support and follow pagination independently for:

1. Invoices
2. Payments
3. Credit notes

Normalize provider records into the existing accounting change types. Provider payloads and pagination details must stay inside the adapter.

## Cursor and replay rules

- Use the sync cycle's last successful completion timestamp as the next lower bound.
- Subtract a small overlap window from each request to tolerate provider clock skew and records committed near a page boundary.
- Deduplicate by Xero entity ID plus its provider update timestamp before applying changes.
- Advance the stored cursor only after every page has been fetched and the cycle completes successfully.
- Keep payment and credit application idempotency keyed by provider, external transaction ID, target realm, and AlgaPSA invoice ID.

## Driver changes

Replace QBO-specific connection resolution in `accountingSyncActions.ts` with `resolveConnectedAccountingIntegration`:

1. Resolve `{ adapterType, targetRealm }` for the tenant.
2. Load the matching adapter from `AccountingAdapterRegistry`.
3. Require `supportsChangePolling` and `fetchChanges` before starting an inbound cycle.
4. Obtain refresh-token health through an adapter-neutral connection-health contract. Do not import QBO credential storage from the action.
5. Pass the resolved adapter type and realm through sync operations, cycle rows, mappings, exceptions, and health queries.

Apply the same resolution to any remaining producer or scheduled path that still chooses `quickbooks_online` directly. `syncProducers.ts` already uses the connected-integration resolver and should remain the model.

## Applier changes

Generalize provider-specific metadata before enabling Xero polling:

- Replace `qbo_payment_kind` with `external_payment_kind`.
- Replace `qbo_txn_date` with `external_transaction_date`.
- Store `provider: 'xero' | 'quickbooks'` explicitly instead of defaulting to QuickBooks.
- Keep compatibility reads for existing QBO metadata until historical records have been migrated or aged out.
- Audit `driftDetector.ts`, `creditApplicationApplier.ts`, and payment-push logic for QBO field names, SyncToken assumptions, and QuickBooks-only operator copy.

Xero invoice changes should update observed external snapshots. A total or document-number difference should create the existing accounting drift exception. Status-only changes that reflect settlement should flow through payment and credit application rather than rewrite the invoice.

## Trigger

Use `accountingSyncCycleHandler` for the first release. Match the existing QBO cadence and concurrency controls so one tenant/realm cannot run overlapping cycles. A later webhook design can enqueue the same cycle with a shorter delay; it should not introduce a separate apply path.

## Error handling

- Treat expired or revoked Xero refresh tokens as reconnect-required and stop the cycle without advancing its cursor.
- Retry rate limits and transient Xero failures with bounded backoff.
- Persist a safe operator message and provider correlation ID. Do not persist tokens or raw authorization headers.
- Isolate malformed provider records as sync exceptions when the rest of the page can be processed safely.
- Fail the cycle when pagination is incomplete. Partial fetches must not move the cursor.

## Delivery stages

1. **Adapter polling:** normalize paged Xero invoice, payment, and credit-note changes behind fixture-driven adapter tests.
2. **Adapter-neutral driver:** remove the hard-coded QBO selection and introduce adapter-neutral connection health.
3. **Provider-neutral appliers:** generalize payment, credit, drift, and transaction metadata while retaining QBO compatibility.
4. **Scheduled execution:** enable Xero in the existing job with tenant/realm locking and cursor overlap.
5. **Operator experience:** label Xero sync health, reconnect states, drift, and exceptions accurately.

## Test plan

- Unit tests for Xero pagination, `If-Modified-Since`, normalization, token expiry, and rate-limit retry.
- Contract tests that run the same normalized change set through QBO and Xero adapters.
- DB-backed integration tests for payment apply, credit apply, duplicate replay, unknown invoice mapping, and material drift.
- A cycle test proving the cursor does not advance after a failed page.
- A scheduler test proving overlapping runs for one tenant/realm are rejected.
- Live sandbox verification: export an invoice, record a payment and credit in Xero, run Sync Now, and confirm AlgaPSA applies each once.

## Acceptance criteria

- A connected Xero tenant can run the existing accounting sync cycle without a QBO connection.
- Xero payments and credits update mapped AlgaPSA invoices once, including after an overlapped replay.
- Xero invoice drift creates an operator-visible exception and does not silently overwrite AlgaPSA.
- Expired credentials produce reconnect guidance without a raw server error.
- A failed or partial provider fetch leaves the last-success cursor unchanged.
- Existing QBO sync tests continue to pass with legacy metadata compatibility.

## Open decisions

- Confirm the overlap duration after measuring Xero update timestamp behavior in the demo organisation.
- Decide whether the first release imports Xero overpayments or records them as unsupported exceptions.
- Decide when to migrate existing QBO transaction metadata to provider-neutral keys.
- Revisit webhooks only after polling correctness and idempotency are proven.
