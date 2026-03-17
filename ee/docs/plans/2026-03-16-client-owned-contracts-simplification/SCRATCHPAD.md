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
- (2026-03-16) Migration sequencing: keep the existing `20260316120000_add_contract_owner_client_id.cjs` schema migration for `owner_client_id`, and run the shared-contract split as a follow-up migration (`20260316121000_client_owned_contracts_simplification.cjs`) so Knex ordering is deterministic.
- (2026-03-16) Safety boundary: clone-target invoice history is allowed and handled by preserved-assignment selection plus `client_contracts` repointing; only contract-scoped docs, pricing schedules, and contract-line history (`time_entries` / `usage_tracking`) are treated as unsupported retargeting for this migration helper pass.
- (2026-03-16) First implementation batch landed the owner-client invariant in creation/assignment code before the shared-contract split migration: nullable schema column first, code guardrails now, stricter DB not-null/backfill later once migrated data is safe.
- (2026-03-16) Legacy `/contracts` API create path should fail at validation/service time when `owner_client_id` is absent, not silently create another shareable non-template header.
- (2026-03-16) Live-status choice: treat `client_contracts` lifecycle as the contract-facing truth and surface assignment-derived status explicitly in billing loaders/UI instead of recalculating or mutating `contracts.status` on read.
- (2026-03-16) Detail-routing choice: resolve client-contract detail from `clientContractId` first and backfill `contractId` into the URL only for header/line/document lookups, keeping live detail assignment-first without rewriting all existing contract loaders at once.

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
- (2026-03-16) Contract revenue reporting had one more legacy seam after the live-status UI work: `packages/billing` action code was already mostly assignment-aware, but both report-definition copies (`server` and `packages/reporting`) still counted live contracts from `contracts.is_active`.
- (2026-03-16) The `/api/v1/contracts` and `/api/v2/contracts` surface had drifted behind the new ownership model: the controller still advertised a generic contract list and the list implementation was stubbed. The fix was to return real non-template headers filtered to `owner_client_id` and exclude templates from that resource entirely.
- (2026-03-16) `docs/billing/billing.md` still described `contracts` as a reusable sellable library. Updated it to make templates the only reusable layer, `contracts` the client-owned header table, and `client_contracts` the live lifecycle table.
- (2026-03-16) Client portal contract-linked document visibility still inferred ownership through `client_contracts`. Updated all 3 portal contract-document branches to resolve through `contracts.owner_client_id` and explicitly exclude templates, so stale shared assignment rows cannot leak documents.
- (2026-03-16) The duplicated `ClientContractLine` helper models in `packages/billing` and `packages/clients` still trusted `client_contracts -> contract_lines` by `contract_id` alone. Added `contracts` joins plus `owner_client_id` and non-template guards on overlap and listing queries so contract-derived helper rows cannot bleed across clients.
- (2026-03-16) The branch already had `F001/F002/F012-F015` runtime wiring in place: `IContract.owner_client_id`, billing dialog/wizard ownership writes, renewal draft ownership propagation, client-assignment ownership checks, and API schema/service ownership validation were already committed before the migration/helper batch.
- (2026-03-16) The missing implementation gap was the shared-contract split itself. Added:
  - `server/migrations/20260316121000_client_owned_contracts_simplification.cjs`
  - `server/migrations/utils/client_owned_contracts_simplification.cjs`
  - `server/src/test/unit/migrations/clientOwnedContractsSimplificationMigration.test.ts`
