# Plan: first invoice from a quote-converted contract fails (alga0002168)

- Card: `51339be4-12ba-46a6-be4b-cdb1c16c4e2d` (AlgaPSA ticket alga0002168, High)
- Branch: `feature/alga0002168-first-invoice-from-a-quote-converted-2`
- Base: `origin/main` `b0d0b4dacf`
- Status: design. No product code has changed yet.

## 1. Summary

The first invoice fails because quote conversion writes every contract line with
`contract_lines.is_active = false`, and nothing ever sets it back to true. "Set to
Active" promotes the contract header and the assignment, but it never touches the
lines. Service-period materialization only picks up lines where `cl.is_active = true`,
so the quote contract never gets any `recurring_service_periods` rows and is never
invoiceable.

Other code paths decide which lines are live by checking only
`client_contracts.is_active`. Conversion sets that flag to true even while the contract
is still a draft. So those paths treat the quote contract's lines as live lines that
should have periods but don't. As a result, every invoice window for that client is
refused with "Recurring service periods were not materialized…", **including windows
for the client's other, healthy contracts**. That matches the report: the client shows
as Ready because its other contract has periods, and then both preview and generate
fail.

The original "open first period" hypothesis is wrong. When the lines are active, the
advance-billed first period for the current month previews and generates correctly
(verified, §2.3).

Three more defects make this worse:

- **Generation hides the cause.** Generation returns the not-materialized,
  nothing-to-bill and no-active-lines refusals as bare English action errors with no
  code. It reports every unmapped exception as "Failed to generate invoice for this
  billing cycle." Preview has had coded messages since PR #3555. Generation never got
  the same treatment.
- **Delete is not atomic and is not Citus-safe.** `Contract.delete` runs without a
  transaction. It relies on `ON DELETE SET NULL (converted_contract_id)` on
  `quotes` and `opportunities`, but that FK form is only created on plain Postgres 15+.
  On Citus the FK is NO ACTION. The final `contracts` delete then fails with `23503`
  after the assignment, lines and periods have already been deleted. The row drops out
  of the list, and the user sees a misleading "no longer exists" toast.
- **Conversion's draft state differs from the wizard's.** A wizard draft has
  `cc.is_active = false` and active lines. A quote draft has `cc.is_active = true` and
  inactive lines.

## 2. Reproduction (from code, on this worktree)

### 2.1 Harness

The repro was a throwaway DB-backed vitest suite: the infrastructure-test mock header,
`TestContext` with seeds, `TEST_DB_NAME=test_alga2168`, and `.env.localtest`. It drove
the **real** code path:

1. `Quote.create` with three recurring fixed lines (Workstations $1,500, Servers
   $2,000, Backup $700), one one-time catalog item and one one-time custom item. Status
   is set to accepted.
2. `convertQuoteToDraftContract` (the service behind `convertQuoteToContract`).
3. `activateClientContractForBilling(clientContractId)`, which is the action behind both
   "Set to Active" menu items.
4. `getAvailableRecurringDueWork`, then `previewGroupedInvoicesForSelectionInputs`
   (what Preview Selected calls), then `generateGroupedInvoicesAsRecurringBillingRun`
   (what Generate calls).

The client had a monthly billing cycle for the current month.

The repro file was not committed. A copy is at `/tmp/r2168/repro2168.test.ts`. The
regression suite in §6 replaces it.

### 2.2 Observed

**After conversion and Set to Active, with the client's only contract being the quote
contract:**

- All three `contract_lines` rows have `is_active=false`, `cadence_owner=client` and
  `billing_timing=advance`.
- The header is `status=active`, `is_active=true`, and `client_contracts.is_active=true`.
- `recurring_service_periods` for the lines is **empty**.
- Due work is **empty**. The quote contract can never be invoiced.

**The same flow when the client also has a healthy active contract (the demo case):**

- The healthy contract has client-cadence periods, so the client has due windows.
- Preview returns `success:false, code:'RECURRING_PERIODS_NOT_MATERIALIZED'`.
- The run returns `invoicesCreated: 0`. Every failure has
  `errorMessage: "Recurring service periods were not materialized for this recurring
  execution window."` and **no `code`**.
- In the UI, `localizeRecurringFailure` gets no code, so it shows the raw English
  string, which is untranslated. If the window throws a different, unmapped exception,
  the user instead sees "Failed to generate invoice for this billing cycle."
  (`recurringBillingRunActions.ts:407`, `:877`).
