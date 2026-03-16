# Scratchpad — Client-Owned Contracts Simplification

- Plan slug: `client-owned-contracts-simplification`
- Created: `2026-03-16`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also update earlier notes when a decision changes or an open question is resolved.

## Decisions

- (2026-03-16) Target model: keep `contracts`, but make every non-template contract client-owned; templates remain the only reusable contract-definition layer.
- (2026-03-16) Invariant choice: one owning client per non-template contract, not one assignment row ever.
- (2026-03-16) Enforcement choice: add `contracts.owner_client_id` instead of inferring ownership only from `client_contracts`.
- (2026-03-16) Migration strategy for shared contracts with invoice history: preserve the original `contract_id` on the invoiced assignment and clone for the other assignment(s).
- (2026-03-16) Migration strategy for shared contracts without invoice history: preserve the original `contract_id` on the earliest-starting assignment and clone for the other assignment(s).
- (2026-03-16) Scope choice: this pass includes the data migration plus backend guardrails and targeted UI/reporting cleanup needed to stop reinforcing the shared-contract model.
- (2026-03-16) First implementation batch landed the owner-client invariant in creation/assignment code before the shared-contract split migration: nullable schema column first, code guardrails now, stricter DB not-null/backfill later once migrated data is safe.
- (2026-03-16) Legacy `/contracts` API create path should fail at validation/service time when `owner_client_id` is absent, not silently create another shareable non-template header.

## Discoveries / Constraints

- (2026-03-16) Billing engine already reads through `client_contracts -> contracts -> contract_lines` and filters by assignment truth (`cc.is_active`, assignment dates), which is compatible with the target model as long as cross-client sharing is eliminated.
- (2026-03-16) `ClientContractsTab` currently renders status from `contracts.status`, which is why live UI can disagree with billing behavior.
- (2026-03-16) `contracts` and `client_contracts` both currently carry lifecycle-ish fields, and reports still read “active contracts” from `contracts.is_active`.
- (2026-03-16) Schema currently does not prevent a single non-template `contract_id` from being linked to multiple clients.
- (2026-03-16) The contract wizard already behaves like contracts are client-specific instantiated records and includes a comment that old replication became redundant because contracts are “already client-specific via client_contracts.”
- (2026-03-16) Direct/legacy backend paths still need explicit owner-client guardrails:
  - `packages/billing/src/actions/contractActions.ts#createContract` forwards raw non-template contract creation without owner semantics.
  - `server/src/lib/api/services/ContractLineService.ts#createContract` inserts raw `contracts` rows directly.
  - `packages/clients/src/actions/clientContractActions.ts#createClientContract` validates contract existence and active state but not client ownership.
  - `packages/billing/src/actions/renewalsQueueActions.ts#createRenewalDraftForQueueItem` inserts draft `contracts` rows directly and must carry owner client onto the draft.
- (2026-03-16) Contract-backed client line helpers in both billing and clients packages still derive lines by joining `client_contracts` to `contract_lines` on `contract_id`; they become safe only once shared non-template contracts are eliminated and owner-client enforcement exists.
- (2026-03-16) `ContractDetail` and `ContractDetailSwitcher` still use `contractId` as the primary live-contract identity and show assignment status from `contract.status`, so detail routing and status presentation both reinforce the old shared-contract model.
- (2026-03-16) `ClientContractsTab` and the top-level `Contracts` hub both mutate live state through `updateContract(...status...)`, so assignment lifecycle actions are still wired to contract-header status changes.
- (2026-03-16) Client portal document visibility for contract-linked documents still resolves ownership by joining `document_associations -> contracts -> client_contracts`, so this path needs an explicit regression check after shared contracts are split.
- (2026-03-16) Production has 5 inactive `client_contracts` rows remaining after flipping the previously investigated ConnectWise row active; none of those appear to be historical predecessors of currently active rows.
- (2026-03-16) Production has exactly 2 genuinely shared non-template contracts with multiple contract lines and multiple distinct client assignments:
  - `Managed IT Services` in tenant `Cross Industries, LLC`
  - `Worry-Free Essentials` in tenant `WorryNot Works IT Services`
- (2026-03-16) Accurate blast radius for the two known shared contracts:
  - both have 2 client assignments and 2 contract lines
  - neither has pricing schedules
  - neither has document associations
  - neither has direct `time_entries` or `usage_tracking` tied to those contract-line IDs
  - only `Managed IT Services` has invoice history, and only on the `The Green Thumb` assignment
- (2026-03-16) `ContractDialog`, `createClientContractFromWizard`, and `createRenewalDraftForQueueItem` were all writing raw `contracts` rows without `owner_client_id`; those paths now stamp the client owner explicitly.
- (2026-03-16) `ClientContract.assignContractToClient` and `createClientContract` needed separate ownership checks because they do not share a single repository helper today.
- (2026-03-16) `updateClientContract` already ignored `contract_id` changes; guardrail now rejects cross-client repoint attempts explicitly instead of silently dropping them.

## Commands / Runbooks

- (2026-03-16) Find the billing-engine contract-line resolution path:
  - `rg -n "getClientContractLinesAndCycle|Found .* contract lines for client|client_contracts as cc" packages/billing server packages/clients`