- (2026-03-16) `ContractDialog`, `createClientContractFromWizard`, and `createRenewalDraftForQueueItem` were all writing raw `contracts` rows without `owner_client_id`; those paths now stamp the client owner explicitly.
- (2026-03-16) `ClientContract.assignContractToClient` and `createClientContract` needed separate ownership checks because they do not share a single repository helper today.
- (2026-03-16) `updateClientContract` already ignored `contract_id` changes; guardrail now rejects cross-client repoint attempts explicitly instead of silently dropping them.
- (2026-03-16) `Contract.getAllWithClients` was still contract-first and still called `checkAndUpdateExpiredStatus`, so the live client-contract list was mutating header state and rendering `contracts.status` instead of assignment lifecycle.
- (2026-03-16) `ContractDetail` already fetched assignment summaries, but the header/overview panels and list actions still treated `contracts.status` as the visible live status and `updateContract(...status...)` as the lifecycle mutation path.
- (2026-03-16) Renewal/default-date normalization in both `shared/billingClients/clientContracts.ts` and `packages/clients/src/models/clientContract.ts` also needed to stop suppressing renewal dates based on `contract_status`; inactive assignment state is the correct lifecycle gate for those computed fields.

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
- (2026-03-16) Verify assignment-first report wiring:
  - `cd packages/billing && npx vitest run tests/contractReportActions.revenue.assignmentFact.test.ts tests/contractReportActions.summary.wiring.test.ts tests/contractReportActions.expiration.wiring.test.ts`
  - `cd server && npx vitest run src/test/client-owned-contract-report-definitions.test.ts`
- (2026-03-16) Verify contracts-resource semantics and server compile health:
  - `cd server && npx vitest run src/test/client-owned-contracts-resource-semantics.test.ts src/test/client-owned-contract-report-definitions.test.ts`
  - `npx tsc --noEmit -p server/tsconfig.json`
- (2026-03-16) Verify client-owned portal/helper invariants:
  - `cd packages/billing && npx vitest run tests/clientContractLine.ownerInvariant.wiring.test.ts`
  - `cd server && npx vitest run src/test/integration/clientPortalDocuments.integration.test.ts`
  - `npx tsc --noEmit -p packages/client-portal/tsconfig.json`
  - `npx tsc --noEmit -p packages/clients/tsconfig.json`
  - `npx tsc --noEmit -p packages/billing/tsconfig.json`
- (2026-03-16) Local validation note: `server/src/test/integration/clientPortalDocuments.integration.test.ts` is now updated with real contract-association cases for T045/T046, but it could not run in this workspace because the expected test Postgres on `127.0.0.1:5438` was not available (`ECONNREFUSED`).
- (2026-03-16) Focused ownership + migration verification:
  - `cd server && npx vitest run ../packages/billing/tests/contract.test.ts ../packages/billing/tests/renewalsQueueActions.createDraft.wiring.test.ts ../packages/clients/src/models/clientContract.ownerGuardrails.test.ts ../packages/types/src/interfaces/contractOwnerClient.typecheck.test.ts src/test/unit/api/contractCreateOwnerClientSchema.test.ts src/test/unit/migrations/clientOwnedContractOwnerMigration.test.ts src/test/unit/migrations/clientOwnedContractsSimplificationMigration.test.ts`
- (2026-03-16) Guardrail verification:
  - `npx vitest run tests/contract.test.ts tests/renewalsQueueActions.createDraft.wiring.test.ts` (workdir `packages/billing`)
  - `npx vitest run src/models/clientContract.ownerGuardrails.test.ts` (workdir `packages/clients`)
  - `mkdir -p coverage/.tmp && npx vitest run src/test/unit/api/contractCreateOwnerClientSchema.test.ts src/test/unit/migrations/clientOwnedContractOwnerMigration.test.ts src/test/unit/migrations/clientOwnedContractsSimplificationMigration.test.ts` (workdir `server`)
  - `npx vitest run src/interfaces/contractOwnerClient.typecheck.test.ts` (workdir `packages/types`)
  - `npx tsc -p packages/types/tsconfig.json --noEmit`
  - `npx tsc -p packages/billing/tsconfig.json --noEmit`
  - `npx tsc -p packages/clients/tsconfig.json --noEmit`
  - `npx tsc -p server/tsconfig.json --noEmit`