- The healthy contract's invoice is blocked too.

**Control:** the same flow with the converted lines set to `is_active=true` before Set
to Active. Periods materialize for the current month (advance), the client is offered,
preview succeeds, and generate creates the invoice with no failures.

The local `server` DB has 18 quote-converted lines across 6 contracts. Every one has
`is_active=false` and 0 periods, so the same signature applies to existing data.

### 2.3 Root-cause chain (file:line on `b0d0b4dacf`)

1. `packages/billing/src/services/quoteConversionService.ts:712` inserts lines with
   `is_active: false`. `:833` inserts `client_contracts.is_active: true` for a **draft**
   header (`:670-671`, `status: 'draft'`, `is_active: false`).
2. `shared/billingClients/clientContracts.ts:663-712`
   (`activateClientContractAssignment`) updates `contracts` and `client_contracts`. It
   never updates `contract_lines`.
3. `packages/billing/src/actions/billingClientsActions.ts:318` resyncs periods.
   `shared/billingClients/clientCadenceScheduleRegeneration.ts:305-332`
   (`loadClientCadenceRecurringObligations`) requires `cc.is_active`, `ct.is_active` and
   **`cl.is_active`**, so it produces no obligations and no rows. The contract-cadence
   sweep (`contractCadenceServicePeriodMaterialization.ts:719-740`) applies the same
   filter.
4. Three paths decide "live line" by `cc.is_active` alone:
   - `packages/billing/src/lib/billing/clientCadenceWindowMaterialization.ts:114-150`
     (`listUnmaterializedClientCadenceWindowLineIds`).
   - The billing engine's line loader `billingEngine.ts:3245-3300`. Its `is_active`
     column is `cc.is_active`, so the `line.is_active` checks at `:5579/:5591` test the
     assignment, not the line.
   - Time-entry and usage eligibility at `billingEngine.ts:2535-2560`.

   None of them filter on `ct.is_active` or `cl.is_active`.
5. The materialization guard sees inactive or draft lines as live lines with missing
   periods. `invoiceGeneration.ts:1513-1527` throws the not-materialized error, and
   `billingAndTax.ts:1536` and `recurringBillingRunActions.ts:638` gate eligibility on
   the same answer.

The same predicate drift also hits a contract line removed through
`removeClientContractLine` (`packages/clients/src/actions/clientContractLineActions.ts:545-551`,
which sets `is_active=false`). It is not specific to quotes.

## 3. Design decisions

### D1. One shared definition of a live recurring line (engine-level fix)

Add `scopeToLiveRecurringContractLines(query, { cc, ct, cl })` in
`shared/billingClients/` as a new module, `liveRecurringLineScope.ts`. It applies:

- `cc.is_active = true`
- `ct.is_active = true`
- `cl.is_active = true`
- `ct.is_system_managed_default` is false or null, where the caller needs it (see
  below)

Every reader that answers "is this line billable or expected to have periods" uses it:

| Site | Change |
|---|---|
| `clientCadenceScheduleRegeneration.ts:305` `loadClientCadenceRecurringObligations` | use helper (behavior identical) |
| `clientCadenceScheduleRegeneration.ts:~619` `loadClientsWithClientCadenceObligations` | use helper (adds ct/cl filters) |
| `contractCadenceServicePeriodMaterialization.ts:719` | use helper (identical) |
| `contractCadenceCoverageAudit.ts:~108` raw SQL | add `ct.is_active`, and confirm `cc.is_active`, so it matches the sweep |
| `clientCadenceWindowMaterialization.ts:114` `listUnmaterializedClientCadenceWindowLineIds` | use helper. **This is the fix that stops one contract from blocking another.** |
| `billingEngine.ts:3245` client contract line loader | use helper, and select `cl.is_active` explicitly so `:5579/:5591` test the line |
| `billingEngine.ts:2535` time and usage eligibility | use helper |

Rationale: the materializer, the guard and the engine must agree on what a live line
is. Today each one re-derives it, and they have drifted apart. This matches the
"Leverage & layering" rule and the existing `LEVERAGE` marker culture. Add
`// LEVERAGE: pattern live-recurring-line-scope` at any remaining site that cannot
adopt the helper.

