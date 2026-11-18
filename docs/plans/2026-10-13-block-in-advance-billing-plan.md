# Block In Advance billing on Hourly/Usage contract lines: implementation plan

**Card:** 46cf0bbe-167c-4233-94ae-cc8d373b06b6 · **PSA ticket:** alga-2026-0002697
**Branch:** `feature/block-in-advance-billing-on-hourly-usage-contrac`
**Date:** 2026-10-13
**Grounded in:** `main` at `a65fccb78c`. File:line references were checked against that commit. Several line numbers in the card brief had drifted; the numbers below are the current ones.
**Reported by:** Ryan, Tom's Help Desk (Discord #feedback, 2026-10-12). He set an Hourly line to In Advance and the invoice preview said "Nothing to bill".

---

## 1. Current state (verified by reading the code)

### 1.1 Why an advance Hourly/Usage line bills nothing

1. **The schedule takes its due position from `billing_timing` for every line type.**
   - Client cadence: `shared/billingClients/clientCadenceScheduleRegeneration.ts:537-538` (`computeClientCadenceRegeneration`).
   - Contract cadence: `packages/billing/src/actions/contractCadenceServicePeriodMaterialization.ts:495-496` (`syncContractCadenceObligation`).
   - Both input rows already include `contract_line_type`: `ClientCadenceRecurringObligationRow` at :25-32, selected at :396, and `ContractCadenceObligationRow` at :30-38, selected at :370.
2. **For advance, the invoice window is the service period itself.** This happens in `shared/billingClients/materializeClientCadenceServicePeriods.ts:138-140` and `shared/billingClients/contractCadenceServicePeriods.ts:85-96`. The window becomes due on its first day: `shared/billingClients/recurringDueWork.ts:99-118` uses `isEarlyInvoiceWindow`, and `:202` infers the due position from the schedule key.
3. **The loaders read only the service period, never the invoice window.**
   - Time: `loadTimeBasedObligation`, `packages/billing/src/lib/billing/billingEngine.ts:5458-5462`, filtered by `time_entries.invoiced = false` (:5400).
   - Usage: `loadUsageBasedObligation` :5855-5859, and period totals by exact period at :5805-5806.
   - Bucket: `loadBucketObligation` :7075-7076.
   - On day 1 of the period, none of these finds anything.
4. **The empty period is claimed anyway.** `claimRecurringServicePeriodsForSelectionInputs` (`packages/billing/src/services/invoiceService.ts:148-264`, update at :245-256) sets `lifecycle_state='billed'` and `invoice_id`, and leaves `invoice_charge_detail_id` NULL. It does not look at charge family.
5. **The time is stranded. This comes from reading the code; the test in §4.1 must prove it.**
   - A billed row is terminal (`shared/billingClients/recurringServicePeriodLifecycle.ts:3-20`) and protected from regeneration (`regenerateRecurringServicePeriods.ts:118-129`).
   - The next advance window reads only the next period.
   - So time logged on Oct 15 stays `invoiced=false` and no window ever reads it.
   - Only `hardDeleteInvoice` releases the period (`invoiceModification.ts:624-642`, run at :2217-2224, which sets it back to `locked`). Voiding does not (`voidInvoiceActions.ts`).
6. **The engine's own guard does not cover this path.** `isRecurringTimingEligibleContractLine` (`billingEngine.ts:4923-4932`) excludes Hourly and Usage, but its only caller is `buildRecurringTimingSelections` (:4770). `buildRecurringChargeTimingSelection` (:4934-4939) still honours `billing_timing` on the derived path, and the persisted path (:4788-4843) never consults the guard.

### 1.2 Write paths that store advance on Hourly/Usage today

**Through `resolveRecurringAuthoringPolicy`** (`shared/billingClients/recurringAuthoringPolicy.ts:34-62`). The policy never sees the line type; it returns `billingTiming ?? fallbackBillingTiming ?? 'arrears'`.

| Call site | Entity | Type available? | Timing source | Type can change here? |
|---|---|---|---|---|
| `contractLineAction.ts:210` `createContractLine` | contract_lines | yes (input) | explicit | – |
| `contractLineAction.ts:275` `updateContractLine` | contract_lines | yes (`existingPlan` + input) | explicit, else stored | **yes** |
| `contractLineMappingActions.ts:729` (template branch) | contract_template_lines | **no**: selects 2 cols at :727; type is `line_type` | explicit, else stored | no |
| `contractLinePresetActions.ts:492` `copyPresetToContractLine` | contract_lines | yes (preset) | copied from preset | – |
| `contractLinePresetActions.ts:821` `createCustomContractLine` | contract_lines | yes (input) | explicit | – |
| `contractWizardActions.ts:679` template wizard | contract_lines (is_template) → contract_template_lines | hard-coded per line | contract-wide | – |
| `contractWizardActions.ts:1515` client wizard | contract_lines (Products/Hourly/Usage) | hard-coded | contract-wide | – |
| `contractWizardActions.ts:1576` client wizard, per Fixed line | contract_lines | Fixed | per-line, else contract-wide | – |
| `models/contractLinePreset.ts:66` / `:105` | contract_line_presets | yes (input / full existing row) | explicit, else stored | **yes** (:105) |
| `models/contractLine.ts:123` / `:153` | contract_lines | yes / **no** (:158 selects 2 cols) | explicit, else stored | **yes** (:153, `...rest` at :171) |
| `models/contractLineMapping.ts:283` | contract_lines, falling back to contract_template_lines (:316) | **no** (:281) | explicit, else stored | effectively yes (`...dataToUpdate` at :294) |
| `repositories/contractLineRepository.ts:1136`, `:1173`, `:1237`, `:1256` | template / live lines | **no** (2-col selects at :1135, :1172, :1236, :1255) | explicit, else stored | no |
| `server/src/lib/api/services/ContractLineService.ts:346`, `:405`, `:456` | contract_lines | yes | always inherited: REST schemas strip `billing_timing` | **yes** (:405 has no guard; :456 is guarded only when the line is in use) |

