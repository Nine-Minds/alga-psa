# Plan: REST `DELETE /api/v1/invoices/:id` returns 500 for draft invoices

- Card: a29619ba / PSA ticket alga0002228 (adjacent issue 2)
- Branch: `feature/rest-delete-api-v1-invoices-id-returns-500-for-d`, based on `a65fccb78c`
- Line numbers below are from that base.

## 1. What is broken (verified)

**Live schema check.** The `alga-psa-local-test` database was queried directly:

- `invoices` has **no** `*_by` columns (no `created_by`, no `updated_by`).
- `invoice_line_items` **does not exist** (`to_regclass` returns null). Line items live in `invoice_charges`, which the `invoice_items` view exposes.
- `invoice_charge_details` cascades from `invoice_charges` (`ON DELETE CASCADE`). The `invoices` FKs from `invoice_charges`, `transactions`, `credit_allocations`, `invoice_time_entries`, `invoice_usage_records`, `invoice_annotations`, `payment_webhook_events` and `prepaid_balance_alerts` are all `NO ACTION`. A delete only succeeds if those rows are removed first.

**`InvoiceService.delete()`.** File: `server/src/lib/api/services/InvoiceService.ts:835-937`.

| Path | Taken when | Failure |
|---|---|---|
| Soft-cancel (`:869-876`) | payments exist, status `paid`, or canonical recurring detail periods exist (this covers every freshly generated recurring draft) | stamps `updated_by` → Postgres 42703 → 500 `INTERNAL_CONFIGURATION` |
| Hard (`:878-886`) | everything else, including non-recurring drafts | deletes from `invoice_line_items` → 42P01 → 500 |

Every REST delete fails today. If the table name were corrected, the hard path would still hit the FK restrictions listed above. It also never releases:

- `recurring_service_periods` linkage
- time entries and usage records (`invoiced` flags)
- `usage_period_totals`
- credits
- materials, project billing and pending hour blocks

The soft-cancel path is also wrong in principle. A *draft* recurring invoice that gets cancelled keeps its service periods linked, so the window can never be billed again. The UI does the opposite: it hard-deletes the draft and releases its periods.

**Same defects elsewhere in `InvoiceService`:**

- `update()` writes `updated_by` (`:640`). It also spreads `...data`, including `items`, into the `invoices` UPDATE (`:637-653`), which is a second 42703. Item replacement reads and deletes from `invoice_line_items` (`:657-664`).
- `updated_by` is also written in:
  - `sendInvoice` `:1089`
  - `recordPayment` `:1272`
  - `applyCredit` `:1440`
  - `recordRefund` `:1620`
  - `bulkUpdateStatus` `:1721`
- `finalizeInvoice` already guards with `hasColumn` (`:990`) and only uses `invoice_line_items` as a dead fallback (`:966-970`).
- `create()` already strips audit fields through `BaseService.filterAuditFields` (`:550`). That is the existing mechanism the other writes should use.

**The correct implementation already exists for the UI.** `packages/billing/src/actions/invoiceModification.ts:1969-2351` `hardDeleteInvoice` (a `withAuth` action) does the following:

- refuses QBO-synced invoices
- locks the invoice row `FOR UPDATE`
- refuses legacy canonical-detail invoices that have no linked periods
- clears the prepaid replenishment lock
- rolls back project-deposit credits
- reverses payments and credit applications
- voids an unused issued credit note
- releases project billing, materials and pending hour blocks
- un-invoices time entries and usage records, and re-opens `usage_period_totals`
- deletes `credit_allocations`, transactions, join rows, charges (details cascade) and annotations
- nulls `payment_webhook_events`
- releases `recurring_service_periods` (`releaseRecurringServicePeriodInvoiceLinkageForInvoice`, `:624-642`)
- deletes the invoice
- publishes `CREDIT_NOTE_VOIDED`, `INVOICE_ITEM_DELETED`, `INVOICE_ANNOTATION_DELETED` and `INVOICE_DELETED` after commit

Callers: `DraftsTab.tsx:727` plus the billing-cycle reversal paths in `billingCycleActions.ts:59-65`, which can also delete finalized recurring invoices on purpose. On the UI side, finalized invoices are voided through `voidInvoiceActions.ts:voidInvoice`, never deleted. That action requires a reason, refuses drafts ("Drafts must be deleted, not voided"), and refuses invoices that have payments.

## 2. Key decisions