`is_system_managed_default` handling: the materializer excludes system-managed default
contracts, but the engine must still bill them (they carry ad-hoc time). So the helper
takes `{ excludeSystemManagedDefault: boolean }`:

- Materializer and guard call sites pass `true`.
- Engine call sites pass `false`.

The implementer must keep the current per-site behavior for that flag unchanged. Only
the `ct.is_active` and `cl.is_active` filters are new.

Behavior change to call out in the PR: once a line is removed
(`removeClientContractLine`), or once a contract header is inactive or a draft, the
engine no longer bills it, even if a period row exists. Two cases follow:

- Unbilled periods of an inactive line are no longer billed. The materializer already
  stopped creating new ones, so this restores consistency.
- Billed history is unaffected. History reads go through invoices, not the line loader.

The implementer must check `invoiceGeneration.ts` callers of the line loader that serve
**already-billed** windows (reversal, credit and recalculation) and keep those on the
unscoped read if they exist.

### D2. Conversion writes the wizard's draft shape

In `convertQuoteToDraftContract`:

- `contract_lines.is_active: true`. The header carries draft-ness, the same as the
  wizard, where the line default is true (`contractWizardActions.ts`, line insert
  without `is_active`).
- `client_contracts.is_active: false` while the header is a draft. This is the wizard
  rule `is_active = !isDraft` (`contractWizardActions.ts:1612-1640`). "Set to Active"
  flips it to true through `activateClientContractAssignment`, which already does this.
- Write `start_date` as a date-only value: the `accepted_at`/`quote_date` date in the
  tenant's effective time zone, not a timestamp cast by the DB session. Use
  `resolveEffectiveTimeZone` the way other billing date writes do.
- Leave `cadence_owner` and `billing_timing` as they are. Advance billing for fixed
  quote lines is deliberate, per the card.

`convertQuoteToDraftContractAndInvoice` (`:1273`) and the opportunity-win path
(`packages/opportunities/src/lib/opportunityWin.ts:61`) both call
`convertQuoteToDraftContract`. They inherit the fix.

Check before changing `cc.is_active`: grep the Client Contracts and Contracts list
status derivation (`deriveClientContractStatus`) and the "Set to Active" menu-item
visibility. They must treat `(ct.status='draft', cc.is_active=false)` the same as a
wizard draft. That should be the case, because wizard drafts already have that shape.

### D3. Activation repairs inactive lines left by conversion, without blindly reactivating

Existing data already has quote contracts with every line inactive, both drafts and
contracts already "activated". Besides the migration (D4), make
`activateClientContractAssignment` self-healing for exactly this signature. **Only when
all** lines of the contract are `is_active=false` and the contract has
`template_metadata->>'conversion_kind' = 'quote_to_contract'`, set them all to true
before the resync in `activateClientContractForBilling`.

A contract where the user deliberately removed some lines always has at least one
active line, so it never matches. A contract where every line was removed is not a
billable contract anyway.

### D4. Data migration for existing tenants

Add a new migration in `server/migrations/`, Citus-safe: plain `UPDATE`s scoped by
tenant, with no FK or DDL changes.

1. For quote-converted contracts (`template_metadata->>'conversion_kind' =
   'quote_to_contract'`) where every line is inactive, set `contract_lines.is_active =
   true`.
2. For quote-converted contracts with `status='draft'`, set
   `client_contracts.is_active = false`.

Periods for contracts that were already activated are not created by the migration.
They appear in either of two ways:

- The next "Fix all" on Automatic Invoices (`repairAllRecurringServicePeriodsForTenant`
  goes through `loadClientCadenceRecurringObligations`, which now sees the lines).
- Running Set to Active again.

The coded RECURRING_PERIODS_NOT_MATERIALIZED message (D5) already tells the operator to
use Fix all. Put that note in the PR description and the release note.

### D5. Generation surfaces coded, translated failures (parity with PR #3555)

Make the engine identify these refusals by **type**, not by English sentence. This
retires `// LEVERAGE: friction engine-failure-identity`
(`invoiceGeneration.ts:~1000`).