**Bypassing the policy.** These copy the stored timing verbatim, null → arrears:

- `cloneTemplateLineToContract`, `contractLineRepository.ts:475-601` (timing at :601). This is the template → contract clone used by the wizard (:1550), `repo addContractLine` (:1065), `contractActions.ts:360` and REST `addContractLine`.
- `ensureTemplateLineSnapshot`: `contractLineRepository.ts:261-284` and the copy at `contractLineMappingActions.ts:131-185`.
- `addClientContractLine`: `packages/clients/src/actions/clientContractLineActions.ts:476-501`.
- REST `assignPlanToClient`: `ContractLineService.ts:1199/1213`.
- REST `copyPlan`: `ContractLineService.ts:1328-1353` (`...sourcePlan`).

**Already correct.** Keep these, and route them through the shared predicate:

- `upsertContractLineTerms` guard, `contractLineAction.ts:345-346`, message whitelisted at :42.
- Quote conversion, `quoteConversionService.ts:192-196` and `crmWorkerDal.ts:1094-1098`.
- Preset dialog, `ContractLineDialog.tsx:251-255` and `:411`.
- `FixedContractLineConfiguration.tsx:283`.

**MCP / AI chat** only proxies the REST routes (`server/src/lib/mcp/registry.generated.ts`), so it inherits whatever the REST path does.

### 1.3 UI surfaces

All paths are under `packages/billing/src/components/billing-dashboard/`.

| Surface | Where | Gated by type? | Saves via |
|---|---|---|---|
| Create custom contract line | `contracts/CreateCustomContractLineDialog.tsx:1056-1084`, sent at :273 | **no** | `createCustomContractLine` (:286) |
| Inline line edit on a client contract | `contracts/ContractLines.tsx:1549-1573` (comment: "applies to all recurring line types"), options :185-194 | **no** | `updateContractLine` (:828-834) |
| Template line edit ("Edit Rate") | `contracts/ContractLineEditDialog.tsx:172-212` | only by the opener: `ContractTemplateDetail.tsx:2101` shows it for Fixed only | `updateContractLineRate` (`ContractTemplateDetail.tsx:2033` → `contractActions.ts:433` → repo :1237) |
| Client contract wizard | `contracts/wizard-steps/FixedFeeServicesStep.tsx:122-150`, an "advance suggestion" button that sets the contract-wide `billing_timing` | shown on the Fixed step, but the value is contract-wide | `ContractWizard.tsx:661` → `createClientContractFromWizard` |
| Template wizard | `contracts/template-wizard/steps/TemplateFixedFeeServicesStep.tsx:229-249` | Fixed step, template-wide value | `TemplateWizard.tsx:150` → `createContractTemplateFromWizard` |
| Preset config page | `contract-lines/FixedContractLinePresetConfiguration.tsx:441-466`, save :180 | routed for Fixed only | `updateContractLinePreset` |

**Draft resume adds a wrinkle.** `getDraftContractForResume` (`contractWizardActions.ts:2331-2339`) takes the contract-wide timing from the **first non-Fixed line**. Once Hourly/Usage are always arrears, a resumed advance draft would come back as arrears and the Products line would follow it. This has to change; see §2.6.

---

## 2. Design

### 2.1 One rule, in one shared module

New file: `shared/billingClients/contractLineTimingRule.ts`. It owns the rule; every other layer asks it.

```ts
export const ARREARS_ONLY_CONTRACT_LINE_TYPES = ['Hourly', 'Usage'] as const;
export function isAdvanceTimingAllowedForLineType(lineType: string | null | undefined): boolean;
// Engine/read side: the timing a line actually bills on, whatever is stored.
export function resolveEffectiveBillingTiming(lineType, storedTiming): RecurringBillingTiming;
export class ContractLineTimingNotAllowedError extends Error {
  readonly code = 'CONTRACT_LINE_TIMING_NOT_ALLOWED';
  readonly statusCode = 400;
}
```

