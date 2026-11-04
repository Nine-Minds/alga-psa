# Arrears first-invoice hint: plan (alga-2026-0002499 follow-up)

Card 850810eb. Follows PR #3556 (merged to main 2026-10-11), which made the
first partial period of a mid-cycle client-cadence contract bill at all. This
card is UX only. Billing logic and the arrears default
(`shared/billingClients/recurringAuthoringPolicy.ts:11-12`) stay as they are.

## What already exists (commit 270e7e2e59, 2026-09-28)

Most of the substrate is already on main. This plan extends it and does not
build a parallel one.

- `contracts/wizard-steps/firstInvoiceDate.ts`: `resolveFirstInvoiceDate()`
  (line 100). Derives the first invoice window from the same materializers the
  engine runs (`materializeClientCadenceServicePeriods` plus
  `clipRecurringCandidatesToObligationBounds`, and
  `materializeContractCadenceServicePeriods`). It returns `invoiceDate` and the
  clipped `servicePeriodStart/End`, but it does **not** say whether the start
  falls mid-period, and it does not return the unclipped schedule period.
- `contracts/wizard-steps/FirstInvoiceNotice.tsx`: the `useFirstInvoiceDate`
  hook (line 35) fetches `getClientBillingCycleAnchor` for client cadence.
  `FirstInvoiceNotice` (line 87) renders one sentence per scenario. It is used
  only on the wizard **Review** step (`ReviewContractStep.tsx:545`) and the
  post-create confirmation (`ContractCreatedConfirmation.tsx:37`), and both of
  those come *after* the user has chosen timing.
