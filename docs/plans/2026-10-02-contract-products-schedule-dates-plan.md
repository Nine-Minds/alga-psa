# Contract products schedule: Alga date formatting, DatePicker and confirmation dialog

Card `0c2f671a-5667-46f6-bca5-c9ba1413b87e`. This follows up PR #3492 (card f6e7254b), which merged to `main` on 2026-10-02 as `fbdb02b`.

## Ground truth (verified in this worktree)

- Branch `feature/contract-products-schedule-alga-date-formatting` is at the PR #3492 head `9171841d82`. That commit is an ancestor of `origin/main`, which is 20 commits ahead. None of those commits touch `RecurringUnitSchedulePanel.tsx`, `DatePicker`, `DateTimeField`, `ConfirmationDialog` or `formatDateValue`. `main` adds one key to `server/public/locales/en/msp/contracts.json` and does not change `package-lock.json`.
- File under change: `packages/billing/src/components/billing-dashboard/contracts/RecurringUnitSchedulePanel.tsx` (969 lines). The line numbers below refer to it unless another file is named.
- Other PR #3492 touchpoints. I scanned every `.tsx` the PR changed, including `ContractLineDialog.tsx`, `wizard-steps/FixedFeeServicesStep.tsx`, `FixedContractLinePresetServicesList.tsx`, `ContractLines.tsx`, `ContractOverview.tsx`, `ReviewContractStep.tsx` and the template-wizard steps. The PR added no `confirm(`, `alert(`, `type="date"` or raw date display outside the panel, so there is nothing to fix in those files. Pre-existing patterns in `ContractLines.tsx` are covered under "Deliberately NOT doing".
- Existing tests that this change breaks and must update:
  - `packages/billing/tests/RecurringUnitSchedulePanel.test.tsx` mocks `useFormatters` without `formatDate` and drives `#recurring-mid-period-date-config` as a native input.
  - `packages/billing/tests/RecurringUnitSchedulePanel.translations.test.tsx` loads the real en pack, asserts `From 2026-11-01 the standing quantity…`, and reads `#recurring-effective-config` `.value` as ISO.

## Building blocks (use these, do not reinvent)

| Need | Use | Why |
|---|---|---|
| Display a date | `formatDate` from `useFormatters()` (`@alga-psa/ui/lib/i18n/client`) | Applies the tenant country's order, separator and digit width. Date-only `YYYY-MM-DD` strings are formatted in UTC, so the day never shifts (`packages/ui/src/lib/i18n/formatDateValue.ts`). With no options it matches the DatePicker's display pattern. |
| Normalize any date-ish value to a calendar day before display | `toCalendarDateString` from `@alga-psa/core` | Passes `YYYY-MM-DD` through unchanged. Full ISO instants map to their UTC calendar day, which matches the server's normalization. Guards fields typed `ISO8601String` (`windowStart/End`, history `effective_period_start`, `catalogEffectiveDate`) in case a timestamp ever arrives. |
| ISO → DatePicker `Date` | `toCalendarDisplayDate` from `@alga-psa/core` | Anchors at local noon, so the picker shows the same day in every timezone. This is the established pair, used in `hour-blocks/EditExpirationDialog.tsx`. |
| DatePicker `Date` → ISO wire value | `toCalendarDateString` from `@alga-psa/core` | Reads local calendar components. **Never** use `toISOString()` or `toISODate(toPlainDate(date))` on a picker Date: both read UTC and land one day early east of UTC. |
| Date fields | `DatePicker` from `@alga-psa/ui/components/DatePicker` | Required by the card. It is non-clearable by default and calls `onChange(Date)` only for a valid, committed day. |
| Discard prompt | `ConfirmationDialog` from `@alga-psa/ui/components/ConfirmationDialog` | Required by the card. |

## Changes, in order

### Step 0: Bring the branch onto current main

`git merge --ff-only origin/main`. This is clean: HEAD is an ancestor, and `main` does not touch the locally modified `package-lock.json`. Do not commit the wire-up `package-lock.json` drift. Re-read the panel afterwards and confirm the line numbers still match. They should, because main did not change the file.