- **Matching.** Match case-insensitively, and include the `'time'` alias that `resolveRecurringChargeFamily` already accepts (`clientCadenceScheduleRegeneration.ts:191-208`, duplicated at `contractCadenceServicePeriodMaterialization.ts:142-156`).
- **Covered types: Hourly and Usage only.** This mirrors `isRecurringTimingEligibleContractLine` and the card. Bucket is not a line type the UI or REST can author (buckets are overlays on Hourly/Usage lines), and Product and License stay advance-eligible.
- **Engine guard.** `billingEngine.isRecurringTimingEligibleContractLine` becomes a call to this predicate.
- **Error message.** "Advance billing is only available for fixed contract lines. Hourly and usage lines bill work after it happens, so they always bill in arrears." Passing `statusCode` and `code` means `handleApiError` (`server/src/lib/api/middleware/apiMiddleware.ts:480`) returns a 400 with no REST-specific code.
- **`upsertContractLineTerms`.** Its guard (`contractLineAction.ts:345`) uses `!== 'Fixed'`, which is stricter: it also blocks Product. **Decision:** switch it to the shared predicate and error, so there is exactly one rule. Product lines are recurring fixed-price lines, and the wizard already creates them with advance (:1653). If review wants Product kept arrears-only, the predicate is the single place to change.

### 2.2 The authoring policy enforces the invariant

Change `resolveRecurringAuthoringPolicy` (`shared/billingClients/recurringAuthoringPolicy.ts:14-62`):

- Add a **required** input `lineType: string | null`. It is a required key (`string | null`, not optional), so the compiler flags every caller that has not been updated.
- Keep `billingTiming` as the **explicit** request, and `fallbackBillingTiming` as the **stored/inherited** value. Add `contractWideBillingTiming` for the wizard.
- Resolution:
  1. The line type does not allow advance, and `billingTiming === 'advance'` → **throw** `ContractLineTimingNotAllowedError`. An explicit choice is never coerced.
  2. The line type does not allow advance, otherwise → `'arrears'`. This covers inherited advance (a type change to Hourly/Usage), contract-wide advance (the wizard), and a stale stored value.
  3. Advance is allowed → `billingTiming ?? contractWideBillingTiming ?? fallbackBillingTiming ?? 'arrears'`. This is today's behaviour.
- Rule 2 gives decision 1c ("changing a line's type to Hourly or Usage resets its timing to arrears") for free. Update callers must pass the **post-update** type: `input.contract_line_type ?? existing.contract_line_type`.

**Caller changes.** Every row in the §1.2 policy table:

- **Type already in hand.** Pass it: `contractLineAction.ts:210/275`, `contractLinePresetActions.ts:492/821`, `models/contractLinePreset.ts:66/105`, `models/contractLine.ts:123`, `ContractLineService.ts:346/405/456`.
- **Type missing.** Widen the existing select to include the type:
  - `contract_lines.contract_line_type`: `models/contractLine.ts:158`, `models/contractLineMapping.ts:281`, `contractLineRepository.ts:1172/1255`.
  - `contract_template_lines.line_type`: `contractLineMappingActions.ts:727`, `contractLineRepository.ts:1135/1236`, and the template fallback in `models/contractLineMapping.ts:316`.
- **`copyPresetToContractLine` (:492).** Pass `preset.billing_timing` as `fallbackBillingTiming`, not `billingTiming`. A stale advance on an Hourly preset must normalise, not make "add preset to contract" throw.
- **Wizard.** Split the single policy call per line type.
  - Template wizard (:679): Fixed (:715) and Products (:819) use `contractWideBillingTiming: submission.billing_timing`. Hourly (:876) and Usage (:962) resolve with `lineType` and get arrears without an error.
  - Client wizard: the same split at :1515 (Products :1653, Hourly :1710, Usage :1765). Fixed lines keep the per-line `fixedLine.billing_timing` as the explicit value and the contract-wide value as `contractWideBillingTiming` (:1576-1581).
- **Error mappers.** Each must pass the new error through as a user-facing message. Add an `instanceof ContractLineTimingNotAllowedError` branch to:
  - `contractLineActionErrorFrom` (`contractLineAction.ts:30-70`, replacing the exact-string match at :42),
  - `contractLinePresetActionErrorFrom` (`contractLinePresetActions.ts:43-87`),
  - `contractLineMappingActionErrorFrom` (`contractLineMappingActions.ts:26-58`),
  - `contractWizardActionErrorFrom` (`contractWizardActionErrors.ts:42-81`),
  - `contractActionErrorFrom` (`contractActions.ts`),
  - `clientContractLineActionErrorFrom`.

  Give it an i18n key: `msp/contract-lines:errors.line.advanceTimingNotAllowed`.

### 2.3 Copy paths go through the same rule

**Clone paths.** These copy a line from one place to another. A copy is not an explicit user choice, so it normalises (rule 2):

- `cloneTemplateLineToContract`, `contractLineRepository.ts:565/601`
- `ensureTemplateLineSnapshot`: repo `:282` and actions `:168`
- `addClientContractLine`, `clientContractLineActions.ts:476-501`
- `assignPlanToClient`, `ContractLineService.ts:1199`
- `copyPlan`, `ContractLineService.ts:1328-1353`

**How.** They all already call `normalizeTemplateRecurringStorage` / `normalizeLiveRecurringStorage` (`shared/billingClients/recurrenceStorageModel.ts:47-73`). Add a type-aware sibling, `normalizeRecurringStorageForLineType(row, lineType)`, that applies `resolveEffectiveBillingTiming`, and use it at these write sites only.

**Read sites keep the existing normalizers** (about 39 uses). Display should show what is stored until the migration has run, and after the migration and constraint there is nothing left to hide.

`// LEVERAGE: pattern recurring-storage-copy`: five copy paths hand-roll the same "spread a line row into a new line row" shape. Mark each site; extracting a single `copyContractLineRow` is out of scope.