1. **One delete engine.** Pull the body of `hardDeleteInvoice` out into an exported, auth-free internal: `deleteInvoiceWithKnex(knex, tenant, invoiceId, userId, options)`. This follows the existing `finalizeInvoice` / `finalizeInvoiceWithKnex` split (`:921` / `:945`).
   - `hardDeleteInvoice` becomes a thin `withAuth` wrapper: permission check, then `createTenantKnex`, then the internal, then `toInvoiceActionError` mapping. UI behaviour does not change.
   - `InvoiceService.delete()` calls the same internal.
   - Why not call the `withAuth` action from the service? It works under `runWithApiKeyUser` (37748e2c2a), but it would repeat the permission and knex resolution, and it hides refusal reasons inside an action-result union. The REST layer needs those reasons as typed errors.
2. **REST deletes drafts only.** "Draft" means `finalized_at IS NULL`. This is the exact complement of `voidInvoice`'s guard and matches the drafts list.
   - The check runs **inside** the engine's transaction, after the `FOR UPDATE` row lock, through an option `{ requireDraft: true }`. A concurrent finalize therefore cannot race it (no TOCTOU).
   - The UI wrapper and the billing-cycle reversal callers do not pass `requireDraft`, so their current semantics are preserved.
3. **Non-drafts get 409, not soft-cancel.** Finalized, sent and paid invoices get `ConflictError` (409): "Finalized invoices cannot be deleted; void the invoice instead."
   - The soft-cancel branch goes away. It has 500'd on every call since `invoices` lost `updated_by`, so no working client depends on it.
   - Cancelling a draft would strand its recurring periods.
   - The UI never cancels through delete.
4. **Engine refusals become typed errors.** `ExpectedInvoiceActionError` (`:676`) is exported as `InvoiceDeletionRefusedError` (or the existing class is exported under a stable name) so the service can map it to `ConflictError` (409). This covers: QBO-synced, legacy canonical-detail, used issued credit, used project-deposit credit, and a non-pending hour block.
   - Not found → `NotFoundError` (404). The engine currently returns silently when the invoice is missing; the internal returns `{ deleted: false }` and the service maps that to 404.
5. **Audit fields go through the existing schema-aware mechanism.** Every `invoices` write in `InvoiceService` builds its payload through `this.filterAuditFields(trx, payload, 'invoices')`. Stamping `updated_by` blindly is the defect, and `filterAuditFields` already exists for exactly this. `finalizeInvoice`'s ad-hoc `hasColumn` (`:990`) is switched to the same call, which leaves one pattern.
6. **REST `update()` item replacement targets `invoice_charges` and is draft-only.** `items` is stripped from the header UPDATE payload. Replacing items is allowed only when `finalized_at IS NULL` and the invoice has **no** linked `recurring_service_periods` or canonical recurring detail rows; otherwise the service returns 409 "recurring drafts: delete and regenerate instead". Replaced charges are deleted from `invoice_charges` (details cascade) and their `item_id`s are published as before. The dead `invoice_line_items` fallback in `finalizeInvoice` is removed.

## 3. Changes, in order

### Step 1: extract the delete engine (packages/billing)

`packages/billing/src/actions/invoiceModification.ts`:

- Add `export async function deleteInvoiceWithKnex(knex: Knex, tenant: string, invoiceId: string, userId: string, options: { requireDraft?: boolean } = {}): Promise<{ deleted: boolean }>`.
  - Move into it everything from the QBO-mapping guard (`:1980-1990`) through the post-commit event publication (`:2283-2341`).
  - Replace `user.user_id` with `userId`.
- Inside the transaction, right after the locked `invoices` read (`:2010-2021`), add: `if (options.requireDraft && invoice.finalized_at) throw new InvoiceNotDraftError(invoiceId)`. This is a new exported error class, alongside the exported refusal class from decision 4.
- Turn the QBO guard's `return actionError(...)` into a thrown refusal error. The wrapper maps it back to the identical `actionError(msg, 'msp/invoicing:errors.invoice.syncedVoidInstead')`, keeping the i18n key. To support that, the refusal error carries an optional `i18nKey`.
- Rewrite `hardDeleteInvoice` (`:1969`) as: permission check → `createTenantKnex` → `deleteInvoiceWithKnex(knex, tenant, invoiceId, user.user_id)` → map refusal errors through `toInvoiceActionError`, extended to read the `i18nKey` → `{ success: true }`.
- Export the new function and errors from the package entry that the server already imports billing actions through (`@alga-psa/billing/actions/invoiceModification`). No new package edge is needed, because `InvoiceService` already imports from `@alga-psa/billing`.

### Step 2: REST delete (server)

`server/src/lib/api/services/InvoiceService.ts:835-937`, replace `delete()` with:

1. `validatePermissions(context, 'invoice', 'delete')` (unchanged).
2. `const { knex } = await this.getKnex()`.
3. Call `deleteInvoiceWithKnex(knex, context.tenant, id, context.userId, { requireDraft: true })`.
4. Map errors:
   - `InvoiceNotDraftError` → `ConflictError('Finalized invoices cannot be deleted; void the invoice instead')`
   - refusal error → `ConflictError(err.message)`
   - `{ deleted: false }` → `NotFoundError('Invoice not found')`
5. Keep the REST `auditLog` entry (`action: 'invoice.deleted'`, with `recurring_provenance`). To make that work, read `getInvoiceRecurringProvenance` before calling the engine, and write the audit row in its own `withTransaction` after a successful delete. Alternatively, pass an `onBeforeCommit(trx)` hook option so the audit row commits atomically with the delete. **Choose the hook**: it is atomic, and it keeps the engine free of REST concerns.
6. Drop the REST-specific `publishEvent('INVOICE_DELETED')` and the soft-cancel `INVOICE_STATUS_CHANGED`. The engine already publishes `INVOICE_DELETED` (including `clientId`) and item and annotation deletions, so REST and UI emit the same events.
   - Check that `server/src/test/unit/api/invoiceWorkflowRecurringProvenance.wiring.test.ts` does not assert the old REST-only event payload. If it does, update it to the engine's payload.
7. `notifyInvoiceTerminalStatus` (`:936`): a draft has no auto-pay workflow, but it is harmless to keep it for cancellation safety. Keep it in the service after a successful delete, called with `newStatus: 'cancelled'`.

`bulkDeleteInvoices` (`:1873-1888`): keep looping over `delete()`. Push `${invoiceId}: ${err.message}` for `ConflictError` and `NotFoundError` instead of the generic "delete failed", which currently hides why each id was refused. Other errors keep the generic text so internal messages do not leak.

`ApiBaseController.delete()` (`ApiBaseController.ts:406-431`) needs no change. It pre-checks `getById` (404) and then returns 204.

### Step 3: `updated_by` and dead-table cleanup in the same service

All in `InvoiceService.ts`:

- `update()` `:637-653`:
  - Build `const { items, ...headerData } = data`.
  - Build the payload `filterAuditFields(trx, { ...headerData, updated_by, updated_at }, 'invoices')`.
  - Skip the header UPDATE when only `items` changed (an empty payload apart from `updated_at` is fine).
- `update()` `:656-679`: replace both `invoice_line_items` queries with `invoice_charges` (`pluck('item_id')` then `.del()`), guarded by the decision 6 checks (draft, not recurring-linked) *before* any write. `createInvoiceLineItems` already writes `invoice_charges` (`:2470`).
- `sendInvoice` `:1086-1091`, `recordPayment` `:1269-1274`, `applyCredit` `:1437-1442`, `recordRefund` `:1617-1622`, `bulkUpdateStatus` `:1718-1724`: wrap each update payload in `await this.filterAuditFields(trx, {...}, 'invoices')`.
- `finalizeInvoice` `:965-970`: drop the `hasTable('invoice_charges')` / `invoice_line_items` fallback and always use `InvoiceModel.getInvoiceCharges`.
- `finalizeInvoice` `:990-992`: replace `hasColumn` with `filterAuditFields`.
- Afterwards, `grep -n "invoice_line_items\|updated_by" InvoiceService.ts` should show only `auditFields` config (`:267`) and payloads that go through `filterAuditFields`.

Leave a `// LEVERAGE: pattern audit-stamped-update — ...` marker if a third hand-built `filterAuditFields({... updated_at})` shape appears. A `tenantDb(...).updateAudited()` helper may be the missing layer, but it is not in scope.

### Step 4: tests

**Remove or rewrite the mock tests that encoded the bug:**

- `server/src/test/unit/api/invoiceService.deleteRecurringDetailGuard.test.ts`: delete it. It asserts the soft-cancel with `updated_by`, which is now wrong behaviour. Its intent (recurring drafts are handled correctly) moves to the DB test below.
- `server/src/test/unit/api/invoiceServiceCrudMutationTenantScoped.contract.test.ts:25,27,33,36`: replace the `invoice_line_items` assertions. `update` should contain `.table('invoice_charges')`; `delete` should contain `deleteInvoiceWithKnex(`. Neither section should contain `invoice_line_items` or a bare `updated_by:` outside `filterAuditFields`.
- `server/src/test/unit/billingCycleActions.test.ts` and `packages/billing/tests/invoiceModification.recurringDeletionGuard.test.ts`: adjust their mocks if the wrapper refactor moves where `createTenantKnex` and the queries are called. Behaviour assertions stay the same.

