# Xero-assigned invoice numbers

Card: cdd207d8 ("Xero: option to let Xero assign the invoice number")
Ticket: alga-2026-0002746 (EQUIT PTY LTD)
Status: design, 2026-11-18

## Summary

Add a setting for each connected Xero organisation: **Let Xero assign invoice numbers**. It is off by default.

When it is on, an invoice finalized in Alga gets a provisional number from Alga's own sequence and is marked as waiting for its Xero number. On the first export, Alga sends the invoice to Xero without `InvoiceNumber`, so Xero gives it the next number in its own sequence. In the same database transaction that records the Xero mapping, Alga writes that number into `invoices.invoice_number`. Until then the invoice cannot be sent to the client: it can't be emailed, it doesn't appear in the client portal, and autopay doesn't start.

When the setting is off, nothing changes.

## What the code does today

These are the code paths this design changes or relies on.

**Payload mapping** (`packages/integrations/src/lib/xero/xeroClientService.ts`)
- `mapInvoicePayload` (around line 1376) sends `InvoiceNumber` only when there is no `externalInvoiceId` and `invoiceNumber` is not blank. A blank number means Xero numbers the invoice itself. An update by `InvoiceID` never carries `InvoiceNumber`, so updates by InvoiceID already can't change the Xero number. This design keeps that rule.
- `createInvoices` (line 533) makes one synchronous `POST /Invoices` for the whole batch. It maps `invoice.InvoiceNumber` from the response into `XeroInvoiceCreateSuccess.invoiceNumber`. **The Xero-assigned number is in the create response, so the write-back needs no extra API call.**
- There is no `Idempotency-Key` header anywhere in the Xero client. A grep of `packages/integrations/src/lib/xero` and `packages/billing/src/adapters/accounting` found none.

**Adapter** (`packages/billing/src/adapters/accounting/xeroAdapter.ts`)
- `transform` (line 355) loads the existing mapping with `KnexInvoiceMappingRepository.findInvoiceMapping` and passes its `externalInvoiceId` along. It always sets `invoiceNumber: invoice.invoice_number`. Reference is `buildXeroInvoiceReference(invoice_number, po_number)`, which is the PR #3850 behaviour.
- `deliver` (line 767) runs inside `withTransaction`. It locks every invoice row with `lockInvoiceForExternalSync`, makes one `createInvoices` call, then writes mapping rows with `upsertInvoiceMapping`. The metadata holds `invoiceNumber`/`doc_number`, which is Xero's number, and `algaInvoiceNumber`. The Xero number is never written to `invoices`.

**Export execution** (`packages/billing/src/services/accountingExportService.ts`)
- `reserveInvoicesForExport` and `withExecution` run the whole batch, including `adapter.deliver`, in one execution transaction. If anything after the remote POST throws, the mapping writes roll back while the Xero invoice stays in Xero.

**Invoice numbers** (`server/migrations/202409071803_initial_schema.cjs:600` and `20250221031410_add_unique_constraint_to_invoice_number.cjs`)
- `invoices.invoice_number` is `text NOT NULL`.
- `unique_invoice_number_per_tenant` is unique on `(invoice_number, tenant)`.
- Generation assigns it through `SharedNumberingService.getNextNumber('INVOICE', …)` (`packages/billing/src/actions/invoiceGeneration.ts:3895`, `prepaidAutoReplenishment.ts`, `quoteConversionService.ts`).

**Finalize** (`packages/billing/src/actions/invoiceModification.ts`, `finalizeInvoiceWithKnex`)
- After commit, finalize enqueues the auto-export (`enqueueInvoiceAutoExport` in `services/accountingSync/syncProducers.ts`, gated by `accountingSync.autoSyncEnabled`) and starts autopay (`startInvoiceAutopay`). The `accounting-sync-cycle` maintenance job drains the export. I did not measure its cadence.

**What the client sees**
- Email: `sendInvoiceEmailAction` (`packages/billing/src/actions/invoiceJobActions.ts:446`) renders the PDF through `pdfService.generateAndStore`. After a successful send it calls `publishGeneratedDocumentsToClient`.
- PDF filing: `pdfGenerationService.fileGeneratedDocument` keeps one working document per entity, named `Invoice_${invoiceNumber}.pdf`. **Once that document is issued to the client, later renders return the issued copy unchanged.** An invoice sent with a provisional number would keep that number on the client's PDF permanently.
- Client portal: `client-portal-actions/client-billing.ts` (around line 296) lists every invoice with `finalized_at` set. It reads `invoice_number` live from the row.