### 2.4 Database constraint as the last guard

Add a CHECK constraint so a future write path that forgets the policy fails loudly instead of silently storing a broken line:

- `contract_lines`: `CHECK (contract_line_type NOT IN ('Hourly','Usage') OR billing_timing = 'arrears')`
- `contract_template_lines`: the same, on `line_type`
- `contract_line_presets`: the same, on `contract_line_type`

**Rollout.** This goes in its own migration, **after** the data repair. Citus refuses DDL on a distributed table after DML on it in the same transaction, and the constraint cannot validate until the bad rows are gone.

Citus propagates `ADD CONSTRAINT ... CHECK` on distributed tables. The CI Citus smoke run must cover this migration.

### 2.5 Engine backstop

The schedule and the engine derive arrears for Hourly/Usage whatever is stored:

- `clientCadenceScheduleRegeneration.ts:537-538` → `resolveEffectiveBillingTiming(obligation.contract_line_type, obligation.billing_timing)`.
- `contractCadenceServicePeriodMaterialization.ts:495-496`, and the eligibility gate at :472-484, which must see the effective timing.
- `packages/billing/src/lib/billing/clientCadenceWindowMaterialization.ts:154-184`. This selects `billing_timing` but not the type, and maps **null → advance** (:184). Add `cl.contract_line_type` to the select, use the shared resolver, and make the null default arrears, consistent with every other path. Null cannot occur under the NOT NULL default, so the default only needs to match.
- `contractCadenceCoverageAudit.ts:391` (due position, and `chargeFamily: 'fixed'` regardless of type). Use the resolver so the audit agrees with the materializer.
- `billingEngine.buildRecurringChargeTimingSelection` (:4934-4939) uses the resolver. `isRecurringTimingEligibleContractLine` (:4923) delegates to the shared predicate.

`resolveRecurringChargeFamily` is copied verbatim in two files. Move it into the same shared module and add `// LEVERAGE: pattern line-type-classification` at its old sites, or simply do the move, which is trivial and obviously right.

**Persisted rows still need the data repair.** The backstop changes what is **generated**. Rows already persisted with `due_position='advance'` are removed by §2.8.

### 2.6 UI

**Shared component.** The rule ships once in the UI too: a small `BillingTimingField` in `packages/billing/src/components/billing-dashboard/contracts/` that takes `lineType`, `value` and `onChange`.

- **Fixed (or any type where `isAdvanceTimingAllowedForLineType` is true):** today's select.
- **Hourly/Usage:** the read-only text "In Arrears" plus one line: "Hourly and usage lines bill work after it happens." It never calls `onChange` with advance.

**Where it goes:**

1. **`CreateCustomContractLineDialog.tsx`.**
   - Replace the select at :1056-1084 with the field.
   - When the plan-type cards (≈1130-1150) switch away from Fixed, reset the state to `arrears`, the same pattern as `ContractLineDialog.tsx:251-255`.
   - The payload at :273 sends `planType === 'Fixed' ? billingTiming : 'arrears'`.
   - Change the default option order to Arrears first.
2. **`ContractLines.tsx:1549-1573`.**
   - Use the field with `line.contract_line_type`.
   - Fix the comment: timing applies to Fixed lines.
   - The save at :828-834 sends `'arrears'` for non-Fixed lines. This matters because the server rejects explicit advance.
3. **`ContractLineEditDialog.tsx:172-212`.** Use the field, with `lineType` passed from `ContractTemplateDetail.tsx:2128`. It is opened only for Fixed today (:2101), but the dialog itself must not rely on its opener.
4. **Client wizard.**
   - `FixedFeeServicesStep.tsx:122-150`: rename the copy so it is clear that advance applies to the fixed-fee lines.
   - `ReviewContractStep.tsx:108/548` and `FirstInvoiceNotice.tsx`: show Hourly/Usage as arrears even when the contract-wide value is advance.
   - Client-side validation, `ContractWizard.tsx:704-731`: pass `'arrears'` for the Hourly/Usage checks instead of `wizardData.billing_timing`.
5. **Template wizard.** `TemplateFixedFeeServicesStep.tsx:229-249` keeps the select. Its label says it applies to fixed-fee lines. `TemplateReviewContractStep.tsx:178-181` shows Hourly/Usage as arrears.
6. **Draft resume.** `getDraftContractForResume` (`contractWizardActions.ts:2331-2339`) derives the contract-wide timing from **Fixed lines first**, the only lines where it means anything. It keeps the non-Fixed precedence for `cadence_owner` only.
7. **Preset config page.** `FixedContractLinePresetConfiguration.tsx:180`: no visible change. The model-level policy (§2.2) covers it.

**Not touched.** The EE contract simulator (`ee/server/src/components/billing/simulator/ScenarioPanel.tsx:660-690`, default advance at :341) persists nothing. A follow-up could gate it with the same predicate so it cannot model an impossible line; it is listed in §6.

**Checks.** Every new element gets a kebab-case id (for example `billing-timing-readonly-arrears`). Check light and dark themes.

### 2.7 Copy and i18n