1. **Throw coded errors at the source.** Replace each bare `new Error(...)` with
   `ManualInvoiceError(code, message, params)` from
   `packages/billing/src/errors/manualInvoiceErrors.ts`. Keep the existing English text
   as the message.
   - `'Recurring service periods were not materialized…'` becomes
     `RECURRING_PERIODS_NOT_MATERIALIZED`. Sites: `invoiceGeneration.ts:1397, 1506, 1524,
     1580, 1642, 1793`, `invoiceService.ts:222` and `recurringBillingRunActions.ts:591`.
     Params: `{ periodStart, periodEnd }` plus `contractLineIds` (comma-joined) where
     `listUnmaterialized…` supplied them.
   - `'Nothing to bill'` becomes `NOTHING_TO_BILL`. Sites: `invoiceGeneration.ts:2512,
     3238, 3807`. At `:3238`, keep the engine warning as the message when present.
   - `'No active contract lines found…'` becomes `NO_ACTIVE_CONTRACT_LINES`. The engine
     *returns* this as `billingResult.error` (`billingEngine.ts:1795`), and generation
     re-throws it as a bare `Error` at `invoiceGeneration.ts:1981` and `:3616`. Today
     that sentence is not on the generation allowlist, so it reaches the user as the
     generic "Failed to generate…" message. Add `errorCode?: ManualInvoiceErrorCode` to
     the engine's `BillingResult`, set it at `:1795`, and have the re-throw sites throw
     `ManualInvoiceError(billingResult.errorCode, billingResult.error)` when it is set.
   - `billingEngine.ts:1352`, "Recurring service periods **have not been** materialized
     for client X…" (eligible lines exist but have no period rows). It matches neither
     mapper today, so preview shows the generic message too. It becomes
     `RECURRING_PERIODS_NOT_MATERIALIZED`.

   Keep `withRecurringWindowErrorContext` wrapping. It must preserve the error class and
   its `code` and `params`; check that it mutates and does not re-wrap.
2. **One code↔key registry.** Every coded key already follows
   `msp/invoicing:manualInvoices.errors.<CODE>`. Replace the hand-written switch
   `manualInvoiceErrorMessageKey` (`invoiceGeneration.ts:1112`) and the if-chain
   `handledRecurringFailureFromActionError` (`recurringBillingRunActions.ts:94-161`) with
   a single module, `packages/billing/src/errors/invoiceFailureMessageKeys.ts`, that
   exports:
   - `messageKeyForInvoiceFailureCode(code)`
   - `invoiceFailureCodeFromMessageKey(key)`

   It covers the full `HandledManualInvoiceErrorCode` set, plus the two non-standard
   keys: `TIME_APPROVAL_REQUIRED` and the duplicate-invoice key, which stays a skip
   signal and never becomes a failure. The `*_MESSAGE_KEY` constants in
   `invoiceGeneration.constants.ts` stay as re-exports, so existing imports and tests
   keep working.
3. **Boundary.** In `invoiceGenerationActionErrorFrom` (`invoiceGeneration.ts:1139`), any
   `ManualInvoiceError` maps to `actionError(message, messageKeyForInvoiceFailureCode(code),
   params)`. Delete the bare `actionError(error.message)` branches for `'Nothing to
   bill'` and `'Recurring service periods were not materialized'`. They are now typed.
   Leave the other string branches alone; they are not in scope.
4. **Preview** keeps the same output. Add the three codes to the `ManualInvoiceError`
   allowlist in `previewInvoiceErrorInfo` (`:1060-1080`) and delete
   `EXPLAINED_PREVIEW_FAILURES` and `explainedPreviewFailureFromMessage`.
   - Preview's English fallback copy (the "Use Fix all…" sentences) moves onto the
     thrown messages, so the defaults stay the same for untranslated locales.
   - The locale files already contain `manualInvoices.errors.RECURRING_PERIODS_NOT_MATERIALIZED`,
     `…NO_ACTIVE_CONTRACT_LINES` and `…NOTHING_TO_BILL`
     (`server/public/locales/en/msp/invoicing.json:389-391`). Confirm the other locales
     are present.
