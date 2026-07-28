# IntentCritic — Credit Management (/msp/billing/credits)

Rule applied: every padding, margin, font size, weight, color, alignment, and spacing must have a
defensible answer to "why this value?" If the answer is "that's what got typed," it's a defect.
Evidence: screenshots `adr-active.png`, `adr-recon.png`, `all-credits-units.png`, `recon-units.png`,
`view-dialog2.png`, `edit-dialog.png`, `expire-dialog.png`, `add-credit.png`; code in
`packages/billing/src/components/credits/`. Ranked worst-first.

---

## 1. Custom Adjustment prefill is off by 100× — a units defect wearing a UI costume

- **Element/property:** "Adjustment Amount" input, prefilled value — `ReconciliationReportDetail.tsx`
  `handleOpenFixDialog`: `setCustomAmount(report.difference.toString())`.
- **Why this value?** Indefensible. `report.difference` is in **minor units** (cents) — proven by
  every display site formatting it with `formatCurrencyFromMinorUnits(report.difference)`. But the
  input is a **major-units** field: on submit it runs `toMinorUnits(parsed, i18n.language)` (line 132)
  and the Impact Summary computes `report.actual_balance + toMinorUnits(parseFloat(customAmount)...)`
  (line 583). So a −$43.00 discrepancy prefills the box with `-4300`, and the Impact Summary happily
  tells the user their new balance will be actual **− $4,300.00**. The hint text says "Enter a
  positive amount to increase the balance" — no unit, no `$` adornment, no decimals in the prefill.
- **Intentional fix:** prefill with `(report.difference / 100)` via the same minor→major helper the
  formatter uses, and give the input a currency adornment or `type="number" step="0.01"` like
  AddCredit's Amount field — which, note, *does* take dollars correctly. Two money inputs in one
  feature, two implicit units, one of them wrong.

## 2. Money alignment: three surfaces, three answers to the same question

- **Element/property:** column alignment on every currency cell.
  - Credits table (`CreditsPageClient.tsx` `createColumns`): "Original Amount" and "Remaining" have
    **no alignment** — they render left-aligned (visible in `all-credits-units.png`: `$18.00`,
    `$2,000.00` hug the left edge under the header).
  - Reconciliation table (`ReconciliationTab.tsx`): "Expected Balance", "Actual Balance",
    "Discrepancy" — also **no alignment**, left (`recon-units.png`).
  - `CreditDetailDialog.tsx` raw table: `text-right` on the Amount `<th>` and `<td>` — right.
  - `ReconciliationReportDetail.tsx` "Credit Applications" table: `<th className="px-4 py-2 text-left
    ...">Amount</th>` — **left again**, directly contradicting the detail dialog's table.
- **Why this value?** There is no value — there are three. Currency is right-aligned (tabular,
  decimal-aligned) by a century of accounting convention; the codebase knows this (the dialogs do
  it) and forgot it in both DataTables, then forgot it *again* in the drawer's raw table.
- **Intentional fix:** right-align all money columns in both DataTables (ColumnDefinition needs an
  align/headerAlign set once), flip the drawer's Applications table Amount column to `text-right`,
  keep the dialog as-is. One decision, applied everywhere.

## 3. Non-semantic color, two rival color systems on one screen

- **Element/property:** status/discrepancy color.
  - Credits table status (`CreditsPageClient.tsx` `getStatusLabel`): hard-coded Tailwind palette —
    `text-red-600` (Expired), `text-blue-600` (Active), `text-orange-500` (Expiring Soon).
  - Settings panel: `text-green-600` "Enabled" / `text-red-600` "Disabled".
  - Reconciliation badges (`reconciliationPresentation.tsx`): design tokens —
    `bg-[rgb(var(--color-primary-100))]`, `secondary-100`, `accent-100`.
  - Discrepancy values (`ReconciliationTab.tsx` + drawer): positive → `text-[rgb(var(--color-primary-700))]`
    (brand purple), negative → `text-[rgb(var(--color-destructive-600))]`.