- `msp/contracts` `createCustomLine.billingTimingHelp` (`server/public/locales/en/msp/contracts.json:822`) becomes a statement of the rule: "Fixed lines can bill in advance or in arrears. Hourly and usage lines always bill in arrears, after the work happens." Reuse the existing `msp/contract-lines` `dialog.billingModel.timingHelp.nonFixed` wording for the read-only line so the two dialogs say the same thing.
- New keys: the read-only line, the error key from §2.2, and the wizard copy changes. Add them to all 9 real locales (en, de, es, fr, it, nl, pl, pt, sv), then regenerate the `xx`/`yy` pseudo-locales (`node scripts/generate-pseudo-locales.cjs`). `scripts/validate-translations.cjs` fails CI on a missing key. Run `npm run test:i18n`.
- Follow the `alga-tech-doc-writing` rule for all copy: no brief language in user-facing strings.

### 2.8 Existing bad data

#### 2.8.1 Measure first (read-only, before writing the migration)

Run against a prod read replica by ops, not from the card. The counts go into the review packet. Every join carries `tenant` (Citus colocation).

```sql
-- Q1 lines per tenant
SELECT tenant, 'contract_lines' src, contract_line_type t, count(*) FROM contract_lines
 WHERE contract_line_type IN ('Hourly','Usage') AND billing_timing = 'advance' GROUP BY 1,2,3
UNION ALL
SELECT tenant, 'contract_template_lines', line_type, count(*) FROM contract_template_lines
 WHERE line_type IN ('Hourly','Usage') AND billing_timing = 'advance' GROUP BY 1,2,3
UNION ALL
SELECT tenant, 'contract_line_presets', contract_line_type, count(*) FROM contract_line_presets
 WHERE contract_line_type IN ('Hourly','Usage') AND billing_timing = 'advance' GROUP BY 1,2,3;

-- Q2 advance periods on those lines, by state and whether a charge backs them
SELECT rsp.tenant, cl.contract_line_type, rsp.lifecycle_state,
       (rsp.invoice_charge_detail_id IS NULL) AS chargeless, (rsp.invoice_id IS NOT NULL) AS invoiced,
       count(*)
  FROM recurring_service_periods rsp
  JOIN contract_lines cl ON cl.tenant = rsp.tenant AND cl.contract_line_id = rsp.obligation_id
 WHERE cl.contract_line_type IN ('Hourly','Usage') AND rsp.due_position = 'advance'
 GROUP BY 1,2,3,4,5;

-- Q3 candidate stranded activity: uninvoiced approved time / usage inside billed advance periods
--    (time: contract_line_id = line, or the line's service via contract_line_service_configuration;
--     usage: usage_tracking.invoiced = false; same date bounds as the loaders, §1.1 step 3)
```

The implementer writes Q3 out in full, using the exact loader predicates (`billingEngine.ts:5398-5462`, `:5855-5859`), and confirms that `obligation_id` equals `contract_line_id` for client-cadence rows before trusting Q2 and Q3.

**The counts decide how much repair machinery ships.** For example, if Q2 shows no `edited`/`skipped` advance rows, §2.8.3 step 3 is reduced to an assertion.

#### 2.8.2 Prove or disprove stranding (first test written)

§4.1 T1. If the test shows the time **is** billed, §2.8.4 is dropped and the plan is amended. Everything else stands.

#### 2.8.3 Migration A: `server/migrations/<ts>_hourly_usage_lines_bill_in_arrears.cjs`

Follow the precedent of `20261010040511_activate_quote_converted_contract_lines.cjs`:

- the shim `require('./utils/tenantDb.cjs')`
- tenants enumerated via `unscoped('tenants', reason)`
- per tenant, select ids first, then a parameterized `UPDATE ... WHERE tenant = ? AND id IN (...)` in chunks of 500
- no functions or casts on columns in UPDATE
- `exports.config = { transaction: true }`, or a short transaction per tenant, as in `20261010120000_collapse_recurring_service_period_obligation_type.cjs`, if row counts are large

**Steps per tenant:**

1. **Flip timing.** Set `billing_timing='arrears'` on Hourly/Usage rows in `contract_lines`, `contract_template_lines` (`line_type`) and `contract_line_presets`.
2. **Retire unbilled advance periods on those lines.** Select `recurring_service_periods` rows where:
   - `obligation_id` is in the flipped live lines,
   - `due_position = 'advance'`,
   - `lifecycle_state IN ('generated','locked')`,
   - `invoice_id IS NULL` and `invoice_charge_detail_id IS NULL`.

   Set them to `lifecycle_state='superseded'` with `reason_code='hourly_usage_arrears_repair'` and `updated_at`. This is the same end state `retireFutureClientCadenceRowsForLine` produces (`clientCadenceScheduleRegeneration.ts:668-686`). It guarantees that no advance window is due between the migration and regeneration.
3. **`edited` / `skipped` advance rows are not superseded.** Superseding a `skipped` row and regenerating would un-skip a period the user chose to skip. They are logged by id, and the repair action handles them (§2.8.4).
4. **Never touched:** `billed` rows, and any row with invoice linkage.
5. **Logging and rollback.** Log counts per tenant. `down()` is a no-op, with a comment explaining why: the old values were invalid.

**Regeneration.** A migration cannot call the TypeScript materializers; no existing migration does. The arrears schedule (new key, `recurringServicePeriodKeys.ts:7` includes the due position) is refilled by:

- the existing sweeps: `replenishContractCadenceServicePeriodsSweep` (`contractCadenceServicePeriodMaterialization.ts:953`, registered in `server/src/lib/jobs/registerAllHandlers.ts:191`) and the client-cadence replenishment inside `createClientContractLineCycles` (`createBillingCycles.ts:273`, run by `server/src/lib/jobs/tenantPeriodMaintenance.ts`);
- the repair action below, which runs it immediately.

Generation for the new arrears schedule starts at the billed boundary (`contractCadenceServicePeriodMaterialization.ts:506-512`; `loadClientCadenceContractBilledBoundaries`, `clientCadenceScheduleRegeneration.ts:327-359`). So already-billed advance periods are never regenerated or double-billed.

#### 2.8.4 Repair action: make stranded activity billable again

This is TypeScript, because the arrears invoice window must come from the real window mappers. New function `repairArrearsOnlyLineSchedulesForTenant(trx, { tenant })` in `shared/billingClients/`, next to `repairAllClientCadenceServicePeriodsForTenant` (:725).

It is exposed in two places:

- folded into the existing tenant "Fix all" action `repairAllRecurringServicePeriodsForTenant` (`packages/billing/src/actions/recurringServicePeriodActions.ts:1130-1147`), which already requires the `regenerate` permission;
- a runbook step: ops runs it for each tenant that Q1/Q2 flagged, right after deploy.

It is idempotent: a second run is a no-op.

**What it does, per Hourly/Usage line:**

1. **Regenerate.** Call `syncRecurringServicePeriodsForContractLine` (`packages/billing/src/actions/recurringServicePeriodSync.ts:58`). This is the same path a UI timing change triggers, and it produces the arrears schedule from the billed boundary.
2. **Re-home `edited` / `skipped` advance rows.** For each, insert an arrears row for the same service period with:
   - `provenance_kind='repair'`
   - the same lifecycle state and edits
   - `supersedes_record_id` set to the old row

   Then supersede the old row. Repair provenance is preserved by regeneration (`regenerateRecurringServicePeriods.ts:118-129`).
3. **Catch-up rows for stranded periods.** For each **billed** advance period P on the line, insert one arrears row for P's service period with:
   - the arrears invoice window from the cadence's window mapper (`recurringTiming.ts:102-115`; for client cadence, the next client window)
   - `provenance_kind='repair'`
   - `reason_code='stranded_advance_catch_up'`
   - the new arrears `schedule_key`
   - `revision=1`

   Insert it only if P qualifies and either of these is true:
   - **`P.service_period_end > now`:** the period is still open, so more time will arrive. This is Ryan's October.
   - **Uninvoiced activity exists in P now**, by the loader predicates.

   **P qualifies when:**
   - **Chargeless** (`invoice_charge_detail_id IS NULL`): nothing was billed for this line in P, so re-reading P cannot double-bill.
   - **Charged, Hourly line with no bucket overlay, or additive Usage:** entry-level `time_entries.invoiced` / `usage_tracking.invoiced` flags (set at invoice time, `invoiceService.ts:291-296`, `:357-362`) mean the loader reads only entries that were never billed.
   - **Charged, with a bucket overlay or `period_total` usage:** **no automatic catch-up.** Bucket overage and period totals are computed per period, not per entry, so re-reading could double-bill. These periods are listed in the action's result for manual review. Q2/Q3 tell us whether any exist.

   **Why the catch-up row is safe to add:**
   - The billed advance row is **not modified**. Its invoice, linkage and audit trail stay exactly as they are; the brief requires "leaves already-invoiced periods untouched".
   - The catch-up row lives under the arrears schedule key, before the billed boundary. Regeneration never proposes a candidate there, so it cannot conflict.
   - When its window runs, the loader reads P's dates with `invoiced = false` and bills only stranded activity. Then the normal claim marks it billed.

**For Ryan's case:**

| Period | What happens |
|---|---|
| October | Billed $0 on Oct 1. Catch-up arrears row, window Nov 1–Dec 1 (client cadence) or starting Nov 1 (contract cadence). October time appears on the November invoice. |
| November onward | Regular arrears schedule. |

---

## 3. Order of work (each step its own commit; tests land with the step they cover)

1. **Stranding test (T1).** Write it against unchanged code and record the result in the PR description. This decides §2.8.4.
2. **Read-only count queries (Q1–Q3).** Hand them to ops; the counts go into the review packet. Nothing in later steps waits on them except the scope of §2.8.4 step 2/3.
3. **Shared rule module (§2.1)** plus moving `resolveRecurringChargeFamily`. Unit tests.
4. **Policy change (§2.2).** Required `lineType`, all callers, error class, error mappers. The compiler finds the callers.
5. **Copy paths (§2.3).**
6. **Engine backstop (§2.5).** Rewrite the existing tests that pin advance hourly/usage behaviour (§4.3).
7. **UI and copy (§2.6, §2.7)**, plus draft-resume precedence.
8. **Migration A** (§2.8.3) and the repair action (§2.8.4), with their tests.
9. **Migration B: CHECK constraints** (§2.4). Last, because it depends on step 8's data being clean.
10. **Smoke** with the `alga-billing-contract-smoke-testing` skill on the dev stack (`feature-block-in-advance-billing-on-hourly-usage-contrac.localhost:3948`): Ryan's repro end to end, the custom-line dialog, the inline edit, and the wizard with contract-wide advance.

