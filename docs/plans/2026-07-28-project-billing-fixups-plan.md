# Project Billing Fixups — Implementation Plan

**Date:** 2026-07-28
**Branch:** `fix/project-billing-fixups`
**Status:** Approved design, ready for implementation
**Supersedes (in part):** `docs/plans/2026-07-15-project-billing-design.md` line 167 — "`total_price` edits re-validate the schedule" is revised by this plan; total edits now leave frozen entries untouched (see Workstream B).

## Context

Field-testing the project billing system surfaced four problems:

1. **Currency is hardcoded to USD** across the project billing UI.
2. **Editing a fixed-price project's `total_price` silently changes already-approved/invoiced line items.** Amounts for percentage-based schedule entries are derived at read time (`computeEntryAmounts`), so a total edit re-derives every percentage entry everywhere it renders — including entries already invoiced — and past invoices no longer match the schedule. The cent-rounding remainder is also absorbed by the last non-canceled entry regardless of status, so even invoiced entries can shift by a cent.
3. **Add-on (scope-change) work is painful:** adding a new amount-based entry over-allocates the schedule, approval of the final entry hard-blocks, and the operator must separately bump the total in the Terms dialog — which triggers problem 2.
4. **Products (project materials) never reach fixed-price project invoices:** `billingEngine.ts` deliberately drops all material charges when generating a standalone invoice for a non-T&M project. (The original "products not showing" report was partly a wrong-screen confusion — the Billing dashboard → Products tab is the catalog — but this generation bug is real and confirmed in scope.)

## Settled design decisions

- **Freeze at approval.** Approving a schedule entry snapshots its computed amount onto the entry. Invoice generation bills exactly the frozen figure. `total_price` edits recalculate only `pending`/`ready` entries. Un-approving (approved → ready) thaws the snapshot. Invoiced dollars are immutable; *percentages* are what flex — a frozen entry's displayed percentage re-derives from `frozen amount / current total`.
- **Add-on flow:** the add-entry dialog gains an "Increase project total by this amount" option; creating the entry bumps `total_price` atomically in the same transaction. The total remains the anchor of the model — no derived-total inversion.
- **Products bill in addition to the fixed fee.** Fixed fee covers scope/labor; materials are pass-through charges on the project invoice.
- **Project Billing view gains a materials/products section** (qty × rate, billed/unbilled status) so an operator can verify what will hit the invoice.

---

## Workstream A — Currency correctness

**Problem root:** `formatCents` in `packages/core/src/lib/projectBillingStatus.ts:17-19` passes `undefined` locale (falls through to `en-US`) and `currency ?? 'USD'`. Every project-billing component uses it.

**Fix pattern:** the app already mounts `CurrencyFormatProvider` with the tenant default currency (`server/src/app/msp/MspLayoutClient.tsx:213`, client portal at `ClientPortalLayoutClient.tsx:45`). Components switch to `useCurrencyFormat()` → `money(cents, config.currency ?? undefined)` — locale-aware, tenant-default fallback instead of USD.

**Changes:**

1. Replace `formatCents` usage with `useCurrencyFormat().money(...)` in all components under `packages/billing/src/components/project-billing/`:
   - `ProjectBillingView.tsx` (also `:208` `currencyFractionDigits(currency ?? 'USD')`, `:222` `toMinorUnits(..., currency ?? 'USD')`, `:244` label `({currency ?? 'USD'})` — use the resolved currency from the provider when config currency is null)
   - `ScheduleTable.tsx`, `ScheduleEntryDialog.tsx`, `BudgetVsActualCard.tsx`, `DeliveryEconomicsCard.tsx`, `ProjectBilledBar.tsx`, `CapPanel.tsx`, `PhaseRateOverridesEditor.tsx`
2. `BillingSetupWizard.tsx:54` — initial currency state must be the tenant default (from `useCurrencyFormat()` / `getTenantDefaultCurrencyCode`), not `'USD'`; `resolveClientBillingCurrency(clientId)` still overrides when a client is set.
3. `packages/billing/src/components/billing-dashboard/invoicing/ProjectBillingReviewTab.tsx:355` — replace the hardcoded `/ 100` with fraction-digit-aware minor-unit conversion (`useCurrencyFormat().money` takes cents directly); removes the JPY/BHD breakage.
4. `packages/core/src/lib/projectBillingStatus.ts` — leave `formatCents` for non-React callers if any remain, but remove the `?? 'USD'` default: require the caller to pass a currency (or accept a locale + currency pair). Grep for remaining call sites; delete the helper if the React migration empties them.
5. `packages/client-portal/src/components/projects/ProjectBillingSummarySection.tsx:47-48` — replace `?? 'USD'` with tenant default via the client-portal `CurrencyFormatProvider`.