5. **Run catch-all.** In both run actions (`recurringBillingRunActions.ts:~390-412` and
   `~860-882`):
   - First try `invoiceGenerationActionErrorFrom(err)`. Export it, or move it next to the
     registry. If it maps, push the coded failure via the registry.
   - Otherwise push `code: 'UNEXPECTED'` with `params: { ref }`, where `ref` is a short
     id (`runId` plus a target index, or a fresh uuid slice).
   - Log that same `ref` in `logRecurringBillingRunInvoiceFailure`, so support can find
     the stack.
   - `errorMessage` stays an English fallback and never contains the raw exception text.
   - The UI already translates `UNEXPECTED` with `{{ref}}`
     (`manualInvoiceErrorTranslation.ts`, `invoicing.json:381`).
   - Keep `HandledRecurringFailureCode` aligned. It aliases `RecurringInvoiceFailureCode`
     (`packages/types/src/interfaces/invoice.interfaces.ts:383-395`). Extend that union
     with `UNEXPECTED`, and with any `HandledManualInvoiceErrorCode` the registry can now
     carry (for example `CLIENT_NOT_FOUND`, which today has no key and is re-thrown
     raw).
   - Raw invariant throws reachable from a quote line all land on `UNEXPECTED` plus
     `ref`, which is actionable for support. They are not given individual codes in this
     card. Examples: the rollout guard "multiple persisted due periods matched one
     runtime obligation" (`billingEngine.ts:4797`), the unit-pricing revision without a
     price (`:4600`), and the period-claim races (`invoiceService.ts:107/112/239/256`).
6. **UI.** `AutomaticInvoices.tsx` already routes run failures through
   `localizeRecurringFailure` and `translateManualInvoiceFailure`. Check that the
   batch-results rendering for Generate Invoices (not only the preview dialog) uses
   `localizeRecurringFailure` for every failure row (`~2148-2177`, `~2159`). If a path
   still prints `failure.errorMessage` raw, route it through the translator. No new
   copy is needed.

### D6. Delete is atomic, Citus-safe, and never silent

In `packages/billing/src/models/contract.ts` `Contract.delete` (`:115-219`) and
`packages/billing/src/actions/contractActions.ts` `deleteContract` (`:656-727`):

1. Run the whole delete inside `withTransaction(knex, …)` from `deleteContract`. Nested
   `withTransaction` reuses the caller's transaction (`packages/db/src/lib/tenant.ts:197-205`).
   Publish workflow events only **after** commit, and do not let an event failure turn
   a committed delete into an error toast: log it and return success.