**Settings precedent**
- `tenant_settings.settings` already holds per-provider subtrees that sit beside the billing-owned `accountingSync`:
  - `qbo` (`lib/qbo/qboEnvironmentSettings.ts`)
  - `qboAutomatedSalesTax: { realms: string[] }` (`lib/qbo/qboTaxSettings.ts`)
- Writes do a locked read-merge-write with `FOR UPDATE`, plus `onConflict('tenant').merge` for the first insert.
- The UI pattern is the QBO Automated Sales Tax `Switch` block in `QboIntegrationSettings.tsx` (around line 719), gated on `connections_manage`.
- Xero has no settings key of its own yet. Its only stored preference is `accountingSync.defaultRealm`, read in `xeroClientService.readPersistedXeroDefaultRealm`.

## Design

### 1. Where the setting lives

**Storage key:** `tenant_settings.settings.xeroInvoiceNumbering = { xeroAssignedRealms: string[] }`

- Each entry is a Xero tenant id, the same value as the export batch `target_realm`.
- **Default off.** A missing key, a malformed value, or a realm that isn't listed all mean Alga numbering.
- The key is per organisation, not a single flag for the tenant, because the numbering sequence belongs to the Xero organisation. A tenant connected to two Xero organisations may use this mode on only one of them. This copies the structure of `qboAutomatedSalesTax.realms`. For the common single-organisation tenant, the UI shows it as one switch.

**New module:** `packages/integrations/src/lib/xero/xeroInvoiceNumberingSettings.ts`, modelled on `qboTaxSettings.ts`. It provides:
- `getXeroAssignedNumberingRealms(knexOrTrx, tenantId): Promise<string[]>`
- `isXeroAssignedNumberingEnabled(knexOrTrx, tenantId, realmId): Promise<boolean>`. It returns false when `realmId` is empty.
- `setXeroAssignedNumbering(knex, tenantId, realmId, enabled)`. It does the locked read-merge-write inside one transaction, the same way as `setTenantQboEnvironmentSetting`.

**Server actions** go in `packages/integrations/src/actions/integrations/xeroActions.ts` and are exported through `actions/index.ts`:
- `getXeroInvoiceNumberingMode({ realmId })` checks `catalog_read`.
- `setXeroInvoiceNumberingMode({ realmId, enabled })` checks `getXeroUpdateAccessError`, which means `connections_manage`. It refuses while a provider disconnect is pending, the same way as `setQboEnvironment`. It writes an `accounting_audit` entry, `accounting_numbering_mode_changed`, through the existing `writeAccountingAudit`.

**UI:** add a section to the connection card in `XeroIntegrationSettings.tsx`, shown only when there is a default connection.
- Section id: `xero-invoice-numbering-section`.
- `Switch` id: `xero-assigned-invoice-numbers-toggle`.
- Use the standard `Label` and `Switch` components, laid out like the QBO AST block.
- Label: "Let Xero assign invoice numbers".
- Hint: "New invoices take the next number from this Xero organisation. Until an invoice has been exported it shows a provisional number and can't be sent to the client. Invoices already in Xero keep their numbers."
- When the switch is turned on, also show: "Provisional numbers come from Billing Settings → Numbering. Use a prefix that Xero never uses, so a provisional number can't clash with a number Xero assigns."
- Add i18n keys under `integrations.xero.settings.invoiceNumbering.*`.

### 2. Recording each invoice's numbering mode

The setting decides the mode for new invoices. Each invoice records its own mode, so the guard rails never depend on the current value of the setting.

**Migration:** add `invoices.invoice_number_source text NOT NULL DEFAULT 'alga'` with `CHECK (invoice_number_source IN ('alga','pending_external','external'))`.
- `alga`: Alga's number is the number of record. This is every existing row and every invoice while the setting is off.
- `pending_external`: the number is provisional and waiting for Xero.
- `external`: the number came back from Xero and has been written onto the invoice.
- Run the migration through the normal Citus-safe column-add path. The default backfills existing rows to `alga`.