- (2026-03-16) Inspect contract vs assignment status/UI usage:
  - `rg -n "contracts.status|client_contracts.is_active|ClientContractsTab|getContractsWithClients" packages server`
- (2026-03-16) Production query used to find inactive assignment rows:
  - query `client_contracts` for `is_active = false`, grouped by tenant/client/contract
- (2026-03-16) Production query used to find genuinely shared contracts:
  - group `client_contracts` by `(tenant, contract_id)` and filter to `count(distinct client_id) > 1`
- (2026-03-16) Production query used to measure blast radius:
  - join shared contract targets to `client_contracts`, `contracts`, `contract_lines`, `invoices`, `time_entries`, `usage_tracking`, `document_associations`, and `contract_pricing_schedules`
- (2026-03-16) Structural plan validation:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-16-client-owned-contracts-simplification`
- (2026-03-16) Guardrail verification:
  - `npx vitest run tests/contract.test.ts tests/renewalsQueueActions.createDraft.wiring.test.ts` (workdir `packages/billing`)
  - `npx vitest run src/models/clientContract.ownerGuardrails.test.ts` (workdir `packages/clients`)
  - `npx vitest run src/test/unit/migrations/clientOwnedContractOwnerMigration.test.ts src/test/unit/api/contractCreateOwnerClientSchema.test.ts` (workdir `server`)
  - `npx vitest run src/interfaces/contractOwnerClient.typecheck.test.ts` (workdir `packages/types`)
  - `npx tsc -p packages/types/tsconfig.json --noEmit`
  - `npx tsc -p packages/billing/tsconfig.json --noEmit`
  - `npx tsc -p packages/clients/tsconfig.json --noEmit`
  - `npx tsc -p server/tsconfig.json --noEmit`

## Progress Log

- (2026-03-16) Completed `F001`/`T001`: added migration `server/migrations/20260316120000_add_contract_owner_client_id.cjs` to add nullable `contracts.owner_client_id` with tenant/client FK and index, without rewriting template rows.
- (2026-03-16) Completed `F002`/`T002`: added `owner_client_id` to shared/server contract interfaces and API contract create/response schemas; added a type contract test.
- (2026-03-16) Completed `F012`/`T013`/`T014`: `Contract.create` now rejects non-template contracts without an owner, while supported billing UI/wizard flows pass the selected client through as `owner_client_id`.
- (2026-03-16) Completed `F013`/`T015`/`T016`: client-contract assignment create/update now reject non-template contracts whose `owner_client_id` is missing or belongs to a different client.
- (2026-03-16) Completed `F014`/`T017`: renewal draft creation now copies the source assignment client onto the draft contract header as `owner_client_id`.
- (2026-03-16) Completed `F015`/`T018`: legacy API/service contract creation now requires `owner_client_id` via Zod validation plus a service-level runtime check.

## Links / References

- Core contract model: `/Users/roberisaacs/alga-psa/packages/billing/src/models/contract.ts`
- Contract actions: `/Users/roberisaacs/alga-psa/packages/billing/src/actions/contractActions.ts`
- Contract wizard: `/Users/roberisaacs/alga-psa/packages/billing/src/actions/contractWizardActions.ts`
- Billing engine: `/Users/roberisaacs/alga-psa/packages/billing/src/lib/billing/billingEngine.ts`
- Client contract lifecycle helper: `/Users/roberisaacs/alga-psa/packages/clients/src/lib/clientContractWorkflowEvents.ts`
- Client contracts UI: `/Users/roberisaacs/alga-psa/packages/billing/src/components/billing-dashboard/contracts/ClientContractsTab.tsx`
- Contracts hub UI: `/Users/roberisaacs/alga-psa/packages/billing/src/components/billing-dashboard/contracts/Contracts.tsx`
- Contract detail routing: `/Users/roberisaacs/alga-psa/packages/billing/src/components/billing-dashboard/contracts/ContractDetailSwitcher.tsx`
- Contract reports: `/Users/roberisaacs/alga-psa/packages/billing/src/actions/contractReportActions.ts`
- Report definitions: `/Users/roberisaacs/alga-psa/server/src/lib/reports/definitions/contracts/revenue.ts`
- Client portal documents: `/Users/roberisaacs/alga-psa/packages/client-portal/src/actions/client-portal-actions/client-documents.ts`
- API controller/service: `/Users/roberisaacs/alga-psa/server/src/lib/api/controllers/ApiContractLineController.ts`, `/Users/roberisaacs/alga-psa/server/src/lib/api/services/ContractLineService.ts`
- Client contract line helpers: `/Users/roberisaacs/alga-psa/packages/billing/src/models/clientContractLine.ts`, `/Users/roberisaacs/alga-psa/packages/clients/src/models/clientContractLine.ts`
- Renewal queue actions: `/Users/roberisaacs/alga-psa/packages/billing/src/actions/renewalsQueueActions.ts`

## Open Questions

- Should a later follow-up fully remove live client semantics from `contracts.status`, or is limiting it to draft/header workflow sufficient?
- Should `/contracts` remain the long-term resource name for client-owned instantiated contract headers, or should a later API cleanup rename that concept?