### Step 1: A single display helper inside the panel

Near `formatRate` (line 128), add `formatDay`, a `useCallback` over `formatDate`:

```ts
const formatDay = useCallback(
  (value: string | null | undefined): string | null => {
    const day = value ? toCalendarDateString(value) : null;
    return day ? formatDate(day) : null;
  },
  [formatDate],
);
```

- Destructure `formatDate` alongside `formatCurrency` at line 69.
- Do not wrap it in try/catch. A malformed date from the server should fail loudly, as the coding standards' fail-fast rule requires.
- If the implementer sees this exact shape (`formatDate(toCalendarDateString(x))` or `formatDate(toPlainDate(x).toString())`) elsewhere in billing, add a `// LEVERAGE: pattern calendar-day-display` marker here. Known sites already exist: `FinalizedTab.tsx:401`, `DraftsTab.tsx:470`, `ProjectBillingReviewTab.tsx:132` and `ClientContractsTab.tsx:306`. They suggest `useFormatters` is missing a `formatCalendarDay`. Do not extract it on this card.

### Step 2: Format every displayed date

Make these changes and only these. Internal values stay ISO.

| Line | Message / cell | Change |
|---|---|---|
| 365 | `saved` → `{{date}}` | `date: formatDay(standingBoundary)` |
| 409 | `coveredEndLabel` | `formatDay(effective?.coveredEnd) ?? t('…openPeriod')` |
| 518 | `existingRevisionNotice` → `{{date}}` | `formatDay(effective.effectivePeriodStart ?? boundary)` |
| 692–693 | `midPeriodAffected` → `{{start}}/{{end}}` | `formatDay(affectedStart)` / `formatDay(affectedEnd)`. Keep `affectedStart/End` as ISO for `daysBetweenOnly`. |
| 716 | `midPeriodStanding` → `{{boundary}}` | `formatDay(standingBoundary)` |
| 729 | `currentEffective` → `{{date}}` | `formatDay(effective.effectivePeriodStart ?? boundary)` |
| 741–742 | `coverage` → `{{start}}/{{end}}` | `formatDay(effective.coveredStart ?? boundary)` and the already-formatted `coveredEndLabel` |
| 752 | `catalogSource` → `{{effectiveDate}}` | `formatDay(effective.catalogEffectiveDate) ?? t('common.empty.notAvailable')` |
| 768 | `invoiceImpact` → `{{date}}` | `formatDay(standingBoundary)` |
| 793–794, 799–800 | `invoiceWindowMidPeriod` / `invoiceWindowBoundaryOnly` | `formatDay(impact.windowStart)` / `formatDay(impact.windowEnd)` |
| 894 | Revisions table, "Effective from" cell | `{formatDay(revision.effective_period_start)}` |
| 899 | `midPeriodFrom` → `{{date}}` | `formatDay(revision.mid_period_effective_date)` |
| 951 | History table, "Effective from" cell | `{formatDay(row.effective_period_start)}` |

Leave these unchanged on purpose:

- Every wire payload: lines 113–118, 161, 250, 352–354.
- `revisions.find(... === boundary/standingBoundary)` at lines 302 and 308.
- `boundary < todayIso()` at line 477 and `isFuture` at line 889.
- `daysBetweenOnly` inputs at lines 441–442.
- The regex guards at lines 238, 335 and 438.
- `setMidPeriodDate(effective?.coveredStart ?? boundary)` at line 637.

### Step 3: Replace both `<Input type="date">` with `DatePicker`

Effective-from field (lines 544–551):

```tsx
<DatePicker
  id={`recurring-effective-${configId}`}
  key={`recurring-effective-${configId}-${boundaryPickerResetKey}`}
  label={t('contractLines.services.semanticsEffectiveFrom', { defaultValue: '…' })}
  value={toCalendarDisplayDate(standingBoundary) ?? undefined}
  disabled={disabled || saving || loading || (midPeriod && !!midPeriodContext)}   // unchanged rule
  onChange={(date) => handleBoundaryChange(toCalendarDateString(date) ?? '')}
  className="mt-1"
/>
```

