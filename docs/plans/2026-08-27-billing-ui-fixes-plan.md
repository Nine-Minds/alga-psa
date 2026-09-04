# Plan — Billing UI fixes

Implementation plan for the nineteen defects catalogued in
[2026-08-26-billing-ui-findings.md](./2026-08-26-billing-ui-findings.md). That
document is the evidence; this one is the work. Finding IDs (PP-2, CW-4, …) refer
back to it and are not restated here beyond what the fix needs.

## Scope note

The branch is named for prepayment, but the sweep found the same defects on
credits, hour blocks, contract-wizard bucket pools, and the billing simulator —
and in several cases the *root cause is shared*, so fixing prepayment alone would
mean writing the same fix four times. The plan covers all nineteen, phased so it
can land incrementally and be cut short if priorities change.

**Decisions taken before drafting** (agreed with the requester):

| Decision | Choice |
| --- | --- |
| Scope | All nineteen findings, phased |
| Numeric/currency inputs | Fix the shared layer, then migrate |
| PP-5 Credit Memo | Remove the option |
| PP-4 Description | Honour it end to end |

## Phase ordering, and why

1. **Phase 1 — correctness.** Defects that produce wrong money or wrong records.
   Nothing here depends on the shared-control work, so it can ship first.
2. **Phase 2 — the shared control layer.** The missing abstraction that four
   screens are each working around. Must land before the screens that consume it.
3. **Phase 3 — screen migrations onto that layer.**
4. **Phase 4 — dead ends and empty states.** Controls that silently refuse, and
   an option advertising a feature that does not exist.
5. **Phase 5 — the simulator.**

Phases 1 and 2 are independent and can run in parallel. Phase 3 depends on 2.

---

## Phase 1 — Correctness

### 1.1 PP-2 — prepayment amount sent in major units (100× understatement)

**Confirm first.** The code chain is unambiguous, but generate one prepayment
invoice and read back `invoices.total_amount` before changing anything. If the
stored value is already correct, this item is void and the rest of the plan is
unaffected.

The action's contract is minor units, and one existing caller
(`prepaidAutoReplenishment.ts:91`) and the integration test
(`creditCreationAndDates.test.ts:234`) both depend on that. **Do not change the
action's units** — convert at the UI boundary, exactly as the sibling credits
dialog already does.

- `packages/billing/src/components/billing-dashboard/PrepaymentInvoices.tsx:70` —
  convert with `toMinorUnits(amount, i18n.language)` before calling
  `createPrepaymentInvoice`, mirroring `AddCreditButton.tsx:93`. This lands
  naturally alongside the `CurrencyInput` adoption in Phase 3.1; sequence it so
  the conversion and the control change are one reviewable step.
- `packages/billing/src/actions/creditActions.ts` —
  `createPrepaymentInvoiceInternal` should reject non-integer amounts, matching
  `prepaidAutoReplenishment`'s existing guard and the repo's fail-fast rule.
  A silent 100× error is exactly the class of bug that guard exists to catch.
- `server/src/lib/api/schemas/financialSchemas.ts:190-194` — switch
  `createPrepaymentInvoiceSchema.amount` from `amountSchema`
  (`z.number().min(0)`) to the `monetaryAmountSchema` already defined two lines
  above (`z.number().int().min(0)`, commented "For cent-based amounts").

**Tests:** a unit test asserting the form sends minor units; an action-level test
asserting a fractional amount is rejected. The existing integration test already
pins the cents contract and must keep passing untouched — if it needs editing,
the fix is wrong.

**Data question to raise, not to fix here:** if this has been live, existing
prepayment invoices may be understated by 100×. Detection is a query, remediation
is a decision. Flag it; do not migrate data as part of a UI plan.

### 1.2 HB-4 — non-hourly services sellable as hour blocks

Two halves; the UI half alone leaves the action and REST paths open.

- `packages/billing/src/components/hour-blocks/SellHourBlockDialog.tsx:52` — pass
  `billing_method: 'hourly'` to `getServices`. The filter already exists
  (`serviceActions.ts:175`, applied at `:233-234`).
