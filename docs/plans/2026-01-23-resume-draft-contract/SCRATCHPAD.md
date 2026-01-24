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

- (2026-01-24) Discard confirmation calls `deleteContract(contractId)` and shows toast success/error.

- (2026-01-24) Drafts list refreshes after discard by calling `fetchContracts()` (badge count updates too).

- (2026-01-24) Draft queries are tenant-scoped:
  - `getDraftContracts()` and `getDraftContractForResume()` filter by `{ tenant }`
  - Draft updates via `createClientContractFromWizard()` update path are tenant-scoped

- (2026-01-24) Permissions:
  - Resuming drafts (`getDraftContractForResume`) requires `billing:create` + `billing:update` (unless `E2E_AUTH_BYPASS=true`)
  - Discarding drafts (`deleteContract`) requires `billing:delete` (unless `E2E_AUTH_BYPASS=true`)

## Commands / Runbooks

- Run billing package tests: `npm test -w packages/billing`
- Run server dev: `npm run dev -w server`

- (2026-01-24) Tests:
  - Added `packages/billing/tests/contractsTabs.test.ts` to assert the contracts tabs config includes Templates / Client Contracts / Drafts.
  - Extracted tab label mapping into `packages/billing/src/components/billing-dashboard/contracts/contractsTabs.ts` for unit testing without DOM.
  - Extended `packages/billing/tests/contractsTabs.test.ts` to assert Drafts label maps to `subtab=drafts`.
  - Added `getDraftTabBadgeCount()` helper + test to assert Drafts badge appears when count > 0.
  - Added a test asserting badge behavior as count changes (0 → 1) to represent badge updates after draft creation.
  - Added a test asserting badge hides when count returns to 0 (represents update after discard).
  - Badge hidden at 0 is asserted via `getDraftTabBadgeCount(0) === null`.
  - Added `packages/billing/tests/draftContractsActions.test.ts` to unit test `getDraftContracts()` query constraints (status/tenant/select/order).
  - (2026-01-24) Added `packages/billing/tests/draftContractsTable.test.tsx` and implemented T012 to assert draft contract names render in the Drafts DataTable (forces DataTable width in jsdom so non-Actions columns are visible).
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T013 to assert client names render in the Drafts DataTable.
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T014 to assert created dates render via `toLocaleDateString()`.
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T015 to assert updated dates render via `toLocaleDateString()`.
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T016 to assert each draft row renders an actions menu trigger.
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T017 to assert the actions menu includes a Resume option.
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T018 to assert the actions menu includes a Discard option.
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T019 to assert Drafts table headers trigger sorting (initial `updated_at desc` then `contract_name asc` on click).
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T020 to assert draft search filters by contract name.
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T021 to assert draft search filters by client name.
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T022 to assert draft search is case-insensitive.
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T023 to assert Drafts table pagination renders (multiple pages when > page size).
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T024 to assert Drafts pagination can navigate to page 2.
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T025 to assert Drafts empty state renders when there are no drafts.
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T026 to assert Drafts empty state messaging prompts saving drafts.
  - (2026-01-24) Added `packages/billing/tests/draftContractForResumeActions.test.ts` and implemented T027 to unit test `getDraftContractForResume()` returns core wizard data for a draft contract.
  - (2026-01-24) Refactor to keep unit tests lightweight:
    - Added `@alga-psa/auth/withAuth` export + Vitest alias so billing actions can import `withAuth` without importing the full `@alga-psa/auth` entrypoint (which pulls in NextAuth/UI modules in source form).
    - Updated `packages/billing/src/actions/contractActions.ts` + `packages/billing/src/actions/contractWizardActions.ts` to import `withAuth` from `@alga-psa/auth/withAuth`.
    - In resume tests, mocked `@alga-psa/auth/getCurrentUser` to avoid NextAuth session code paths when loading billing models.
  - (2026-01-24) Extended `packages/billing/tests/draftContractForResumeActions.test.ts` and implemented T028 to assert contract lines map into wizard service arrays.
  - (2026-01-24) Extended `packages/billing/tests/draftContractForResumeActions.test.ts` and implemented T029 to assert service configuration fields (rates, unit_of_measure, bucket overlays) map into resume payload.
  - (2026-01-24) Extended `packages/billing/tests/draftContractForResumeActions.test.ts` and implemented T030 to assert non-draft contracts cannot be resumed.
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T031 to assert clicking Resume opens the wizard dialog (via mocked `ContractWizard`).
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T032 to assert the Resume flow passes draft data into the wizard (contract_id/client_id/contract_name).
  - (2026-01-24) Extended `packages/billing/tests/draftContractsTable.test.tsx` and implemented T049 to assert clicking Discard opens the confirmation dialog.
  - (2026-01-24) Added `packages/billing/tests/contractWizardResume.test.tsx` and implemented T033 to assert resuming a draft starts the wizard on Step 1 (Contract Basics) without rendering later steps.
  - (2026-01-24) Extended `packages/billing/tests/contractWizardResume.test.tsx` and implemented T034 to assert Contract Basics step receives the draft client selection.
  - (2026-01-24) Extended `packages/billing/tests/contractWizardResume.test.tsx` and implemented T035 to assert Contract Basics step receives the draft contract name.
  - (2026-01-24) Extended `packages/billing/tests/contractWizardResume.test.tsx` and implemented T036 to assert Contract Basics step receives the draft dates.
  - (2026-01-24) Extended `packages/billing/tests/contractWizardResume.test.tsx` and implemented T037 to assert Fixed Fee step receives pre-populated fixed services when navigating forward from basics.
  - (2026-01-24) Extended `packages/billing/tests/contractWizardResume.test.tsx` and implemented T038 to assert Products step receives pre-populated product services when navigating forward.
  - (2026-01-24) Extended `packages/billing/tests/contractWizardResume.test.tsx` and implemented T039 to assert Hourly step receives pre-populated hourly services when navigating forward.
  - (2026-01-24) Extended `packages/billing/tests/contractWizardResume.test.tsx` and implemented T040 to assert Usage step receives pre-populated usage services when navigating forward.
  - (2026-01-24) Extended `packages/billing/tests/contractWizardResume.test.tsx` and implemented T041 to assert Review step receives the full draft payload when navigating forward.
  - (2026-01-24) Extended `packages/billing/tests/contractWizardResume.test.tsx` and implemented T042 to assert Save Draft submits `contract_id` + `{isDraft:true}` when resuming.
  - (2026-01-24) Extended `packages/billing/tests/contractWizardResume.test.tsx` and implemented T043 to assert Save Draft keeps the existing `contract_id` (preventing duplicate creation).
  - (2026-01-24) Extended `packages/billing/tests/contractWizardResume.test.tsx` and implemented T044 to assert Save Draft reports the same `contract_id` via `onComplete`.
  - (2026-01-24) Extended `packages/billing/tests/contractWizardResume.test.tsx` and implemented T045 to assert finishing a resumed draft calls `createClientContractFromWizard` without `{isDraft:true}` (activation path).
  - (2026-01-24) Extended `packages/billing/tests/contractWizardResume.test.tsx` and implemented T046 to assert finishing a resumed draft does not pass `{isDraft:true}` (meaning `is_active` is set true in the action).
  - (2026-01-24) Added `packages/billing/tests/contractsActivationFlow.test.tsx` and implemented T047 to assert a resumed/activated contract disappears from Drafts after wizard completion + refresh.
  - (2026-01-24) Extended `packages/billing/tests/contractsActivationFlow.test.tsx` and implemented T048 to assert activated contracts appear in Client Contracts after switching tabs.

## Links / References

- PRD: [./PRD.md](./PRD.md)
- Contract Wizard: `packages/billing/src/components/billing-dashboard/contracts/ContractWizard.tsx`
- Contracts List: `packages/billing/src/components/billing-dashboard/contracts/Contracts.tsx`
- Wizard Actions: `packages/billing/src/actions/contractWizardActions.ts`

## Open Questions

- (None currently — key decisions made during planning)