- **Why this value?** None of it survives questioning:
  - "Active" is blue in the table but "Enabled" — the same semantic, six centimeters away in the
    settings panel (`adr-active.png`) — is green. Pick one hue for "good".
  - "Resolved" maps to **primary (purple)**, not a success/green token. Resolved is the terminal
    *good* state and it wears the brand color, while "Open" — the state demanding attention — gets
    `accent`, the quietest of the three. The ladder is inverted.
  - Positive discrepancy = purple primary. A positive discrepancy is not "on-brand," it's still a
    discrepancy; and "Total Discrepancy Amount −$43.00" on the stat card (`adr-recon.png`) is plain
    `text-900` while the same −$43.00 in the table below it is red. Same number, same screen, two
    emphasis levels.
  - The destructive token renders **orange/amber** in this theme (`expire-dialog.png` confirm
    button), colliding with `text-orange-500` "Expiring Soon" — one hue now means both "this will
    destroy data" and "this is mildly urgent."
- **Intentional fix:** one semantic scale — success / warning / danger / neutral — as tokens, used by
  table status, settings Enabled/Disabled, badges, and discrepancy signs. Resolved→success,
  In Review→warning or neutral, Open→danger/attention. Discrepancy: nonzero = danger/amber regardless
  of sign (or sign-colored consistently, including the stat card). Delete every `text-{red,blue,
  green,orange}-*` literal from this feature.

## 4. `width: '10%'` on the Actions column — a magic number that doesn't fit its contents

- **Element/property:** `CreditsPageClient.tsx` Actions column, `width: '10%'`.
- **Why this value?** Indefensible. The cell contains **three** outline buttons (View / Edit /
  Expire). At 10% of the table they cannot fit on one line; `all-credits-units.png` shows the buttons
  squeezed at the right edge while "Description" truncates mid-word ("Credit issued from negative i…").
  Ten percent of what, chosen when, measured against which content? Nobody can say.
- **Intentional fix:** drop the width (let the button cluster size to content with
  `whitespace-nowrap`), or use an overflow menu for the secondary actions. If a width is truly
  needed, derive it from the rendered button group, not a percentage pulled from the air.

## 5. Four dialogs, three field-layout idioms, zero shared components

Built in the same feature, presumably reviewed together — and each one invented its own grammar:

- **CreditDetailDialog** (`view-dialog2.png`): `max-w-2xl`, label-above-value stacked fields in
  `grid grid-cols-2 gap-4`, `text-xs` muted label / `text-sm font-medium` value, body `space-y-6`,
  title `text-xl font-semibold mb-4`.
- **EditCreditExpirationDialog / ExpireCreditDialog** (`edit-dialog.png`, `expire-dialog.png`):
  default `DialogContent` width, label-**left/value-right** inline rows via `grid grid-cols-2 gap-2`
  with values `text-right`, body `space-y-4`, title `text-xl font-semibold mb-2` + `mb-4` description.
- **AddCreditButton / fix dialog** (`add-credit.png`): label-above-input, title passed through the
  `Dialog title` prop (a third title mechanism), body `py-4 space-y-4`.

Questions with no answers:
- Why is the detail dialog `max-w-2xl` while its siblings take the Dialog default? The drawer that
  shows the *same kind of* detail content is `width="720px"` with an inner `min-w-[560px]`
  (`ReconciliationTab.tsx` / `ReconciliationReportDetail.tsx`) — three arbitrary widths (672px,
  720px, 560px) for "detail surface" in one feature.
- Why `gap-2` rows in Edit/Expire but `gap-4` in Detail? Why `space-y-6` in one dialog body and
  `space-y-4` in the others?