- (2026-03-16) Live-status/UI verification:
  - `npx vitest run tests/contractsHub.templateSeparation.wiring.test.ts tests/clientContractWorkflowEvents.wiring.test.ts tests/contract.assignmentFirst.wiring.test.ts tests/ClientContractsTab.assignmentLifecycle.test.ts tests/ContractDetail.clientOwnedSemantics.wiring.test.ts tests/clientContractStatus.shared.test.ts tests/clientContractEffectiveRenewalSettings.test.ts` (workdir `packages/billing`)
  - `npx vitest run src/models/clientContract.ownerGuardrails.test.ts` (workdir `packages/clients`)
  - `cd server && npx vitest run ../packages/types/src/interfaces/contractOwnerClient.typecheck.test.ts src/test/unit/api/contractCreateOwnerClientSchema.test.ts src/test/unit/migrations/clientOwnedContractOwnerMigration.test.ts src/test/unit/migrations/clientOwnedContractsSimplificationMigration.test.ts`
  - `npm run typecheck` (workdir `packages/billing`)
  - `npm run typecheck` (workdir `packages/clients`)
  - `npm run typecheck` (workdir `shared`)

## Progress Log

- (2026-03-16) Completed `F001`/`T001`: added migration `server/migrations/20260316120000_add_contract_owner_client_id.cjs` to add nullable `contracts.owner_client_id` with tenant/client FK and index, without rewriting template rows.
- (2026-03-16) Completed `F002`/`T002`: added `owner_client_id` to shared/server contract interfaces and API contract create/response schemas; added a type contract test.
- (2026-03-16) Completed `F012`/`T013`/`T014`: `Contract.create` now rejects non-template contracts without an owner, while supported billing UI/wizard flows pass the selected client through as `owner_client_id`.
- (2026-03-16) Completed `F013`/`T015`/`T016`: client-contract assignment create/update now reject non-template contracts whose `owner_client_id` is missing or belongs to a different client.
- (2026-03-16) Completed `F014`/`T017`: renewal draft creation now copies the source assignment client onto the draft contract header as `owner_client_id`.
- (2026-03-16) Completed `F015`/`T018`: legacy API/service contract creation now requires `owner_client_id` via Zod validation plus a service-level runtime check.
- (2026-03-16) Completed `F003-F011` and `T003-T012`: added `server/migrations/20260316121000_client_owned_contracts_simplification.cjs` plus `server/migrations/utils/client_owned_contracts_simplification.cjs` to detect shared non-template contracts, pick the preserved assignment by invoice/earliest-start rules, clone contract headers/lines/configuration rows for clone targets, repoint assignments, backfill `owner_client_id`, and fail closed on invoice/document/pricing/time/usage references that would need explicit historical retargeting.
- (2026-03-16) Completed `F016`/`F017`/`F019-F026` and `T019`/`T020`/`T023-T029`: billing live-contract loaders now read assignment-first rows from `client_contracts`, require `owner_client_id` for normal live rows, derive explicit `assignment_status` through a shared helper, route detail from `clientContractId`, render assignment-first status in list/detail/header UI, mutate lifecycle via `updateClientContractForBilling`, and keep templates visibly separate as the only reusable contract-definition path.

## Links / References

- Core contract model: `/Users/roberisaacs/alga-psa/packages/billing/src/models/contract.ts`
- Contract actions: `/Users/roberisaacs/alga-psa/packages/billing/src/actions/contractActions.ts`
- Contract wizard: `/Users/roberisaacs/alga-psa/packages/billing/src/actions/contractWizardActions.ts`
- Billing engine: `/Users/roberisaacs/alga-psa/packages/billing/src/lib/billing/billingEngine.ts`
- Client contract lifecycle helper: `/Users/roberisaacs/alga-psa/packages/clients/src/lib/clientContractWorkflowEvents.ts`
- Shared assignment status helper: `/Users/roberisaacs/alga-psa/shared/billingClients/clientContractStatus.ts`
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