- `packages/billing/src/actions/hourBlockActions.ts:316-318` — after loading the
  service, reject one whose `billing_method` is not hourly, with an actionable
  message. This is the authoritative guard.

**Open product question, must be answered before implementing:** hourly-only, or
are usage-based services also sellable as blocks? The tracking unit is minutes,
which argues for hourly-only, but the guard's shape depends on the answer.
Assumed hourly-only below; revise if that is wrong.

**Tests:** an action test that a fixed-price service is rejected; a component
test that the dropdown excludes non-hourly services.

### 1.3 PP-4 — Description required, then discarded

Plumb it through end to end, matching `grantCredit`, which already does this
correctly (`creditActions.ts:637`).

- `creditActions.ts:705-716` — add a `description?: string` parameter to
  `createPrepaymentInvoice`, threaded to `createPrepaymentInvoiceInternal`.
- Persist it so it survives to the ledger. The credit-issuance transaction
  currently hardcodes its text (`invoiceModification.ts:1206`); finalization needs
  to read the description captured at creation and fall back to
  `'Credit issued from prepayment'` when absent.
- `PrepaymentInvoices.tsx:70` — pass `description.trim() || undefined`.
- **Relabel the field `Description (optional)`** and drop it from the validation
  gate (`:49-53`) and the submit-disabled condition (`:198`), matching Add
  Credit. Requiring a reason is a product choice nobody made; the field being
  honoured is the actual fix.

Storing it needs a home — check whether `invoices` has a usable description
column before assuming a migration. If a column is needed, that is a migration
and should be called out in review rather than slipped in.

**Tests:** action test that a supplied description reaches the transaction, and
that omitting it yields the existing default string.

---

## Phase 2 — The shared control layer

Four screens each hand-rolled the same two missing capabilities. Three
independent label workarounds exist for "show the currency on an amount field"
(`PoLandedCostDialog.tsx:286`, `OpportunityValueFields.tsx:66`,
`SellHourBlockDialog.tsx:203`), and every numeric field in billing inherits the
native spinner. Fix the layer, then migrate.

### 2.1 Give `Input` an adornment slot

`packages/ui/src/components/Input.tsx` has no prefix/suffix support today, which
is why currency symbols ended up in label strings. Add an optional leading
adornment slot. This is the lowest layer and benefits every consumer, not just
currency.

### 2.2 Give `CurrencyInput` a real currency affordance

`packages/ui/src/components/CurrencyInput.tsx` accepts `currencyCode` but can
only express it as decimal places (`:30-31`).

**Render the symbol as an adornment — do not change `formatCurrencyValue` to use
`style: 'currency'`.** Baking a symbol into the input's own value fights
`parseCurrencyValue` on every keystroke and makes the field awkward to type in.
The design system already anticipates this: `useCurrencyFormat().symbol()` is
documented "Bare currency symbol ("$", "€") for input adornments"
(`useCurrencyFormat.tsx:24-25`) and is already used in the billing package
(`ContractLineDialog.tsx:66`).

Keep `formatCurrencyValue`/`parseCurrencyValue` and their existing tests
(`CurrencyInput.test.tsx`) behaviourally unchanged. The change is additive.

### 2.3 Add a `NumericInput` sibling

There is no plain-numeric control in the kit — which is why nineteen findings
include four separate spinner complaints. Text-backed like `CurrencyInput` (so
no native spinner and no wheel stepping), locale-aware, with explicit precision.

Both controls must carry `id` and register with the UI reflection system, per the
repo's component standards.

**Tests:** unit tests for the adornment, for wheel/spinner absence, and for
precision handling per currency (JPY 0 decimals, USD 2).

---

## Phase 3 — Migrate the screens

Each item below is "adopt the Phase 2 controls", and each closes several findings
at once.

### 3.1 Prepayment — PP-1, PP-2, PP-3