---

## Runbook: post-deploy repair of stranded Hourly/Usage advance periods

Script: `server/scripts/repair-arrears-only-lines.ts`. One transaction per tenant, in this order: `repairArrearsOnlyLineSchedulesForTenant`, then `repairAllClientCadenceServicePeriodsForTenant`. Idempotent: a second run is a no-op.

**Prerequisites**

1. Migration A (`20261013120000_hourly_usage_lines_bill_in_arrears`) is applied. Migration B (CHECK constraints) is applied or not; the script does not depend on it.
2. The new application build is deployed (the repair and the Generate-page "Fix all" use the same code).
3. Run from a checkout of the deployed commit, with `DB_HOST`/`DB_PORT`/`DB_NAME_SERVER`, `DB_USER_ADMIN` and the `postgres_password` secret pointing at the target database (a direct Postgres connection; the script does not go through the app).

**Which tenants.** With no `--tenant`, the script discovers them itself with the Q1 and Q2 predicates (§2.8.1): any tenant with an Hourly/Usage `contract_lines` row at `billing_timing = 'advance'`, or an `advance` `recurring_service_periods` row on an Hourly/Usage line. Discovery is a per-table scan plus one tenant-filtered join per tenant; there is no cross-tenant join. After Migration A, Q1 returns 0 rows and Q2 does the work. Run Q1/Q2 by hand first (§2.8.1) and keep the counts.

**Commands** (from `server/`; `vite-node` rather than `tsx` because the `@alga-psa/*` workspace packages are ESM/webpack-targeted):

```bash
# 1. Dry run: executes the whole repair in the transaction, prints the summary, ROLLS BACK.
npx vite-node --config vitest.config.ts scripts/repair-arrears-only-lines.ts --dry-run
# 2. One tenant first (repeat --tenant for several):
npx vite-node --config vitest.config.ts scripts/repair-arrears-only-lines.ts --tenant=<tenant-id>
# 3. All flagged tenants:
npx vite-node --config vitest.config.ts scripts/repair-arrears-only-lines.ts
```

**Reading the output.** Per tenant it prints `arrearsOnlyLines` (`linesScanned`, `timingFlipped`, `advanceRowsSuperseded`, `rowsRehomed`, `catchUpRowsCreated`, `manualReview[]`) and `clientCadence` counts. A line `!! N item(s) need MANUAL REVIEW` means periods the repair refused to touch (charged advance periods with a bucket overlay or `period_total` usage, or a catch-up window that cannot be derived); decide those by hand (§2.8.4, §6). A tenant that fails rolls back alone, is listed at the end, and the process exits 1; the other tenants are unaffected.

**Verification** (per tenant, read-only, tenant-filtered):

```sql
-- no live advance periods left on Hourly/Usage lines (billed/superseded history is expected)
SELECT count(*) FROM recurring_service_periods rsp
  JOIN contract_lines cl ON cl.tenant = rsp.tenant AND cl.contract_line_id = rsp.obligation_id
 WHERE rsp.tenant = :tenant AND cl.contract_line_type IN ('Hourly','Usage')
   AND rsp.due_position = 'advance' AND rsp.lifecycle_state IN ('generated','locked','edited');
-- expect 0
-- no Hourly/Usage line still at advance
SELECT count(*) FROM contract_lines WHERE tenant = :tenant
   AND contract_line_type IN ('Hourly','Usage') AND billing_timing = 'advance';  -- expect 0
```

Then open Billing > Generate invoices for the tenant: the "service periods need repair" banner for stranded arrears-only lines must be gone, and the catch-up rows (`reason_code = 'stranded_advance_catch_up'`) appear as Ready arrears work. Re-running the script must report all zeros except `linesScanned`.

**Rollback / abort.**

- Abort before commit: `--dry-run` writes nothing; Ctrl-C mid-run rolls back the current tenant's transaction, and earlier tenants stay committed (they are independently valid).
- After commit: there is no automatic undo. Superseded advance rows keep `reason_code = 'hourly_usage_arrears_repair'` and are never deleted; catch-up rows carry `reason_code = 'stranded_advance_catch_up'` and `provenance_kind = 'repair'`. If a catch-up row must be withdrawn before it is invoiced, set that row to `superseded` for the one tenant; do not touch billed rows. Reverting Migration A is not supported once arrears invoices have been issued.

## 4. Tests (high value only)

### 4.1 Integration

Location: `server/src/test/integration/billingInvoiceTiming.integration.test.ts`. Reuse its helpers: `createHourlyContractLine` :5778, `createApprovedTimeEntryForContractLine` :6080, `upsertRecurringServicePeriodRecord` :6192, `loadRecurringServicePeriodRecords` :6337, `syncContractLineRecurringPeriods` :5733.

- **T1, stranding repro (written first, on unchanged code).**
  1. Advance Hourly line at $110/hr, monthly.
  2. Generate the October advance invoice on Oct 1 and assert it is $0 / nothing to bill.
  3. Log approved time on Oct 15.
  4. Generate the November invoice.
  5. Record whether the Oct 15 entry is billed. The expectation from reading the code: it is not, and the entry stays `invoiced=false`.

  After the fix, T1 becomes the repair test: run the repair action, generate the November invoice, and the Oct 15 time is billed once. Running the repair again changes nothing.