Mid-period field (lines 661–671):

```tsx
<DatePicker
  id={`recurring-mid-period-date-${configId}`}
  label={t('contractLines.recurringSchedule.midPeriodDate', { defaultValue: 'Quantity changes on' })}
  value={toCalendarDisplayDate(midPeriodDate) ?? undefined}
  disabled={disabled || saving || loading}                                      // unchanged rule
  onChange={(date) => { setMidPeriodDate(toCalendarDateString(date) ?? ''); setSavedMessage(null); }}
  className="mt-1 max-w-[12rem]"
/>
```

- Keep the existing `<Label htmlFor>` elements. DatePicker places `id` on its text `<input>` through `automationIdProps`, so the label association still works. The `label` prop supplies the aria-label.
- Do not add `minDate`, `maxDate` or `isDateDisabled`. The card says to keep today's validation, and server-side boundary validation stays authoritative.
- Remove the `Input` import only if nothing uses it afterwards. The quantity and rate fields still use it, so it stays.
- The existing reload-on-change behavior is unchanged: the picker routes through `handleBoundaryChange`, which calls `load(nextBoundary)`.

### Step 4: Replace `window.confirm` with `ConfirmationDialog`

State: `const [pendingBoundary, setPendingBoundary] = useState<string | null>(null);` and `const [boundaryPickerResetKey, setBoundaryPickerResetKey] = useState(0);`

Rewrite `handleBoundaryChange` at lines 272–295 into three functions:

```ts
const applyBoundary = (nextBoundary: string) => {
  setBoundary(nextBoundary);
  setSavedMessage(null);
  setSaveError(null);
  void load(nextBoundary);
};

const handleBoundaryChange = (nextBoundary: string) => {
  if (!nextBoundary || nextBoundary === boundary) return;   // NEW: picking the same day is not a change
  const loaded = loadedInputsRef.current;
  const dirty = quantityInput !== loaded.quantity || pricePolicy !== loaded.policy || rateInput !== loaded.rate;
  if (dirty) { setPendingBoundary(nextBoundary); return; }
  applyBoundary(nextBoundary);
};

const cancelBoundaryChange = () => {
  setPendingBoundary(null);
  setBoundaryPickerResetKey((k) => k + 1);   // see LEVERAGE note below
};
const confirmBoundaryChange = () => {
  const next = pendingBoundary;
  setPendingBoundary(null);
  if (next) applyBoundary(next);
};
```

- The `nextBoundary === boundary` guard is required. The native input never fired `change` for an unchanged value, but DatePicker's day-click path commits even when the same day is picked again. Without the guard, re-picking the current day with dirty edits would open a pointless discard prompt.
- **Why the reset key exists.** `DateTimeField` keeps its own `dateText` and resyncs it only when `value.getTime()` changes (`DateTimeField.tsx` around lines 161–167). On Cancel the parent never adopts the picked day, so `value` does not change and the field would keep showing the rejected date. Native controlled inputs revert in this situation; DateTimeField does not. Bumping `key` remounts the picker so it shows `standingBoundary` again. Put this marker at the `key` prop: `// LEVERAGE: friction datetimefield-controlled-revert — DateTimeField does not resync its text when a controlled parent rejects a commit; remount forces it. Engine fix: resync dateText to value after commit when value did not adopt it.` Do not change `DateTimeField` on this card, because it is shared by every date field in the app (see Risks).

Render the dialog once, at the end of the panel's root `<div>`:

```tsx
<ConfirmationDialog
  id={`recurring-discard-dirty-${configId}`}
  isOpen={pendingBoundary !== null}
  onClose={cancelBoundaryChange}
  onConfirm={confirmBoundaryChange}
  title={t('contractLines.recurringSchedule.discardDirtyTitle', { defaultValue: 'Discard unsaved edit?' })}
  message={t('contractLines.recurringSchedule.discardDirty', { defaultValue: 'Changing the effective date reloads the values in force and discards your unsaved edit. Continue?' })}
  confirmLabel={t('contractLines.recurringSchedule.discardDirtyConfirm', { defaultValue: 'Discard and reload' })}
  cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
/>
```