`PrepaymentInvoices.tsx:167-174`. Replace the raw `<Input type="number">` with
`CurrencyInput`, passing the selected client's `default_currency_code` (fallback
`USD`, matching `creditActions.ts:801`) and reacting to client changes. This
removes the spinner (PP-3), surfaces the currency (PP-1), and is the natural site
for the units conversion (PP-2). The hardcoded `step="0.01"` goes away with it —
precision comes from the currency.

### 3.2 Credits — CM-1, CM-2

- `AddCreditButton.tsx:169` — pass `currencyCode` from the selected client.
- `TransferCreditDialog.tsx:141` — same, **plus** surface the currency next to
  the client picker. The server hard-rejects cross-currency transfers
  (`creditActions.ts:1944-1948`); the constraint must be visible before submit,
  not delivered as a rejection after it.

### 3.3 Hour blocks — HB-1, HB-2

`SellHourBlockDialog.tsx:192-212`. Rate → `CurrencyInput` with the existing
`currencyCode` prop, and drop the hand-built `'Rate per hour ({{currency}})'`
label once the control shows it. Hours → `NumericInput`.

Fix the step grid regardless of which control lands: `min="0.1"` with
`step="0.5"` anchors the grid to 0.1, so the stepper can never reach a whole
number of hours while the placeholder says "e.g. 10".

### 3.4 Contract wizard pools — CW-4, CW-5

`BucketPoolDraftEditor.tsx` — eight numeric inputs across the two editors.

CW-4 needs more than a control swap: the `$` is inside the translated string in
**all eight locales**, and the component receives no currency at all. Thread a
currency down from `HourlyServicesStep`, then **retranslate the key in every
locale** to drop the symbol. Leaving `($/Std.)` in the German bundle is the bug.

### 3.5 Hour blocks — HB-3

`SellHourBlockDialog.tsx:234-240` — replace the raw checkbox with
`packages/ui/src/components/Checkbox`. Restores the theme accent
(`accentColor: rgb(var(--color-primary-500))`), the focus ring, the correct
border token, and — the part that matters beyond appearance — UI-reflection
registration, without which the scope selector cannot be driven by the automation
harness.

---

## Phase 4 — Dead ends and empty states

### 4.1 CW-2 / CW-6 — the after-hours rule cannot be used

Both the switch that snaps back (`BucketPoolDraftEditor.tsx:506-507`) and the
Apply button that silently no-ops (`:265-268`, `BucketPoolEditor.tsx:334-337`)
have one cause: no business-hours schedule exists, and nothing says so.

- Surface the precondition. When no schedule is available, say so where the
  control is and point at where schedules are created, instead of presenting a
  control that refuses.
- Give the Apply guards an `else`. A click that cannot proceed must report why —
  per the repo's fail-fast rule, silent fallthrough is the anti-pattern.
- Distinguish "no schedules configured" from "the schedule request failed".
  `HourlyServicesStep.tsx:51-53` currently swallows the error and makes the two
  indistinguishable.
- Resolve the placement inconsistency: the create form folds after-hours into
  "Create pool" while the saved card has a separate Apply button. Pick one.

**Environment question first:** `business_hours_schedules` is empty across all
tenants here. Confirm whether that is a seed gap or the expected default — it
decides whether this is only an empty state or also a setup path.

### 4.2 CW-1 — member picker empty with no explanation

The options are the hourly services already on the line, and blank rows are
filtered out (`HourlyServicesStep.tsx:386-391`). Add an empty state saying so.
Fix both failure modes: the create form renders an empty `<select>`; the saved
card hides the picker but leaves the "Member services" label stranded
(`BucketPoolDraftEditor.tsx:278-280`).

### 4.3 CW-3 — unlabeled burn multiplier

Give the field a visible `<Label>` — it is the only field in the editor without
one. **Needs a decision on precision:** `step="0.001"` is internally consistent
but asserted nowhere. Confirm the intended precision and state the unit.

### 4.4 PP-5 — remove Credit Memo