- **T2, Ryan's repro after the fix.** Hourly line at $110/hr, monthly, created through `createCustomContractLine`. Time logged in October appears on the November invoice. No "Nothing to bill" on Nov 1.
- **T3, wizard.** `createClientContractFromWizard` with contract-wide advance, one Fixed and one Hourly line: Fixed is `advance`, Hourly is `arrears`, and there is no error. The same check for `createContractTemplateFromWizard`.
- **T4, regeneration.** A line stored as `advance` (inserted by raw SQL, bypassing the policy) regenerates with `due_position='arrears'` windows, for both client and contract cadence.
- **T5, Migration A.**
  - Seed an advance Hourly line with a billed (chargeless) October row, a billed (charged) September row, and future `generated` advance rows.
  - After the migration: the line is arrears, the future rows are superseded, and both billed rows are byte-for-byte unchanged, including invoice linkage.
  - After the repair: arrears rows from the billed boundary, plus one catch-up row for October. The total invoiced across all invoices equals the logged time, with nothing billed twice.

### 4.2 Write paths (unit or integration as each file's existing tests do)

- **T6, explicit advance is rejected.** Each path rejects explicit advance on Hourly/Usage with `ContractLineTimingNotAllowedError`, surfaced as a user-facing message:
  - `createCustomContractLine`
  - `updateContractLine` (inline edit)
  - the template line edit via `updateContractLineRate` / `updateContractLineAssociation`
  - `ContractLinePreset.create`
  - for REST, the `update` path with `contract_line_type` set: a type change resets timing. REST cannot send `billing_timing`; assert a 400 if that ever changes.
- **T7, type change resets timing.** Fixed+advance → Hourly via `updateContractLine` and via REST PUT: the stored timing becomes `arrears`.
- **T8, copies normalise.**
  - `copyPresetToContractLine` from a stale advance Hourly preset gives an arrears line, with no error.
  - `cloneTemplateLineToContract` from a stale advance Hourly template line gives an arrears line.
- **T9, constraint.** Migration B: a raw insert of Hourly+advance fails. Run in the Citus CI smoke job.

### 4.3 Existing tests that must change

These create Hourly/Usage lines with `billingTiming: 'advance'` in `billingInvoiceTiming.integration.test.ts`:

- lines 1193, 1284, 1355, 1430, 1581, 1662, 1756, 1846, 1920, 2001/2012, 2082, 2133, 2177, 5339/5348, 5427, 5476
- including T069 (:1177), which pins advance hourly billing
- and T070 (:1268), which pins the defect itself: "produce no recurring invoice line while preserving due-window identity"

Each is rewritten to arrears semantics or deleted where it only tested the forbidden case. The review packet lists every change and why.

---

## 5. Out of scope

- The Prepaid Block contract line (card 737bde61), which is what Ryan actually needs.
- The Sell-block coverage warning (separate card).
- Pool copy and wizard fixes for buckets.
- Releasing billed periods on invoice **void** (`voidInvoiceActions.ts` never touches `recurring_service_periods`). It is a real gap, but it is independent of this card.
- Late-approved time in ordinary **arrears** Hourly periods. The same date-bounded loader means time approved after its arrears window was billed is also never picked up. Noted here as a follow-up; not changed.
- The EE contract simulator timing select (§2.6). Follow-up.
- Extracting a single contract-line copy primitive (§2.3 `LEVERAGE` marker).

---

## 6. Risks and open questions

1. **Two rows for one service period on a line.** Today a line normally has exactly one row per service period (one schedule key). A catch-up arrears row next to a billed advance row breaks that assumption, and duplicate detection, due-work listing, the coverage audit or the Recurring Service Periods tab may not expect it. T1/T5 must drive the real invoice generation path (`invoiceGeneration.ts:4085-4095`), and the implementer must read `recurringDueWork.ts` and the duplicate detector before relying on it. **Fallback if it breaks:** for chargeless billed rows only, release them in place with the `releaseRecurringServicePeriodInvoiceLinkageForInvoice` shape (`invoiceModification.ts:624-642`) instead of adding a sibling row. The invoice has no charge backing that period, so nothing invoiced changes, but the period's link to its invoice is lost. This needs the captain's sign-off, because it modifies a billed row.
2. **Bucket overlays and `period_total` usage on charged advance periods** are not auto-repaired (§2.8.4). If Q2/Q3 show any, the captain decides between manual credit/rebill and extra repair logic.
3. **Window between deploy and running the repair.** Migration A supersedes every due advance row, so no wrong invoice can be produced in that window. The arrears rows appear on the next replenishment sweep or when the repair runs. Until then the line has no due window, which is safe but delays billing. The runbook says to run the repair per flagged tenant immediately after deploy.
4. **Product timing.** §2.1 widens `upsertContractLineTerms` to allow advance on Product lines, so there is one rule. Flag this in review.
5. **Explicit-advance rejection after deploy.** Clients that send `billing_timing` from a stale form state for an Hourly line would now get an error instead of a saved value. The UI changes in §2.6 send arrears for non-Fixed lines, so only a browser tab opened before the deploy is affected, and it gets a clear message.
6. **Citus.** The constraint migration must be separate from the data migration, every UPDATE must carry `tenant`, and values must be bound in Node. Covered by the CI Citus smoke job.