2. Before the `contracts` delete, explicitly unlink each referencing column instead of
   relying on FK actions, which Citus lacks. This is the same approach the method
   already uses for config children ("Citus disallows cascading actions on distributed
   foreign keys; handle deletes explicitly").
   - `quotes.converted_contract_id = null`. Also log a `quote_activities` entry
     `contract_deleted` with the contract id/name, so the quote history explains why it
     can be converted again.
   - `opportunities.converted_contract_id = null`.
   - `project_billing_configs.contract_id = null`.
3. Extend `hasInvoices` so it also blocks when invoices exist that are tied to the
   contract by `invoices.client_contract_id`, or by `recurring_service_periods.invoice_id`
   for this contract's lines. Today it only counts `invoice_charges`. This guards
   against deleting the period ledger of an invoiced contract.
4. `contractActionErrorFrom` (`:53-101`): stop mapping a `23503` raised **during
   delete** to "no longer exists". Map it to a keyed "This contract is still referenced
   by {{table}} and cannot be deleted" message, using the constraint/table from the
   error. Add a key to the contracts locale.
5. UI (`ClientContractsTab.tsx:154-175`, `Contracts.tsx:180-198`): refetch the list on
   both success and failure, so the UI always reflects the DB.

Retest of item 3 on the card: §2 showed that a failed generation leaves nothing behind.
`generateInvoiceForNormalizedSelectionInputs` runs inside one transaction
(`invoiceGeneration.ts:3532-3544`). So the delete failure is the FK/atomicity defect
above, not leftover state from the failed generation. The regression test must still
run delete **after** a failed run, to lock that in.

## 4. Files to change

| File | Change |
|---|---|
| `shared/billingClients/liveRecurringLineScope.ts` (new) | D1 helper |
| `shared/billingClients/clientCadenceScheduleRegeneration.ts` | D1 adopt helper (two loaders) |
| `packages/billing/src/actions/contractCadenceServicePeriodMaterialization.ts` | D1 adopt helper |
| `packages/billing/src/actions/contractCadenceCoverageAudit.ts` | D1 align raw SQL |
| `packages/billing/src/lib/billing/clientCadenceWindowMaterialization.ts` | D1 adopt helper |
| `packages/billing/src/lib/billing/billingEngine.ts` | D1 line loader and eligibility; select `cl.is_active`; D5 `NO_ACTIVE_CONTRACT_LINES` typed |
| `packages/billing/src/services/quoteConversionService.ts` | D2 line/assignment flags, date-only `start_date` |
| `shared/billingClients/clientContracts.ts` | D3 self-heal in `activateClientContractAssignment` |
| `packages/billing/src/actions/billingClientsActions.ts` | D3, only if the heal lives in the action |
| `server/migrations/2026101000000x_backfill_quote_converted_contract_lines.cjs` (new) | D4 |
| `packages/billing/src/errors/invoiceFailureMessageKeys.ts` (new) | D5 registry |
| `packages/billing/src/errors/manualInvoiceErrors.ts` | codes already present; no change expected |
| `packages/billing/src/actions/invoiceGeneration.constants.ts` | re-export keys from the registry |
| `packages/billing/src/actions/invoiceGeneration.ts` | D5 typed throws, boundary, preview allowlist, remove string table |
| `packages/billing/src/services/invoiceService.ts` | D5 typed throw (`:222`) |
| `packages/billing/src/actions/recurringBillingRunActions.ts` | D5 typed throw (`:591`), registry-based mapping, coded catch-all with `ref` |
| `packages/billing/src/actions/recurringBillingRunActions.shared.ts` | failure code type, if it needs widening |
| `packages/types/src/interfaces/invoice.interfaces.ts` | widen `RecurringInvoiceFailureCode` (D5.5) |
| `packages/billing/src/lib/billing/billingEngine.ts` (D5) | `BillingResult.errorCode`; typed throw at `:1352` |
| `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx` | D5.6, only if a raw `errorMessage` path remains |
| `packages/billing/src/models/contract.ts` | D6 unlink refs, broader invoice guard |
| `packages/billing/src/actions/contractActions.ts` | D6 transaction, post-commit events, 23503 mapping |
| `packages/billing/src/components/billing-dashboard/contracts/ClientContractsTab.tsx`, `.../Contracts.tsx` | D6 refetch on failure |
| `server/public/locales/*/msp/contracts.json` | D6 "still referenced" key (all shipped locales) |
| `server/public/locales/*/msp/invoicing.json` | verify the three codes exist in every locale; add any missing |

## 5. Out of scope (noted, not changed)

- Conversion still leaves bundle fixed-config `pricing_basis` and `rate_provenance` NULL
  (read as bundle), leaves line `rate_provenance` NULL, and uses DB defaults for
  renewal, PO and billing-profile fields. None of these blocks invoicing.
- Conversion runs no mixed-currency check. Activation runs one
  (`clientContracts.ts:688`), so the gap is only cosmetic for drafts.
- Invoice-number retry inside the outer generation transaction
  (`invoiceGeneration.ts:4126-4152`). After a `23505`, the transaction is aborted, so the
  retry fails with `25P02`. That needs a savepoint around the insert. File a follow-up;
  after D5 it surfaces as `UNEXPECTED` with a ref.
- Unit-priced fixed services with a null, NaN or negative rate or quantity are skipped
  silently (`compute/computeFixedCharges.ts:665-700`). Generation can then create a $0
  invoice that claims the periods, while preview says `NOTHING_TO_BILL` with arrears
  copy. Quote conversion always writes `base_rate = unit_price`, so this card's path
  does not hit it. File a follow-up so the skip raises `FIXED_LINE_RATE_UNRESOLVED`.
- The other bare-string branches in `invoiceGenerationActionErrorFrom` (PO required,
  `Client …`, `Service "…`, mixed currency) are still string-matched. Leave the
  `LEVERAGE: friction engine-failure-identity` marker on them.

## 6. Regression coverage

**A. New DB-backed suite**
`server/src/test/infrastructure/billing/quotes/quoteConvertedFirstInvoice.test.ts`. Use
the same harness as the §2 repro and real actions throughout.

1. Quote with 3 recurring fixed lines plus 2 one-time items, then convert:
   - lines `is_active=true`, header draft, `cc.is_active=false`, no periods
   - `start_date` is the date-only accepted date
2. Then `activateClientContractForBilling`:
   - periods exist for the current month (advance)
   - due work offers the client
   - preview succeeds with a $4,200 subtotal
   - `generateGroupedInvoicesAsRecurringBillingRun` creates one invoice with no failures
3. Client with an existing healthy contract plus a quote contract still in **draft**:
   the healthy contract's window previews and generates. Draft lines must not block it.
4. Legacy shape: insert the old conversion shape (lines inactive, `cc.is_active=true`),
   then Set to Active. D3 heals it and the first invoice generates.
5. Removed line (`removeClientContractLine`) on a healthy contract: the client's other
   lines still generate, with no not-materialized refusal.
6. Delete after failure:
   - Force a generation failure on a quote-converted contract (for example, a fixed line
     with no resolvable rate → `FIXED_LINE_RATE_UNRESOLVED`).
   - Assert the run failure carries the `code`.
   - Then `deleteContract` succeeds.
   - Assert `quotes.converted_contract_id` is null, a `contract_deleted` quote activity
     exists, and no orphan `contract_lines`, `client_contracts` or
     `recurring_service_periods` remain.
7. Delete rollback: make the final contracts delete fail, for example by inserting a
   referencing row the delete does not unlink, using a test-only FK. Assert nothing was
   deleted (atomicity).

**B. Unit tests**

- `server/src/test/unit/billing/recurringBillingRunActions.test.ts`:
  - each typed failure (`RECURRING_PERIODS_NOT_MATERIALIZED`, `NOTHING_TO_BILL`,
    `NO_ACTIVE_CONTRACT_LINES`) arrives as `failure.code` with params
  - an arbitrary thrown `Error('boom')` arrives as `code:'UNEXPECTED'` with a `ref` that
    matches the logged `ref`, and `errorMessage` does not contain "boom"
  - a thrown keyed DB error (`23503`) maps through `invoiceGenerationActionErrorFrom`,
    not to UNEXPECTED
- Registry unit test: `invoiceFailureCodeFromMessageKey(messageKeyForInvoiceFailureCode(c)) === c`
  for every `HandledManualInvoiceErrorCode`, and the duplicate key is classified as a
  skip.
- Preview parity: the existing preview tests for the three codes (PR #3555) still pass
  unchanged after `EXPLAINED_PREVIEW_FAILURES` is removed.
- `AutomaticInvoices` UI test (`automaticInvoices.recurringDueWork.ui.test.tsx`
  pattern): a run result with `code: 'RECURRING_PERIODS_NOT_MATERIALIZED'` renders the
  translated "Fix all" guidance, and `UNEXPECTED` renders the ref sentence.

**C. Migration test**

`server/src/test/infrastructure/migrations/…`:

- the backfill flips the all-inactive quote contract lines
- it leaves a quote contract that has one active and one inactive line untouched
- it sets `cc.is_active=false` only for quote drafts

**D. Existing tests to update**

- `server/src/test/integration/contractServicesPerSeatQuote.integration.test.ts:186-196`:
  replace the hand-written activation with `activateClientContractForBilling`. It
  currently hides the bug by setting the lines active itself.
- `server/src/test/infrastructure/billing/quotes/quoteConversion.test.ts`: update any
  assertions on `is_active=false` or `cc.is_active=true`.
- `server/src/test/infrastructure/billing/contracts/contractDeletion.test.ts`: add a
  quote-converted case next to the opportunity case.

## 7. Verification commands

```bash
cd server && set -a && . ../.env.localtest && set +a && export TEST_DB_NAME=test_alga2168
npx vitest run src/test/infrastructure/billing/quotes/ --coverage.enabled=false
npx vitest run src/test/infrastructure/billing/contracts/contractDeletion.test.ts --coverage.enabled=false
npx vitest run src/test/integration/contractServicesPerSeatQuote.integration.test.ts --coverage.enabled=false
npx vitest run src/test/infrastructure/billing/invoices/contractQuantityUsageSemantics.test.ts --coverage.enabled=false
npx vitest run src/test/unit/billing/recurringBillingRunActions.test.ts --coverage.enabled=false
```

Also run the broader billing infrastructure tier, because D1 changes engine line
eligibility:

```bash
npm run test:infrastructure:tier1
```

## 8. Risks

- **D1 engine scope.** Lines and contracts that are inactive stop billing even if
  unbilled periods exist. This is intended and consistent, but it is a behavior change.
  Audit every caller of the line loader for already-billed-window use before merging.
- **D2 `cc.is_active=false` for quote drafts.** Any UI that lists "active assignments"
  stops showing quote drafts there. Wizard drafts already behave this way, so the
  Contracts and Client Contracts draft sections must already handle it. Verify in the
  smoke step.
- **D4** does not create periods. Already-activated quote contracts need Fix all once,
  and the coded message says so.