The ids `recurring-discard-dirty-<configId>-confirm` and `…-close` come from ConfirmationDialog. Tests and smoke runs use them.

### Step 5: i18n

Add `contractLines.recurringSchedule.discardDirtyTitle` and `contractLines.recurringSchedule.discardDirtyConfirm` to `server/public/locales/{en,de,es,fr,it,nl,pl,pt,sv}/msp/contracts.json`.

- Use real translations, written in the same register as the existing `discardDirty` value in each file.
- Reuse the existing `common.actions.cancel` key, which already exists in `msp/contracts`.
- Regenerate `xx`/`yy` with `node scripts/generate-pseudo-locales.cjs`.
- Then run `node scripts/validate-translations.cjs`, `node tools/i18n/audit-all.cjs` and `node tools/i18n/find-untranslated-ui.cjs --fail-on-high`.
- Message values do not change, so existing translations stay valid. Only the interpolated values become formatted.

### Step 6: Tests (`packages/billing/tests`, jsdom)

1. **Update `RecurringUnitSchedulePanel.test.tsx`:**
   - Give the `useFormatters` mock a distinguishable `formatDate`, such as the real `formatDateValue(v, 'en', undefined, countryDateFormat('AU'))` or `v => \`D(${v})\``.
   - Mock `@alga-psa/ui/components/DatePicker` with the ISO `<input type="date">` shim from `settings/billing/PriceChangeRolloutDialog.contract.test.tsx:44`. It must build `new Date(\`${v}T00:00:00\`)` and read local components.
   - Existing `fireEvent.change(... '2027-01-16')` flows then keep working, and the wire assertions (`mid_period_date`, `mid_period_effective_date: '2027-01-16'`) must stay ISO.
   - Add assertions for formatted dates:
     - the revisions table "Effective from" cell and the `true-up from` note;
     - the history table cell;
     - the `saved` message;
     - the invoice-window preview;
     - `coverage`;
     - `currentEffective`;
     - `catalogSource`.
   - Add an assertion that no raw `\d{4}-\d{2}-\d{2}` text remains in the panel's rendered text after load, save and preview.
2. **Update `RecurringUnitSchedulePanel.translations.test.tsx`:**
   - Apply the same DatePicker shim and add `formatDate` to the mock.
   - Change `From 2026-11-01 the standing quantity` to the formatted value.
   - Keep the `#recurring-effective-config` value assertions. Through the shim they still read ISO, which proves the wire value.
3. **New `RecurringUnitSchedulePanel.discardDialog.test.tsx`.** This is the acceptance test. Use the **real** `ConfirmationDialog` and the **real** `DatePicker`, inside a `DateFormatProvider` (precedent: `packages/ui/src/components/DatePicker.i18n.test.tsx`; real ConfirmationDialog in jsdom: `packages/projects/src/lib/useUnsavedChangesGuard.integration.test.tsx`). Mock only the server actions. Cover four paths:
   - **Dirty + Cancel:** edit quantity, type a new date into `#recurring-effective-config` and blur. The dialog appears with the translated title and message. Click `#recurring-discard-dirty-config-close`. Then:
     - `getEffectiveRecurringUnitPricing` was not called again;
     - the quantity edit is kept;
     - the field text shows the **original** date (this exercises the reset key);
     - a later Save sends the original `effective_period_start`.
   - **Dirty + Confirm:** same setup, then click `…-confirm`. A reload was requested with the new ISO `service_period_start`, the inputs reset to the loaded values, and the field shows the new date.
   - **Clean change:** no dialog appears and the reload happens immediately.
   - **Same day re-picked while dirty:** no dialog appears.
   - Also assert `window.confirm` is never called (`vi.spyOn(window, 'confirm')`).
