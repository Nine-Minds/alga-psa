# Inventory Loaners UI — adversarial-review remediation plan

**Branch:** `feature/inventory-loaners-ui`
**Date:** 2026-07-10
**Screen:** `/msp/inventory/loaners` → `packages/inventory/src/components/LoanersManager.tsx`, backed by `packages/inventory/src/actions/loanerRestockActions.ts`

## Context

A full adversarial design review (six code-grounded critic lenses plus a live-browser persona pass against the running dev stack) found the Loaners screen far below the module's post-polish standard (Stock Units, RMA, Vendor Bills). Findings were ranked by independent critic consensus and verified against code. Two findings were unanimous blockers; one was reproduced live as a security-adjacent defect.

**The screen's job:** (1) loan a serialized unit out to a client fast — the dispatcher has a serial number on a sticker, not a UUID; (2) see what's out, with whom, and what's overdue, and chase it; (3) take units back into stock.

### Blockers (unanimous)

1. **Loan-out demands raw UUIDs.** "Unit ID" and "Client ID" are bare text inputs bound to the action's wire format (`LoanersManager.tsx:252-265`). `ClientPicker` is used one screen over (`SalesOrdersManager.tsx:756`); `searchUnitsBySerial`/`searchUnitsByMac`/`listAvailableStockUnits` exist in `stockUnitActions.ts` and are unused here. The screen's primary job is impossible without copy-pasting UUIDs from another surface.
2. **Overdue is invisible.** The Due column is a bare `toLocaleDateString()`; overdue, due-tomorrow, and no-due-date rows render identically. The dashboard computes overdue loaners (`dashboardQueries.ts:503-506`) and its "recall" attention action links to this page (`inventoryDashboardActions.ts:576`) — a dead end.
3. **Raw SQL leaks into toasts.** Typing a serial into the Unit ID box produces a Postgres `22P02` uuid-cast error whose message — including the full Knex SQL text — is shown verbatim in a toast (reproduced live). `loanerActionErrorFrom` maps only `23503`/`23505` (`loanerRestockActions.ts:58-64`). Additionally, the three status-guard errors ("Unit must be in_stock to loan out (current status: allocated)") pass snake-case enum values straight to users (`loanerRestockActions.ts:48-54`).

### Structural finding

**"Restock return" cannot act on anything the screen shows.** It is the design-doc §6.H flow (delivered/returned good stock → sellable, with restocking fee) grafted onto the §6.E loaners screen. `restockReturn` rejects `on_loan` units (`loanerRestockActions.ts:247-248`), the table shows only `on_loan` units, and a successful restock is invisible because `reload()` re-queries the loaners-out report. The non-serialized path the action supports is unreachable from the UI, and the restocking fee is collected and then dropped — zero consumers of `restocking_fee_cents` exist outside the action and this component.

### Other consensus findings folded into this plan

- "Since when / days out" is specified in the original design (`docs/plans/2026-06-26-inventory-module-design.md` §6.E: "where, since when, due back") and never implemented — the report never touches the movement ledger.
- No search, filter, summary count, empty state, loading state, or refresh (all sibling patterns exist in `StockUnitsManager.tsx`).
- Rows are dead ends: no unit-history access (`getUnitDetail` + the Stock Units history dialog pattern exist), client cell is plain text that falls back to a raw UUID (`ClientNameCell` exists).
- `mac_address` is selected by the report and never rendered.
- Return dialog pre-selects `locations[0]` — an arbitrary stock write target that van-scoping can even reject.
- Voice: 13 findings — schema jargon as labels, "Failed to load X" against the "Couldn't X. Try again." house register, generic "Saving…", untranslatable string concatenation, "sellable" internal jargon, inconsistent toast punctuation.
- No way to extend a loan's due date; the only workaround (return + re-loan) writes false `loan_in`/`loan_out` ledger movements.

## Decisions (settled with Robert, 2026-07-10)

1. **Restock return moves to Stock Units.** Loaners loses the button and dialog. Stock Units gains the flow, including the non-serialized mode the backend already supports.
2. **Add `updateLoanDueDate`.** New small action + "Extend" row action on Loaners.
3. **Restocking fee is wired to billing** as a **draft manual invoice** (existing `generateManualInvoice` machinery): restock with fee > 0 creates a draft one-line invoice ("Restocking fee — {serial/product}") for the client; the biller reviews before sending. The goods refund stays the biller's normal AR workflow.
4. **No "Available" tab.** The loan-out serial typeahead (showing in-stock units with product + location) answers "what can I loan"; browsing `in_stock` units remains Stock Units' job.