- The label/value pair — the single most repeated molecule on this screen — has **three
  implementations**: `flex justify-between` (settings panel), `grid-cols-2` inline (Edit/Expire/
  Impact Summary), stacked (Detail dialog). And `DetailField` is copy-pasted between
  `CreditDetailDialog.tsx` and `ReconciliationReportDetail.tsx` with already-diverged typography
  (`text-xs`+`text-sm font-medium` vs `text-sm`+`font-medium`). A `DescriptionList`/`DetailField`
  component in the UI package would make all of this one decision.
- Title weight: `font-semibold` ×3 dialogs, `text-xl font-bold` in the drawer header, prop-driven in
  AddCredit. The type ramp for this screen is h1 `text-3xl font-bold` → CardTitle → settings `h3
  text-lg font-medium` → dialog h2 semibold → drawer h2 bold → fix-option h4 `font-medium` — six
  rungs where three (page / card-or-dialog title / section) suffice.
- **Intentional fix:** extract `DetailField`/`DescriptionList` to `@alga-psa/ui`, pick one dialog
  body rhythm (`space-y-4`, grid `gap-4`), one dialog width token, one title component used by all
  four dialogs and the drawer.

## 6. Two date formats on the same screen

- **Element/property:** date rendering. Credits table: `new Date(value).toLocaleDateString()` →
  `6/11/2026` (`all-credits-units.png`). Reconciliation table and every dialog: `formatDateOnly()` →
  `2026-06-11` (`view-dialog2.png`, `recon-units.png`).
- **Why this value?** No rationale — two formatters imported in sibling files. The View dialog for a
  row shows `2026-06-11` for the same date the underlying table renders as `6/11/2026`.
- **Intentional fix:** `formatDateOnly` everywhere (or locale-aware everywhere — but one of them).

## 7. Dead and doubled affordances in the Edit dialog

- **"Remove expiration date"** (`EditCreditExpirationDialog.tsx`, visible in `edit-dialog.png`):
  a `text-xs` muted paragraph sitting under a DatePicker that is already `clearable` (the × is
  visible in the screenshot). It is not a button, not a link, not wired to anything. Why is this text
  here? Either it instructs ("click × to remove") — in which case it's a caption apologizing for the
  control — or it's vestigial. Delete it or make it an actual action.
- **Double label:** the DatePicker is given both an external `<Label>New Expiration Date</Label>`
  **and** `label={...'New Expiration Date'}` as a prop. Same string, two channels — whichever one
  renders, the other is a lie waiting to diverge. Same pattern in AddCredit's Expiration Date.
- **`mb-4` inside `space-y-6`** (`CreditsPageClient.tsx` BackButton wrapper): the parent already
  owns vertical rhythm; the extra `mb-4` is a second spacing system fighting the first.

## 8. The Expire emphasis ladder is right in principle, weak in execution

- **Element/property:** row action `variant="outline" className="text-destructive hover:bg-destructive/10"`
  vs confirm `variant="destructive"` (`expire-dialog.png`).
- **Why this value?** The *idea* — quiet destructive at row level, loud destructive at the point of
  no return — is the one defensible ladder on the screen. But execution: View/Edit/Expire are all
  `outline size-sm`, so Expire's only signal is text color at equal visual weight — and, per §3, the
  destructive hue in this theme reads as the same orange as "Expiring Soon," draining the signal.
  Meanwhile the dialog's warning sentence ("This action cannot be undone.") is `text-sm` muted —
  the single most important sentence in the flow rendered in the quietest style on the dialog.
- **Intentional fix:** keep the ladder, strengthen it: warning sentence as an `Alert variant=
  "destructive"` (the component already exists and is used for errors in the same dialog), and fix
  the token collision so destructive ≠ status-warning orange.

## 9. Stat cards: the one number that matters is the only one with no voice

- **Element/property:** `ReconciliationTab.tsx` `StatCard` — `text-2xl font-bold text-[rgb(var(
  --color-text-900))]` for all four values (`adr-recon.png`): Open=1, In Review=0, Resolved=1,
  Total Discrepancy **−$43.00**.
