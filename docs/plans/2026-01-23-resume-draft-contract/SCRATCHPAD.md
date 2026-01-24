# Scratchpad — Resume Draft Contract

- Plan slug: `resume-draft-contract`
- Created: `2026-01-23`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-01-23) Resume flow starts at Step 1 — user confirmed they want to review from the beginning when resuming a draft.
- (2026-01-23) Drafts in separate tab — dedicated "Drafts" tab alongside Templates and Client Contracts.
- (2026-01-23) No auto-save — manual save only via "Save Draft" button.
- (2026-01-23) Discard with confirmation — explicit "Discard Draft" action with confirmation dialog.

## Discoveries / Constraints

- (2026-01-23) Draft functionality already exists at DB level:
  - `contracts.status` has `'draft'` value
  - `createClientContractFromWizard` accepts `isDraft` option
  - `handleSaveDraft()` exists in ContractWizard.tsx (lines 381-420)
  - `is_active: false` + `status: 'draft'` for draft contracts

- (2026-01-23) Key files:
  - Contract Wizard: `packages/billing/src/components/billing-dashboard/contracts/ContractWizard.tsx`
  - Contracts List: `packages/billing/src/components/billing-dashboard/contracts/Contracts.tsx`
  - Wizard Actions: `packages/billing/src/actions/contractWizardActions.ts`
  - Contract Actions: `packages/billing/src/actions/contractActions.ts`
  - Contract Model: `packages/billing/src/models/contract.ts`

- (2026-01-23) Current wizard state interface `ContractWizardData` already has:
  - `contract_id?: string` — set when draft is saved
  - `is_draft?: boolean` — draft indicator
  - `template_id?: string` — template reference

- (2026-01-23) Contracts.tsx has two tabs: Templates and Client Contracts — we'll add a third "Drafts" tab

- (2026-01-23) Existing contract update blocks setting status to 'draft' if contract has invoices (contractActions.ts:293-299)

- (2026-01-24) Contracts page now has third subtab `drafts`:
  - Added URL mapping for `subtab=drafts` and a placeholder Drafts tab view in `packages/billing/src/components/billing-dashboard/contracts/Contracts.tsx`
  - Next: wire Drafts tab to real data/actions + resume/discard UX

- (2026-01-24) Draft count badge added to Drafts tab:
  - Uses existing loaded `clientContracts` and counts `status === 'draft'`
  - Badge is hidden when count is 0 (will align with later acceptance/test expectations)

- (2026-01-24) Added server action `getDraftContracts()`:
  - Location: `packages/billing/src/actions/contractActions.ts`
  - Query joins `contracts` + `client_contracts` + `clients` (and template name), filters by tenant + `status='draft'`, orders by `updated_at desc`

- (2026-01-24) Drafts tab now renders a Drafts DataTable with Contract Name column:
  - Draft data fetched via `getDraftContracts()` in `packages/billing/src/components/billing-dashboard/contracts/Contracts.tsx`
  - Added search input + localized date rendering (will be broken out into checklist items as we complete them)

- (2026-01-24) Drafts table includes Client column (`client_name`).

- (2026-01-24) Drafts table includes Created column (localized date).

- (2026-01-24) Drafts table includes Last Modified column (localized date).

- (2026-01-24) Drafts table includes Actions dropdown with Resume/Discard placeholders.

- (2026-01-24) Drafts table default-sorts by Last Modified (updated_at desc) and supports header sorting via DataTable.

- (2026-01-24) Drafts tab search filters by contract name.

- (2026-01-24) Drafts tab search filters by client name.

- (2026-01-24) Drafts tab uses standard DataTable pagination + items-per-page controls.

- (2026-01-24) Drafts tab shows empty state when there are no draft contracts.

- (2026-01-24) Added `getDraftContractForResume(contractId)` to load full wizard data from a draft:
  - Location: `packages/billing/src/actions/contractWizardActions.ts`
  - Validates `contracts.status === 'draft'`, then maps contract + client_contract + contract lines/services/configs into `DraftContractWizardData`

- (2026-01-24) Resume flow wired from Drafts table:
  - Drafts Actions → Resume calls `getDraftContractForResume()`, then opens `ContractWizard` with `editingContract` data.
  - Updated `ContractWizard` to re-initialize state when `open`/`editingContract` change (was previously only using initial props once).

- (2026-01-24) Resume always opens wizard on Step 1 (Contract Basics) by resetting `currentStep` to 0 on open.

- (2026-01-24) Resumed drafts pre-populate all wizard steps using `getDraftContractForResume()` mapping (lines/services/configs).

- (2026-01-24) Wizard now upserts drafts instead of creating duplicates:
  - `ClientContractWizardSubmission` includes optional `contract_id`
  - `createClientContractFromWizard()` updates existing draft when `contract_id` is provided (clears old lines/configs + rewrites in a transaction)

- (2026-01-24) Completing a resumed draft activates in-place:
  - `createClientContractFromWizard()` transitions updated draft to `status='active'` / `is_active=true` when called without `isDraft`

- (2026-01-24) Discard draft flow now uses a confirmation dialog including contract + client names.

- (2026-01-24) Discard confirmation includes Cancel + Discard actions (ConfirmationDialog).

## Commands / Runbooks

- Run billing package tests: `npm test -w packages/billing`
- Run server dev: `npm run dev -w server`

## Links / References

- PRD: [./PRD.md](./PRD.md)
- Contract Wizard: `packages/billing/src/components/billing-dashboard/contracts/ContractWizard.tsx`
- Contracts List: `packages/billing/src/components/billing-dashboard/contracts/Contracts.tsx`
- Wizard Actions: `packages/billing/src/actions/contractWizardActions.ts`

## Open Questions

- (None currently — key decisions made during planning)