**Acceptance:** with a tenant/client currency of EUR and no explicit config currency, every project-billing surface renders €-formatted amounts in the user's locale; no literal `'USD'` fallbacks remain in `packages/billing/src/components/project-billing/`.

---

## Workstream B — Freeze approved/invoiced entries

### B1. Schema

New migration `server/migrations/<ts>_add_frozen_amount_to_project_billing_schedule_entries.cjs`:

- `ALTER TABLE project_billing_schedule_entries ADD COLUMN frozen_amount bigint NULL;` — nullable add, Citus-safe (no default, no rewrite). Follow `citus-migration-gotchas` conventions; all backfill UPDATEs must include `tenant` in join conditions.
- **Backfill:**
  - `status = 'invoiced'`: set `frozen_amount = invoice_charges.net_amount` joined via `(tenant, invoice_charge_id)`.
  - `status = 'approved'`: set `frozen_amount` = current computed amount, i.e. `amount` when set, else `round(percentage × total_price)` from the joined config — SQL reproduction of `computeEntryAmounts`' base math (largest-remainder correction is unnecessary for backfill; per-entry rounding is acceptable and the allocation validator tolerates cent drift with a warning).
- CHECK constraint: `(status IN ('approved','invoiced')) = (frozen_amount IS NOT NULL)` — add as `NOT VALID` + `VALIDATE` if Citus complains, or enforce in model code only if the distributed CHECK is problematic (implementer verifies against Citus; model-level enforcement is the fallback and must then be tested).

### B2. Write paths (`packages/billing/src/actions/projectBillingScheduleActions.ts`, `packages/billing/src/models/projectBillingScheduleEntry.ts`)

- **Approve** (`ready → approved`): inside the existing transaction, compute the entry's current amount via `computeEntryAmounts` and persist it to `frozen_amount` atomically with the status transition.
- **Un-approve** (`approved → ready`): null out `frozen_amount`.
- **Invoice** (`approved → invoiced`, `invoiceGeneration.ts:405-465` `persistProjectScheduleCharges`): bill `frozen_amount`, carry it through unchanged. The charge builder in `billingEngine.ts:1382-1475` must consume `frozen_amount` for approved entries instead of the freshly derived amount.
- **Unfinalize** (`invoiced → approved`): keep `frozen_amount` (it was approved at that figure).

### B3. Derivation (`packages/billing/src/services/projectBillingService.ts`)

`computeEntryAmounts` (`:96-132`) changes:

- Entries with `frozen_amount != null` return it as `computed_amount`; they do not participate in percentage derivation.
- Percentage math for unfrozen entries still derives from the **full** `total_price` (a 10% entry of a $20k project is $2k regardless of what's frozen) — freezing changes *when* the number is locked, not the base it is computed from.
- **Rounding-remainder absorption (`:110-120`) must only ever adjust an unfrozen entry.** Absorb into the last non-canceled *unfrozen* entry; if every entry is frozen, no absorption.
- `validateAllocation` (`:134-159`): allocated sum = Σ frozen amounts + Σ derived unfrozen amounts, compared against `total_price` as today (warning + final-entry block unchanged).
- **Displayed percentage** for a frozen entry re-derives as `frozen_amount / total_price` (display-only; the stored `percentage` column is left untouched so a thaw restores the original allocation intent). `ScheduleTable.tsx` renders the derived display percentage for frozen rows, with a lock indicator (small lock icon + tooltip "Amount locked at approval").

### B4. Total-edit guardrails (`packages/billing/src/actions/projectBillingConfigActions.ts:461-535`)

- **Block** a `total_price` edit that would make `total_price < Σ frozen_amount` (you cannot shrink the budget below what's already locked). Clear error message naming the frozen sum.
- Keep the existing allocation *warning* for other mismatches, and **surface it**: `TermsDialog.handleSave` (`ProjectBillingView.tsx:213-236`) currently ignores `allocation_warning` — show it as a warning toast / inline notice after save.
- The Terms dialog gains a small readout when frozen entries exist: "N entries totaling X are locked and will not change."

### B5. Tests

- Revise `packages/billing/src/actions/projectBillingActions.contract.test.ts` **T003** (`:359-366`): total edits still warn on mismatch, but add cases: (a) frozen entries' computed amounts do not move on total edit; (b) reduction below frozen sum is rejected.
- Extend **T004** (`:398`): frozen invariants — approve snapshots, un-approve thaws, remainder absorption never touches a frozen entry.
- Unit tests for `computeEntryAmounts` mixed frozen/unfrozen schedules, all-frozen schedule, display-percentage derivation.
- Migration backfill test (invoiced entry backfills from `invoice_charges.net_amount`; approved entry from percentage math).

---

## Workstream C — Add-on entries that grow the total

**Change:** `ScheduleEntryDialog.tsx` — for **amount-based** entries in create mode, add a checkbox: **"Increase project total by this amount"** (default unchecked; helper text: "For add-on / scope-change work. The project total increases and existing percentage allocations are recalculated against the new total.").

**Server:** `createScheduleEntry` (`projectBillingScheduleActions.ts:265-324`) accepts `increase_total: boolean` (schema change in `packages/billing/src/schemas/`). When set:

- Only valid with `amount` entries (reject for percentage entries — a percentage add-on of a total it itself changes is circular).
- In the same transaction: insert the entry, then `total_price += amount` via the config model. Reuse/refactor the config-update internals so the frozen-sum guard and audit trail apply; do not duplicate the update logic inline.
- Return the updated config alongside the entry so the UI refreshes total + allocation footer in one round trip.

**Effect with Workstream B:** frozen entries don't move; unfrozen percentage entries re-derive against the larger total; schedule stays reconciled with zero manual steps.

**Tests:** contract test — create add-on entry with `increase_total`, assert new total, unchanged frozen amounts, re-derived unfrozen percentages, and atomicity (entry-insert failure rolls back the total bump).

---

## Workstream D — Products (materials) on fixed-price project invoices

### D1. Stop dropping material charges

`packages/billing/src/lib/billing/billingEngine.ts:1053-1068`: remove the `billing_model !== "time_and_materials" → []` branch for `projectTarget` runs. Material charges for the target project are always calculated and included on standalone project invoices, regardless of billing model. (Recurring-mode behavior for non-project runs is unchanged.)

### D2. Currency-mismatch drop becomes visible

`calculateProductCharges` (`billingEngine.ts:4756-4776`) filters `pm.currency_code = billingCurrency`, silently discarding mismatched materials; the mark-as-billed pass (`invoiceGeneration.ts:2777-2789`) repeats the filter with an `|| 'USD'` fallback. Minimal correct fix in this branch:

- Keep the filter (no FX conversion in scope), but detect and **surface** mismatches: the generation result gains a warning listing skipped materials ("N materials in <currency> were skipped — invoice currency is <currency>"), rendered wherever generation results/toasts already appear.
- Remove the `|| 'USD'` fallback in the mark-as-billed pass; use the invoice's currency exactly.

### D3. Materials section in the project Billing view

New component `packages/billing/src/components/project-billing/ProjectMaterialsCard.tsx`, rendered in `ProjectBillingView.tsx` for both billing models:

- Data: `listProjectMaterials` (`packages/projects/src/actions/materialCatalogActions.ts:91-109`) — already permission-checked (`project:read`). Expose it to the billing package via the existing projects↔billing integration seam (`ProjectBillingIntegrationContext` / `MspProjectBillingIntegrationProvider`) if a direct import crosses package boundaries.
- Columns: product name, qty × rate, extended amount (Workstream A currency formatting), status chip (billed → link to invoice via `billed_invoice_id`, else "Unbilled"), and a currency badge when a material's `currency_code` differs from the project billing currency (pre-empting the D2 skip).
- Read-only in v1: add/edit stays in the existing `ProjectMaterialsDrawer` off the project header; the card links to it ("Manage products").

**Tests:** billing-engine test — fixed-price project with approved milestone + attached material generates an invoice containing both charge types; currency-mismatch material produces the warning and is not marked billed; playwright/integration coverage extends `ee/server/src/__tests__/integration/project-billing.playwright.test.ts` if the harness already exercises the billing view.

---

## Sequencing

1. **A (currency)** — independent, lowest risk, do first.
2. **B (freeze)** — schema + engine core; everything else layers on it.
3. **C (add-on)** — depends on B's config-update guardrails.
4. **D (products)** — D1/D2 independent of B/C; D3 shares the billing-view surface with A. Do after A to inherit currency formatting.

Docs: update `docs/plans/2026-07-15-project-billing-design.md` §total-edit semantics (line 167) and the PRD data model (`ee/docs/plans/2026-07-15-project-billing/PRD.md` §6) to describe `frozen_amount`, freeze-at-approval, and add-on entries.

## Risks / notes

- **Citus:** the new column is a plain nullable add (safe); backfill UPDATEs must be tenant-scoped joins; validate the CHECK constraint approach on a distributed table before relying on it (model-level fallback specified in B1).
- **Existing data:** environments already have approved/invoiced entries; the backfill makes freeze semantics apply retroactively. An invoiced entry whose derived amount had already drifted from its `invoice_charges.net_amount` will *change displayed value* to the (correct) invoiced figure — this is the intended repair, but worth a release note.
- **`formatCents` external callers:** grep before deleting; PDF/email invoice templates may use it outside React where the hook is unavailable — those need the locale+currency passed explicitly.
- **Out of scope:** FX conversion for mismatched-currency materials; derived-total model inversion; percent-complete progress billing (PRD non-goal); write operations in the new materials card.
