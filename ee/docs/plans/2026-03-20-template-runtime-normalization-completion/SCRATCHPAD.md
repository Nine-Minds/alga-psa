# Scratchpad — Template Runtime Normalization Completion

- Plan slug: `template-runtime-normalization-completion`
- Date opened: `2026-03-20`

## Scope Notes

- This is the cleanup remainder after the service-driven invoicing cutover, not a reopening of that broader billing work.
- The focus is the remaining template/runtime ambiguity around `template_contract_id`, contract application, line cloning/setup, service-layer helpers, and legacy decoupling scripts.
- Core billing fallback removal already landed elsewhere and should be treated as prerequisite context, not repeated scope.

## Discoveries

- `packages/clients/src/actions/clientContractActions.ts` still resolves template source using `clientContract.template_contract_id ?? clientContract.contract_id ?? null` in `applyContractToClient(...)`.
- `packages/clients/src/actions/clientContractLineActions.ts` still selects `template_contract_id` alongside `contract_id` and still resolves template source with `clientContract.template_contract_id ?? clientContract.contract_id`.
- `server/src/lib/api/services/ContractLineService.ts` still contains template-source fallback logic in client-owned mutation/setup paths.
- `server/scripts/contract-template-decoupling.ts` still backfills or depends on `template_contract_id` fallback semantics.
- `packages/billing/src/models/contract.ts` and related runtime readers still join template metadata for display/provenance. These joins need classification as allowed metadata reads versus behaviorally dangerous runtime widening.

## Prior Plan Context

- The March 18 service-driven invoicing cutover already tracked and completed several adjacent cleanup items:
  - `F083` remove template fallback joins from live billing computations
  - `F084` split instantiated contract detail/assignment loading from template detail loading
  - `F085` stop runtime backfill writes to `client_contracts.template_contract_id`
  - `F086` extend static guards for post-drop table usage
- This new plan should pick up only what remains after those changes.

## Working Decision

- Treat `template_contract_id` as suspicious by default:
  - allowed only when explicitly serving provenance metadata
  - forbidden when used as fallback runtime identity
- If a flow still needs authoring source data, make that dependency explicit and fail closed when the source cannot be determined.

## Open Questions

- Keep `client_contracts.template_contract_id` as provenance-only metadata for renewals/draft resume/debugging, or drive toward making it removable in a later migration?
- Which remaining template joins in runtime loaders are genuinely operator-useful provenance reads versus accidental mixed-model leakage?

## Candidate Commands

- `rg -n "template_contract_id|coalesce\\(cc\\.template_contract_id|template_contract_id \\?\\?|contract_templates as template" packages/billing packages/clients server`
- `pnpm exec vitest run --coverage.enabled=false <targeted tests>`
- `jq empty ee/docs/plans/2026-03-20-template-runtime-normalization-completion/features.json`
- `jq empty ee/docs/plans/2026-03-20-template-runtime-normalization-completion/tests.json`

## 2026-03-20 F001/T001 Inventory Classification

- Completed preflight runtime inventory with:
  - `rg -n "template_contract_id|template_contract_id \\?\\?|coalesce\\([^\\n]*template_contract_id|contract_templates as template" packages/clients/src packages/billing/src server/src/lib/api/services server/scripts`

### Forbidden runtime fallback (must remove)

- `packages/clients/src/actions/clientContractActions.ts`
  - `applyContractToClient(...)` uses `clientContract.template_contract_id ?? clientContract.contract_id ?? null` before cloning services/config.
- `packages/clients/src/actions/clientContractLineActions.ts`
  - `addClientContractLine(...)` loads both `template_contract_id` and `contract_id`, then falls back with `clientContract.template_contract_id ?? clientContract.contract_id`.
- `server/src/lib/api/services/ContractLineService.ts`
  - `assignPlanToClient(...)` loads both IDs and falls back with `clientContract.template_contract_id ?? clientContract.contract_id ?? null`.
- `server/scripts/contract-template-decoupling.ts`
  - Backfills `client_contracts.template_contract_id = contract_id` when missing.
  - Uses `clientContract?.template_contract_id ?? clientContract?.contract_id ?? null` when cloning.

### Legacy cleanup target

- `server/scripts/contract-template-decoupling.ts`
  - Script behavior is coupled to hybrid model (`client_contract_lines` + fallback backfill) and should be retired or rewritten to provenance-only semantics.

### Allowed provenance-only references (not runtime fallback)

- `packages/billing/src/models/contract.ts`
  - `getAllWithClients(...)` left-joins `contract_templates` by `cc.template_contract_id` only to expose template name metadata for list views.
- `packages/billing/src/actions/contractActions.ts`
  - `getDraftContracts(...)` joins `contract_templates` and selects `cc.template_contract_id` as draft metadata.
- `packages/billing/src/actions/renewalsQueueActions.ts`
  - Optional-column guard + copy-through of `template_contract_id` into draft assignment metadata (no fallback derivation).
- `packages/billing/src/actions/contractWizardActions.ts`
  - Writes `template_contract_id: submission.template_id ?? null` and reads back `template_id: clientContract.template_contract_id ?? undefined` for draft resume UX.
- `packages/billing/src/lib/billing/billingEngine.ts`
  - Selects `cc.template_contract_id` as provenance field while live joins remain anchored on `cc.contract_id -> contract_lines`.
- `packages/clients/src/actions/clientContractLineActions.ts`
  - `getClientContractLine(...)` selects `cc.template_contract_id` in response payload.
  - Update/edit destructuring drops inbound `template_contract_id` from mutable update fields.
- `packages/clients/src/models/clientContractLine.ts`
  - Selects `cc.template_contract_id` in DTO shape and strips it from mutation payload updates.