- `FixedFeeServicesStep.tsx:55-70, 127-151`: a generic, date-free info alert
  ("Billed in arrears, this line can't be invoiced until its first service
  period ends…") with one button that sets **both**
  `billing_timing: 'advance'` and `cadence_owner: 'contract'`. It shows for any
  arrears contract, aligned or not. It checks only the contract-level
  `data.billing_timing`, so a template-supplied per-line
  `line.billing_timing = 'arrears'` keeps billing in arrears after the click
  (Review and submit use `line.billing_timing ?? data.billing_timing`).
- `recurringAuthoringPreview.ts:147-162`: a hard-coded `firstInvoiceSummary`
  ("First invoice: bill on the next client billing schedule window…"). It is
  shown in `FixedLineEditor.tsx:~550`.

### Gaps relative to the acceptance criteria

1. Nothing on the screen where the timing decision is made says *when*, or
   *which dates are covered*, for a mid-cycle client arrears start.
2. No surface tells the user that In Advance (still on the client's cadence)
   bills the partial period on the current cycle's invoice. The existing button
   also switches cadence owner. That is a bigger change than the ticket needs,
   and it moves the line off the client's invoice rhythm.
3. The edit surfaces for a live client contract show nothing: the inline line
   editor on Contract Detail → Lines, and the Create Custom Line dialog.

## Design decisions

**D1. One derived "first partial period" hint, shown only when it is true.**
It appears when *all* of these hold: Fixed line, client cadence, billing timing
`arrears`, `resolveFirstInvoiceDate` returns `status: 'date'`, and the contract
start falls strictly inside a client billing period (new `startsMidPeriod`
flag). Every other case gets no hint: advance lines, cycle-aligned starts,
contract cadence (its first period always starts on the start date, so it is
never mid-period), and a missing or unloadable schedule. The existing neutral
`FirstInvoiceNotice` on Review and Confirmation stays as it is for those cases.

Copy (en, interpolated, all dates locale-formatted):

> First invoice: the {{invoiceDate}} invoice covers {{periodStart}} – {{periodEnd}} (billed in arrears).
> Choose In Advance to bill it on the invoice for the period starting {{advanceInvoiceDate}}.

`advanceInvoiceDate` comes from a second `resolveFirstInvoiceDate` call with
`billingTiming: 'advance'`. It is not hard-coded as "this cycle". That keeps it
correct for backdated or future-dated starts. In the brief's example (start
10/20, monthly, client cycle on the 1st): "the Nov 1 invoice covers Oct 20 –
Oct 31 … invoice for the period starting Oct 1."

**D2. Inclusive end date in the copy.** The materializer's period end is
exclusive (`servicePeriodEnd: '2025-02-15'` for a period that bills through
Feb 14; see `firstInvoiceDate.test.ts`). The hint shows `end - 1 day` so it
reads "Oct 20 – Oct 31", not "Oct 20 – Nov 1". The conversion goes in the
helper (`servicePeriodEndInclusive`), not in each component.

**D3. In the wizard, the remedy is one click: "Bill in advance".** It sets
`billing_timing: 'advance'` **on that line** (`updateLine(line.line_key,
{ billing_timing: 'advance' })`) and leaves the cadence owner alone. This is
the remedy the ticket names, and it fixes the per-line override bug described
above. On edit surfaces, the hint points at the Billing Timing select that sits
right next to it, and there is no extra button.

**D4. Replace the generic step-level advance alert.** Remove
`FixedFeeServicesStep.tsx:55-70, 127-151` (and its test file
`FixedFeeServicesStep.advanceSuggestion.test.tsx`) in favour of the per-line
hint inside `FixedLineEditor`. The generic alert is date-free and appears for
aligned starts. Its contract-cadence switch is still available through the
Cadence Owner choice on the Basics step. **XO/captain:** removing the one-click
"bill in advance on the contract's cadence" for aligned starts is a deliberate
UX call. If you want it kept for aligned client-arrears starts, say so. It
would remain as a secondary action and would not change anything else here.

**D5. Edit surfaces show the hint only while the first invoice is still in the
future** (`invoiceDate > today`, in local date). Changing timing on a saved
line re-materializes its unbilled periods
(`contractLineAction.ts` → `syncRecurringServicePeriodsForContractLine`, which
calls `regenerateClientCadenceRowsForOwner`), so before the arrears window
opens the advice is accurate. Once the window has opened, the period may
already be invoiced, and a "first invoice will be…" message could mislead, so
nothing is shown. The wizard (new contract, so nothing has been invoiced yet)
shows the hint whatever today's date is, because the dates it states are
absolute.

**D6. Scope is Fixed lines only.** Hourly and usage lines are inherently
arrears. `ContractLineDialog.tsx:411` and `FixedContractLineConfiguration.tsx:283`
already force `arrears` for non-Fixed lines, so "choose In Advance" would be
false advice for them.

**D7. Retire the hard-coded `firstInvoiceSummary` sentence in
`FixedLineEditor`.** The derived hint and notice now cover it. Remove its
render at `FixedLineEditor.tsx:~550`. Keep the `recurringAuthoringPreview`
field for other callers if any exist (grep before removing; the template wizard
steps may use it).

## Changes (in order)

### 1. Helper: `contracts/wizard-steps/firstInvoiceDate.ts` → move to `packages/billing/src/lib/firstInvoiceDate.ts`

It now serves contract-detail surfaces as well as the wizard, so it moves out
of `wizard-steps/`. Update the imports in `FirstInvoiceNotice.tsx`, its test,
and the path list in
`server/src/test/unit/docs/servicePeriodFirstBillingPlan.contract.test.ts:260-261`.

- `toResult` (line 85): add `schedulePeriodStart`, `schedulePeriodEnd`
  (unclipped `record.servicePeriod`), `servicePeriodEndInclusive`
  (`end - 1 day`, YMD), and `startsMidPeriod`
  (`activityWindow.start > servicePeriod.start`).
- New pure function `resolveArrearsFirstInvoiceHint(input, today?)`. It returns
  `null`, or `{ invoiceDate, periodStart, periodEndInclusive, advanceInvoiceDate }`,
  applying the D1 gate (and the D5 gate when `today` is passed). It is the only
  place the "should we say anything" rule lives.

### 2. Hook/component: `FirstInvoiceNotice.tsx`

- Move `useFirstInvoiceDate` (line 35) and the date-formatting helper next to
  the helper as `useClientBillingSchedule(clientId)` in
  `packages/billing/src/hooks/`. The hint and the notice then share one fetch
  path.
- New component `ArrearsFirstInvoiceHint` (`packages/billing/src/components/billing-dashboard/contracts/ArrearsFirstInvoiceHint.tsx`).
  Props: `id`, `lineType`, `cadenceOwner`, `billingTiming`, `startDate`,
  `clientId`, optional `today`, optional `onBillInAdvance`. It renders
  `<Alert variant="info">` with the D1 copy and, when `onBillInAdvance` is
  given, a `Button id={`${id}-bill-in-advance`}`. Below the alert it renders
  nothing while the schedule loads. (The Review notice already shows the
  loading line, and an inline hint should not flash.)
- `FirstInvoiceNotice`: for `client_arrears` with `startsMidPeriod`, append the
  covered-dates clause to the existing sentence so Review and Confirmation
  state the same dates. Fix `client.arrears` copy: "when the client's
  *current* billing period ends" → "when the client's billing period
  containing the start date ends". "Current" is wrong for future-dated starts.

### 3. Wizard

- `FixedLineEditor.tsx:38`: widen `contract` Pick to include `start_date` and
  `client_id`. (`FixedFeeServicesStep.tsx:100` already passes the full `data`.)
- `FixedLineEditor.tsx` (after the billing-timing paragraph, about line 549):
  render `<ArrearsFirstInvoiceHint id={`${idPrefix}-first-invoice-hint`} …
  billingTiming={line.billing_timing ?? contract.billing_timing}
  onBillInAdvance={() => updateLine({ billing_timing: 'advance' })} />`. The
  hint should sit **outside** any collapsed preview disclosure so it is
  visible by default. Check the disclosure state around line 520 and lift the
  hint above it if it is collapsed by default.
- Remove the `firstInvoiceSummary` line (D7) and the step-level alert (D4).
- `ReviewContractStep.tsx:545` and `ContractCreatedConfirmation.tsx:37`: no
  structural change. They pick up the improved notice copy from step 2.

### 4. Contract Detail → Lines (live client contract)

- `ContractDetail.tsx:2718-2723`: pass
  `startDate={primaryAssignment?.start_date ? toISODate(toPlainDate(primaryAssignment.start_date)) : null}`
  (same normalization as `ContractDetail.tsx:1089`).
- `contracts/ContractLines.tsx:70-80`: add a `startDate?: string | null` prop.
- `contracts/ContractLines.tsx:1549-1575` (Billing Timing cell): under the
  select, when editing (or in read view), render `ArrearsFirstInvoiceHint`
  using the *pending* values
  `editLineData.billing_timing ?? line.billing_timing` and
  `editLineData.cadence_owner ?? line.cadence_owner`, with `today={new Date()}`
  and no button (D3, D5). Only for `contract_line_type === 'Fixed'`.
- `contracts/ContractLines.tsx:2081-2087`: pass `clientId` and `startDate` to
  `CreateCustomContractLineDialog`.

### 5. Create Custom Contract Line dialog

- `CreateCustomContractLineDialog.tsx:38-44`: add `clientId?` and `startDate?`
  props.
- After the Billing Timing select (about line 1085): render the hint for
  `planType === 'Fixed'`, cadence `'client'` (the dialog never sets a cadence
  owner, so the server default is `client`), with `today`. No button.
- While here: `createCustomLine.billingTimingHelp` says "Advance billing is
  typical for fixed fees" next to an arrears default. Leave the copy alone
  (out of scope) but note it in the PR.

### 6. i18n

New keys under `msp/contracts` → `arrearsFirstInvoiceHint.{message, billInAdvance}`
and `wizardFirstInvoice.client.arrearsPartial`. Also add the revised
`wizardFirstInvoice.client.arrears`. Add them to every locale in
`server/public/locales/{de,en,es,fr,it,nl,pl,pt,sv}/msp/contracts.json`.
Regenerate pseudo-locales `xx`/`yy` with `scripts/generate-pseudo-locales.cjs`.
Run `scripts/validate-translations.cjs` and `scripts/find-missing-i18n-keys.cjs`.
Remove the now-unused `wizardFixed.advanceSuggestion.*` keys from all locales
(D4).

### 7. Tests

- `lib/firstInvoiceDate.test.ts` (moved): `startsMidPeriod` true/false,
  inclusive end, and `resolveArrearsFirstInvoiceHint` returning null for:
  advance, contract cadence, aligned start (10/01), Hourly, schedule
  unavailable, missing start date, and (with `today`) invoice date not in the
  future. Positive cases: monthly 10/20 → Nov 1 / Oct 20–Oct 31 / Oct 1;
  quarterly and a custom anchor (for example, day-15 anchor, start 10/20 →
  covers Oct 20–Nov 14, invoice Nov 15).
- `ArrearsFirstInvoiceHint.test.tsx`: renders formatted dates, the button
  calls `onBillInAdvance`, renders nothing when the gate is false or the
  schedule is loading or has failed.
- `FixedLineEditor` / `FixedFeeServicesStep` test (replaces
  `advanceSuggestion.test.tsx`): a mid-cycle client-arrears line shows the
  hint; clicking sets that line's `billing_timing` to `advance` and leaves
  `cadence_owner` untouched; a line with template `billing_timing: 'arrears'`
  also flips; an aligned start shows nothing.
- `ContractLines` component test: the hint follows the pending select value;
  it hides for Hourly and when `startDate` is far enough in the past.
- Update `FirstInvoiceNotice.test.tsx` for the new partial clause and the
  revised arrears copy.

### 8. Smoke (alga-billing-contract-smoke-testing)

On the dev server: client with a monthly cycle on the 1st, wizard start date on
the 20th of the current month, one fixed line.
1. The Fixed step shows the hint with correct dates. Clicking "Bill in advance"
   makes the hint disappear, and the Review step says "Billed in advance… from
   the 1st".
2. Repeat with the start on the 1st: no hint.
3. Contract Detail → Lines → edit the fixed line → switch between Arrears and
   Advance: the hint follows the select. Save as Advance, then confirm the
   Automatic Invoices window opens on the current cycle.

## Out of scope

- Changing the arrears default (product decision; raise to the captain if
  wanted).
- Template surfaces (`ContractTemplateDetail` → `ContractLineEditDialog`, the
  template wizard steps) and preset or library surfaces (`ContractLineDialog`,
  `FixedContractLineConfiguration` via `ContractLineTypeRouter`). None of them
  has a client billing cycle or a start date, so a derived date is impossible.
  Static copy there would just repeat the generic description that already
  exists.
- Hourly and usage lines (D6).
- Billing engine behaviour. #3556 is merged; the hint reads the same
  materializers.
- `createCustomLine.billingTimingHelp` wording.

## Risks

- **Divergence from the engine.** The hint is only as right as the shared
  materializers plus `clipRecurringCandidatesToObligationBounds`. Mitigation:
  no new date math beyond `-1 day` for display. Tests pin the brief's example
  plus a custom anchor.
- **Multiple assignments.** Contract Detail uses `primaryAssignment`. A
  contract assigned to several clients with different cycles would show the
  primary assignment's hint only. Acceptable, because the Lines tab is already
  primary-scoped (`clientId` prop). Note it in the PR.
- **Timezone.** YMD strings are parsed local (`parse(..., 'yyyy-MM-dd')`), as
  `FirstInvoiceNotice` already does. The `today` comparison must also be
  local-date YMD, not `Date` vs UTC midnight.
- **Removing the contract-cadence one-click (D4)** could surprise whoever
  relied on it. Flagged for XO/captain.
- **Extra fetch per editor.** Each `FixedLineEditor` and Lines row would call
  `getClientBillingCycleAnchor`. The shared hook should cache per `clientId`
  (module-level promise map, or lift the fetch to `FixedFeeServicesStep` /
  `ContractLines` and pass the schedule down). Prefer lifting: one fetch per
  surface.

LEVERAGE note: the `ymd-local-format` pattern (`FirstInvoiceNotice`,
`ReviewContractStep:187`) gains a third site in the hint. Extract a
`useFormatYmd()` into `@alga-psa/ui/lib/i18n` as part of step 2. With three
sites, it has earned it.