**New DB-backed integration tests.** Add them to `server/src/test/integration/billingInvoiceTiming.integration.test.ts`, next to `T021` (`:2233`), because they reuse its recurring fixtures (`createClientWithRecurringCycles`, `createFixedContractLine`, `materializeContractCadenceServicePeriods`, `generateInvoiceForSelectionInput`, `withRealTransactions`):

- **T-REST-DEL-1, recurring draft via the REST controller:**
  1. Generate a contract-cadence recurring draft.
  2. Call `new ApiInvoiceController().delete()(req)` with an authenticated request. Follow the route-test pattern in `server/src/test/unit/api/projectTaskCommentRoutes.test.ts:118`, or stub `authenticate` / `runWithApiKeyContext` to a context for the test user.
  3. Assert:
     - 204
     - the `invoices` row is gone
     - `invoice_charges` and `invoice_charge_details` for the invoice are empty
     - the `recurring_service_periods` row is `lifecycle_state='locked'` with null `invoice_id` / `invoice_charge_id` / `invoice_charge_detail_id` / `invoice_linked_at`
     - `getAvailableRecurringDueWork` lists the window as due again
     - a second `generateInvoiceForSelectionInput` for the same window succeeds
- **T-REST-DEL-2, non-recurring draft:** create a manual draft via `InvoiceService.generateManualInvoice` (or `create` with items). DELETE gives 204; the invoice and its charges are gone.
- **T-REST-DEL-3, finalized invoice:** finalize a draft, then DELETE. Expect 409 `CONFLICT`, and the invoice is unchanged (status and `finalized_at` intact, no `cancelled`).
- **T-REST-DEL-4, unknown id:** 404.
- **T-REST-UPD-1:** `PUT` header-only change (e.g. `due_date`) on a draft returns 200; there is no 42703. `PUT` with `items` on a non-recurring draft replaces its `invoice_charges`.
- **T-REST-STATUS-1:** `sendInvoice` / `recordPayment` on a finalized invoice does not 500, which proves the `updated_by` fix on one status op. The other three share the identical `filterAuditFields` shape.

Run the DB tests against `alga-psa-local-test` (pgbouncer `127.0.0.1:6472`), using the env wiring `billingInvoiceTiming` already uses (`wireLocalTestDbEnv`).

### Step 5: manual REST check

On the card dev server (`:3695`), with an API key:

1. Generate a recurring draft in the UI.
2. Send `DELETE /api/v1/invoices/:id`. Expect 204.
3. Check that the window reappears in Automatic Invoices.
4. Send DELETE for a finalized invoice. Expect 409.

## 4. Out of scope

- A REST void/cancel endpoint for finalized invoices. The 409 message points at void; adding `POST /api/v1/invoices/:id/void` that wraps `voidInvoice` internals is a follow-up card.
- REST `update()` letting callers set arbitrary `status` (e.g. directly to `cancelled` or `paid`), and its lack of a draft-only guard for header fields. Pre-existing; flag as follow-up.
- `hardDeleteInvoice`'s TODOs (client balance recalculation, `balance_after: null` on payment reversals).
- Reworking `createInvoiceLineItems` / totals recalculation on item replacement. Behaviour is unchanged apart from the table fix.
- `InvoiceService.bulkDelete` (`:2622`, `NotImplementedError`).

## 5. Risks

- **The refactor of a heavily used UI action carries regression risk.** The billing-cycle reversal paths, the prepaid-replenishment subscriber and the credit-reversal lifecycle tests all call `hardDeleteInvoice`. Mitigation:
  - the extraction is a mechanical move with `user.user_id` → `userId`, and `requireDraft` defaults off
  - run `billingInvoiceTiming`, `invoiceCreditReversalLifecycle`, `hourBlockDraftDelete`, `hourBlockLockDiscipline`, `prepaidBalanceAlertSubscriber.integration` and `billingCycleActions` before and after
- **REST behaviour change for non-drafts (cancel → 409).** In practice every call already returned 500, so this changes a failure code, not working behaviour. It still belongs in the PR description and API changelog.
- **Event payload change.** REST `INVOICE_DELETED` now comes from the engine (`publishNonCatalogWorkflowEvent`, with `clientId`) instead of `publishEvent`. Subscribers that only listened on the REST path's bus would need checking, so grep the `INVOICE_DELETED` consumers.
- **`filterAuditFields` caches table columns per process.** A migration that later adds `invoices.updated_by` needs a restart to take effect. This matches `create()` today and is acceptable.
- **Legacy canonical-detail invoices with no linked periods** now get 409 instead of a soft-cancel. This is intentional and matches the UI ("Cancel the invoice instead of deleting it"). For finalized ones, void is the right path.