4. Run `cd packages/billing && npx vitest run tests/RecurringUnitSchedulePanel` and `npx tsc --noEmit -p packages/billing` (or the package's typecheck script). Also run the server-wide glob for `RecurringUnitSchedulePanel` if `server/vitest.config.ts` picks these files up.

### Step 7: UI smoke evidence

Run on dev port 3273, compose `alga-psa-local-test`, using the `alga-billing-contract-smoke-testing` / `algadev` skills. Use a contract line with a unit-priced Fixed service or a recurring product that has at least two saved revisions, one of them with a mid-period true-up, plus one superseded history row. Seed through the panel itself if none exists.

Capture screenshots in **light and dark** theme of:

- revision and history tables showing formatted dates, with the `true-up from` note;
- the effective-from DatePicker panel open;
- the mid-period DatePicker;
- the discard ConfirmationDialog after editing quantity and then changing the date;
- the Cancel result (old date and edit kept);
- the Confirm result (new date, values reloaded);
- a preview/impact message with formatted window dates.

Also check one non-US tenant date format (for example, set the tenant country to AU or DE) so the evidence shows the tenant format rather than the browser locale.

## Deliberately NOT doing

- **Not changing `DateTimeField`** to resync text when a controlled parent rejects a commit. It is the technically better fix, but it is a cross-cutting behavior change to every date field in the app and needs its own card and tests. It is recorded as a LEVERAGE friction marker instead.
- **Not changing `ContractLines.tsx`.** Its inline line editor has its own `<Input type="date">` for `quantity-effective-${contract_line_id}` (line ~1618, same "Service pricing and measurement changes effective from" label, added 2026-09-04 before PR #3492) and a `window.confirm` for removing a contract line (line ~1334). Neither is in the schedule panel nor was introduced by PR #3492. Both are recommended as a follow-up card.
- **Not formatting dates inside server-generated invoice item descriptions** shown in the preview (line 807, `item.description`). That text is composed server-side, so a fix belongs to the invoice-description code, not this panel.
- **Not changing `todayIso()`'s UTC-based "today"** (line 41) for the past-boundary notice and Scheduled/Superseded status. This is pre-existing behavior and out of scope. Comparisons stay ISO.
- **Not adding date constraints** (`minDate` or disabled days) to either picker. Validation stays as it is today.
- **Not extracting a shared `formatCalendarDay`.** Only a LEVERAGE pattern marker is added if the repetition is confirmed.

## Risks

1. **Day shift east or west of UTC.** Mitigation: wire values go only through `toCalendarDateString(Date)` (local components) and display values only through `toCalendarDisplayDate` (local noon) and `formatDate(YYYY-MM-DD)` (UTC formatting). Never use `toISOString` or `toPlainDate(Date)` on picker output. Optionally add a test under `TZ=Pacific/Auckland` and `TZ=America/Los_Angeles` that asserts the round trip `'2026-11-01' → picker → '2026-11-01'`.
2. **Cancel leaves the rejected date visible.** This is mitigated by the reset key and covered by the Dirty + Cancel test with the real DatePicker.
3. **The same-day re-pick prompt.** This is mitigated by the `nextBoundary === boundary` guard and has its own test.
4. **The picker commits on blur, not on every keystroke.** The native input fired `change` as soon as a full date was typed; DatePicker commits on blur, Enter or a day click. Reload therefore happens on commit, which is the intended Alga behavior. Tests must blur or press Enter after typing.
5. **Dialog stacking.** The panel renders inside the contract-line card, not inside another Dialog, so ConfirmationDialog's portal should layer correctly. The smoke run must confirm this, including the DatePicker popover not being clipped by the `<details>` container.
6. **Existing tests depend on the native input and on `formatDate` being absent from mocks.** All three test files are updated in Step 6, and the wire assertions must remain ISO.
7. **Missing translations make `find-untranslated-ui --fail-on-high` fail.** Two new keys are needed in 9 languages, plus regenerated pseudo-locales.