**When the mode is set:** in `finalizeInvoiceWithKnex`, inside the finalize transaction:
- If the invoice type would export to Xero (not a prepayment and not a credit note; see Scope), and `resolveConnectedAccountingIntegration` resolves to a Xero realm listed in `xeroAssignedRealms`, set `invoice_number_source = 'pending_external'`. Otherwise it stays `alga`.
- `unfinalizeInvoice` sets a `pending_external` invoice back to `alga`, because a draft isn't client-facing and finalizing again decides the mode afresh. An `external` invoice stays `external`: once Xero has numbered an invoice, that number is permanent.

Because the mode is recorded at finalize:
- Invoices finalized before the setting was turned on stay `alga` and export with their Alga number.
- Turning the setting off doesn't renumber anything. `external` invoices keep their Xero number. Invoices already `pending_external` still take Xero's number when they export, so the rule doesn't change for an invoice after it has been finalized.

### 3. Export: leave out the number on create, write Xero's number back on delivery

**Transform:**
- Add `invoice_number_source` to the `loadInvoices` select in `xeroAdapter.ts`.
- When building `XeroInvoicePayload`, use `invoiceNumber: invoice.invoice_number_source === 'pending_external' ? null : invoice.invoice_number`. `mapInvoicePayload` doesn't change: it already leaves out a blank number and leaves out the number on every update by InvoiceID.
- `reference` stays `buildXeroInvoiceReference(invoice.invoice_number, po_number)`. While the number is pending, the Reference holds the provisional Alga number. That Reference is also the recovery key in §5.
- Pass `numberSource` through on `XeroDocumentPayload` so `deliver` knows which documents to settle.

**Deliver write-back.** This happens inside the existing `withTransaction`, with the invoice row locks already held. For each delivered document whose `numberSource` is `pending_external`:

1. Take `xeroNumber = result.invoiceNumber ?? raw.InvoiceNumber`. This is the same value already stored as `metadata.doc_number`.
2. Upsert the mapping first, as today. The mapping is what prevents a second Xero invoice from being created, so it has to survive whatever happens next.
3. Inside a savepoint (`trx.transaction()`), run:
   `UPDATE invoices SET invoice_number = :xeroNumber, invoice_number_source = 'external', updated_at = now() WHERE tenant = :t AND invoice_id = :id AND invoice_number_source = 'pending_external'`
4. In the same savepoint, rename the unissued working PDF document. `document_name` changes from `Invoice_<provisional>.pdf` to `Invoice_<xeroNumber>.pdf`, found the same way as `findStoredPdf(…, issued=false)`. Without this the next render would create a second document under the new name, and the old one would be left behind. No issued document can exist, because of §4.
5. Record the provisional number in the mapping metadata, `provisionalAlgaInvoiceNumber`, for audit. `algaInvoiceNumber` becomes the Xero number, so it again means "the number Alga shows".
6. Publish `INVOICE_NUMBER_ASSIGNED` after commit through the existing `afterCommit` hook, with payload `{ invoiceId, previousNumber, invoiceNumber, source: 'xero' }`. The search indexer (`packages/search/src/indexers/invoice.ts`, which uses `invoice_number` as the title) and workflow consumers use it to refresh.

**Partial failures:**

| Failure | Result |
|---|---|
| Xero response has no `InvoiceNumber` for a pending document | The mapping is kept. The document is reported in `failedDocuments` with `XERO_NUMBER_NOT_RETURNED`, and the invoice stays `pending_external`. The next export updates by InvoiceID; Xero returns the number again and step 3 settles it. |
| The savepoint hits `unique_invoice_number_per_tenant` (23505) because another Alga invoice already uses the number Xero assigned | The savepoint rolls back and the mapping is kept. The document is reported as failed with `XERO_NUMBER_CONFLICT`: "Xero numbered this invoice <n>, but Alga invoice <other> already uses <n>. Rename one of them, then retry the export." The batch becomes `needs_attention`. A retry updates by InvoiceID, which never renumbers in Xero, and settles the Alga side once the conflict has been cleared. |
| The execution transaction rolls back after the Xero POST succeeded (DB error, process crash) | The Xero invoice exists but has no mapping. §5 recovers it on retry instead of creating a second invoice. |

Retries settle the number because **every** delivery of a `pending_external` invoice runs the settle step, whether it is a create or an update. The settle logic lives in one place and depends only on the invoice's state and the Xero response.

**Cost:** the write-back adds no Xero call. Xero returns the number in the existing create response. Each pending invoice adds one indexed `UPDATE` plus one `UPDATE` of the documents row, inside a transaction that is already open. Recovery (§5) adds at most one `GET` per batch that contains pending creates; see §5.