No credit-memo implementation exists anywhere in the product; every other
`CreditMemo` reference is QuickBooks' entity type for an exported credit *note*.

Remove the `credit_memo` branch from the type selector, the conditional titles
and body copy, the placeholder, and the `credit_memos_unsupported` throw. With
one type left, the selector itself goes too — a single-option dropdown is noise.

Remove the five dead keys from **all ten locale bundles** and update the i18n
contract test (`PrepaymentInvoices.i18n.test.ts:34-48`), which currently asserts
their presence.

---

## Phase 5 — Billing simulator

### 5.1 BS-1 — fold repeated diagnostics

Rate-gap warnings are pushed inside the per-period loop
(`loadSimulationCalculationInput.ts:668-673`, `:1004-1009`), so a 12-period
horizon yields 12 near-identical lines. The period index is interpolated into the
message, so **dedup by message string will not work.**

**Fold in the engine, not the UI.** The condition is a property of the service,
not of a period, and the correct shape already exists in the same file:
`simulateLineDiagnostics` (`:410-439`) reports rate gaps once per line, outside
the loop — and ends with an actionable instruction ("Add a catalog or service
rate to include it") that the hourly and usage variants omit. Follow it: report
once per service, name affected periods if that carries information, and say what
to do.

If the message must retain per-period detail, `SimulationDiagnostic` needs a
structured field (service id / reason code) to group on — it carries only
`severity`, `line_key` and a prebuilt `message` today. Prefer engine-side folding
so the UI stays dumb.

### 5.2 BS-2 — name the horizon's unit

The selector counts **client** billing periods — `invoice_schedule.billing_cycle`
comes from `getClientBillingCycleAnchor` (`draftContractToScenario.ts:229`) —
while the contract's own cadence rides separately as `billing_frequency`. On an
annual client, "12 billing periods" spans twelve years. `HORIZON_OPTIONS = [3, 6, 12]`
being the familiar month counts makes the misreading likely.

The engine is correct; the wording is not. State the unit and its source on the
selector (`ContractSimulatorWorkspace.tsx:503-514`) and on the status line
(`:702-706`), or show the resolved date range for the chosen horizon.

**Check before implementing:** if `SimulationTimeline` already renders real dates
in its period headers, the fix is wording only and this item shrinks.

---

## Testing

- **Unit** — new control behaviour (adornment, no wheel, precision); the
  prepayment units conversion; diagnostic folding.
- **Action/DB** — the hourly-only guard; the description reaching the ledger; the
  non-integer prepayment amount rejection. The existing prepayment integration
  test must pass unchanged.
- **i18n contract tests** — these assert key presence and will fail by design on
  the PP-5 removal and the CW-4 retranslation. Update them deliberately as part
  of those items, never by loosening the assertion.
- **Browser** — every finding is currently `code`-validated only. Each phase
  should close with a pass on the real screens.

## Risks

- **The `CurrencyInput` change touches twelve call sites.** Additive by design,
  but the migration is where regressions would appear. Land Phase 2 with tests
  before any Phase 3 migration.
- **PP-2 may have produced bad data.** Out of scope here; must be raised
  separately rather than quietly fixed.
- **Locale edits span ten bundles** (PP-5) and eight (CW-4). Mechanical, but
  easy to half-finish. The contract tests are the safety net.
- **Browser validation is still blocked** on the rotating dev password. Every
  "confirm first" step above depends on clearing that.

## Deliberately out of scope

- Building credit memos as a feature (PP-5 removes the option instead).
- The remaining ~130 `type="number"` sites outside these screens. Phase 2 makes
  the sweep possible; the sweep itself is a later plan.
- Any data migration for historically understated prepayment invoices.
- Merging `CreateDraftPoolForm` and `DraftPoolCard`. They implement the same
  controls twice with different guards, which is why CW-1 and CW-2 each reproduce
  two ways — worth doing, but it is a refactor with its own risk profile and
  should not ride along inside a defect-fix plan.