## Architecture constraint

`@alga-psa/billing` depends on `@alga-psa/inventory` (`packages/billing/package.json`), never the reverse. Therefore:

- The composite **restock + fee-invoice** action lives in **`packages/billing`** (it may import inventory's `restockReturn` and its own invoice machinery).
- `StockUnitsManager` (in the inventory package) cannot import billing. The Next.js page — `server/src/app/msp/inventory/units/page.tsx` — imports the composite action and passes it into the component as a typed prop. The app layer composes domains; the packages stay acyclic.

---

## Workstream 1 — Actions layer

### 1.1 Split `loanerRestockActions.ts`

- `packages/inventory/src/actions/loanerActions.ts`: `loanOut`, `loanReturn`, `loanersOutReport`, new `updateLoanDueDate`, plus the loaner error mapper.
- `packages/inventory/src/actions/restockReturnActions.ts`: `restockReturn` (+ its error cases from the shared mapper).
- Update `packages/inventory/src/actions/index.ts` re-exports; grep for direct imports of the old module path (the loaners page imports from `@alga-psa/inventory/actions`, so re-exports should cover it).

### 1.2 Extend `loanersOutReport` with "out since"

Add `loaned_at` to `LoanerOutRow` via a lateral/max join on the unit's latest `loan_out` movement (`stock_movements`, `movement_type = 'loan_out'`, matching `unit_id` + tenant, `max(created_at)`). No schema change. Days-out is computed at render.

### 1.3 New `updateLoanDueDate`

In `loanerActions.ts`:

- Signature: `updateLoanDueDate(unitId, { loan_due_at: string | Date | null })`.
- Guards: `inventory update` permission; unit exists; `status === 'on_loan'` (reuse the guard-error mapping style).
- Effect: patch `stock_units.loan_due_at` only — **no stock movement** (the ledger records physical changes; a due-date change is not one). Emit `publishStockUnitUpdated(tenant, unit_id, service_id, user_id, ['loan_due_at'])`, following `rmaActions.ts`.
- No `assertLocationWritable` — an on-loan unit has no location.

### 1.4 Error-envelope hardening (both new action files)

- Map Postgres `22P02` (invalid uuid/input syntax) alongside `23503`/`23505`: "That doesn't look like a valid record reference. Pick the unit and client from the lists." (With pickers in place this becomes a defense-in-depth path, but the raw-SQL leak must be closed at the action layer regardless.)
- Humanize the three status-guard errors instead of passing them through, using human status labels: e.g. "This unit can't be loaned out — it's currently On loan." / "This unit isn't out on loan — it's currently In RMA." / "This unit can't be restocked — it's currently On loan. Only delivered or returned units can be restocked." Keep the existing throw-message contract inside the transaction; translate in the mapper, matching how lines 31-46 already handle the other eight cases.
- Trim "Please refresh and try again." → "Refresh and try again." in the two generic DB-error messages.

### 1.5 Composite billing action: `restockReturnWithFee`

New `packages/billing/src/actions/restockingFeeActions.ts`:

- Input: the `restockReturn` input plus `client_id?: string` (required when a fee is present and the path is non-serialized; for the serialized path the client is read from the unit **before** `restockReturn` clears it).
- Behavior: call inventory's `restockReturn`. If it errors, return the error. If it succeeds and `restocking_fee_cents > 0`, attempt to create a **draft manual invoice** for the client with one line — description "Restocking fee — {serial or product name}", rate = fee — reusing the `generateManualInvoice` internals (`packages/billing/src/actions/manualInvoiceActions.ts` / `invoiceService.persistManualInvoiceCharges`). Prefer extracting/ calling a function that skips the `withAuth` re-wrap; the fee-invoice step requires `billing create` permission.
- **Non-atomic by design:** the physical restock commits first; invoice creation is a follow-up. The result reports what happened:
  `{ movement, restocking_fee_cents, fee_invoice?: { invoice_id, invoice_number } , fee_invoice_error?: string }`.
  Failure modes that must degrade gracefully with a specific `fee_invoice_error` (restock still succeeds): user lacks `billing create`; client has no billing email (`validateClientBillingEmail`); any invoice-service error.
- Unit/contract test alongside existing billing action tests.

## Workstream 2 — Loaners screen rebuild (`LoanersManager.tsx`)

### 2.1 Loan-out dialog

- **Unit field → serial/MAC typeahead** using `AsyncSearchableSelect` (`packages/ui/src/components/AsyncSearchableSelect.tsx`): `loadOptions` calls `searchUnitsBySerial(term)` and (when the term contains `:` or matches MAC shape) `searchUnitsByMac(term)`, merged and filtered to `status === 'in_stock'`. Option label: `serial — product · location` (the picker doubles as the availability answer, per decision 4). Selection stores `unit_id`.
- **Client field → `ClientPicker`** (`@alga-psa/ui/components/ClientPicker`). The page (`server/src/app/msp/inventory/loaners/page.tsx`) loads clients the same way the sales-orders page does (`server/src/app/msp/inventory/sales-orders/page.tsx` — `getAllClients`) and passes them down.
- Due date stays the native `Input type="date"` (module-wide convention, confirmed deliberate).
- Client-side validation toasts become imperative: "Choose a unit." / "Choose a client."

### 2.2 Table

Columns: Serial (font-mono, MAC as a muted font-mono second line when present, ` · SKU` muted suffix retained), Product/Service, Client (`ClientNameCell` — linkable, never a raw UUID), **Loaned** (date + "Nd out" derived from `loaned_at`), **Due** (see below), Actions.

- **Due cell:** red `text-red-600 font-medium` + "{{n}}d overdue" line when past due (precedents: `VendorBillsManager.tsx:257-268`, `RmaManager.tsx:302-306`, dashboard's `"{{n}}d overdue"` phrasing); warning treatment when due within 7 days; muted "No due date" when null (an open-ended loan is a fact, not missing data). Overdue is **derived at render — never a persisted status**.
- All empty cells use the muted `—` `emptyCell` convention (`StockUnitsManager.tsx:315`).
- Actions column: fixed width, right-aligned header, `sortable: false` (sibling convention); row actions **Return**, **Extend**, **History**.
- `formatDue`'s `String(value)` garbage passthrough is removed (return the muted em dash on parse failure, matching siblings).

### 2.3 Header + list furniture

- Subtitle summary line: "{{n}} out · {{m}} overdue" (pattern: `StockUnitsManager.tsx:413-423`).
- `SearchInput` filtering client-side across serial, MAC, client, product.
- "Overdue only" filter (CustomSelect or toggle, matching the Stock Units filter row idiom).
- Refresh button + `loading` state (pattern: `StockUnitsManager.tsx:140,424`); per-dialog `saving` flags instead of the single shared boolean.
- `EmptyState` both variants: no-data ("Nothing out on loan" / "Units you loan to clients appear here until they come back." + Loan out action) and no-match ("No loaners match" + clear-filters action). Pattern: `StockUnitsManager.tsx:479-504`.

### 2.4 Row actions

- **Return:** location select starts **empty** with the required placeholder (kill the `locations[0]` prefill — an arbitrary stock write target). Nice-to-have if cheap: derive a suggested default from the unit's `loan_out` movement's `from_location_id`; otherwise empty is correct.
- **Extend:** new dialog — current due date shown, date input, calls `updateLoanDueDate`. Copy: title "Extend loan", button "Update due date".
- **History:** reuse the Stock Units unit-history dialog. **Extract it** from `StockUnitsManager.tsx` (~lines 507+) into a shared `packages/inventory/src/components/UnitHistoryDialog.tsx` consumed by both screens (second use of the same shape — extraction, not copy).

### 2.5 Remove restock from this screen

Delete the "Restock return" header button, dialog, and related state/i18n usage from `LoanersManager.tsx` (it moves to Stock Units, Workstream 3).

### 2.6 Voice pass (all strings, en locale first)

- Dialog title "Loan out unit" → "Loan out a unit".
- Errors adopt the house register: "Couldn't load loaners. Try again." / "Couldn't loan the unit out." / "Couldn't return the loaner."
- Progress labels action-specific: "Loaning out…", "Returning…" (kill generic "Saving…").
- "Returning {serial}" concatenation → single interpolated key "Returning {{serial}} to stock."
- Success toasts carry the object and a period: "{{serial}} loaned out." / "{{serial}} returned to stock."
- Column header "Unit / Serial" → "Serial".

## Workstream 3 — Restock lands on Stock Units (`StockUnitsManager.tsx` + units page)

- Header button "Restock a return" (secondary/outline) + per-row **Restock** action visible only for `delivered`/`returned` units (row prefills the unit — no lookup needed).
- Dialog modes:
  - **Serialized unit:** unit via row prefill or the same serial typeahead filtered to `delivered`/`returned`; location select with "Use unit's current location" default (existing meaningful-default pattern); `CurrencyInput` fee.
  - **Quantity of product (non-serialized):** product select backed by `listInventoryProducts` (filtered to non-serialized), location select (required), quantity, fee + **client picker** (required only when a fee is entered — the fee invoice needs a client; the serialized path derives the client from the unit).
- Submits through `restockReturnWithFee`, passed in as a typed prop from `server/src/app/msp/inventory/units/page.tsx` (architecture constraint above). The page also passes clients for the picker.
- Success surfacing — never silent about money:
  - Fee invoice created → toast "Unit restocked. Draft invoice {{number}} created for the {{amount}} restocking fee." (link to the invoice if a route helper is available).
  - Fee entered but invoice failed → success-with-warning toast stating the restock succeeded and exactly why the invoice wasn't created ("no billing email on the client", "you don't have billing permission", …) with "Create it manually."
  - No fee → "Unit restocked." / "{{qty}} × {{product}} restocked."
- Copy: "Restock a return" (button), "Restock a returned unit" (dialog title), "Restock" (submit), "Restocking…" (progress). The word "sellable" does not appear in user-facing strings.
- Fee label drops the baked-in "(optional)" (requiredness is prop-driven per sibling convention).

## Workstream 4 — i18n

- Update `server/public/locales/en/features/inventory.json` (`loaners.*` block rewritten; new `stockUnits.restock.*` block; new keys for extend/history/overdue/empty states).
- Mirror key additions/removals across the other locale files (`de`, `es`, `fr`, `it`, `nl`, `pl`, `pt`, and the `xx`/`yy` pseudo-locales), following however those files currently handle the inventory feature block.
- Remove keys that die with the restock-on-loaners removal and the `returningPrefix` concatenation.

## Workstream 5 — Verification

- Type check + lint the touched packages (`inventory`, `billing`, `ui` if touched, server app).
- Unit tests: `updateLoanDueDate` guards; `loanersOutReport` `loaned_at` join; `22P02` + guard-error mapping; `restockReturnWithFee` (fee → draft invoice; graceful degradation on missing billing email / permission; no fee → no invoice). Extend `packages/inventory/src/lib/flows.test.ts` where loaner flows are already covered.
- Live verification on the dev stack (localhost:3737): **seed at least one serialized in-stock unit and one delivered unit first** (the review found the dev DB has zero stock units — the screen has never been exercised with data). Walk: loan out via typeahead + ClientPicker → row shows Loaned/Due → extend → overdue styling (backdate `loan_due_at`) → search + overdue filter → return (location starts empty) → Stock Units restock with fee → draft invoice exists in billing → non-serialized restock. Exercise, don't just render: empty states, garbage input (no SQL in any toast), the fee-failure warning path.

## Explicitly not changing (verified module conventions)

Root `p-6 space-y-4`; `h1 text-2xl font-semibold`; dialog `space-y-4 p-1`; header button variants (outline secondary + solid primary); per-row outline `sm` buttons for state-changing actions; native date inputs; dialog field order (what → who → when). The raw `text-gray-500` shade is module-wide and stays (the defect was the `''` empties, not the gray).

## Out of scope — logged proposals

1. **Loaner ↔ RMA/ticket linkage** (`source_doc_id` on loan-out; "Loan a unit" from an RMA case; "why is this out" column). Needs product design; the canonical MSP loaner accompanies an RMA.
2. **Designated loaner-pool concept** (flagging units/products as loaner stock; an "Available" view). Revisit if dispatchers ask post-picker.
3. **Full return credit** (goods value minus fee via `so_line` → `invoice_charges` backlink). The draft-fee-invoice decision deliberately leaves the goods refund to the biller.
4. **Fleet-wide cleanups** flagged during review, worth `// LEVERAGE` markers where touched: hand-rolled per-manager `fmtDate`/`isReturnedActionError` copies; raw unit-ID input in `RmaManager.tsx:405-411`; RBAC error strings ("Permission denied: inventory update required") surfacing internals module-wide.

## Review artifacts

Critic reports and Gus's live screenshots are in the session scratchpad (`scratchpad/synthesis-notes.md`, `scratchpad/gus/*.png`); durable findings were recorded to the workflow card dossier.