### 4. Before the number comes back: provisional number, and nothing goes to the client

**Recommendation:** the invoice keeps a **provisional Alga number** and shows a "Number pending from Xero" badge. **Client-facing issuance is blocked** until the invoice is `external`.

Why the alternatives don't work:
- *A blank number* would break `NOT NULL` and the per-tenant unique constraint. It would also break every place that renders, searches or files by `invoice_number` (PDF filing names, search titles, email subjects, workflow events). Supporting a blank would mean changing all of them for a state that normally lasts only one sync cycle.
- *Allowing sends with the provisional number* is the bug the customer has today: the client receives a number that isn't in the books. And because an issued PDF is frozen (`fileGeneratedDocument` returns the issued copy), the wrong number would stay on the client's PDF permanently.

What is blocked while the invoice is `pending_external`:
- `sendInvoiceEmailAction` and `scheduleInvoiceEmailAction` refuse to send. Message: "This invoice is waiting for its invoice number from Xero. Export it to Xero, or wait for the next sync, before sending it."
- The client portal invoice list (`client-billing.ts`) and the portal PDF/preview actions treat `pending_external` like a draft and leave it out.
- `startInvoiceAutopay` is deferred: finalize skips it for a `pending_external` invoice, and the settle step's `afterCommit` hook starts it. Autopay receipts and payment records would otherwise quote the provisional number.

MSP users can still see the invoice and its PDF inside Alga. The badge goes in the invoice header beside `InvoiceSyncBadge` (`packages/billing/src/components/invoices/InvoiceSyncBadge.tsx`).

With auto-sync on, the delay before the invoice can be sent is one sync cycle. With auto-sync off, the user must export before sending. That is correct: in this mode the Xero number is the number of record.

### 5. Idempotency and retry

**The risk:** today a retried create is safe because Xero matches on `InvoiceNumber` and updates the existing invoice instead of inserting a new one (see the comments on `XeroInvoicePayload.externalInvoiceId` and `XeroInvoiceLinePayload.externalLineItemId`). Without `InvoiceNumber` there is nothing for Xero to match on. A create whose response was lost (a timeout), or whose Alga transaction rolled back after Xero committed, would create a **second** Xero invoice and use up a second number on retry. The existing mapping-before-push lookup in `transform` doesn't help, because the mapping is exactly what got lost.

Two mechanisms are added. Both apply only to `pending_external` creates.

**A. Look up the Reference before creating.** This is the mechanism that guarantees correctness.

New client method: `XeroClientService.findInvoicesByReference(refs: string[]): Promise<XeroInvoiceDetails[]>`. It sends one `GET /Invoices` with `where=` made of OR'd `Reference=="…"` clauses, filtered to `Type=="ACCREC"`, in chunks small enough to stay within URL length. Escape quotes in the reference.

In `deliver`, before `createInvoices`, call it for the pending creates in the batch: documents with no `externalInvoiceId` and `numberSource === 'pending_external'`. For each document:

| Matches found | Action |
|---|---|
| Exactly one, with the same `ContactID`, status not DELETED/VOIDED | Adopt it: set `externalInvoiceId` on the payload, which turns the create into an update by InvoiceID. |
| None | Create as normal. |
| More than one | Fail that document with `XERO_DUPLICATE_REFERENCE`, listing the Xero invoice ids. Never create another one. |

The Reference contains the provisional Alga number, which is unique per tenant, so a match means a previous attempt created that invoice. The lookup runs inside the execution transaction, under the invoice locks, after `reserveInvoicesForExport`, so two executions can't both get past it for the same invoice.

Cost: **one extra `GET` per delivery batch that contains pending creates**, and none for batches without them. Xero allows about 60 calls per minute and 5,000 per day per organisation, so one call per batch is small. Auto-sync batches are small, and a batch of N invoices still costs one GET, not N. I haven't measured the latency (there's no live Xero org in this environment). Expect one extra round trip of about the same cost as the POST. The implementer should log it and record a timing in the smoke test.

**B. `Idempotency-Key` header on the create POST.** This is an extra layer of protection.

`createInvoices` gains an optional `idempotencyKey` and sends it as the `Idempotency-Key` header. The adapter derives the key from `tenant`, `targetRealm` and the sorted list of pending invoice ids with their current `updated_at`, so the key changes only if an invoice was edited between attempts. Xero then replays the original response to a retry with the same key, even if the response was lost before the lookup could see the invoice. Xero only honours keys for a limited window, and I haven't checked its exact rules for reusing a key with a different body. **The implementer must confirm both against the current Xero Accounting API docs.** Correctness doesn't depend on it, because A covers every retry whenever it happens.