- **Why this value?** "Open Issues: 1" and "Resolved: 1" and "you are out of balance by $43" are
  three different urgencies wearing identical typography. And a money stat is left-aligned under a
  long label while every money convention (and this app's own dialogs) says right/tabular. Minus
  placement (`-$43.00`) is itself fine and consistent — the inconsistency is *emphasis*: the table
  below colors the same −$43 red.
- **Intentional fix:** semantic color on the discrepancy stat (danger when nonzero, success/neutral
  when zero), counts get a tabular style; consider `tabular-nums` on all stat values.

## 10. Token system schizophrenia

- **Element/property:** `bg-muted`, `text-muted-foreground` (CreditsPageClient settings panel, empty
  states, AddCredit description) living next to `bg-[rgb(var(--color-background-100))]` and
  `text-[rgb(var(--color-text-500))]` (everything new in this feature) — sometimes in the same file,
  once in the same dialog (AddCredit description uses `text-muted-foreground`; its hint text two
  fields later uses `text-[rgb(var(--color-text-500))]`).
- **Why this value?** Two generations of the design system, never reconciled; the muted pair may or
  may not resolve to the same gray, which is exactly the problem — nobody can point at the two grays
  in `add-credit.png` and say whether their difference is intentional.
- **Intentional fix:** alias `muted-foreground`→`text-500` (and `bg-muted`→`background-100`) at the
  theme layer, or sweep the feature to one spelling. One muted gray, one name.

## 11. "Notification Days: 30, 7, 1" — a data structure, not a design

- **Element/property:** settings panel value `settings.credit_expiration_notification_days?.join(', ')`
  (`adr-active.png`).
- **Why this value?** `join(', ')` is what you write when the array reaches the screen untouched.
  "30, 7, 1" with no unit, no order explanation, no "days before expiry" — the label does all the
  work and the value does none.
- **Intentional fix:** render "30, 7, and 1 days before expiration" or three chips; at minimum
  append the unit.

---

## Summary of the indictment

| # | Element | Property | Verdict |
|---|---------|----------|---------|
| 1 | Custom Adjustment input | prefill units | **Functional defect** — 100× off |
| 2 | Money columns (both DataTables + drawer table) | alignment | Indefensible — 3 answers to 1 question |
| 3 | Status / discrepancy / badge colors | color | Indefensible — non-semantic, two systems, inverted ladder |
| 4 | Actions column | `width: '10%'` | Magic number, doesn't fit contents |
| 5 | Four dialogs + drawer | width / spacing / layout idioms | No system; duplicated `DetailField` already diverging |
| 6 | Dates | formatter | Two formats, one screen |
| 7 | Edit dialog helpers | text / labels | Dead affordance, double label |
| 8 | Expire ladder | variant/color | Right idea, signal destroyed by token collision |
| 9 | Discrepancy stat | color/emphasis | The alarm is styled like the all-clear |
| 10 | Muted grays | token | Two names, unknown relationship |
| 11 | Notification days | format | Raw data on screen |

The through-line: this screen was assembled, not designed. Individual files each contain *locally*
reasonable choices (`text-right` in the dialog, the destructive outline→solid ladder, the stacked
DetailField) — and every one of them is contradicted by a sibling file. Intentionality lives one
level up, in the layer that doesn't exist yet: a `DetailField`/`DescriptionList` component, a money
column convention in `DataTable`, a semantic status-color scale, and one dialog template. Build
those four things and 80% of this list fixes itself.

// LEVERAGE: pattern detail-field — label/value molecule hand-rolled 3× in one feature; extract to @alga-psa/ui
// LEVERAGE: pattern money-column — alignment/format/color decided per-call-site; belongs in DataTable column type
// LEVERAGE: friction status-colors — hard-coded palette literals fighting the token system; semantic scale missing below
