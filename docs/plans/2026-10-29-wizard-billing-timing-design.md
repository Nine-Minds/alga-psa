# Contract wizard: let the user choose billing timing (in advance / in arrears)

Card `087868b5` · PSA `alga-2026-0002714` (`84feb4ad-04f1-4040-8565-1ee8703220c4`)

## Problem

Every contract created through the wizard is billed in arrears, because the wizard never exposes the
choice. The model and the create action already support it end to end:

- `ContractWizard.tsx:196` — `billing_timing?: "arrears" | "advance"` on the wizard draft; default
  `"arrears"` at line 274.
- `ContractWizard.tsx:802` — a fixed line is created with `line.billing_timing ?? wizardData.billing_timing`,
  so a line that does not name its own timing **inherits the contract default**. That inheritance is
  already the mechanism we need for a per-line override; we do not have to invent one.
- `contractWizardActions.ts` resolves contract-wide and per-line timing into `recurringAuthoringPolicy`
  / `fixedLinePolicy`; hourly and usage lines go through `arrearsOnlyLinePolicy`.
- `BillingTimingField.tsx` already renders a Fixed line's choice and a read-only "In Arrears" for
  hourly/usage via `isAdvanceTimingAllowedForLineType`.
- `shared/billingClients/contractLineTimingRule.ts` holds the two rules (`isAdvanceTimingAllowedForLineType`,
  `resolveEffectiveBillingTiming`) that every server path already calls.

So the defect is purely presentation: **no wizard step renders the control**, and the Review step never
shows what the contract will actually bill. The user's only recourse is editing each line afterwards —
which is exactly how Lynda hit the products-save bug.

## Direction

Render the existing control against the existing draft fields. No new state model, no parallel rule.

### 1. Contract-wide default — `ContractBasicsStep.tsx`

Add a "Billing timing" field bound to `wizardData.billing_timing`, defaulting to `arrears`, rendered with
`BillingTimingField` (`lineType="Fixed"`, so it offers the choice) and a help line that this is the
default for lines that can bill in advance. Hourly/usage lines ignore it — say so here rather than at
each line.

### 2. Per-line override — `FixedFeeServicesStep.tsx` + `FixedLineEditor.tsx`, and `ProductsStep.tsx`

Each fixed line's editor gets a timing control with **three** states, because the draft already
distinguishes "unset" from a value:

| control | stored value | meaning |
|---|---|---|
| Use contract default | `undefined` | inherits `wizardData.billing_timing` (create action line 802) |
| In arrears | `"arrears"` | explicit override |
| In advance | `"advance"` | explicit override |

`BillingTimingField` is binary today; extend it with an optional `allowInherit` + `inheritedValue` so it
can render the third option and label it with the effective value ("Use contract default — in advance").
That is a small, additive change to a shared component, not a second control.

The Products step's line is also a fixed line (product members are unit members of a fixed line), so it
gets **one** control at line level, not one per product. Bucket/prepaid block drafts bill in advance
already by construction; do not offer a choice there.

### 3. Hourly and usage — say so, don't offer

`HourlyServicesStep` and `UsageBasedServicesStep` render `BillingTimingField` read-only (it already
collapses to "In Arrears" plus the explanation). Rendering it is the point: a user who set an advance
default must be able to see that the hourly line will not follow it.

### 4. Review — show the effective timing per line

`ReviewContractStep.tsx` currently shows each line's frequency. Add the resolved timing beside it:
`resolveEffectiveBillingTiming(line.contract_line_type, line.billing_timing ?? data.billing_timing)` —
the same function the server uses, so the review cannot disagree with what gets created. Label with
`t('wizardReview.billingTiming.advance' | '.arrears')`, and mark inherited values as inherited
("In advance (contract default)") so the user can see where their choice came from.

Also reconcile `FirstInvoiceNotice` — with an advance annual contract the first invoice is issued at
creation, and the notice must say that rather than implying the first invoice is a period later.

### 5. Template mode

`TemplateLinesStep` builds lines from a contract template. If the template carries a timing, keep it
and show it read-only; if it does not, the template lines inherit the contract-wide default chosen on
the basics step. Do not silently overwrite a template's timing with the new default — check
`contractTemplates` for the field during implementation and state the outcome in the PR.

### 6. i18n

New keys: `billingTimingField.inherit`, `.inheritWithValue`, `.contractDefaultHelp`, and
`wizardReview.billingTiming.*`. **Add every key to every locale pack in the same commit** — the locale
and `artifact-drift` checks fail a half-translated set, and that is the most common red on this card
family.

## Deliberately not doing

- No new timing rules, no new policy type, no client-side re-derivation: the server rules stay the only
  authority (`resolveEffectiveBillingTiming`, `arrearsOnlyLinePolicy`).
- No per-member timing inside a line — timing is a line property.
- No change to the create action's resolution order (line value, else contract default); the wizard now
  simply populates the fields it already reads.
- No backfill of existing contracts: they keep whatever they were created with.

## Tests

- Annual Products contract created with "in advance": the created line has `billing_timing='advance'`;
  service periods and the first invoice follow advance billing (existing create-action test extended,
  not a new path).
- Mixed contract: advance contract default + an hourly line → hourly line is created in arrears and the
  wizard showed it read-only as arrears.
- Per-line override beats the contract default (explicit arrears under an advance default).
- Inherit: changing the contract default after setting nothing on a line moves that line with it;
  changing it after setting an explicit override does not.
- Review step renders the resolved timing per line, including the inherited label.

## Order of work

1. `BillingTimingField` gains the inherit option (with its own unit test) — additive, no caller breaks.
2. Basics step default, then the two fixed-line editors, then the read-only renders.
3. Review + first-invoice notice, i18n keys in every pack.
4. `nx affected -t typecheck test build` for billing.