### 6. Concurrency

- **Inside Xero:** Alga never computes a Xero number. Xero assigns numbers on its side, one per created invoice, including several invoices in one `POST`, so there is nothing for Alga to race on. I have not verified whether Xero's API also rejects a number that a person in Xero typed by hand and that matches a later auto-number. The design doesn't depend on it: a duplicate reaches Alga's unique constraint and becomes `XERO_NUMBER_CONFLICT`, as described in §3.
- **Inside Alga:** two executions can't deliver the same invoice at once, because of `reserveInvoicesForExport` and the `FOR UPDATE` row locks taken by `lockInvoiceForExternalSync`. Two different invoices settled at the same moment write different numbers. The unique index is the last line of defence, and the savepoint turns a collision into a per-document failure instead of failing the whole batch.
- **Provisional numbers** still come from `SharedNumberingService`, which already serialises its counter. A clash between provisional and Xero numbers is only possible when the Alga numbering format overlaps Xero's. The settings hint (§1) tells the user to use a distinct prefix, and the conflict path handles any clash that still happens.

### 7. Guard rails

| Requirement | How it is enforced |
|---|---|
| Setting off: behaviour unchanged | Every invoice is `alga`. The transform sends `invoice.invoice_number` exactly as today. No lookup, no header, no write-back. |
| Updates by InvoiceID never change the Xero number | Existing rule in `mapInvoicePayload` (no `InvoiceNumber` when `externalInvoiceId` is set). A test pins it for `pending_external` and `external`. The settle step only writes Xero's number into Alga, never the other way. |
| QBO and CSV exports unaffected | Only `xeroAdapter.ts` and `xeroClientService.ts` read `invoice_number_source`. `quickBooksOnlineAdapter`, the QBD and CSV adapters, and `xeroCsvAdapter` don't change. Finalize only sets `pending_external` when the resolved integration is a Xero realm with the mode on. |
| Already-exported invoices keep their number | They have a mapping, so they always update by InvoiceID with no number. Their `invoice_number_source` stays `alga`. |
| Turning the setting off renumbers nothing | The mode is recorded per invoice at finalize. The setting only affects invoices finalized later. `external` is permanent. |
| PR #3850 Reference/PO split kept | `reference` is still built by `buildXeroInvoiceReference`. Only the `InvoiceNumber` input changes, and only for pending invoices. |

### 8. Tests

All of these go into the repo's existing test layout.

**Unit tests (vitest), `packages/integrations/src/lib/xero/`:**
- Extend `xeroClientService.invoiceNumber.test.ts`:
  - `invoiceNumber: null` on create leaves out `InvoiceNumber`.
  - The response's `InvoiceNumber` comes back in `XeroInvoiceCreateSuccess.invoiceNumber`.
  - The `Idempotency-Key` header is sent only when a key is given.
- New `xeroClientService.findInvoicesByReference.test.ts`:
  - Builds the `where` clause, including quote escaping.
  - Splits large inputs into chunks.
  - Filters by `ACCREC`.
- New `xeroInvoiceNumberingSettings.test.ts`:
  - Missing or malformed values normalise to off.
  - Setting one realm preserves other keys in `settings`, including `accountingSync`.

**Unit tests (vitest), `packages/billing/src/adapters/accounting/`:**
- Extend `xeroAdapter.invoiceNumber.test.ts`, which uses the in-memory harness:
  - `pending_external` gives `invoiceNumber: null` and keeps the Reference (with PO suffix) unchanged.
  - `alga` gives the plain number, which is today's behaviour.
  - An existing mapping always gives `externalInvoiceId` and no number.

**DB tests, `packages/billing/src/adapters/accounting/`:** new `xeroAdapterAssignedNumbering.db.test.ts`, following the style of `xeroAdapterFailClosed.db.test.ts`, with the Xero client mocked:
- A successful create writes Xero's number to `invoices.invoice_number`, sets `external`, renames the working PDF document, and fills the mapping metadata (`doc_number`, `algaInvoiceNumber`, `provisionalAlgaInvoiceNumber`).
- A unique conflict keeps the mapping, leaves the invoice `pending_external`, reports `XERO_NUMBER_CONFLICT`, and the batch is `needs_attention`. Once the conflict is cleared, a retry updates by InvoiceID and settles.
- After a lost response, the Reference lookup adopts the existing Xero invoice and `createInvoices` is called with `InvoiceID`. No second create.
- More than one Reference match gives `XERO_DUPLICATE_REFERENCE` and nothing is posted.
- A response with no number gives `XERO_NUMBER_NOT_RETURNED`, the mapping is kept, and the next delivery settles.