- `packages/clients/src/actions/clientContractActions.ts` and `packages/clients/src/models/clientContract.ts`
  - New client contract inserts set `template_contract_id: null` explicitly (no fallback behavior).

### Notes / gotchas

- There are additional `template_contract_id` mentions in tests; they are fixture/static assertions and not part of runtime inventory for F001.
- Immediate implementation focus after F001: remove the four forbidden fallback sites and convert missing-provenance cases to explicit fail-closed errors.

## 2026-03-20 F002 Semantics Decision (authoritative)

- `client_contracts.template_contract_id` remains in the schema for now as **provenance-only metadata**.
- It is **not** a valid runtime identifier and must never be used as fallback identity for live contract operations.
- Runtime ownership and live reads remain anchored on `client_contracts.contract_id` and cloned `contract_lines`.
- Current retained provenance uses:
  - draft/resume and renewal flows (`contractWizardActions`, `renewalsQueueActions`)
  - operator-facing metadata surfaces (`getAllWithClients`, draft list views, selected DTO fields)
- Removal readiness: **not ready for immediate drop migration** in this plan because retained draft/renewal metadata reads still exist; this plan’s objective is to remove behavioral dependence and leave only explicit provenance reads.

## 2026-03-20 Implementation Log (F003-F014)

### Runtime behavior changes

- Removed forbidden fallback resolution in client contract apply flow:
  - `packages/clients/src/actions/clientContractActions.ts`
  - replaced `template_contract_id ?? contract_id` with explicit provenance read and fail-closed error when missing.
- Removed forbidden fallback resolution in client contract line add flow:
  - `packages/clients/src/actions/clientContractLineActions.ts`
  - replaced fallback with explicit provenance read and fail-closed error when missing.
- Removed forbidden fallback resolution in API service contract-line assignment:
  - `server/src/lib/api/services/ContractLineService.ts`
  - assignment now requires `template_contract_id` provenance explicitly and errors when absent.
- Retired hybrid decoupling script semantics:
  - `server/scripts/contract-template-decoupling.ts`
  - rewritten to audit-only reporting; no `template_contract_id` backfill writes; no template clone fallback behavior.

### Runtime model/type provenance alignment

- Clarified provenance-only semantics in shared interfaces:
  - `packages/types/src/interfaces/billing.interfaces.ts`
  - `packages/types/src/interfaces/contract.interfaces.ts`
- Added explicit provenance metadata handling/comments in runtime client contract-line surfaces:
  - `packages/clients/src/models/clientContractLine.ts`
  - `packages/clients/src/actions/clientContractLineActions.ts`

### Legacy tests/fixtures normalization updates

- Updated tests that previously encoded fallback behavior:
  - `server/src/test/unit/api/contractLineService.clientOwnedMutation.test.ts` now asserts fail-closed on missing provenance and success when provenance exists.
  - `server/src/test/unit/billing/clientContractLineReplacementIdentity.test.ts` now asserts fail-closed add behavior when provenance is missing.
  - `packages/clients/src/actions/clientContractLineActions.recurringCompatibility.test.ts` now asserts `template_contract_id` is nullable provenance metadata.

### New tests added

- Apply flow provenance/fail-closed unit coverage:
  - `server/src/test/unit/billing/clientContractApplyProvenance.test.ts`
- Runtime fallback static guard extensions:
  - `server/src/test/unit/billing/clientContractLineRuntimeSourceGuards.static.test.ts`
  - now guards `template_contract_id ?? contract_id`, SQL `coalesce(template_contract_id, contract_id)`, and mixed-ID join patterns in targeted runtime files/scripts.
- Script contract test for decoupling script retirement:
  - `server/src/test/unit/scripts/contractTemplateDecoupling.script.test.ts`
- Shared type/schema provenance contract test:
  - `server/src/test/unit/billing/templateContractIdProvenance.types.test.ts`
- Runtime contract loader provenance static test:
  - `server/src/test/unit/billing/contractRuntimeLoaderTemplateProvenance.static.test.ts`
- DB-backed integration coverage for apply + line-add happy/failure:
  - `server/src/test/integration/templateRuntimeNormalization.clientActions.integration.test.ts`

### Commands / runbook

- Inventory command:
  - `rg -n "template_contract_id|template_contract_id \\?\\?|coalesce\\([^\\n]*template_contract_id|contract_templates as template" packages/clients/src packages/billing/src server/src/lib/api/services server/scripts`
- Unit/static test command (passing):
  - `pnpm exec vitest run src/test/unit/api/contractLineService.clientOwnedMutation.test.ts src/test/unit/billing/contractRuntimeLoaderTemplateProvenance.static.test.ts src/test/unit/billing/clientContractLineRuntimeSourceGuards.static.test.ts src/test/unit/scripts/contractTemplateDecoupling.script.test.ts src/test/unit/billing/templateContractIdProvenance.types.test.ts src/test/unit/billing/clientContractApplyProvenance.test.ts src/test/unit/billing/clientContractLineReplacementIdentity.test.ts ../packages/clients/src/actions/clientContractLineActions.recurringCompatibility.test.ts --coverage.enabled=false`
- Integration command (test authored; local environment blocked):
  - `pnpm exec vitest run src/test/integration/templateRuntimeNormalization.clientActions.integration.test.ts --coverage.enabled=false`

### Gotchas / blockers

- Local DB integration execution is blocked in this environment by:
  - `ECONNREFUSED ::1:5438` and `ECONNREFUSED 127.0.0.1:5438`
- Integration tests are implemented and ready, but could not be executed locally until Postgres test DB is reachable on configured port.