**DB tests, finalize and guards:**
- New `packages/billing/src/actions/invoiceNumberSource.db.test.ts`:
  - Finalize with the mode on for the resolved Xero realm sets `pending_external`. With the mode off, or with QBO, the invoice stays `alga`.
  - Unfinalize resets `pending_external` to `alga` and leaves `external` alone.
  - Turning the setting off doesn't change existing rows.
  - Autopay is deferred while pending.
- Extend the `invoiceJobActions` send tests: a `pending_external` invoice is refused with the actionable message.
- Extend `client-billing.invoicePdf.test.ts` and the client portal invoice-list tests: `pending_external` invoices are hidden.

**UI contract test:** new `XeroIntegrationSettings.invoiceNumbering.contract.test.tsx`, modelled on `QboIntegrationSettings.contract.test.tsx`:
- The switch renders only when there is a default connection.
- It is disabled without `connections_manage`.
- It calls `setXeroInvoiceNumberingMode` with the default connection's realm.

**Regression:** the existing QBO and CSV export tests (`qboAdapterUnlinkExport.db.test.ts`, `qboSharedItemExport.db.test.ts`, `exportCurrencyScaling.test.ts`) pass without changes.

**Manual smoke test** against a Xero demo company:
1. Turn the setting on, finalize an invoice, and confirm it shows "Number pending from Xero" and that sending is refused.
2. Export it. The Xero invoice has Xero's next number, and Alga's UI, PDF, email and portal all show that number.
3. Edit the invoice and export again. The Xero number doesn't change.
4. Turn the setting off and finalize a new invoice. It exports with Alga's number.

### 9. What this design does not do

- **No renumbering of history.** Invoices finalized before the setting was turned on, and invoices already in Xero, keep their numbers.
- **No reconciliation of numbers changed or deleted in Xero.** If someone renumbers or deletes a Xero invoice after it has been settled, Alga doesn't follow. The `fetchChanges` poll keeps its current behaviour.
- **No change to Billing Settings → Numbering.** Provisional numbers still come from the existing sequence. The only guidance is the hint text on the Xero setting.
- **No credit notes.** Credit notes keep Alga's `CREDIT_NOTE` sequence. Xero gives credit notes their own number sequence, and `XeroAdapter.capabilities().supportedExportTypes` is `['invoice']`. A future card could cover them using the same `invoice_number_source` mechanism.
- **No QBO equivalent.** The `invoice_number_source` column and the settle step don't depend on the provider. A QBO version would need the QBO adapter to leave out `DocNumber` and to read the number back. That is a separate card.
- **No automatic fix for `XERO_NUMBER_CONFLICT`.** A person resolves it; the error says what to rename.
- **No change to how often the sync cycle runs.**

## Files to change (for the implementation step)

- `server/migrations/<ts>_add_invoice_number_source.cjs` (new)
- `packages/integrations/src/lib/xero/xeroInvoiceNumberingSettings.ts` (new)
- `packages/integrations/src/lib/xero/xeroClientService.ts`: `findInvoicesByReference`, the `Idempotency-Key` option
- `packages/integrations/src/actions/integrations/xeroActions.ts` and `actions/index.ts`: get/set actions
- `packages/integrations/src/components/settings/integrations/XeroIntegrationSettings.tsx`: switch section, plus i18n keys
- `packages/billing/src/adapters/accounting/xeroAdapter.ts`: `loadInvoices` select, payload number choice, recovery lookup, settle step
- `packages/billing/src/actions/invoiceModification.ts`: record the mode at finalize, reset on unfinalize, defer autopay
- `packages/billing/src/actions/invoiceJobActions.ts`: refuse email and scheduled email while pending
- `packages/client-portal/src/actions/client-portal-actions/client-billing.ts`: hide pending invoices
- `packages/billing/src/components/invoices/`: "Number pending from Xero" badge
- `packages/event-schemas`: `INVOICE_NUMBER_ASSIGNED` event schema
